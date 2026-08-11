//! Project-scoped Fork Core environment proxy.
//!
//! Fork Core remains private. The browser only talks to Platform, which
//! authorizes the user and issues the short-lived service assertion upstream.

use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};
use serde_json::{Value, json};
use shared::{Error, Permission, PermissionSet};
use uuid::Uuid;

use crate::{extract::AuthUser, state::AppState};

struct ProjectAuth {
    organization_id: Uuid,
    project_id: Uuid,
}

async fn authorize(
    state: &AppState,
    user_id: Uuid,
    org: &str,
    project: &str,
) -> Result<ProjectAuth, Error> {
    let row = sqlx::query_as::<_, (Uuid, Uuid, bool, i16)>(
        "SELECT o.id, p.id, u.email_verified, m.permissions
           FROM organizations o
           JOIN organization_members m ON m.organization_id = o.id AND m.user_id = $1
           JOIN users u ON u.id = m.user_id
           JOIN projects p ON p.organization_id = o.id
          WHERE o.slug = $2 AND p.slug = $3",
    )
    .bind(user_id)
    .bind(org)
    .bind(project)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)?;
    if !row.2 {
        return Err(Error::EmailUnverified);
    }
    if !PermissionSet(row.3).contains(Permission::ManageForkSessions) {
        return Err(Error::Forbidden);
    }
    Ok(ProjectAuth {
        organization_id: row.0,
        project_id: row.1,
    })
}

fn client(state: &AppState) -> Result<&sim::ForkCoreClient, Error> {
    state
        .fork_core
        .as_ref()
        .ok_or_else(|| Error::ServiceUnavailable("fork_core".into()))
}

fn actor(user_id: Uuid, auth: &ProjectAuth) -> sim::ServiceActor {
    sim::ServiceActor::fork_manager(
        user_id,
        auth.organization_id,
        auth.project_id,
        Uuid::new_v4(),
    )
}

fn map_remote(error: sim::Error) -> Error {
    tracing::warn!(%error, "Fork Core environment request failed");
    match error {
        sim::Error::Remote { status, .. } if status.as_u16() == 404 => Error::NotFound,
        sim::Error::Remote { status, .. } if status.as_u16() == 409 => Error::Conflict,
        sim::Error::Remote { status, .. } if status.as_u16() == 429 => Error::RateLimited,
        sim::Error::Remote { status, .. } if status.is_client_error() => {
            Error::BadRequest("Fork Core rejected the environment request".into())
        }
        sim::Error::Remote { status, .. } if status.is_server_error() => {
            Error::ServiceUnavailable("fork_core".into())
        }
        sim::Error::Transport(_) => Error::ServiceUnavailable("fork_core".into()),
        other => Error::internal(other),
    }
}

pub async fn create_environment(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    Ok(Json(
        client(&state)?
            .create_environment(&actor(user_id, &auth), &body)
            .await
            .map_err(map_remote)?,
    ))
}

pub async fn list_environments(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project)): Path<(String, String)>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    Ok(Json(
        client(&state)?
            .list_environments(&actor(user_id, &auth))
            .await
            .map_err(map_remote)?,
    ))
}

pub async fn get_environment(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, environment_id)): Path<(String, String, Uuid)>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    Ok(Json(
        client(&state)?
            .get_environment(&actor(user_id, &auth), environment_id)
            .await
            .map_err(map_remote)?,
    ))
}

pub async fn update_environment(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, environment_id)): Path<(String, String, Uuid)>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    Ok(Json(
        client(&state)?
            .update_environment(&actor(user_id, &auth), environment_id, &body)
            .await
            .map_err(map_remote)?,
    ))
}

pub async fn delete_environment(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, environment_id)): Path<(String, String, Uuid)>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    client(&state)?
        .delete_environment(&actor(user_id, &auth), environment_id)
        .await
        .map_err(map_remote)?;
    Ok(Json(json!({ "id": environment_id, "deleted": true })))
}

async fn run_environment_action(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, environment_id)): Path<(String, String, Uuid)>,
    action: &str,
    body: Option<Json<Value>>,
    idempotency_key: Option<&str>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let body = body.map(|Json(value)| value);
    Ok(Json(
        client(&state)?
            .environment_action(
                &actor(user_id, &auth),
                environment_id,
                &action,
                body.as_ref(),
                idempotency_key,
            )
            .await
            .map_err(map_remote)?,
    ))
}

pub async fn environment_simulate(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, environment_id)): Path<(String, String, Uuid)>,
    headers: HeaderMap,
    body: Option<Json<Value>>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let idempotency_key = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let body = body
        .map(|Json(value)| value)
        .ok_or_else(|| Error::BadRequest("Simulation request is required".into()))?;
    let request = body
        .get("request")
        .cloned()
        .ok_or_else(|| Error::BadRequest("Simulation request is required".into()))?;
    let accepted = client(&state)?
        .environment_action(
            &actor(user_id, &auth),
            environment_id,
            "simulate",
            Some(&body),
            Some(&idempotency_key),
        )
        .await
        .map_err(map_remote)?;
    let fork_simulation_id = accepted
        .get("simulation_id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| Error::ServiceUnavailable("fork_core_invalid_response".into()))?;
    let fork_job_id = accepted
        .get("job_id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    let local_id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO simulation_runs(project_id,base_ledger_sequence,function_name,args,overrides,status,created_by,fork_environment_id,fork_core_simulation_id,fork_core_job_id,fork_core_summary)
         VALUES($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9,$10)
         ON CONFLICT(fork_core_simulation_id) WHERE fork_core_simulation_id IS NOT NULL
         DO UPDATE SET fork_core_job_id=EXCLUDED.fork_core_job_id RETURNING id",
    )
    .bind(auth.project_id)
    .bind(request.get("base_ledger_sequence").and_then(Value::as_i64).unwrap_or_default())
    .bind(request.get("function_name").and_then(Value::as_str).unwrap_or("unknown"))
    .bind(request.get("args").cloned().unwrap_or_else(|| json!([])))
    .bind(request.get("overrides").cloned().unwrap_or_else(|| json!([])))
    .bind(user_id)
    .bind(environment_id)
    .bind(fork_simulation_id)
    .bind(fork_job_id)
    .bind(json!({"status":accepted.get("status").cloned().unwrap_or_else(||json!("queued"))}))
    .fetch_one(&state.db)
    .await
    .map_err(Error::internal)?;
    Ok(Json(json!({"id":local_id,"fork_core":accepted})))
}

pub async fn environment_rollback(
    state: State<AppState>,
    user: AuthUser,
    path: Path<(String, String, Uuid)>,
    body: Option<Json<Value>>,
) -> Result<Json<Value>, Error> {
    run_environment_action(state, user, path, "rollback", body, None).await
}

pub async fn list_or_add_environment_overrides(
    state: State<AppState>,
    user: AuthUser,
    path: Path<(String, String, Uuid)>,
    body: Option<Json<Value>>,
) -> Result<Json<Value>, Error> {
    run_environment_action(state, user, path, "overrides", body, None).await
}

pub async fn start_environment_sync(
    state: State<AppState>,
    user: AuthUser,
    path: Path<(String, String, Uuid)>,
) -> Result<Json<Value>, Error> {
    run_environment_action(state, user, path, "sync/start", None, None).await
}

pub async fn stop_environment_sync(
    state: State<AppState>,
    user: AuthUser,
    path: Path<(String, String, Uuid)>,
) -> Result<Json<Value>, Error> {
    run_environment_action(state, user, path, "sync/stop", None, None).await
}

pub async fn environment_sync_status(
    state: State<AppState>,
    user: AuthUser,
    path: Path<(String, String, Uuid)>,
) -> Result<Json<Value>, Error> {
    run_environment_action(state, user, path, "sync/status", None, None).await
}

pub async fn delete_environment_override(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, environment_id, override_id)): Path<(String, String, Uuid, Uuid)>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    client(&state)?
        .delete_environment_override(&actor(user_id, &auth), environment_id, override_id)
        .await
        .map_err(map_remote)?;
    Ok(Json(
        json!({ "environment_id": environment_id, "override_id": override_id, "deleted": true }),
    ))
}
