//! `api` — the axum HTTP surface for the Releeve platform.
//!
//! Phase 0 ships a single live route table: `GET /health` (with db/redis
//! connectivity checks and degraded `503` semantics) plus the OpenAPI
//! (`utoipa`) skeleton served at `/docs`. Auth, permission middleware, and the
//! full route surface arrive in Phase 1+.

pub mod health;
pub mod state;

use axum::Router;
use axum::routing::get;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

use crate::health::__path_health_check;
use crate::health::{HealthChecks, HealthResponse, health_check};
use crate::state::AppState;

/// OpenAPI document for the platform API. Grows with every phase.
#[derive(OpenApi)]
#[openapi(
    paths(health_check),
    components(schemas(HealthResponse, HealthChecks)),
    info(title = "Releeve Platform API", version = "0.1.0")
)]
pub struct ApiDoc;

/// Build the application router. Owns no state; callers supply it.
pub fn app(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health_check))
        .merge(SwaggerUi::new("/docs").url("/api-docs/openapi.json", ApiDoc::openapi()))
        .with_state(state)
}
