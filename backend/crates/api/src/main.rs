use api::mailer::SmtpMailer;
use api::oauth::OAuthClients;
use api::state::AppState;
use api::tokens::JwtIssuer;
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

    let jwt = JwtIssuer::new(settings.jwt_secret.clone(), settings.jwt_access_ttl);
    let mailer = SmtpMailer::new(
        &settings.smtp_host,
        settings.smtp_port,
        &settings.smtp_username,
        &settings.smtp_password,
        &settings.smtp_from,
    )?;
    let oauth = OAuthClients::from_settings(&settings);

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
        }),
    )
    .await?;
    Ok(())
}
