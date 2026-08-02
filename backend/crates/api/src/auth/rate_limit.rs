//! Minimal Redis-based sliding-window rate limiter for sensitive endpoints
//! (e.g. resend-verification cooldown). Best-effort: if Redis is down the
//! limiter fails open (the canonical security controls still apply).

use shared::Error;

use crate::state::AppState;

/// Return `Ok(true)` if `key` is within cooldown (should be blocked).
/// Otherwise allow and record a new attempt window.
pub async fn check_and_record(
    state: &AppState,
    key: &str,
    cooldown_seconds: i64,
) -> Result<bool, Error> {
    let mut conn = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .map_err(Error::internal)?;

    // `SET key 1 EX cooldown NX` — atomically sets only if the key is absent.
    let existed: bool = redis::cmd("SET")
        .arg(key)
        .arg("1")
        .arg("EX")
        .arg(cooldown_seconds)
        .arg("NX")
        .query_async(&mut conn)
        .await
        .map_err(Error::internal)?;
    Ok(!existed)
}
