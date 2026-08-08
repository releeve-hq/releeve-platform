use api::mailer::SmtpMailer;
use api::oauth::OAuthClients;
use api::state::AppState;
use api::tokens::JwtIssuer;
use shared::Settings;
use std::path::Path;

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
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    load_dotenv();
    let settings = Settings::from_env()?;

    tracing_subscriber::fmt()
        .with_env_filter(settings.log_filter.clone())
        .init();

    let db = sqlx::PgPool::connect(&settings.database_url).await?;
    let redis = redis::Client::open(settings.redis_url.clone())?;

    let jwt = JwtIssuer::new(settings.jwt_secret.clone(), settings.jwt_access_ttl);
    let mailer = SmtpMailer::new(
        &settings.smtp_host,
        settings.smtp_port,
        &settings.smtp_username,
        &settings.smtp_password,
        &settings.smtp_from,
    )?;
    let oauth = OAuthClients::from_settings(&settings);
    let fork_core = if settings.fork_core_url.is_empty() {
        None
    } else {
        let private_key = std::fs::read(&settings.fork_core_signing_key_file)?;
        let signer = sim::ServiceAssertionSigner::from_ed25519_pem(
            &private_key,
            settings.fork_core_signing_kid.clone(),
            settings.fork_core_issuer.clone(),
            settings.fork_core_audience.clone(),
        )?;
        Some(sim::ForkCoreClient::new(
            settings.fork_core_url.clone(),
            signer,
        )?)
    };

    let listener = tokio::net::TcpListener::bind(&settings.bind_addr).await?;
    tracing::info!(addr = %settings.bind_addr, "releeve-api listening");
    axum::serve(
        listener,
        api::app(AppState {
            db,
            redis,
            settings,
            jwt,
            mailer: std::sync::Arc::new(mailer),
            oauth,
            fork_core,
        }),
    )
    .await?;
    Ok(())
}
