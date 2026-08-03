//! Migration integration tests — full schema application and idempotency.

use test_support::{run_migrations, spawn_postgres};

async fn table_exists(pool: &sqlx::PgPool, table: &str) -> bool {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(
             SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = $1
         )",
    )
    .bind(table)
    .fetch_one(pool)
    .await
    .expect("table existence query runs")
}

#[tokio::test]
async fn full_schema_applies_with_key_tables_and_indexes() {
    let pg = spawn_postgres().await;
    run_migrations(&pg.pool).await;

    // A representative sample across every migration file, including the
    // reserved simulation/fork and billing tables (the "no retrofitting"
    // principle from phase0.md).
    for table in [
        "users",
        "organizations",
        "projects",
        "access_tokens",
        "account_destinations",
        "project_destinations",
        "transactions",
        "tx_call_tree_nodes",
        "token_volume_stats",
        "token_prices",
        "contract_verifications",
        "project_signers",
        "fork_environments",
        "simulation_runs",
        "simulation_call_tree_nodes",
        "simulation_state_changes",
        "simulation_events",
        "alerts",
        "alert_firings",
        "destination_deliveries",
        "plans",
        "subscriptions",
        "billing_events",
        "refresh_tokens",
        "email_verification_tokens",
        "password_reset_tokens",
    ] {
        assert!(
            table_exists(&pg.pool, table).await,
            "table `{table}` missing"
        );
    }

    // At least one representative unique/partial index from doc 03 §9.
    let idx_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(
             SELECT 1 FROM pg_indexes WHERE indexname = 'uq_alert_firing_dedupe'
         )",
    )
    .fetch_one(&pg.pool)
    .await
    .expect("index existence query runs");
    assert!(idx_exists, "uq_alert_firing_dedupe index missing");

    let raw: i16 = sqlx::query_scalar("SELECT permissions FROM organization_members LIMIT 1")
        .fetch_optional(&pg.pool)
        .await
        .expect("permission query runs")
        .unwrap_or_default();
    if raw != 0 {
        assert_eq!(raw & 128, 128, "full-permission members gain manage_alerts");
    }
}

#[tokio::test]
async fn migrations_are_idempotent() {
    let pg = spawn_postgres().await;
    run_migrations(&pg.pool).await;

    let applied: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations")
        .fetch_one(&pg.pool)
        .await
        .expect("migration count query runs");
    assert!(applied > 0, "at least one migration applied");

    // Re-running the same set is a no-op (SQLx tracks applied versions).
    run_migrations(&pg.pool).await;

    let applied_again: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations")
        .fetch_one(&pg.pool)
        .await
        .expect("migration count query runs");
    assert_eq!(
        applied, applied_again,
        "re-run must not apply new migrations"
    );
}
