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
}
