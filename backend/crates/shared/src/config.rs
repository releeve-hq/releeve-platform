use config::{Config, ConfigError, Environment};
use serde::Deserialize;

/// Runtime configuration, loaded from the environment (via the `config` crate).
///
/// `DATABASE_URL` is required (no default). Everything else has a sensible
/// dev default so a fresh checkout works after `docker compose up` + `.env`.
#[derive(Debug, Clone, Deserialize)]
pub struct Settings {
    pub bind_addr: String,
    pub database_url: String,
    pub redis_url: String,
    pub log_filter: String,

    // Phase 1 — auth.
    pub jwt_secret: String,
    pub jwt_access_ttl: i64,
    pub jwt_refresh_ttl: i64,
    /// Base URL of the web app — used to build verification / reset links in
    /// transactional emails.
    pub app_base_url: String,

    // Phase 1 — email (SMTP).
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_username: String,
    pub smtp_password: String,
    pub smtp_from: String,

    // Phase 1 — OAuth.
    pub oauth_github_client_id: String,
    pub oauth_github_client_secret: String,
    pub oauth_google_client_id: String,
    pub oauth_google_client_secret: String,
    /// Public Platform API base used by OAuth providers for their callbacks.
    pub oauth_callback_base: String,

    // Phase 3 — public explorer contract calls.
    pub soroban_rpc_url: String,
    pub fork_core_url: String,
    pub fork_core_signing_key_file: String,
    pub fork_core_signing_kid: String,
    pub fork_core_issuer: String,
    pub fork_core_audience: String,
    pub source_lens_url: String,
    pub source_lens_signing_key_file: String,
    pub source_lens_signing_kid: String,
    pub source_lens_issuer: String,
    pub source_lens_audience: String,
}

/// Runtime configuration for the `releeve-ingest` daemon (Phase 2).
///
/// Unlike the API settings there is no single required var: everything
/// defaults to a dev/test-local value so a fresh checkout works out of the
/// box, and the daemon refuses to start only when pointed at a database URL it
/// cannot reach.
#[derive(Debug, Clone, Deserialize)]
pub struct IngestSettings {
    pub database_url: String,
    pub redis_url: String,
    pub log_filter: String,
    /// The network label stamped on ingested rows (testnet/pubnet/futurenet).
    pub network: String,
    /// Horizon base URL for ledgers + classic transactions.
    pub horizon_url: String,
    /// Soroban-RPC base URL for invocation detail + entity snapshots.
    pub rpc_url: String,
    /// External USD price source base URL (token feed). Optional: when empty,
    /// price refresh is skipped and USD figures stay `NULL`.
    pub price_feed_url: String,
    /// Seconds between sync passes.
    pub sync_interval_secs: u64,
    /// Seconds between rollup + price-refresh passes.
    pub rollup_interval_secs: u64,
    /// Max ledgers ingested per sync pass (bounds a single pass's work).
    pub max_ledgers_per_pass: u64,
    /// Worker-lock TTL in seconds; re-acquired every pass.
    pub lock_ttl_secs: u64,
}

impl IngestSettings {
    pub fn from_env() -> Result<Self, ConfigError> {
        let mut settings: Self = Config::builder()
            .set_default("database_url", "")?
            .set_default("redis_url", "")?
            .set_default("log_filter", "info,ingest=debug")?
            .set_default("network", "testnet")?
            .set_default("horizon_url", "https://horizon-testnet.stellar.org")?
            .set_default("rpc_url", "https://soroban-testnet.stellar.org")?
            .set_default("price_feed_url", "")?
            .set_default("sync_interval_secs", 10)?
            .set_default("rollup_interval_secs", 300)?
            .set_default("max_ledgers_per_pass", 50)?
            .set_default("lock_ttl_secs", 120)?
            .add_source(Environment::with_prefix("INGEST"))
            .build()?
            .try_deserialize()?;

        // Local deployments share the API's database and Redis by default.
        // A dedicated worker can still override either value with INGEST_*.
        if settings.database_url.trim().is_empty() {
            settings.database_url = std::env::var("DATABASE_URL").unwrap_or_default();
        }
        if settings.redis_url.trim().is_empty() {
            settings.redis_url =
                std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
        }
        Ok(settings)
    }
}

impl Settings {
    /// Build settings from the process environment.
    ///
    /// - Required: `DATABASE_URL`.
    /// - Defaulted: `BIND_ADDR` (`127.0.0.1:8080`), `REDIS_URL`,
    ///   `LOG_FILTER`, plus Phase 1 auth/mail/oauth values so a fresh dev
    ///   checkout keeps working without them.
    pub fn from_env() -> Result<Self, ConfigError> {
        Config::builder()
            .set_default("bind_addr", "127.0.0.1:8080")?
            .set_default("redis_url", "redis://127.0.0.1:6379")?
            .set_default("log_filter", "info,tower_http=info")?
            .set_default("jwt_secret", "dev-insecure-change-me")?
            .set_default("jwt_access_ttl", 900)?
            .set_default("jwt_refresh_ttl", 2592000)?
            .set_default("app_base_url", "http://localhost:3000")?
            .set_default("smtp_host", "")?
            .set_default("smtp_port", 587)?
            .set_default("smtp_username", "")?
            .set_default("smtp_password", "")?
            .set_default("smtp_from", "Releeve <no-reply@releeve.dev>")?
            .set_default("oauth_github_client_id", "")?
            .set_default("oauth_github_client_secret", "")?
            .set_default("oauth_google_client_id", "")?
            .set_default("oauth_google_client_secret", "")?
            .set_default("oauth_callback_base", "http://127.0.0.1:8080")?
            .set_default("soroban_rpc_url", "")?
            .set_default("fork_core_url", "")?
            .set_default("fork_core_signing_key_file", "")?
            .set_default("fork_core_signing_kid", "platform-current")?
            .set_default("fork_core_issuer", "releeve-platform")?
            .set_default("fork_core_audience", "fork-core")?
            .set_default("source_lens_url", "")?
            .set_default("source_lens_signing_key_file", "")?
            .set_default("source_lens_signing_kid", "platform-current")?
            .set_default("source_lens_issuer", "releeve-platform")?
            .set_default("source_lens_audience", "source-lens")?
            .add_source(Environment::default())
            .build()?
            .try_deserialize()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{LazyLock, Mutex};

    use super::*;

    static ENV_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    fn set_env(key: &str, value: &str) {
        unsafe { std::env::set_var(key, value) };
    }

    fn clear_env(key: &str) {
        unsafe { std::env::remove_var(key) };
    }

    #[test]
    fn parses_env_with_defaults() {
        let _guard = ENV_LOCK.lock().unwrap();
        set_env("DATABASE_URL", "postgres://u:p@localhost:5432/db");
        set_env("BIND_ADDR", "0.0.0.0:9000");
        set_env("REDIS_URL", "redis://localhost:7000");
        clear_env("LOG_FILTER");
        clear_env("JWT_SECRET");
        clear_env("SMTP_HOST");
        clear_env("OAUTH_GITHUB_CLIENT_ID");

        let s = Settings::from_env().expect("parses");
        assert_eq!(s.database_url, "postgres://u:p@localhost:5432/db");
        assert_eq!(s.bind_addr, "0.0.0.0:9000");
        assert_eq!(s.redis_url, "redis://localhost:7000");
        assert_eq!(s.log_filter, "info,tower_http=info", "default filter");
        assert_eq!(s.jwt_secret, "dev-insecure-change-me");
        assert_eq!(s.smtp_host, "", "SMTP_HOST absent → empty");
        assert_eq!(s.oauth_github_client_id, "");
        assert_eq!(s.soroban_rpc_url, "", "API RPC URL is optional");
    }

    #[test]
    fn parses_phase1_values() {
        let _guard = ENV_LOCK.lock().unwrap();
        set_env("DATABASE_URL", "postgres://u:p@localhost:5432/db");
        set_env("JWT_SECRET", "s3cret");
        set_env("JWT_ACCESS_TTL", "600");
        set_env("SMTP_HOST", "smtp.example.com");
        set_env("SMTP_PORT", "2525");
        set_env("OAUTH_GITHUB_CLIENT_ID", "github-id");
        set_env("OAUTH_GITHUB_CLIENT_SECRET", "github-secret");

        let s = Settings::from_env().expect("parses");
        assert_eq!(s.jwt_secret, "s3cret");
        assert_eq!(s.jwt_access_ttl, 600);
        assert_eq!(s.smtp_host, "smtp.example.com");
        assert_eq!(s.smtp_port, 2525);
        assert_eq!(s.oauth_github_client_id, "github-id");
        assert_eq!(s.oauth_github_client_secret, "github-secret");
    }

    #[test]
    fn missing_required_variable_is_an_error() {
        let _guard = ENV_LOCK.lock().unwrap();
        clear_env("DATABASE_URL");
        assert!(Settings::from_env().is_err(), "DATABASE_URL is required");
    }

    #[test]
    fn ingest_settings_apply_env_and_defaults() {
        let _guard = ENV_LOCK.lock().unwrap();
        clear_env("DATABASE_URL");
        clear_env("INGEST_HORIZON_URL");
        set_env("INGEST_NETWORK", "pubnet");
        set_env("INGEST_MAX_LEDGERS_PER_PASS", "5");
        set_env("INGEST_PRICE_FEED_URL", "https://prices.example.test");

        let s = IngestSettings::from_env().expect("parses with defaults");
        assert_eq!(s.database_url, "", "no required var");
        assert_eq!(s.network, "pubnet");
        assert_eq!(s.max_ledgers_per_pass, 5);
        assert_eq!(
            s.horizon_url, "https://horizon-testnet.stellar.org",
            "default horizon"
        );
        assert_eq!(s.price_feed_url, "https://prices.example.test");
        assert_eq!(s.lock_ttl_secs, 120, "default lock ttl");
    }

    #[test]
    fn ingest_settings_fall_back_to_shared_connections() {
        let _guard = ENV_LOCK.lock().unwrap();
        clear_env("INGEST_DATABASE_URL");
        clear_env("INGEST_REDIS_URL");
        set_env(
            "DATABASE_URL",
            "postgres://shared:shared@localhost:5432/releeve",
        );
        set_env("REDIS_URL", "redis://localhost:6380");

        let s = IngestSettings::from_env().expect("inherits shared connections");
        assert_eq!(
            s.database_url,
            "postgres://shared:shared@localhost:5432/releeve"
        );
        assert_eq!(s.redis_url, "redis://localhost:6380");
    }
}
