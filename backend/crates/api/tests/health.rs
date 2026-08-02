//! `GET /health` integration tests — up, degraded-db, and degraded-redis.

use std::sync::Arc;

use axum::Router;
use axum::http::StatusCode;
use shared::Settings;
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

use api::app;
use api::mailer::InMemoryMailer;
use api::oauth::OAuthClients;
use api::state::AppState;
use api::tokens::JwtIssuer;
use test_support::{run_migrations, spawn_postgres, spawn_redis};

fn test_state(db: sqlx::PgPool, redis: redis::Client) -> AppState {
    let settings = Settings {
        bind_addr: "127.0.0.1:8080".into(),
        database_url: String::new(),
        redis_url: String::new(),
        log_filter: "info".into(),
        jwt_secret: "test-secret".into(),
        jwt_access_ttl: 900,
        jwt_refresh_ttl: 2592000,
        app_base_url: "http://localhost:3000".into(),
        smtp_host: String::new(),
        smtp_port: 587,
        smtp_username: String::new(),
        smtp_password: String::new(),
        smtp_from: "Releeve <no-reply@releeve.dev>".into(),
        oauth_github_client_id: String::new(),
        oauth_github_client_secret: String::new(),
        oauth_google_client_id: String::new(),
        oauth_google_client_secret: String::new(),
    };
    AppState {
        db,
        redis,
        oauth: OAuthClients::from_settings(&settings),
        settings,
        jwt: JwtIssuer::new("test-secret".into(), 900),
        mailer: Arc::new(InMemoryMailer::new()),
    }
}

async fn request(router: Router, path: &str) -> (StatusCode, serde_json::Value) {
    let resp = router
        .oneshot(
            axum::http::Request::builder()
                .uri(path)
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .expect("request completes");
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .expect("body read");
    (
        status,
        serde_json::from_slice(&bytes).expect("response is JSON"),
    )
}

#[tokio::test]
async fn health_returns_200_when_all_dependencies_up() {
    let pg = spawn_postgres().await;
    run_migrations(&pg.pool).await;
    let redis = spawn_redis().await;

    let state = test_state(
        pg.pool,
        redis::Client::open(redis.url).expect("redis url parses"),
    );
    let (status, body) = request(app(state), "/health").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "ok");
    assert_eq!(body["checks"]["db"], "ok");
    assert_eq!(body["checks"]["redis"], "ok");
}

#[tokio::test]
async fn health_reports_503_when_redis_is_down() {
    let pg = spawn_postgres().await;
    run_migrations(&pg.pool).await;

    // A well-formed URL that points at nothing listening on port 1.
    let state = test_state(
        pg.pool,
        redis::Client::open("redis://127.0.0.1:1").expect("redis url parses"),
    );
    let (status, body) = request(app(state), "/health").await;

    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body["status"], "degraded");
    assert_eq!(body["checks"]["db"], "ok", "postgres stays ok");
    assert_eq!(body["checks"]["redis"], "down");
}

#[tokio::test]
async fn health_reports_503_when_db_is_down() {
    let redis = spawn_redis().await;

    // Lazy pool: no connection is established until first use, so the health
    // probe is the thing that fails — the "SELECT 1" never succeeds.
    let db = PgPoolOptions::new()
        .connect_lazy("postgres://postgres:postgres@127.0.0.1:1/postgres")
        .expect("lazy pool builds");
    let state = test_state(
        db,
        redis::Client::open(redis.url).expect("redis url parses"),
    );
    let (status, body) = request(app(state), "/health").await;

    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body["status"], "degraded");
    assert_eq!(body["checks"]["db"], "down");
    assert_eq!(body["checks"]["redis"], "ok", "redis stays ok");
}
