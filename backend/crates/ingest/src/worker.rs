//! Ingestion worker orchestrator.
//!
//! Drives one network's sync: acquire the single-writer lock, read the
//! watermark (fallback to `max(sequence)`), pull ledgers and their classic
//! transactions from Horizon with backoff/circuit-breaker politeness, persist
//! idempotently, and advance the watermark. Because `state::upsert_*` is keyed
//! on `sequence`/`hash` primary keys, re-running over a range is a no-op.

use redis::aio::MultiplexedConnection;
use serde_json::Value;
use shared::Error;
use sqlx::PgPool;

use crate::decode::{decode_classic_tx, decode_ledger};
use crate::state::{upsert_ledger, upsert_tx};
use crate::sync::{acquire_lock, get_watermark, set_watermark};
use crate::upstream::{Backoff, CircuitBreaker, FetchError, Reachable, fetch_with_policy};

pub type WorkerResult<T> = Result<T, Error>;

/// A Horizon HTTP client with upstream politeness (per-network circuit breaker).
pub struct HorizonClient {
    http: reqwest::Client,
    base: String,
    breaker: CircuitBreaker,
    backoff: Backoff,
}

const PAGE_SIZE: &str = "20";

impl HorizonClient {
    pub fn new(base: impl Into<String>, backoff: Backoff, breaker: CircuitBreaker) -> Self {
        Self {
            http: reqwest::Client::new(),
            base: base.into(),
            breaker,
            backoff,
        }
    }

    /// GET a Horizon path as JSON, with retry/backoff and the circuit breaker.
    async fn get_json(&mut self, path: &str) -> Result<Value, FetchError> {
        let http = self.http.clone();
        let url = format!("{}{}", self.base, path);
        fetch_with_policy(&mut self.breaker, &self.backoff, move || {
            let http = http.clone();
            let url = url.clone();
            async move {
                match http.get(&url).send().await {
                    Ok(resp) if resp.status().is_success() => match resp.json::<Value>().await {
                        Ok(v) => Reachable::Success(v),
                        Err(_) => Reachable::Retryable,
                    },
                    Ok(resp) if resp.status().is_client_error() => Reachable::NonRetryable,
                    // 5xx / network / timeout: transient.
                    Ok(_) | Err(_) => Reachable::Retryable,
                }
            }
        })
        .await
    }

    /// A page of ledgers ascending from `cursor`.
    pub async fn fetch_ledgers(&mut self, cursor: Option<&str>) -> Result<Vec<Value>, FetchError> {
        let path = match cursor {
            Some(c) => format!("/ledgers?order=asc&limit={PAGE_SIZE}&cursor={c}"),
            None => format!("/ledgers?order=asc&limit={PAGE_SIZE}"),
        };
        let body = self.get_json(&path).await?;
        Ok(records(&body))
    }

    /// The classic transactions embedded in a ledger.
    pub async fn fetch_transactions(&mut self, seq: i64) -> Result<Vec<Value>, FetchError> {
        let body = self
            .get_json(&format!("/ledgers/{seq}/transactions"))
            .await?;
        Ok(records(&body))
    }
}

/// Extract Horizon HAL `_embedded.records`.
fn records(v: &Value) -> Vec<Value> {
    v["_embedded"]["records"]
        .as_array()
        .cloned()
        .unwrap_or_default()
}

/// The last ledger's `paging_token`, used to page forward.
fn paging_token(v: &Value) -> Option<String> {
    v.get("paging_token")
        .and_then(Value::as_str)
        .map(String::from)
}

async fn max_sequence(pool: &PgPool, network: &str) -> Result<Option<i64>, sqlx::Error> {
    let row: Option<i64> = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT max(sequence) FROM ledgers WHERE network = $1",
    )
    .bind(network)
    .fetch_one(pool)
    .await?;
    Ok(row)
}

fn internal<E>(e: E) -> Error
where
    E: std::error::Error + Send + Sync + 'static,
{
    Error::internal(e)
}

/// Runs up to `max_ledgers` of forward sync for one network. Returns the number
/// of ledgers ingested this pass. Idempotent across restarts; a locked network
/// (another worker active) yields `0` without touching Postgres.
pub async fn sync_network(
    client: &mut HorizonClient,
    pool: &PgPool,
    redis: &mut MultiplexedConnection,
    network: &str,
    max_ledgers: u64,
    ttl_secs: u64,
) -> WorkerResult<u64> {
    // Exactly one writer owns this network.
    if !acquire_lock(redis, network, ttl_secs)
        .await
        .map_err(internal)?
    {
        return Ok(0);
    }

    // Start right after the watermark, or after the persisted max.
    let start = match get_watermark(redis, network).await.map_err(internal)? {
        Some(seq) => seq + 1,
        None => match max_sequence(pool, network).await.map_err(internal)? {
            Some(seq) => seq + 1,
            None => 1,
        },
    };

    let mut ingested = 0u64;
    let mut cursor: Option<String> = None;

    while ingested < max_ledgers {
        let ledgers = match client.fetch_ledgers(cursor.as_deref()).await {
            Ok(l) => l,
            Err(FetchError::CircuitOpen) | Err(FetchError::Exhausted) => {
                // Upstream down for this network — pause it; others unaffected.
                return Ok(ingested);
            }
            Err(FetchError::NonRetryable) => break,
        };
        if ledgers.is_empty() {
            break;
        }

        for lv in &ledgers {
            let seq = lv.get("sequence").and_then(Value::as_i64).unwrap_or(0);
            if seq < start {
                continue;
            }
            let ledger = decode_ledger(lv, network).map_err(Error::internal)?;
            upsert_ledger(pool, &ledger).await.map_err(internal)?;

            match client.fetch_transactions(ledger.sequence).await {
                Ok(txs) => {
                    for tv in txs {
                        if let Ok(tx) = decode_classic_tx(&tv, network) {
                            upsert_tx(pool, &tx).await.map_err(internal)?;
                        }
                    }
                }
                Err(FetchError::CircuitOpen) | Err(FetchError::Exhausted) => {
                    return Ok(ingested);
                }
                Err(FetchError::NonRetryable) => {}
            }

            set_watermark(redis, network, ledger.sequence)
                .await
                .map_err(internal)?;
            ingested += 1;
        }

        match ledgers.iter().rev().find_map(paging_token) {
            Some(t) => cursor = Some(t),
            None => break,
        }
    }

    Ok(ingested)
}
