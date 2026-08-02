//! `GET /health` — dependency connectivity probe.
//!
//! Returns `200 {"status":"ok","checks":{"db":"ok","redis":"ok"}}` when every
//! dependency is reachable, and `503` otherwise with the failing dependency
//! named (`"db":"down"` / `"redis":"down"`). A down dependency is reported,
//! never silently swallowed; failures are logged without leaking details.

use std::time::Duration;

use axum::{Json, extract::State, http::StatusCode};
use serde::Serialize;
use utoipa::ToSchema;

use crate::state::AppState;

const OK: &str = "ok";
const DOWN: &str = "down";

#[derive(Debug, Serialize, ToSchema)]
pub struct HealthResponse {
    pub status: &'static str,
    pub checks: HealthChecks,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct HealthChecks {
    pub db: &'static str,
    pub redis: &'static str,
}

#[utoipa::path(
    get,
    path = "/health",
    responses(
        (status = 200, description = "All dependencies reachable", body = HealthResponse),
        (status = 503, description = "One or more dependencies unreachable", body = HealthResponse),
    )
)]
pub async fn health_check(State(state): State<AppState>) -> (StatusCode, Json<HealthResponse>) {
    let db = check_db(&state).await;
    let redis = check_redis(&state).await;

    let healthy = db == OK && redis == OK;
    let status = if healthy {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    (
        status,
        Json(HealthResponse {
            status: if healthy { OK } else { "degraded" },
            checks: HealthChecks { db, redis },
        }),
    )
}

async fn check_db(state: &AppState) -> &'static str {
    let probe = sqlx::query_scalar::<_, i32>("SELECT 1").fetch_one(&state.db);
    match tokio::time::timeout(Duration::from_secs(2), probe).await {
        Ok(Ok(_)) => OK,
        Ok(Err(err)) => {
            tracing::warn!(error = %err, "health: db unreachable");
            DOWN
        }
        Err(_) => {
            tracing::warn!("health: db probe timed out");
            DOWN
        }
    }
}

async fn check_redis(state: &AppState) -> &'static str {
    let mut conn = match state.redis.get_multiplexed_async_connection().await {
        Ok(conn) => conn,
        Err(err) => {
            tracing::warn!(error = %err, "health: redis unreachable");
            return DOWN;
        }
    };
    let pong = redis::cmd("PING").query_async::<String>(&mut conn).await;
    match pong {
        Ok(pong) if pong == "PONG" => OK,
        Ok(pong) => {
            tracing::warn!(reply = %pong, "health: unexpected redis ping reply");
            DOWN
        }
        Err(err) => {
            tracing::warn!(error = %err, "health: redis ping failed");
            DOWN
        }
    }
}
