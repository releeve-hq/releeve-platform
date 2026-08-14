use axum::{
    Json,
    extract::{Path, Query, State},
    http::HeaderMap,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use shared::{Error, Permission, PermissionSet};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{extract::AuthUser, state::AppState};

struct ProjectAuth {
    organization_id: Uuid,
    project_id: Uuid,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateSimulationRequest {
    network: String,
    state_source: StateSource,
    invocation: Invocation,
    #[serde(default)]
    overrides: Vec<Value>,
    #[serde(default)]
    impersonate: Vec<String>,
    #[serde(default)]
    capture_trace: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum StateSource {
    Latest,
    Ledger {
        ledger_sequence: i64,
    },
    Environment {
        environment_id: Uuid,
        #[serde(default)]
        revision_id: Option<Uuid>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Invocation {
    Prepared {
        transaction_envelope_xdr: String,
    },
    Decoded {
        contract_id: String,
        function_name: String,
        args: Value,
        source_account_xdr: String,
        sequence_number: i64,
    },
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

fn lens_client(state: &AppState) -> Result<&source_lens_client::SourceLensClient, Error> {
    state
        .source_lens
        .as_ref()
        .ok_or_else(|| Error::ServiceUnavailable("source_lens".into()))
}

fn map_remote(error: sim::Error) -> Error {
    tracing::warn!(%error, "Fork Core request failed");
    match error {
        sim::Error::Remote {
            status,
            code,
            detail,
        } => Error::DependencyProblem {
            status: status.as_u16(),
            code,
            message: detail,
        },
        sim::Error::Transport(_) => Error::ServiceUnavailable("fork_core".into()),
        other => Error::internal(other),
    }
}

fn map_lens_remote(error: source_lens_client::Error) -> Error {
    tracing::warn!(%error, "SourceLens request failed");
    match error {
        source_lens_client::Error::Remote { status, .. } if status.as_u16() == 404 => {
            Error::NotFound
        }
        source_lens_client::Error::Remote { status, .. } if status.as_u16() == 409 => {
            Error::Conflict
        }
        source_lens_client::Error::Remote { status, .. } if status.as_u16() == 429 => {
            Error::RateLimited
        }
        source_lens_client::Error::Remote { status, .. } if status.is_client_error() => {
            Error::BadRequest("SourceLens rejected the request".into())
        }
        source_lens_client::Error::Remote { status, .. } if status.is_server_error() => {
            Error::ServiceUnavailable("source_lens".into())
        }
        source_lens_client::Error::Transport(_) => Error::ServiceUnavailable("source_lens".into()),
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

fn lens_actor(user_id: Uuid, auth: &ProjectAuth) -> source_lens_client::ServiceActor {
    source_lens_client::ServiceActor::project_member(
        user_id,
        auth.organization_id,
        auth.project_id,
        Uuid::new_v4(),
        true,
    )
}

pub async fn create_simulation(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project)): Path<(String, String)>,
    headers: HeaderMap,
    Json(body): Json<CreateSimulationRequest>,
) -> Result<(axum::http::StatusCode, Json<Value>), Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let idempotency = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let fork_body = serde_json::to_value(&body).map_err(Error::internal)?;
    let accepted = client(&state)?
        .create_simulation(&actor(user_id, &auth), &idempotency, &fork_body)
        .await
        .map_err(map_remote)?;
    let (function, args) = match &body.invocation {
        Invocation::Prepared { .. } => ("invoke_host_function", json!([])),
        Invocation::Decoded {
            function_name,
            args,
            ..
        } => (function_name.as_str(), args.clone()),
    };
    let requested_ledger = match body.state_source {
        StateSource::Ledger { ledger_sequence } => Some(ledger_sequence),
        _ => None,
    };
    let environment_id = match body.state_source {
        StateSource::Environment { environment_id, .. } => Some(environment_id),
        _ => None,
    };
    let local_id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO simulation_runs
            (project_id, base_ledger_sequence, function_name, args, overrides, status,
             created_by, fork_environment_id, fork_core_simulation_id, fork_core_job_id, fork_core_summary,
             requested_ledger,state_source,invocation,stage,progress)
         VALUES ($1, 0, $2, $3, $4, 'pending', $5, $6, $7, $8, $9,$10,$11,$12,'queued',0)
         ON CONFLICT (fork_core_simulation_id) WHERE fork_core_simulation_id IS NOT NULL
         DO UPDATE SET fork_core_job_id = EXCLUDED.fork_core_job_id
         RETURNING id",
    ).bind(auth.project_id).bind(function).bind(args).bind(json!(body.overrides))
        .bind(user_id).bind(environment_id).bind(accepted.simulation_id).bind(accepted.job_id)
        .bind(json!({ "status": accepted.status, "stage": accepted.stage, "progress": accepted.progress }))
        .bind(requested_ledger).bind(json!(body.state_source)).bind(json!(body.invocation))
        .fetch_one(&state.db).await.map_err(Error::internal)?;
    let mut public_accepted = serde_json::to_value(&accepted).map_err(Error::internal)?;
    public_accepted["simulation_url"] =
        json!(format!("/api/v1/{org}/{project}/simulations/{local_id}"));
    public_accepted["status_url"] =
        json!(format!("/api/v1/{org}/{project}/jobs/{}", accepted.job_id));
    Ok((
        axum::http::StatusCode::ACCEPTED,
        Json(json!({ "id": local_id, "fork_core": public_accepted })),
    ))
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
        "UPDATE simulation_runs SET status=$2,fork_core_summary=$3,
                requested_ledger=($3->>'requested_ledger')::bigint,
                state_ledger=($3->>'state_ledger')::bigint,execution_ledger=($3->>'execution_ledger')::bigint,
                base_ledger_sequence=COALESCE(($3->>'state_ledger')::bigint,base_ledger_sequence),
                protocol=($3->>'protocol')::integer,stage=COALESCE($3->>'stage',stage),
                progress=COALESCE(($3->>'progress')::smallint,progress),
                retry_count=COALESCE(($3->>'retry_count')::integer,retry_count),
                completeness_certificate=$3->'completeness_certificate',provenance=COALESCE($3->'provenance','[]'::jsonb),
                completed_at=CASE WHEN $2 IN ('success','failed','error','cancelled','inconclusive','unavailable','budget_limited') THEN COALESCE(completed_at,now()) ELSE completed_at END
          WHERE id = $1 AND project_id = $4",
    ).bind(simulation_id).bind(status).bind(&detail).bind(auth.project_id)
        .execute(&state.db).await.map_err(Error::internal)?;
    Ok(Json(json!({ "id": simulation_id, "fork_core": detail })))
}

pub async fn get_simulation_job(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, job_id)): Path<(String, String, Uuid)>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    Ok(Json(
        client(&state)?
            .get_job(&actor(user_id, &auth), job_id)
            .await
            .map_err(map_remote)?,
    ))
}

pub async fn cancel_simulation_job(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, job_id)): Path<(String, String, Uuid)>,
) -> Result<(axum::http::StatusCode, Json<Value>), Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    Ok((
        axum::http::StatusCode::ACCEPTED,
        Json(
            client(&state)?
                .cancel_job(&actor(user_id, &auth), job_id)
                .await
                .map_err(map_remote)?,
        ),
    ))
}

pub async fn cancel_simulation(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, simulation_id)): Path<(String, String, Uuid)>,
) -> Result<(axum::http::StatusCode, Json<Value>), Error> {
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
    sqlx::query(
        "UPDATE simulation_runs
            SET fork_core_summary=$3
          WHERE id=$1 AND project_id=$2",
    )
    .bind(simulation_id)
    .bind(auth.project_id)
    .bind(&result)
    .execute(&state.db)
    .await
    .map_err(Error::internal)?;
    Ok((
        axum::http::StatusCode::ACCEPTED,
        Json(json!({ "id": simulation_id, "fork_core": result })),
    ))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateAnalysisBody {
    #[serde(default)]
    verification_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct DebugTraceQuery {
    cursor: Option<usize>,
    limit: Option<usize>,
}

pub async fn create_simulation_analysis(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, simulation_id)): Path<(String, String, Uuid)>,
    headers: HeaderMap,
    Json(body): Json<CreateAnalysisBody>,
) -> Result<(axum::http::StatusCode, Json<Value>), Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let fork_id = sqlx::query_scalar::<_, Option<Uuid>>(
        "SELECT fork_core_simulation_id FROM simulation_runs WHERE id=$1 AND project_id=$2",
    )
    .bind(simulation_id)
    .bind(auth.project_id)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?
    .flatten()
    .ok_or(Error::NotFound)?;
    let trace = client(&state)?
        .get_simulation_trace(&actor(user_id, &auth), fork_id)
        .await
        .map_err(map_remote)?;
    let artifact = lens_client(&state)?
        .create_execution_artifact(
            &lens_actor(user_id, &auth),
            &json!({
                "network": trace.get("network").cloned().unwrap_or(Value::Null),
                "protocol": trace.get("protocol").cloned().unwrap_or(Value::Null),
                "origin": "fork_core_simulation",
                "external_reference": fork_id,
                "trace": trace,
            }),
        )
        .await
        .map_err(map_lens_remote)?;
    let artifact_id = artifact
        .get("execution_artifact_id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| Error::ServiceUnavailable("source_lens_invalid_response".into()))?;
    let idempotency = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty() && value.len() <= 128)
        .map(str::to_owned)
        .unwrap_or_else(|| format!("simulation-analysis-{simulation_id}"));
    let source_lens_verification_id = if let Some(verification_id) = body.verification_id {
        Some(
            sqlx::query_scalar::<_, Option<Uuid>>(
                "SELECT v.source_lens_verification_id FROM contract_verifications v JOIN contracts c ON c.id=v.contract_id WHERE v.id=$1 AND c.project_id=$2",
            )
            .bind(verification_id)
            .bind(auth.project_id)
            .fetch_optional(&state.db)
            .await
            .map_err(Error::internal)?
            .flatten()
            .ok_or(Error::NotFound)?,
        )
    } else {
        None
    };
    let accepted = lens_client(&state)?
        .create_analysis(
            &lens_actor(user_id, &auth),
            &idempotency,
            &json!({
                "execution_artifact_id": artifact_id,
                "verification_id": source_lens_verification_id,
            }),
        )
        .await
        .map_err(map_lens_remote)?;
    let analysis_id = accepted
        .analysis_id
        .ok_or_else(|| Error::ServiceUnavailable("source_lens_invalid_response".into()))?;
    sqlx::query(
        "UPDATE simulation_runs SET source_lens_execution_artifact_id=$2,source_lens_analysis_id=$3,source_lens_synced_at=now() WHERE id=$1 AND project_id=$4",
    )
    .bind(simulation_id)
    .bind(artifact_id)
    .bind(analysis_id)
    .bind(auth.project_id)
    .execute(&state.db)
    .await
    .map_err(Error::internal)?;
    Ok((
        axum::http::StatusCode::ACCEPTED,
        Json(json!({
            "simulation_id": simulation_id,
            "execution_artifact_id": artifact_id,
            "analysis_id": analysis_id,
            "job_id": accepted.job_id,
            "status": accepted.status,
            "created": accepted.created,
        })),
    ))
}

pub async fn get_simulation_analysis(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, simulation_id)): Path<(String, String, Uuid)>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let analysis_id = sqlx::query_scalar::<_, Option<Uuid>>(
        "SELECT source_lens_analysis_id FROM simulation_runs WHERE id=$1 AND project_id=$2",
    )
    .bind(simulation_id)
    .bind(auth.project_id)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?
    .flatten()
    .ok_or(Error::NotFound)?;
    let analysis = lens_client(&state)?
        .get_analysis(&lens_actor(user_id, &auth), analysis_id)
        .await
        .map_err(map_lens_remote)?;
    let capabilities = analysis
        .get("capabilities")
        .cloned()
        .unwrap_or_else(|| json!({}));
    sqlx::query(
        "UPDATE simulation_runs SET source_lens_capabilities=$2,source_lens_synced_at=now() WHERE id=$1 AND project_id=$3",
    )
    .bind(simulation_id)
    .bind(&capabilities)
    .bind(auth.project_id)
    .execute(&state.db)
    .await
    .map_err(Error::internal)?;
    Ok(Json(
        json!({"simulation_id":simulation_id,"analysis":analysis}),
    ))
}

pub async fn create_simulation_debugger(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, simulation_id)): Path<(String, String, Uuid)>,
    headers: HeaderMap,
) -> Result<(axum::http::StatusCode, Json<Value>), Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let analysis_id = sqlx::query_scalar::<_, Option<Uuid>>(
        "SELECT source_lens_analysis_id FROM simulation_runs WHERE id=$1 AND project_id=$2",
    )
    .bind(simulation_id)
    .bind(auth.project_id)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?
    .flatten()
    .ok_or(Error::NotFound)?;
    let idempotency = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty() && value.len() <= 128)
        .map(str::to_owned)
        .unwrap_or_else(|| format!("simulation-debugger-{simulation_id}"));
    let accepted = lens_client(&state)?
        .create_debug_session(&lens_actor(user_id, &auth), &idempotency, analysis_id)
        .await
        .map_err(map_lens_remote)?;
    let debug_id = accepted
        .debug_session_id
        .ok_or_else(|| Error::ServiceUnavailable("source_lens_invalid_response".into()))?;
    sqlx::query(
        "UPDATE simulation_runs SET source_lens_debug_session_id=$2,source_lens_synced_at=now() WHERE id=$1 AND project_id=$3",
    )
    .bind(simulation_id)
    .bind(debug_id)
    .bind(auth.project_id)
    .execute(&state.db)
    .await
    .map_err(Error::internal)?;
    Ok((
        axum::http::StatusCode::ACCEPTED,
        Json(json!({
            "simulation_id": simulation_id,
            "debug_session_id": debug_id,
            "job_id": accepted.job_id,
            "status": accepted.status,
            "created": accepted.created,
        })),
    ))
}

pub async fn get_simulation_debugger(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, simulation_id)): Path<(String, String, Uuid)>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let debug_id = sqlx::query_scalar::<_, Option<Uuid>>(
        "SELECT source_lens_debug_session_id FROM simulation_runs WHERE id=$1 AND project_id=$2",
    )
    .bind(simulation_id)
    .bind(auth.project_id)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?
    .flatten()
    .ok_or(Error::NotFound)?;
    let debug = lens_client(&state)?
        .get_debug_session(&lens_actor(user_id, &auth), debug_id)
        .await
        .map_err(map_lens_remote)?;
    Ok(Json(
        json!({"simulation_id":simulation_id,"debugger":debug}),
    ))
}

pub async fn get_simulation_debug_trace(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, simulation_id)): Path<(String, String, Uuid)>,
    Query(query): Query<DebugTraceQuery>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let debug_id = sqlx::query_scalar::<_, Option<Uuid>>(
        "SELECT source_lens_debug_session_id FROM simulation_runs WHERE id=$1 AND project_id=$2",
    )
    .bind(simulation_id)
    .bind(auth.project_id)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?
    .flatten()
    .ok_or(Error::NotFound)?;
    let trace = lens_client(&state)?
        .get_debug_trace_page(
            &lens_actor(user_id, &auth),
            debug_id,
            query.cursor,
            query.limit,
        )
        .await
        .map_err(map_lens_remote)?;
    Ok(Json(trace))
}

async fn analysis_binding(
    state: &AppState,
    project_id: Uuid,
    analysis_id: Uuid,
) -> Result<(Uuid, Option<Uuid>), Error> {
    sqlx::query_as::<_, (Uuid, Option<Uuid>)>(
        "SELECT id,source_lens_debug_session_id FROM simulation_runs WHERE project_id=$1 AND source_lens_analysis_id=$2",
    )
    .bind(project_id)
    .bind(analysis_id)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)
}

pub async fn get_debugger_workspace(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, analysis_id)): Path<(String, String, Uuid)>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let (simulation_id, debug_id) = analysis_binding(&state, auth.project_id, analysis_id).await?;
    let analysis = lens_client(&state)?
        .get_analysis(&lens_actor(user_id, &auth), analysis_id)
        .await
        .map_err(map_lens_remote)?;
    let debugger = if let Some(debug_id) = debug_id {
        Some(
            lens_client(&state)?
                .get_debug_session(&lens_actor(user_id, &auth), debug_id)
                .await
                .map_err(map_lens_remote)?,
        )
    } else {
        None
    };
    Ok(Json(json!({
        "analysis_id": analysis_id,
        "simulation_id": simulation_id,
        "analysis": analysis,
        "debugger": debugger,
    })))
}

pub async fn create_debugger_workspace(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, analysis_id)): Path<(String, String, Uuid)>,
    headers: HeaderMap,
) -> Result<(axum::http::StatusCode, Json<Value>), Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let (simulation_id, existing) = analysis_binding(&state, auth.project_id, analysis_id).await?;
    if let Some(debug_id) = existing {
        return Ok((
            axum::http::StatusCode::OK,
            Json(
                json!({"analysis_id":analysis_id,"simulation_id":simulation_id,"debug_session_id":debug_id,"created":false}),
            ),
        ));
    }
    let idempotency = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty() && value.len() <= 128)
        .map(str::to_owned)
        .unwrap_or_else(|| format!("analysis-debugger-{analysis_id}"));
    let accepted = lens_client(&state)?
        .create_debug_session(&lens_actor(user_id, &auth), &idempotency, analysis_id)
        .await
        .map_err(map_lens_remote)?;
    let debug_id = accepted
        .debug_session_id
        .ok_or_else(|| Error::ServiceUnavailable("source_lens_invalid_response".into()))?;
    sqlx::query("UPDATE simulation_runs SET source_lens_debug_session_id=$2,source_lens_synced_at=now() WHERE id=$1 AND project_id=$3")
        .bind(simulation_id).bind(debug_id).bind(auth.project_id).execute(&state.db).await.map_err(Error::internal)?;
    Ok((
        axum::http::StatusCode::ACCEPTED,
        Json(
            json!({"analysis_id":analysis_id,"simulation_id":simulation_id,"debug_session_id":debug_id,"job_id":accepted.job_id,"status":accepted.status,"created":accepted.created}),
        ),
    ))
}

pub async fn get_debugger_workspace_trace(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, analysis_id)): Path<(String, String, Uuid)>,
    Query(query): Query<DebugTraceQuery>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let (_, debug_id) = analysis_binding(&state, auth.project_id, analysis_id).await?;
    let debug_id = debug_id.ok_or(Error::NotFound)?;
    let trace = lens_client(&state)?
        .get_debug_trace_page(
            &lens_actor(user_id, &auth),
            debug_id,
            query.cursor,
            query.limit,
        )
        .await
        .map_err(map_lens_remote)?;
    Ok(Json(trace))
}

pub async fn get_debugger_source_file(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, analysis_id, source_path)): Path<(String, String, Uuid, String)>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    analysis_binding(&state, auth.project_id, analysis_id).await?;
    let analysis = lens_client(&state)?
        .get_analysis(&lens_actor(user_id, &auth), analysis_id)
        .await
        .map_err(map_lens_remote)?;
    let verification_id = analysis
        .get("verification_id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or(Error::NotFound)?;
    let bytes = lens_client(&state)?
        .get_source_file(&lens_actor(user_id, &auth), verification_id, &source_path)
        .await
        .map_err(map_lens_remote)?;
    let content = String::from_utf8(bytes)
        .map_err(|_| Error::BadRequest("Source file is not UTF-8 text".into()))?;
    Ok(Json(json!({"path":source_path,"content":content})))
}
