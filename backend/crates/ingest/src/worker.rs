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

use crate::decode::{
    decode_classic_tx, decode_invoke_detail, decode_ledger, decode_ledger_entries,
    is_soroban_invocation,
};
use crate::rpc::SorobanRpcClient;
use crate::state::{upsert_ledger, upsert_snapshots, upsert_tx};
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

    /// The current network head. This is deliberately a tiny request used to
    /// decide whether a newly started low-cost indexer should tail recent
    /// activity rather than replay an archival-sized backlog.
    pub async fn fetch_latest_ledger(&mut self) -> Result<Option<Value>, FetchError> {
        let body = self.get_json("/ledgers?order=desc&limit=1").await?;
        Ok(records(&body).into_iter().next())
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

/// Horizon ledger paging tokens are the ledger sequence shifted left by 32
/// bits. Persisting a sequence is useful for database queries, but feeding it
/// back as a raw cursor makes Horizon start near genesis and forces every sync
/// pass to scan past already-indexed pages. Derive the opaque cursor here so a
/// resumed daemon asks directly for the ledger after its watermark.
fn cursor_after_ledger(sequence: i64) -> Option<String> {
    let sequence = u64::try_from(sequence).ok()?;
    sequence.checked_shl(32).map(|token| token.to_string())
}

fn tail_start(start: i64, head: Option<i64>, max_ledgers: u64) -> i64 {
    let Some(head) = head else { return start };
    let window = i64::try_from(max_ledgers).unwrap_or(i64::MAX).max(1);
    if head.saturating_sub(start) >= window {
        head.saturating_sub(window - 1).max(1)
    } else {
        start
    }
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
///
/// `rpc` is optional: when present, Soroban invocations are enriched with the
/// invocation detail (`getTransaction` → events/resource metrics); when absent
/// (or on RPC failure) they fall back to the classic decode, so a down RPC
/// never drops a row that Horizon already returned.
pub async fn sync_network(
    client: &mut HorizonClient,
    pool: &PgPool,
    redis: &mut MultiplexedConnection,
    network: &str,
    max_ledgers: u64,
    ttl_secs: u64,
    mut rpc: Option<&mut SorobanRpcClient>,
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

    let head = match client.fetch_latest_ledger().await {
        Ok(Some(ledger)) => ledger.get("sequence").and_then(Value::as_i64),
        Ok(None)
        | Err(FetchError::CircuitOpen)
        | Err(FetchError::Exhausted)
        | Err(FetchError::NonRetryable) => None,
    };
    let start = tail_start(start, head, max_ledgers);
    let mut ingested = 0u64;
    let mut cursor = start.checked_sub(1).and_then(cursor_after_ledger);

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
                        if is_soroban_invocation(&tv) {
                            enrich_soroban(pool, rpc.as_deref_mut(), network, &tv).await?;
                        } else if let Ok(tx) = decode_classic_tx(&tv, network) {
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

#[cfg(test)]
mod cursor_tests {
    use super::cursor_after_ledger;

    #[test]
    fn derives_horizon_ledger_paging_cursor() {
        assert_eq!(cursor_after_ledger(128).as_deref(), Some("549755813888"));
        assert_eq!(cursor_after_ledger(0).as_deref(), Some("0"));
        assert_eq!(cursor_after_ledger(-1), None);
    }

    #[test]
    fn large_backlog_starts_from_a_bounded_recent_tail() {
        assert_eq!(super::tail_start(248, Some(4_034_915), 50), 4_034_866);
        assert_eq!(super::tail_start(4_034_900, Some(4_034_915), 50), 4_034_900);
        assert_eq!(super::tail_start(1, None, 50), 1);
    }
}

/// Persist a Soroban invocation. With an RPC client the full invocation detail
/// is fetched and decoded; without one (or when RPC is down / the hash is
/// unknown to the node) the classic decode of the Horizon record is persisted,
/// so the row is never lost.
async fn enrich_soroban(
    pool: &PgPool,
    rpc: Option<&mut SorobanRpcClient>,
    network: &str,
    tv: &Value,
) -> WorkerResult<()> {
    let Some(rpc) = rpc else {
        if let Ok(tx) = decode_classic_tx(tv, network) {
            upsert_tx(pool, &tx).await.map_err(internal)?;
        }
        return Ok(());
    };

    let hash = tv.get("hash").and_then(Value::as_str).unwrap_or("");
    // The enriched row is authoritative when RPC returns decodable detail; the
    // classic row is only the fallback when that path can't produce one
    // (protocol drift, RPC down, or hash unknown to the node).
    let enriched = match rpc.get_transaction(hash).await {
        Ok(detail) => decode_invoke_detail(&detail, network).ok(),
        Err(_) => None,
    };
    match enriched {
        Some(tx) => {
            upsert_tx(pool, &tx).await.map_err(internal)?;
        }
        None => {
            if let Ok(tx) = decode_classic_tx(tv, network) {
                upsert_tx(pool, &tx).await.map_err(internal)?;
            }
        }
    }
    Ok(())
}

/// Capture live ledger entries for the requested keys via RPC
/// `getLedgerEntries` and persist them as entity snapshots (idempotent by
/// `(network, entry_key)`). Used for the fork-core baseline and lazy profile
/// enrichment. Returns the number of snapshots persisted.
///
/// **Guard:** this is the *only* producer of `entity_snapshots`. It accepts
/// explicit keys — it never enumerates ledgers or transactions, so block/tx
/// discovery stays on Horizon/`getTransaction`.
pub async fn snapshot_entities(
    rpc: &mut SorobanRpcClient,
    pool: &PgPool,
    network: &str,
    keys: &[&str],
) -> WorkerResult<usize> {
    let raw = match rpc.get_ledger_entries(keys).await {
        Ok(raw) => raw,
        Err(FetchError::CircuitOpen) | Err(FetchError::Exhausted) => return Ok(0),
        Err(FetchError::NonRetryable) => return Ok(0),
    };
    let snapshots = decode_ledger_entries(&raw, network).map_err(Error::internal)?;
    upsert_snapshots(pool, network, None, &snapshots)
        .await
        .map_err(internal)
}
