//! Authorized project proxy for Fork Core's seven-day Mainnet replay API.
//! Canonical XDR, replay state, and capsules remain exclusively in Fork Core.

use axum::{
    Json,
    extract::{Path, Query, State},
    http::HeaderMap,
};
use serde::Deserialize;
use serde_json::{Value, json};
use shared::{Error, Permission, PermissionSet};
use uuid::Uuid;

use crate::{
    extract::AuthUser, simulations::normalize_replay_invocations_for_fork, state::AppState,
};

struct ProjectAuth {
    organization_id: Uuid,
    project_id: Uuid,
}

#[derive(Debug, Deserialize)]
pub struct HistoryQuery {
    #[serde(default = "mainnet")]
    network: String,
}

fn mainnet() -> String {
    "mainnet".into()
}

async fn authorize(
    state: &AppState,
    user_id: Uuid,
    org: &str,
    project: &str,
) -> Result<ProjectAuth, Error> {
    let row = sqlx::query_as::<_, (Uuid, Uuid, bool, i16)>(
        "SELECT o.id,p.id,u.email_verified,m.permissions
           FROM organizations o
           JOIN organization_members m ON m.organization_id=o.id AND m.user_id=$1
           JOIN users u ON u.id=m.user_id
           JOIN projects p ON p.organization_id=o.id
          WHERE o.slug=$2 AND p.slug=$3",
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

fn actor(user_id: Uuid, auth: &ProjectAuth) -> sim::ServiceActor {
    sim::ServiceActor::fork_manager(
        user_id,
        auth.organization_id,
        auth.project_id,
        Uuid::new_v4(),
    )
}

fn map_remote(error: sim::Error) -> Error {
    tracing::warn!(%error, "Fork Core replay request failed");
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
    tracing::warn!(%error, "SourceLens replay request failed");
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
            Error::BadRequest("SourceLens rejected the replay trace".into())
        }
        source_lens_client::Error::Remote { status, .. } if status.is_server_error() => {
            Error::ServiceUnavailable("source_lens".into())
        }
        source_lens_client::Error::Transport(_) => Error::ServiceUnavailable("source_lens".into()),
        other => Error::internal(other),
    }
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

fn idempotency(headers: &HeaderMap) -> Result<&str, Error> {
    headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .ok_or_else(|| Error::BadRequest("Idempotency-Key is required".into()))
}

async fn audit(
    state: &AppState,
    project_id: Uuid,
    replay_id: Option<Uuid>,
    user_id: Uuid,
    action: &str,
    metadata: Value,
) -> Result<(), Error> {
    sqlx::query(
        "INSERT INTO historical_replay_audit
            (project_id,fork_core_replay_id,actor_id,action,metadata)
         VALUES($1,$2,$3,$4,$5)",
    )
    .bind(project_id)
    .bind(replay_id)
    .bind(user_id)
    .bind(action)
    .bind(metadata)
    .execute(&state.db)
    .await
    .map_err(Error::internal)?;
    Ok(())
}

pub async fn history_coverage(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project)): Path<(String, String)>,
    Query(query): Query<HistoryQuery>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    client(&state)?
        .history_coverage(&actor(user_id, &auth), &query.network)
        .await
        .map(Json)
        .map_err(map_remote)
}

pub async fn historical_transaction(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, hash)): Path<(String, String, String)>,
    Query(query): Query<HistoryQuery>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    client(&state)?
        .historical_transaction(&actor(user_id, &auth), &query.network, &hash)
        .await
        .map(Json)
        .map_err(map_remote)
}

async fn audit_timeline(
    state: &AppState,
    project_id: Uuid,
    timeline_id: Uuid,
    replay_id: Option<Uuid>,
    user_id: Uuid,
    action: &str,
    metadata: Value,
) -> Result<(), Error> {
    sqlx::query(
        "INSERT INTO historical_replay_audit
            (project_id,fork_core_replay_id,fork_core_timeline_id,actor_id,action,metadata)
         VALUES($1,$2,$3,$4,$5,$6)",
    )
    .bind(project_id)
    .bind(replay_id)
    .bind(timeline_id)
    .bind(user_id)
    .bind(action)
    .bind(metadata)
    .execute(&state.db)
    .await
    .map_err(Error::internal)?;
    Ok(())
}

pub async fn create_history_timeline(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project)): Path<(String, String)>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<(axum::http::StatusCode, Json<Value>), Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let response = client(&state)?
        .create_history_timeline(&actor(user_id, &auth), &body, idempotency(&headers)?)
        .await
        .map_err(map_remote)?;
    let timeline_id = response
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| Error::ServiceUnavailable("fork_core_invalid_response".into()))?;
    audit_timeline(
        &state,
        auth.project_id,
        timeline_id,
        None,
        user_id,
        "timeline_created",
        json!({
            "network":body.get("network"),
            "start_ledger":body.get("start_ledger"),
            "end_ledger":body.get("end_ledger"),
            "target_contract_count":body.get("target_contracts").and_then(Value::as_array).map(Vec::len)
            ,"target_account_count":body.get("target_accounts").and_then(Value::as_array).map(Vec::len)
        }),
    )
    .await?;
    Ok((axum::http::StatusCode::ACCEPTED, Json(response)))
}

#[derive(Debug, Deserialize)]
pub struct HistoryTargetsQuery {
    start_time: i64,
    end_time: i64,
    #[serde(default)]
    query: String,
    #[serde(default = "history_targets_limit")]
    limit: i64,
}

fn history_targets_limit() -> i64 {
    40
}

pub async fn history_targets(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project)): Path<(String, String)>,
    Query(query): Query<HistoryTargetsQuery>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    client(&state)?
        .history_targets(
            &actor(user_id, &auth),
            "mainnet",
            query.start_time,
            query.end_time,
            &query.query,
            query.limit,
        )
        .await
        .map(Json)
        .map_err(map_remote)
}

#[derive(Debug, Deserialize)]
pub struct TimelinePageQuery {
    #[serde(default = "timeline_after")]
    after: i32,
    #[serde(default = "timeline_limit")]
    limit: i64,
}

fn timeline_after() -> i32 {
    -1
}

fn timeline_limit() -> i64 {
    100
}

pub async fn get_history_timeline(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, timeline_id)): Path<(String, String, Uuid)>,
    Query(query): Query<TimelinePageQuery>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    client(&state)?
        .get_history_timeline(
            &actor(user_id, &auth),
            timeline_id,
            query.after,
            query.limit,
        )
        .await
        .map(Json)
        .map_err(map_remote)
}

pub async fn fork_history_timeline(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, timeline_id)): Path<(String, String, Uuid)>,
    headers: HeaderMap,
    Json(mut body): Json<Value>,
) -> Result<(axum::http::StatusCode, Json<Value>), Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    normalize_replay_invocations_for_fork(&mut body)?;
    let response = client(&state)?
        .fork_history_timeline(
            &actor(user_id, &auth),
            timeline_id,
            &body,
            idempotency(&headers)?,
        )
        .await
        .map_err(map_remote)?;
    let replay_id = response
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    audit_timeline(
        &state,
        auth.project_id,
        timeline_id,
        replay_id,
        user_id,
        "timeline_forked",
        json!({"from_ordinal":body.get("from_ordinal"),"through_ordinal":body.get("through_ordinal")}),
    )
    .await?;
    Ok((axum::http::StatusCode::ACCEPTED, Json(response)))
}

pub async fn create_replay(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project)): Path<(String, String)>,
    headers: HeaderMap,
    Json(mut body): Json<Value>,
) -> Result<(axum::http::StatusCode, Json<Value>), Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    normalize_replay_invocations_for_fork(&mut body)?;
    let response = client(&state)?
        .create_replay(&actor(user_id, &auth), &body, idempotency(&headers)?)
        .await
        .map_err(map_remote)?;
    let replay_id = response
        .get("id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok());
    audit(
        &state,
        auth.project_id,
        replay_id,
        user_id,
        "created",
        json!({"mode":body.get("mode"),"network":body.get("network")}),
    )
    .await?;
    Ok((axum::http::StatusCode::ACCEPTED, Json(response)))
}

pub async fn get_replay(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, replay_id)): Path<(String, String, Uuid)>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    client(&state)?
        .get_replay(&actor(user_id, &auth), replay_id)
        .await
        .map(Json)
        .map_err(map_remote)
}

pub async fn cancel_replay(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, replay_id)): Path<(String, String, Uuid)>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let response = client(&state)?
        .cancel_replay(&actor(user_id, &auth), replay_id)
        .await
        .map_err(map_remote)?;
    audit(
        &state,
        auth.project_id,
        Some(replay_id),
        user_id,
        "cancelled",
        json!({}),
    )
    .await?;
    Ok(Json(response))
}

pub async fn promote_replay(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, replay_id)): Path<(String, String, Uuid)>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let response = client(&state)?
        .promote_replay(
            &actor(user_id, &auth),
            replay_id,
            &body,
            idempotency(&headers)?,
        )
        .await
        .map_err(map_remote)?;
    audit(
        &state,
        auth.project_id,
        Some(replay_id),
        user_id,
        "promoted",
        json!({"environment_id":response.get("environment_id")}),
    )
    .await?;
    Ok(Json(response))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateReplayAnalysisBody {
    #[serde(default)]
    verification_id: Option<Uuid>,
    #[serde(default)]
    transaction_hash: Option<String>,
}

fn replay_trace<'a>(replay: &'a Value, transaction_hash: Option<&str>) -> Result<&'a Value, Error> {
    let result = replay.get("result").ok_or_else(|| Error::Conflict)?;
    match result.get("mode").and_then(Value::as_str) {
        Some("exact_transaction") => result
            .pointer("/modified/execution_trace")
            .filter(|trace| !trace.is_null())
            .ok_or_else(|| {
                Error::BadRequest("this replay was created without capture_trace".into())
            }),
        Some("contract_window") => {
            let hash = transaction_hash.ok_or_else(|| {
                Error::BadRequest(
                    "transaction_hash is required for a contract-window analysis".into(),
                )
            })?;
            result
                .pointer("/modified/transactions")
                .and_then(Value::as_array)
                .and_then(|transactions| {
                    transactions.iter().find(|transaction| {
                        transaction.get("transaction_hash").and_then(Value::as_str) == Some(hash)
                    })
                })
                .and_then(|transaction| transaction.get("execution_trace"))
                .filter(|trace| !trace.is_null())
                .ok_or_else(|| {
                    Error::BadRequest(
                        "the selected replay transaction has no captured trace".into(),
                    )
                })
        }
        Some("timeline_branch") => {
            let hash = transaction_hash.ok_or_else(|| {
                Error::BadRequest(
                    "transaction_hash is required for a timeline-branch analysis".into(),
                )
            })?;
            result
                .get("transactions")
                .and_then(Value::as_array)
                .and_then(|transactions| {
                    transactions.iter().find(|transaction| {
                        transaction.get("transaction_hash").and_then(Value::as_str) == Some(hash)
                    })
                })
                .and_then(|transaction| transaction.pointer("/modified/execution_trace"))
                .filter(|trace| !trace.is_null())
                .ok_or_else(|| {
                    Error::BadRequest(
                        "the selected timeline transaction has no captured trace".into(),
                    )
                })
        }
        _ => Err(Error::Conflict),
    }
}

pub async fn create_replay_analysis(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, replay_id)): Path<(String, String, Uuid)>,
    headers: HeaderMap,
    Json(body): Json<CreateReplayAnalysisBody>,
) -> Result<(axum::http::StatusCode, Json<Value>), Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let transaction_hash = body.transaction_hash.as_deref().unwrap_or("");
    if let Some(existing) = sqlx::query_as::<_, (Uuid, Uuid)>(
        "SELECT source_lens_execution_artifact_id,source_lens_analysis_id
           FROM historical_replay_analysis_bindings
          WHERE project_id=$1 AND fork_core_replay_id=$2 AND transaction_hash=$3",
    )
    .bind(auth.project_id)
    .bind(replay_id)
    .bind(transaction_hash)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?
    {
        return Ok((
            axum::http::StatusCode::OK,
            Json(json!({
                "replay_id":replay_id,
                "execution_artifact_id":existing.0,
                "analysis_id":existing.1,
                "created":false
            })),
        ));
    }
    let replay = client(&state)?
        .get_replay(&actor(user_id, &auth), replay_id)
        .await
        .map_err(map_remote)?;
    let status = replay.get("status").and_then(Value::as_str);
    if !matches!(status, Some("success" | "inconclusive" | "budget_limited")) {
        return Err(Error::Conflict);
    }
    let trace = replay_trace(&replay, body.transaction_hash.as_deref())?.clone();
    let network = trace
        .get("network")
        .cloned()
        .unwrap_or_else(|| json!("mainnet"));
    let protocol = trace.get("protocol").cloned().unwrap_or_else(|| json!(27));
    let external_reference = if transaction_hash.is_empty() {
        replay_id.to_string()
    } else {
        format!("{replay_id}:{transaction_hash}")
    };
    let artifact = lens_client(&state)?
        .create_execution_artifact(
            &lens_actor(user_id, &auth),
            &json!({
                "network":network,
                "protocol":protocol,
                "origin":"fork_core_replay",
                "external_reference":external_reference,
                "trace":trace
            }),
        )
        .await
        .map_err(map_lens_remote)?;
    let artifact_id = artifact
        .get("execution_artifact_id")
        .and_then(Value::as_str)
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| Error::ServiceUnavailable("source_lens_invalid_response".into()))?;
    let source_lens_verification_id = if let Some(verification_id) = body.verification_id {
        Some(
            sqlx::query_scalar::<_, Option<Uuid>>(
                "SELECT v.source_lens_verification_id FROM contract_verifications v
                  JOIN contracts c ON c.id=v.contract_id
                 WHERE v.id=$1 AND c.project_id=$2",
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
    let analysis_key = idempotency(&headers)?;
    let accepted = lens_client(&state)?
        .create_analysis(
            &lens_actor(user_id, &auth),
            analysis_key,
            &json!({
                "execution_artifact_id":artifact_id,
                "verification_id":source_lens_verification_id
            }),
        )
        .await
        .map_err(map_lens_remote)?;
    let analysis_id = accepted
        .analysis_id
        .ok_or_else(|| Error::ServiceUnavailable("source_lens_invalid_response".into()))?;
    sqlx::query(
        "INSERT INTO historical_replay_analysis_bindings
            (project_id,fork_core_replay_id,transaction_hash,
             source_lens_execution_artifact_id,source_lens_analysis_id)
         VALUES($1,$2,$3,$4,$5)",
    )
    .bind(auth.project_id)
    .bind(replay_id)
    .bind(transaction_hash)
    .bind(artifact_id)
    .bind(analysis_id)
    .execute(&state.db)
    .await
    .map_err(Error::internal)?;
    audit(
        &state,
        auth.project_id,
        Some(replay_id),
        user_id,
        "analysis_created",
        json!({"analysis_id":analysis_id,"transaction_hash":body.transaction_hash}),
    )
    .await?;
    Ok((
        axum::http::StatusCode::ACCEPTED,
        Json(json!({
            "replay_id":replay_id,
            "execution_artifact_id":artifact_id,
            "analysis_id":analysis_id,
            "job_id":accepted.job_id,
            "status":accepted.status,
            "created":accepted.created
        })),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_lens_trace_selection_is_unambiguous() {
        let exact = json!({
            "result":{"mode":"exact_transaction","modified":{"execution_trace":{"format":"fork-core-execution-trace-v1"}}}
        });
        assert_eq!(
            replay_trace(&exact, None).unwrap()["format"],
            "fork-core-execution-trace-v1"
        );
        let window = json!({
            "result":{"mode":"contract_window","modified":{"transactions":[
                {"transaction_hash":"a","execution_trace":{"format":"trace-a"}},
                {"transaction_hash":"b","execution_trace":{"format":"trace-b"}}
            ]}}
        });
        assert!(replay_trace(&window, None).is_err());
        assert_eq!(
            replay_trace(&window, Some("b")).unwrap()["format"],
            "trace-b"
        );
        assert!(replay_trace(&window, Some("missing")).is_err());
        let timeline = json!({
            "result":{"mode":"timeline_branch","transactions":[
                {"transaction_hash":"c","modified":{"execution_trace":{"format":"trace-c"}}}
            ]}
        });
        assert_eq!(
            replay_trace(&timeline, Some("c")).unwrap()["format"],
            "trace-c"
        );
        assert!(replay_trace(&timeline, None).is_err());
    }
}
