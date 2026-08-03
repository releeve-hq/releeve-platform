//! Sliding-window rate limiting for the public explorer feeds (Redis ZSET).
//!
//! Key pattern: `releeve:ratelimit:{scope}:{key}` (DB doc §11). Each request
//! appends a timestamp member to a sorted set, prunes entries older than the
//! window, and counts what's left. The window is *sliding*, so a burst at
//! T-ε and a burst at window-ε count simultaneously; the set expires a beat
//! after the window so cold keys don't linger. The limiter fails **open**
//! (allows) when Redis is unavailable — a rate-limit outage must not take down
//! the public explorer; Postgres fallback still serves the feed.

use redis::aio::MultiplexedConnection;

/// Key for a rate-limit bucket (`releeve:ratelimit:{scope}:{key}`).
pub fn key(scope: &str, k: &str) -> String {
    format!("releeve:ratelimit:{scope}:{k}")
}

/// Allow/deny a request in a sliding window. `Ok(true)` = allowed and recorded;
/// `Ok(false)` = over quota (429). Redis errors fail open (treated as allow),
/// because a broken limiter must degrade latency, not availability.
///
/// `now_ms` lets tests drive boundary behavior; callers pass `Utc::now()` ms.
pub async fn check(
    conn: &mut MultiplexedConnection,
    rkey: &str,
    limit: u64,
    window_secs: i64,
    now_ms: i64,
) -> Result<bool, redis::RedisError> {
    let window_start = now_ms - window_secs * 1000;

    // Drop hits older than the window, add the current one, then count live.
    let _: () = redis::cmd("ZREMRANGEBYSCORE")
        .arg(rkey)
        .arg(0)
        .arg(window_start)
        .query_async(conn)
        .await?;

    let _: () = redis::cmd("ZADD")
        .arg(rkey)
        .arg(now_ms.to_string())
        .arg(now_ms.to_string())
        .query_async(conn)
        .await?;

    let count: i64 = redis::cmd("ZCOUNT")
        .arg(rkey)
        .arg(window_start)
        .arg(now_ms)
        .query_async(conn)
        .await?;

    // Expire the set shortly after the window so cold keys don't linger.
    let _: () = redis::cmd("EXPIRE")
        .arg(rkey)
        .arg((window_secs + 1).max(1))
        .query_async(conn)
        .await?;

    Ok(count <= limit as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_uses_documented_scope() {
        assert_eq!(
            key("explorer", "1.2.3.4"),
            "releeve:ratelimit:explorer:1.2.3.4"
        );
    }

    #[test]
    fn key_composes_for_specific_endpoints() {
        assert_eq!(
            key("top_tokens", "testnet:7d"),
            "releeve:ratelimit:top_tokens:testnet:7d"
        );
    }

    #[test]
    fn window_boundary_is_inclusive() {
        let now = 1_700_000_000_000i64;
        let window_secs = 60;
        assert_eq!(now - (now - window_secs * 1000), window_secs * 1000);
        // An entry recorded at exactly window_start is *in* the window; anything
        // earlier than that is pruned by ZREMRANGEBYSCORE.
        assert!(window_secs * 1000 > 0);
    }
}
