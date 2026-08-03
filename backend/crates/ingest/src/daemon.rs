//! `releeve-ingest` daemon: the scheduled driver behind Phase 2 ingestion.
//!
//! Owns no state itself — it builds the Horizon / Soroban-RPC / price clients
//! from [`IngestSettings`], then runs two loops on an interval:
//!
//! - **sync**: `worker::sync_network` pulls ledgers + transactions and enriches
//!   Soroban invocations (watermark + single-writer lock keep it idempotent and
//!   multi-worker-safe).
//! - **rollup**: `rollup::rollup_all` aggregates trailing 24h/7d/30d buckets and
//!   refreshes `token_prices` from the external price feed (skipped when no
//!   `price_feed_url` is configured; a down feed degrades to `NULL` USD, never
//!   an error).
//!
//! Each network runs independently; a dead upstream pauses that network only.

use shared::IngestSettings;
use sqlx::PgPool;
use tokio::time::{Duration, MissedTickBehavior};

use crate::prices::HttpPriceFeed;
use crate::rollup::{PriceFeed, rollup_all};
use crate::rpc::SorobanRpcClient;
use crate::upstream::{Backoff, CircuitBreaker};
use crate::worker::{HorizonClient, sync_network};

const BACKOFF_BASE_MS: u64 = 250;
const BACKOFF_MAX_MS: u64 = 30_000;
const BACKOFF_JITTER: f64 = 0.1;
const BACKOFF_ATTEMPTS: u32 = 4;
const BREAKER_MAX_FAILURES: u32 = 8;
const BREAKER_COOLDOWN_SECS: u64 = 60;

/// Error type for the daemon: anything that is not a per-network transient
/// failure (DB connection, config, redis connection) aborts the process.
pub type DaemonError = Box<dyn std::error::Error + Send + Sync>;

fn backoff() -> Backoff {
    Backoff {
        base: Duration::from_millis(BACKOFF_BASE_MS),
        max: Duration::from_millis(BACKOFF_MAX_MS),
        jitter: BACKOFF_JITTER,
        max_attempts: BACKOFF_ATTEMPTS,
    }
}

fn breaker() -> CircuitBreaker {
    CircuitBreaker::new(
        BREAKER_MAX_FAILURES,
        Duration::from_secs(BREAKER_COOLDOWN_SECS),
    )
}

/// Run the sync + rollup loops for one network until the process is cancelled.
pub async fn run_network(settings: &IngestSettings, pool: PgPool) -> Result<(), DaemonError> {
    let mut redis = redis::Client::open(settings.redis_url.clone())?
        .get_multiplexed_async_connection()
        .await?;

    let mut horizon = HorizonClient::new(settings.horizon_url.clone(), backoff(), breaker());
    let mut rpc = SorobanRpcClient::new(settings.rpc_url.clone(), backoff(), breaker());

    let mut sync_tick = tokio::time::interval(Duration::from_secs(settings.sync_interval_secs));
    sync_tick.set_missed_tick_behavior(MissedTickBehavior::Delay);

    let mut rollup_tick = tokio::time::interval(Duration::from_secs(settings.rollup_interval_secs));
    rollup_tick.set_missed_tick_behavior(MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            _ = sync_tick.tick() => {
                match sync_network(
                    &mut horizon,
                    &pool,
                    &mut redis,
                    &settings.network,
                    settings.max_ledgers_per_pass,
                    settings.lock_ttl_secs,
                    Some(&mut rpc),
                ).await {
                    Ok(n) => tracing::info!(network = %settings.network, ledgers = n, "sync pass complete"),
                    Err(e) => tracing::warn!(network = %settings.network, error = %e, "sync pass failed"),
                }
            }
            _ = rollup_tick.tick() => {
                if let Err(e) = rollup_all(&pool, &settings.network, chrono::Utc::now()).await {
                    tracing::warn!(network = %settings.network, error = %e, "rollup pass failed");
                }
                refresh_prices(&pool, settings).await;
            }
        }
    }
}

/// Refresh `token_prices` for the assets currently ranked in `token_volume_stats`.
/// A missing/empty `price_feed_url` or a failing feed is a no-op, never an error.
async fn refresh_prices(pool: &PgPool, settings: &IngestSettings) {
    if settings.price_feed_url.trim().is_empty() {
        return;
    }
    let assets: Vec<String> = match sqlx::query_scalar(
        "SELECT DISTINCT asset FROM token_volume_stats WHERE network = $1",
    )
    .bind(&settings.network)
    .fetch_all(pool)
    .await
    {
        Ok(a) => a,
        Err(e) => {
            tracing::warn!(network = %settings.network, error = %e, "price refresh: no assets to price");
            return;
        }
    };
    if assets.is_empty() {
        return;
    }
    let assets_ref: Vec<&str> = assets.iter().map(String::as_str).collect();
    let feed = HttpPriceFeed::new(settings.price_feed_url.clone());
    match feed.refresh(pool, &settings.network, &assets_ref).await {
        Ok(quotes) => tracing::info!(quoted = quotes.len(), "token prices refreshed"),
        Err(e) => tracing::warn!(network = %settings.network, error = %e, "price refresh skipped"),
    }
}
