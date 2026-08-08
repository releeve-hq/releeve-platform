//! `releeve-ingest` — the Phase 2 ingestion daemon.
//!
//! Reads `IngestSettings` from the environment (prefix `INGEST_`), connects to
//! Postgres + Redis, and runs the per-network sync/rollup loops.

use shared::IngestSettings;
use std::path::Path;

type Error = Box<dyn std::error::Error + Send + Sync>;

fn load_dotenv() {
    if dotenvy::dotenv().is_ok() {
        return;
    }
    if dotenvy::from_path("backend/.env").is_ok() {
        return;
    }
    let crate_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let backend_env = crate_dir.join("../..").join(".env");
    dotenvy::from_path(backend_env).ok();
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    load_dotenv();
    let settings = IngestSettings::from_env()?;

    tracing_subscriber::fmt()
        .with_env_filter(settings.log_filter.clone())
        .init();

    let pool = sqlx::PgPool::connect(&settings.database_url).await?;
    tracing::info!(
        network = %settings.network,
        horizon_url = %settings.horizon_url,
        rpc_url = %settings.rpc_url,
        redis_url = %settings.redis_url,
        "releeve-ingest starting"
    );

    ingest::daemon::run_network(&settings, pool).await
}
