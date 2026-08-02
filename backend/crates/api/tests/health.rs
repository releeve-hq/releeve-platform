//! `GET /health` integration tests — up, degraded-db, and degraded-redis.

use axum::Router;
use axum::http::StatusCode;
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

use api::app;
use api::state::AppState;
use test_support::{run_migrations, spawn_postgres, spawn_redis};

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

    let state = AppState {
        db: pg.pool,
        redis: redis::Client::open(redis.url).expect("redis url parses"),
    };
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
    let state = AppState {
        db: pg.pool,
        redis: redis::Client::open("redis://127.0.0.1:1").expect("redis url parses"),
    };
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
    let state = AppState {
        db,
        redis: redis::Client::open(redis.url).expect("redis url parses"),
    };
    let (status, body) = request(app(state), "/health").await;

    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body["status"], "degraded");
    assert_eq!(body["checks"]["db"], "down");
    assert_eq!(body["checks"]["redis"], "ok", "redis stays ok");
}
