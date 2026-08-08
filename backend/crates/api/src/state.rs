//! Process-wide state shared by handlers.

use std::sync::Arc;

use shared::Settings;
use sqlx::PgPool;

use crate::mailer::Mailer;
use crate::oauth::OAuthClients;
use crate::tokens::JwtIssuer;

/// Handlers receive this via `axum::extract::State`.
#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub redis: redis::Client,
    pub settings: Settings,
    pub jwt: JwtIssuer,
    pub mailer: Arc<dyn Mailer>,
    pub oauth: OAuthClients,
    pub fork_core: Option<sim::ForkCoreClient>,
}
