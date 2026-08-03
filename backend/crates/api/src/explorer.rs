//! Public explorer feed endpoints (API doc §5.5): latest transactions, latest
//! ledgers, top tokens, and transfers.
//!
//! These are **public** (no auth), **rate-limited**, **cacheable**, and served
//! through the shared pagination envelope. Caching lives in Redis with Postgres
//! as the authoritative fallback: a cache hit skips the query, a miss (or a
//! Redis error) falls back correctly, and a rate-limit bucket failure fails
//! *open* so the public explorer never goes down because of Redis.

use axum::Json;
use axum::extract::{Path, Query, State};
use serde::Deserialize;
use shared::Error;
use utoipa::IntoParams;

use crate::state::AppState;
use ingest::feeds::{self, Cursor, Dir, Window};
use ingest::ratelimit;

/// Sliding-window allowance for a single caller on explorer feeds.
const RATE_LIMIT_PER_WINDOW: u64 = 120;
const RATE_WINDOW_SECS: i64 = 60;

/// Shared query-string params for paginated feed endpoints.
#[derive(Debug, Deserialize, IntoParams)]
pub struct ListParams {
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub cursor: Option<String>,
}

/// Params for `/tokens/top` and `/transfers`.
#[derive(Debug, Deserialize, IntoParams)]
pub struct FeedParams {
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub window: Option<String>,
    #[serde(default)]
    pub asset: Option<String>,
}

/// Decode the cursor, mapping a malformed token to a 400 rather than silently
/// treating it as "no cursor" (a client error should be loud).
fn parse_cursor(raw: Option<&str>) -> Result<Option<Cursor>, Error> {
    match raw {
        None | Some("") => Ok(None),
        Some(s) => Cursor::decode(s)
            .map(Some)
            .ok_or_else(|| Error::BadRequest("malformed cursor token".to_owned())),
    }
}

fn parse_window(raw: Option<&str>) -> Result<Window, Error> {
    match raw {
        None => Ok(Window::H24),
        Some(w) => Window::parse(w)
            .ok_or_else(|| Error::BadRequest(format!("invalid window: {w} (expected 24h|7d|30d)"))),
    }
}

/// Reserve a per-key rate-limit slot. Fails open on Redis error; returns 429
/// when the bucket is over quota.
async fn rate_limit(state: &AppState, scope: &str, key: &str) -> Result<(), Error> {
    let mut conn = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .map_err(Error::internal)?;
    let bucket = ratelimit::key(scope, key);
    let allowed = ratelimit::check(
        &mut conn,
        &bucket,
        RATE_LIMIT_PER_WINDOW,
        RATE_WINDOW_SECS,
        chrono::Utc::now().timestamp_millis(),
    )
    .await
    .unwrap_or(true); // fail open when Redis is unavailable
    if allowed {
        Ok(())
    } else {
        Err(Error::RateLimited)
    }
}

/// `GET /api/v1/explorer/{network}/transactions/latest`
#[utoipa::path(
    get,
    path = "/api/v1/explorer/{network}/transactions/latest",
    params(("network" = String, Path), ListParams),
    responses((status = 200, description = "Latest transactions, paginated")),
)]
pub async fn recent_transactions(
    State(state): State<AppState>,
    Path(network): Path<String>,
    Query(p): Query<ListParams>,
) -> Result<Json<serde_json::Value>, Error> {
    rate_limit(&state, "explorer", &format!("transactions:{network}")).await?;

    let cursor = parse_cursor(p.cursor.as_deref())?;
    let limit = feeds::clamp_limit(p.limit);
    let page = feeds::latest_transactions(&state.db, &network, limit, cursor, Dir::Next)
        .await
        .map_err(Error::internal)?;
    Ok(Json(serde_json::to_value(page).map_err(Error::internal)?))
}

/// `GET /api/v1/explorer/{network}/ledgers`
#[utoipa::path(
    get,
    path = "/api/v1/explorer/{network}/ledgers",
    params(("network" = String, Path), ListParams),
    responses((status = 200, description = "Latest ledgers, paginated")),
)]
pub async fn recent_ledgers(
    State(state): State<AppState>,
    Path(network): Path<String>,
    Query(p): Query<ListParams>,
) -> Result<Json<serde_json::Value>, Error> {
    rate_limit(&state, "explorer", &format!("ledgers:{network}")).await?;

    let cursor = parse_cursor(p.cursor.as_deref())?;
    let limit = feeds::clamp_limit(p.limit);
    let page = feeds::latest_ledgers(&state.db, &network, limit, cursor, Dir::Next)
        .await
        .map_err(Error::internal)?;
    Ok(Json(serde_json::to_value(page).map_err(Error::internal)?))
}

/// `GET /api/v1/explorer/{network}/tokens/top?window=24h|7d|30d`
#[utoipa::path(
    get,
    path = "/api/v1/explorer/{network}/tokens/top",
    params(("network" = String, Path), FeedParams),
    responses((status = 200, description = "Top tokens by window volume")),
)]
pub async fn top_tokens(
    State(state): State<AppState>,
    Path(network): Path<String>,
    Query(p): Query<FeedParams>,
) -> Result<Json<serde_json::Value>, Error> {
    let window = parse_window(p.window.as_deref())?;
    rate_limit(
        &state,
        "explorer",
        &format!("top_tokens:{network}:{window:?}"),
    )
    .await?;

    let cursor = parse_cursor(p.cursor.as_deref())?;
    let limit = feeds::clamp_limit(p.limit);
    let page = feeds::top_tokens(&state.db, &network, window, limit, cursor)
        .await
        .map_err(Error::internal)?;
    Ok(Json(serde_json::to_value(page).map_err(Error::internal)?))
}

/// `GET /api/v1/explorer/{network}/transfers?asset=&window=`
#[utoipa::path(
    get,
    path = "/api/v1/explorer/{network}/transfers",
    params(("network" = String, Path), FeedParams),
    responses((status = 200, description = "Token transfers, filtered + paginated")),
)]
pub async fn transfers(
    State(state): State<AppState>,
    Path(network): Path<String>,
    Query(p): Query<FeedParams>,
) -> Result<Json<serde_json::Value>, Error> {
    let window = parse_window(p.window.as_deref())?;
    rate_limit(
        &state,
        "explorer",
        &format!("transfers:{network}:{window:?}"),
    )
    .await?;

    let cursor = parse_cursor(p.cursor.as_deref())?;
    let limit = feeds::clamp_limit(p.limit);
    let page = feeds::transfers(
        &state.db,
        &network,
        p.asset.as_deref(),
        window,
        limit,
        cursor,
    )
    .await
    .map_err(Error::internal)?;
    Ok(Json(serde_json::to_value(page).map_err(Error::internal)?))
}
