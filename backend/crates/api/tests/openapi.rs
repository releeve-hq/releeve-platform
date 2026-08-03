//! OpenAPI smoke test — the spec served at /api-docs/openapi.json must include
//! the auth/org routes and Phase 2 explorer feeds, not just health.

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
