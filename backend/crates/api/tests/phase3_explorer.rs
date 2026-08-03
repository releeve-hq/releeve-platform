//! Phase 3 backend explorer integration tests.
//!
//! These exercise the real router over disposable Postgres/Redis: public
//! decoded entity lookups, project-tracked account/contract flows, tags,
//! comments/priority, verification history, call-mode gating, and pagination.

mod common;

use axum::http::{Method, StatusCode};
use chrono::{TimeZone, Utc};
use ingest::models::{
    CallTreeNode, Event, FundFlowEdge, LedgerRecord, ResourceMetrics, StateChange, TxRecord,
    TxStatus,
};
use ingest::state::{upsert_ledger, upsert_tx};
use uuid::Uuid;
use wiremock::matchers::method;
use wiremock::{Mock, MockServer, ResponseTemplate};

use common::{TestApp, req};

fn new_email() -> String {
    format!("phase3-{}@example.com", Uuid::new_v4().simple())
}

async fn onboard(app: &TestApp) -> (String, String) {
    let email = new_email();
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
    let access = login["access_token"].as_str().unwrap().to_owned();

    let (status, orgs) = req(
        app.router(),
        Method::GET,
        "/api/v1/me/organizations",
        None,
        Some(&access),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    (access, orgs[0]["slug"].as_str().unwrap().to_owned())
}

async fn create_project(app: &TestApp, bearer: &str, org: &str) -> String {
    let (status, project) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{org}/projects"),
        Some(serde_json::json!({
            "name": "Explorer",
            "slug": "explorer",
            "network": "testnet"
        })),
        Some(bearer),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "project create: {project:?}");
    project["slug"].as_str().unwrap().to_owned()
}

async fn seed_chain_fixture(app: &TestApp) -> (String, Uuid, Uuid, Uuid) {
    let ledger = LedgerRecord {
        sequence: 700,
        network: "testnet".into(),
        hash: "ledger-700".into(),
        parent_hash: Some("ledger-699".into()),
        transaction_count: 1,
        size_bytes: 4096,
        timestamp: Utc.timestamp_opt(1_780_000_000, 0).unwrap(),
        base_operation_fee: Some("100".into()),
        base_reserve: Some("5000000".into()),
        total_cpu_instructions: Some(500),
        resource_limit: Some(1000),
    };
    upsert_ledger(app.db(), &ledger).await.unwrap();

    let tx = TxRecord {
        hash: "phase3-tx".into(),
        network: "testnet".into(),
        ledger_sequence: 700,
        status: TxStatus::Success,
        source_account: "GALICE".into(),
        operation_type: "invoke_host_function".into(),
        fee_charged: Some("300".into()),
        sequence_number: Some("12345".into()),
        application_order: 2,
        timestamp: Utc.timestamp_opt(1_780_000_010, 0).unwrap(),
        metrics: ResourceMetrics {
            cpu_instructions: Some(25),
            memory_bytes: Some(10),
            invoke_time_nsecs: Some(8),
            disk_read_bytes: Some(4),
            write_bytes: Some(2),
            max_rw_key_byte: Some(1),
            max_rw_data_byte: Some(1),
        },
        call_tree: vec![CallTreeNode {
            parent_index: None,
            contract_id: "CCONTRACT".into(),
            function_name: "transfer".into(),
            args: serde_json::json!([
                { "type": "Address", "value": "GALICE" },
                { "type": "Address", "value": "GBOB" },
                { "type": "I128", "value": "42" }
            ]),
            return_value: Some(serde_json::json!({ "type": "Bool", "value": true })),
            depth: 0,
        }],
        state_changes: vec![StateChange {
            entry_type: "contract_data".into(),
            entry_key: "balance:GALICE".into(),
            value_before: Some(serde_json::json!({ "amount": "100" })),
            value_after: Some(serde_json::json!({ "amount": "58" })),
            caused_by_node: Some(0),
        }],
        events: vec![Event {
            contract_id: "CCONTRACT".into(),
            topics: vec!["transfer".into(), "GALICE".into(), "GBOB".into()],
            data: serde_json::json!({ "amount": "42" }),
        }],
        fund_flow: vec![FundFlowEdge {
            from_address: "GALICE".into(),
            to_address: "GBOB".into(),
            asset: "XLM".into(),
            amount: "42".into(),
        }],
        raw_result_meta_xdr: None,
        raw_envelope_xdr: None,
    };
    let out = upsert_tx(app.db(), &tx).await.unwrap();
    let call_id = out.node_ids[0];
    let state_id: Uuid =
        sqlx::query_scalar("SELECT id FROM tx_state_changes WHERE tx_hash = 'phase3-tx' LIMIT 1")
            .fetch_one(app.db())
            .await
            .unwrap();
    let event_id: Uuid =
        sqlx::query_scalar("SELECT id FROM tx_events WHERE tx_hash = 'phase3-tx' LIMIT 1")
            .fetch_one(app.db())
            .await
            .unwrap();

    sqlx::query(
        r#"
        INSERT INTO entity_snapshots (network, entry_type, entry_key, value, ledger_sequence)
        VALUES ('testnet', 'account', 'account:GALICE', '{"asset":"XLM","balance":"100"}', 700)
        "#,
    )
    .execute(app.db())
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO token_prices (network, asset, price_usd, source) VALUES ('testnet','XLM',2,'fixture')",
    )
    .execute(app.db())
    .await
    .unwrap();

    ("phase3-tx".into(), call_id, state_id, event_id)
}

async fn track_contract(app: &TestApp, bearer: &str, org: &str, project: &str) -> Uuid {
    let (status, body) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{org}/{project}/contracts"),
        Some(serde_json::json!({ "address": "CCONTRACT" })),
        Some(bearer),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "track contract: {body:?}");
    let contract_id: Uuid =
        sqlx::query_scalar("SELECT id FROM contracts WHERE address = 'CCONTRACT'")
            .fetch_one(app.db())
            .await
            .unwrap();
    sqlx::query(
        r#"
        UPDATE contracts
        SET current_wasm_hash = 'wasm-ok',
            deployment_tx_hash = 'phase3-tx',
            deployment_timestamp = now(),
            rust_version = '1.92',
            soroban_sdk_version = '23.0.0',
            wasm_target = 'wasm32-unknown-unknown',
            opt_level = 'z',
            wasm_opt_applied = true
        WHERE id = $1
        "#,
    )
    .bind(contract_id)
    .execute(app.db())
    .await
    .unwrap();
    contract_id
}

#[tokio::test]
async fn public_detail_search_and_ledger_routes_return_decoded_shapes() {
    let app = TestApp::new().await;
    let (hash, _, _, _) = seed_chain_fixture(&app).await;

    let (status, body) = req(
        app.router(),
        Method::GET,
        &format!("/api/v1/explorer/testnet/tx/{hash}"),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "tx detail: {body:?}");
    assert_eq!(body["hash"], hash);
    assert_eq!(body["call_tree"][0]["function_name"], "transfer");
    assert_eq!(body["state_changes"][0]["key"], "balance:GALICE");
    assert_eq!(body["events"][0]["topics"][0], "transfer");
    assert_eq!(body["fund_flow"][0]["from"], "GALICE");
    assert_eq!(body["resource_usage"]["cpu_instructions"], 25);

    let (status, _) = req(
        app.router(),
        Method::GET,
        "/api/v1/explorer/testnet/tx/missing",
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, body) = req(
        app.router(),
        Method::GET,
        &format!("/api/v1/explorer/testnet/tx/{hash}/search?q=cpu&scope=metric"),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"][0]["kind"], "metric");

    let (status, body) = req(
        app.router(),
        Method::GET,
        &format!("/api/v1/explorer/testnet/tx/{hash}/search?q=transfer&scope=opcode"),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"]["code"], "bad_request");

    let (status, ledger) = req(
        app.router(),
        Method::GET,
        "/api/v1/explorer/testnet/ledger/700",
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(ledger["aggregate_resource_usage"]["percent_used"], 50);

    let (status, latest) = req(
        app.router(),
        Method::GET,
        "/api/v1/explorer/testnet/ledger/latest",
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(latest["sequence"], 700);
}

#[tokio::test]
async fn tracked_accounts_contracts_tags_comments_and_priority_work() {
    let app = TestApp::new().await;
    let (bearer, org) = onboard(&app).await;
    let project = create_project(&app, &bearer, &org).await;
    let (hash, call_id, state_id, event_id) = seed_chain_fixture(&app).await;

    let (status, tag) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{org}/{project}/tags"),
        Some(serde_json::json!({ "name": "prod-liquidator", "color": "#14b8a6" })),
        Some(&bearer),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "create tag: {tag:?}");
    let tag_id = tag["id"].as_str().unwrap();

    let (status, account) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{org}/{project}/accounts"),
        Some(serde_json::json!({ "address": "GALICE", "tags": [tag_id] })),
        Some(&bearer),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "track account: {account:?}");
    assert_eq!(account["tags"][0]["name"], "prod-liquidator");
    assert_eq!(account["xlm_balance"], "100");
    assert_eq!(account["usd_value"], "200");

    let (status, filtered_accounts) = req(
        app.router(),
        Method::GET,
        &format!("/api/v1/{org}/{project}/accounts?tag=prod-liquidator"),
        None,
        Some(&bearer),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(filtered_accounts["data"][0]["address"], "GALICE");

    let (status, updated_tag) = req(
        app.router(),
        Method::PATCH,
        &format!("/api/v1/{org}/{project}/tags/{tag_id}"),
        Some(serde_json::json!({ "name": "prod-wallet", "color": "#22c55e" })),
        Some(&bearer),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "update tag: {updated_tag:?}");
    assert_eq!(updated_tag["name"], "prod-wallet");

    let (status, account_txs) = req(
        app.router(),
        Method::GET,
        &format!("/api/v1/{org}/{project}/accounts/GALICE/transactions?type=invocations"),
        None,
        Some(&bearer),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(account_txs["data"][0]["hash"], hash);

    let contract_id = track_contract(&app, &bearer, &org, &project).await;
    let (status, _) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{org}/{project}/tags/{tag_id}/attach"),
        Some(serde_json::json!({ "entity_type": "contract", "entity_id": contract_id })),
        Some(&bearer),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, contract) = req(
        app.router(),
        Method::GET,
        &format!("/api/v1/{org}/{project}/contracts/CCONTRACT"),
        None,
        Some(&bearer),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(contract["current_wasm_hash"], "wasm-ok");
    assert_eq!(contract["tags"][0]["name"], "prod-wallet");
    assert_eq!(contract["source_map_status"], "not_available");

    let (status, filtered_contracts) = req(
        app.router(),
        Method::GET,
        &format!("/api/v1/{org}/{project}/contracts?tag=prod-wallet"),
        None,
        Some(&bearer),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(filtered_contracts["data"][0]["address"], "CCONTRACT");

    let (status, detached) = req(
        app.router(),
        Method::DELETE,
        &format!("/api/v1/{org}/{project}/tags/{tag_id}/detach/{contract_id}"),
        None,
        Some(&bearer),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detached["detached"], true);

    let (status, contract_txs) = req(
        app.router(),
        Method::GET,
        &format!("/api/v1/{org}/{project}/contracts/CCONTRACT/transactions"),
        None,
        Some(&bearer),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(contract_txs["data"][0]["hash"], hash);

    for i in 0..21 {
        sqlx::query(
            r#"
            INSERT INTO tx_events (tx_hash, contract_id, topics, data)
            VALUES ('phase3-tx', 'CCONTRACT', $1, $2)
            "#,
        )
        .bind(serde_json::json!([format!("extra-{i}")]))
        .bind(serde_json::json!({ "i": i }))
        .execute(app.db())
        .await
        .unwrap();
    }
    let (status, events) = req(
        app.router(),
        Method::GET,
        &format!("/api/v1/{org}/{project}/contracts/CCONTRACT/events?limit=20"),
        None,
        Some(&bearer),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(events["pagination"]["next_cursor"].as_str().is_some());
    let cursor = events["pagination"]["next_cursor"].as_str().unwrap();
    let (status, page2) = req(
        app.router(),
        Method::GET,
        &format!("/api/v1/{org}/{project}/contracts/CCONTRACT/events?limit=20&cursor={cursor}"),
        None,
        Some(&bearer),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(!page2["data"].as_array().unwrap().is_empty());

    let (status, comment) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{org}/{project}/transactions/{hash}/comments"),
        Some(serde_json::json!({
            "target": { "type": "call_node", "id": call_id },
            "text": "watch this transfer"
        })),
        Some(&bearer),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "comment: {comment:?}");

    let (status, priority) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{org}/{project}/transactions/{hash}/priority"),
        Some(serde_json::json!({
            "target": { "type": "state_change", "id": state_id },
            "level": "high"
        })),
        Some(&bearer),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "priority: {priority:?}");

    let (status, _bad_priority) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{org}/{project}/transactions/{hash}/priority"),
        Some(serde_json::json!({
            "target": { "type": "event", "id": event_id },
            "level": "urgent"
        })),
        Some(&bearer),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, searched) = req(
        app.router(),
        Method::GET,
        &format!("/api/v1/explorer/testnet/tx/{hash}/search?q=watch&scope=comment"),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(searched["data"][0]["kind"], "comment");

    let (status, deleted) = req(
        app.router(),
        Method::DELETE,
        &format!("/api/v1/{org}/{project}/tags/{tag_id}"),
        None,
        Some(&bearer),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(deleted["deleted"], true);
}

#[tokio::test]
async fn source_verification_and_call_modes_are_gated_and_testable() {
    let rpc = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "status": "SUCCESS",
                "events": [],
                "call_tree": [],
                "resource_usage": { "cpu_instructions": 7 }
            }
        })))
        .mount(&rpc)
        .await;

    let app = TestApp::with_soroban_rpc_url(&rpc.uri()).await;
    let (bearer, org) = onboard(&app).await;
    let project = create_project(&app, &bearer, &org).await;
    seed_chain_fixture(&app).await;
    let contract_id = track_contract(&app, &bearer, &org, &project).await;

    let (status, source) = req(
        app.router(),
        Method::GET,
        &format!("/api/v1/{org}/{project}/contracts/CCONTRACT/source"),
        None,
        Some(&bearer),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(source["source_map_status"], "not_available");

    let (status, submitted) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{org}/{project}/contracts/CCONTRACT/verify"),
        Some(serde_json::json!({
            "visibility": "public",
            "source_archive_url": "s3://source/archive.tar.gz",
            "toolchain": {
                "rust_version": "1.92",
                "soroban_sdk_version": "23.0.0",
                "wasm_target": "wasm32-unknown-unknown",
                "opt_level": "z",
                "wasm_opt_applied": true
            }
        })),
        Some(&bearer),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED, "submit verify: {submitted:?}");
    let verification_id = Uuid::parse_str(submitted["verification_id"].as_str().unwrap()).unwrap();

    let completed =
        api::explorer_detail::complete_verification(app.db(), verification_id, "wasm-ok")
            .await
            .unwrap();
    assert_eq!(completed["status"], "verified");

    let (status, failed_submit) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{org}/{project}/contracts/CCONTRACT/verify"),
        Some(serde_json::json!({
            "visibility": "private",
            "source_archive_url": "s3://source/bad.tar.gz",
            "toolchain": { "rust_version": "1.92" }
        })),
        Some(&bearer),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    let failed_id = Uuid::parse_str(failed_submit["verification_id"].as_str().unwrap()).unwrap();
    let failed = api::explorer_detail::complete_verification(app.db(), failed_id, "wrong-wasm")
        .await
        .unwrap();
    assert_eq!(failed["status"], "failed");
    assert!(
        failed["failure_reason"]
            .as_str()
            .unwrap()
            .contains("does not match")
    );

    let (status, history) = req(
        app.router(),
        Method::GET,
        &format!("/api/v1/{org}/{project}/contracts/CCONTRACT/verifications"),
        None,
        Some(&bearer),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let statuses: Vec<&str> = history["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row["status"].as_str().unwrap())
        .collect();
    assert!(statuses.contains(&"verified"));
    assert!(statuses.contains(&"failed"));

    let (status, simulate) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{org}/{project}/contracts/CCONTRACT/call?mode=simulate"),
        Some(serde_json::json!({
            "function_name": "transfer",
            "args": [{ "type": "Address", "value": "GALICE" }]
        })),
        Some(&bearer),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "simulate: {simulate:?}");
    assert_eq!(simulate["mode"], "simulate");
    assert_eq!(simulate["result"]["status"], "SUCCESS");

    let (status, run) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{org}/{project}/contracts/CCONTRACT/call?mode=run"),
        Some(serde_json::json!({ "function_name": "transfer", "args": [] })),
        Some(&bearer),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "run without signer: {run:?}");
    assert_eq!(run["error"]["code"], "signer_not_configured");

    sqlx::query(
        "INSERT INTO project_signers (project_id, network, public_key, encrypted_secret_ref) VALUES ((SELECT project_id FROM contracts WHERE id = $1), 'testnet', 'GSIGNER', 'kms://fixture')",
    )
    .bind(contract_id)
    .execute(app.db())
    .await
    .unwrap();
    let (status, run) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{org}/{project}/contracts/CCONTRACT/call?mode=run"),
        Some(serde_json::json!({ "function_name": "transfer", "args": [] })),
        Some(&bearer),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "run: {run:?}");
    assert_eq!(run["submitted"], true);
    assert_eq!(run["submit_status"], "stubbed");
}

#[tokio::test]
async fn project_routes_require_auth_and_membership() {
    let app = TestApp::new().await;
    let (bearer, org) = onboard(&app).await;
    let project = create_project(&app, &bearer, &org).await;
    seed_chain_fixture(&app).await;

    let (status, _) = req(
        app.router(),
        Method::GET,
        &format!("/api/v1/{org}/{project}/transactions"),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let (other, _) = onboard(&app).await;
    let (status, body) = req(
        app.router(),
        Method::GET,
        &format!("/api/v1/{org}/{project}/transactions"),
        None,
        Some(&other),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"]["code"], "not_found");

    let (status, list) = req(
        app.router(),
        Method::GET,
        &format!("/api/v1/{org}/{project}/transactions?contract=CCONTRACT"),
        None,
        Some(&bearer),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list["data"][0]["hash"], "phase3-tx");
}
