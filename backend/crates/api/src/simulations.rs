use axum::{
    Json,
    extract::{Path, Query, State},
    http::HeaderMap,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use shared::{Error, Permission, PermissionSet};
use stellar_xdr::{
    AccountId, ContractDataDurability, ContractId, Hash, LedgerEntry, LedgerEntryData, LedgerKey,
    LedgerKeyAccount, LedgerKeyContractData, Limits, PublicKey, ReadXdr, ScAddress, ScSymbol,
    ScVal, ScVec, Uint256, VecM, WriteXdr,
};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{environments::decode_strkey_payload, extract::AuthUser, state::AppState};
use ingest::rpc::SorobanRpcClient;
use ingest::upstream::{Backoff, CircuitBreaker};

pub(crate) struct ProjectAuth {
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

#[derive(Debug, Deserialize)]
pub struct SimulationSequenceRequest {
    pub network: String,
    pub source_account: String,
    pub environment_id: Option<Uuid>,
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
        source_account: String,
        sequence_number: i64,
    },
}

pub(crate) async fn authorize(
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

fn simulation_rpc_url(network: &str, configured: &str) -> Option<String> {
    match network {
        "testnet" => Some("https://soroban-testnet.stellar.org".to_owned()),
        "mainnet" if !configured.trim().is_empty() => Some(configured.to_owned()),
        _ => None,
    }
}

fn simulation_backoff() -> Backoff {
    Backoff {
        base: std::time::Duration::from_millis(250),
        max: std::time::Duration::from_secs(5),
        jitter: 0.1,
        max_attempts: 3,
    }
}

fn simulation_breaker() -> CircuitBreaker {
    CircuitBreaker::new(3, std::time::Duration::from_secs(30))
}

fn account_id_from_address(source_account: &str) -> Result<AccountId, Error> {
    let normalized_address = source_account.trim().to_ascii_uppercase();
    let account_bytes = decode_strkey_payload(&normalized_address, 6 << 3, 32)
        .ok_or_else(|| Error::BadRequest("source account must be a valid G... address".into()))?;
    let account_bytes: [u8; 32] = account_bytes
        .try_into()
        .map_err(|_| Error::BadRequest("source account address has an invalid payload".into()))?;
    Ok(AccountId(PublicKey::PublicKeyTypeEd25519(Uint256(
        account_bytes,
    ))))
}

fn account_ledger_key(source_account: &str) -> Result<String, Error> {
    let account_id = account_id_from_address(source_account)?;
    LedgerKey::Account(LedgerKeyAccount { account_id })
        .to_xdr_base64(Limits::none())
        .map_err(Error::internal)
}

pub(crate) fn normalize_decoded_invocation_for_fork(body: &mut Value) -> Result<(), Error> {
    let Some(invocation) = body.get_mut("invocation").and_then(Value::as_object_mut) else {
        return Ok(());
    };
    normalize_invocation_object(invocation)
}

fn normalize_invocation_object(
    invocation: &mut serde_json::Map<String, Value>,
) -> Result<(), Error> {
    if invocation.get("type").and_then(Value::as_str) != Some("decoded") {
        return Ok(());
    }
    let source_account = invocation
        .get("source_account")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            Error::BadRequest("decoded invocation requires a source account address".into())
        })?;
    let source_account_xdr = account_id_from_address(source_account)?
        .to_xdr_base64(Limits::none())
        .map_err(Error::internal)?;
    invocation.remove("source_account");
    invocation.insert(
        "source_account_xdr".into(),
        Value::String(source_account_xdr),
    );
    Ok(())
}

pub(crate) fn normalize_replay_invocations_for_fork(body: &mut Value) -> Result<(), Error> {
    if let Some(replacement) = body.get_mut("replacement").and_then(Value::as_object_mut) {
        normalize_invocation_object(replacement)?;
    }
    if let Some(setup) = body
        .get_mut("setup_invocations")
        .and_then(Value::as_array_mut)
    {
        for invocation in setup {
            if let Some(invocation) = invocation.as_object_mut() {
                normalize_invocation_object(invocation)?;
            }
        }
    }
    if let Some(replacements) = body.get_mut("replacements").and_then(Value::as_array_mut) {
        for replacement in replacements {
            if let Some(invocation) = replacement
                .get_mut("invocation")
                .and_then(Value::as_object_mut)
            {
                normalize_invocation_object(invocation)?;
            }
        }
    }
    if let Some(overrides) = body.get_mut("overrides").and_then(Value::as_array_mut) {
        normalize_balance_overrides(overrides)?;
    }
    Ok(())
}

fn balance_ledger_key(target: &str, asset: &str) -> Result<String, Error> {
    let account_bytes = decode_strkey_payload(target, 6 << 3, 32).ok_or_else(|| {
        Error::BadRequest("balance account must be a valid Stellar address".into())
    })?;
    let account = AccountId(PublicKey::PublicKeyTypeEd25519(Uint256(
        account_bytes
            .try_into()
            .map_err(|_| Error::BadRequest("balance account has an invalid payload".into()))?,
    )));
    if matches!(asset.to_ascii_lowercase().as_str(), "native" | "xlm") {
        return LedgerKey::Account(LedgerKeyAccount {
            account_id: account,
        })
        .to_xdr_base64(Limits::none())
        .map_err(Error::internal);
    }
    let contract_bytes = decode_strkey_payload(asset, 2 << 3, 32).ok_or_else(|| {
        Error::BadRequest("balance asset must be XLM or a SAC contract ID".into())
    })?;
    let contract = ScAddress::Contract(ContractId(Hash(contract_bytes.try_into().map_err(
        |_| Error::BadRequest("balance asset has an invalid contract payload".into()),
    )?)));
    let key = ScVal::Vec(Some(ScVec(
        VecM::try_from(vec![
            ScVal::Symbol(ScSymbol::try_from(b"Balance".to_vec()).map_err(Error::internal)?),
            ScVal::Address(ScAddress::Account(account)),
        ])
        .map_err(Error::internal)?,
    )));
    LedgerKey::ContractData(LedgerKeyContractData {
        contract,
        key,
        durability: ContractDataDurability::Persistent,
    })
    .to_xdr_base64(Limits::none())
    .map_err(Error::internal)
}

pub(crate) fn contract_instance_ledger_key(contract_id: &str) -> Result<String, Error> {
    let contract_bytes = decode_strkey_payload(contract_id, 2 << 3, 32).ok_or_else(|| {
        Error::BadRequest("contract ID must be a valid Stellar contract address".into())
    })?;
    LedgerKey::ContractData(LedgerKeyContractData {
        contract: ScAddress::Contract(ContractId(Hash(
            contract_bytes
                .try_into()
                .map_err(|_| Error::BadRequest("contract ID has an invalid payload".into()))?,
        ))),
        key: ScVal::LedgerKeyContractInstance,
        durability: ContractDataDurability::Persistent,
    })
    .to_xdr_base64(Limits::none())
    .map_err(Error::internal)
}

fn normalize_balance_overrides(overrides: &mut [Value]) -> Result<(), Error> {
    for override_value in overrides {
        let Some(object) = override_value.as_object_mut() else {
            continue;
        };
        if object.get("type").and_then(Value::as_str) != Some("balance")
            || object.contains_key("ledger_key_xdr")
        {
            continue;
        }
        let target = object
            .get("target")
            .and_then(Value::as_str)
            .ok_or_else(|| Error::BadRequest("balance override requires an account".into()))?;
        let asset = object
            .get("asset")
            .and_then(Value::as_str)
            .unwrap_or("native");
        object.insert(
            "ledger_key_xdr".into(),
            Value::String(balance_ledger_key(target, asset)?),
        );
    }
    Ok(())
}

async fn read_account_entry(
    state: &AppState,
    user_id: Uuid,
    auth: &ProjectAuth,
    request: &SimulationSequenceRequest,
) -> Result<Value, Error> {
    let key = account_ledger_key(&request.source_account)?;
    read_ledger_entries(
        state,
        user_id,
        auth,
        &request.network,
        request.environment_id,
        vec![key],
    )
    .await
}

pub(crate) async fn read_ledger_entries(
    state: &AppState,
    user_id: Uuid,
    auth: &ProjectAuth,
    network: &str,
    environment_id: Option<Uuid>,
    keys: Vec<String>,
) -> Result<Value, Error> {
    let body = json!({
        "jsonrpc": "2.0",
        "id": Uuid::new_v4(),
        "method": "getLedgerEntries",
        "params": { "keys": keys }
    });
    if let Some(environment_id) = environment_id {
        let response = client(state)?
            .environment_rpc(&actor(user_id, auth), environment_id, &body)
            .await
            .map_err(map_remote)?;
        return Ok(response.get("result").cloned().unwrap_or(response));
    }
    let rpc_url = simulation_rpc_url(network, &state.settings.soroban_rpc_url)
        .ok_or_else(|| Error::BadRequest(format!("unsupported simulation network: {network}")))?;
    let mut rpc = SorobanRpcClient::new(rpc_url, simulation_backoff(), simulation_breaker());
    rpc.call("getLedgerEntries", body["params"].clone())
        .await
        .map_err(|error| Error::ServiceUnavailable(format!("soroban_rpc: {error:?}")))
}

fn decode_ledger_entry_data(xdr: &str) -> Result<LedgerEntryData, String> {
    if let Ok(data) = LedgerEntryData::from_xdr_base64(xdr, Limits::none()) {
        return Ok(data);
    }
    LedgerEntry::from_xdr_base64(xdr, Limits::none())
        .map(|entry| entry.data)
        .map_err(|error| error.to_string())
}

#[derive(Debug, Deserialize)]
pub struct SimulationContractEntriesRequest {
    pub network: String,
    pub contract_id: String,
    pub environment_id: Option<Uuid>,
}

pub async fn simulation_contract_entries(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project)): Path<(String, String)>,
    Json(request): Json<SimulationContractEntriesRequest>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let key = contract_instance_ledger_key(&request.contract_id)?;
    let result = read_ledger_entries(
        &state,
        user_id,
        &auth,
        &request.network,
        request.environment_id,
        vec![key],
    )
    .await?;
    let entries = result
        .get("entries")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|entry| {
            let key = entry.get("key").and_then(Value::as_str).unwrap_or_default();
            let raw_xdr = entry.get("xdr").and_then(Value::as_str);
            let decoded_key = LedgerKey::from_xdr_base64(key, Limits::none())
                .map(|value| format!("{value:?}"))
                .unwrap_or_else(|_| "Unavailable".into());
            let decoded_data = raw_xdr.and_then(|xdr| decode_ledger_entry_data(xdr).ok());
            let decoded_value = decoded_data
                .as_ref()
                .map(|value| format!("{value:?}"))
                .unwrap_or_else(|| "Entry not present in the selected state".into());
            let value_xdr = decoded_data.as_ref().and_then(|value| match value {
                LedgerEntryData::ContractData(data) => data.val.to_xdr_base64(Limits::none()).ok(),
                _ => None,
            });
            json!({
                "key": key,
                "raw_xdr": raw_xdr,
                "value_xdr": value_xdr,
                "decoded_key": decoded_key,
                "decoded_value": decoded_value,
                "durability": "persistent",
                "ttl": entry.get("liveUntilLedgerSeq").cloned().unwrap_or(Value::Null),
            })
        })
        .collect::<Vec<_>>();
    Ok(Json(json!({
        "entries": entries,
        "latest_ledger": result.get("latestLedger").cloned().unwrap_or(Value::Null),
    })))
}

pub async fn simulation_sequence(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project)): Path<(String, String)>,
    Json(request): Json<SimulationSequenceRequest>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let result = read_account_entry(&state, user_id, &auth, &request).await?;
    let xdr = result
        .pointer("/entries/0/xdr")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            Error::BadRequest("source account was not found in the selected ledger state".into())
        })?;
    let current = if let Ok(data) = LedgerEntryData::from_xdr_base64(xdr, Limits::none()) {
        match data {
            LedgerEntryData::Account(account) => account.seq_num.0,
            _ => {
                return Err(Error::BadRequest(
                    "ledger key did not resolve to an account".into(),
                ));
            }
        }
    } else {
        let entry = LedgerEntry::from_xdr_base64(xdr, Limits::none()).map_err(|error| {
            Error::BadRequest(format!("account ledger entry is invalid XDR: {error}"))
        })?;
        match entry.data {
            LedgerEntryData::Account(account) => account.seq_num.0,
            _ => {
                return Err(Error::BadRequest(
                    "ledger key did not resolve to an account".into(),
                ));
            }
        }
    };
    Ok(Json(json!({
        "current_sequence_number": current,
        "next_sequence_number": current.checked_add(1).ok_or_else(|| Error::BadRequest("account sequence is out of range".into()))?
    })))
}

pub async fn create_simulation(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project)): Path<(String, String)>,
    headers: HeaderMap,
    Json(mut body): Json<CreateSimulationRequest>,
) -> Result<(axum::http::StatusCode, Json<Value>), Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    normalize_balance_overrides(&mut body.overrides)?;
    let idempotency = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let mut fork_body = serde_json::to_value(&body).map_err(Error::internal)?;
    normalize_decoded_invocation_for_fork(&mut fork_body)?;
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
        "SELECT jsonb_build_object('id', id, 'status', status,
                 'source', COALESCE(NULLIF(invocation->>'source_account', ''), NULLIF(invocation->>'source_account_xdr', '')),
                 'target', NULLIF(invocation->>'contract_id', ''),
                 'function_name', function_name,
                 'base_ledger_sequence', base_ledger_sequence, 'fork_core_summary', fork_core_summary,
                 'fork_environment_id', fork_environment_id,
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
    let (fork_id, environment_id) = sqlx::query_as::<_, (Option<Uuid>, Option<Uuid>)>(
        "SELECT fork_core_simulation_id,fork_environment_id
           FROM simulation_runs WHERE id = $1 AND project_id = $2",
    )
    .bind(simulation_id)
    .bind(auth.project_id)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)?;
    let fork_id = fork_id.ok_or(Error::NotFound)?;
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
    let error = detail.get("error").or_else(|| detail.get("last_error"));
    if let Some(environment_id) = environment_id
        && error
            .and_then(|value| value.get("code"))
            .and_then(Value::as_str)
            == Some("frozen_state_unavailable")
    {
        sqlx::query(
            "UPDATE fork_environments
                SET initialization_status='failed',initialization_progress=100,
                    initialization_error=$1
              WHERE id=$2 AND project_id=$3",
        )
        .bind(error.cloned().unwrap_or_else(|| {
            json!({
                "code":"frozen_state_unavailable",
                "message":"Exact anchored state could not be proven."
            })
        }))
        .bind(environment_id)
        .bind(auth.project_id)
        .execute(&state.db)
        .await
        .map_err(Error::internal)?;
    }
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

struct AnalysisBinding {
    external_id: Uuid,
    debug_id: Option<Uuid>,
    origin: String,
}

async fn analysis_binding(
    state: &AppState,
    project_id: Uuid,
    analysis_id: Uuid,
) -> Result<AnalysisBinding, Error> {
    let (external_id, debug_id, origin) = sqlx::query_as::<_, (Uuid, Option<Uuid>, String)>(
        "SELECT id,source_lens_debug_session_id,'simulation'::TEXT
           FROM simulation_runs WHERE project_id=$1 AND source_lens_analysis_id=$2
         UNION ALL
         SELECT fork_core_replay_id,source_lens_debug_session_id,'replay'::TEXT
           FROM historical_replay_analysis_bindings
          WHERE project_id=$1 AND source_lens_analysis_id=$2
         LIMIT 1",
    )
    .bind(project_id)
    .bind(analysis_id)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)?;
    Ok(AnalysisBinding {
        external_id,
        debug_id,
        origin,
    })
}

pub async fn get_debugger_workspace(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, analysis_id)): Path<(String, String, Uuid)>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let binding = analysis_binding(&state, auth.project_id, analysis_id).await?;
    let analysis = lens_client(&state)?
        .get_analysis(&lens_actor(user_id, &auth), analysis_id)
        .await
        .map_err(map_lens_remote)?;
    let debugger = if let Some(debug_id) = binding.debug_id {
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
        "simulation_id": (binding.origin == "simulation").then_some(binding.external_id),
        "replay_id": (binding.origin == "replay").then_some(binding.external_id),
        "origin": binding.origin,
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
    let binding = analysis_binding(&state, auth.project_id, analysis_id).await?;
    if let Some(debug_id) = binding.debug_id {
        return Ok((
            axum::http::StatusCode::OK,
            Json(
                json!({"analysis_id":analysis_id,"origin":binding.origin,"external_id":binding.external_id,"debug_session_id":debug_id,"created":false}),
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
    if binding.origin == "simulation" {
        sqlx::query("UPDATE simulation_runs SET source_lens_debug_session_id=$2,source_lens_synced_at=now() WHERE id=$1 AND project_id=$3")
            .bind(binding.external_id).bind(debug_id).bind(auth.project_id).execute(&state.db).await.map_err(Error::internal)?;
    } else {
        sqlx::query("UPDATE historical_replay_analysis_bindings SET source_lens_debug_session_id=$2,synced_at=now() WHERE fork_core_replay_id=$1 AND project_id=$3 AND source_lens_analysis_id=$4")
            .bind(binding.external_id).bind(debug_id).bind(auth.project_id).bind(analysis_id).execute(&state.db).await.map_err(Error::internal)?;
    }
    Ok((
        axum::http::StatusCode::ACCEPTED,
        Json(
            json!({"analysis_id":analysis_id,"origin":binding.origin,"external_id":binding.external_id,"debug_session_id":debug_id,"job_id":accepted.job_id,"status":accepted.status,"created":accepted.created}),
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
    let binding = analysis_binding(&state, auth.project_id, analysis_id).await?;
    let debug_id = binding.debug_id.ok_or(Error::NotFound)?;
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
