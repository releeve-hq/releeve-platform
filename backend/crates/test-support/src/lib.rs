//! Testcontainers harness shared by every crate's integration suite.
//!
//! The standard, self-contained way to run integration tests against real
//! Postgres/Redis: each call spawns a **disposable** container, so tests are
//! isolated by construction and never depend on a running `docker compose`
//! stack. Requires Docker on the machine/runner — see `phase0.md`.
//!
//! ```no_run
//! use test_support::{run_migrations, spawn_postgres, spawn_redis};
//!
//! # async fn example() {
//! let pg = spawn_postgres().await;
//! run_migrations(&pg.pool).await;
//! let redis = spawn_redis().await;
//! # }
//! ```

use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;
use testcontainers::ContainerAsync;
use testcontainers::ImageExt;
use testcontainers::runners::AsyncRunner;
use testcontainers_modules::postgres::Postgres;
use testcontainers_modules::redis::Redis;

/// A live Postgres container with a connected pool.
/// The container is dropped (stopped) when this struct goes out of scope.
#[allow(dead_code)]
pub struct PostgresInstance {
    container: ContainerAsync<Postgres>,
    pub url: String,
    pub pool: PgPool,
}

/// A live Redis container. Dropping it stops the container.
#[allow(dead_code)]
pub struct RedisInstance {
    container: ContainerAsync<Redis>,
    pub url: String,
}

/// Spawn a disposable `postgres:16-alpine` container and connect a pool to it.
pub async fn spawn_postgres() -> PostgresInstance {
    let container = Postgres::default()
        .with_tag("16-alpine")
        .start()
        .await
        .expect("failed to start postgres testcontainer (is Docker running?)");
    let port = container
        .get_host_port_ipv4(5432)
        .await
        .expect("postgres host port");
    let url = format!("postgres://postgres:postgres@127.0.0.1:{port}/postgres");
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&url)
        .await
        .expect("connect to postgres testcontainer");
    PostgresInstance {
        container,
        url,
        pool,
    }
}

/// Spawn a disposable `redis:7-alpine` container and return its connection URL.
pub async fn spawn_redis() -> RedisInstance {
    let container = Redis::default()
        .with_tag("7-alpine")
        .start()
        .await
        .expect("failed to start redis testcontainer (is Docker running?)");
    let port = container
        .get_host_port_ipv4(6379)
        .await
        .expect("redis host port");
    let url = format!("redis://127.0.0.1:{port}");
    RedisInstance { container, url }
}

/// Apply the full migration set (`backend/migrations`) to a pool, including
/// phase-specific additions such as Phase 3 project signers.
pub async fn run_migrations(pool: &PgPool) {
    sqlx::migrate!("../../migrations")
        .run(pool)
        .await
        .expect("migrations apply cleanly");
}
