//! Runtime handler tests for the Fork Core proxy boundary.
//!
//! These mount the real axum router with the real Fork Core client pointed at
//! a wiremock server acting as Fork Core. They prove the *runtime* status
//! semantics that the OpenAPI test only asserts on the spec (todo.md P0:
//! "Add runtime Platform status tests").

mod common;

use axum::body::Body;
use axum::http::{HeaderMap, Method, Request, StatusCode};
use serde_json::{Value, json};
use sim::{ForkCoreClient, ServiceAssertionSigner};
use tower::ServiceExt;
use uuid::Uuid;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use common::TestApp;

const PRIVATE_KEY: &[u8] = br#"-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIBae9dM/HT/asr3+2QFTFTHrEXLUjjpfseI2pvjpL5O3
-----END PRIVATE KEY-----"#;

fn accepted(sim_id: Uuid, job_id: Uuid) -> Value {
    json!({
        "simulation_id": sim_id,
        "job_id": job_id,
        "created": true,
        "status": "queued",
        "stage": "queued",
        "progress": 0,
        "retry_after_ms": 5_000,
        "simulation_url": format!("/v1/simulations/{sim_id}"),
        "status_url": format!("/v1/jobs/{job_id}")
    })
}

fn environment(id: Uuid, name: &str, revision: i64, mode: &str, sync_enabled: bool) -> Value {
    json!({
        "id": id,
        "name": name,
        "network": "testnet",
        "mode": mode,
        "sync_enabled": sync_enabled,
        "sync_status": if sync_enabled { "syncing" } else { "paused" },
        "active_revision_id": Uuid::new_v4(),
        "requested_ledger": 2_070_825,
        "state_ledger": 2_070_826,
        "execution_ledger": 2_070_827,
        "protocol": 26,
        "state_hash": format!("fixture-state-{revision}"),
        "verification_status": "verified",
        "revision": revision
    })
}

/// Fire a request with arbitrary extra headers and capture status + headers + body.
async fn req_with(
    app: &TestApp,
    method: Method,
    uri: &str,
    headers: &[(&str, &str)],
    body: Option<Value>,
    bearer: Option<&str>,
) -> (StatusCode, HeaderMap, Value) {
    let mut builder = Request::builder().method(method).uri(uri);
    if body.is_some() || bearer.is_some() {
        builder = builder.header("content-type", "application/json");
    }
    if let Some(token) = bearer {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    for (key, value) in headers {
        builder = builder.header(*key, *value);
    }
    let json = body.map(|b| b.to_string()).unwrap_or_default();
    let request = builder.body(Body::from(json)).expect("request builds");
    let response = app
        .router()
        .clone()
        .oneshot(request)
        .await
        .expect("request completes");
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body read");
    let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, headers, value)
}

async fn app_with_fork_core(server: &MockServer) -> TestApp {
    let signer = ServiceAssertionSigner::from_ed25519_pem(
        PRIVATE_KEY,
        "test",
        "releeve-platform",
        "fork-core",
    )
    .expect("signer builds");
    let client = ForkCoreClient::new(server.uri(), signer).expect("client builds");
    TestApp::new().await.with_fork_core(client)
}

/// Sign up/verify/login and return (access_token, personal org slug).
async fn onboard(app: &TestApp) -> (String, String) {
    let email = format!(
        "fc{}.{}@example.com",
        Uuid::new_v4().simple(),
        Uuid::new_v4().simple()
    );
    let (status, _) = common::req(
        app.router(),
        Method::POST,
        "/api/v1/auth/signup",
        Some(json!({ "email": email, "password": "password-1234" })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let token = common::token_from_mail(&app.mailer.drain()[0].body);
    let (status, _) = common::req(
        app.router(),
        Method::POST,
        "/api/v1/auth/verify",
        Some(json!({ "token": token })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, login) = common::req(
        app.router(),
        Method::POST,
        "/api/v1/auth/login",
        Some(json!({ "email": email, "password": "password-1234" })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let access = login["access_token"].as_str().unwrap().to_string();
    let (_, orgs) = common::req(
        app.router(),
        Method::GET,
        "/api/v1/me/organizations",
        None,
        Some(&access),
    )
    .await;
    let slug = orgs[0]["slug"].as_str().unwrap().to_string();
    (access, slug)
}

async fn create_project(app: &TestApp, access: &str, org: &str) -> String {
    let (status, project) = common::req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{org}/projects"),
        Some(json!({ "name": "Fork lab", "network": "testnet" })),
        Some(access),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "project is created");
    project["slug"].as_str().unwrap().to_string()
}

fn request_body() -> Value {
    json!({
        "network": "testnet",
        "state_source": { "type": "latest" },
        "invocation": {
            "type": "decoded",
            "contract_id": "C000000000000000000000000000000000000000000000000000000000000000",
            "function_name": "hello",
            "args": [],
            "source_account_xdr": "AAAAAAA",
            "sequence_number": 1
        },
        "overrides": [],
        "impersonate": [],
        "capture_trace": false
    })
}

#[tokio::test]
async fn create_simulation_returns_202() {
    let server = MockServer::start().await;
    let sim_id = Uuid::new_v4();
    let job_id = Uuid::new_v4();
    Mock::given(method("POST"))
        .and(path("/v1/simulations"))
        .respond_with(ResponseTemplate::new(202).set_body_json(accepted(sim_id, job_id)))
        .expect(1)
        .mount(&server)
        .await;

    let app = app_with_fork_core(&server).await;
    let (access, org) = onboard(&app).await;
    let project = create_project(&app, &access, &org).await;

    let (status, headers, body) = req_with(
        &app,
        Method::POST,
        &format!("/api/v1/{org}/{project}/simulations"),
        &[("idempotency-key", "test-key-1")],
        Some(request_body()),
        Some(&access),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(body["fork_core"]["simulation_id"], sim_id.to_string());
    assert_eq!(body["fork_core"]["job_id"], job_id.to_string());
    assert_eq!(headers["content-type"], "application/json");
}

#[tokio::test]
async fn environment_simulation_returns_202() {
    let server = MockServer::start().await;
    let env_id = Uuid::new_v4();
    let sim_id = Uuid::new_v4();
    let job_id = Uuid::new_v4();
    Mock::given(method("POST"))
        .and(path(format!("/v1/environments/{env_id}/simulate")))
        .respond_with(ResponseTemplate::new(202).set_body_json(accepted(sim_id, job_id)))
        .expect(1)
        .mount(&server)
        .await;

    let app = app_with_fork_core(&server).await;
    let (access, org) = onboard(&app).await;
    let project = create_project(&app, &access, &org).await;
    let project_id: Uuid = sqlx::query_scalar(
        "SELECT p.id FROM projects p JOIN organizations o ON o.id = p.organization_id
         WHERE o.slug = $1 AND p.slug = $2",
    )
    .bind(&org)
    .bind(&project)
    .fetch_one(app.db())
    .await
    .expect("project id resolves");
    sqlx::query("INSERT INTO fork_environments (id, project_id, name, base_ledger_sequence, network) VALUES ($1,$2,$3,0,'testnet')")
        .bind(env_id)
        .bind(project_id)
        .bind("Test env")
        .execute(app.db())
        .await
        .expect("environment seeded");

    let (status, _, body) = req_with(
        &app,
        Method::POST,
        &format!("/api/v1/{org}/{project}/environments/{env_id}/simulate"),
        &[("idempotency-key", "test-key-env-sim")],
        Some(json!({ "invocation": { "type": "decoded", "contract_id": "x", "function_name": "hello", "args": [], "source_account_xdr": "AAAAAAA", "sequence_number": 1 } })),
        Some(&access),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(body["fork_core"]["simulation_id"], sim_id.to_string());
    assert_eq!(body["fork_core"]["job_id"], job_id.to_string());
}

#[tokio::test]
async fn start_sync_returns_202() {
    let server = MockServer::start().await;
    let env_id = Uuid::new_v4();
    Mock::given(method("POST"))
        .and(path(format!("/v1/environments/{env_id}/sync/start")))
        .respond_with(
            ResponseTemplate::new(202)
                .set_body_json(json!({ "job_id": Uuid::new_v4(), "status": "queued" })),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(format!("/v1/environments/{env_id}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(environment(
            env_id,
            "Syncing lab",
            2,
            "follow_latest",
            true,
        )))
        .expect(1)
        .mount(&server)
        .await;

    let app = app_with_fork_core(&server).await;
    let (access, org) = onboard(&app).await;
    let project = create_project(&app, &access, &org).await;

    let (status, _, body) = req_with(
        &app,
        Method::POST,
        &format!("/api/v1/{org}/{project}/environments/{env_id}/sync/start"),
        &[("idempotency-key", "test-key-sync")],
        None,
        Some(&access),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert!(
        body["status_url"].as_str().is_some(),
        "status URL is exposed"
    );
}

#[tokio::test]
async fn coverage_repair_returns_202() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/networks/testnet/coverage/repair"))
        .respond_with(
            ResponseTemplate::new(202)
                .set_body_json(json!({ "job_id": Uuid::new_v4(), "status": "queued" })),
        )
        .expect(1)
        .mount(&server)
        .await;

    let app = app_with_fork_core(&server).await;
    let (access, org) = onboard(&app).await;
    let project = create_project(&app, &access, &org).await;

    let (status, _, body) = req_with(
        &app,
        Method::POST,
        &format!("/api/v1/{org}/{project}/networks/testnet/coverage/repair"),
        &[("idempotency-key", "test-key-repair")],
        Some(request_body()),
        Some(&access),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert!(
        body["status_url"].as_str().is_some(),
        "status URL is exposed"
    );
}

#[tokio::test]
async fn cancel_simulation_returns_202() {
    let server = MockServer::start().await;
    let sim_id = Uuid::new_v4();
    let job_id = Uuid::new_v4();
    Mock::given(method("POST"))
        .and(path("/v1/simulations"))
        .respond_with(ResponseTemplate::new(202).set_body_json(accepted(sim_id, job_id)))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path(format!("/v1/simulations/{sim_id}")))
        .respond_with(ResponseTemplate::new(202).set_body_json(json!({ "status": "cancelling" })))
        .expect(1)
        .mount(&server)
        .await;

    let app = app_with_fork_core(&server).await;
    let (access, org) = onboard(&app).await;
    let project = create_project(&app, &access, &org).await;

    let (create_status, _, created) = req_with(
        &app,
        Method::POST,
        &format!("/api/v1/{org}/{project}/simulations"),
        &[("idempotency-key", "test-key-cancel-sim")],
        Some(request_body()),
        Some(&access),
    )
    .await;
    assert_eq!(create_status, StatusCode::ACCEPTED);
    let local_id = created["id"].as_str().unwrap();

    let (status, _, body) = req_with(
        &app,
        Method::DELETE,
        &format!("/api/v1/{org}/{project}/simulations/{local_id}"),
        &[],
        None,
        Some(&access),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(body["fork_core"]["status"], "cancelling");
}

#[tokio::test]
async fn cancel_job_returns_202() {
    let server = MockServer::start().await;
    let job_id = Uuid::new_v4();
    Mock::given(method("DELETE"))
        .and(path(format!("/v1/jobs/{job_id}")))
        .respond_with(ResponseTemplate::new(202).set_body_json(json!({ "status": "cancelling" })))
        .expect(1)
        .mount(&server)
        .await;

    let app = app_with_fork_core(&server).await;
    let (access, org) = onboard(&app).await;
    let project = create_project(&app, &access, &org).await;

    let (status, _, body) = req_with(
        &app,
        Method::DELETE,
        &format!("/api/v1/{org}/{project}/jobs/{job_id}"),
        &[],
        None,
        Some(&access),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(body["status"], "cancelling");
}

#[tokio::test]
async fn upstream_problem_propagates_status_and_problem_json() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/simulations"))
        .respond_with(ResponseTemplate::new(422).set_body_json(json!({
            "type": "https://errors.releeve.dev/fork-core/budget_limited",
            "title": "Materialization budget reached",
            "status": 422,
            "code": "budget_limited",
            "detail": "The request would exceed a configured cost or resource limit."
        })))
        .expect(1)
        .mount(&server)
        .await;

    let app = app_with_fork_core(&server).await;
    let (access, org) = onboard(&app).await;
    let project = create_project(&app, &access, &org).await;

    let (status, headers, body) = req_with(
        &app,
        Method::POST,
        &format!("/api/v1/{org}/{project}/simulations"),
        &[("idempotency-key", "test-key-limit")],
        Some(request_body()),
        Some(&access),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        headers["content-type"], "application/problem+json",
        "upstream problem media type is preserved"
    );
    assert_eq!(body["error"]["code"], "budget_limited");
    assert_eq!(
        body["error"]["message"], "The request would exceed a configured cost or resource limit.",
        "upstream problem detail text is preserved"
    );
}

#[tokio::test]
async fn create_environment_and_branch_return_201() {
    let server = MockServer::start().await;
    let env_id = Uuid::new_v4();
    let branch_id = Uuid::new_v4();
    Mock::given(method("POST"))
        .and(path("/v1/simulations"))
        .respond_with(
            ResponseTemplate::new(202).set_body_json(accepted(Uuid::new_v4(), Uuid::new_v4())),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/v1/environments"))
        .respond_with(ResponseTemplate::new(201).set_body_json(environment(
            env_id,
            "Frozen lab",
            1,
            "frozen",
            false,
        )))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(format!(
            "/v1/environments/{env_id}/revisions/{}/branch",
            Uuid::nil()
        )))
        .respond_with(ResponseTemplate::new(201).set_body_json(environment(
            branch_id,
            "Investigation branch",
            1,
            "frozen",
            false,
        )))
        .expect(1)
        .mount(&server)
        .await;

    let app = app_with_fork_core(&server).await;
    let (access, org) = onboard(&app).await;
    let project = create_project(&app, &access, &org).await;

    // A completed certified simulation is required to create an environment.
    let (create_status, _, created) = req_with(
        &app,
        Method::POST,
        &format!("/api/v1/{org}/{project}/simulations"),
        &[("idempotency-key", "test-key-env-create")],
        Some(request_body()),
        Some(&access),
    )
    .await;
    assert_eq!(create_status, StatusCode::ACCEPTED);
    let local_sim_id = Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();
    sqlx::query("UPDATE simulation_runs SET status='success' WHERE id=$1")
        .bind(local_sim_id)
        .execute(app.db())
        .await
        .expect("simulation marked success");

    let (status, headers, body) = req_with(
        &app,
        Method::POST,
        &format!("/api/v1/{org}/{project}/environments"),
        &[],
        Some(json!({ "name": "Frozen lab", "simulation_id": local_sim_id, "mode": "frozen" })),
        Some(&access),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "create environment is 201");
    assert_eq!(body["id"], env_id.to_string());
    assert_eq!(headers["content-type"], "application/json");

    let (status, _, branch_body) = req_with(
        &app,
        Method::POST,
        &format!(
            "/api/v1/{org}/{project}/environments/{env_id}/revisions/{}/branch",
            Uuid::nil()
        ),
        &[],
        Some(json!({ "name": "Investigation branch" })),
        Some(&access),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "branch is 201");
    assert_eq!(branch_body["id"], branch_id.to_string());
}
