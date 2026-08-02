//! OAuth `start` and `callback` handlers.

use axum::Json;
use axum::extract::{Path, Query, State};
use serde::{Deserialize, Serialize};
use shared::Error;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::auth::accounts::{create_user_with_personal_org, rollback_account};
use crate::auth::sessions::issue_pair;
use crate::oauth::OAuthProvider;
use crate::state::AppState;

const STATE_TTL_SECS: i64 = 600;
const OAUTH_STATE_KEY: &str = "releeve:oauth_state:";

fn oauth_state_key(raw_state: &str) -> String {
    format!("{OAUTH_STATE_KEY}{raw_state}")
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct StartRequest {
    /// The frontend URL the callback should hand the tokens back to.
    pub redirect_uri: String,
}

#[derive(Serialize, ToSchema)]
pub struct StartResponse {
    pub auth_url: String,
    pub state: String,
}

/// `POST /api/v1/auth/oauth/{provider}/start`
#[utoipa::path(
    post,
    path = "/api/v1/auth/oauth/{provider}/start",
    tag = "oauth",
    request_body = StartRequest,
    params(("provider" = String, Path, description = "github or google")),
    responses(
        (status = 200, description = "Provider auth URL + CSRF state", body = StartResponse),
        (status = 400, description = "Unknown provider"),
    )
)]
pub async fn start(
    State(state): State<AppState>,
    Path(provider): Path<String>,
    Json(req): Json<StartRequest>,
) -> Result<Json<StartResponse>, Error> {
    let provider = OAuthProvider::parse(&provider)?;
    let state_raw = crate::tokens::generate_use_token();

    // Store the CSRF state + redirect target briefly (Redis; advisory).
    store_oauth_state(&state, &state_raw, &req.redirect_uri).await?;

    let auth_url = state.oauth.auth_url(provider, &state_raw);
    Ok(Json(StartResponse {
        auth_url,
        state: state_raw,
    }))
}

#[derive(Deserialize, ToSchema)]
pub struct CallbackParams {
    pub code: String,
    pub state: String,
}

/// `GET /api/v1/auth/oauth/{provider}/callback?code&state`
#[utoipa::path(
    get,
    path = "/api/v1/auth/oauth/{provider}/callback",
    tag = "oauth",
    params(
        ("provider" = String, Path, description = "github or google"),
        ("code" = String, Query, description = "Authorization code"),
        ("state" = String, Query, description = "CSRF state issued by start"),
    ),
    responses(
        (status = 200, description = "Authenticated pair (new account or linked)", body = crate::auth::PairResponse),
        (status = 400, description = "Missing/invalid CSRF state"),
        (status = 502, description = "Provider token/userinfo exchange failed"),
        (status = 409, description = "Already linked to another account"),
    )
)]
pub async fn callback(
    State(state): State<AppState>,
    Path(provider): Path<String>,
    Query(params): Query<CallbackParams>,
) -> Result<Json<serde_json::Value>, Error> {
    let provider = OAuthProvider::parse(&provider)?;

    // 1. Verify CSRF `state`; recover the saved redirect target (single-use).
    let redirect_uri = fetch_oauth_state(&state, &params.state)
        .await
        .ok_or(Error::BadRequest("invalid or missing state".into()))?;

    // 2. Exchange the code for a provider identity.
    let identity = state.oauth.exchange_code(provider, &params.code).await?;

    // 3. Resolve an existing account or auto-provision a new one.
    let user_id = resolve_identity(&state, &identity, provider, &identity.provider_id).await?;

    // 4. Issue the same token pair as login.
    let pair = issue_pair(&state, user_id, None, None).await?;

    Ok(Json(serde_json::json!({
        "redirect_uri": redirect_uri,
        "access_token": pair.access_token,
        "refresh_token": pair.refresh_token,
        "user_id": user_id,
    })))
}

async fn store_oauth_state(
    state: &AppState,
    raw_state: &str,
    redirect_uri: &str,
) -> Result<(), Error> {
    let key = oauth_state_key(raw_state);
    let mut conn = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .map_err(Error::internal)?;
    let _: () = redis::cmd("PSETEX")
        .arg(&key)
        .arg(STATE_TTL_SECS * 1000)
        .arg(redirect_uri)
        .query_async(&mut conn)
        .await
        .map_err(Error::internal)?;
    Ok(())
}

/// Fetch (and consume) the redirect target bound to a CSRF state.
async fn fetch_oauth_state(state: &AppState, raw_state: &str) -> Option<String> {
    let key = oauth_state_key(raw_state);
    let mut conn = state.redis.get_multiplexed_async_connection().await.ok()?;
    let value: String = redis::cmd("GETDEL")
        .arg(&key)
        .query_async(&mut conn)
        .await
        .ok()?;
    Some(value)
}

/// Link an external identity to an existing account or auto-provision a user.
async fn resolve_identity(
    state: &AppState,
    identity: &crate::oauth::ProviderIdentity,
    provider: OAuthProvider,
    provider_id: &str,
) -> Result<Uuid, Error> {
    // 1) Account that already linked this provider.
    if let Some(id) = user_id_by_link(&state.db, provider, provider_id).await? {
        return Ok(id);
    }

    // 2) Existing account with a matching email → link it.
    if let Some(existing) = user_id_by_email(&state.db, &identity.email).await? {
        link_provider(&state.db, existing, provider, provider_id).await?;
        return Ok(existing);
    }

    // 3) Auto-provision a verified user + personal org.
    let onboarded = create_user_with_personal_org(state, &identity.email, "", None, true).await?;
    if let Err(e) = link_provider(&state.db, onboarded.user_id, provider, provider_id).await {
        rollback_account(state, onboarded.user_id, onboarded.org_id).await;
        return Err(e);
    }
    Ok(onboarded.user_id)
}

async fn user_id_by_email(pool: &sqlx::PgPool, email: &str) -> Result<Option<Uuid>, Error> {
    sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE email = $1")
        .bind(email)
        .fetch_optional(pool)
        .await
        .map_err(Error::internal)
}

async fn user_id_by_link(
    pool: &sqlx::PgPool,
    provider: OAuthProvider,
    provider_id: &str,
) -> Result<Option<Uuid>, Error> {
    sqlx::query_scalar::<_, Uuid>(
        "SELECT user_id FROM user_oauth_accounts WHERE provider = $1 AND provider_id = $2",
    )
    .bind(provider.as_str())
    .bind(provider_id)
    .fetch_optional(pool)
    .await
    .map_err(Error::internal)
}

async fn link_provider(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    provider: OAuthProvider,
    provider_id: &str,
) -> Result<(), Error> {
    sqlx::query(
        r#"
        INSERT INTO user_oauth_accounts (user_id, provider, provider_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (provider, provider_id) DO NOTHING
        "#,
    )
    .bind(user_id)
    .bind(provider.as_str())
    .bind(provider_id)
    .execute(pool)
    .await
    .map_err(Error::internal)?;
    Ok(())
}
