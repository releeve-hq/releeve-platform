//! `auth` — signup, login, verify, refresh rotation, revoke/logout,
//! password reset & change, /me, and OAuth start/callback.

pub mod accounts;
pub mod oauth_routes;
pub mod rate_limit;
pub mod sessions;

use axum::Json;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, HeaderValue, header};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use shared::Error;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::extract::AuthUser;
use crate::state::AppState;

use accounts::{create_user_with_personal_org, load_profile, rollback_account};
use sessions::{revoke_all_for_user, revoke_one};

// ---- shared response / helpers -----------------------------------------------

pub(crate) const ACCESS_COOKIE: &str = "releeve_access";
pub(crate) const REFRESH_COOKIE: &str = "releeve_refresh";

#[derive(Serialize, ToSchema)]
pub struct PairResponse {
    access_token: String,
    refresh_token: String,
    user: accounts::UserProfile,
}

async fn pair_response(
    state: &AppState,
    user_id: Uuid,
    user_agent: Option<&str>,
) -> Result<(HeaderMap, Json<PairResponse>), Error> {
    let pair = sessions::issue_pair(state, user_id, user_agent, None).await?;
    let profile = load_profile(&state.db, user_id).await?;
    Ok((
        auth_cookie_headers(state, &pair)?,
        Json(PairResponse {
            access_token: pair.access_token,
            refresh_token: pair.refresh_token,
            user: profile,
        }),
    ))
}

fn user_agent(headers: &HeaderMap) -> Option<String> {
    headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .map(String::from)
}

fn unique_or_conflict_err(err: sqlx::Error) -> Error {
    if accounts::is_unique_violation(&err) {
        Error::Conflict
    } else {
        Error::internal(err)
    }
}

pub(crate) fn cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    let raw = headers.get(header::COOKIE)?.to_str().ok()?;
    raw.split(';').find_map(|part| {
        let (key, value) = part.trim().split_once('=')?;
        (key == name).then(|| value.to_string())
    })
}

fn cookie_secure_flag(state: &AppState) -> &'static str {
    if state.settings.app_base_url.starts_with("https://") {
        "; Secure"
    } else {
        ""
    }
}

fn cookie_header_value(
    state: &AppState,
    name: &str,
    value: &str,
    max_age_seconds: i64,
) -> Result<HeaderValue, Error> {
    HeaderValue::from_str(&format!(
        "{name}={value}; Max-Age={max_age_seconds}; Path=/; HttpOnly; SameSite=Lax{}",
        cookie_secure_flag(state),
    ))
    .map_err(Error::internal)
}

pub(crate) fn auth_cookie_headers(
    state: &AppState,
    pair: &sessions::TokenPair,
) -> Result<HeaderMap, Error> {
    let mut headers = HeaderMap::new();
    headers.append(
        header::SET_COOKIE,
        cookie_header_value(
            state,
            ACCESS_COOKIE,
            &pair.access_token,
            state.settings.jwt_access_ttl,
        )?,
    );
    headers.append(
        header::SET_COOKIE,
        cookie_header_value(
            state,
            REFRESH_COOKIE,
            &pair.refresh_token,
            state.settings.jwt_refresh_ttl,
        )?,
    );
    Ok(headers)
}

fn clear_auth_cookie_headers(state: &AppState) -> Result<HeaderMap, Error> {
    let mut headers = HeaderMap::new();
    headers.append(
        header::SET_COOKIE,
        cookie_header_value(state, ACCESS_COOKIE, "", 0)?,
    );
    headers.append(
        header::SET_COOKIE,
        cookie_header_value(state, REFRESH_COOKIE, "", 0)?,
    );
    Ok(headers)
}

fn refresh_token_from(headers: &HeaderMap, body: &[u8]) -> Result<String, Error> {
    if let Some(token) = cookie_value(headers, REFRESH_COOKIE) {
        return Ok(token);
    }
    if body.is_empty() {
        return Err(Error::Unauthorized);
    }
    serde_json::from_slice::<RefreshBody>(body)
        .map(|body| body.refresh_token)
        .map_err(|_| Error::BadRequest("invalid refresh request".into()))
}

// ---- Signup -------------------------------------------------------------------

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SignupRequest {
    email: String,
    password: String,
    #[serde(default)]
    username: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct SignupResponse {
    user_id: Uuid,
    email: String,
}

/// `POST /api/v1/auth/signup` — account + personal org + verification email.
#[utoipa::path(
    post,
    path = "/api/v1/auth/signup",
    tag = "auth",
    request_body = SignupRequest,
    responses(
        (status = 200, description = "Account created", body = SignupResponse),
        (status = 400, description = "Email or password invalid"),
        (status = 409, description = "Email already registered"),
        (status = 500, description = "Internal error"),
    )
)]
pub async fn signup(
    State(state): State<AppState>,
    Json(req): Json<SignupRequest>,
) -> Result<Json<SignupResponse>, Error> {
    let email = req.email.trim().to_lowercase();
    if !email.contains('@') {
        return Err(Error::BadRequest("a valid email is required".into()));
    }
    if req.password.len() < 8 {
        return Err(Error::BadRequest(
            "password must be at least 8 characters".into(),
        ));
    }
    let password_hash = crate::password::hash_password(&req.password)?;
    let username = req.username.unwrap_or_default().trim().to_string();

    let onboarded =
        create_user_with_personal_org(&state, &email, &username, Some(&password_hash), false)
            .await?;

    let email_msg = crate::mailer::Email {
        to: email.clone(),
        subject: "Verify your Releeve email".into(),
        body: format!(
            "Welcome to Releeve. Confirm your email: {}",
            onboarded.verification_link
        ),
    };
    if let Err(e) = state.mailer.send(email_msg).await {
        tracing::error!(error = %e, "verification email failed — rolling back signup");
        rollback_account(&state, onboarded.user_id, onboarded.org_id).await;
        return Err(e);
    }

    Ok(Json(SignupResponse {
        user_id: onboarded.user_id,
        email,
    }))
}

// ---- Login ---------------------------------------------------------------------

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct LoginRequest {
    email: String,
    password: String,
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/login",
    tag = "auth",
    request_body = LoginRequest,
    responses(
        (status = 200, description = "Token pair", body = PairResponse),
        (status = 401, description = "Bad credentials"),
    )
)]
pub async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<LoginRequest>,
) -> Result<(HeaderMap, Json<PairResponse>), Error> {
    let email = req.email.trim().to_lowercase();
    let row =
        sqlx::query_as::<_, (Uuid, String)>("SELECT id, password_hash FROM users WHERE email = $1")
            .bind(&email)
            .fetch_optional(&state.db)
            .await
            .map_err(Error::internal)?
            .ok_or(Error::Unauthorized)?;

    if row.1.is_empty() {
        // OAuth-only account; do not reveal its nature.
        return Err(Error::Unauthorized);
    }
    crate::password::verify_password(&req.password, &row.1)?;

    pair_response(&state, row.0, user_agent(&headers).as_deref()).await
}

// ---- Verify + resend -------------------------------------------------------------

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct VerifyRequest {
    token: String,
}

#[derive(Serialize, ToSchema)]
pub struct VerifyResponse {
    verified: bool,
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/verify",
    tag = "auth",
    request_body = VerifyRequest,
    responses(
        (status = 200, description = "Email verified", body = VerifyResponse),
        (status = 400, description = "Invalid, expired, or consumed token"),
    )
)]
pub async fn verify(
    State(state): State<AppState>,
    Json(req): Json<VerifyRequest>,
) -> Result<Json<VerifyResponse>, Error> {
    let hash = crate::tokens::hash_token(&req.token);
    let _existed = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM email_verification_tokens WHERE token_hash = $1)",
    )
    .bind(&hash)
    .fetch_one(&state.db)
    .await
    .map_err(Error::internal)?;

    let user_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        UPDATE email_verification_tokens t
           SET consumed_at = now()
        WHERE t.token_hash = $1 AND t.consumed_at IS NULL AND t.expires_at > now()
        RETURNING t.user_id
        "#,
    )
    .bind(&hash)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::BadRequest("invalid or expired token".into()))?;

    sqlx::query("UPDATE users SET email_verified = true, email_verified_at = now() WHERE id = $1")
        .bind(user_id)
        .execute(&state.db)
        .await
        .map_err(Error::internal)?;

    Ok(Json(VerifyResponse { verified: true }))
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ResendRequest {
    email: String,
}

#[derive(Serialize, ToSchema)]
pub struct ResendResponse {
    message: String,
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/resend-verification",
    tag = "auth",
    request_body = ResendRequest,
    responses(
        (status = 200, description = "Always the same response", body = ResendResponse),
        (status = 429, description = "Rate limited"),
    )
)]
pub async fn resend_verification(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ResendRequest>,
) -> Result<Json<ResendResponse>, Error> {
    let email = req.email.trim().to_lowercase();
    let ip = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("local")
        .to_string();
    let key = format!("releeve:rate:resend:{email}:{ip}");
    if rate_limit::check_and_record(&state, &key, 60).await? {
        return Err(Error::RateLimited);
    }

    let user =
        sqlx::query_as::<_, (Uuid, bool)>("SELECT id, email_verified FROM users WHERE email = $1")
            .bind(&email)
            .fetch_optional(&state.db)
            .await
            .map_err(Error::internal)?;

    if let Some((user_id, false)) = user {
        let raw = crate::tokens::generate_use_token();
        let hash = crate::tokens::hash_token(&raw);
        let expires = Utc::now() + chrono::Duration::hours(24);
        sqlx::query(
            "INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)",
        )
        .bind(user_id)
        .bind(&hash)
        .bind(expires)
        .execute(&state.db)
        .await
        .map_err(Error::internal)?;
        let link = format!("{}/auth/verify?token={raw}", state.settings.app_base_url);
        let _ = state
            .mailer
            .send(crate::mailer::Email {
                to: email,
                subject: "Verify your Releeve email".into(),
                body: link,
            })
            .await;
    }

    Ok(Json(ResendResponse {
        message: "if that account exists, a verification link is on its way".into(),
    }))
}

// ---- Refresh / logout / revoke --------------------------------------------------

#[utoipa::path(
    post,
    path = "/api/v1/auth/token/refresh",
    tag = "auth",
    request_body = RefreshBody,
    responses(
        (status = 200, description = "Rotated token pair", body = PairResponse),
        (status = 401, description = "Invalid, revoked, or reused token"),
    )
)]
pub async fn refresh(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<(HeaderMap, Json<PairResponse>), Error> {
    let refresh_token = refresh_token_from(&headers, &body)?;
    let pair = sessions::rotate(
        &state,
        &refresh_token,
        user_agent(&headers).as_deref(),
        None,
    )
    .await?;
    let profile = load_profile(&state.db, pair.user_id).await?;
    Ok((
        auth_cookie_headers(&state, &pair)?,
        Json(PairResponse {
            access_token: pair.access_token,
            refresh_token: pair.refresh_token,
            user: profile,
        }),
    ))
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RefreshBody {
    refresh_token: String,
}

#[derive(Serialize, ToSchema)]
pub struct StatusResponse {
    status: String,
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/logout",
    tag = "auth",
    request_body = RefreshBody,
    responses((status = 200, description = "Logged out", body = StatusResponse)),
)]
pub async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<(HeaderMap, Json<StatusResponse>), Error> {
    if let Ok(refresh_token) = refresh_token_from(&headers, &body) {
        revoke_one(&state, &refresh_token).await?;
    }
    Ok((
        clear_auth_cookie_headers(&state)?,
        Json(StatusResponse {
            status: "logged_out".into(),
        }),
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/token/revoke",
    tag = "auth",
    request_body = RefreshBody,
    responses((status = 200, description = "Token revoked", body = StatusResponse)),
)]
pub async fn revoke(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<(HeaderMap, Json<StatusResponse>), Error> {
    let refresh_token = refresh_token_from(&headers, &body)?;
    revoke_one(&state, &refresh_token).await?;
    Ok((
        clear_auth_cookie_headers(&state)?,
        Json(StatusResponse {
            status: "revoked".into(),
        }),
    ))
}

// ---- Password forgot / reset / change --------------------------------------------

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ForgotRequest {
    email: String,
}

#[derive(Serialize, ToSchema)]
pub struct ForgotResponse {
    message: String,
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/forgot-password",
    tag = "auth",
    request_body = ForgotRequest,
    responses(
        (status = 200, description = "Always the same response", body = ForgotResponse),
    )
)]
pub async fn forgot_password(
    State(state): State<AppState>,
    Json(req): Json<ForgotRequest>,
) -> Result<Json<ForgotResponse>, Error> {
    let email = req.email.trim().to_lowercase();
    let user = sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE email = $1")
        .bind(&email)
        .fetch_optional(&state.db)
        .await
        .map_err(Error::internal)?;

    if let Some(user_id) = user {
        let raw = crate::tokens::generate_use_token();
        let hash = crate::tokens::hash_token(&raw);
        let expires = Utc::now() + chrono::Duration::hours(1);
        sqlx::query(
            "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)",
        )
        .bind(user_id)
        .bind(&hash)
        .bind(expires)
        .execute(&state.db)
        .await
        .map_err(Error::internal)?;
        let link = format!("{}/reset-password?token={raw}", state.settings.app_base_url);
        let _ = state
            .mailer
            .send(crate::mailer::Email {
                to: email,
                subject: "Reset your Releeve password".into(),
                body: link,
            })
            .await;
    }

    Ok(Json(ForgotResponse {
        message: "if that account exists, a reset link is on its way".into(),
    }))
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ResetRequest {
    token: String,
    new_password: String,
}

#[derive(Serialize, ToSchema)]
pub struct ResetResponse {
    message: String,
}

#[utoipa::path(
    post,
    path = "/api/v1/auth/reset-password",
    tag = "auth",
    request_body = ResetRequest,
    responses(
        (status = 200, description = "Password reset", body = ResetResponse),
        (status = 400, description = "Invalid/expired token or weak password"),
    )
)]
pub async fn reset_password(
    State(state): State<AppState>,
    Json(req): Json<ResetRequest>,
) -> Result<Json<ResetResponse>, Error> {
    if req.new_password.len() < 8 {
        return Err(Error::BadRequest(
            "password must be at least 8 characters".into(),
        ));
    }
    let hash = crate::tokens::hash_token(&req.token);
    let user_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        UPDATE password_reset_tokens t
           SET consumed_at = now()
        WHERE t.token_hash = $1 AND t.consumed_at IS NULL AND t.expires_at > now()
        RETURNING t.user_id
        "#,
    )
    .bind(&hash)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::BadRequest("invalid or expired token".into()))?;

    let password_hash = crate::password::hash_password(&req.new_password)?;
    sqlx::query("UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1")
        .bind(user_id)
        .bind(&password_hash)
        .execute(&state.db)
        .await
        .map_err(Error::internal)?;

    revoke_all_for_user(&state.db, user_id).await?;

    Ok(Json(ResetResponse {
        message: "password updated".into(),
    }))
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ChangePasswordRequest {
    current_password: String,
    new_password: String,
}

#[derive(Serialize, ToSchema)]
pub struct ChangePasswordResponse {
    message: String,
}

#[utoipa::path(
    post,
    path = "/api/v1/me/password",
    tag = "auth",
    security(("AuthorizationBearer" = [])),
    request_body = ChangePasswordRequest,
    responses(
        (status = 200, description = "Password changed", body = ChangePasswordResponse),
        (status = 400, description = "Weak password or OAuth-only account"),
        (status = 401, description = "Wrong current password"),
    )
)]
pub async fn change_password(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Json(req): Json<ChangePasswordRequest>,
) -> Result<Json<ChangePasswordResponse>, Error> {
    let current_hash = accounts::password_hash_for(&state.db, user_id).await?;
    let Some(hash) = current_hash else {
        return Err(Error::BadRequest(
            "OAuth-only accounts have no password here".into(),
        ));
    };
    crate::password::verify_password(&req.current_password, &hash)?;

    let new_hash = crate::password::hash_password(&req.new_password)?;
    sqlx::query("UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1")
        .bind(user_id)
        .bind(&new_hash)
        .execute(&state.db)
        .await
        .map_err(Error::internal)?;

    revoke_all_for_user(&state.db, user_id).await?;

    Ok(Json(ChangePasswordResponse {
        message: "password updated".into(),
    }))
}

// ---- /me --------------------------------------------------------------------------

#[utoipa::path(
    get,
    path = "/api/v1/me",
    tag = "auth",
    security(("AuthorizationBearer" = [])),
    responses(
        (status = 200, description = "The caller's profile", body = accounts::UserProfile),
        (status = 401, description = "Missing/invalid token"),
    )
)]
pub async fn me(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
) -> Result<Json<accounts::UserProfile>, Error> {
    Ok(Json(load_profile(&state.db, user_id).await?))
}

#[derive(Serialize, ToSchema)]
pub struct MyOrg {
    pub id: Uuid,
    pub slug: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub is_personal: bool,
    pub permissions: Vec<shared::Permission>,
    pub is_owner: bool,
}

#[utoipa::path(
    get,
    path = "/api/v1/me/organizations",
    tag = "auth",
    security(("AuthorizationBearer" = [])),
    responses(
        (status = 200, description = "The caller's organizations", body = Vec<MyOrg>),
        (status = 401, description = "Invalid token"),
    )
)]
pub async fn my_organizations(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
) -> Result<Json<Vec<MyOrg>>, Error> {
    let rows = sqlx::query_as::<_, (Uuid, String, Option<String>, Option<String>, bool, i16, bool)>(
        r#"
        SELECT o.id, o.slug, o.name, o.avatar_url, o.is_personal, m.permissions, o.owner_user_id = $1
        FROM organization_members m
        JOIN organizations o ON o.id = m.organization_id
        WHERE m.user_id = $1
        ORDER BY o.created_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(&state.db)
    .await
    .map_err(Error::internal)?;
    Ok(Json(
        rows.into_iter()
            .map(|r| MyOrg {
                id: r.0,
                slug: r.1,
                name: r.2,
                avatar_url: r.3,
                is_personal: r.4,
                permissions: shared::PermissionSet(r.5).iter(),
                is_owner: r.6,
            })
            .collect(),
    ))
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateMeRequest {
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    avatar_url: Option<String>,
}

#[utoipa::path(
    patch,
    path = "/api/v1/me",
    tag = "auth",
    security(("AuthorizationBearer" = [])),
    request_body = UpdateMeRequest,
    responses(
        (status = 200, description = "Updated profile", body = accounts::UserProfile),
        (status = 401, description = "Invalid token"),
        (status = 409, description = "Username already taken"),
    )
)]
pub async fn update_me(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Json(req): Json<UpdateMeRequest>,
) -> Result<Json<accounts::UserProfile>, Error> {
    let current = load_profile(&state.db, user_id).await?;
    let username = req
        .username
        .clone()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| current.username.clone());
    sqlx::query(
        "UPDATE users SET username = $2, avatar_url = $3, updated_at = now() WHERE id = $1",
    )
    .bind(user_id)
    .bind(username.map(|s| s.trim().to_string()))
    .bind(&req.avatar_url)
    .execute(&state.db)
    .await
    .map_err(unique_or_conflict_err)?;

    Ok(Json(load_profile(&state.db, user_id).await?))
}
