//! Network feed materialization: latest transactions and ledgers (newest-first,
//! keyset-paginated) plus the **Redis feed cache** that degrades to Postgres.
//!
//! Cursors are opaque to the client: they encode the last-seen sort key plus a
//! stable id (never an offset), so pages don't shift when new rows arrive.
//! Each feed is cache-only in Redis (DB doc §5.5/§11): a cache hit skips
//! Postgres, a miss falls back to the authoritative query. There is never a
//! write-through — Postgres is the system of record.

use base64::Engine as _;
use chrono::DateTime;
use redis::AsyncCommands;
use redis::aio::MultiplexedConnection;
use serde::Serialize;
use serde_json::{Value, json};
use sqlx::Row;
use sqlx::postgres::{PgPool, PgRow};

/// Allowed page sizes (API doc §Pagination): 20 / 50 / 100.
pub const ALLOWED_LIMITS: &[i64] = &[10, 20, 50, 100];
pub const DEFAULT_LIMIT: i64 = 10;

/// Feed TTLs (DB doc §11): ledgers/transactions refresh fast, rankings slower.
pub const FEED_TTL_SECS: u64 = 10;
pub const RANKINGS_TTL_SECS: u64 = 60;

/// A trailing aggregation window selector.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Window {
    H24,
    H7d,
    H30d,
}

impl Window {
    pub fn as_seconds(self) -> i64 {
        match self {
            Window::H24 => 86_400,
            Window::H7d => 604_800,
            Window::H30d => 2_592_000,
        }
    }

    pub fn parse(raw: &str) -> Option<Window> {
        match raw {
            "24h" => Some(Window::H24),
            "7d" => Some(Window::H7d),
            "30d" => Some(Window::H30d),
            _ => None,
        }
    }
}

/// Clamp `limit` to a supported Explorer page size (`10|20|50|100`).
pub fn clamp_limit(limit: Option<i64>) -> i64 {
    match limit {
        Some(v) if ALLOWED_LIMITS.contains(&v) => v,
        _ => DEFAULT_LIMIT,
    }
}

// ---------------------------------------------------------------------------
// Keyset cursor codec
// ---------------------------------------------------------------------------

/// An opaque cursor: the last-seen `sort` key (epoch-ms timestamp or ledger
/// sequence) plus a stable `tie` that breaks ties so pages never shift when
/// rows share a sort key.
#[derive(Debug, Clone, PartialEq)]
pub struct Cursor {
    pub sort: i64,
    pub tie: String,
}

const CURSOR_PREFIX: &str = "v1";

impl Cursor {
    pub fn new(sort: i64, tie: impl Into<String>) -> Self {
        Self {
            sort,
            tie: tie.into(),
        }
    }

    pub fn encode(&self) -> String {
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(format!("{}.{}", self.sort, self.tie).as_bytes());
        format!("{CURSOR_PREFIX}.{payload}")
    }

    pub fn decode(raw: &str) -> Option<Cursor> {
        let (prefix, payload) = raw.split_once('.')?;
        if prefix != CURSOR_PREFIX {
            return None;
        }
        let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(payload)
            .ok()?;
        let s = std::str::from_utf8(&bytes).ok()?;
        let (sort, tie) = s.split_once('.')?;
        Some(Cursor {
            sort: sort.parse().ok()?,
            tie: tie.to_owned(),
        })
    }
}

// ---------------------------------------------------------------------------
// Pagination envelope
// ---------------------------------------------------------------------------

/// The shared pagination envelope (API doc §Pagination).
#[derive(Debug, Clone, Serialize)]
pub struct Page {
    pub limit: i64,
    pub next_cursor: Option<String>,
    pub prev_cursor: Option<String>,
    pub data: Vec<Value>,
}

/// Direction of travel on a newest-first keyset feed.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Dir {
    Next,
    Prev,
}

/// Build the envelope from rows returned newest-first. `rows` holds at most
/// `limit + 1` items; the sentinel extra row proves another page exists.
/// `navigated` marks that the caller moved off the newest edge (then a
/// `prev_cursor` is meaningful so it can step back toward newer rows).
fn make_page(rows: &[Value], limit: i64, navigated: bool) -> Page {
    let has_more = rows.len() as i64 > limit;
    let shown = rows.get(..limit as usize).unwrap_or(rows);
    let next_cursor = if has_more {
        shown.last().and_then(cursor_of).map(|c| c.encode())
    } else {
        None
    };
    let prev_cursor = if navigated {
        shown.first().and_then(cursor_of).map(|c| c.encode())
    } else {
        None
    };
    Page {
        limit,
        next_cursor,
        prev_cursor,
        data: shown.to_vec(),
    }
}

/// Pull the `_sort`/`_tie` helpers off a feed row to build the next cursor.
fn cursor_of(row: &Value) -> Option<Cursor> {
    let sort = row.get("_sort")?.as_i64()?;
    let tie = row.get("_tie")?.as_str()?.to_owned();
    Some(Cursor { sort, tie })
}

// ---------------------------------------------------------------------------
// Cache keys + Redis feed cache
// ---------------------------------------------------------------------------

pub fn feed_key(network: &str, kind: &str, tail: &str) -> String {
    format!("releeve:feeds:{kind}:{network}{tail}")
}

/// Serve `build()` with a fresh-enough cached copy when present, otherwise
/// compute from Postgres and (only on a miss) populate Redis. A Redis error
/// never fails a request — it costs a query.
pub async fn cached_feed(
    conn: &mut MultiplexedConnection,
    key: &str,
    ttl_secs: u64,
    build: impl Future<Output = Result<Vec<Value>, sqlx::Error>> + Send,
) -> Result<Value, sqlx::Error> {
    let hit: Option<String> = conn.get(key).await.unwrap_or(None);
    if let Some(raw) = hit {
        return Ok(serde_json::from_str(&raw).unwrap_or(json!([])));
    }
    let rows = build.await?;
    let payload = serde_json::to_value(&rows).unwrap_or(json!([]));
    let _: Result<(), _> = conn.set_ex(key, payload.to_string(), ttl_secs).await;
    Ok(payload)
}

// ---------------------------------------------------------------------------
// Feed queries
// ---------------------------------------------------------------------------

/// Latest transactions, newest-first, keyset-paginated on `(timestamp, hash)`.
pub async fn latest_transactions(
    pool: &PgPool,
    network: &str,
    limit: i64,
    cursor: Option<Cursor>,
    dir: Dir,
) -> Result<Page, sqlx::Error> {
    let (sort, tie) = cursor
        .as_ref()
        .map(|c| (Some(c.sort), Some(c.tie.clone())))
        .unwrap_or((None, None));
    let (predicate, navigated) = match (sort.as_ref(), tie.as_ref(), dir) {
        (Some(_), Some(_), Dir::Next) => ("AND (timestamp, hash) < ($3, $4)".to_owned(), true),
        (Some(_), Some(_), Dir::Prev) => ("AND (timestamp, hash) > ($3, $4)".to_owned(), true),
        _ => (String::new(), false),
    };

    let q = format!(
        r#"
        SELECT to_jsonb(t.*) || jsonb_build_object(
            '_sort', (extract(epoch from t.timestamp)::bigint * 1000),
            '_tie', t.hash,
            'destination_account', COALESCE((
                SELECT e.to_address
                FROM tx_fund_flow_edges e
                WHERE e.tx_hash = t.hash
                ORDER BY e.sequence, e.id
                LIMIT 1
            ), (
                SELECT c.contract_id
                FROM tx_call_tree_nodes c
                WHERE c.tx_hash = t.hash
                ORDER BY c.sequence, c.id
                LIMIT 1
            ), t.operation_target_address),
            'affected_account', CASE WHEN t.operation_type IN (
                'manage_data', 'set_options', 'manage_sell_offer', 'manage_buy_offer',
                'change_trust', 'allow_trust', 'bump_sequence',
                'begin_sponsoring_future_reserves', 'end_sponsoring_future_reserves',
                'revoke_sponsorship', 'set_trust_line_flags', 'multi_operation'
            ) THEN t.source_account ELSE NULL END,
            'target_kind', CASE
                WHEN EXISTS (SELECT 1 FROM tx_fund_flow_edges e WHERE e.tx_hash = t.hash) THEN 'transfer'
                WHEN EXISTS (SELECT 1 FROM tx_call_tree_nodes c WHERE c.tx_hash = t.hash) THEN 'contract'
                WHEN t.operation_target_address IS NOT NULL THEN COALESCE(t.operation_target_kind, 'entity')
                WHEN t.operation_type IN (
                    'manage_data', 'set_options', 'manage_sell_offer', 'manage_buy_offer',
                    'change_trust', 'allow_trust', 'bump_sequence',
                    'begin_sponsoring_future_reserves', 'end_sponsoring_future_reserves',
                    'revoke_sponsorship', 'set_trust_line_flags', 'multi_operation'
                ) THEN 'account_effect' ELSE 'none' END,
            'amount', (
                SELECT e.amount::text
                FROM tx_fund_flow_edges e
                WHERE e.tx_hash = t.hash
                ORDER BY e.sequence, e.id
                LIMIT 1
            ),
            'asset', (
                SELECT e.asset
                FROM tx_fund_flow_edges e
                WHERE e.tx_hash = t.hash
                ORDER BY e.sequence, e.id
                LIMIT 1
            )
        ) AS json
        FROM transactions t
        WHERE network = $1 {predicate}
        ORDER BY timestamp DESC, hash DESC
        LIMIT $2
        "#
    );

    let mut b = sqlx::query(&q).bind(network).bind(limit + 1);
    if let (Some(s), Some(t)) = (sort, tie) {
        let ts = DateTime::from_timestamp_millis(s)
            .unwrap_or_else(|| DateTime::from_timestamp(0, 0).unwrap());
        b = b.bind(ts).bind(t);
    }
    let rows = b.fetch_all(pool).await?;
    let rows: Vec<Value> = rows.iter().map(row_json).collect();
    Ok(make_page(&rows, limit, navigated))
}

/// Latest ledgers, newest-first by sequence, keyset-paginated.
pub async fn latest_ledgers(
    pool: &PgPool,
    network: &str,
    limit: i64,
    cursor: Option<Cursor>,
    dir: Dir,
) -> Result<Page, sqlx::Error> {
    let (predicate, navigated) = match (cursor.as_ref(), dir) {
        (Some(c), Dir::Next) => (format!("AND sequence < {}", c.sort), true),
        (Some(c), Dir::Prev) => (format!("AND sequence > {}", c.sort), true),
        _ => (String::new(), false),
    };
    let q = format!(
        r#"
        SELECT jsonb_build_object(
            'sequence', sequence, 'hash', hash, 'parent_hash', parent_hash,
            'transaction_count', transaction_count, 'timestamp', timestamp,
            '_sort', sequence, '_tie', hash
        ) AS json
        FROM ledgers
        WHERE network = $1 {predicate}
        ORDER BY sequence DESC
        LIMIT $2
        "#
    );
    let rows = sqlx::query(&q)
        .bind(network)
        .bind(limit + 1)
        .fetch_all(pool)
        .await?;
    let rows: Vec<Value> = rows.iter().map(row_json).collect();
    Ok(make_page(&rows, limit, navigated))
}

fn row_json(r: &PgRow) -> Value {
    r.try_get::<Value, _>("json").unwrap_or(Value::Null)
}

/// Top tokens by rolling volume for a window, ordered by `volume` descending,
/// keyset-paginated on `(volume, asset)`.
pub async fn top_tokens(
    pool: &PgPool,
    network: &str,
    window: Window,
    limit: i64,
    cursor: Option<Cursor>,
) -> Result<Page, sqlx::Error> {
    let predicate = if cursor.is_some() {
        "AND (volume, asset) < ($3::numeric, $4)".to_owned()
    } else {
        String::new()
    };
    let limit_slot = if cursor.is_some() { "$5" } else { "$3" };
    let q = format!(
        r#"
        SELECT jsonb_build_object(
            'asset', asset, 'volume', volume, 'usd_volume', usd_volume,
            'tx_count', tx_count, 'active_accounts', active_accounts,
            '_sort', volume, '_tie', asset
        ) AS json
        FROM token_volume_stats
        WHERE network = $1
          AND window_seconds = $2
          AND window_start = (
              SELECT max(window_start) FROM token_volume_stats
              WHERE network = $1 AND window_seconds = $2
          )
          {predicate}
        ORDER BY volume DESC, asset DESC
        LIMIT {limit_slot}
        "#
    );
    let mut b = sqlx::query(&q).bind(network).bind(window.as_seconds());
    if let Some(c) = &cursor {
        b = b.bind(c.sort).bind(&c.tie);
    }
    let rows = b.bind(limit + 1).fetch_all(pool).await?;
    let rows: Vec<Value> = rows.iter().map(row_json).collect();
    Ok(make_page(&rows, limit, cursor.is_some()))
}

/// Token-transfer feed: fund-flow edges (joined to their transactions) filtered
/// by an optional `asset` and a trailing `window`, newest-first, keyset-paginated.
pub async fn transfers(
    pool: &PgPool,
    network: &str,
    asset: Option<&str>,
    window: Window,
    limit: i64,
    cursor: Option<Cursor>,
) -> Result<Page, sqlx::Error> {
    // Placeholder slots are assigned dynamically so the SQL and the bind order
    // always line up no matter which filters are present.
    let mut sql = String::from(
        r#"
        SELECT jsonb_build_object(
            'tx_hash', e.tx_hash, 'from_address', e.from_address,
            'to_address', e.to_address, 'asset', e.asset, 'amount', e.amount,
            'timestamp', t.timestamp,
            '_sort', (extract(epoch from t.timestamp)::bigint * 1000), '_tie', e.id::text
        ) AS json
        FROM tx_fund_flow_edges e
        JOIN transactions t ON t.hash = e.tx_hash
        WHERE t.network = $1
          AND t.timestamp >= now() - ($2::bigint * interval '1 second')
        "#,
    );
    let mut next: i32 = 3;
    if asset.is_some() {
        sql.push_str(&format!(" AND e.asset = ${next}"));
        next += 1;
    }
    if cursor.is_some() {
        sql.push_str(&format!(
            " AND (extract(epoch from t.timestamp)::bigint * 1000, e.id::text) < (${next}, ${})",
            next + 1
        ));
        next += 2;
    }
    sql.push_str(&format!(
        " ORDER BY t.timestamp DESC, e.id DESC LIMIT ${next}"
    ));

    let navigated = cursor.is_some();
    let mut b = sqlx::query(&sql).bind(network).bind(window.as_seconds());
    if let Some(a) = asset {
        b = b.bind(a);
    }
    if let Some(c) = cursor {
        b = b.bind(c.sort).bind(c.tie);
    }
    let rows = b.bind(limit + 1).fetch_all(pool).await?;
    let rows: Vec<Value> = rows.iter().map(row_json).collect();
    Ok(make_page(&rows, limit, navigated))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_limit_maps_to_allowed() {
        assert_eq!(clamp_limit(None), 10);
        assert_eq!(clamp_limit(Some(10)), 10);
        assert_eq!(clamp_limit(Some(50)), 50);
        assert_eq!(clamp_limit(Some(100)), 100);
        assert_eq!(clamp_limit(Some(7)), 10);
        assert_eq!(clamp_limit(Some(300)), 10);
    }

    #[test]
    fn window_parses_and_scales() {
        assert_eq!(Window::parse("24h"), Some(Window::H24));
        assert_eq!(Window::parse("7d"), Some(Window::H7d));
        assert_eq!(Window::parse("30d"), Some(Window::H30d));
        assert_eq!(Window::parse("1w"), None);
        assert_eq!(Window::H7d.as_seconds(), 604_800);
    }

    #[test]
    fn cursor_roundtrips_and_rejects_garbage() {
        let c = Cursor::new(1_728_000_000_000, "some-hash".to_string());
        let tok = c.encode();
        assert_eq!(Cursor::decode(&tok), Some(c));
        assert_eq!(Cursor::decode("nope"), None);
        assert_eq!(Cursor::decode("v2.Zm9v"), None);
    }

    #[test]
    fn first_page_exposes_no_prev() {
        let rows: Vec<Value> = (0..3)
            .map(|i| json!({ "_sort": i, "_tie": format!("h{i}") }))
            .collect();
        let p = make_page(&rows, 3, false);
        assert_eq!(p.data.len(), 3);
        assert!(p.next_cursor.is_none());
        assert!(p.prev_cursor.is_none());
    }

    #[test]
    fn more_rows_signal_next_and_navigated_signals_prev() {
        let rows: Vec<Value> = (0..4)
            .map(|i| json!({ "_sort": 9 - i, "_tie": format!("h{i}") }))
            .collect();
        let p = make_page(&rows, 3, true);
        assert_eq!(p.data.len(), 3);
        assert!(p.next_cursor.is_some(), "sentinel row → more remains");
        assert!(p.prev_cursor.is_some(), "navigated → can step back");

        let nxt = Cursor::decode(&p.next_cursor.unwrap()).unwrap();
        assert_eq!(nxt.sort, rows[2]["_sort"].as_i64().unwrap());
    }
}
