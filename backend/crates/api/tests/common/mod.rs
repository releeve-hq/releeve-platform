//! Shared helpers for Phase 1 integration tests.
//!
//! Each test spins up its **own** Postgres + Redis testcontainers and an
//! `InMemoryMailer` — no real SMTP, no shared state (isolation by
//! construction, as in phase0.md).
#![allow(dead_code)]

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use shared::Settings;
use tower::ServiceExt;

use api::app;
use api::mailer::InMemoryMailer;
use api::oauth::OAuthClients;
use api::state::AppState;
use api::tokens::JwtIssuer;
use test_support::{PostgresInstance, RedisInstance, run_migrations, spawn_postgres, spawn_redis};

/// A booted test application with the real router and an inspectable mailer.
pub struct TestApp {
    state: AppState,
    pub mailer: Arc<InMemoryMailer>,
    /// Keep the Postgres/Redis containers alive for the lifetime of the app;
    /// dropping them would stop the databases under the pool.
    _postgres: PostgresInstance,
    _redis: RedisInstance,
}

pub fn test_settings() -> Settings {
    Settings {
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
    }
}

impl TestApp {
    pub async fn new() -> Self {
        let pg = spawn_postgres().await;
        run_migrations(&pg.pool).await;
        let redis = spawn_redis().await;

        let settings = test_settings();
        let mailer = Arc::new(InMemoryMailer::new());
        let state = AppState {
            db: pg.pool.clone(),
            redis: redis::Client::open(redis.url.clone()).expect("redis url parses"),
            oauth: OAuthClients::from_settings(&settings),
            settings,
            jwt: JwtIssuer::new("test-secret".into(), 900),
            mailer: mailer.clone(),
        };
        Self {
            state,
            mailer,
            _postgres: pg,
            _redis: redis,
        }
    }

    pub fn router(&self) -> Router {
        app(self.state.clone())
    }

    pub fn fail_next_mail(&self) {
        self.mailer.should_fail();
    }

    pub fn db(&self) -> &sqlx::PgPool {
        &self.state.db
    }
}

/// Fire a request through a fresh clone of the router, returning status + body.
pub async fn req(
    router: Router,
    method: Method,
    path: &str,
    body: Option<serde_json::Value>,
    bearer: Option<&str>,
) -> (StatusCode, serde_json::Value) {
    let mut builder = Request::builder().method(method).uri(path);
    if bearer.is_some() || body.is_some() {
        builder = builder.header("content-type", "application/json");
    }
    if let Some(token) = bearer {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    let json = body.map(|b| b.to_string()).unwrap_or_default();
    let resp = router
        .clone()
        .oneshot(builder.body(Body::from(json)).expect("request builds"))
        .await
        .expect("request completes");
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .expect("body read");
    let body = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
    (status, body)
}

/// The raw verification / reset token, extracted from the most recently sent
/// transactional email body.
pub fn token_from_mail(body: &str) -> String {
    let idx = body
        .find("token=")
        .expect("email body contains a token link");
    let rest = &body[idx + "token=".len()..];
    let end = rest
        .find(|c: char| !c.is_alphanumeric() && c != '_' && c != '-')
        .unwrap_or(rest.len());
    rest[..end].to_string()
}

/// Sign up and verify a fresh user, returning (access, refresh, profile).
pub async fn verified_user(app: &TestApp) -> (String, String, serde_json::Value) {
    let email = format!("u{}@example.com", uuid::Uuid::new_v4().simple());
    let (status, _) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/signup",
        Some(serde_json::json!({ "email": email, "password": "password-1234" })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "signup succeeds");

    let sent = app.mailer.drain();
    let token = token_from_mail(&sent[0].body);
    let (status, _) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/verify",
        Some(serde_json::json!({ "token": token })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "verify succeeds");

    let (status, body) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/login",
        Some(serde_json::json!({ "email": email, "password": "password-1234" })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "login succeeds");
    (
        body["access_token"].as_str().unwrap().to_string(),
        body["refresh_token"].as_str().unwrap().to_string(),
        body["user"].clone(),
    )
}
