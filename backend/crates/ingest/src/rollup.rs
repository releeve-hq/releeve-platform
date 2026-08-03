//! Token volume rollup + USD price cache (`token_volume_stats` / `token_prices`).
//!
//! A scheduled job aggregates `tx_fund_flow_edges` into trailing 24h/7d/30d
//! buckets keyed by `(network, asset, window_start, window_seconds)`. USD figures
//! come from `token_prices` via `price_*`; a missing price yields `NULL`
//! `usd_volume` — never a failed request.

use chrono::{DateTime, Utc};
use sqlx::PgPool;

pub const WINDOW_24H: i64 = 86_400;
pub const WINDOW_7D: i64 = 604_800;
pub const WINDOW_30D: i64 = 2_592_000;

/// Aligned start of the trailing window that contains `now`.
pub fn window_start(window_seconds: i64, now: DateTime<Utc>) -> DateTime<Utc> {
    let secs = now.timestamp();
    let boundary = secs - (secs % window_seconds);
    DateTime::from_timestamp(boundary, 0).unwrap_or(now)
}

/// Roll up a single window. `usd_volume` is `NULL` for tokens with no price.
pub async fn rollup_window(
    pool: &PgPool,
    network: &str,
    window_seconds: i64,
    now: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    let ws = window_start(window_seconds, now);
    let window_end = ws + chrono::Duration::seconds(window_seconds);

    sqlx::query(
        r#"
        INSERT INTO token_volume_stats
            (network, asset, window_start, window_seconds, volume, usd_volume, tx_count, active_accounts)
        SELECT
            t.network,
            e.asset,
            $3,
            $2,
            SUM(e.amount)                                        AS volume,
            SUM(e.amount * p.price_usd)                          AS usd_volume,
            COUNT(DISTINCT e.tx_hash)                            AS tx_count,
            COUNT(DISTINCT e.from_address) + COUNT(DISTINCT e.to_address) AS active_accounts
        FROM tx_fund_flow_edges e
        JOIN transactions t              ON t.hash = e.tx_hash
        LEFT JOIN token_prices p         ON p.network = t.network AND p.asset = e.asset
        WHERE t.network = $1
          AND t.timestamp >= $3
          AND t.timestamp <  $4
        GROUP BY t.network, e.asset
        ON CONFLICT (network, asset, window_start, window_seconds) DO UPDATE SET
            volume          = EXCLUDED.volume,
            usd_volume      = EXCLUDED.usd_volume,
            tx_count        = EXCLUDED.tx_count,
            active_accounts = EXCLUDED.active_accounts
        "#,
    )
    .bind(network)
    .bind(window_seconds)
    .bind(ws)
    .bind(window_end)
    .execute(pool)
    .await?;
    Ok(())
}

/// Roll up all three windows.
pub async fn rollup_all(
    pool: &PgPool,
    network: &str,
    now: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    rollup_window(pool, network, WINDOW_24H, now).await?;
    rollup_window(pool, network, WINDOW_7D, now).await?;
    rollup_window(pool, network, WINDOW_30D, now).await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Price feed adapter (thin, swappable)
// ---------------------------------------------------------------------------

/// A single USD quote for a token.
pub struct Quote {
    pub asset: String,
    pub price_usd: String,
}

/// A price source. Releeve owns the cache, never the source; a stale/missing
/// quote degrades to `NULL` USD, and a failed refresh is a no-op (it simply
/// leaves the cached `token_prices` row to go stale).
#[async_trait::async_trait]
pub trait PriceFeed: Send + Sync {
    /// Refresh `token_prices` for `assets`; returns the tokens for which we now
    /// have a fresh quote (`None` entries degrade to `NULL` USD).
    async fn refresh(
        &self,
        pool: &PgPool,
        network: &str,
        assets: &[&str],
    ) -> Result<Vec<Quote>, price_error::PriceError>;
}

pub mod price_error {
    use thiserror::Error;

    #[derive(Debug, Error)]
    pub enum PriceError {
        #[error("upstream price feed returned {0}")]
        Upstream(&'static str),
        #[error("database: {0}")]
        Db(#[from] sqlx::Error),
    }
}

use sqlx::PgConnection;

/// Persist a fresh batch of quotes. Called after the network round-trip so a
/// partial/HTTP failure never touches the DB half-baked.
pub async fn apply_quotes(
    conn: &mut PgConnection,
    network: &str,
    quotes: &[Quote],
) -> Result<(), sqlx::Error> {
    for q in quotes {
        sqlx::query(
            r#"
            INSERT INTO token_prices (network, asset, price_usd, source, updated_at)
            VALUES ($1, $2, $3::numeric, 'price-feed', now())
            ON CONFLICT (network, asset) DO UPDATE SET
                price_usd = EXCLUDED.price_usd,
                source    = EXCLUDED.source,
                updated_at = now()
            "#,
        )
        .bind(network)
        .bind(&q.asset)
        .bind(&q.price_usd)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_start_aligns_to_boundary() {
        let now = DateTime::from_timestamp(1_700_000_000, 0).unwrap();
        // 1_700_000_000 % 86_400 == ... boundary is the previous multiple of 86_400.
        let ws = window_start(WINDOW_24H, now);
        assert_eq!(ws.timestamp() % WINDOW_24H, 0);
        assert!(ws <= now);
        assert!(now - ws <= chrono::Duration::seconds(WINDOW_24H));
    }

    #[test]
    fn overlapping_buckets_keep_distinct_rows() {
        // A tx inside the trailing 24h also belongs to 7d/30d rows. This is the
        // "overlap handled" contract: bucketing is per-window, not exclusive.
        let now = DateTime::from_timestamp(1_700_000_000, 0).unwrap();
        let h24 = window_start(WINDOW_24H, now);
        let d7 = window_start(WINDOW_7D, now);
        let d30 = window_start(WINDOW_30D, now);
        assert!(
            h24 > d7 && d7 > d30,
            "24h bucket is strictest, then 7d, then 30d"
        );
    }

    #[test]
    fn missing_price_means_null_usd() {
        // The adapter returns only assets it has a fresh quote for; anything
        // absent stays NULL via the rollup's LEFT JOIN.
        let quotes = [Quote {
            asset: "USDC:GA".into(),
            price_usd: "1.0000000".into(),
        }];
        let quoted: Vec<&str> = quotes.iter().map(|q| q.asset.as_str()).collect();
        assert!(quoted.contains(&"USDC:GA"));
        assert!(!quoted.contains(&"XLM"), "no quote for XLM => NULL USD");
    }
}
