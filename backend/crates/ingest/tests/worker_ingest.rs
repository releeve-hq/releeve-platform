//! End-to-end ingestion worker test: real Postgres + Redis testcontainers and
//! a wiremock Horizon stub serving **committed fixtures** (defined inline —
//! never pulled from a live network at runtime).
//!
//! Verifies: the worker populates `ledgers` + classic `transactions` and
//! advances the watermark; a second pass is a no-op (idempotent); a competing
//! worker is locked out.

use ingest::rpc::SorobanRpcClient;
use ingest::sync::{get_watermark, release_lock};
use ingest::upstream::{Backoff, CircuitBreaker};
use ingest::worker::{HorizonClient, snapshot_entities, sync_network};
use sqlx::PgPool;
use test_support::{run_migrations, spawn_postgres, spawn_redis};
use wiremock::matchers::{
    body_partial_json, method, path_regex, query_param, query_param_is_missing,
};
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

async fn ledger_count(pool: &PgPool, network: &str) -> i64 {
    sqlx::query_scalar::<_, i64>("SELECT count(*) FROM ledgers WHERE network = $1")
        .bind(network)
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
    // Base page matches only the initial (cursor-less) request; paginated
    // fetches past the fixture are served by the end-of-range stub so the
    // worker stops instead of looping the same page forever.
    Mock::given(method("GET"))
        .and(path_regex(r"^/ledgers$"))
        .and(query_param("order", "asc"))
        .and(query_param_is_missing("cursor"))
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

/// Past the last fixture ledger (`paging_token: "101"`) Horizon has no more
/// pages — pin the end-of-range so paginated fetches break cleanly.
async fn stub_ledger_page_end(server: &MockServer) {
    Mock::given(method("GET"))
        .and(path_regex(r"^/ledgers$"))
        .and(query_param("cursor", "101"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({ "_embedded": { "records": [] } })),
        )
        .mount(server)
        .await;
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
    let n = sync_network(&mut c, &pg.pool, &mut rconn, "testnet", 2, 30, None)
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
    let n2 = sync_network(&mut c, &pg.pool, &mut rconn, "testnet", 2, 30, None)
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
    let n = sync_network(&mut c, &pg.pool, &mut rconn, "pubnet", 2, 30, None)
        .await
        .unwrap();
    assert_eq!(n, 0, "locked network yields without touching Postgres");
    assert_eq!(count(&pg.pool, "ledgers").await, 0);
}

fn rpc_client(base: String) -> SorobanRpcClient {
    SorobanRpcClient::new(
        base,
        Backoff {
            base: std::time::Duration::from_millis(1),
            max: std::time::Duration::from_millis(10),
            jitter: 0.0,
            max_attempts: 2,
        },
        CircuitBreaker::new(5, std::time::Duration::from_millis(1_000)),
    )
}

/// Fixture: ledger 100 carries one Soroban invocation, `tx-soroban`. The RPC
/// `getTransaction` answer enriches it with one contract event + core metrics.
fn soroban_ledger_fixture() -> serde_json::Value {
    serde_json::json!({
        "_embedded": { "records": [
            {
                "sequence": 100, "hash": "ledger-100", "prev_hash": "parent-99",
                "transaction_count": 1, "closed_at": "2026-08-01T12:00:00Z",
                "base_fee_in_stroops": 100, "paging_token": "100"
            }
        ] }
    })
}

fn soroban_tx_fixture(hash: &str, seq: i64) -> serde_json::Value {
    serde_json::json!({
        "_embedded": { "records": [{
            "hash": hash, "ledger": seq, "successful": true,
            "source_account": "GALICE", "fee_charged": "150",
            "created_at": "2026-08-01T12:00:00Z", "application_order": 1,
            "operations": [{
                "type": "invoke_host_function", "from": "GALICE", "to": "C123",
                "amount": "0", "asset_type": "native"
            }]
        }] }
    })
}

fn rpc_detail_fixture(hash: &str) -> serde_json::Value {
    serde_json::json!({
        "result": {
            "hash": hash, "status": "SUCCESS", "ledger": 100,
            "created_at": "2026-08-01T12:00:00Z", "source_account": "GALICE",
            "events": {
                "contractEvents": [
                    { "contractId": "C123", "topics": ["transfer", "GALICE"], "data": {"amount": 5} }
                ],
                "transactionEvents": [],
                "diagnosticEvents": [
                    { "coreMetrics": { "cpu_insn": 27627988, "mem_byte": 1466596 } }
                ]
            }
        }
    })
}

#[tokio::test]
async fn soroban_invocation_is_enriched_via_rpc_detail() {
    let pg = spawn_postgres().await;
    run_migrations(&pg.pool).await;
    let redis = spawn_redis().await;
    let mut rconn = redis::Client::open(redis.url)
        .unwrap()
        .get_multiplexed_async_connection()
        .await
        .unwrap();

    let mockserver = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path_regex(r"^/ledgers$"))
        .and(query_param("order", "asc"))
        .respond_with(ResponseTemplate::new(200).set_body_json(soroban_ledger_fixture()))
        .mount(&mockserver)
        .await;
    Mock::given(method("GET"))
        .and(path_regex("^/ledgers/100/transactions$"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(soroban_tx_fixture("tx-soroban", 100)),
        )
        .mount(&mockserver)
        .await;
    Mock::given(method("POST"))
        .and(body_partial_json(
            serde_json::json!({ "method": "getTransaction" }),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(rpc_detail_fixture("tx-soroban")))
        .mount(&mockserver)
        .await;

    let mut c = client(mockserver.uri());
    let mut rpc = rpc_client(mockserver.uri());
    let n = sync_network(
        &mut c,
        &pg.pool,
        &mut rconn,
        "testnet",
        1,
        30,
        Some(&mut rpc),
    )
    .await
    .unwrap();
    assert_eq!(n, 1);

    assert_eq!(count(&pg.pool, "transactions").await, 1);
    // The enriched row must carry the decoded event and metrics, not the bare
    // classic fallback.
    let row: (i64, Option<i64>) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM tx_events), \
                (SELECT max(cpu_instructions) FROM transactions)",
    )
    .fetch_one(&pg.pool)
    .await
    .unwrap();
    assert_eq!(row.0, 1, "one contract event persisted");
    assert_eq!(row.1, Some(27627988), "core metrics persisted");
}

#[tokio::test]
async fn soroban_without_rpc_falls_back_to_classic_row() {
    let pg = spawn_postgres().await;
    run_migrations(&pg.pool).await;
    let redis = spawn_redis().await;
    let mut rconn = redis::Client::open(redis.url)
        .unwrap()
        .get_multiplexed_async_connection()
        .await
        .unwrap();

    let mockserver = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path_regex(r"^/ledgers$"))
        .and(query_param("order", "asc"))
        .respond_with(ResponseTemplate::new(200).set_body_json(soroban_ledger_fixture()))
        .mount(&mockserver)
        .await;
    Mock::given(method("GET"))
        .and(path_regex("^/ledgers/100/transactions$"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(soroban_tx_fixture("tx-soroban", 100)),
        )
        .mount(&mockserver)
        .await;

    // No RPC client configured: the invocation still lands as a classic row so
    // the ledger is never silently missing a transaction.
    let mut c = client(mockserver.uri());
    let n = sync_network(&mut c, &pg.pool, &mut rconn, "testnet", 1, 30, None)
        .await
        .unwrap();
    assert_eq!(n, 1);
    assert_eq!(count(&pg.pool, "transactions").await, 1);
    assert_eq!(
        count(&pg.pool, "tx_events").await,
        0,
        "no RPC detail without a client"
    );
}

#[tokio::test]
async fn snapshot_entities_persists_and_is_idempotent() {
    let pg = spawn_postgres().await;
    run_migrations(&pg.pool).await;

    let mockserver = MockServer::start().await;
    Mock::given(method("POST"))
        .and(body_partial_json(
            serde_json::json!({ "method": "getLedgerEntries" }),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "result": {
                "entries": [
                    { "key": "account-ga", "xdr": "xdr-ga", "lastModifiedLedgerSeq": 41 },
                    { "key": "contract-c1", "xdr": "xdr-c1" }
                ],
                "latestLedger": 100
            }
        })))
        .mount(&mockserver)
        .await;

    let mut rpc = rpc_client(mockserver.uri());
    let n = snapshot_entities(
        &mut rpc,
        &pg.pool,
        "testnet",
        &["account-ga", "contract-c1"],
    )
    .await
    .unwrap();
    assert_eq!(n, 2, "both snapshots persisted");

    // Idempotent: a re-run over the same keys updates in place, no new rows.
    let n2 = snapshot_entities(
        &mut rpc,
        &pg.pool,
        "testnet",
        &["account-ga", "contract-c1"],
    )
    .await
    .unwrap();
    assert_eq!(n2, 2, "upsert reports rows touched, still idempotent");
    assert_eq!(count(&pg.pool, "entity_snapshots").await, 2);

    let keys: Vec<String> =
        sqlx::query_scalar("SELECT entry_key FROM entity_snapshots ORDER BY entry_key")
            .fetch_all(&pg.pool)
            .await
            .unwrap();
    assert_eq!(
        keys,
        vec!["account-ga".to_string(), "contract-c1".to_string()]
    );
}

#[tokio::test]
async fn dead_upstream_pauses_only_its_network() {
    let pg = spawn_postgres().await;
    run_migrations(&pg.pool).await;
    let redis = spawn_redis().await;
    let mut rconn = redis::Client::open(redis.url)
        .unwrap()
        .get_multiplexed_async_connection()
        .await
        .unwrap();

    // Network A's Horizon is dead (503 on every ledgers page); network B's is
    // healthy. The two networks share Postgres + Redis but own separate
    // clients/circuit-breakers.
    let dead = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path_regex(r"^/ledgers$"))
        .respond_with(ResponseTemplate::new(503))
        .mount(&dead)
        .await;

    let healthy = MockServer::start().await;
    stub_horizon(&healthy).await;
    stub_ledger_page_end(&healthy).await;

    let mut a = HorizonClient::new(
        dead.uri(),
        Backoff {
            base: std::time::Duration::from_millis(1),
            max: std::time::Duration::from_millis(10),
            jitter: 0.0,
            max_attempts: 3,
        },
        CircuitBreaker::new(2, std::time::Duration::from_millis(60_000)),
    );
    let mut b = client(healthy.uri());

    // A dead upstream surfaces as "ingested 0" — a pause, never an error — and
    // the healthy network keeps flowing.
    let na = sync_network(&mut a, &pg.pool, &mut rconn, "broken", 5, 30, None)
        .await
        .unwrap();
    assert_eq!(na, 0, "503 retried then exhausts: paused, not failed");
    let nb = sync_network(&mut b, &pg.pool, &mut rconn, "testnet", 5, 30, None)
        .await
        .unwrap();
    assert_eq!(nb, 2, "healthy network ingests normally");

    assert_eq!(
        ledger_count(&pg.pool, "broken").await,
        0,
        "nothing persisted for the dead network"
    );
    assert_eq!(
        ledger_count(&pg.pool, "testnet").await,
        2,
        "healthy network fully persisted"
    );

    // The circuit is now open: a second pass short-circuits and never touches
    // the dead upstream again (request count frozen at the first pass's retries
    // — the breaker tripped on its 2nd failure, so 2 requests, then open).
    let na2 = sync_network(&mut a, &pg.pool, &mut rconn, "broken", 5, 30, None)
        .await
        .unwrap();
    assert_eq!(na2, 0);
    let hits = dead
        .received_requests()
        .await
        .unwrap()
        .into_iter()
        .filter(|r| r.method == wiremock::http::Method::GET && r.url.path() == "/ledgers")
        .count();
    assert_eq!(hits, 2, "backoff retries hit upstream, circuit open after");
}

#[tokio::test]
async fn worker_resumes_from_watermark_without_gaps_or_dupes() {
    let pg = spawn_postgres().await;
    run_migrations(&pg.pool).await;
    let redis = spawn_redis().await;
    let mut rconn = redis::Client::open(redis.url)
        .unwrap()
        .get_multiplexed_async_connection()
        .await
        .unwrap();

    let mockserver = MockServer::start().await;
    // Ledger page: 100 + 101 (cursor-less requests only).
    Mock::given(method("GET"))
        .and(path_regex(r"^/ledgers$"))
        .and(query_param("order", "asc"))
        .and(query_param_is_missing("cursor"))
        .respond_with(ResponseTemplate::new(200).set_body_json(ledger_fixture()))
        .mount(&mockserver)
        .await;
    stub_ledger_page_end(&mockserver).await;
    // Ledger 100's transactions resolve immediately.
    Mock::given(method("GET"))
        .and(path_regex("^/ledgers/100/transactions$"))
        .respond_with(ResponseTemplate::new(200).set_body_json(transactions_fixture("tx-100", 100)))
        .mount(&mockserver)
        .await;
    // Ledger 101's transactions are down for the first pass (the 503 has
    // higher priority while its budget lasts), then recover to the 200.
    Mock::given(method("GET"))
        .and(path_regex("^/ledgers/101/transactions$"))
        .respond_with(ResponseTemplate::new(200).set_body_json(transactions_fixture("tx-101", 101)))
        .with_priority(2)
        .mount(&mockserver)
        .await;
    Mock::given(method("GET"))
        .and(path_regex("^/ledgers/101/transactions$"))
        .respond_with(ResponseTemplate::new(503))
        .up_to_n_times(3) // one backoff run (3 attempts) worth of failures
        .with_priority(1)
        .mount(&mockserver)
        .await;

    let mut c = client(mockserver.uri());

    // Pass 1: ledger 100 completes and advances the watermark; ledger 101's
    // header is persisted but its transactions are unreachable, so the pass
    // stops after one ingested ledger.
    let n1 = sync_network(&mut c, &pg.pool, &mut rconn, "testnet", 5, 30, None)
        .await
        .unwrap();
    assert_eq!(n1, 1, "one ledger fully ingested before the outage");
    assert_eq!(count(&pg.pool, "transactions").await, 1, "only tx-100");
    assert_eq!(
        get_watermark(&mut rconn, "testnet").await.unwrap(),
        Some(100),
        "watermark advanced past the completed ledger only"
    );

    // Pass 2 (a restarted worker — the previous lock has lapsed): resumes
    // exactly after the watermark (no gap, no re-ingest of ledger 100) once the
    // upstream is back.
    release_lock(&mut rconn, "testnet").await.unwrap();
    let n2 = sync_network(&mut c, &pg.pool, &mut rconn, "testnet", 5, 30, None)
        .await
        .unwrap();
    assert_eq!(n2, 1, "resumed from the watermark");
    assert_eq!(
        count(&pg.pool, "transactions").await,
        2,
        "tx-101 added, no dupe"
    );
    assert_eq!(
        get_watermark(&mut rconn, "testnet").await.unwrap(),
        Some(101)
    );

    // Pass 3: fully caught up — nothing new.
    release_lock(&mut rconn, "testnet").await.unwrap();
    let n3 = sync_network(&mut c, &pg.pool, &mut rconn, "testnet", 5, 30, None)
        .await
        .unwrap();
    assert_eq!(n3, 0);
    assert_eq!(count(&pg.pool, "transactions").await, 2);
}
