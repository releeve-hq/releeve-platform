use api::{app, state::AppState};
use shared::Settings;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    let settings = Settings::from_env()?;

    tracing_subscriber::fmt()
        .with_env_filter(settings.log_filter.clone())
        .init();

    let db = sqlx::PgPool::connect(&settings.database_url).await?;
    let redis = redis::Client::open(settings.redis_url.clone())?;

    let listener = tokio::net::TcpListener::bind(&settings.bind_addr).await?;
    tracing::info!(addr = %settings.bind_addr, "releeve-api listening");
    axum::serve(listener, app(AppState { db, redis })).await?;
    Ok(())
}
