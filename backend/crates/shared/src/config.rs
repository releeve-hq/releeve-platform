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
}

impl Settings {
    /// Build settings from the process environment.
    ///
    /// - Required: `DATABASE_URL` (missing → error).
    /// - Defaulted: `BIND_ADDR` (`127.0.0.1:8080`), `REDIS_URL`
    ///   (`redis://127.0.0.1:6379`), `LOG_FILTER` (`info`).
    pub fn from_env() -> Result<Self, ConfigError> {
        Config::builder()
            .set_default("bind_addr", "127.0.0.1:8080")?
            .set_default("redis_url", "redis://127.0.0.1:6379")?
            .set_default("log_filter", "info")?
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

        let s = Settings::from_env().expect("parses");
        assert_eq!(s.database_url, "postgres://u:p@localhost:5432/db");
        assert_eq!(s.bind_addr, "0.0.0.0:9000");
        assert_eq!(s.redis_url, "redis://localhost:7000");
        assert_eq!(s.log_filter, "info", "LOG_FILTER absent → default");
    }

    #[test]
    fn missing_required_variable_is_an_error() {
        let _guard = ENV_LOCK.lock().unwrap();
        clear_env("DATABASE_URL");
        assert!(Settings::from_env().is_err(), "DATABASE_URL is required");
    }
}
