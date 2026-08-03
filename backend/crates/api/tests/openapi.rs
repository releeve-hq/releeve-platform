//! OpenAPI smoke test — the spec served at /api-docs/openapi.json must include
//! auth/org routes and the Phase 2/3 explorer backend surface.

mod common;

use axum::http::{Method, StatusCode};

use common::{TestApp, req};

#[tokio::test]
async fn openapi_exposes_platform_routes_and_bearer_security() {
    let app = TestApp::new().await;
    let (status, spec) = req(
        app.router(),
        Method::GET,
        "/api-docs/openapi.json",
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    for path in [
        "/api/v1/auth/signup",
        "/api/v1/auth/login",
        "/api/v1/auth/verify",
        "/api/v1/auth/token/refresh",
        "/api/v1/auth/logout",
        "/api/v1/auth/forgot-password",
        "/api/v1/auth/reset-password",
        "/api/v1/auth/oauth/{provider}/start",
        "/api/v1/auth/oauth/{provider}/callback",
        "/api/v1/me",
        "/api/v1/me/organizations",
        "/api/v1/explorer/{network}/transactions/latest",
        "/api/v1/explorer/{network}/ledgers",
        "/api/v1/explorer/{network}/tokens/top",
        "/api/v1/explorer/{network}/transfers",
        "/api/v1/explorer/{network}/tx/{hash}",
        "/api/v1/explorer/{network}/tx/{hash}/search",
        "/api/v1/explorer/{network}/account/{address}",
        "/api/v1/explorer/{network}/contract/{address}",
        "/api/v1/explorer/{network}/ledger/{sequence}",
        "/api/v1/explorer/{network}/ledger/latest",
        "/api/v1/{org}/{project}/transactions",
        "/api/v1/{org}/{project}/transactions/{hash}/comments",
        "/api/v1/{org}/{project}/transactions/{hash}/priority",
        "/api/v1/{org}/{project}/accounts",
        "/api/v1/{org}/{project}/accounts/{address}",
        "/api/v1/{org}/{project}/accounts/{address}/transactions",
        "/api/v1/{org}/{project}/contracts",
        "/api/v1/{org}/{project}/contracts/{address}",
        "/api/v1/{org}/{project}/contracts/{address}/transactions",
        "/api/v1/{org}/{project}/contracts/{address}/events",
        "/api/v1/{org}/{project}/contracts/{address}/source",
        "/api/v1/{org}/{project}/contracts/{address}/upgrades",
        "/api/v1/{org}/{project}/contracts/{address}/verify",
        "/api/v1/{org}/{project}/contracts/{address}/verifications",
        "/api/v1/{org}/{project}/contracts/{address}/call",
        "/api/v1/{org}/{project}/tags",
        "/api/v1/{org}/{project}/tags/{tag_id}",
        "/api/v1/{org}/{project}/tags/{tag_id}/attach",
        "/api/v1/{org}/{project}/tags/{tag_id}/detach/{entity_id}",
        "/api/v1/{org}/destinations",
        "/api/v1/{org}/destinations/{destination_id}",
        "/api/v1/{org}/destinations/{destination_id}/test",
        "/api/v1/{org}/{project}/destinations",
        "/api/v1/{org}/{project}/destinations/{destination_id}",
        "/api/v1/{org}/{project}/destinations/{destination_id}/test",
        "/api/v1/{org}/{project}/alerts",
        "/api/v1/{org}/{project}/alerts/{alert_id}",
        "/api/v1/{org}/{project}/alerts/{alert_id}/history",
    ] {
        assert!(
            spec["paths"].get(path).is_some(),
            "expected path `{path}` in the OpenAPI spec"
        );
    }

    // The bearer security scheme is defined and used.
    assert_eq!(
        spec["components"]["securitySchemes"]["AuthorizationBearer"]["scheme"],
        "bearer"
    );
}
