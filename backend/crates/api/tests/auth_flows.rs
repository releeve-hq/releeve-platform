//! The Phase 1 auth happy path and its failure modes, exercising the real
//! router against disposable Postgres/Redis containers and an in-memory
//! mailer. Covers signup→verify→login→authed-request→refresh→logout.

mod common;

use axum::http::Method;
use axum::http::StatusCode;

use common::{TestApp, req, token_from_mail};

#[tokio::test]
async fn signup_creates_user_personal_org_and_verification_email() {
    let app = TestApp::new().await;
    let email = format!("new@{}", uuid::Uuid::new_v4().simple());

    let (status, body) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/signup",
        Some(serde_json::json!({ "email": email, "password": "password-1234" })),
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "signup accepts; got {status} {body}"
    );
    assert_eq!(body["email"], email);

    // A verification email was "sent" and carries a link.
    let sent = app.mailer.drain();
    assert_eq!(sent.len(), 1, "one verification email");
    assert!(sent[0].body.contains("/auth/verify?token="));
    let _token = token_from_mail(&sent[0].body);

    // The personal org + owner membership were created atomically.
    let (lstatus, login) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/login",
        Some(serde_json::json!({ "email": email, "password": "password-1234" })),
        None,
    )
    .await;
    assert_eq!(lstatus, StatusCode::OK);
    let access = login["access_token"].as_str().unwrap();
    let (_, orgs) = req(
        app.router(),
        Method::GET,
        "/api/v1/me/organizations",
        None,
        Some(access),
    )
    .await;
    assert_eq!(orgs.as_array().unwrap().len(), 1, "one personal org");
    assert_eq!(orgs[0]["is_personal"], true);
}

#[tokio::test]
async fn signup_rolls_back_when_email_fails() {
    let app = TestApp::new().await;
    app.fail_next_mail();
    let email = format!("fail{}@example.com", uuid::Uuid::new_v4().simple());

    let (status, _) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/signup",
        Some(serde_json::json!({ "email": email, "password": "password-1234" })),
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::INTERNAL_SERVER_ERROR,
        "mailer failure → 500"
    );

    // Account must not exist (org + user rolled back).
    let (lstatus, _) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/login",
        Some(serde_json::json!({ "email": email, "password": "password-1234" })),
        None,
    )
    .await;
    assert_eq!(lstatus, StatusCode::UNAUTHORIZED, "account rolled back");
}

#[tokio::test]
async fn verify_then_authed_request_and_unverified_mutation_gate() {
    let app = TestApp::new().await;
    let email = format!("v{}@example.com", uuid::Uuid::new_v4().simple());
    let password = "password-1234";

    let (_, _) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/signup",
        Some(serde_json::json!({ "email": email, "password": password })),
        None,
    )
    .await;
    let token = token_from_mail(&app.mailer.drain()[0].body);

    // Login before verify works (read-only), but mutations are gated.
    let (_, login) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/login",
        Some(serde_json::json!({ "email": email, "password": password })),
        None,
    )
    .await;
    let access = login["access_token"].as_str().unwrap();
    let (_, me) = req(app.router(), Method::GET, "/api/v1/me", None, Some(access)).await;
    assert_eq!(me["email_verified"], false);

    let (_, orgs) = req(
        app.router(),
        Method::GET,
        "/api/v1/me/organizations",
        None,
        Some(access),
    )
    .await;
    let slug = orgs[0]["slug"].as_str().unwrap().to_string();
    let (mutstat, _) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{slug}/projects"),
        Some(serde_json::json!({ "name": "p1" })),
        Some(access),
    )
    .await;
    assert_eq!(mutstat, StatusCode::FORBIDDEN, "email_unverified gate");
    let (_, forb) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{slug}/projects"),
        Some(serde_json::json!({ "name": "p1" })),
        Some(access),
    )
    .await;
    assert_eq!(forb["error"]["code"], "email_unverified");

    // Verify → mutation allowed.
    let (_, _) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/verify",
        Some(serde_json::json!({ "token": token })),
        None,
    )
    .await;
    let (status, _) = req(
        app.router(),
        Method::POST,
        &format!("/api/v1/{slug}/projects"),
        Some(serde_json::json!({ "name": "p1" })),
        Some(access),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "post-verify project creation");

    // Re-verifying the same token is rejected (consumed).
    let (status, _) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/verify",
        Some(serde_json::json!({ "token": token })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "consumed token rejected");
}

#[tokio::test]
async fn login_refresh_rotation_with_reuse_detection() {
    let app = TestApp::new().await;
    let (_, refresh, _) = common::verified_user(&app).await;

    // Refresh rotates: old token consumed, new pair returned.
    let (rstatus, rotated) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/token/refresh",
        Some(serde_json::json!({ "refresh_token": refresh })),
        None,
    )
    .await;
    assert_eq!(rstatus, StatusCode::OK);
    let new_refresh = rotated["refresh_token"].as_str().unwrap().to_string();

    // A freshly-issued access token lets the subsequent reuse succeed to a 401.
    let (_, _) = req(
        app.router(),
        Method::GET,
        "/api/v1/me",
        None,
        Some(rotated["access_token"].as_str().unwrap()),
    )
    .await;

    // Reusing the *old* (consumed) refresh token is a security event → 401,
    // and it revokes the whole chain (the replacement is now unusable too).
    let (status, _) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/token/refresh",
        Some(serde_json::json!({ "refresh_token": refresh })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "reuse rejected");

    let (status2, _) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/token/refresh",
        Some(serde_json::json!({ "refresh_token": &new_refresh })),
        None,
    )
    .await;
    assert_eq!(status2, StatusCode::UNAUTHORIZED, "chain revoked by reuse");
}

#[tokio::test]
async fn logout_revokes_the_refresh_token() {
    let app = TestApp::new().await;
    let (_, refresh, _) = common::verified_user(&app).await;

    let (_, _) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/logout",
        Some(serde_json::json!({ "refresh_token": refresh })),
        None,
    )
    .await;

    let (status, _) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/token/refresh",
        Some(serde_json::json!({ "refresh_token": refresh })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "logout revoked refresh");
}

#[tokio::test]
async fn forgot_and_reset_password_then_login_with_new_password() {
    let app = TestApp::new().await;
    let (_, _, me) = common::verified_user(&app).await;
    let email = me["email"].as_str().unwrap();

    let (status, body) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/forgot-password",
        Some(serde_json::json!({ "email": email })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["message"].as_str().unwrap().contains("on its way"));

    let token = token_from_mail(&app.mailer.drain()[0].body);
    let (status, _) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/reset-password",
        Some(serde_json::json!({ "token": token, "new_password": "brand-new-pass!" })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "reset accepted");

    // Old password fails, new password works.
    let (s1, _) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/login",
        Some(serde_json::json!({ "email": email, "password": "password-1234" })),
        None,
    )
    .await;
    assert_eq!(s1, StatusCode::UNAUTHORIZED);
    let (s2, _) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/login",
        Some(serde_json::json!({ "email": email, "password": "brand-new-pass!" })),
        None,
    )
    .await;
    assert_eq!(s2, StatusCode::OK);
}

#[tokio::test]
async fn forgot_password_for_unknown_email_is_indistinguishable() {
    let app = TestApp::new().await;
    let (status, body) = req(
        app.router(),
        Method::POST,
        "/api/v1/auth/forgot-password",
        Some(serde_json::json!({ "email": "nobody@example.com" })),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "no user enumeration");
    assert!(body["message"].as_str().unwrap().contains("on its way"));
    assert_eq!(
        app.mailer.drain().len(),
        0,
        "no email sent for unknown user"
    );
}
