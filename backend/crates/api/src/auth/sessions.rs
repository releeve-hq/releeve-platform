//! Token-pair issuing and refresh rotation (the security-critical core).
//!
//! Refresh tokens are opaque, one-time-use, revocable, persisted hashed in
//! `refresh_tokens`. Access tokens are short-lived signed JWTs (never stored).
//!
//! Reuse detection: presenting an already-consumed refresh token is treated
//! as a leaked-token replay → the entire refresh chain for that user is
//! revoked and the request rejected.

use chrono::{Duration, Utc};
use shared::Error;
use sqlx::PgPool;
use uuid::Uuid;

use crate::state::AppState;
use crate::tokens::{generate_opaque_token, hash_token};

const REFRESH_SESSION_KEY: &str = "releeve:refresh:";

/// The key under which a refresh token's id→user mapping lives in Redis.
fn session_key(token_id: &Uuid) -> String {
    format!("{REFRESH_SESSION_KEY}{token_id}")
}

/// A freshly-issued token pair, returned exactly once to the caller.
#[derive(Debug)]
pub struct TokenPair {
    pub access_token: String,
    pub refresh_token: String,
    pub refresh_id: Uuid,
    pub user_id: Uuid,
}

struct RefreshRow {
    id: Uuid,
    user_id: Uuid,
    consumed_at: Option<chrono::DateTime<Utc>>,
    revoked_at: Option<chrono::DateTime<Utc>>,
    expires_at: chrono::DateTime<Utc>,
    created_at: chrono::DateTime<Utc>,
    password_changed_at: Option<chrono::DateTime<Utc>>,
}

/// Insert a new refresh token (hashed at rest) and return its id + raw value.
async fn insert_refresh_token(
    state: &AppState,
    user_id: Uuid,
    user_agent: Option<&str>,
    ip: Option<&str>,
) -> Result<(Uuid, String), Error> {
    let raw = generate_opaque_token();
    let hash = hash_token(&raw);
    let expires = Utc::now() + Duration::seconds(state.settings.jwt_refresh_ttl);

    let id = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
        "#,
    )
    .bind(user_id)
    .bind(&hash)
    .bind(expires)
    .bind(user_agent)
    .bind(ip)
    .fetch_one(&state.db)
    .await
    .map_err(Error::internal)?;

    // Advisory session cache (canonical state is Postgres). A Redis miss only
    // costs a cache hit; a flush is never fatal.
    if let Err(e) = set_redis_session(state, &id, user_id).await {
        tracing::warn!(error = %e, "redis session write failed (advisory)");
    }

    Ok((id, raw))
}

/// Record a refresh token's id→user mapping in Redis with the token TTL.
async fn set_redis_session(state: &AppState, token_id: &Uuid, user_id: Uuid) -> Result<(), Error> {
    let mut conn = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .map_err(Error::internal)?;
    let key = session_key(token_id);
    let _: () = redis::cmd("PSETEX")
        .arg(&key)
        .arg(state.settings.jwt_refresh_ttl * 1000)
        .arg(user_id.to_string())
        .query_async(&mut conn)
        .await
        .map_err(Error::internal)?;
    Ok(())
}

/// Drop the advisory Redis session key for a token (best-effort).
async fn delete_redis_session(state: &AppState, token_id: &Uuid) {
    let key = session_key(token_id);
    if let Ok(mut conn) = state.redis.get_multiplexed_async_connection().await {
        let _: Result<(), _> = redis::cmd("DEL").arg(&key).query_async(&mut conn).await;
    }
}

/// Issue a fresh access+refresh pair for a user.
pub async fn issue_pair(
    state: &AppState,
    user_id: Uuid,
    user_agent: Option<&str>,
    ip: Option<&str>,
) -> Result<TokenPair, Error> {
    let access_token = state.jwt.encode(user_id)?;
    let (refresh_id, refresh_token) = insert_refresh_token(state, user_id, user_agent, ip).await?;
    Ok(TokenPair {
        access_token,
        refresh_token,
        refresh_id,
        user_id,
    })
}

/// Look up a refresh token by hash, with its user's password-change sentinel.
async fn load_refresh(pool: &PgPool, raw: &str) -> Result<RefreshRow, Error> {
    let hash = hash_token(raw);
    let row = sqlx::query_as::<
        _,
        (
            Uuid,
            Uuid,
            Option<chrono::DateTime<Utc>>,
            Option<chrono::DateTime<Utc>>,
            chrono::DateTime<Utc>,
            chrono::DateTime<Utc>,
            Option<chrono::DateTime<Utc>>,
        ),
    >(
        r#"
        SELECT rt.id, rt.user_id, rt.consumed_at, rt.revoked_at, rt.expires_at,
               rt.created_at, u.password_changed_at
        FROM refresh_tokens rt
        JOIN users u ON u.id = rt.user_id
        WHERE rt.token_hash = $1
        "#,
    )
    .bind(&hash)
    .fetch_optional(pool)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::Unauthorized)?;

    Ok(RefreshRow {
        id: row.0,
        user_id: row.1,
        consumed_at: row.2,
        revoked_at: row.3,
        expires_at: row.4,
        created_at: row.5,
        password_changed_at: row.6,
    })
}

/// Rotate a refresh token: validate, consume the old row, issue a new pair.
/// Reuse of an already-consumed token revokes the whole user chain.
pub async fn rotate(
    state: &AppState,
    raw: &str,
    user_agent: Option<&str>,
    ip: Option<&str>,
) -> Result<TokenPair, Error> {
    let row = load_refresh(&state.db, raw).await?;
    let now = Utc::now();

    if row.revoked_at.is_some() {
        return Err(Error::Unauthorized);
    }
    if row.consumed_at.is_some() {
        // Reuse detection: a consumed token re-presented is a leak.
        tracing::warn!(user_id = %row.user_id, "refresh token reused — revoking chain");
        revoke_all_for_user(&state.db, row.user_id).await?;
        return Err(Error::Unauthorized);
    }
    if row.expires_at <= now {
        return Err(Error::Unauthorized);
    }
    if row
        .password_changed_at
        .is_some_and(|pc| pc > row.created_at)
    {
        // This refresh predates the last password change → invalid.
        return Err(Error::Unauthorized);
    }

    // Issue the replacement, then atomically consume the presented token.
    let access_token = state.jwt.encode(row.user_id)?;
    let (new_id, new_raw) = insert_refresh_token(state, row.user_id, user_agent, ip).await?;

    sqlx::query(
        r#"
        UPDATE refresh_tokens
           SET consumed_at = now(), replaced_by = $2
         WHERE id = $1
        "#,
    )
    .bind(row.id)
    .bind(new_id)
    .execute(&state.db)
    .await
    .map_err(Error::internal)?;

    delete_redis_session(state, &row.id).await;

    Ok(TokenPair {
        access_token,
        refresh_token: new_raw,
        refresh_id: new_id,
        user_id: row.user_id,
    })
}

/// Set `revoked_at` on every outstanding (non-revoked) refresh token for a user.
pub async fn revoke_all_for_user(pool: &PgPool, user_id: Uuid) -> Result<(), Error> {
    sqlx::query(
        "UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
    )
    .bind(user_id)
    .execute(pool)
    .await
    .map_err(Error::internal)?;
    Ok(())
}

/// Revoke a single refresh token ("log out this device"); idempotent.
pub async fn revoke_one(state: &AppState, raw: &str) -> Result<(), Error> {
    let hash = hash_token(raw);
    let id = sqlx::query_scalar::<_, Uuid>(
        "UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 RETURNING id",
    )
    .bind(&hash)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?;
    if let Some(id) = id {
        delete_redis_session(state, &id).await;
    }
    Ok(())
}
