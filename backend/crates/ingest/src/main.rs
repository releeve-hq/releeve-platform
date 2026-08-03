//! `releeve-ingest` — the Phase 2 ingestion daemon.
//!
//! Reads `IngestSettings` from the environment (prefix `INGEST_`), connects to
//! Postgres + Redis, and runs the per-network sync/rollup loops.

use shared::IngestSettings;

type Error = Box<dyn std::error::Error + Send + Sync>;

#[tokio::main]
async fn main() -> Result<(), Error> {
    dotenvy::dotenv().ok();
    let settings = IngestSettings::from_env()?;

    tracing_subscriber::fmt()
        .with_env_filter(settings.log_filter.clone())
        .init();

    let pool = sqlx::PgPool::connect(&settings.database_url).await?;
    tracing::info!(network = %settings.network, "releeve-ingest starting");

    ingest::daemon::run_network(&settings, pool).await
}
