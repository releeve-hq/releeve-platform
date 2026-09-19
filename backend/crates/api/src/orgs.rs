//! Organizations, members, access tokens, and projects — CRUD with the flat
//! permission model and the email-verified gate.

use axum::Json;
use axum::extract::{Path, Query, State};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use shared::{Cursor, Error, Paged, Pagination, Permission, PermissionSet, Role, clamp_limit};
use uuid::Uuid;

use crate::auth::accounts::is_unique_violation;
use crate::extract::AuthUser;
use crate::state::AppState;
use crate::tokens::{generate_opaque_token, hash_token};

fn unique_or_conflict(e: sqlx::Error) -> Error {
    if is_unique_violation(&e) {
        Error::Conflict
    } else {
        Error::internal(e)
    }
}

fn slugify(input: &str) -> String {
    let mut out = String::new();
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if (ch == '-' || ch == '_') && !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
    }
    let t = out.trim_matches('-');
    if t.is_empty() {
        "org".to_string()
    } else {
        t.to_string()
    }
}

fn link_cursor(id: Uuid, created_at: DateTime<Utc>) -> String {
    Cursor::new(created_at.to_rfc3339(), id.to_string()).encode()
}

fn into_page<T>(
    data: Vec<T>,
    cursors: Vec<(Uuid, DateTime<Utc>)>,
    limit: i64,
    had_cursor: bool,
) -> Paged<T> {
    let has_more = data.len() as i64 > limit;
    let data: Vec<T> = data.into_iter().take(limit as usize).collect();
    let cursors: Vec<(Uuid, DateTime<Utc>)> = cursors.into_iter().take(limit as usize).collect();
    let next = if has_more {
        cursors.last().map(|(id, ts)| link_cursor(*id, *ts))
    } else {
        None
    };
    let prev = if had_cursor {
        cursors.first().map(|(id, ts)| link_cursor(*id, *ts))
    } else {
        None
    };
    Paged {
        data,
        pagination: Pagination {
            limit,
            next_cursor: next,
            prev_cursor: prev,
        },
    }
}

#[derive(Deserialize)]
pub struct PagingQuery {
    #[serde(default)]
    limit: Option<i64>,
    #[serde(default)]
    cursor: Option<String>,
}

fn cursor_opt(raw: &Option<String>) -> Result<Option<(DateTime<Utc>, Uuid)>, Error> {
    match raw.as_deref() {
        Some(s) if !s.is_empty() => {
            let c = Cursor::decode(s).map_err(|_| Error::BadRequest("malformed cursor".into()))?;
            let ts = DateTime::parse_from_rfc3339(&c.sort_key)
                .map_err(|_| Error::BadRequest("malformed cursor".into()))?
                .with_timezone(&Utc);
            let id = Uuid::parse_str(&c.stable_id)
                .map_err(|_| Error::BadRequest("malformed cursor".into()))?;
            Ok(Some((ts, id)))
        }
        _ => Ok(None),
    }
}

// ---- authorization -----------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct OrgAuth {
    pub org_id: Uuid,
    pub slug: String,
    pub email_verified: bool,
    owner: bool,
    perms: PermissionSet,
}

impl OrgAuth {
    pub fn require(&self, p: Permission) -> Result<(), Error> {
        if self.perms.contains(p) {
            Ok(())
        } else {
            Err(Error::Forbidden)
        }
    }
    pub fn require_verified(&self) -> Result<(), Error> {
        if self.email_verified {
            Ok(())
        } else {
            Err(Error::EmailUnverified)
        }
    }
    pub fn is_owner(&self) -> bool {
        self.owner
    }
}

async fn resolve_org(state: &AppState, user_id: Uuid, slug: &str) -> Result<OrgAuth, Error> {
    let row = sqlx::query_as::<_, (Uuid, String, bool, bool, i16, String)>(
        r#"
        SELECT o.id, o.slug, u.email_verified, o.owner_user_id = $1, m.permissions, m.status
        FROM organizations o
        JOIN organization_members m ON m.organization_id = o.id AND m.user_id = $1
        JOIN users u ON u.id = m.user_id
        WHERE o.slug = $2
        "#,
    )
    .bind(user_id)
    .bind(slug)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?;
    let (org_id, slug, email_verified, owner, raw, status) = row.ok_or(Error::NotFound)?;
    if status != "active" {
        return Err(Error::Forbidden);
    }
    Ok(OrgAuth {
        org_id,
        slug,
        email_verified,
        owner,
        perms: PermissionSet(raw),
    })
}

// ---- Organizations -------------------------------------------------------------------

#[derive(Serialize)]
pub struct OrgSummary {
    pub id: Uuid,
    pub slug: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub is_personal: bool,
    pub plan_tier: String,
    pub owner_user_id: Uuid,
    pub is_owner: bool,
}

async fn load_org(pool: &sqlx::PgPool, slug: &str, viewer: &Uuid) -> Result<OrgSummary, Error> {
    let r = sqlx::query_as::<_, (Uuid, String, Option<String>, Option<String>, bool, String, Uuid)>(
        "SELECT id, slug, name, avatar_url, is_personal, plan_tier, owner_user_id FROM organizations WHERE slug = $1",
    )
    .bind(slug)
    .fetch_optional(pool)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)?;
    Ok(OrgSummary {
        id: r.0,
        slug: r.1,
        name: r.2,
        avatar_url: r.3,
        is_personal: r.4,
        plan_tier: r.5,
        owner_user_id: r.6,
        is_owner: r.6 == *viewer,
    })
}

pub async fn get_org(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path(org): Path<String>,
) -> Result<Json<OrgSummary>, Error> {
    resolve_org(&state, user_id, &org).await?;
    Ok(Json(load_org(&state.db, &org, &user_id).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RenameOrg {
    name: String,
    #[serde(default)]
    avatar_url: Option<String>,
}

pub async fn rename_org(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path(org): Path<String>,
    Json(req): Json<RenameOrg>,
) -> Result<Json<OrgSummary>, Error> {
    let auth = resolve_org(&state, user_id, &org).await?;
    if !auth.is_owner() {
        return Err(Error::Forbidden);
    }
    auth.require_verified()?;
    sqlx::query(
        "UPDATE organizations SET name = $2, avatar_url = $3, updated_at = now() WHERE id = $1",
    )
    .bind(auth.org_id)
    .bind(req.name.trim())
    .bind(
        req.avatar_url
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty()),
    )
    .execute(&state.db)
    .await
    .map_err(Error::internal)?;
    Ok(Json(load_org(&state.db, &auth.slug, &user_id).await?))
}

pub async fn delete_org(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path(org): Path<String>,
) -> Result<Json<serde_json::Value>, Error> {
    let auth = resolve_org(&state, user_id, &org).await?;
    if !auth.is_owner() {
        return Err(Error::Forbidden);
    }
    let deleted = sqlx::query("DELETE FROM organizations WHERE id = $1 AND owner_user_id = $2")
        .bind(auth.org_id)
        .bind(user_id)
        .execute(&state.db)
        .await
        .map_err(Error::internal)?
        .rows_affected();
    if deleted == 0 {
        return Err(Error::Forbidden);
    }
    Ok(Json(serde_json::json!({ "deleted": true })))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateOrgRequest {
    name: String,
    #[serde(default)]
    slug: Option<String>,
}

pub async fn create_org(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Json(req): Json<CreateOrgRequest>,
) -> Result<Json<OrgSummary>, Error> {
    let base = req.slug.unwrap_or_else(|| slugify(&req.name));
    let slug = unique_slug(&state.db, &base, 0).await?;
    let mut tx = state.db.begin().await.map_err(Error::internal)?;
    let org_id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO organizations (slug, name, is_personal, plan_tier, owner_user_id) VALUES ($1,$2,false,'free',$3) RETURNING id",
    )
    .bind(&slug)
    .bind(req.name.trim())
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(unique_or_conflict)?;
    sqlx::query(
        "INSERT INTO organization_members (organization_id, user_id, permissions) VALUES ($1,$2,$3)",
    )
    .bind(org_id)
    .bind(user_id)
    .bind(PermissionSet::all().raw())
    .execute(&mut *tx)
    .await
    .map_err(Error::internal)?;
    tx.commit().await.map_err(Error::internal)?;
    Ok(Json(load_org(&state.db, &slug, &user_id).await?))
}

async fn unique_slug(pool: &sqlx::PgPool, base: &str, mut attempt: u32) -> Result<String, Error> {
    loop {
        let candidate = if attempt == 0 {
            base.to_string()
        } else {
            format!("{base}-{attempt}")
        };
        let taken: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM organizations WHERE slug = $1)")
                .bind(&candidate)
                .fetch_one(pool)
                .await
                .map_err(Error::internal)?;
        if !taken {
            return Ok(candidate);
        }
        attempt += 1;
    }
}

// ---- Members ------------------------------------------------------------------------

type MemberRow = (
    Uuid,
    Uuid,
    String,
    Option<String>,
    i16,
    DateTime<Utc>,
    bool,
    String,
);

#[derive(Serialize)]
pub struct MemberSummary {
    pub id: Uuid,
    pub user_id: Uuid,
    pub email: String,
    pub username: Option<String>,
    pub permissions: Vec<Permission>,
    pub role: String,
    pub status: String,
    pub is_owner: bool,
    pub created_at: DateTime<Utc>,
}

fn member_summary_from_row(
    id: Uuid,
    user_id: Uuid,
    email: String,
    username: Option<String>,
    permissions_raw: i16,
    created_at: DateTime<Utc>,
    is_owner: bool,
    status: String,
) -> MemberSummary {
    let set = PermissionSet(permissions_raw);
    MemberSummary {
        id,
        user_id,
        email,
        username,
        permissions: set.iter(),
        role: Role::for_permissions(is_owner, set).as_str().to_string(),
        status,
        is_owner,
        created_at,
    }
}

const MEMBER_SELECT: &str = "SELECT m.id, m.user_id, u.email, u.username, m.permissions, m.created_at, o.owner_user_id = m.user_id, m.status \
     FROM organization_members m JOIN users u ON u.id = m.user_id JOIN organizations o ON o.id = m.organization_id";

async fn fetch_members_paged(
    pool: &sqlx::PgPool,
    org_id: Uuid,
    cursor: Option<(DateTime<Utc>, Uuid)>,
    limit: i64,
) -> Result<(Vec<MemberRow>, bool), Error> {
    let had_cursor = cursor.is_some();
    let rows = if let Some((ts, id)) = cursor {
        sqlx::query_as::<_, MemberRow>(
            &format!("{MEMBER_SELECT} WHERE m.organization_id = $1 AND (m.created_at, m.id) < ($2, $3) ORDER BY m.created_at DESC, m.id DESC LIMIT {}", limit + 1),
        )
        .bind(org_id).bind(ts).bind(id).fetch_all(pool).await.map_err(Error::internal)?
    } else {
        sqlx::query_as::<_, MemberRow>(
            &format!("{MEMBER_SELECT} WHERE m.organization_id = $1 ORDER BY m.created_at DESC, m.id DESC LIMIT {}", limit + 1),
        )
        .bind(org_id).fetch_all(pool).await.map_err(Error::internal)?
    };
    Ok((rows, had_cursor))
}

pub async fn list_members(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path(org): Path<String>,
    Query(q): Query<PagingQuery>,
) -> Result<Json<Paged<MemberSummary>>, Error> {
    let auth = resolve_org(&state, user_id, &org).await?;
    let limit = clamp_limit(q.limit);
    let (rows, had_cursor) =
        fetch_members_paged(&state.db, auth.org_id, cursor_opt(&q.cursor)?, limit).await?;
    let cursors: Vec<(Uuid, DateTime<Utc>)> = rows.iter().map(|r| (r.0, r.5)).collect();
    let data: Vec<MemberSummary> = rows
        .iter()
        .map(|r| {
            member_summary_from_row(
                r.0,
                r.1,
                r.2.clone(),
                r.3.clone(),
                r.4,
                r.5,
                r.6,
                r.7.clone(),
            )
        })
        .collect();
    Ok(Json(into_page(data, cursors, limit, had_cursor)))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InviteMemberRequest {
    email: String,
    /// Named role; permissions are always derived server-side from it.
    /// Defaults to `developer`. `owner` cannot be granted here.
    #[serde(default)]
    role: Option<String>,
}

/// Conservative email shape check for invites (local part, @, dotted
/// domain, no spaces, sane lengths). Full deliverability is the mail
/// provider's job; this only rejects obvious junk before a row is stored.
fn valid_email(email: &str) -> bool {
    if email.len() > 254 || email.contains(' ') {
        return false;
    }
    let mut parts = email.split('@');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(local), Some(domain), None) => {
            !local.is_empty()
                && !domain.is_empty()
                && domain.contains('.')
                && !domain.starts_with('.')
                && !domain.ends_with('.')
        }
        _ => false,
    }
}

fn invite_role(name: &Option<String>) -> Result<Role, Error> {
    let role = Role::parse(name.as_deref().unwrap_or("member"))
        .ok_or_else(|| Error::BadRequest("unknown role; use viewer, member, or admin".into()))?;
    if role == Role::Owner {
        return Err(Error::BadRequest(
            "ownership is transferred, never granted by invite".into(),
        ));
    }
    Ok(role)
}

#[derive(Serialize)]
pub struct InvitationSummary {
    pub id: Uuid,
    pub email: String,
    pub permissions: Vec<Permission>,
    pub role: String,
    pub status: String,
    pub created_at: DateTime<Utc>,
}

/// `GET /api/v1/{org}/invitations` — pending invitations (powers the
/// members Pending filter). Requires member management.
pub async fn list_invitations(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path(org): Path<String>,
) -> Result<Json<Vec<InvitationSummary>>, Error> {
    let auth = resolve_org(&state, user_id, &org).await?;
    auth.require(Permission::ManageMembers)?;
    let rows = sqlx::query_as::<_, (Uuid, String, i16, String, DateTime<Utc>)>(
        "SELECT id, email, permissions, status, created_at FROM organization_invitations \
         WHERE organization_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 200",
    )
    .bind(auth.org_id)
    .fetch_all(&state.db)
    .await
    .map_err(Error::internal)?;
    Ok(Json(
        rows.into_iter()
            .map(|r| {
                let set = PermissionSet(r.2);
                InvitationSummary {
                    id: r.0,
                    email: r.1,
                    permissions: set.iter(),
                    role: Role::for_permissions(false, set).as_str().to_string(),
                    status: r.3,
                    created_at: r.4,
                }
            })
            .collect(),
    ))
}

/// Public invitation preview for the `/invite/{id}` landing page. Only the
/// organization identity, role, and a masked email are exposed — no
/// membership data leaks before authentication.
#[derive(Serialize)]
pub struct InvitationPreview {
    pub id: Uuid,
    pub organization_slug: String,
    pub organization_name: Option<String>,
    pub role: String,
    pub status: String,
    pub email_hint: String,
}

pub async fn preview_invitation(
    State(state): State<AppState>,
    Path(invitation_id): Path<Uuid>,
) -> Result<Json<InvitationPreview>, Error> {
    let row = sqlx::query_as::<_, (String, Option<String>, i16, String, String)>(
        "SELECT o.slug, o.name, i.permissions, i.status, i.email \
         FROM organization_invitations i JOIN organizations o ON o.id = i.organization_id \
         WHERE i.id = $1",
    )
    .bind(invitation_id)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)?;
    Ok(Json(InvitationPreview {
        id: invitation_id,
        organization_slug: row.0,
        organization_name: row.1,
        role: Role::for_permissions(false, PermissionSet(row.2))
            .as_str()
            .to_string(),
        status: row.3,
        email_hint: mask_email(&row.4),
    }))
}

fn mask_email(email: &str) -> String {
    match email.split_once('@') {
        Some((local, domain)) => {
            let shown: String = local.chars().take(2).collect();
            format!("{shown}***@{domain}")
        }
        None => "***".to_string(),
    }
}

/// Accept a pending invitation. The caller's account email must match the
/// invitation; on success they become a member with the invited fixed role
/// and the invitation is marked accepted. Idempotent for existing members.
pub async fn accept_invitation(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, invitation_id)): Path<(String, Uuid)>,
) -> Result<Json<MemberSummary>, Error> {
    let auth = resolve_org(&state, user_id, &org).await?;
    let email: String = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_one(&state.db)
        .await
        .map_err(Error::internal)?;
    let mut tx = state.db.begin().await.map_err(Error::internal)?;
    let invite = sqlx::query_as::<_, (String, i16, String)>(
        "SELECT email, permissions, status FROM organization_invitations \
         WHERE organization_id = $1 AND id = $2 FOR UPDATE",
    )
    .bind(auth.org_id)
    .bind(invitation_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)?;
    if invite.2 != "pending" {
        return Err(Error::ConflictDetail(
            "this invitation is no longer pending".into(),
        ));
    }
    if !invite.0.eq_ignore_ascii_case(&email) {
        return Err(Error::Forbidden);
    }
    let member_id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO organization_members (organization_id, user_id, permissions) VALUES ($1,$2,$3) \
         ON CONFLICT (organization_id, user_id) DO UPDATE SET permissions = EXCLUDED.permissions RETURNING id",
    )
    .bind(auth.org_id)
    .bind(user_id)
    .bind(invite.1)
    .fetch_one(&mut *tx)
    .await
    .map_err(Error::internal)?;
    sqlx::query(
        "UPDATE organization_invitations SET status = 'accepted', updated_at = now() WHERE id = $1",
    )
    .bind(invitation_id)
    .execute(&mut *tx)
    .await
    .map_err(Error::internal)?;
    tx.commit().await.map_err(Error::internal)?;
    member_summary(auth.org_id, member_id, &state.db)
        .await
        .map(Json)
}

/// Revoke a pending invitation (requires member management).
pub async fn revoke_invitation(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, invitation_id)): Path<(String, Uuid)>,
) -> Result<Json<serde_json::Value>, Error> {
    let auth = resolve_org(&state, user_id, &org).await?;
    auth.require(Permission::ManageMembers)?;
    auth.require_verified()?;
    let updated = sqlx::query(
        "UPDATE organization_invitations SET status = 'revoked', updated_at = now() \
         WHERE organization_id = $1 AND id = $2 AND status = 'pending'",
    )
    .bind(auth.org_id)
    .bind(invitation_id)
    .execute(&state.db)
    .await
    .map_err(Error::internal)?
    .rows_affected();
    if updated == 0 {
        return Err(Error::NotFound);
    }
    Ok(Json(serde_json::json!({ "revoked": true })))
}

/// Claim matching pending invitations for a freshly created user. Called
/// from signup and OAuth auto-provisioning so invitees land in their orgs
/// without a separate accept step.
pub async fn claim_invitations_for_email(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    email: &str,
) -> Result<(), Error> {
    let mut tx = pool.begin().await.map_err(Error::internal)?;
    let pending = sqlx::query_as::<_, (Uuid, Uuid, i16)>(
        "SELECT id, organization_id, permissions FROM organization_invitations \
         WHERE email = $1 AND status = 'pending' FOR UPDATE",
    )
    .bind(email.to_lowercase())
    .fetch_all(&mut *tx)
    .await
    .map_err(Error::internal)?;
    for (invitation_id, org_id, permissions) in pending {
        sqlx::query(
            "INSERT INTO organization_members (organization_id, user_id, permissions) VALUES ($1,$2,$3) \
             ON CONFLICT (organization_id, user_id) DO NOTHING",
        )
        .bind(org_id)
        .bind(user_id)
        .bind(permissions)
        .execute(&mut *tx)
        .await
        .map_err(Error::internal)?;
        sqlx::query("UPDATE organization_invitations SET status = 'accepted', updated_at = now() WHERE id = $1")
            .bind(invitation_id)
            .execute(&mut *tx)
            .await
            .map_err(Error::internal)?;
    }
    tx.commit().await.map_err(Error::internal)?;
    Ok(())
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum InviteMemberResponse {
    Member(MemberSummary),
    Invitation {
        id: Uuid,
        email: String,
        permissions: Vec<Permission>,
        role: String,
        status: String,
        created_at: DateTime<Utc>,
    },
}

pub async fn invite_member(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path(org): Path<String>,
    Json(req): Json<InviteMemberRequest>,
) -> Result<Json<InviteMemberResponse>, Error> {
    let auth = resolve_org(&state, user_id, &org).await?;
    auth.require(Permission::ManageMembers)?;
    auth.require_verified()?;

    let email = req.email.trim().to_lowercase();
    if !valid_email(&email) {
        return Err(Error::BadRequest("a valid email is required".into()));
    }
    let role = invite_role(&req.role)?;
    let permissions = role.permissions();
    let target_user = sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE email = $1")
        .bind(&email)
        .fetch_optional(&state.db)
        .await
        .map_err(Error::internal)?;

    let Some(target_user) = target_user else {
        let row = sqlx::query_as::<_, (Uuid, i16, String, DateTime<Utc>)>(
            r#"
            INSERT INTO organization_invitations (organization_id, email, permissions, invited_by, status)
            VALUES ($1,$2,$3,$4,'pending')
            ON CONFLICT (organization_id, email)
            DO UPDATE SET permissions = EXCLUDED.permissions, invited_by = EXCLUDED.invited_by, status = 'pending', updated_at = now()
            RETURNING id, permissions, status, created_at
            "#,
        )
        .bind(auth.org_id)
        .bind(&email)
        .bind(permissions.raw())
        .bind(user_id)
        .fetch_one(&state.db)
        .await
        .map_err(Error::internal)?;
        // Notify the invitee through the outbox worker; delivery failures
        // never fail the invite itself.
        let invite_link = format!(
            "{}/invite/{}",
            state.settings.app_base_url.trim_end_matches('/'),
            row.0,
        );
        if let Err(e) = crate::email_queue::enqueue(
            &state.db,
            crate::mailer::Email {
                to: email.clone(),
                subject: format!("You've been invited to {} on Releeve", auth.slug),
                body: format!(
                    "You've been invited to join {} on Releeve as {}. Accept it here: {}",
                    auth.slug,
                    role.as_str(),
                    invite_link,
                ),
                html: Some(crate::mailer::invite_email_html(
                    &auth.slug,
                    role.as_str(),
                    &invite_link,
                )),
            },
        )
        .await
        {
            tracing::warn!(error = %e, "invitation email could not be queued");
        }
        return Ok(Json(InviteMemberResponse::Invitation {
            id: row.0,
            email,
            permissions: PermissionSet(row.1).iter(),
            role: role.as_str().to_string(),
            status: row.2,
            created_at: row.3,
        }));
    };

    let member_id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO organization_members (organization_id, user_id, permissions) VALUES ($1,$2,$3) RETURNING id",
    )
    .bind(auth.org_id)
    .bind(target_user)
    .bind(permissions.raw())
    .fetch_one(&state.db)
    .await
    .map_err(unique_or_conflict)?;

    Ok(Json(InviteMemberResponse::Member(
        member_summary(auth.org_id, member_id, &state.db).await?,
    )))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PatchMemberRequest {
    /// Named role; permissions are always derived server-side from it.
    #[serde(default)]
    role: Option<String>,
    /// `active` or `suspended`.
    #[serde(default)]
    status: Option<String>,
}

pub async fn patch_member(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, member_id)): Path<(String, Uuid)>,
    Json(req): Json<PatchMemberRequest>,
) -> Result<Json<MemberSummary>, Error> {
    let auth = resolve_org(&state, user_id, &org).await?;
    auth.require(Permission::ManageMembers)?;
    auth.require_verified()?;
    let mut tx = state.db.begin().await.map_err(Error::internal)?;
    let owner_user_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT owner_user_id FROM organizations WHERE id = $1 FOR UPDATE",
    )
    .bind(auth.org_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(Error::internal)?;
    let target_user_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT user_id FROM organization_members WHERE organization_id = $1 AND id = $2 FOR UPDATE",
    )
    .bind(auth.org_id)
    .bind(member_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)?;
    if target_user_id == owner_user_id {
        return Err(Error::BadRequest(
            "the organization owner cannot be modified; transfer ownership first".into(),
        ));
    }
    if target_user_id == user_id && req.status.as_deref() == Some("suspended") {
        return Err(Error::BadRequest(
            "you cannot suspend your own membership".into(),
        ));
    }
    if req.role.is_none() && req.status.is_none() {
        return Err(Error::BadRequest(
            "nothing to update; provide role and/or status".into(),
        ));
    }
    if let Some(role) = &req.role {
        let set = invite_role(&Some(role.clone()))?.permissions();
        sqlx::query(
            "UPDATE organization_members SET permissions = $3 WHERE organization_id = $1 AND id = $2",
        )
        .bind(auth.org_id)
        .bind(member_id)
        .bind(set.raw())
        .execute(&mut *tx)
        .await
        .map_err(Error::internal)?;
    }
    if let Some(status) = &req.status {
        let status = status.trim().to_lowercase();
        if status != "active" && status != "suspended" {
            return Err(Error::BadRequest(
                "unknown status; use active or suspended".into(),
            ));
        }
        sqlx::query(
            "UPDATE organization_members SET status = $3 WHERE organization_id = $1 AND id = $2",
        )
        .bind(auth.org_id)
        .bind(member_id)
        .bind(status)
        .execute(&mut *tx)
        .await
        .map_err(Error::internal)?;
    }
    tx.commit().await.map_err(Error::internal)?;
    Ok(Json(
        member_summary(auth.org_id, member_id, &state.db).await?,
    ))
}

pub async fn remove_member(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, member_id)): Path<(String, Uuid)>,
) -> Result<Json<serde_json::Value>, Error> {
    let auth = resolve_org(&state, user_id, &org).await?;
    auth.require(Permission::ManageMembers)?;
    let mut tx = state.db.begin().await.map_err(Error::internal)?;
    let owner_user_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT owner_user_id FROM organizations WHERE id = $1 FOR UPDATE",
    )
    .bind(auth.org_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(Error::internal)?;
    let target_user_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT user_id FROM organization_members WHERE organization_id = $1 AND id = $2 FOR UPDATE",
    )
    .bind(auth.org_id)
    .bind(member_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)?;
    if target_user_id == owner_user_id {
        return Err(Error::BadRequest(
            "the organization owner cannot be removed; transfer ownership first".into(),
        ));
    }
    let gone =
        sqlx::query("DELETE FROM organization_members WHERE organization_id = $1 AND id = $2")
            .bind(auth.org_id)
            .bind(member_id)
            .execute(&mut *tx)
            .await
            .map_err(Error::internal)?
            .rows_affected();
    if gone == 0 {
        return Err(Error::NotFound);
    }
    tx.commit().await.map_err(Error::internal)?;
    Ok(Json(serde_json::json!({ "removed": true })))
}

/// Full member row for a member id (used to render member responses).
async fn member_summary(
    org_id: Uuid,
    member_id: Uuid,
    pool: &sqlx::PgPool,
) -> Result<MemberSummary, Error> {
    let r = sqlx::query_as::<_, (Uuid, String, Option<String>, i16, bool, String, DateTime<Utc>)>(
        "SELECT m.user_id, u.email, u.username, m.permissions, o.owner_user_id = m.user_id, m.status, m.created_at FROM organization_members m JOIN users u ON u.id = m.user_id JOIN organizations o ON o.id = m.organization_id WHERE m.organization_id = $1 AND m.id = $2",
    )
    .bind(org_id)
    .bind(member_id)
    .fetch_optional(pool)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)?;
    Ok(member_summary_from_row(
        member_id, r.0, r.1, r.2, r.3, r.6, r.4, r.5,
    ))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransferOwnershipRequest {
    member_id: Uuid,
}

pub async fn transfer_ownership(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path(org): Path<String>,
    Json(req): Json<TransferOwnershipRequest>,
) -> Result<Json<OrgSummary>, Error> {
    let auth = resolve_org(&state, user_id, &org).await?;
    if !auth.is_owner() {
        return Err(Error::Forbidden);
    }
    auth.require_verified()?;

    let mut tx = state.db.begin().await.map_err(Error::internal)?;
    let current_owner = sqlx::query_scalar::<_, Uuid>(
        "SELECT owner_user_id FROM organizations WHERE id = $1 FOR UPDATE",
    )
    .bind(auth.org_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(Error::internal)?;
    if current_owner != user_id {
        return Err(Error::Forbidden);
    }

    let next_owner = sqlx::query_scalar::<_, Uuid>(
        "SELECT user_id FROM organization_members WHERE organization_id = $1 AND id = $2 FOR UPDATE",
    )
    .bind(auth.org_id)
    .bind(req.member_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)?;
    sqlx::query("UPDATE organization_members SET permissions = $3 WHERE organization_id = $1 AND user_id = $2")
        .bind(auth.org_id)
        .bind(next_owner)
        .bind(PermissionSet::all().raw())
        .execute(&mut *tx)
        .await
        .map_err(Error::internal)?;
    sqlx::query("UPDATE organizations SET owner_user_id = $2, updated_at = now() WHERE id = $1")
        .bind(auth.org_id)
        .bind(next_owner)
        .execute(&mut *tx)
        .await
        .map_err(Error::internal)?;
    tx.commit().await.map_err(Error::internal)?;

    Ok(Json(load_org(&state.db, &auth.slug, &user_id).await?))
}

// ---- Access tokens -------------------------------------------------------------------

#[derive(Serialize)]
pub struct AccessTokenSummary {
    pub id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub revoked_at: Option<DateTime<Utc>>,
}

type AccessTokenRow = (
    Uuid,
    String,
    DateTime<Utc>,
    Option<DateTime<Utc>>,
    Option<DateTime<Utc>>,
);

async fn fetch_access_tokens_paged(
    pool: &sqlx::PgPool,
    org_id: Uuid,
    cursor: Option<(DateTime<Utc>, Uuid)>,
    limit: i64,
) -> Result<(Vec<AccessTokenRow>, bool), Error> {
    let had_cursor = cursor.is_some();
    let base = "SELECT id, name, created_at, last_used_at, revoked_at FROM access_tokens WHERE organization_id = $1";
    let rows = if let Some((ts, id)) = cursor {
        sqlx::query_as::<_, AccessTokenRow>(&format!(
            "{base} AND (created_at, id) < ($2, $3) ORDER BY created_at DESC, id DESC LIMIT {}",
            limit + 1
        ))
        .bind(org_id)
        .bind(ts)
        .bind(id)
        .fetch_all(pool)
        .await
        .map_err(Error::internal)?
    } else {
        sqlx::query_as::<_, AccessTokenRow>(&format!(
            "{base} ORDER BY created_at DESC, id DESC LIMIT {}",
            limit + 1
        ))
        .bind(org_id)
        .fetch_all(pool)
        .await
        .map_err(Error::internal)?
    };
    Ok((rows, had_cursor))
}

pub async fn list_access_tokens(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path(org): Path<String>,
    Query(q): Query<PagingQuery>,
) -> Result<Json<Paged<AccessTokenSummary>>, Error> {
    let auth = resolve_org(&state, user_id, &org).await?;
    let limit = clamp_limit(q.limit);
    let (rows, had_cursor) =
        fetch_access_tokens_paged(&state.db, auth.org_id, cursor_opt(&q.cursor)?, limit).await?;
    let cursors: Vec<(Uuid, DateTime<Utc>)> = rows.iter().map(|r| (r.0, r.2)).collect();
    let data: Vec<AccessTokenSummary> = rows
        .iter()
        .map(|r| AccessTokenSummary {
            id: r.0,
            name: r.1.clone(),
            created_at: r.2,
            last_used_at: r.3,
            revoked_at: r.4,
        })
        .collect();
    Ok(Json(into_page(data, cursors, limit, had_cursor)))
}

#[derive(Serialize)]
pub struct AccessTokenCreated {
    pub id: Uuid,
    pub name: String,
    /// Raw token — shown exactly once; only its hash is stored.
    pub token: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateAccessTokenRequest {
    name: String,
}

pub async fn create_access_token(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path(org): Path<String>,
    Json(req): Json<CreateAccessTokenRequest>,
) -> Result<Json<AccessTokenCreated>, Error> {
    let auth = resolve_org(&state, user_id, &org).await?;
    auth.require(Permission::ManageAccessTokens)?;
    auth.require_verified()?;

    let raw = generate_opaque_token();
    let hash = hash_token(&raw);
    let id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO access_tokens (organization_id, name, token_hash, created_by) VALUES ($1,$2,$3,$4) RETURNING id",
    )
    .bind(auth.org_id)
    .bind(req.name.trim())
    .bind(&hash)
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .map_err(Error::internal)?;

    Ok(Json(AccessTokenCreated {
        id,
        name: req.name,
        token: raw,
    }))
}

pub async fn revoke_access_token(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, token_id)): Path<(String, Uuid)>,
) -> Result<Json<serde_json::Value>, Error> {
    let auth = resolve_org(&state, user_id, &org).await?;
    auth.require(Permission::ManageAccessTokens)?;
    let gone = sqlx::query(
        "UPDATE access_tokens SET revoked_at = now() WHERE organization_id = $1 AND id = $2",
    )
    .bind(auth.org_id)
    .bind(token_id)
    .execute(&state.db)
    .await
    .map_err(Error::internal)?
    .rows_affected();
    if gone == 0 {
        return Err(Error::NotFound);
    }
    Ok(Json(serde_json::json!({ "revoked": true })))
}

// ---- Projects ------------------------------------------------------------------------

#[derive(Serialize)]
pub struct ProjectSummary {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub network: String,
    pub created_at: DateTime<Utc>,
}

type ProjectRow = (Uuid, String, String, String, DateTime<Utc>);

async fn fetch_projects_paged(
    pool: &sqlx::PgPool,
    org_id: Uuid,
    cursor: Option<(DateTime<Utc>, Uuid)>,
    limit: i64,
) -> Result<(Vec<ProjectRow>, bool), Error> {
    let had_cursor = cursor.is_some();
    let base =
        "SELECT id, slug, name, network, created_at FROM projects WHERE organization_id = $1";
    let rows = if let Some((ts, id)) = cursor {
        sqlx::query_as::<_, ProjectRow>(&format!(
            "{base} AND (created_at, id) < ($2, $3) ORDER BY created_at DESC, id DESC LIMIT {}",
            limit + 1
        ))
        .bind(org_id)
        .bind(ts)
        .bind(id)
        .fetch_all(pool)
        .await
        .map_err(Error::internal)?
    } else {
        sqlx::query_as::<_, ProjectRow>(&format!(
            "{base} ORDER BY created_at DESC, id DESC LIMIT {}",
            limit + 1
        ))
        .bind(org_id)
        .fetch_all(pool)
        .await
        .map_err(Error::internal)?
    };
    Ok((rows, had_cursor))
}

pub async fn list_projects(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path(org): Path<String>,
    Query(q): Query<PagingQuery>,
) -> Result<Json<Paged<ProjectSummary>>, Error> {
    let auth = resolve_org(&state, user_id, &org).await?;
    let limit = clamp_limit(q.limit);
    let (rows, had_cursor) =
        fetch_projects_paged(&state.db, auth.org_id, cursor_opt(&q.cursor)?, limit).await?;
    let cursors: Vec<(Uuid, DateTime<Utc>)> = rows.iter().map(|r| (r.0, r.4)).collect();
    let data: Vec<ProjectSummary> = rows
        .iter()
        .map(|r| ProjectSummary {
            id: r.0,
            slug: r.1.clone(),
            name: r.2.clone(),
            network: r.3.clone(),
            created_at: r.4,
        })
        .collect();
    Ok(Json(into_page(data, cursors, limit, had_cursor)))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateProjectRequest {
    name: String,
    #[serde(default)]
    slug: Option<String>,
    #[serde(default = "default_network")]
    network: String,
}

fn default_network() -> String {
    "testnet".to_string()
}

pub async fn create_project(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path(org): Path<String>,
    Json(req): Json<CreateProjectRequest>,
) -> Result<Json<ProjectSummary>, Error> {
    let auth = resolve_org(&state, user_id, &org).await?;
    auth.require(Permission::CreateProjects)?;
    auth.require_verified()?;

    let slug = req
        .slug
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| slugify(&req.name));
    let id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO projects (organization_id, slug, name, network) VALUES ($1,$2,$3,$4) RETURNING id",
    )
    .bind(auth.org_id)
    .bind(&slug)
    .bind(req.name.trim())
    .bind(&req.network)
    .fetch_one(&state.db)
    .await
    .map_err(unique_or_conflict)?;

    Ok(Json(project_summary(&state.db, auth.org_id, id).await?))
}

async fn project_summary(
    pool: &sqlx::PgPool,
    org_id: Uuid,
    project_id: Uuid,
) -> Result<ProjectSummary, Error> {
    let row = sqlx::query_as::<_, ProjectRow>(
        "SELECT id, slug, name, network, created_at FROM projects WHERE organization_id = $1 AND id = $2",
    )
    .bind(org_id)
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)?;
    Ok(ProjectSummary {
        id: row.0,
        slug: row.1,
        name: row.2,
        network: row.3,
        created_at: row.4,
    })
}

/// Resolve project id for `/{org}/{project}` with an optional permission gate.
async fn resolve_project_id(
    state: &AppState,
    user_id: Uuid,
    org_slug: &str,
    project_slug: &str,
    perm: Option<Permission>,
) -> Result<(OrgAuth, Uuid), Error> {
    let auth = resolve_org(state, user_id, org_slug).await?;
    if let Some(p) = perm {
        auth.require(p)?;
    }
    let id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM projects WHERE organization_id = $1 AND slug = $2",
    )
    .bind(auth.org_id)
    .bind(project_slug)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)?;
    Ok((auth, id))
}

pub async fn get_project(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project)): Path<(String, String)>,
) -> Result<Json<ProjectSummary>, Error> {
    let (auth, id) = resolve_project_id(&state, user_id, &org, &project, None).await?;
    Ok(Json(project_summary(&state.db, auth.org_id, id).await?))
}

/// Project lookup for project-scoped URLs (`/projects/{id}/...`), which
/// address projects by immutable ID instead of per-org slugs.
#[derive(Serialize)]
pub struct ProjectLookup {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub network: String,
    pub organization_id: Uuid,
    pub organization_slug: String,
}

pub async fn lookup_project(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path(project_id): Path<Uuid>,
) -> Result<Json<ProjectLookup>, Error> {
    let row = sqlx::query_as::<_, (Uuid, String, String, String, Uuid, String)>(
        r#"
        SELECT p.id, p.slug, p.name, p.network, o.id, o.slug
        FROM projects p
        JOIN organizations o ON o.id = p.organization_id
        JOIN organization_members m ON m.organization_id = o.id AND m.user_id = $1
        WHERE p.id = $2 AND m.status = 'active'
        "#,
    )
    .bind(user_id)
    .bind(project_id)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)?;
    Ok(Json(ProjectLookup {
        id: row.0,
        slug: row.1,
        name: row.2,
        network: row.3,
        organization_id: row.4,
        organization_slug: row.5,
    }))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PatchProjectRequest {
    name: Option<String>,
    network: Option<String>,
}

pub async fn patch_project(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project)): Path<(String, String)>,
    Json(req): Json<PatchProjectRequest>,
) -> Result<Json<ProjectSummary>, Error> {
    let (auth, id) = resolve_project_id(
        &state,
        user_id,
        &org,
        &project,
        Some(Permission::UpdateProjects),
    )
    .await?;
    auth.require_verified()?;
    sqlx::query(
        "UPDATE projects SET name = COALESCE($3, name), network = COALESCE($4, network) WHERE organization_id = $1 AND id = $2",
    )
    .bind(auth.org_id)
    .bind(id)
    .bind(req.name.as_deref())
    .bind(req.network.as_deref())
    .execute(&state.db)
    .await
    .map_err(Error::internal)?;
    Ok(Json(project_summary(&state.db, auth.org_id, id).await?))
}

pub async fn delete_project(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, Error> {
    let (auth, id) = resolve_project_id(
        &state,
        user_id,
        &org,
        &project,
        Some(Permission::DeleteProjects),
    )
    .await?;
    sqlx::query("DELETE FROM projects WHERE organization_id = $1 AND id = $2")
        .bind(auth.org_id)
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(Error::internal)?;
    Ok(Json(serde_json::json!({ "deleted": true })))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransferProjectRequest {
    to_org: String,
}

pub async fn transfer_project(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project)): Path<(String, String)>,
    Json(req): Json<TransferProjectRequest>,
) -> Result<Json<serde_json::Value>, Error> {
    let (auth, id) = resolve_project_id(
        &state,
        user_id,
        &org,
        &project,
        Some(Permission::CreateProjects),
    )
    .await?;
    auth.require_verified()?;

    let dest = resolve_org(&state, user_id, &req.to_org).await?;
    dest.require(Permission::CreateProjects)?;
    dest.require_verified()?;

    sqlx::query("UPDATE projects SET organization_id = $3 WHERE organization_id = $1 AND id = $2")
        .bind(auth.org_id)
        .bind(id)
        .bind(dest.org_id)
        .execute(&state.db)
        .await
        .map_err(Error::internal)?;

    Ok(Json(
        serde_json::json!({ "transferred": true, "to_org": dest.slug }),
    ))
}
