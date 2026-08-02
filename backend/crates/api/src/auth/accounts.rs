//! User + personal-organization onboarding and profile helpers.
//!
//! Personal-org creation is atomic with signup and rolls back cleanly if the
//! verification email cannot be dispatched afterwards.

use chrono::Utc;
use serde::Serialize;
use shared::Error;
use sqlx::PgPool;
use uuid::Uuid;

use crate::state::AppState;
use crate::tokens::{generate_use_token, hash_token};

/// A newly onboarded account's state, handed back to the caller.
pub struct Onboarded {
    pub user_id: Uuid,
    pub org_id: Uuid,
    pub verification_raw: String,
    pub verification_link: String,
}

/// Create a user + an unnamed personal org + an owner membership atomically.
/// When `email_verified` is false, an email-verification token is issued and
/// its raw value returned (returned exactly once; only the hash is stored).
pub async fn create_user_with_personal_org(
    state: &AppState,
    email: &str,
    username: &str,
    password_hash: Option<&str>,
    email_verified: bool,
) -> Result<Onboarded, Error> {
    let email = email.trim().to_lowercase();
    let app_base_url = state.settings.app_base_url.clone();

    let mut tx = state.db.begin().await.map_err(Error::internal)?;

    // 1. User.
    let user_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO users (email, username, password_hash, email_verified, email_verified_at)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
        "#,
    )
    .bind(&email)
    .bind(if username.is_empty() {
        None
    } else {
        Some(username)
    })
    .bind(password_hash)
    .bind(email_verified)
    .bind(if email_verified {
        Some(Utc::now())
    } else {
        None
    })
    .fetch_one(&mut *tx)
    .await
    .map_err(unique_or_conflict_err)?;

    // 2. Personal (unnamed) org + owner membership.
    let org_id = insert_personal_org(&mut tx, &user_id).await?;

    // 3. Email-verification token unless pre-verified.
    let (verification_raw, verification_link) = if email_verified {
        (String::new(), String::new())
    } else {
        let raw = generate_use_token();
        let hash = hash_token(&raw);
        let expires = Utc::now() + chrono::Duration::hours(24);
        sqlx::query(
            r#"
            INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
            VALUES ($1, $2, $3)
            "#,
        )
        .bind(user_id)
        .bind(&hash)
        .bind(expires)
        .execute(&mut *tx)
        .await
        .map_err(Error::internal)?;
        let link = format!("{app_base_url}/auth/verify?token={raw}");
        (raw, link)
    };

    tx.commit().await.map_err(Error::internal)?;

    Ok(Onboarded {
        user_id,
        org_id,
        verification_raw,
        verification_link,
    })
}

/// Compensate for a failed post-commit email dispatch: delete the org (cascades
/// memberships) then the user (cascades tokens). Best-effort.
pub async fn rollback_account(state: &AppState, user_id: Uuid, org_id: Uuid) {
    let _ = sqlx::query("DELETE FROM organizations WHERE id = $1")
        .bind(org_id)
        .execute(&state.db)
        .await;
    let _ = sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(user_id)
        .execute(&state.db)
        .await;
}

async fn insert_personal_org<'c>(
    tx: &mut sqlx::Transaction<'c, sqlx::Postgres>,
    user_id: &Uuid,
) -> Result<Uuid, Error> {
    let org_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO organizations (slug, name, is_personal, plan_tier)
        VALUES ($1, NULL, true, 'free')
        RETURNING id
        "#,
    )
    .bind(make_personal_slug(user_id))
    .fetch_one(&mut **tx)
    .await
    .map_err(Error::internal)?;

    sqlx::query(
        r#"
        INSERT INTO organization_members (organization_id, user_id, permissions)
        VALUES ($1, $2, $3)
        "#,
    )
    .bind(org_id)
    .bind(user_id)
    .bind(shared::PermissionSet::all().raw())
    .execute(&mut **tx)
    .await
    .map_err(Error::internal)?;

    Ok(org_id)
}

fn make_personal_slug(user_id: &Uuid) -> String {
    let short = &user_id.simple().to_string()[..8];
    format!("user-{short}")
}

fn unique_or_conflict_err(e: sqlx::Error) -> Error {
    if let sqlx::Error::Database(db) = &e
        && db.is_unique_violation()
    {
        return Error::Conflict;
    }
    Error::internal(e)
}

/// Whether an sqlx error is a uniqueness violation (username/email/org slug).
pub fn is_unique_violation(e: &sqlx::Error) -> bool {
    match e {
        sqlx::Error::Database(db) => db.is_unique_violation(),
        _ => false,
    }
}

// ---- User profile ---------------------------------------------------------

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct UserProfile {
    pub id: Uuid,
    pub email: String,
    pub username: Option<String>,
    pub avatar_url: Option<String>,
    pub email_verified: bool,
    pub created_at: chrono::DateTime<Utc>,
}

pub async fn load_profile(pool: &PgPool, user_id: Uuid) -> Result<UserProfile, Error> {
    let row = sqlx::query_as::<
        _,
        (
            Uuid,
            String,
            Option<String>,
            Option<String>,
            bool,
            chrono::DateTime<Utc>,
        ),
    >(
        r#"
        SELECT id, email, username, avatar_url, email_verified, created_at
        FROM users WHERE id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)?;

    Ok(UserProfile {
        id: row.0,
        email: row.1,
        username: row.2,
        avatar_url: row.3,
        email_verified: row.4,
        created_at: row.5,
    })
}

/// The user's current password hash, if one exists (OAuth-only → None).
pub async fn password_hash_for(pool: &PgPool, user_id: Uuid) -> Result<Option<String>, Error> {
    sqlx::query_scalar::<_, String>("SELECT password_hash FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .map_err(Error::internal)
        .map(|v| v.and_then(|s| (!s.is_empty()).then_some(s)))
}
