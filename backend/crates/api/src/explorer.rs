//! Public explorer feed endpoints (API doc §5.5): latest transactions, latest
//! ledgers, top tokens, and transfers.
//!
//! These are **public** (no auth), **rate-limited**, **cacheable**, and served
//! through the shared pagination envelope. Caching lives in Redis with Postgres
//! as the authoritative fallback: a cache hit skips the query, a miss (or a
//! Redis error) falls back correctly, and a rate-limit bucket failure fails
//! *open* so the public explorer never goes down because of Redis.

use std::convert::Infallible;
use std::future::Future;
use std::time::Duration;

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::response::sse::{Event, KeepAlive, Sse};
use futures::Stream;
use redis::AsyncCommands;
use serde::Deserialize;
use serde_json::{Value, json};
use shared::{Error, IngestSettings};
use utoipa::IntoParams;

use crate::state::AppState;
use ingest::feeds::{self, Cursor, Dir, Window};
use ingest::ratelimit;
use ingest::rpc::SorobanRpcClient;
use ingest::upstream::{Backoff, CircuitBreaker};
use ingest::worker::{HorizonClient, sync_network};

/// Sliding-window allowance for a single caller on explorer feeds.
const RATE_LIMIT_PER_WINDOW: u64 = 120;
const RATE_WINDOW_SECS: i64 = 60;
const LIVE_FEED_INTERVAL_SECS: u64 = 60;
/// Home keeps its compact lists at ten records, but its charts need enough
/// samples to describe recent activity without inventing any demo values.
const HOME_CHART_LIMIT: i64 = 20;

/// Shared query-string params for paginated feed endpoints.
#[derive(Debug, Deserialize, IntoParams)]
pub struct ListParams {
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub refresh: bool,
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
    refresh: bool,
    build: impl Future<Output = Result<feeds::Page, sqlx::Error>> + Send,
) -> Result<Value, Error> {
    if let Ok(mut conn) = state.redis.get_multiplexed_async_connection().await {
        let hit: Result<Option<String>, _> = if refresh {
            Ok(None)
        } else {
            conn.get(key).await
        };
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

fn ingest_network_settings(state: &AppState, network: &str) -> Result<IngestSettings, Error> {
    let (horizon_url, rpc_url) = match network {
        "mainnet" => (
            "https://horizon.stellar.org".to_string(),
            state.settings.soroban_rpc_url.clone(),
        ),
        "testnet" => (
            "https://horizon-testnet.stellar.org".to_string(),
            "https://soroban-testnet.stellar.org".to_string(),
        ),
        other => {
            return Err(Error::BadRequest(format!(
                "unsupported explorer network: {other}"
            )));
        }
    };

    Ok(IngestSettings {
        database_url: state.settings.database_url.clone(),
        redis_url: state.settings.redis_url.clone(),
        log_filter: state.settings.log_filter.clone(),
        network: network.to_string(),
        horizon_url,
        rpc_url,
        price_feed_url: String::new(),
        sync_interval_secs: 10,
        rollup_interval_secs: 300,
        max_ledgers_per_pass: 5,
        lock_ttl_secs: 60,
    })
}

/// `POST /api/v1/explorer/{network}/sync`
pub async fn sync_explorer_network(
    State(state): State<AppState>,
    Path(network): Path<String>,
) -> Result<Json<Value>, Error> {
    rate_limit(&state, "explorer", &format!("sync:{network}")).await?;

    let settings = ingest_network_settings(&state, &network)?;
    let mut redis = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .map_err(Error::internal)?;
    let backoff = || Backoff {
        base: Duration::from_millis(200),
        max: Duration::from_secs(2),
        jitter: 0.2,
        max_attempts: 3,
    };
    let breaker = || CircuitBreaker::new(3, Duration::from_secs(30));
    let mut horizon = HorizonClient::new(settings.horizon_url.clone(), backoff(), breaker());
    let mut rpc = if settings.rpc_url.trim().is_empty() {
        None
    } else {
        Some(SorobanRpcClient::new(
            settings.rpc_url.clone(),
            backoff(),
            breaker(),
        ))
    };
    let ingested = sync_network(
        &mut horizon,
        &state.db,
        &mut redis,
        &settings.network,
        settings.max_ledgers_per_pass,
        settings.lock_ttl_secs,
        rpc.as_mut(),
    )
    .await?;

    Ok(Json(json!({
        "network": network,
        "ledgers_ingested": ingested,
        "horizon_url": settings.horizon_url,
        "soroban_trace_enrichment": if settings.rpc_url.trim().is_empty() { "disabled" } else { "daemon_required" }
    })))
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
    let payload = cached_page(&state, &key, feeds::FEED_TTL_SECS, p.refresh, async move {
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
    let payload = cached_page(&state, &key, feeds::FEED_TTL_SECS, p.refresh, async move {
        feeds::latest_ledgers(&db, &network_for_query, limit, cursor, Dir::Next).await
    })
    .await?;
    Ok(Json(payload))
}

async fn live_payload(state: &AppState, network: &str) -> Result<String, Error> {
    let tx_key = feeds::feed_key(network, "transactions", &page_tail(HOME_CHART_LIMIT, None));
    let ledger_key = feeds::feed_key(network, "ledgers", &page_tail(HOME_CHART_LIMIT, None));
    let tx_db = state.db.clone();
    let tx_network = network.to_owned();
    let transactions = cached_page(state, &tx_key, feeds::FEED_TTL_SECS, false, async move {
        feeds::latest_transactions(&tx_db, &tx_network, HOME_CHART_LIMIT, None, Dir::Next).await
    })
    .await?;
    let ledger_db = state.db.clone();
    let ledger_network = network.to_owned();
    let ledgers = cached_page(
        state,
        &ledger_key,
        feeds::FEED_TTL_SECS,
        false,
        async move {
            feeds::latest_ledgers(
                &ledger_db,
                &ledger_network,
                HOME_CHART_LIMIT,
                None,
                Dir::Next,
            )
            .await
        },
    )
    .await?;

    serde_json::to_string(&json!({
        "network": network,
        "generated_at": chrono::Utc::now(),
        "transactions": transactions,
        "ledgers": ledgers,
    }))
    .map_err(Error::internal)
}

/// `GET /api/v1/explorer/{network}/live`
pub async fn live_feed(
    State(state): State<AppState>,
    Path(network): Path<String>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, Error> {
    rate_limit(&state, "explorer", &format!("live:{network}")).await?;

    let stream = futures::stream::unfold(
        (state, network, true),
        |(state, network, first)| async move {
            if !first {
                tokio::time::sleep(Duration::from_secs(LIVE_FEED_INTERVAL_SECS)).await;
            }
            let payload = live_payload(&state, &network)
                .await
                .unwrap_or_else(|err| json!({ "error": err.to_string() }).to_string());
            let event = Event::default().event("explorer.feed").data(payload);
            Some((Ok(event), (state, network, false)))
        },
    );

    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
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
    let payload = cached_page(&state, &key, feeds::RANKINGS_TTL_SECS, false, async move {
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
    let payload = cached_page(&state, &key, feeds::FEED_TTL_SECS, false, async move {
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
