//! Public explorer feed endpoints (API doc §5.5): latest transactions, latest
//! ledgers, top tokens, and transfers.
//!
//! These are **public** (no auth), **rate-limited**, **cacheable**, and served
//! through the shared pagination envelope. Caching lives in Redis with Postgres
//! as the authoritative fallback: a cache hit skips the query, a miss (or a
//! Redis error) falls back correctly, and a rate-limit bucket failure fails
//! *open* so the public explorer never goes down because of Redis.

use std::future::Future;

use axum::Json;
use axum::extract::{Path, Query, State};
use redis::AsyncCommands;
use serde::Deserialize;
use serde_json::Value;
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

fn window_label(window: Window) -> &'static str {
    match window {
        Window::H24 => "24h",
        Window::H7d => "7d",
        Window::H30d => "30d",
    }
}

fn page_tail(limit: i64, cursor: Option<&str>) -> String {
    format!(":limit={limit}:cursor={}", cursor.unwrap_or(""))
}

async fn cached_page(
    state: &AppState,
    key: &str,
    ttl_secs: u64,
    build: impl Future<Output = Result<feeds::Page, sqlx::Error>> + Send,
) -> Result<Value, Error> {
    if let Ok(mut conn) = state.redis.get_multiplexed_async_connection().await {
        let hit: Result<Option<String>, _> = conn.get(key).await;
        if let Ok(Some(raw)) = hit
            && let Ok(value) = serde_json::from_str(&raw)
        {
            return Ok(value);
        }

        let page = build.await.map_err(Error::internal)?;
        let payload = serde_json::to_value(page).map_err(Error::internal)?;
        let _: Result<(), _> = conn.set_ex(key, payload.to_string(), ttl_secs).await;
        return Ok(payload);
    }

    let page = build.await.map_err(Error::internal)?;
    serde_json::to_value(page).map_err(Error::internal)
}

/// Reserve a per-key rate-limit slot. Fails open on any Redis unavailability
/// (connection failure or command error); returns 429 when the bucket is over
/// quota. A broken limiter must degrade latency, not availability.
async fn rate_limit(state: &AppState, scope: &str, key: &str) -> Result<(), Error> {
    let bucket = ratelimit::key(scope, key);
    let allowed = match state.redis.get_multiplexed_async_connection().await {
        Ok(mut conn) => ratelimit::check(
            &mut conn,
            &bucket,
            RATE_LIMIT_PER_WINDOW,
            RATE_WINDOW_SECS,
            chrono::Utc::now().timestamp_millis(),
        )
        .await
        .unwrap_or(true), // command failure fails open too
        Err(_) => true, // Redis unreachable → allow through
    };
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
) -> Result<Json<Value>, Error> {
    rate_limit(&state, "explorer", &format!("transactions:{network}")).await?;

    let cursor = parse_cursor(p.cursor.as_deref())?;
    let limit = feeds::clamp_limit(p.limit);
    let key = feeds::feed_key(
        &network,
        "transactions",
        &page_tail(limit, p.cursor.as_deref()),
    );
    let db = state.db.clone();
    let network_for_query = network.clone();
    let payload = cached_page(&state, &key, feeds::FEED_TTL_SECS, async move {
        feeds::latest_transactions(&db, &network_for_query, limit, cursor, Dir::Next).await
    })
    .await?;
    Ok(Json(payload))
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
) -> Result<Json<Value>, Error> {
    rate_limit(&state, "explorer", &format!("ledgers:{network}")).await?;

    let cursor = parse_cursor(p.cursor.as_deref())?;
    let limit = feeds::clamp_limit(p.limit);
    let key = feeds::feed_key(&network, "ledgers", &page_tail(limit, p.cursor.as_deref()));
    let db = state.db.clone();
    let network_for_query = network.clone();
    let payload = cached_page(&state, &key, feeds::FEED_TTL_SECS, async move {
        feeds::latest_ledgers(&db, &network_for_query, limit, cursor, Dir::Next).await
    })
    .await?;
    Ok(Json(payload))
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
) -> Result<Json<Value>, Error> {
    let window = parse_window(p.window.as_deref())?;
    rate_limit(
        &state,
        "explorer",
        &format!("top_tokens:{network}:{window:?}"),
    )
    .await?;

    let cursor = parse_cursor(p.cursor.as_deref())?;
    let limit = feeds::clamp_limit(p.limit);
    let key = feeds::feed_key(
        &network,
        "top_tokens",
        &format!(
            ":window={}:{}",
            window_label(window),
            page_tail(limit, p.cursor.as_deref())
        ),
    );
    let db = state.db.clone();
    let network_for_query = network.clone();
    let payload = cached_page(&state, &key, feeds::RANKINGS_TTL_SECS, async move {
        feeds::top_tokens(&db, &network_for_query, window, limit, cursor).await
    })
    .await?;
    Ok(Json(payload))
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
) -> Result<Json<Value>, Error> {
    let window = parse_window(p.window.as_deref())?;
    rate_limit(
        &state,
        "explorer",
        &format!("transfers:{network}:{window:?}"),
    )
    .await?;

    let cursor = parse_cursor(p.cursor.as_deref())?;
    let limit = feeds::clamp_limit(p.limit);
    let key = feeds::feed_key(
        &network,
        "transfers",
        &format!(
            ":window={}:asset={}:{}",
            window_label(window),
            p.asset.as_deref().unwrap_or("*"),
            page_tail(limit, p.cursor.as_deref())
        ),
    );
    let db = state.db.clone();
    let network_for_query = network.clone();
    let asset = p.asset.clone();
    let payload = cached_page(&state, &key, feeds::FEED_TTL_SECS, async move {
        feeds::transfers(
            &db,
            &network_for_query,
            asset.as_deref(),
            window,
            limit,
            cursor,
        )
        .await
    })
    .await?;
    Ok(Json(payload))
}
