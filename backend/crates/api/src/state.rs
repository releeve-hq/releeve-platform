//! Process-wide state shared by handlers.

use sqlx::PgPool;

/// Handlers receive this via `axum::extract::State`.
#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub redis: redis::Client,
}
