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
        "/api/v1/{org}/{project}/simulations",
        "/api/v1/{org}/{project}/simulations/{simulation_id}",
        "/api/v1/{org}/{project}/jobs/{job_id}",
        "/api/v1/{org}/{project}/environments",
        "/api/v1/{org}/{project}/networks/{network}/coverage",
        "/api/v1/{org}/{project}/networks/{network}/coverage/repair",
        "/api/v1/{org}/{project}/environments/{environment_id}/revisions",
        "/api/v1/{org}/{project}/environments/{environment_id}/revisions/{revision_id}/activate",
        "/api/v1/{org}/{project}/environments/{environment_id}/revisions/{revision_id}/branch",
    ] {
        assert!(
            spec["paths"].get(path).is_some(),
            "expected path `{path}` in the OpenAPI spec"
        );
    }
    for path in [
        "/api/v1/{org}/{project}/simulations/{simulation_id}",
        "/api/v1/{org}/{project}/jobs/{job_id}",
    ] {
        let responses = &spec["paths"][path]["delete"]["responses"];
        assert!(
            responses.get("202").is_some(),
            "cancellation operation `{path}` must document HTTP 202"
        );
        assert!(
            responses.get("200").is_none(),
            "cancellation operation `{path}` must not document HTTP 200"
        );
    }

    assert_eq!(
        spec["paths"]["/api/v1/{org}/{project}/simulations"]["post"]["requestBody"]["content"]["application/json"]
            ["schema"]["$ref"],
        "#/components/schemas/CreateSimulationRequest"
    );
    assert!(spec["components"]["schemas"].get("StateSource").is_some());
    assert!(spec["components"]["schemas"].get("Invocation").is_some());
    assert!(
        spec["paths"]["/api/v1/{org}/{project}/jobs/{job_id}"]["delete"].is_object(),
        "execution jobs must expose authenticated cancellation"
    );
    assert!(
        spec["paths"]["/api/v1/{org}/{project}/networks/{network}/coverage/repair"]["post"]
            .is_object(),
        "historical coverage repair must be documented"
    );
    assert_eq!(
        spec["paths"]["/api/v1/{org}/{project}/networks/{network}/coverage/repair"]["post"]["requestBody"]
            ["content"]["application/json"]["schema"]["$ref"],
        "#/components/schemas/CreateSimulationRequest"
    );
    for path in [
        "/api/v1/{org}/{project}/simulations",
        "/api/v1/{org}/{project}/environments/{environment_id}/simulate",
        "/api/v1/{org}/{project}/environments/{environment_id}/sync/start",
        "/api/v1/{org}/{project}/networks/{network}/coverage/repair",
    ] {
        let responses = &spec["paths"][path]["post"]["responses"];
        assert!(
            responses.get("202").is_some(),
            "queued operation `{path}` must document HTTP 202"
        );
        assert!(
            responses.get("200").is_none(),
            "queued operation `{path}` must not document HTTP 200"
        );
    }
    assert!(
        spec["paths"]
            .get("/api/v1/{org}/{project}/environments/{environment_id}/rollback")
            .is_none()
    );
    for path in [
        "/api/v1/{org}/{project}/environments",
        "/api/v1/{org}/{project}/environments/{environment_id}/revisions/{revision_id}/branch",
    ] {
        let responses = &spec["paths"][path]["post"]["responses"];
        assert!(
            responses.get("201").is_some(),
            "resource-creation operation `{path}` must document HTTP 201"
        );
        assert!(
            responses.get("200").is_none(),
            "resource-creation operation `{path}` must not document HTTP 200"
        );
    }

    // The bearer security scheme is defined and used.
    assert_eq!(
        spec["components"]["securitySchemes"]["AuthorizationBearer"]["scheme"],
        "bearer"
    );
}
