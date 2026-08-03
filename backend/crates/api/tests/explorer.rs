//! Public explorer feed endpoints — e2e over the real router with real
//! Postgres + Redis (Phase 2 §5.5). Data is seeded through the ingest
//! persistence layer so the assertions exercise the same rows a worker writes:
//! newest-first ordering, keyset cursors, asset/window filters, the 429 burst,
//! and the fail-open behavior when Redis is down.

mod common;

use std::collections::HashSet;

use axum::http::{Method, StatusCode};
use chrono::{TimeZone, Utc};
use ingest::feeds::Cursor;
use ingest::models::{FundFlowEdge, LedgerRecord, TxRecord, TxStatus};
use ingest::state::{upsert_ledger, upsert_tx};
use sqlx::PgPool;

use common::{TestApp, req};

fn ledger(seq: i64, network: &str) -> LedgerRecord {
    LedgerRecord {
        sequence: seq,
        network: network.to_string(),
        hash: format!("ledger-{seq}"),
        parent_hash: if seq > 100 {
            Some(format!("ledger-{}", seq - 1))
        } else {
            None
        },
        transaction_count: 1,
        size_bytes: 512,
        timestamp: Utc.timestamp_opt(1_700_000_000, 0).unwrap(),
        base_operation_fee: Some("100".into()),
        base_reserve: Some("5000000".into()),
        total_cpu_instructions: None,
        resource_limit: None,
    }
}

fn tx(
    hash: &str,
    seq: i64,
    ts: chrono::DateTime<Utc>,
    network: &str,
    edge: Option<FundFlowEdge>,
) -> TxRecord {
    TxRecord {
        hash: hash.to_string(),
        network: network.to_string(),
        ledger_sequence: seq,
        status: TxStatus::Success,
        source_account: "GALICE".into(),
        operation_type: "payment".into(),
        fee_charged: Some("150".into()),
        sequence_number: None,
        application_order: 1,
        timestamp: ts,
        metrics: Default::default(),
        call_tree: Vec::new(),
        state_changes: Vec::new(),
        events: Vec::new(),
        fund_flow: edge.into_iter().collect(),
        raw_result_meta_xdr: None,
        raw_envelope_xdr: None,
    }
}

/// Seed ledgers + 21 transactions (for pagination), two XLM transfer edges,
/// and one 24h `token_volume_stats` bucket.
async fn seed_feed_data(pool: &PgPool) {
    for seq in 100..=102 {
        upsert_ledger(pool, &ledger(seq, "testnet")).await.unwrap();
    }

    // 21 transactions with monotonically increasing timestamps so the keyset
    // walk has exactly 21 distinct rows across pages.
    sqlx::query(
        r#"
        INSERT INTO transactions
            (hash, network, ledger_sequence, status, source_account, operation_type,
             application_order, timestamp)
        SELECT 'tx-' || g, 'testnet', 100, 'success', 'GALICE', 'payment', 1,
               '2026-08-01T00:00:00Z'::timestamptz + (g || ' minutes')::interval
        FROM generate_series(0, 20) g
        "#,
    )
    .execute(pool)
    .await
    .unwrap();

    let now = Utc::now();
    upsert_tx(
        pool,
        &tx(
            "transfer-1",
            101,
            now - chrono::Duration::seconds(60),
            "testnet",
            Some(FundFlowEdge {
                from_address: "GA1".into(),
                to_address: "GB1".into(),
                asset: "XLM".into(),
                amount: "10.5".into(),
            }),
        ),
    )
    .await
    .unwrap();
    upsert_tx(
        pool,
        &tx(
            "transfer-2",
            102,
            now,
            "testnet",
            Some(FundFlowEdge {
                from_address: "GA2".into(),
                to_address: "GB2".into(),
                asset: "XLM".into(),
                amount: "3.25".into(),
            }),
        ),
    )
    .await
    .unwrap();

    sqlx::query(
        r#"
        INSERT INTO token_volume_stats
            (network, asset, window_start, window_seconds, volume, usd_volume, tx_count, active_accounts)
        VALUES ('testnet', 'XLM', now() - interval '1 hour', 86400, 100, 12.0, 10, 5)
        "#,
    )
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn feed_endpoints_return_newest_first_paginated_data() {
    let app = TestApp::new().await;
    seed_feed_data(app.db()).await;

    // -- transactions/latest, paginated --
    let (status, body) = req(
        app.router(),
        Method::GET,
        "/api/v1/explorer/testnet/transactions/latest?limit=20",
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let data = body["data"].as_array().unwrap();
    assert_eq!(data.len(), 20);
    assert!(
        body["next_cursor"].as_str().is_some(),
        "21 rows with limit 20 → a next page exists"
    );
    assert!(body["prev_cursor"].is_null(), "first page exposes no prev");
    let ts = |i: usize| data[i]["timestamp"].as_str().unwrap().to_string();
    assert!(ts(0) > ts(19), "transactions are newest-first");

    let mut conn = app.redis_conn().await;
    let cache_keys: Vec<String> = redis::cmd("KEYS")
        .arg("releeve:feeds:transactions:testnet*")
        .query_async(&mut conn)
        .await
        .unwrap();
    assert!(
        !cache_keys.is_empty(),
        "feed endpoint writes a Redis cache entry"
    );

    // Follow the keyset cursor to the end: every transaction appears exactly
    // once and no page overlaps the previous one.
    let mut seen: HashSet<String> = data
        .iter()
        .map(|r| r["hash"].as_str().unwrap().to_string())
        .collect();
    let mut cursor = body["next_cursor"].as_str().map(String::from);
    while let Some(c) = cursor {
        let path = format!("/api/v1/explorer/testnet/transactions/latest?limit=20&cursor={c}");
        let (status, body) = req(app.router(), Method::GET, &path, None, None).await;
        assert_eq!(status, StatusCode::OK);
        for r in body["data"].as_array().unwrap() {
            assert!(
                seen.insert(r["hash"].as_str().unwrap().to_string()),
                "a transaction is never repeated across pages"
            );
        }
        cursor = body["next_cursor"].as_str().map(String::from);
    }
    assert_eq!(
        seen.len(),
        23,
        "all 21 bulk + 2 transfer transactions surfaced exactly once"
    );

    // -- ledgers, newest-first by sequence --
    let (status, body) = req(
        app.router(),
        Method::GET,
        "/api/v1/explorer/testnet/ledgers?limit=20",
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "ledgers feed: {body:?}");
    let seqs: Vec<i64> = body["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["sequence"].as_i64().unwrap())
        .collect();
    assert_eq!(seqs, vec![102, 101, 100], "ledgers newest-first");

    // -- tokens/top --
    let (status, body) = req(
        app.router(),
        Method::GET,
        "/api/v1/explorer/testnet/tokens/top?window=24h",
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let rows = body["data"].as_array().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["asset"], "XLM");
    assert_eq!(rows[0]["volume"], 100);

    // -- transfers (asset filter + newest-first) --
    let (status, body) = req(
        app.router(),
        Method::GET,
        "/api/v1/explorer/testnet/transfers?asset=XLM&window=24h",
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let edges = body["data"].as_array().unwrap();
    assert_eq!(edges.len(), 2);
    assert_eq!(edges[0]["tx_hash"], "transfer-2", "newest transfer first");
    assert_eq!(edges[1]["tx_hash"], "transfer-1");
}

#[tokio::test]
async fn feed_cursor_paths_for_rankings_and_transfers_are_stable() {
    let app = TestApp::new().await;
    seed_feed_data(app.db()).await;

    sqlx::query(
        r#"
        INSERT INTO token_volume_stats
            (network, asset, window_start, window_seconds, volume, usd_volume, tx_count, active_accounts)
        SELECT 'testnet', 'ASSET-' || g, now(), 86400, (2000 - g)::numeric, NULL, 1, 2
        FROM generate_series(0, 21) g
        "#,
    )
    .execute(app.db())
    .await
    .unwrap();

    let now = Utc::now();
    for i in 0..21 {
        upsert_tx(
            app.db(),
            &tx(
                &format!("cursor-transfer-{i}"),
                102,
                now - chrono::Duration::seconds(i),
                "testnet",
                Some(FundFlowEdge {
                    from_address: format!("GFROM{i}"),
                    to_address: format!("GTO{i}"),
                    asset: "XLM".into(),
                    amount: "1".into(),
                }),
            ),
        )
        .await
        .unwrap();
    }

    let (status, body) = req(
        app.router(),
        Method::GET,
        "/api/v1/explorer/testnet/tokens/top?window=24h&limit=20",
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "top tokens first page: {body:?}");
    let cursor = body["next_cursor"]
        .as_str()
        .expect("top tokens has a second page");

    let (status, body) = req(
        app.router(),
        Method::GET,
        &format!("/api/v1/explorer/testnet/tokens/top?window=24h&limit=20&cursor={cursor}"),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "top tokens cursor page: {body:?}");
    assert!(
        !body["data"].as_array().unwrap().is_empty(),
        "cursor page returns remaining ranked tokens"
    );

    // A syntactically valid cursor with a quote in the tiebreaker is still just
    // data. This guards the dynamic SQL path against accidental interpolation.
    let quoted_cursor = Cursor::new(2000, "ASSET-1'").encode();
    let (status, body) = req(
        app.router(),
        Method::GET,
        &format!("/api/v1/explorer/testnet/tokens/top?window=24h&limit=20&cursor={quoted_cursor}"),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "quoted cursor is bound: {body:?}");

    let (status, body) = req(
        app.router(),
        Method::GET,
        "/api/v1/explorer/testnet/transfers?asset=XLM&window=24h&limit=20",
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "transfers first page: {body:?}");
    let cursor = body["next_cursor"]
        .as_str()
        .expect("transfers has a second page");

    let (status, body) = req(
        app.router(),
        Method::GET,
        &format!(
            "/api/v1/explorer/testnet/transfers?asset=XLM&window=24h&limit=20&cursor={cursor}"
        ),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "transfers cursor page: {body:?}");
    assert!(
        !body["data"].as_array().unwrap().is_empty(),
        "transfer cursor compares epoch-ms to epoch-ms"
    );
}

#[tokio::test]
async fn rate_limiter_returns_429_on_overquota_burst() {
    let app = TestApp::new().await;
    seed_feed_data(app.db()).await;

    // Fill the per-network sliding-window bucket to exactly the allowance (120)
    // so the very next request is the over-quota one. Deterministic and
    // independent of how long a 121-request burst would take under load, while
    // still driving the real rate-limit → 429 HTTP path.
    let mut conn = app.redis_conn().await;
    let bucket = ingest::ratelimit::key("explorer", "transactions:testnet");
    let now_ms = chrono::Utc::now().timestamp_millis();
    for i in 1..=120 {
        redis::cmd("ZADD")
            .arg(&bucket)
            .arg(now_ms - i)
            .arg(now_ms - i)
            .query_async::<()>(&mut conn)
            .await
            .unwrap();
    }

    let (status, _) = req(
        app.router(),
        Method::GET,
        "/api/v1/explorer/testnet/transactions/latest",
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);

    // Buckets are per-key: another network is unaffected by testnet's burst.
    let (status, _) = req(
        app.router(),
        Method::GET,
        "/api/v1/explorer/pubnet/transactions/latest",
        None,
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "a different bucket is not throttled"
    );
}

#[tokio::test]
async fn rate_limiter_fails_open_when_redis_is_down() {
    // Redis points at nothing listening: the limiter must fail open (200, served
    // from Postgres), never surface a 500.
    let app = TestApp::with_redis_url("redis://127.0.0.1:1").await;
    seed_feed_data(app.db()).await;

    let (status, body) = req(
        app.router(),
        Method::GET,
        "/api/v1/explorer/testnet/transactions/latest",
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "rate limiter fails open");
    assert!(
        body["data"].as_array().is_some(),
        "still served the feed from Postgres"
    );
}
