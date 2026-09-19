use api::mailer::{CloudflareEmailSender, LoggingMailer, Mailer, ResendEmailSender};
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
    // Outbox sender: Resend when configured, else Cloudflare Email Service,
    // else a logging sender so local flows (verification links in logs)
    // keep working. Request handlers only enqueue; this sender is drained
    // by the worker.
    let mailer: std::sync::Arc<dyn Mailer> = if !settings.resend_api_key.is_empty() {
        tracing::info!("email sender: resend");
        std::sync::Arc::new(ResendEmailSender::new(
            settings.resend_api_key.clone(),
            settings.email_from.clone(),
        ))
    } else if !settings.cloudflare_email_api_token.is_empty()
        && !settings.cloudflare_account_id.is_empty()
    {
        tracing::info!("email sender: cloudflare");
        std::sync::Arc::new(CloudflareEmailSender::new(
            settings.cloudflare_account_id.clone(),
            settings.cloudflare_email_api_token.clone(),
            settings.email_from.clone(),
        ))
    } else {
        tracing::info!("email sender: logging (set RESEND_API_KEY to deliver)");
        std::sync::Arc::new(LoggingMailer)
    };
    tokio::spawn(api::email_queue::run_worker(
        db.clone(),
        mailer.clone(),
        std::time::Duration::from_secs(settings.email_worker_poll_secs.max(1)),
    ));
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
        Some(
            sim::ForkCoreClient::new(settings.fork_core_url.clone(), signer)?
                .with_history_preview_token(settings.fork_core_history_preview_token.clone())?,
        )
    };
    let source_lens = if settings.source_lens_url.is_empty() {
        None
    } else {
        let private_key = std::fs::read(&settings.source_lens_signing_key_file)?;
        let signer = source_lens_client::ServiceAssertionSigner::from_ed25519_pem(
            &private_key,
            settings.source_lens_signing_kid.clone(),
            settings.source_lens_issuer.clone(),
            settings.source_lens_audience.clone(),
        )?;
        Some(source_lens_client::SourceLensClient::new(
            settings.source_lens_url.clone(),
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
            mailer,
            oauth,
            fork_core,
            source_lens,
        }),
    )
    .await?;
    Ok(())
}
