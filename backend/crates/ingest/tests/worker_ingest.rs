//! End-to-end ingestion worker test: real Postgres + Redis testcontainers and
//! a wiremock Horizon stub serving **committed fixtures** (defined inline —
//! never pulled from a live network at runtime).
//!
//! Verifies: the worker populates `ledgers` + classic `transactions` and
//! advances the watermark; a second pass is a no-op (idempotent); a competing
//! worker is locked out.

use ingest::sync::get_watermark;
use ingest::upstream::{Backoff, CircuitBreaker};
use ingest::worker::{HorizonClient, sync_network};
use sqlx::PgPool;
use test_support::{run_migrations, spawn_postgres, spawn_redis};
use wiremock::matchers::{method, path_regex, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

/// Committed Horizon fixture: a ledger page with seq 100 and 101.
fn ledger_fixture() -> serde_json::Value {
    serde_json::json!({
        "_embedded": { "records": [
            {
                "sequence": 100, "hash": "ledger-100", "prev_hash": "parent-99",
                "transaction_count": 1, "closed_at": "2026-08-01T12:00:00Z",
                "base_fee_in_stroops": 100, "paging_token": "100"
            },
            {
                "sequence": 101, "hash": "ledger-101", "prev_hash": "ledger-100",
                "transaction_count": 1, "closed_at": "2026-08-01T12:05:00Z",
                "base_fee_in_stroops": 100, "paging_token": "101"
            }
        ] }
    })
}

fn transactions_fixture(hash: &str, seq: i64) -> serde_json::Value {
    serde_json::json!({
        "_embedded": { "records": [{
            "hash": hash, "ledger": seq, "successful": true,
            "source_account": "GALICE", "fee_charged": "150",
            "created_at": "2026-08-01T12:00:00Z", "application_order": 1,
            "operations": [{
                "type": "payment", "from": "GALICE", "to": "GBOB",
                "amount": "10.5", "asset_type": "native"
            }]
        }] }
    })
}

async fn count(pool: &PgPool, table: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(&format!("SELECT count(*) FROM {table}"))
        .fetch_one(pool)
        .await
        .unwrap()
}

fn client(base: String) -> HorizonClient {
    HorizonClient::new(
        base,
        Backoff {
            base: std::time::Duration::from_millis(1),
            max: std::time::Duration::from_millis(10),
            jitter: 0.0,
            max_attempts: 3,
        },
        CircuitBreaker::new(5, std::time::Duration::from_millis(1_000)),
    )
}

async fn stub_horizon(server: &MockServer) {
    Mock::given(method("GET"))
        .and(path_regex(r"^/ledgers$"))
        .and(query_param("order", "asc"))
        .respond_with(ResponseTemplate::new(200).set_body_json(ledger_fixture()))
        .mount(server)
        .await;
    for (seq, hash) in [(100usize, "tx-100"), (101, "tx-101")] {
        Mock::given(method("GET"))
            .and(path_regex(format!("^/ledgers/{seq}/transactions$")))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(transactions_fixture(hash, seq as i64)),
            )
            .mount(server)
            .await;
    }
}

#[tokio::test]
async fn worker_syncs_fixture_range_and_watermark() {
    let pg = spawn_postgres().await;
    run_migrations(&pg.pool).await;
    let redis = spawn_redis().await;
    let mut rconn = redis::Client::open(redis.url)
        .unwrap()
        .get_multiplexed_async_connection()
        .await
        .unwrap();

    let mockserver = MockServer::start().await;
    stub_horizon(&mockserver).await;

    let mut c = client(mockserver.uri());
    let n = sync_network(&mut c, &pg.pool, &mut rconn, "testnet", 2, 30)
        .await
        .unwrap();
    assert_eq!(n, 2, "two ledgers ingested");
    assert_eq!(count(&pg.pool, "ledgers").await, 2);
    assert_eq!(count(&pg.pool, "transactions").await, 2);
    assert_eq!(
        get_watermark(&mut rconn, "testnet").await.unwrap(),
        Some(101)
    );

    // Idempotent re-run: nothing new, watermark stable.
    let n2 = sync_network(&mut c, &pg.pool, &mut rconn, "testnet", 2, 30)
        .await
        .unwrap();
    assert_eq!(n2, 0);
    assert_eq!(count(&pg.pool, "ledgers").await, 2);
    assert_eq!(count(&pg.pool, "transactions").await, 2);
}

#[tokio::test]
async fn competing_worker_is_locked_out() {
    let pg = spawn_postgres().await;
    run_migrations(&pg.pool).await;
    let redis = spawn_redis().await;
    let mut rconn = redis::Client::open(redis.url)
        .unwrap()
        .get_multiplexed_async_connection()
        .await
        .unwrap();

    let mockserver = MockServer::start().await;
    // Another worker already holds the lock for this network.
    assert!(
        ingest::sync::acquire_lock(&mut rconn, "pubnet", 60)
            .await
            .unwrap()
    );

    let mut c = client(mockserver.uri());
    let n = sync_network(&mut c, &pg.pool, &mut rconn, "pubnet", 2, 30)
        .await
        .unwrap();
    assert_eq!(n, 0, "locked network yields without touching Postgres");
    assert_eq!(count(&pg.pool, "ledgers").await, 0);
}
