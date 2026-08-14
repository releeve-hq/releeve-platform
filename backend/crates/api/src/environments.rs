//! Project-scoped Fork Core environment proxy.
//!
//! Fork Core remains private. The browser only talks to Platform, which
//! authorizes the user and issues the short-lived service assertion upstream.

use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};
use serde::Deserialize;
use serde_json::{Value, json};
use shared::{Error, Permission, PermissionSet};
use sqlx::PgPool;
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

fn environment_uuid(environment: &Value, field: &str) -> Result<Option<Uuid>, Error> {
    environment
        .get(field)
        .and_then(Value::as_str)
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| Error::ServiceUnavailable("fork_core_invalid_response".into()))
}

async fn persist_environment(
    pool: &PgPool,
    project_id: Uuid,
    environment: &Value,
) -> Result<(), Error> {
    let id = environment_uuid(environment, "id")?
        .ok_or_else(|| Error::ServiceUnavailable("fork_core_invalid_response".into()))?;
    let network = environment
        .get("network")
        .and_then(Value::as_str)
        .filter(|network| matches!(*network, "mainnet" | "testnet"))
        .ok_or_else(|| Error::ServiceUnavailable("fork_core_invalid_response".into()))?;
    let name = environment
        .get("name")
        .and_then(Value::as_str)
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| Error::ServiceUnavailable("fork_core_invalid_response".into()))?;
    let state_ledger = environment
        .get("state_ledger")
        .and_then(Value::as_i64)
        .ok_or_else(|| Error::ServiceUnavailable("fork_core_invalid_response".into()))?;
    let protocol = environment
        .get("protocol")
        .and_then(Value::as_i64)
        .and_then(|value| i32::try_from(value).ok())
        .ok_or_else(|| Error::ServiceUnavailable("fork_core_invalid_response".into()))?;
    let result = sqlx::query(
        "INSERT INTO fork_environments
            (id,project_id,name,base_ledger_sequence,state_sync_enabled,
             fork_core_environment_id,mode,active_revision_id,requested_ledger,state_ledger,
             execution_ledger,protocol,state_hash,verification_status,network,revision,sync_status)
         VALUES($1,$2,$3,$4,$5,$1,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT(id) DO UPDATE SET
             name=EXCLUDED.name,base_ledger_sequence=EXCLUDED.base_ledger_sequence,
             state_sync_enabled=EXCLUDED.state_sync_enabled,mode=EXCLUDED.mode,
             active_revision_id=EXCLUDED.active_revision_id,
             requested_ledger=EXCLUDED.requested_ledger,state_ledger=EXCLUDED.state_ledger,
             execution_ledger=EXCLUDED.execution_ledger,protocol=EXCLUDED.protocol,
             state_hash=EXCLUDED.state_hash,verification_status=EXCLUDED.verification_status,
             network=EXCLUDED.network,revision=EXCLUDED.revision,sync_status=EXCLUDED.sync_status
         WHERE fork_environments.project_id=EXCLUDED.project_id
           AND fork_environments.fork_core_environment_id=EXCLUDED.fork_core_environment_id",
    )
    .bind(id)
    .bind(project_id)
    .bind(name)
    .bind(state_ledger)
    .bind(
        environment
            .get("sync_enabled")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    )
    .bind(
        environment
            .get("mode")
            .and_then(Value::as_str)
            .unwrap_or("frozen"),
    )
    .bind(environment_uuid(environment, "active_revision_id")?)
    .bind(environment.get("requested_ledger").and_then(Value::as_i64))
    .bind(state_ledger)
    .bind(environment.get("execution_ledger").and_then(Value::as_i64))
    .bind(protocol)
    .bind(environment.get("state_hash").and_then(Value::as_str))
    .bind(
        environment
            .get("verification_status")
            .and_then(Value::as_str)
            .unwrap_or("pending"),
    )
    .bind(network)
    .bind(environment.get("revision").and_then(Value::as_i64))
    .bind(
        environment
            .get("sync_status")
            .and_then(Value::as_str)
            .unwrap_or("paused"),
    )
    .execute(pool)
    .await
    .map_err(Error::internal)?;
    if result.rows_affected() != 1 {
        tracing::error!(%id, %project_id, "Fork Core environment identity collision");
        return Err(Error::ServiceUnavailable(
            "fork_core_environment_identity_conflict".into(),
        ));
    }
    Ok(())
}

async fn persist_environment_list(
    pool: &PgPool,
    project_id: Uuid,
    response: &Value,
) -> Result<(), Error> {
    let environments = response
        .get("environments")
        .and_then(Value::as_array)
        .ok_or_else(|| Error::ServiceUnavailable("fork_core_invalid_response".into()))?;
    let mut ids = Vec::with_capacity(environments.len());
    for environment in environments {
        persist_environment(pool, project_id, environment).await?;
        ids.push(
            environment_uuid(environment, "id")?
                .ok_or_else(|| Error::ServiceUnavailable("fork_core_invalid_response".into()))?,
        );
    }
    sqlx::query(
        "DELETE FROM fork_environments
          WHERE project_id=$1 AND fork_core_environment_id IS NOT NULL
            AND NOT (id=ANY($2))",
    )
    .bind(project_id)
    .bind(ids)
    .execute(pool)
    .await
    .map_err(Error::internal)?;
    Ok(())
}

async fn refresh_environment(
    state: &AppState,
    user_id: Uuid,
    auth: &ProjectAuth,
    environment_id: Uuid,
) -> Result<Value, Error> {
    let environment = client(state)?
        .get_environment(&actor(user_id, auth), environment_id)
        .await
        .map_err(map_remote)?;
    persist_environment(&state.db, auth.project_id, &environment).await?;
    Ok(environment)
}

fn map_remote(error: sim::Error) -> Error {
    tracing::warn!(%error, "Fork Core environment request failed");
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

pub async fn create_environment(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project)): Path<(String, String)>,
    Json(body): Json<CreateEnvironmentRequest>,
) -> Result<(axum::http::StatusCode, Json<Value>), Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let fork_simulation_id = sqlx::query_scalar::<_, Option<Uuid>>(
        "SELECT fork_core_simulation_id FROM simulation_runs
          WHERE id=$1 AND project_id=$2 AND status='success'",
    )
    .bind(body.simulation_id)
    .bind(auth.project_id)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?
    .flatten()
    .ok_or_else(|| {
        Error::BadRequest(
            "A completed certified simulation is required to create an environment".into(),
        )
    })?;
    let upstream =
        json!({ "name": body.name, "simulation_id": fork_simulation_id, "mode": body.mode });
    let environment = client(&state)?
        .create_environment(&actor(user_id, &auth), &upstream)
        .await
        .map_err(map_remote)?;
    persist_environment(&state.db, auth.project_id, &environment).await?;
    Ok((axum::http::StatusCode::CREATED, Json(environment)))
}

#[derive(Debug, Deserialize)]
pub struct CreateEnvironmentRequest {
    name: String,
    simulation_id: Uuid,
    #[serde(default = "frozen_mode")]
    mode: String,
}

fn frozen_mode() -> String {
    "frozen".into()
}

pub async fn list_environments(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project)): Path<(String, String)>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let environments = client(&state)?
        .list_environments(&actor(user_id, &auth))
        .await
        .map_err(map_remote)?;
    persist_environment_list(&state.db, auth.project_id, &environments).await?;
    Ok(Json(environments))
}

pub async fn get_environment(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, environment_id)): Path<(String, String, Uuid)>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    Ok(Json(
        refresh_environment(&state, user_id, &auth, environment_id).await?,
    ))
}

pub async fn update_environment(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, environment_id)): Path<(String, String, Uuid)>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let environment = client(&state)?
        .update_environment(&actor(user_id, &auth), environment_id, &body)
        .await
        .map_err(map_remote)?;
    persist_environment(&state.db, auth.project_id, &environment).await?;
    Ok(Json(environment))
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
    sqlx::query("DELETE FROM fork_environments WHERE id=$1 AND project_id=$2")
        .bind(environment_id)
        .bind(auth.project_id)
        .execute(&state.db)
        .await
        .map_err(Error::internal)?;
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
    let mut value = client(&state)?
        .environment_action(
            &actor(user_id, &auth),
            environment_id,
            &action,
            body.as_ref(),
            idempotency_key,
        )
        .await
        .map_err(map_remote)?;
    if let Some(job_id) = value.get("job_id").and_then(Value::as_str) {
        value["status_url"] = json!(format!("/api/v1/{org}/{project}/jobs/{job_id}"));
    }
    if matches!(action, "sync/start" | "sync/stop") || (action == "overrides" && body.is_some()) {
        refresh_environment(&state, user_id, &auth, environment_id).await?;
    }
    Ok(Json(value))
}

pub async fn environment_simulate(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, environment_id)): Path<(String, String, Uuid)>,
    headers: HeaderMap,
    body: Option<Json<Value>>,
) -> Result<(axum::http::StatusCode, Json<Value>), Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let idempotency_key = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let body = body
        .map(|Json(value)| value)
        .ok_or_else(|| Error::BadRequest("Simulation request is required".into()))?;
    let request = body.clone();
    let accepted_value = client(&state)?
        .environment_action(
            &actor(user_id, &auth),
            environment_id,
            "simulate",
            Some(&body),
            Some(&idempotency_key),
        )
        .await
        .map_err(map_remote)?;
    let accepted: sim::AcceptedSimulation = serde_json::from_value(accepted_value)
        .map_err(|_| Error::ServiceUnavailable("fork_core_invalid_response".into()))?;
    let fork_simulation_id = accepted.simulation_id;
    let fork_job_id = accepted.job_id;
    let local_id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO simulation_runs(project_id,base_ledger_sequence,function_name,args,overrides,status,created_by,fork_environment_id,fork_core_simulation_id,fork_core_job_id,fork_core_summary)
         VALUES($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9,$10)
         ON CONFLICT(fork_core_simulation_id) WHERE fork_core_simulation_id IS NOT NULL
         DO UPDATE SET fork_core_job_id=EXCLUDED.fork_core_job_id RETURNING id",
    )
    .bind(auth.project_id)
    .bind(0_i64)
    .bind(request.pointer("/invocation/function_name").and_then(Value::as_str).unwrap_or("invoke_host_function"))
    .bind(request.pointer("/invocation/args").cloned().unwrap_or_else(|| json!([])))
    .bind(request.get("overrides").cloned().unwrap_or_else(|| json!([])))
    .bind(user_id)
    .bind(environment_id)
    .bind(fork_simulation_id)
    .bind(fork_job_id)
    .bind(json!({
        "status": accepted.status,
        "stage": accepted.stage,
        "progress": accepted.progress,
        "retry_after_ms": accepted.retry_after_ms,
    }))
    .fetch_one(&state.db)
    .await
    .map_err(Error::internal)?;
    let mut public_accepted = serde_json::to_value(accepted).map_err(Error::internal)?;
    public_accepted["simulation_url"] =
        json!(format!("/api/v1/{org}/{project}/simulations/{local_id}"));
    public_accepted["status_url"] = json!(format!("/api/v1/{org}/{project}/jobs/{fork_job_id}"));
    Ok((
        axum::http::StatusCode::ACCEPTED,
        Json(json!({"id":local_id,"fork_core":public_accepted})),
    ))
}

pub async fn network_coverage(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, network)): Path<(String, String, String)>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    Ok(Json(
        client(&state)?
            .network_coverage(&actor(user_id, &auth), &network)
            .await
            .map_err(map_remote)?,
    ))
}

pub async fn repair_network_coverage(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, network)): Path<(String, String, String)>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<(axum::http::StatusCode, Json<Value>), Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let idempotency_key = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .ok_or_else(|| Error::BadRequest("Idempotency-Key is required".into()))?;
    let mut value = client(&state)?
        .repair_network_coverage(&actor(user_id, &auth), &network, idempotency_key, &body)
        .await
        .map_err(map_remote)?;
    if let Some(job_id) = value.get("job_id").and_then(Value::as_str) {
        value["status_url"] = json!(format!("/api/v1/{org}/{project}/jobs/{job_id}"));
    }
    Ok((axum::http::StatusCode::ACCEPTED, Json(value)))
}

pub async fn environment_revisions(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, environment_id)): Path<(String, String, Uuid)>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    Ok(Json(
        client(&state)?
            .environment_revisions(&actor(user_id, &auth), environment_id)
            .await
            .map_err(map_remote)?,
    ))
}

pub async fn activate_environment_revision(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, environment_id, revision_id)): Path<(String, String, Uuid, Uuid)>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let value = client(&state)?
        .activate_environment_revision(&actor(user_id, &auth), environment_id, revision_id)
        .await
        .map_err(map_remote)?;
    refresh_environment(&state, user_id, &auth, environment_id).await?;
    Ok(Json(value))
}

pub async fn branch_environment_revision(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, environment_id, revision_id)): Path<(String, String, Uuid, Uuid)>,
    Json(body): Json<Value>,
) -> Result<(axum::http::StatusCode, Json<Value>), Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let environment = client(&state)?
        .branch_environment_revision(&actor(user_id, &auth), environment_id, revision_id, &body)
        .await
        .map_err(map_remote)?;
    persist_environment(&state.db, auth.project_id, &environment).await?;
    Ok((axum::http::StatusCode::CREATED, Json(environment)))
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
    headers: HeaderMap,
) -> Result<(axum::http::StatusCode, Json<Value>), Error> {
    let idempotency_key = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .ok_or_else(|| Error::BadRequest("Idempotency-Key is required".into()))?;
    let response =
        run_environment_action(state, user, path, "sync/start", None, Some(idempotency_key))
            .await?;
    Ok((axum::http::StatusCode::ACCEPTED, response))
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
    let value = client(&state)?
        .delete_environment_override(&actor(user_id, &auth), environment_id, override_id)
        .await
        .map_err(map_remote)?;
    refresh_environment(&state, user_id, &auth, environment_id).await?;
    Ok(Json(value))
}

#[cfg(test)]
mod tests {
    use super::*;
    use test_support::{run_migrations, spawn_postgres};

    fn environment(id: Uuid, name: &str, revision: i64) -> Value {
        json!({
            "id": id,
            "name": name,
            "network": "mainnet",
            "mode": "follow_latest",
            "sync_enabled": true,
            "sync_status": "healthy",
            "active_revision_id": Uuid::new_v4(),
            "requested_ledger": 62_447_231,
            "state_ledger": 62_447_232,
            "execution_ledger": 62_447_233,
            "protocol": 26,
            "state_hash": format!("state-{revision}"),
            "verification_status": "verified",
            "revision": revision
        })
    }

    async fn create_project(pool: &PgPool, organization_id: Uuid, slug: &str) -> Uuid {
        sqlx::query_scalar(
            "INSERT INTO projects(organization_id,slug,name,network)
             VALUES($1,$2,$2,'testnet') RETURNING id",
        )
        .bind(organization_id)
        .bind(slug)
        .fetch_one(pool)
        .await
        .expect("project is created")
    }

    #[tokio::test]
    async fn authoritative_environment_persistence_is_complete_and_tenant_scoped() {
        let pg = spawn_postgres().await;
        run_migrations(&pg.pool).await;

        let owner_user_id: Uuid = sqlx::query_scalar(
            "INSERT INTO users(email,email_verified)
             VALUES('environment-persistence@releeve.test',true) RETURNING id",
        )
        .fetch_one(&pg.pool)
        .await
        .expect("owner is created");
        let organization_id: Uuid = sqlx::query_scalar(
            "INSERT INTO organizations(slug,name,is_personal,owner_user_id)
             VALUES('environment-persistence','Environment persistence',false,$1)
             RETURNING id",
        )
        .bind(owner_user_id)
        .fetch_one(&pg.pool)
        .await
        .expect("organization is created");
        let project_a = create_project(&pg.pool, organization_id, "project-a").await;
        let project_b = create_project(&pg.pool, organization_id, "project-b").await;

        let environment_id = Uuid::new_v4();
        let initial = environment(environment_id, "Mainnet lab", 1);
        persist_environment(&pg.pool, project_a, &initial)
            .await
            .expect("authoritative environment is persisted");

        let stored = sqlx::query_as::<
            _,
            (
                Uuid,
                String,
                String,
                i64,
                Option<i64>,
                Option<i64>,
                Option<i64>,
                Option<i32>,
                Option<String>,
                String,
                Option<i64>,
                String,
                bool,
            ),
        >(
            "SELECT project_id,name,network,base_ledger_sequence,requested_ledger,
                    state_ledger,execution_ledger,protocol,state_hash,
                    verification_status,revision,sync_status,state_sync_enabled
               FROM fork_environments WHERE id=$1",
        )
        .bind(environment_id)
        .fetch_one(&pg.pool)
        .await
        .expect("environment row exists");
        assert_eq!(stored.0, project_a);
        assert_eq!(stored.1, "Mainnet lab");
        assert_eq!(stored.2, "mainnet");
        assert_eq!(stored.3, 62_447_232);
        assert_eq!(stored.4, Some(62_447_231));
        assert_eq!(stored.5, Some(62_447_232));
        assert_eq!(stored.6, Some(62_447_233));
        assert_eq!(stored.7, Some(26));
        assert_eq!(stored.8.as_deref(), Some("state-1"));
        assert_eq!(stored.9, "verified");
        assert_eq!(stored.10, Some(1));
        assert_eq!(stored.11, "healthy");
        assert!(stored.12);

        let mut updated = environment(environment_id, "Renamed lab", 2);
        updated["mode"] = json!("frozen");
        updated["sync_enabled"] = json!(false);
        updated["sync_status"] = json!("paused");
        updated["state_ledger"] = json!(62_447_240);
        persist_environment(&pg.pool, project_a, &updated)
            .await
            .expect("new authoritative revision replaces stale fields");
        let updated_row: (String, i64, Option<i64>, String, bool) = sqlx::query_as(
            "SELECT name,base_ledger_sequence,revision,sync_status,state_sync_enabled
               FROM fork_environments WHERE id=$1",
        )
        .bind(environment_id)
        .fetch_one(&pg.pool)
        .await
        .expect("updated row exists");
        assert_eq!(
            updated_row,
            (
                "Renamed lab".into(),
                62_447_240,
                Some(2),
                "paused".into(),
                false
            )
        );

        let collision = persist_environment(&pg.pool, project_b, &updated)
            .await
            .expect_err("Fork Core identity cannot move between projects");
        assert!(matches!(
            collision,
            Error::ServiceUnavailable(ref dependency)
                if dependency == "fork_core_environment_identity_conflict"
        ));

        let stale_id = Uuid::new_v4();
        persist_environment(&pg.pool, project_a, &environment(stale_id, "Stale", 1))
            .await
            .expect("stale reference is seeded");
        let other_project_id = Uuid::new_v4();
        persist_environment(
            &pg.pool,
            project_b,
            &environment(other_project_id, "Other project", 1),
        )
        .await
        .expect("other project environment is seeded");

        persist_environment_list(&pg.pool, project_a, &json!({"environments": [updated]}))
            .await
            .expect("authoritative list reconciliation succeeds");
        let stale_exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM fork_environments WHERE id=$1)")
                .bind(stale_id)
                .fetch_one(&pg.pool)
                .await
                .expect("stale reference query succeeds");
        let other_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM fork_environments WHERE id=$1 AND project_id=$2)",
        )
        .bind(other_project_id)
        .bind(project_b)
        .fetch_one(&pg.pool)
        .await
        .expect("other project query succeeds");
        assert!(
            !stale_exists,
            "stale current-project references are removed"
        );
        assert!(other_exists, "reconciliation cannot alter another project");

        let malformed = json!({
            "id": Uuid::new_v4(),
            "name": "Bad network",
            "network": "futurenet",
            "state_ledger": 1,
            "protocol": 26
        });
        assert!(matches!(
            persist_environment(&pg.pool, project_a, &malformed).await,
            Err(Error::ServiceUnavailable(ref dependency))
                if dependency == "fork_core_invalid_response"
        ));

        let legacy_snapshot = json!({
            "id": Uuid::new_v4(),
            "name": "Caller-owned snapshot",
            "network": "mainnet",
            "base_ledger_sequence": 62_447_231,
            "protocol": 26
        });
        assert!(matches!(
            persist_environment(&pg.pool, project_a, &legacy_snapshot).await,
            Err(Error::ServiceUnavailable(ref dependency))
                if dependency == "fork_core_invalid_response"
        ));
    }
}
