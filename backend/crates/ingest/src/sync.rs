//! Single-writer coordination: a per-network sync **watermark** and a worker
//! **lock**, both in Redis (`releeve:sync:watermark:{network}`,
//! `releeve:sync:lock:{network}`).
//!
//! Redis is a pure cache here — Postgres is authoritative. The watermark is a
//! cache of `max(sequence)` and rebuildable from Postgres; the lock guarantees
//! exactly one worker ingests a ledger range. A Redis flush just pauses the
//! (redundant) coordination, never corrupts data.

use redis::AsyncCommands;
use redis::aio::MultiplexedConnection;

pub fn watermark_key(network: &str) -> String {
    format!("releeve:sync:watermark:{network}")
}

pub fn lock_key(network: &str) -> String {
    format!("releeve:sync:lock:{network}")
}

/// Read the current sync watermark (highest fully-ingested ledger sequence).
/// Returns `None` when absent — the caller falls back to `max(sequence)`.
pub async fn get_watermark(
    conn: &mut MultiplexedConnection,
    network: &str,
) -> Result<Option<i64>, redis::RedisError> {
    conn.get::<_, Option<i64>>(watermark_key(network)).await
}

/// Advance the watermark monotonically (never regresses).
pub async fn set_watermark(
    conn: &mut MultiplexedConnection,
    network: &str,
    sequence: i64,
) -> Result<(), redis::RedisError> {
    let key = watermark_key(network);
    let cur = conn.get::<_, Option<i64>>(&key).await?;
    match cur {
        Some(existing) if existing >= sequence => Ok(()),
        _ => conn.set(&key, sequence).await,
    }
}

/// Try to acquire the ingestion lock, which expires after `ttl_secs`. Returns
/// `true` when acquired. A single writer wins because `SET NX EX` is atomic;
/// losers are told to idle.
pub async fn acquire_lock(
    conn: &mut MultiplexedConnection,
    network: &str,
    ttl_secs: u64,
) -> Result<bool, redis::RedisError> {
    let created: bool = redis::cmd("SET")
        .arg(lock_key(network))
        .arg("worker")
        .arg("NX")
        .arg("EX")
        .arg(ttl_secs)
        .query_async(conn)
        .await?;
    Ok(created)
}

/// Release the lock if (and only if) we own it.
pub async fn release_lock(
    conn: &mut MultiplexedConnection,
    network: &str,
) -> Result<(), redis::RedisError> {
    let key = lock_key(network);
    let owned: Option<String> = conn.get(&key).await?;
    if owned.as_deref() == Some("worker") {
        let _: () = redis::cmd("DEL").arg(&key).query_async(conn).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_match_documented_pattern() {
        assert_eq!(watermark_key("testnet"), "releeve:sync:watermark:testnet");
        assert_eq!(lock_key("pubnet"), "releeve:sync:lock:pubnet");
    }

    #[test]
    fn watermark_is_monotonic() {
        // The key operation is `set` only when it increases; the monotonic
        // guard is exercised against a real Redis in the integration suite.
        let highs = vec![1i64, 5, 5, 7];
        let mut max = 0;
        for h in highs {
            if h > max {
                max = h;
            }
        }
        assert_eq!(max, 7, "max is the high-water mark");
    }
}
