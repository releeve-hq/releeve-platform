//! Ingestion persistence + single-writer coordination against real Postgres
//! and Redis testcontainers.
//!
//! Covers the platform's hard guarantees for Phase 2:
//! - **idempotency**: re-ingesting a ledger/tx is a no-op (row counts stable);
//! - **watermark**: monotonic, single-writer lock fans losers out.

use chrono::{TimeZone, Utc};
use ingest::models::{FundFlowEdge, LedgerRecord, TxRecord, TxStatus};
use ingest::state::{upsert_ledger, upsert_tx};
use ingest::sync::{acquire_lock, get_watermark, release_lock, set_watermark};
use sqlx::PgPool;
use test_support::{run_migrations, spawn_postgres, spawn_redis};

fn ledger(seq: i64, network: &str) -> LedgerRecord {
    LedgerRecord {
        sequence: seq,
        network: network.to_string(),
        hash: format!("ledger-{seq}"),
        parent_hash: if seq > 0 {
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

fn classic_tx(hash: &str, seq: u64, network: &str) -> TxRecord {
    TxRecord {
        hash: hash.to_string(),
        network: network.to_string(),
        ledger_sequence: seq as i64,
        status: TxStatus::Success,
        source_account: "GALICE".into(),
        operation_type: "payment".into(),
        operation_target_address: Some("GBOB".into()),
        operation_target_kind: Some("account".into()),
        fee_charged: Some("150".into()),
        sequence_number: None,
        application_order: 1,
        timestamp: Utc.timestamp_opt(1_700_000_000, 0).unwrap(),
        metrics: Default::default(),
        call_tree: Vec::new(),
        state_changes: Vec::new(),
        events: Vec::new(),
        fund_flow: vec![FundFlowEdge {
            from_address: "GALICE".into(),
            to_address: "GBOB".into(),
            asset: "XLM".into(),
            amount: "10.5".into(),
            ..Default::default()
        }],
        raw_result_meta_xdr: None,
        raw_envelope_xdr: None,
    }
}

async fn count(pool: &PgPool, table: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(&format!("SELECT count(*) FROM {table}"))
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn ingestion_is_idempotent() {
    let pg = spawn_postgres().await;
    run_migrations(&pg.pool).await;

    // First pass inserts; re-inserts are reported already-present.
    assert!(
        upsert_ledger(&pg.pool, &ledger(1, "testnet"))
            .await
            .unwrap()
    );
    assert!(
        !upsert_ledger(&pg.pool, &ledger(1, "testnet"))
            .await
            .unwrap()
    );
    for _ in 0..2 {
        assert!(
            !upsert_ledger(&pg.pool, &ledger(1, "testnet"))
                .await
                .unwrap()
        );
    }
    assert_eq!(count(&pg.pool, "ledgers").await, 1);

    let tx = classic_tx("hash-1", 100, "testnet");
    upsert_ledger(&pg.pool, &ledger(100, "testnet"))
        .await
        .unwrap();
    let first = upsert_tx(&pg.pool, &tx).await.unwrap();
    assert!(!first.already_present, "first insert is new");
    assert_eq!(first.node_ids.len(), 0);

    let second = upsert_tx(&pg.pool, &tx).await.unwrap();
    assert!(second.already_present, "re-ingest is a no-op");

    assert_eq!(count(&pg.pool, "transactions").await, 1);
    assert_eq!(
        count(&pg.pool, "tx_fund_flow_edges").await,
        1,
        "children once"
    );
}

#[tokio::test]
async fn transaction_with_call_tree_roundtrips() {
    let pg = spawn_postgres().await;
    run_migrations(&pg.pool).await;

    // Call tree root + one child; child references parent index 0.
    let tx = {
        let mut t = classic_tx("soroban-1", 200, "testnet");
        upsert_ledger(&pg.pool, &ledger(200, "testnet"))
            .await
            .unwrap();
        t.operation_type = "invoke_host_function".into();
        t.call_tree = vec![
            ingest::models::CallTreeNode {
                parent_index: None,
                contract_id: "C123".into(),
                function_name: "transfer".into(),
                args: serde_json::json!([]),
                return_value: Some(serde_json::json!({"ok": true})),
                depth: 0,
                ..Default::default()
            },
            ingest::models::CallTreeNode {
                parent_index: Some(0),
                contract_id: "C123".into(),
                function_name: "inner".into(),
                args: serde_json::json!([1, 2]),
                return_value: None,
                depth: 1,
                ..Default::default()
            },
        ];
        t.state_changes = vec![ingest::models::StateChange {
            entry_type: "contract_data".into(),
            entry_key: "balance".into(),
            value_before: Some(serde_json::json!(100)),
            value_after: Some(serde_json::json!(105)),
            caused_by_node: Some(0),
            ..Default::default()
        }];
        t.events = vec![ingest::models::Event {
            contract_id: "C123".into(),
            topics: vec!["transfer".into()],
            data: serde_json::json!({"amount": 5}),
            ..Default::default()
        }];
        t
    };

    let out = upsert_tx(&pg.pool, &tx).await.unwrap();
    assert_eq!(out.node_ids.len(), 2, "two call-tree nodes get uuids");

    assert_eq!(count(&pg.pool, "tx_call_tree_nodes").await, 2);
    assert_eq!(count(&pg.pool, "tx_state_changes").await, 1);
    assert_eq!(count(&pg.pool, "tx_events").await, 1);

    // The child node actually references its parent.
    let has_child_with_parent: bool = sqlx::query_scalar(
        "SELECT EXISTS (
             SELECT 1 FROM tx_call_tree_nodes c
             JOIN tx_call_tree_nodes p ON c.parent_node_id = p.id
             WHERE c.function_name = 'inner'
         )",
    )
    .fetch_one(&pg.pool)
    .await
    .unwrap();
    assert!(has_child_with_parent);

    // Idempotency holds for full tx too.
    let again = upsert_tx(&pg.pool, &tx).await.unwrap();
    assert!(again.already_present);
    assert_eq!(count(&pg.pool, "tx_events").await, 1);
}

#[tokio::test]
async fn watermark_and_lock_are_single_owner() {
    let redis = spawn_redis().await;
    let mut conn = redis::Client::open(redis.url)
        .unwrap()
        .get_multiplexed_async_connection()
        .await
        .unwrap();

    assert_eq!(get_watermark(&mut conn, "net").await.unwrap(), None);
    set_watermark(&mut conn, "net", 5).await.unwrap();
    assert_eq!(get_watermark(&mut conn, "net").await.unwrap(), Some(5));
    // Monotonic: no regress.
    set_watermark(&mut conn, "net", 3).await.unwrap();
    assert_eq!(get_watermark(&mut conn, "net").await.unwrap(), Some(5));
    set_watermark(&mut conn, "net", 7).await.unwrap();
    assert_eq!(get_watermark(&mut conn, "net").await.unwrap(), Some(7));

    // Lock: first wins, second is rejected, then releases.
    assert!(acquire_lock(&mut conn, "netl", 10).await.unwrap());
    assert!(
        !acquire_lock(&mut conn, "netl", 10).await.unwrap(),
        "one writer"
    );
    release_lock(&mut conn, "netl").await.unwrap();
    assert!(
        acquire_lock(&mut conn, "netl", 10).await.unwrap(),
        "re-acquire after release"
    );
}

async fn stat(pool: &PgPool, window: i64, asset: &str) -> (f64, i64) {
    sqlx::query_as(
        "SELECT volume::float8, tx_count
         FROM token_volume_stats
         WHERE network='testnet' AND asset=$1 AND window_seconds=$2",
    )
    .bind(asset)
    .bind(window)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn rollup_aggregates_edges_into_trailing_windows() {
    use chrono::{DateTime, Duration, Utc};
    use ingest::models::{FundFlowEdge, TxRecord, TxStatus};
    use ingest::rollup::{Quote, WINDOW_7D, WINDOW_24H, apply_quotes, rollup_window};

    let pg = spawn_postgres().await;
    run_migrations(&pg.pool).await;
    upsert_ledger(&pg.pool, &ledger(300, "testnet"))
        .await
        .unwrap();

    let now = Utc.timestamp_opt(1_700_000_000, 0).unwrap();
    let t1 = now - Duration::seconds(3600); // within 24h/7d/30d
    let t2 = now - Duration::seconds(3 * 86_400); // within 7d/30d, outside 24h
    let t3 = now - Duration::seconds(10 * 86_400); // within 30d only

    let edge_tx =
        |hash: &str, ts: DateTime<Utc>, asset: &str, amount: &str, from: &str, to: &str| TxRecord {
            hash: hash.into(),
            network: "testnet".into(),
            ledger_sequence: 300,
            status: TxStatus::Success,
            source_account: from.into(),
            operation_type: "payment".into(),
            operation_target_address: Some(to.into()),
            operation_target_kind: Some("account".into()),
            fee_charged: None,
            sequence_number: None,
            application_order: 1,
            timestamp: ts,
            metrics: Default::default(),
            call_tree: Vec::new(),
            state_changes: Vec::new(),
            events: Vec::new(),
            fund_flow: vec![FundFlowEdge {
                from_address: from.into(),
                to_address: to.into(),
                asset: asset.into(),
                amount: amount.into(),
                ..Default::default()
            }],
            raw_result_meta_xdr: None,
            raw_envelope_xdr: None,
        };

    upsert_tx(&pg.pool, &edge_tx("h1", t1, "XLM", "10", "GA", "GB"))
        .await
        .unwrap();
    upsert_tx(&pg.pool, &edge_tx("h2", t2, "XLM", "10", "GC", "GD"))
        .await
        .unwrap();
    upsert_tx(&pg.pool, &edge_tx("h3", t3, "XLM", "20", "GE", "GF"))
        .await
        .unwrap();
    upsert_tx(&pg.pool, &edge_tx("h4", t1, "USDC:GX", "7", "GZ", "GY"))
        .await
        .unwrap();

    // XLM has a price; USDC:GX deliberately does not (=> NULL usd_volume).
    let mut conn = pg.pool.acquire().await.unwrap();
    apply_quotes(
        &mut conn,
        "testnet",
        &[Quote {
            asset: "XLM".into(),
            price_usd: "2".into(),
        }],
    )
    .await
    .unwrap();
    drop(conn);

    rollup_window(&pg.pool, "testnet", WINDOW_24H, now)
        .await
        .unwrap();
    rollup_window(&pg.pool, "testnet", WINDOW_7D, now)
        .await
        .unwrap();

    // 24h: h1 XLM only (time t1 within window) => 10 / 1.
    assert_eq!(stat(&pg.pool, WINDOW_24H, "XLM").await, (10.0, 1));
    // 7d: h1 + h2 XLM = 20 across 2 txs.
    assert_eq!(stat(&pg.pool, WINDOW_7D, "XLM").await, (20.0, 2));
}

#[tokio::test]
async fn rollup_null_usd_when_no_price_and_numeric_math() {
    use chrono::Duration;
    use ingest::models::{FundFlowEdge, TxRecord, TxStatus};
    use ingest::rollup::rollup_window;

    let pg = spawn_postgres().await;
    run_migrations(&pg.pool).await;
    upsert_ledger(&pg.pool, &ledger(400, "testnet"))
        .await
        .unwrap();

    let now = Utc.timestamp_opt(1_700_000_000, 0).unwrap();
    let t = now - Duration::seconds(60);

    let tx = TxRecord {
        hash: "x1".into(),
        network: "testnet".into(),
        ledger_sequence: 400,
        status: TxStatus::Success,
        source_account: "GA".into(),
        operation_type: "payment".into(),
        operation_target_address: Some("GB".into()),
        operation_target_kind: Some("account".into()),
        fee_charged: None,
        sequence_number: None,
        application_order: 1,
        timestamp: t,
        metrics: Default::default(),
        call_tree: Vec::new(),
        state_changes: Vec::new(),
        events: Vec::new(),
        fund_flow: vec![FundFlowEdge {
            from_address: "GA".into(),
            to_address: "GB".into(),
            asset: "NOQUOTE:XYZ".into(),
            amount: "5".into(),
            ..Default::default()
        }],
        raw_result_meta_xdr: None,
        raw_envelope_xdr: None,
    };
    upsert_tx(&pg.pool, &tx).await.unwrap();

    rollup_window(&pg.pool, "testnet", 604_800, now)
        .await
        .unwrap();

    let usd: Option<f64> = sqlx::query_scalar(
        "SELECT usd_volume FROM token_volume_stats WHERE network='testnet' AND asset='NOQUOTE:XYZ' AND window_seconds=604800",
    )
    .fetch_one(&pg.pool)
    .await
    .unwrap();
    assert!(
        usd.is_none(),
        "missing price => NULL usd_volume, never an error"
    );
}

#[tokio::test]
async fn http_price_feed_refreshes_token_prices() {
    use ingest::prices::HttpPriceFeed;
    use ingest::rollup::PriceFeed;
    use wiremock::matchers::{method, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    let pg = spawn_postgres().await;
    run_migrations(&pg.pool).await;

    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(query_param("assets", "XLM,USDC:GX"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "prices": {
                "XLM": "0.12",
                "USDC:GX": "1.0",
                "UNKNOWN": null
            }
        })))
        .mount(&server)
        .await;

    let feed = HttpPriceFeed::new(server.uri());
    let quotes = feed
        .refresh(&pg.pool, "testnet", &["XLM", "USDC:GX"])
        .await
        .unwrap();
    assert_eq!(quotes.len(), 2, "only valid quotes returned");

    let price: String = sqlx::query_scalar(
        "SELECT price_usd::text FROM token_prices WHERE network='testnet' AND asset='XLM'",
    )
    .fetch_one(&pg.pool)
    .await
    .unwrap();
    assert_eq!(price.parse::<f64>().unwrap(), 0.12);
}

#[tokio::test]
async fn redis_flush_falls_back_to_postgres_and_repopulates() {
    use ingest::feeds::{cached_feed, feed_key};
    use redis::AsyncCommands;

    let pg = spawn_postgres().await;
    run_migrations(&pg.pool).await;
    let redis = spawn_redis().await;
    let mut conn = redis::Client::open(redis.url.clone())
        .unwrap()
        .get_multiplexed_async_connection()
        .await
        .unwrap();

    // Seed one ledger and two transactions through the real persistence path.
    upsert_ledger(&pg.pool, &ledger(500, "testnet"))
        .await
        .unwrap();
    let mut t1 = classic_tx("feed-1", 500, "testnet");
    t1.timestamp = Utc.timestamp_opt(1_700_000_100, 0).unwrap();
    let mut t2 = classic_tx("feed-2", 500, "testnet");
    t2.timestamp = Utc.timestamp_opt(1_700_000_200, 0).unwrap();
    upsert_tx(&pg.pool, &t1).await.unwrap();
    upsert_tx(&pg.pool, &t2).await.unwrap();

    let key = feed_key("testnet", "transactions", "");

    // First read: cache miss → Postgres → populated cache.
    let first = cached_feed(&mut conn, &key, 60, feed_rows(&pg.pool))
        .await
        .unwrap();
    assert_eq!(
        first.as_array().unwrap().len(),
        2,
        "miss served from Postgres"
    );
    let cached: Option<String> = conn.get(&key).await.unwrap();
    assert!(cached.is_some(), "cache populated on the miss");

    // Redis flushed mid-flight: the feed must still be served from Postgres
    // (correctness over speed), then repopulate on the same read.
    redis::cmd("FLUSHALL")
        .query_async::<()>(&mut conn)
        .await
        .unwrap();
    let second = cached_feed(&mut conn, &key, 60, feed_rows(&pg.pool))
        .await
        .unwrap();
    assert_eq!(
        second.as_array().unwrap().len(),
        2,
        "flush degrades to Postgres, never an empty/error response"
    );
    let repopulated: Option<String> = conn.get(&key).await.unwrap();
    assert!(repopulated.is_some(), "cache repopulated after the flush");
}

/// The feed query the cache builds on a miss, as a fresh future per call.
async fn feed_rows(pool: &PgPool) -> Result<Vec<serde_json::Value>, sqlx::Error> {
    use ingest::feeds::{Dir, latest_transactions};
    latest_transactions(pool, "testnet", 20, None, Dir::Next)
        .await
        .map(|p| p.data)
}

#[tokio::test]
async fn http_price_feed_down_degrades_without_error() {
    use ingest::prices::HttpPriceFeed;
    use ingest::rollup::PriceFeed;
    use wiremock::MockServer;

    let pg = spawn_postgres().await;
    run_migrations(&pg.pool).await;

    // A wiremock that never matches: every GET is a 404. The adapter must
    // surface a PriceError (which the scheduler treats as "refresh skipped"),
    // not panic, and never half-write the DB.
    let server = MockServer::start().await;
    let feed = HttpPriceFeed::new(server.uri());
    let err = feed.refresh(&pg.pool, "testnet", &["XLM"]).await;
    assert!(err.is_err(), "down upstream is a PriceError, not a panic");
    let n: i64 = sqlx::query_scalar("SELECT count(*) FROM token_prices")
        .fetch_one(&pg.pool)
        .await
        .unwrap();
    assert_eq!(n, 0, "no rows written when the refresh failed");
}
