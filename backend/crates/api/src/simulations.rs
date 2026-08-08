use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};
use serde::Deserialize;
use serde_json::{Value, json};
use shared::{Error, Permission, PermissionSet};
use uuid::Uuid;

use crate::{extract::AuthUser, state::AppState};

struct ProjectAuth {
    organization_id: Uuid,
    project_id: Uuid,
}

#[derive(Debug, Deserialize)]
pub struct CreateSimulationRequest {
    request: Value,
    snapshot: Value,
    #[serde(default)]
    environment_id: Option<Uuid>,
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

fn map_remote(error: sim::Error) -> Error {
    tracing::warn!(%error, "Fork Core request failed");
    match error {
        sim::Error::Remote { status, .. } if status.as_u16() == 404 => Error::NotFound,
        sim::Error::Remote { status, .. } if status.as_u16() == 409 => Error::Conflict,
        sim::Error::Remote { status, .. } if status.as_u16() == 429 => Error::RateLimited,
        sim::Error::Remote { status, .. } if status.is_client_error() => {
            Error::BadRequest("Fork Core rejected the simulation".into())
        }
        sim::Error::Transport(_) => Error::ServiceUnavailable("fork_core".into()),
        other => Error::internal(other),
    }
}

fn actor(user_id: Uuid, auth: &ProjectAuth) -> sim::ServiceActor {
    sim::ServiceActor::fork_manager(
        user_id,
        auth.organization_id,
        auth.project_id,
        Uuid::new_v4(),
    )
}

pub async fn create_simulation(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project)): Path<(String, String)>,
    headers: HeaderMap,
    Json(body): Json<CreateSimulationRequest>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let idempotency = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let fork_body = json!({ "request": body.request, "snapshot": body.snapshot, "environment_id": body.environment_id });
    let accepted = client(&state)?
        .create_simulation(&actor(user_id, &auth), &idempotency, &fork_body)
        .await
        .map_err(map_remote)?;
    let request = &fork_body["request"];
    let base_ledger = request
        .get("base_ledger_sequence")
        .and_then(Value::as_i64)
        .unwrap_or_default();
    let function = request
        .get("function_name")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let args = request
        .get("args")
        .cloned()
        .unwrap_or(Value::Array(Vec::new()));
    let overrides = request
        .get("overrides")
        .cloned()
        .unwrap_or(Value::Array(Vec::new()));
    let local_id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO simulation_runs
            (project_id, base_ledger_sequence, function_name, args, overrides, status,
             created_by, fork_environment_id, fork_core_simulation_id, fork_core_job_id, fork_core_summary)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $10)
         ON CONFLICT (fork_core_simulation_id) WHERE fork_core_simulation_id IS NOT NULL
         DO UPDATE SET fork_core_job_id = EXCLUDED.fork_core_job_id
         RETURNING id",
    ).bind(auth.project_id).bind(base_ledger).bind(function).bind(args).bind(overrides)
        .bind(user_id).bind(body.environment_id).bind(accepted.simulation_id).bind(accepted.job_id)
        .bind(json!({ "status": accepted.status })).fetch_one(&state.db).await.map_err(Error::internal)?;
    Ok(Json(json!({ "id": local_id, "fork_core": accepted })))
}

pub async fn list_simulations(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project)): Path<(String, String)>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let rows = sqlx::query_scalar::<_, Value>(
        "SELECT jsonb_build_object('id', id, 'status', status, 'function_name', function_name,
                 'base_ledger_sequence', base_ledger_sequence, 'fork_core_summary', fork_core_summary,
                 'created_at', created_at, 'completed_at', completed_at)
           FROM simulation_runs WHERE project_id = $1 ORDER BY created_at DESC LIMIT 100",
    ).bind(auth.project_id).fetch_all(&state.db).await.map_err(Error::internal)?;
    Ok(Json(json!({ "simulations": rows })))
}

pub async fn get_simulation(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, simulation_id)): Path<(String, String, Uuid)>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let fork_id = sqlx::query_scalar::<_, Option<Uuid>>(
        "SELECT fork_core_simulation_id FROM simulation_runs WHERE id = $1 AND project_id = $2",
    )
    .bind(simulation_id)
    .bind(auth.project_id)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?
    .flatten()
    .ok_or(Error::NotFound)?;
    let detail = client(&state)?
        .get_simulation(&actor(user_id, &auth), fork_id)
        .await
        .map_err(map_remote)?;
    let status = detail
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("error");
    sqlx::query(
        "UPDATE simulation_runs SET status = $2, fork_core_summary = $3,
                completed_at = CASE WHEN $2 IN ('success','failed','error') THEN COALESCE(completed_at, now()) ELSE completed_at END
          WHERE id = $1 AND project_id = $4",
    ).bind(simulation_id).bind(status).bind(&detail).bind(auth.project_id)
        .execute(&state.db).await.map_err(Error::internal)?;
    Ok(Json(json!({ "id": simulation_id, "fork_core": detail })))
}

pub async fn cancel_simulation(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, simulation_id)): Path<(String, String, Uuid)>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let fork_id = sqlx::query_scalar::<_, Option<Uuid>>(
        "SELECT fork_core_simulation_id FROM simulation_runs WHERE id = $1 AND project_id = $2",
    )
    .bind(simulation_id)
    .bind(auth.project_id)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?
    .flatten()
    .ok_or(Error::NotFound)?;
    let result = client(&state)?
        .cancel_simulation(&actor(user_id, &auth), fork_id)
        .await
        .map_err(map_remote)?;
    Ok(Json(json!({ "id": simulation_id, "fork_core": result })))
}
