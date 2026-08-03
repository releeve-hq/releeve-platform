//! Phase 4 monitoring/alerts integration tests.

mod common;

use axum::http::{Method, StatusCode};
use chrono::{TimeZone, Utc};
use ingest::models::{
    CallTreeNode, Event, FundFlowEdge, LedgerRecord, ResourceMetrics, StateChange, TxRecord,
    TxStatus,
};
use ingest::state::{upsert_ledger, upsert_tx};
use uuid::Uuid;
use wiremock::matchers::{header_exists, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use common::{TestApp, req};

async fn onboard(app: &TestApp) -> (String, String, String) {
    let (access, _, _) = common::verified_user(app).await;
    let (status, orgs) = req(
        app.router(),
        Method::GET,
        "/api/v1/me/organizations",
        None,
        Some(&access),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let org = orgs[0]["slug"].as_str().unwrap().to_owned();
    let (status, project) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{org}/projects"),
        Some(serde_json::json!({
            "name": "Monitoring",
            "slug": "monitoring",
            "network": "testnet"
        })),
        Some(&access),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "project create: {project:?}");
    (access, org, "monitoring".into())
}

async fn seed_tx(app: &TestApp) -> String {
    let ledger = LedgerRecord {
        sequence: 901,
        network: "testnet".into(),
        hash: "ledger-901".into(),
        parent_hash: None,
        transaction_count: 1,
        size_bytes: 100,
        timestamp: Utc.with_ymd_and_hms(2026, 8, 3, 12, 0, 0).unwrap(),
        base_operation_fee: Some("100".into()),
        base_reserve: Some("5000000".into()),
        total_cpu_instructions: Some(100),
        resource_limit: Some(1000),
    };
    upsert_ledger(app.db(), &ledger).await.unwrap();
    let tx = TxRecord {
        hash: "phase4-tx".into(),
        network: "testnet".into(),
        ledger_sequence: 901,
        status: TxStatus::Success,
        source_account: "GBLOCKED".into(),
        operation_type: "invoke_host_function".into(),
        fee_charged: Some("100".into()),
        sequence_number: Some("1".into()),
        application_order: 0,
        timestamp: ledger.timestamp,
        metrics: ResourceMetrics {
            cpu_instructions: Some(10),
            ..Default::default()
        },
        call_tree: vec![CallTreeNode {
            parent_index: None,
            contract_id: "CCONTRACT".into(),
            function_name: "liquidate".into(),
            args: serde_json::json!({ "asset": "XLM", "amount": 42 }),
            return_value: Some(serde_json::json!({ "ok": true })),
            depth: 0,
        }],
        state_changes: vec![StateChange {
            entry_type: "contract_data".into(),
            entry_key: "balance:GBLOCKED".into(),
            value_before: Some(serde_json::json!(1)),
            value_after: Some(serde_json::json!(43)),
            caused_by_node: None,
        }],
        events: vec![Event {
            contract_id: "CCONTRACT".into(),
            topics: vec!["transfer".into(), "XLM".into()],
            data: serde_json::json!({ "asset": "XLM", "amount": 42 }),
        }],
        fund_flow: vec![FundFlowEdge {
            from_address: "GBLOCKED".into(),
            to_address: "GALICE".into(),
            asset: "XLM".into(),
            amount: "42".into(),
        }],
        raw_result_meta_xdr: None,
        raw_envelope_xdr: None,
    };
    upsert_tx(app.db(), &tx).await.unwrap();
    tx.hash
}

async fn project_id(app: &TestApp, org: &str, project: &str) -> Uuid {
    sqlx::query_scalar(
        "SELECT p.id FROM projects p JOIN organizations o ON o.id = p.organization_id WHERE o.slug = $1 AND p.slug = $2",
    )
    .bind(org)
    .bind(project)
    .fetch_one(app.db())
    .await
    .unwrap()
}

#[tokio::test]
async fn alert_crud_webhook_delivery_and_dedupe_work_end_to_end() {
    let app = TestApp::new().await;
    let (access, org, project) = onboard(&app).await;
    let hash = seed_tx(&app).await;
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/hook"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/hook"))
        .and(header_exists("x-releeve-signature"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({ "ok": true })))
        .expect(1)
        .mount(&server)
        .await;

    let (status, dest) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{org}/{project}/destinations"),
        Some(serde_json::json!({
            "type": "webhook",
            "url": format!("{}/hook", server.uri()),
            "timeout_seconds": 5,
            "max_retries": 5
        })),
        Some(&access),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "dest create: {dest:?}");
    let dest_id = dest["id"].as_str().unwrap();

    let (status, alert) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{org}/{project}/alerts"),
        Some(serde_json::json!({
            "name": "blocked liquidation",
            "target": { "type": "project" },
            "match_logic": "all",
            "expressions": [
                { "type": "function_call", "params": { "function_name": "liquidate" } },
                { "type": "blocklisted_callers", "params": { "addresses": ["GBLOCKED"] } },
                { "type": "event_parameter", "params": { "data": { "asset": "XLM" } } },
                { "type": "state_change", "params": { "storage_key": "balance:GBLOCKED", "condition": { "any_change": true } } }
            ],
            "destinations": [{ "id": dest_id, "scope": "project" }]
        })),
        Some(&access),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "alert create: {alert:?}");

    let pid = project_id(&app, &org, &project).await;
    let fired = api::monitoring::evaluate_transaction_alerts(&app.state(), pid, "testnet", &hash)
        .await
        .unwrap();
    assert_eq!(fired.len(), 1);
    let fired_again =
        api::monitoring::evaluate_transaction_alerts(&app.state(), pid, "testnet", &hash)
            .await
            .unwrap();
    assert!(fired_again.is_empty(), "dedupe suppresses repeat firing");

    let alert_id = alert["id"].as_str().unwrap();
    let (status, history) = req(
        app.router(),
        Method::GET,
        &format!("/api/v1/{org}/{project}/alerts/{alert_id}/history"),
        None,
        Some(&access),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "history: {history:?}");
    assert_eq!(history["data"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn account_destination_types_validate_and_email_test_delivers() {
    let app = TestApp::new().await;
    let (access, org, _) = onboard(&app).await;
    for body in [
        serde_json::json!({ "type": "email", "config": { "to": ["ops@example.com"] } }),
        serde_json::json!({ "type": "slack", "config": { "webhook_url": "http://localhost/slack" } }),
        serde_json::json!({ "type": "telegram", "config": { "bot_token": "token", "chat_id": "chat" } }),
        serde_json::json!({ "type": "discord", "config": { "webhook_url": "http://localhost/discord" } }),
        serde_json::json!({ "type": "sentry", "config": { "dsn": "http://localhost/sentry" } }),
        serde_json::json!({ "type": "pagerduty", "config": { "integration_key": "pd" } }),
    ] {
        let (status, created) = req(
            app.router(),
            Method::POST,
            &format!("/api/v1/{org}/destinations"),
            Some(body),
            Some(&access),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "destination: {created:?}");
    }
    let (status, list) = req(
        app.router(),
        Method::GET,
        &format!("/api/v1/{org}/destinations"),
        None,
        Some(&access),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list["data"].as_array().unwrap().len(), 6);
    let email_id = list["data"]
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["type"] == "email")
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let (status, delivery) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{org}/destinations/{email_id}/test"),
        Some(serde_json::json!({ "tx_hash": "phase4-tx" })),
        Some(&access),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "email test: {delivery:?}");
    assert_eq!(delivery["status"], "success");
    assert_eq!(app.mailer.count(), 1);
}

#[tokio::test]
async fn view_function_expression_polls_soroban_rpc_and_fires() {
    let rpc = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "jsonrpc": "2.0",
            "id": "releeve-alert-view-function",
            "result": { "price": 10 }
        })))
        .expect(1)
        .mount(&rpc)
        .await;
    let app = TestApp::with_soroban_rpc_url(&rpc.uri()).await;
    let (access, org, project) = onboard(&app).await;
    let hash = seed_tx(&app).await;
    let (status, dest) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{org}/destinations"),
        Some(serde_json::json!({ "type": "email", "config": { "to": ["ops@example.com"] } })),
        Some(&access),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, alert) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{org}/{project}/alerts"),
        Some(serde_json::json!({
            "name": "view price",
            "target": { "type": "project" },
            "match_logic": "all",
            "expressions": [
                {
                    "type": "view_function",
                    "params": {
                        "contract_id": "CCONTRACT",
                        "function_name": "last_price",
                        "poll_interval_seconds": 60,
                        "condition": { "path": "price", "min": 9 }
                    }
                }
            ],
            "destinations": [{ "id": dest["id"].as_str().unwrap(), "scope": "account" }]
        })),
        Some(&access),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "alert: {alert:?}");
    let pid = project_id(&app, &org, &project).await;
    let fired = api::monitoring::evaluate_transaction_alerts(&app.state(), pid, "testnet", &hash)
        .await
        .unwrap();
    assert_eq!(fired.len(), 1);
    assert_eq!(app.mailer.count(), 1);
}

#[tokio::test]
async fn manage_alerts_permission_is_required_for_writes() {
    let app = TestApp::new().await;
    let (owner, org, project) = onboard(&app).await;
    let email = format!("phase4-{}@example.com", Uuid::new_v4().simple());
    let (status, _) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/signup",
        Some(serde_json::json!({ "email": email, "password": "password-1234" })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = common::token_from_mail(&app.mailer.drain()[0].body);
    let (status, _) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/verify",
        Some(serde_json::json!({ "token": token })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, login) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/login",
        Some(serde_json::json!({ "email": email, "password": "password-1234" })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let member_access = login["access_token"].as_str().unwrap().to_owned();
    let (status, invite) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{org}/members"),
        Some(serde_json::json!({ "email": email })),
        Some(&owner),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "invite: {invite:?}");

    let (status, body) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{org}/{project}/alerts"),
        Some(serde_json::json!({
            "name": "denied",
            "target": { "type": "project" },
            "match_logic": "all",
            "expressions": [{ "type": "successful_transaction", "params": {} }],
            "destinations": []
        })),
        Some(&member_access),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "body: {body:?}");
}
