//! Phase 4 monitoring API: destinations, alerts, firing history, and delivery.

use alerts::{
    AlertExpression, AlertTarget, DeliveryPayload, DeliveryStatus, DestinationKind, MatchLogic,
    SorobanRpcViewRunner, TransactionFacts, deliver_http_destination, evaluate_alert, health_probe,
    next_backoff_seconds,
};
use axum::Json;
use axum::extract::{Path, Query, State};
use chrono::{DateTime, Utc};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use shared::{Cursor, Error, Paged, Pagination, Permission, PermissionSet, clamp_limit};
use sqlx::Row;
use uuid::Uuid;

use crate::extract::AuthUser;
use crate::mailer::Email;
use crate::state::AppState;

#[derive(Debug, Clone)]
struct OrgAuth {
    org_id: Uuid,
    email_verified: bool,
    perms: PermissionSet,
}

impl OrgAuth {
    fn require_alerts(&self) -> Result<(), Error> {
        if !self.perms.contains(Permission::ManageAlerts) {
            return Err(Error::Forbidden);
        }
        if !self.email_verified {
            return Err(Error::EmailUnverified);
        }
        Ok(())
    }
}

#[derive(Debug, Clone)]
struct ProjectAuth {
    org: OrgAuth,
    project_id: Uuid,
}

async fn resolve_org(state: &AppState, user_id: Uuid, slug: &str) -> Result<OrgAuth, Error> {
    let row = sqlx::query_as::<_, (Uuid, bool, i16)>(
        r#"
        SELECT o.id, u.email_verified, m.permissions
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
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)?;
    Ok(OrgAuth {
        org_id: row.0,
        email_verified: row.1,
        perms: PermissionSet(row.2),
    })
}

async fn resolve_project(
    state: &AppState,
    user_id: Uuid,
    org: &str,
    project: &str,
) -> Result<ProjectAuth, Error> {
    let org_auth = resolve_org(state, user_id, org).await?;
    let project_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM projects WHERE organization_id = $1 AND slug = $2",
    )
    .bind(org_auth.org_id)
    .bind(project)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)?;
    Ok(ProjectAuth {
        org: org_auth,
        project_id,
    })
}

#[derive(Deserialize)]
pub struct PageQuery {
    #[serde(default)]
    limit: Option<i64>,
    #[serde(default)]
    cursor: Option<String>,
}

fn parse_cursor(raw: &Option<String>) -> Result<Option<(DateTime<Utc>, Uuid)>, Error> {
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

fn page<T>(
    rows: Vec<T>,
    cursors: Vec<(DateTime<Utc>, Uuid)>,
    limit: i64,
    had_cursor: bool,
) -> Paged<T> {
    let has_more = rows.len() as i64 > limit;
    let data = rows.into_iter().take(limit as usize).collect::<Vec<_>>();
    let cursors = cursors.into_iter().take(limit as usize).collect::<Vec<_>>();
    let next_cursor = if has_more {
        cursors
            .last()
            .map(|(ts, id)| Cursor::new(ts.to_rfc3339(), id.to_string()).encode())
    } else {
        None
    };
    let prev_cursor = if had_cursor {
        cursors
            .first()
            .map(|(ts, id)| Cursor::new(ts.to_rfc3339(), id.to_string()).encode())
    } else {
        None
    };
    Paged {
        data,
        pagination: Pagination {
            limit,
            next_cursor,
            prev_cursor,
        },
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DestinationScope {
    Account,
    Project,
}

#[derive(Debug, Serialize)]
pub struct DestinationResponse {
    pub id: Uuid,
    pub scope: DestinationScope,
    #[serde(rename = "type")]
    pub kind: String,
    pub config: Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateAccountDestinationRequest {
    #[serde(rename = "type")]
    kind: String,
    config: Value,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PatchDestinationRequest {
    #[serde(default)]
    config: Option<Value>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    timeout_seconds: Option<i32>,
    #[serde(default)]
    max_retries: Option<i32>,
}

fn destination_kind(raw: &str) -> Result<DestinationKind, Error> {
    match raw {
        "email" => Ok(DestinationKind::Email),
        "slack" => Ok(DestinationKind::Slack),
        "telegram" => Ok(DestinationKind::Telegram),
        "discord" => Ok(DestinationKind::Discord),
        "sentry" => Ok(DestinationKind::Sentry),
        "pagerduty" => Ok(DestinationKind::Pagerduty),
        "webhook" => Ok(DestinationKind::Webhook),
        "action" => Ok(DestinationKind::Action),
        _ => Err(Error::BadRequest("invalid destination type".into())),
    }
}

fn validate_account_destination(kind: &str, config: &Value) -> Result<(), Error> {
    let k = destination_kind(kind)?;
    let required = match k {
        DestinationKind::Email => vec!["to"],
        DestinationKind::Slack | DestinationKind::Discord => vec!["webhook_url"],
        DestinationKind::Telegram => vec!["bot_token", "chat_id"],
        DestinationKind::Sentry => vec!["dsn"],
        DestinationKind::Pagerduty => vec!["integration_key"],
        DestinationKind::Webhook | DestinationKind::Action => {
            return Err(Error::BadRequest(
                "account destination type is not supported".into(),
            ));
        }
    };
    for key in required {
        if config.get(key).is_none() {
            return Err(Error::BadRequest(format!("missing config field `{key}`")));
        }
    }
    Ok(())
}

fn signing_secret() -> String {
    let mut bytes = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

pub async fn list_org_destinations(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path(org): Path<String>,
    Query(q): Query<PageQuery>,
) -> Result<Json<Paged<DestinationResponse>>, Error> {
    let auth = resolve_org(&state, user_id, &org).await?;
    let limit = clamp_limit(q.limit);
    let cursor = parse_cursor(&q.cursor)?;
    let had_cursor = cursor.is_some();
    let rows = if let Some((ts, id)) = cursor {
        sqlx::query(
            "SELECT id, type, config, created_at FROM account_destinations WHERE organization_id = $1 AND (created_at, id) < ($2,$3) ORDER BY created_at DESC, id DESC LIMIT $4",
        )
        .bind(auth.org_id)
        .bind(ts)
        .bind(id)
        .bind(limit + 1)
        .fetch_all(&state.db)
        .await
        .map_err(Error::internal)?
    } else {
        sqlx::query(
            "SELECT id, type, config, created_at FROM account_destinations WHERE organization_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2",
        )
        .bind(auth.org_id)
        .bind(limit + 1)
        .fetch_all(&state.db)
        .await
        .map_err(Error::internal)?
    };
    let cursors = rows
        .iter()
        .map(|r| {
            (
                r.get::<DateTime<Utc>, _>("created_at"),
                r.get::<Uuid, _>("id"),
            )
        })
        .collect();
    let data = rows
        .into_iter()
        .map(|r| DestinationResponse {
            id: r.get("id"),
            scope: DestinationScope::Account,
            kind: r.get("type"),
            config: r.get("config"),
            created_at: r.get("created_at"),
        })
        .collect();
    Ok(Json(page(data, cursors, limit, had_cursor)))
}

pub async fn create_org_destination(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path(org): Path<String>,
    Json(req): Json<CreateAccountDestinationRequest>,
) -> Result<Json<DestinationResponse>, Error> {
    let auth = resolve_org(&state, user_id, &org).await?;
    auth.require_alerts()?;
    validate_account_destination(&req.kind, &req.config)?;
    let row = sqlx::query(
        "INSERT INTO account_destinations (organization_id, type, config) VALUES ($1,$2,$3) RETURNING id, type, config, created_at",
    )
    .bind(auth.org_id)
    .bind(&req.kind)
    .bind(&req.config)
    .fetch_one(&state.db)
    .await
    .map_err(Error::internal)?;
    Ok(Json(DestinationResponse {
        id: row.get("id"),
        scope: DestinationScope::Account,
        kind: row.get("type"),
        config: row.get("config"),
        created_at: row.get("created_at"),
    }))
}

pub async fn patch_org_destination(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, id)): Path<(String, Uuid)>,
    Json(req): Json<PatchDestinationRequest>,
) -> Result<Json<DestinationResponse>, Error> {
    let auth = resolve_org(&state, user_id, &org).await?;
    auth.require_alerts()?;
    let current = sqlx::query(
        "SELECT type, config FROM account_destinations WHERE organization_id = $1 AND id = $2",
    )
    .bind(auth.org_id)
    .bind(id)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)?;
    let config = req
        .config
        .unwrap_or_else(|| current.get::<Value, _>("config"));
    let kind: String = current.get("type");
    validate_account_destination(&kind, &config)?;
    let row = sqlx::query(
        "UPDATE account_destinations SET config = $3 WHERE organization_id = $1 AND id = $2 RETURNING id, type, config, created_at",
    )
    .bind(auth.org_id)
    .bind(id)
    .bind(config)
    .fetch_one(&state.db)
    .await
    .map_err(Error::internal)?;
    Ok(Json(DestinationResponse {
        id: row.get("id"),
        scope: DestinationScope::Account,
        kind: row.get("type"),
        config: row.get("config"),
        created_at: row.get("created_at"),
    }))
}

pub async fn delete_org_destination(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, id)): Path<(String, Uuid)>,
) -> Result<Json<Value>, Error> {
    let auth = resolve_org(&state, user_id, &org).await?;
    auth.require_alerts()?;
    let result =
        sqlx::query("DELETE FROM account_destinations WHERE organization_id = $1 AND id = $2")
            .bind(auth.org_id)
            .bind(id)
            .execute(&state.db)
            .await
            .map_err(Error::internal)?;
    if result.rows_affected() == 0 {
        return Err(Error::NotFound);
    }
    Ok(Json(json!({ "deleted": true })))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateProjectDestinationRequest {
    #[serde(rename = "type")]
    kind: String,
    url: Option<String>,
    #[serde(default)]
    timeout_seconds: Option<i32>,
    #[serde(default)]
    max_retries: Option<i32>,
    #[serde(default)]
    config: Option<Value>,
}

pub async fn list_project_destinations(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project)): Path<(String, String)>,
    Query(q): Query<PageQuery>,
) -> Result<Json<Paged<DestinationResponse>>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    let limit = clamp_limit(q.limit);
    let cursor = parse_cursor(&q.cursor)?;
    let had_cursor = cursor.is_some();
    let rows = if let Some((ts, id)) = cursor {
        sqlx::query(
            "SELECT id, type, url, signing_secret, timeout_seconds, max_retries, config, created_at FROM project_destinations WHERE project_id = $1 AND (created_at, id) < ($2,$3) ORDER BY created_at DESC, id DESC LIMIT $4",
        )
        .bind(auth.project_id)
        .bind(ts)
        .bind(id)
        .bind(limit + 1)
        .fetch_all(&state.db)
        .await
        .map_err(Error::internal)?
    } else {
        sqlx::query(
            "SELECT id, type, url, signing_secret, timeout_seconds, max_retries, config, created_at FROM project_destinations WHERE project_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2",
        )
        .bind(auth.project_id)
        .bind(limit + 1)
        .fetch_all(&state.db)
        .await
        .map_err(Error::internal)?
    };
    let cursors = rows
        .iter()
        .map(|r| {
            (
                r.get::<DateTime<Utc>, _>("created_at"),
                r.get::<Uuid, _>("id"),
            )
        })
        .collect();
    let data = rows.into_iter().map(project_destination_response).collect();
    Ok(Json(page(data, cursors, limit, had_cursor)))
}

fn project_destination_response(row: sqlx::postgres::PgRow) -> DestinationResponse {
    let mut config = row
        .get::<Option<Value>, _>("config")
        .unwrap_or_else(|| json!({}));
    if let Value::Object(map) = &mut config {
        if let Some(url) = row.get::<Option<String>, _>("url") {
            map.insert("url".into(), Value::String(url));
        }
        map.insert(
            "timeout_seconds".into(),
            Value::from(row.get::<i32, _>("timeout_seconds")),
        );
        map.insert(
            "max_retries".into(),
            Value::from(row.get::<i32, _>("max_retries")),
        );
    }
    DestinationResponse {
        id: row.get("id"),
        scope: DestinationScope::Project,
        kind: row.get("type"),
        config,
        created_at: row.get("created_at"),
    }
}

pub async fn create_project_destination(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project)): Path<(String, String)>,
    Json(req): Json<CreateProjectDestinationRequest>,
) -> Result<Json<DestinationResponse>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    auth.org.require_alerts()?;
    match destination_kind(&req.kind)? {
        DestinationKind::Webhook => {
            let url = req
                .url
                .as_deref()
                .ok_or_else(|| Error::BadRequest("missing webhook url".into()))?;
            health_probe(url, req.timeout_seconds.unwrap_or(5).max(1) as u64)
                .await
                .map_err(|e| Error::BadRequest(e.to_string()))?;
        }
        DestinationKind::Action => {}
        _ => {
            return Err(Error::BadRequest(
                "project destination must be webhook or action".into(),
            ));
        }
    }
    let row = sqlx::query(
        r#"
        INSERT INTO project_destinations
            (project_id, type, url, signing_secret, timeout_seconds, max_retries, config)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING id, type, url, signing_secret, timeout_seconds, max_retries, config, created_at
        "#,
    )
    .bind(auth.project_id)
    .bind(&req.kind)
    .bind(req.url)
    .bind(signing_secret())
    .bind(req.timeout_seconds.unwrap_or(5))
    .bind(req.max_retries.unwrap_or(5))
    .bind(req.config.unwrap_or_else(|| json!({})))
    .fetch_one(&state.db)
    .await
    .map_err(Error::internal)?;
    Ok(Json(project_destination_response(row)))
}

pub async fn patch_project_destination(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, id)): Path<(String, String, Uuid)>,
    Json(req): Json<PatchDestinationRequest>,
) -> Result<Json<DestinationResponse>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    auth.org.require_alerts()?;
    let row = sqlx::query(
        r#"
        UPDATE project_destinations
        SET url = COALESCE($3, url),
            timeout_seconds = COALESCE($4, timeout_seconds),
            max_retries = COALESCE($5, max_retries),
            config = COALESCE($6, config)
        WHERE project_id = $1 AND id = $2
        RETURNING id, type, url, signing_secret, timeout_seconds, max_retries, config, created_at
        "#,
    )
    .bind(auth.project_id)
    .bind(id)
    .bind(req.url)
    .bind(req.timeout_seconds)
    .bind(req.max_retries)
    .bind(req.config)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)?;
    Ok(Json(project_destination_response(row)))
}

pub async fn delete_project_destination(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, id)): Path<(String, String, Uuid)>,
) -> Result<Json<Value>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    auth.org.require_alerts()?;
    let result = sqlx::query("DELETE FROM project_destinations WHERE project_id = $1 AND id = $2")
        .bind(auth.project_id)
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(Error::internal)?;
    if result.rows_affected() == 0 {
        return Err(Error::NotFound);
    }
    Ok(Json(json!({ "deleted": true })))
}

#[derive(Deserialize)]
#[serde(untagged)]
pub enum DestinationRef {
    Id(Uuid),
    Scoped { id: Uuid, scope: DestinationScope },
}

impl DestinationRef {
    fn id(&self) -> Uuid {
        match self {
            DestinationRef::Id(id) => *id,
            DestinationRef::Scoped { id, .. } => *id,
        }
    }
    fn scope(&self) -> DestinationScope {
        match self {
            DestinationRef::Id(_) => DestinationScope::Project,
            DestinationRef::Scoped { scope, .. } => *scope,
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpsertAlertRequest {
    name: String,
    target: AlertTarget,
    expressions: Vec<AlertExpression>,
    match_logic: MatchLogic,
    #[serde(default)]
    destinations: Vec<DestinationRef>,
    #[serde(default)]
    enabled: Option<bool>,
}

#[derive(Serialize)]
pub struct AlertResponse {
    id: Uuid,
    name: String,
    target: AlertTarget,
    expressions: Vec<AlertExpression>,
    match_logic: MatchLogic,
    enabled: bool,
    destinations: Vec<DestinationSummary>,
    created_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct DestinationSummary {
    id: Uuid,
    scope: DestinationScope,
}

fn target_type_str(target: &AlertTarget) -> &'static str {
    match target.target_type {
        alerts::TargetType::Address => "address",
        alerts::TargetType::Network => "network",
        alerts::TargetType::Project => "project",
        alerts::TargetType::Tag => "tag",
    }
}

fn parse_match_logic(raw: &str) -> Result<MatchLogic, Error> {
    match raw {
        "all" => Ok(MatchLogic::All),
        "any" => Ok(MatchLogic::Any),
        _ => Err(Error::BadRequest("invalid match_logic".into())),
    }
}

fn match_logic_str(logic: MatchLogic) -> &'static str {
    match logic {
        MatchLogic::All => "all",
        MatchLogic::Any => "any",
    }
}

async fn validate_destination_ref(
    pool: &sqlx::PgPool,
    auth: &ProjectAuth,
    dest: &DestinationRef,
) -> Result<(), Error> {
    let exists: bool = match dest.scope() {
        DestinationScope::Project => {
            sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM project_destinations WHERE project_id = $1 AND id = $2)",
            )
            .bind(auth.project_id)
            .bind(dest.id())
            .fetch_one(pool)
            .await
            .map_err(Error::internal)?
        }
        DestinationScope::Account => {
            sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM account_destinations WHERE organization_id = $1 AND id = $2)",
            )
            .bind(auth.org.org_id)
            .bind(dest.id())
            .fetch_one(pool)
            .await
            .map_err(Error::internal)?
        }
    };
    if exists {
        Ok(())
    } else {
        Err(Error::BadRequest("destination is not accessible".into()))
    }
}

async fn load_alert(
    pool: &sqlx::PgPool,
    project_id: Uuid,
    alert_id: Uuid,
) -> Result<AlertResponse, Error> {
    let row = sqlx::query(
        "SELECT id, name, target_type, target_value, match_logic, enabled, created_at FROM alerts WHERE project_id = $1 AND id = $2",
    )
    .bind(project_id)
    .bind(alert_id)
    .fetch_optional(pool)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)?;
    let expr_rows = sqlx::query(
        "SELECT expression_type, params FROM alert_expressions WHERE alert_id = $1 ORDER BY id ASC",
    )
    .bind(alert_id)
    .fetch_all(pool)
    .await
    .map_err(Error::internal)?;
    let expressions = expr_rows
        .into_iter()
        .map(|r| {
            let expression_type: String = r.get("expression_type");
            serde_json::from_value(
                json!({ "type": expression_type, "params": r.get::<Value, _>("params") }),
            )
            .map_err(|e| Error::BadRequest(format!("stored expression is invalid: {e}")))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let dest_rows = sqlx::query(
        "SELECT destination_id, destination_scope FROM alert_destinations WHERE alert_id = $1 ORDER BY destination_scope, destination_id",
    )
    .bind(alert_id)
    .fetch_all(pool)
    .await
    .map_err(Error::internal)?;
    let target: AlertTarget = serde_json::from_value(json!({
        "type": row.get::<String, _>("target_type"),
        "value": row.get::<Option<String>, _>("target_value")
    }))
    .map_err(|e| Error::BadRequest(format!("stored target is invalid: {e}")))?;
    Ok(AlertResponse {
        id: row.get("id"),
        name: row.get("name"),
        target,
        expressions,
        match_logic: parse_match_logic(&row.get::<String, _>("match_logic"))?,
        enabled: row.get("enabled"),
        destinations: dest_rows
            .into_iter()
            .map(|r| DestinationSummary {
                id: r.get("destination_id"),
                scope: match r.get::<String, _>("destination_scope").as_str() {
                    "account" => DestinationScope::Account,
                    _ => DestinationScope::Project,
                },
            })
            .collect(),
        created_at: row.get("created_at"),
    })
}

async fn replace_alert_children(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    alert_id: Uuid,
    expressions: &[AlertExpression],
    destinations: &[DestinationRef],
) -> Result<(), Error> {
    sqlx::query("DELETE FROM alert_expressions WHERE alert_id = $1")
        .bind(alert_id)
        .execute(&mut **tx)
        .await
        .map_err(Error::internal)?;
    sqlx::query("DELETE FROM alert_destinations WHERE alert_id = $1")
        .bind(alert_id)
        .execute(&mut **tx)
        .await
        .map_err(Error::internal)?;
    for expr in expressions {
        let value = serde_json::to_value(expr).map_err(Error::internal)?;
        let kind = value["type"]
            .as_str()
            .ok_or_else(|| Error::BadRequest("invalid expression type".into()))?
            .to_owned();
        sqlx::query(
            "INSERT INTO alert_expressions (alert_id, expression_type, params) VALUES ($1,$2,$3)",
        )
        .bind(alert_id)
        .bind(kind)
        .bind(&expr.params)
        .execute(&mut **tx)
        .await
        .map_err(Error::internal)?;
    }
    for dest in destinations {
        sqlx::query("INSERT INTO alert_destinations (alert_id, destination_id, destination_scope) VALUES ($1,$2,$3)")
            .bind(alert_id)
            .bind(dest.id())
            .bind(match dest.scope() {
                DestinationScope::Account => "account",
                DestinationScope::Project => "project",
            })
            .execute(&mut **tx)
            .await
            .map_err(Error::internal)?;
    }
    Ok(())
}

fn validate_alert_req(req: &UpsertAlertRequest) -> Result<(), Error> {
    if req.name.trim().is_empty() {
        return Err(Error::BadRequest("alert name is required".into()));
    }
    if req.expressions.is_empty() {
        return Err(Error::BadRequest(
            "at least one expression is required".into(),
        ));
    }
    Ok(())
}

pub async fn create_alert(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project)): Path<(String, String)>,
    Json(req): Json<UpsertAlertRequest>,
) -> Result<Json<AlertResponse>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    auth.org.require_alerts()?;
    validate_alert_req(&req)?;
    for dest in &req.destinations {
        validate_destination_ref(&state.db, &auth, dest).await?;
    }
    let mut tx = state.db.begin().await.map_err(Error::internal)?;
    let id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO alerts (project_id, name, target_type, target_value, match_logic, enabled) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
    )
    .bind(auth.project_id)
    .bind(req.name.trim())
    .bind(target_type_str(&req.target))
    .bind(req.target.value.as_deref())
    .bind(match_logic_str(req.match_logic))
    .bind(req.enabled.unwrap_or(true))
    .fetch_one(&mut *tx)
    .await
    .map_err(Error::internal)?;
    replace_alert_children(&mut tx, id, &req.expressions, &req.destinations).await?;
    tx.commit().await.map_err(Error::internal)?;
    Ok(Json(load_alert(&state.db, auth.project_id, id).await?))
}

pub async fn list_alerts(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project)): Path<(String, String)>,
    Query(q): Query<PageQuery>,
) -> Result<Json<Paged<AlertResponse>>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    let limit = clamp_limit(q.limit);
    let cursor = parse_cursor(&q.cursor)?;
    let had_cursor = cursor.is_some();
    let rows = if let Some((ts, id)) = cursor {
        sqlx::query("SELECT id, created_at FROM alerts WHERE project_id = $1 AND (created_at, id) < ($2,$3) ORDER BY created_at DESC, id DESC LIMIT $4")
            .bind(auth.project_id)
            .bind(ts)
            .bind(id)
            .bind(limit + 1)
            .fetch_all(&state.db)
            .await
            .map_err(Error::internal)?
    } else {
        sqlx::query("SELECT id, created_at FROM alerts WHERE project_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2")
            .bind(auth.project_id)
            .bind(limit + 1)
            .fetch_all(&state.db)
            .await
            .map_err(Error::internal)?
    };
    let cursors = rows
        .iter()
        .map(|r| {
            (
                r.get::<DateTime<Utc>, _>("created_at"),
                r.get::<Uuid, _>("id"),
            )
        })
        .collect::<Vec<_>>();
    let mut data = Vec::new();
    for row in rows {
        data.push(load_alert(&state.db, auth.project_id, row.get("id")).await?);
    }
    Ok(Json(page(data, cursors, limit, had_cursor)))
}

pub async fn patch_alert(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, alert_id)): Path<(String, String, Uuid)>,
    Json(req): Json<UpsertAlertRequest>,
) -> Result<Json<AlertResponse>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    auth.org.require_alerts()?;
    validate_alert_req(&req)?;
    for dest in &req.destinations {
        validate_destination_ref(&state.db, &auth, dest).await?;
    }
    let mut tx = state.db.begin().await.map_err(Error::internal)?;
    let updated = sqlx::query(
        "UPDATE alerts SET name = $3, target_type = $4, target_value = $5, match_logic = $6, enabled = $7 WHERE project_id = $1 AND id = $2",
    )
    .bind(auth.project_id)
    .bind(alert_id)
    .bind(req.name.trim())
    .bind(target_type_str(&req.target))
    .bind(req.target.value.as_deref())
    .bind(match_logic_str(req.match_logic))
    .bind(req.enabled.unwrap_or(true))
    .execute(&mut *tx)
    .await
    .map_err(Error::internal)?;
    if updated.rows_affected() == 0 {
        return Err(Error::NotFound);
    }
    replace_alert_children(&mut tx, alert_id, &req.expressions, &req.destinations).await?;
    tx.commit().await.map_err(Error::internal)?;
    Ok(Json(
        load_alert(&state.db, auth.project_id, alert_id).await?,
    ))
}

pub async fn delete_alert(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, alert_id)): Path<(String, String, Uuid)>,
) -> Result<Json<Value>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    auth.org.require_alerts()?;
    let result = sqlx::query("DELETE FROM alerts WHERE project_id = $1 AND id = $2")
        .bind(auth.project_id)
        .bind(alert_id)
        .execute(&state.db)
        .await
        .map_err(Error::internal)?;
    if result.rows_affected() == 0 {
        return Err(Error::NotFound);
    }
    Ok(Json(json!({ "deleted": true })))
}

#[derive(Serialize)]
pub struct FiringResponse {
    id: Uuid,
    alert_id: Uuid,
    tx_hash: Option<String>,
    simulation_id: Option<Uuid>,
    fired_at: DateTime<Utc>,
}

pub async fn alert_history(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, alert_id)): Path<(String, String, Uuid)>,
    Query(q): Query<PageQuery>,
) -> Result<Json<Paged<FiringResponse>>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM alerts WHERE project_id = $1 AND id = $2)",
    )
    .bind(auth.project_id)
    .bind(alert_id)
    .fetch_one(&state.db)
    .await
    .map_err(Error::internal)?
    .then_some(())
    .ok_or(Error::NotFound)?;
    let limit = clamp_limit(q.limit);
    let cursor = parse_cursor(&q.cursor)?;
    let had_cursor = cursor.is_some();
    let rows = if let Some((ts, id)) = cursor {
        sqlx::query("SELECT id, alert_id, tx_hash, simulation_id, fired_at FROM alert_firings WHERE alert_id = $1 AND (fired_at, id) < ($2,$3) ORDER BY fired_at DESC, id DESC LIMIT $4")
            .bind(alert_id)
            .bind(ts)
            .bind(id)
            .bind(limit + 1)
            .fetch_all(&state.db)
            .await
            .map_err(Error::internal)?
    } else {
        sqlx::query("SELECT id, alert_id, tx_hash, simulation_id, fired_at FROM alert_firings WHERE alert_id = $1 ORDER BY fired_at DESC, id DESC LIMIT $2")
            .bind(alert_id)
            .bind(limit + 1)
            .fetch_all(&state.db)
            .await
            .map_err(Error::internal)?
    };
    let cursors = rows
        .iter()
        .map(|r| {
            (
                r.get::<DateTime<Utc>, _>("fired_at"),
                r.get::<Uuid, _>("id"),
            )
        })
        .collect::<Vec<_>>();
    let data = rows
        .into_iter()
        .map(|r| FiringResponse {
            id: r.get("id"),
            alert_id: r.get("alert_id"),
            tx_hash: r.get("tx_hash"),
            simulation_id: r.get("simulation_id"),
            fired_at: r.get("fired_at"),
        })
        .collect();
    Ok(Json(page(data, cursors, limit, had_cursor)))
}

async fn tx_facts(
    pool: &sqlx::PgPool,
    network: &str,
    hash: &str,
) -> Result<TransactionFacts, Error> {
    let row = sqlx::query(
        "SELECT hash, network, ledger_sequence, status, source_account, operation_type, fee_charged::text, timestamp FROM transactions WHERE network = $1 AND hash = $2",
    )
    .bind(network)
    .bind(hash)
    .fetch_optional(pool)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)?;
    let call_rows = sqlx::query("SELECT contract_id, function_name, args, return_value, depth FROM tx_call_tree_nodes WHERE tx_hash = $1 ORDER BY depth ASC, id ASC")
        .bind(hash)
        .fetch_all(pool)
        .await
        .map_err(Error::internal)?;
    let event_rows = sqlx::query(
        "SELECT contract_id, topics, data FROM tx_events WHERE tx_hash = $1 ORDER BY id ASC",
    )
    .bind(hash)
    .fetch_all(pool)
    .await
    .map_err(Error::internal)?;
    let state_rows = sqlx::query("SELECT entry_type, entry_key, value_before, value_after FROM tx_state_changes WHERE tx_hash = $1 ORDER BY id ASC")
        .bind(hash)
        .fetch_all(pool)
        .await
        .map_err(Error::internal)?;
    let flow_rows = sqlx::query("SELECT from_address, to_address, asset, amount::text FROM tx_fund_flow_edges WHERE tx_hash = $1 ORDER BY id ASC")
        .bind(hash)
        .fetch_all(pool)
        .await
        .map_err(Error::internal)?;
    Ok(TransactionFacts {
        hash: row.get("hash"),
        network: row.get("network"),
        status: row.get("status"),
        ledger: row.get("ledger_sequence"),
        timestamp: row.get("timestamp"),
        source_account: row.get("source_account"),
        operation_type: row.get("operation_type"),
        fee_charged: row.get("fee_charged"),
        call_tree: call_rows
            .into_iter()
            .map(|r| alerts::CallNode {
                contract_id: r.get("contract_id"),
                function_name: r.get("function_name"),
                args: r.get("args"),
                return_value: r.get("return_value"),
                depth: i64::from(r.get::<i32, _>("depth")),
            })
            .collect(),
        events: event_rows
            .into_iter()
            .map(|r| alerts::EventRecord {
                contract_id: r.get("contract_id"),
                topics: r.get("topics"),
                data: r.get("data"),
            })
            .collect(),
        state_changes: state_rows
            .into_iter()
            .map(|r| alerts::StateChangeRecord {
                entry_type: r.get("entry_type"),
                key: r.get("entry_key"),
                before: r.get("value_before"),
                after: r.get("value_after"),
            })
            .collect(),
        fund_flow: flow_rows
            .into_iter()
            .map(|r| alerts::FundFlowEdge {
                from: r.get("from_address"),
                to: r.get("to_address"),
                asset: r.get("asset"),
                amount: r.get("amount"),
            })
            .collect(),
    })
}

async fn target_matches(
    pool: &sqlx::PgPool,
    project_id: Uuid,
    alert: &AlertResponse,
    tx: &TransactionFacts,
) -> Result<bool, Error> {
    Ok(match alert.target.target_type {
        alerts::TargetType::Network | alerts::TargetType::Project => true,
        alerts::TargetType::Address => alert.target.value.as_ref().is_none_or(|addr| {
            tx.source_account == *addr
                || tx
                    .fund_flow
                    .iter()
                    .any(|e| e.from == *addr || e.to == *addr)
                || tx.call_tree.iter().any(|c| c.contract_id == *addr)
        }),
        alerts::TargetType::Tag => {
            let Some(tag) = alert.target.value.as_ref() else {
                return Ok(false);
            };
            sqlx::query_scalar::<_, bool>(
                r#"
                SELECT EXISTS(
                  SELECT 1 FROM tags t
                  JOIN tag_attachments a ON a.tag_id = t.id
                  LEFT JOIN wallets w ON a.entity_type = 'wallet' AND w.id = a.entity_id
                  LEFT JOIN contracts c ON a.entity_type = 'contract' AND c.id = a.entity_id
                  WHERE t.project_id = $1 AND t.name = $2
                    AND (
                      w.address = $3 OR c.address = $3
                      OR EXISTS (SELECT 1 FROM tx_fund_flow_edges e WHERE e.tx_hash = $4 AND (e.from_address = w.address OR e.to_address = w.address))
                      OR EXISTS (SELECT 1 FROM tx_call_tree_nodes n WHERE n.tx_hash = $4 AND n.contract_id = c.address)
                    )
                )
                "#,
            )
            .bind(project_id)
            .bind(tag)
            .bind(&tx.source_account)
            .bind(&tx.hash)
            .fetch_one(pool)
            .await
            .map_err(Error::internal)?
        }
    })
}

async fn fire_alert(
    state: &AppState,
    auth: &ProjectAuth,
    alert: &AlertResponse,
    tx: &TransactionFacts,
) -> Result<Option<Uuid>, Error> {
    let firing = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO alert_firings (alert_id, tx_hash) VALUES ($1,$2) ON CONFLICT (alert_id, tx_hash) WHERE simulation_id IS NULL DO NOTHING RETURNING id",
    )
    .bind(alert.id)
    .bind(&tx.hash)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?;
    let Some(firing_id) = firing else {
        return Ok(None);
    };
    for dest in &alert.destinations {
        create_delivery(state, auth, alert.id, Some(&tx.hash), dest).await?;
    }
    Ok(Some(firing_id))
}

async fn create_delivery(
    state: &AppState,
    auth: &ProjectAuth,
    alert_id: Uuid,
    tx_hash: Option<&str>,
    dest: &DestinationSummary,
) -> Result<Uuid, Error> {
    let id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO destination_deliveries (destination_id, destination_scope, event_type, alert_id, status, attempt) VALUES ($1,$2,'alert_fired',$3,'pending',1) RETURNING id",
    )
    .bind(dest.id)
    .bind(match dest.scope {
        DestinationScope::Account => "account",
        DestinationScope::Project => "project",
    })
    .bind(alert_id)
    .fetch_one(&state.db)
    .await
    .map_err(Error::internal)?;
    let payload = DeliveryPayload {
        event_type: "alert_fired".into(),
        alert_id: Some(alert_id.to_string()),
        tx_hash: tx_hash.map(ToOwned::to_owned),
        simulation_id: None,
        project_id: Some(auth.project_id.to_string()),
        fired_at: Utc::now(),
        data: json!({ "delivery_id": id }),
    };
    deliver_record(state, id, &payload).await?;
    Ok(id)
}

async fn delivery_destination(
    state: &AppState,
    id: Uuid,
) -> Result<(DestinationKind, Value, i32), Error> {
    let row = sqlx::query("SELECT destination_id, destination_scope, attempt FROM destination_deliveries WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await
        .map_err(Error::internal)?
        .ok_or(Error::NotFound)?;
    let dest_id: Uuid = row.get("destination_id");
    let scope: String = row.get("destination_scope");
    let attempt: i32 = row.get("attempt");
    if scope == "project" {
        let d = sqlx::query("SELECT type, url, signing_secret, timeout_seconds, max_retries, config FROM project_destinations WHERE id = $1")
            .bind(dest_id)
            .fetch_optional(&state.db)
            .await
            .map_err(Error::internal)?
            .ok_or(Error::NotFound)?;
        let mut config = d
            .get::<Option<Value>, _>("config")
            .unwrap_or_else(|| json!({}));
        if let Value::Object(map) = &mut config {
            if let Some(url) = d.get::<Option<String>, _>("url") {
                map.insert("url".into(), Value::String(url));
            }
            if let Some(secret) = d.get::<Option<String>, _>("signing_secret") {
                map.insert("signing_secret".into(), Value::String(secret));
            }
            map.insert(
                "timeout_seconds".into(),
                Value::from(d.get::<i32, _>("timeout_seconds")),
            );
            map.insert(
                "max_retries".into(),
                Value::from(d.get::<i32, _>("max_retries")),
            );
        }
        Ok((
            destination_kind(&d.get::<String, _>("type"))?,
            config,
            attempt,
        ))
    } else {
        let d = sqlx::query("SELECT type, config FROM account_destinations WHERE id = $1")
            .bind(dest_id)
            .fetch_optional(&state.db)
            .await
            .map_err(Error::internal)?
            .ok_or(Error::NotFound)?;
        Ok((
            destination_kind(&d.get::<String, _>("type"))?,
            d.get("config"),
            attempt,
        ))
    }
}

pub async fn deliver_record(
    state: &AppState,
    delivery_id: Uuid,
    payload: &DeliveryPayload,
) -> Result<(), Error> {
    let (kind, config, attempt) = delivery_destination(state, delivery_id).await?;
    let result = if kind == DestinationKind::Email {
        let recipients = config
            .get("to")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut failed = false;
        for to in recipients.iter().filter_map(Value::as_str) {
            if state
                .mailer
                .send(Email {
                    to: to.to_owned(),
                    subject: "Releeve alert fired".into(),
                    body: serde_json::to_string_pretty(payload).unwrap_or_default(),
                })
                .await
                .is_err()
            {
                failed = true;
            }
        }
        alerts::DeliveryAttempt {
            status: if failed {
                DeliveryStatus::Retry
            } else {
                DeliveryStatus::Success
            },
            response_code: None,
            should_retry: failed,
        }
    } else {
        deliver_http_destination(kind, &config, payload)
            .await
            .map_err(|e| Error::BadRequest(e.to_string()))?
    };
    let mut status = match result.status {
        DeliveryStatus::Success => "success",
        DeliveryStatus::Failed => "failed",
        DeliveryStatus::Pending => "pending",
        DeliveryStatus::Retry => "retry",
        DeliveryStatus::Skipped => "skipped",
    };
    if result.should_retry && next_backoff_seconds(attempt + 1).is_none() {
        status = "failed";
    }
    sqlx::query("UPDATE destination_deliveries SET status = $2, response_code = $3, attempt = CASE WHEN $4 THEN attempt + 1 ELSE attempt END, sent_at = now() WHERE id = $1")
        .bind(delivery_id)
        .bind(status)
        .bind(result.response_code.map(i32::from))
        .bind(result.should_retry)
        .execute(&state.db)
        .await
        .map_err(Error::internal)?;
    Ok(())
}

pub async fn evaluate_transaction_alerts(
    state: &AppState,
    project_id: Uuid,
    network: &str,
    hash: &str,
) -> Result<Vec<Uuid>, Error> {
    let tx = tx_facts(&state.db, network, hash).await?;
    let row = sqlx::query("SELECT p.id, p.network, o.id AS org_id FROM projects p JOIN organizations o ON o.id = p.organization_id WHERE p.id = $1")
        .bind(project_id)
        .fetch_optional(&state.db)
        .await
        .map_err(Error::internal)?
        .ok_or(Error::NotFound)?;
    let auth = ProjectAuth {
        org: OrgAuth {
            org_id: row.get("org_id"),
            email_verified: true,
            perms: PermissionSet::all(),
        },
        project_id,
    };
    let alert_rows = sqlx::query("SELECT id FROM alerts WHERE project_id = $1 AND enabled = true")
        .bind(project_id)
        .fetch_all(&state.db)
        .await
        .map_err(Error::internal)?;
    let view_runner = SorobanRpcViewRunner::new(state.settings.soroban_rpc_url.clone());
    let mut fired = Vec::new();
    for row in alert_rows {
        let alert = load_alert(&state.db, project_id, row.get("id")).await?;
        if !target_matches(&state.db, project_id, &alert, &tx).await? {
            continue;
        }
        let outcome = evaluate_alert(
            &alert.expressions,
            alert.match_logic,
            &tx,
            Some(&view_runner),
        )
        .await
        .map_err(|e| Error::BadRequest(e.to_string()))?;
        if outcome.matched
            && let Some(id) = fire_alert(state, &auth, &alert, &tx).await?
        {
            fired.push(id);
        }
    }
    Ok(fired)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TestDestinationRequest {
    #[serde(default)]
    tx_hash: Option<String>,
    #[serde(default)]
    simulation_id: Option<Uuid>,
}

#[derive(Serialize)]
pub struct DeliveryResponse {
    id: Uuid,
    destination_id: Uuid,
    destination_scope: DestinationScope,
    event_type: String,
    alert_id: Option<Uuid>,
    status: String,
    attempt: i32,
    response_code: Option<i32>,
    sent_at: DateTime<Utc>,
}

async fn load_delivery(pool: &sqlx::PgPool, id: Uuid) -> Result<DeliveryResponse, Error> {
    let row = sqlx::query("SELECT id, destination_id, destination_scope, event_type, alert_id, status, attempt, response_code, sent_at FROM destination_deliveries WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(Error::internal)?
        .ok_or(Error::NotFound)?;
    Ok(DeliveryResponse {
        id: row.get("id"),
        destination_id: row.get("destination_id"),
        destination_scope: if row.get::<String, _>("destination_scope") == "account" {
            DestinationScope::Account
        } else {
            DestinationScope::Project
        },
        event_type: row.get("event_type"),
        alert_id: row.get("alert_id"),
        status: row.get("status"),
        attempt: row.get("attempt"),
        response_code: row.get("response_code"),
        sent_at: row.get("sent_at"),
    })
}

pub async fn test_project_destination(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, id)): Path<(String, String, Uuid)>,
    Json(req): Json<TestDestinationRequest>,
) -> Result<Json<DeliveryResponse>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    auth.org.require_alerts()?;
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM project_destinations WHERE project_id = $1 AND id = $2)",
    )
    .bind(auth.project_id)
    .bind(id)
    .fetch_one(&state.db)
    .await
    .map_err(Error::internal)?
    .then_some(())
    .ok_or(Error::NotFound)?;
    let delivery_id = sqlx::query_scalar::<_, Uuid>("INSERT INTO destination_deliveries (destination_id, destination_scope, event_type, status, attempt) VALUES ($1,'project','test','pending',1) RETURNING id")
        .bind(id)
        .fetch_one(&state.db)
        .await
        .map_err(Error::internal)?;
    let payload = DeliveryPayload {
        event_type: "test".into(),
        alert_id: None,
        tx_hash: req.tx_hash,
        simulation_id: req.simulation_id.map(|id| id.to_string()),
        project_id: Some(auth.project_id.to_string()),
        fired_at: Utc::now(),
        data: json!({ "delivery_id": delivery_id }),
    };
    deliver_record(&state, delivery_id, &payload).await?;
    Ok(Json(load_delivery(&state.db, delivery_id).await?))
}

pub async fn test_org_destination(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, id)): Path<(String, Uuid)>,
    Json(req): Json<TestDestinationRequest>,
) -> Result<Json<DeliveryResponse>, Error> {
    let auth = resolve_org(&state, user_id, &org).await?;
    auth.require_alerts()?;
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM account_destinations WHERE organization_id = $1 AND id = $2)",
    )
    .bind(auth.org_id)
    .bind(id)
    .fetch_one(&state.db)
    .await
    .map_err(Error::internal)?
    .then_some(())
    .ok_or(Error::NotFound)?;
    let delivery_id = sqlx::query_scalar::<_, Uuid>("INSERT INTO destination_deliveries (destination_id, destination_scope, event_type, status, attempt) VALUES ($1,'account','test','pending',1) RETURNING id")
        .bind(id)
        .fetch_one(&state.db)
        .await
        .map_err(Error::internal)?;
    let payload = DeliveryPayload {
        event_type: "test".into(),
        alert_id: None,
        tx_hash: req.tx_hash,
        simulation_id: req.simulation_id.map(|id| id.to_string()),
        project_id: None,
        fired_at: Utc::now(),
        data: json!({ "delivery_id": delivery_id }),
    };
    deliver_record(&state, delivery_id, &payload).await?;
    Ok(Json(load_delivery(&state.db, delivery_id).await?))
}
