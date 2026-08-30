//! Project-scoped Fork Core environment proxy.
//!
//! Fork Core remains private. The browser only talks to Platform, which
//! authorizes the user and issues the short-lived service assertion upstream.

use axum::{
    Json,
    extract::{Path, Query, State},
    http::HeaderMap,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use shared::{Error, Permission, PermissionSet};
use sqlx::PgPool;
use std::time::{Duration, Instant};
use stellar_xdr::{
    AccountId, LedgerEntry, LedgerEntryData, LedgerKey, LedgerKeyAccount, Limits, PublicKey,
    ReadXdr, Uint256, WriteXdr,
};
use uuid::Uuid;

use crate::{
    extract::AuthUser, simulations::normalize_decoded_invocation_for_fork, state::AppState,
};

struct ProjectAuth {
    organization_id: Uuid,
    project_id: Uuid,
    /// Raw `organization_members.permissions` bitmask, so individual handlers
    /// can require elevated capabilities beyond ManageForkSessions.
    #[allow(dead_code)]
    permissions: i16,
}

impl ProjectAuth {
    /// Only org admins may manage the environment's public RPC name
    /// (user rule 2026-08-22). ManageMembers is the org-admin capability;
    /// owners hold every bit.
    fn require_org_admin(&self) -> Result<(), Error> {
        if PermissionSet(self.permissions).contains(Permission::ManageMembers) {
            Ok(())
        } else {
            Err(Error::Forbidden)
        }
    }
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
        permissions: row.3,
    })
}

fn client(state: &AppState) -> Result<&sim::ForkCoreClient, Error> {
    state
        .fork_core
        .as_ref()
        .ok_or_else(|| Error::ServiceUnavailable("fork_core".into()))
}

/// Resolves an org/project pair to their ids WITHOUT requiring a user session.
/// Used by the Tenderly-style public RPC URL, where access is the unguessable
/// URL itself (org/project slugs + environment UUID) rather than a bearer token.
async fn resolve_org_project(
    state: &AppState,
    org: &str,
    project: &str,
) -> Result<(Uuid, Uuid), Error> {
    let row = sqlx::query_as::<_, (Uuid, Uuid)>(
        "SELECT o.id, p.id
           FROM organizations o
           JOIN projects p ON p.organization_id = o.id
          WHERE o.slug = $1 AND p.slug = $2",
    )
    .bind(org)
    .bind(project)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)?;
    Ok(row)
}

fn actor(user_id: Uuid, auth: &ProjectAuth) -> sim::ServiceActor {
    sim::ServiceActor::fork_manager(
        user_id,
        auth.organization_id,
        auth.project_id,
        Uuid::new_v4(),
    )
}

fn required_idempotency_key(headers: &HeaderMap) -> Result<&str, Error> {
    headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .ok_or_else(|| Error::BadRequest("Idempotency-Key is required".into()))
}

fn secret_hash(secret: &str) -> String {
    hex::encode(Sha256::digest(secret.as_bytes()))
}

fn request_hash(value: &Value) -> Result<String, Error> {
    serde_json::to_vec(value)
        .map(|bytes| hex::encode(Sha256::digest(bytes)))
        .map_err(Error::internal)
}

async fn record_activity(
    pool: &PgPool,
    project_id: Uuid,
    environment_id: Uuid,
    actor_id: Option<Uuid>,
    kind: &str,
    summary: &str,
    metadata: Value,
) -> Result<(), Error> {
    sqlx::query(
        "INSERT INTO environment_activity
            (environment_id,project_id,kind,summary,metadata,actor_id)
         VALUES($1,$2,$3,$4,$5,$6)",
    )
    .bind(environment_id)
    .bind(project_id)
    .bind(kind)
    .bind(summary)
    .bind(metadata)
    .bind(actor_id)
    .execute(pool)
    .await
    .map_err(Error::internal)?;
    Ok(())
}

async fn ensure_environment(
    pool: &PgPool,
    project_id: Uuid,
    environment_id: Uuid,
) -> Result<(), Error> {
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM fork_environments WHERE id=$1 AND project_id=$2)",
    )
    .bind(environment_id)
    .bind(project_id)
    .fetch_one(pool)
    .await
    .map_err(Error::internal)?;
    if exists { Ok(()) } else { Err(Error::NotFound) }
}

pub(crate) fn decode_strkey_payload(
    value: &str,
    expected_version: u8,
    payload_len: usize,
) -> Option<Vec<u8>> {
    let mut buffer = 0_u32;
    let mut bits = 0_u8;
    let mut decoded = Vec::new();
    for byte in value.bytes() {
        let digit = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'2'..=b'7' => byte - b'2' + 26,
            _ => return None,
        } as u32;
        buffer = (buffer << 5) | digit;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            decoded.push((buffer >> bits) as u8);
            buffer &= (1_u32 << bits).saturating_sub(1);
        }
    }
    if decoded.len() != payload_len + 3 || decoded[0] != expected_version {
        return None;
    }
    let data_len = decoded.len() - 2;
    let mut crc = 0_u16;
    for byte in &decoded[..data_len] {
        crc ^= (*byte as u16) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 {
                (crc << 1) ^ 0x1021
            } else {
                crc << 1
            };
        }
    }
    let expected = u16::from_le_bytes([decoded[data_len], decoded[data_len + 1]]);
    (crc == expected).then(|| decoded[1..data_len].to_vec())
}

fn valid_wallet_address(address: &str) -> bool {
    decode_strkey_payload(address, 6 << 3, 32).is_some()
        || decode_strkey_payload(address, 12 << 3, 40).is_some()
}

async fn source_network_account_exists(
    network: &str,
    address: &str,
) -> Result<Option<bool>, Error> {
    // Horizon exposes account existence directly. M... muxed addresses are
    // accepted by the wallet linker, but the account check is performed only
    // for plain G... account IDs because Horizon's account route is keyed by G.
    if !address.starts_with('G') {
        return Ok(None);
    }
    let base = match network {
        "mainnet" => "https://horizon.stellar.org",
        "testnet" => "https://horizon-testnet.stellar.org",
        _ => return Err(Error::ServiceUnavailable("network_account_check".into())),
    };
    let response = reqwest::Client::new()
        .get(format!("{base}/accounts/{address}"))
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map_err(|error| {
            tracing::warn!(%error, %network, "source network account check failed");
            Error::ServiceUnavailable("network_account_check".into())
        })?;
    match response.status().as_u16() {
        200..=299 => Ok(Some(true)),
        404 => Ok(Some(false)),
        status => {
            tracing::warn!(%network, %status, "source network account check returned unexpected status");
            Err(Error::ServiceUnavailable("network_account_check".into()))
        }
    }
}

async fn write_rpc_log(
    pool: &PgPool,
    project_id: Uuid,
    environment_id: Uuid,
    method: &str,
    status: &str,
    latency_ms: u128,
    caller_class: &str,
    request_id: Option<&str>,
) {
    if let Err(error) = sqlx::query(
        "DELETE FROM environment_rpc_logs WHERE created_at < now() - interval '30 days'",
    )
    .execute(pool)
    .await
    {
        tracing::warn!(%error, "could not prune expired RPC logs");
    }
    let result = sqlx::query(
        "INSERT INTO environment_rpc_logs
            (environment_id,project_id,method,status,latency_ms,caller_class,request_id)
         VALUES($1,$2,$3,$4,$5,$6,$7)",
    )
    .bind(environment_id)
    .bind(project_id)
    .bind(method.chars().take(100).collect::<String>())
    .bind(status)
    .bind(i32::try_from(latency_ms).unwrap_or(i32::MAX))
    .bind(caller_class)
    .bind(request_id)
    .execute(pool)
    .await;
    if let Err(error) = result {
        tracing::warn!(%error, %environment_id, "could not persist redacted RPC log");
    }
}

fn account_ledger_key_from_address(address: &str) -> Result<Option<String>, Error> {
    let Some(bytes) = decode_strkey_payload(address, 6 << 3, 32) else {
        // M... muxed addresses are valid wallet identifiers, but the account
        // ledger entry is keyed by the underlying G... account.
        return Ok(None);
    };
    let account_id = AccountId(PublicKey::PublicKeyTypeEd25519(Uint256(
        bytes
            .try_into()
            .map_err(|_| Error::BadRequest("account address has an invalid payload".into()))?,
    )));
    LedgerKey::Account(LedgerKeyAccount { account_id })
        .to_xdr_base64(Limits::none())
        .map(Some)
        .map_err(Error::internal)
}

async fn enrich_environment_wallet_balances(
    state: &AppState,
    user_id: Uuid,
    auth: &ProjectAuth,
    environment_id: Uuid,
    wallets: &mut [Value],
) {
    let mut keys = Vec::new();
    for wallet in wallets.iter() {
        let Some(address) = wallet.get("address").and_then(Value::as_str) else {
            continue;
        };
        match account_ledger_key_from_address(address) {
            Ok(Some(key)) => keys.push((address.to_owned(), key)),
            Ok(None) => {}
            Err(error) => {
                tracing::warn!(%error, %address, "could not build wallet account ledger key")
            }
        }
    }
    if keys.is_empty() {
        return;
    }
    let request = json!({
        "jsonrpc": "2.0",
        "id": Uuid::new_v4(),
        "method": "getLedgerEntries",
        "params": {"keys": keys.iter().map(|(_, key)| key).collect::<Vec<_>>()}
    });
    let fork = match client(state) {
        Ok(fork) => fork,
        Err(error) => {
            tracing::warn!(%error, %environment_id, "could not read linked wallet balances");
            return;
        }
    };
    let response = fork
        .environment_rpc(&actor(user_id, auth), environment_id, &request)
        .await;
    let Ok(response) = response else {
        tracing::warn!(%environment_id, "virtual network balance lookup failed");
        return;
    };
    let entries = response
        .get("result")
        .and_then(|result| result.get("entries"))
        .or_else(|| response.get("entries"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for wallet in wallets.iter_mut() {
        let Some(address) = wallet.get("address").and_then(Value::as_str) else {
            continue;
        };
        let Some((_, key)) = keys.iter().find(|(candidate, _)| candidate == address) else {
            continue;
        };
        let Some(entry) = entries
            .iter()
            .find(|entry| entry.get("key").and_then(Value::as_str) == Some(key))
        else {
            continue;
        };
        let Some(raw_xdr) = entry.get("xdr").and_then(Value::as_str) else {
            continue;
        };
        let Ok(LedgerEntry {
            data: LedgerEntryData::Account(account),
            ..
        }) = LedgerEntry::from_xdr_base64(raw_xdr, Limits::none())
        else {
            continue;
        };
        wallet["balances"] = json!([{
            "asset": "native",
            "amount": account.balance.to_string(),
            "decimals": 7
        }]);
    }
}

async fn enrich_environment(
    pool: &PgPool,
    project_id: Uuid,
    environment: &mut Value,
) -> Result<(), Error> {
    let id = environment_uuid(environment, "id")?
        .ok_or_else(|| Error::ServiceUnavailable("fork_core_invalid_response".into()))?;
    let row = sqlx::query_as::<
        _,
        (
            String,
            i16,
            Option<Value>,
            bool,
            Option<String>,
            Option<String>,
            chrono::DateTime<chrono::Utc>,
        ),
    >(
        "SELECT initialization_status,initialization_progress,initialization_error,
                public_explorer_enabled,rpc_slug,rpc_admin_secret,created_at
           FROM fork_environments WHERE id=$1 AND project_id=$2",
    )
    .bind(id)
    .bind(project_id)
    .fetch_optional(pool)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)?;
    let admin_secret = if let Some(secret) = row.5.clone() {
        secret
    } else {
        let generated = Uuid::new_v4().to_string();
        sqlx::query(
            "UPDATE fork_environments
                SET rpc_admin_secret_hash=$1,rpc_admin_secret=$2
              WHERE id=$3 AND project_id=$4 AND rpc_admin_secret IS NULL",
        )
        .bind(secret_hash(&generated))
        .bind(&generated)
        .bind(id)
        .bind(project_id)
        .execute(pool)
        .await
        .map_err(Error::internal)?;
        generated
    };
    environment["initialization_status"] = json!(row.0);
    environment["initialization_progress"] = json!(row.1);
    environment["initialization_error"] = row.2.unwrap_or(Value::Null);
    environment["public_explorer_enabled"] = json!(row.3);
    environment["rpc_slug"] = json!(row.4);
    environment["admin_secret"] = json!(admin_secret);
    environment["created_at"] = json!(row.6);
    Ok(())
}

/// Longest allowed rpc_slug (keeps URLs readable; well under path limits).
pub const RPC_SLUG_MAX_LEN: usize = 63;
/// Reserved words that must never become an environment's public RPC name.
const RESERVED_RPC_SLUGS: &[&str] = &["admin", "rpc", "health", "docs", "api"];

/// Validates and normalizes a user-chosen RPC URL name.
///
/// Collision rules (all enforced here, uniqueness by a partial unique index):
/// - lowercase `[a-z0-9-]`, no leading/trailing `-`, no `--`, 1..=63 chars —
///   one canonical form per name, no charset/path tricks (`/`, `%2f`, case);
/// - must NOT parse as a UUID — keeps the "env id" and "slug" namespaces
///   disjoint so `/v/{org}/{project}/{segment}` resolution is unambiguous
///   (a segment is either a UUID or a slug, never both).
fn validate_rpc_slug(raw: &str) -> Result<String, Error> {
    let slug = raw.trim().to_ascii_lowercase();
    if slug.is_empty() || slug.len() > RPC_SLUG_MAX_LEN {
        return Err(Error::BadRequest(format!(
            "rpc_slug must contain 1 to {RPC_SLUG_MAX_LEN} characters"
        )));
    }
    if Uuid::parse_str(&slug).is_ok() {
        return Err(Error::BadRequest(
            "rpc_slug must not look like an environment id".into(),
        ));
    }
    if !slug
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(Error::BadRequest(
            "rpc_slug may only contain lowercase letters, digits and '-'".into(),
        ));
    }
    if slug.starts_with('-') || slug.ends_with('-') || slug.contains("--") {
        return Err(Error::BadRequest(
            "rpc_slug must not start/end with '-' or contain '--'".into(),
        ));
    }
    if RESERVED_RPC_SLUGS.contains(&slug.as_str()) {
        return Err(Error::BadRequest("rpc_slug is reserved".into()));
    }
    Ok(slug)
}

/// Resolves the `{env}` segment of the Tenderly-style RPC URLs to an
/// environment id. A segment that parses as a UUID is used verbatim (the
/// original unguessable capability — behavior unchanged); anything else is
/// treated as a project-scoped case-insensitive rpc_slug. Slugs are rejected
/// when UUID-shaped at set time, so the two namespaces cannot collide.
async fn resolve_env_segment(
    state: &AppState,
    org: &str,
    project: &str,
    segment: &str,
) -> Result<(Uuid, Uuid, Uuid), Error> {
    let (organization_id, project_id) = resolve_org_project(state, org, project).await?;
    let environment_id = if let Ok(id) = Uuid::parse_str(segment) {
        id
    } else {
        sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM fork_environments
              WHERE project_id = $1 AND lower(rpc_slug) = $2",
        )
        .bind(project_id)
        .bind(segment.to_ascii_lowercase())
        .fetch_optional(&state.db)
        .await
        .map_err(Error::internal)?
        .ok_or(Error::NotFound)?
    };
    Ok((organization_id, project_id, environment_id))
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
             execution_ledger,protocol,state_hash,verification_status,network,revision,sync_status,
             invalidated_reason, rpc_admin_secret)
         VALUES($1,$2,$3,$4,$5,$1,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
                gen_random_uuid()::text)
         ON CONFLICT(id) DO UPDATE SET
             name=EXCLUDED.name,base_ledger_sequence=EXCLUDED.base_ledger_sequence,
             state_sync_enabled=EXCLUDED.state_sync_enabled,mode=EXCLUDED.mode,
             active_revision_id=EXCLUDED.active_revision_id,
             requested_ledger=EXCLUDED.requested_ledger,state_ledger=EXCLUDED.state_ledger,
             execution_ledger=EXCLUDED.execution_ledger,protocol=EXCLUDED.protocol,
             state_hash=EXCLUDED.state_hash,verification_status=EXCLUDED.verification_status,
             network=EXCLUDED.network,revision=EXCLUDED.revision,sync_status=EXCLUDED.sync_status,
             invalidated_reason=EXCLUDED.invalidated_reason
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
    .bind(
        environment
            .get("invalidated_reason")
            .and_then(Value::as_str),
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
    headers: HeaderMap,
    Json(body): Json<CreateEnvironmentRequest>,
) -> Result<(axum::http::StatusCode, Json<Value>), Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let idempotency_key = required_idempotency_key(&headers)?;
    let source = body.source.as_deref().unwrap_or("latest");
    if !matches!(source, "latest" | "simulation") {
        return Err(Error::BadRequest(
            "source must be latest or simulation".into(),
        ));
    }
    if !matches!(body.network.as_str(), "mainnet" | "testnet") {
        return Err(Error::BadRequest(
            "network must be mainnet or testnet".into(),
        ));
    }
    let fork_simulation_id = if source == "simulation" {
        let simulation_id = body.simulation_id.ok_or_else(|| {
            Error::BadRequest("simulation_id is required when source is simulation".into())
        })?;
        Some(
            sqlx::query_scalar::<_, Option<Uuid>>(
                "SELECT fork_core_simulation_id FROM simulation_runs
              WHERE id=$1 AND project_id=$2 AND status='success'",
            )
            .bind(simulation_id)
            .bind(auth.project_id)
            .fetch_optional(&state.db)
            .await
            .map_err(Error::internal)?
            .flatten()
            .ok_or_else(|| Error::BadRequest("The selected simulation is not certified".into()))?,
        )
    } else {
        None
    };
    let normalized_slug = body
        .rpc_slug
        .as_deref()
        .map(validate_rpc_slug)
        .transpose()?;
    let upstream = json!({
        "name": body.name,
        "source": source,
        "simulation_id": fork_simulation_id,
        "network": body.network,
        "mode": body.mode,
    });
    let digest = request_hash(&json!({
        "upstream": upstream,
        "public_explorer_enabled": body.public_explorer_enabled,
        "rpc_slug": normalized_slug,
    }))?;
    if let Some((stored_hash, response)) = sqlx::query_as::<_, (String, Value)>(
        "SELECT request_hash,response FROM environment_mutations
          WHERE project_id=$1 AND idempotency_key=$2 AND operation='create'",
    )
    .bind(auth.project_id)
    .bind(idempotency_key)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?
    {
        if stored_hash != digest {
            return Err(Error::ConflictDetail(
                "Idempotency key was reused with different input".into(),
            ));
        }
        return Ok((axum::http::StatusCode::CREATED, Json(response)));
    }
    let mut environment = client(&state)?
        .create_environment(&actor(user_id, &auth), &upstream, idempotency_key)
        .await
        .map_err(map_remote)?;
    persist_environment(&state.db, auth.project_id, &environment).await?;
    let environment_id = environment_uuid(&environment, "id")?
        .ok_or_else(|| Error::ServiceUnavailable("fork_core_invalid_response".into()))?;
    let admin_secret = Uuid::new_v4().to_string();
    sqlx::query(
        "UPDATE fork_environments SET public_explorer_enabled=$1,rpc_slug=$2,
                rpc_admin_secret_hash=$3,rpc_admin_secret=$4,
                initialization_status='ready',initialization_progress=100
          WHERE id=$5 AND project_id=$6",
    )
    .bind(body.public_explorer_enabled)
    .bind(normalized_slug.as_deref())
    .bind(secret_hash(&admin_secret))
    .bind(&admin_secret)
    .bind(environment_id)
    .bind(auth.project_id)
    .execute(&state.db)
    .await
    .map_err(|error| {
        if error
            .as_database_error()
            .is_some_and(|db| db.code().as_deref() == Some("23505"))
        {
            Error::ConflictDetail("rpc_slug is already used in this project".into())
        } else {
            Error::internal(error)
        }
    })?;
    enrich_environment(&state.db, auth.project_id, &mut environment).await?;
    let base = state.settings.api_base_url.trim_end_matches('/');
    let environment_id_string = environment_id.to_string();
    let endpoint_segment = normalized_slug.as_deref().unwrap_or(&environment_id_string);
    environment["rpc_url"] = json!(format!("{base}/v/{org}/{project}/{endpoint_segment}"));
    environment["admin_rpc_url"] = json!(format!(
        "{base}/v/{org}/{project}/{endpoint_segment}/{admin_secret}"
    ));
    environment["admin_secret"] = json!(admin_secret);
    record_activity(
        &state.db,
        auth.project_id,
        environment_id,
        Some(user_id),
        "environment.created",
        "Environment created",
        json!({"source":source,"mode":body.mode}),
    )
    .await?;
    let mut cached_response = environment.clone();
    if let Some(object) = cached_response.as_object_mut() {
        object.remove("admin_rpc_url");
    }
    sqlx::query(
        "INSERT INTO environment_mutations(project_id,idempotency_key,operation,request_hash,response)
         VALUES($1,$2,'create',$3,$4)",
    )
    .bind(auth.project_id)
    .bind(idempotency_key)
    .bind(digest)
    .bind(&cached_response)
    .execute(&state.db)
    .await
    .map_err(Error::internal)?;
    Ok((axum::http::StatusCode::CREATED, Json(environment)))
}

#[derive(Debug, Deserialize)]
pub struct CreateEnvironmentRequest {
    pub name: String,
    pub network: String,
    pub source: Option<String>,
    pub simulation_id: Option<Uuid>,
    #[serde(default = "frozen_mode")]
    pub mode: String,
    #[serde(default)]
    pub public_explorer_enabled: bool,
    pub rpc_slug: Option<String>,
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
    let mut environments = client(&state)?
        .list_environments(&actor(user_id, &auth))
        .await
        .map_err(map_remote)?;
    persist_environment_list(&state.db, auth.project_id, &environments).await?;
    if let Some(items) = environments
        .get_mut("environments")
        .and_then(Value::as_array_mut)
    {
        for environment in items {
            enrich_environment(&state.db, auth.project_id, environment).await?;
        }
    }
    Ok(Json(environments))
}

pub async fn get_environment(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, environment_id)): Path<(String, String, Uuid)>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let mut environment = refresh_environment(&state, user_id, &auth, environment_id).await?;
    enrich_environment(&state.db, auth.project_id, &mut environment).await?;
    Ok(Json(environment))
}

pub async fn update_environment(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, environment_id)): Path<(String, String, Uuid)>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let mut environment = if body.get("name").is_some() {
        client(&state)?
            .update_environment(&actor(user_id, &auth), environment_id, &body)
            .await
            .map_err(map_remote)?
    } else {
        refresh_environment(&state, user_id, &auth, environment_id).await?
    };
    persist_environment(&state.db, auth.project_id, &environment).await?;
    if let Some(public) = body.get("public_explorer_enabled").and_then(Value::as_bool) {
        auth.require_org_admin()?;
        sqlx::query(
            "UPDATE fork_environments SET public_explorer_enabled=$1 WHERE id=$2 AND project_id=$3",
        )
        .bind(public)
        .bind(environment_id)
        .bind(auth.project_id)
        .execute(&state.db)
        .await
        .map_err(Error::internal)?;
    }
    enrich_environment(&state.db, auth.project_id, &mut environment).await?;
    record_activity(
        &state.db,
        auth.project_id,
        environment_id,
        Some(user_id),
        "environment.configured",
        "Environment configuration updated",
        json!({
            "renamed": body.get("name").is_some(),
            "public_explorer_changed": body.get("public_explorer_enabled").is_some()
        }),
    )
    .await?;
    Ok(Json(environment))
}

pub async fn delete_environment(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, environment_id)): Path<(String, String, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    auth.require_org_admin()?;
    let _ = required_idempotency_key(&headers)?;
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
    if matches!(action, "sync/start" | "sync/step" | "sync/stop")
        || (action == "overrides" && body.is_some())
    {
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
    let mut body = body
        .map(|Json(value)| value)
        .ok_or_else(|| Error::BadRequest("Simulation request is required".into()))?;
    normalize_decoded_invocation_for_fork(&mut body)?;
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

/// Auto-mines a transaction into a virtual network (write path).
pub async fn environment_transactions(
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
        .map(str::to_owned);
    let body = body
        .map(|Json(value)| value)
        .ok_or_else(|| Error::BadRequest("Transaction envelope is required".into()))?;
    let value = client(&state)?
        .send_environment_transaction(
            &actor(user_id, &auth),
            environment_id,
            &body,
            idempotency_key.as_deref(),
        )
        .await
        .map_err(map_remote)?;
    Ok(Json(value))
}

/// Deploys a contract into a virtual network (write path).
pub async fn environment_deploy(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, environment_id)): Path<(String, String, Uuid)>,
    headers: HeaderMap,
    body: Option<Json<Value>>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let idempotency_key = required_idempotency_key(&headers)?;
    let body = body
        .map(|Json(value)| value)
        .ok_or_else(|| Error::BadRequest("Deploy request is required".into()))?;
    let value = client(&state)?
        .deploy_environment_contract(
            &actor(user_id, &auth),
            environment_id,
            &body,
            Some(idempotency_key),
        )
        .await
        .map_err(map_remote)?;
    if let Some(contract_id) = value.get("contract_id").and_then(Value::as_str) {
        sqlx::query(
            "INSERT INTO environment_deployments
                (environment_id,project_id,contract_id,wasm_hash,upload_hash,create_hash,source_account,created_by)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT(environment_id,contract_id) DO UPDATE SET
                wasm_hash=EXCLUDED.wasm_hash,upload_hash=EXCLUDED.upload_hash,
                create_hash=EXCLUDED.create_hash",
        )
        .bind(environment_id)
        .bind(auth.project_id)
        .bind(contract_id)
        .bind(value.get("wasm_hash").and_then(Value::as_str))
        .bind(value.get("upload_hash").and_then(Value::as_str))
        .bind(value.get("create_hash").and_then(Value::as_str))
        .bind(body.get("source_account").and_then(Value::as_str))
        .bind(Some(user_id))
        .execute(&state.db)
        .await
        .map_err(Error::internal)?;
        record_activity(
            &state.db,
            auth.project_id,
            environment_id,
            Some(user_id),
            "contract.deployed",
            "Contract deployed",
            json!({"contract_id":contract_id}),
        )
        .await?;
    }
    Ok(Json(value))
}

/// Hosted JSON-RPC call scoped to a virtual network (getLatestLedger,
/// getLedgerEntries, getTransaction, sendTransaction, simulateTransaction).
///
/// Tenderly-style public URL: no bearer token required. `{env}` is either the
/// unguessable environment UUID or a project-scoped rpc_slug set by an org
/// admin. Policy (DECISIONS.md 2026-08-22): a named URL grants this same
/// public surface — name guessability is an accepted tradeoff.
pub async fn environment_rpc(
    State(state): State<AppState>,
    Path((org, project, env)): Path<(String, String, String)>,
    headers: HeaderMap,
    body: Option<Json<Value>>,
) -> Result<Json<Value>, Error> {
    let (organization_id, _project_id, environment_id) =
        resolve_env_segment(&state, &org, &project, &env).await?;
    let body = body
        .map(|Json(value)| value)
        .ok_or_else(|| Error::BadRequest("JSON-RPC body is required".into()))?;
    let actor =
        sim::ServiceActor::public_rpc(Uuid::new_v4(), organization_id, _project_id, Uuid::new_v4());
    let method = body
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let request_id = body.get("id").map(Value::to_string);
    let started = Instant::now();
    let result = if method == "releeve_deployContract" {
        let idempotency_key = required_idempotency_key(&headers)?;
        let params = body.get("params").cloned().unwrap_or_else(|| json!({}));
        client(&state)?.deploy_environment_contract(&actor, environment_id, &params, Some(idempotency_key))
            .await.map(|value| json!({"jsonrpc":"2.0","id":body.get("id").cloned().unwrap_or(Value::Null),"result":value}))
    } else {
        client(&state)?
            .environment_rpc(&actor, environment_id, &body)
            .await
    };
    write_rpc_log(
        &state.db,
        _project_id,
        environment_id,
        method,
        if result.is_ok() { "success" } else { "error" },
        started.elapsed().as_millis(),
        "anonymous",
        request_id.as_deref(),
    )
    .await;
    let result = result.map_err(map_remote)?;
    if method == "releeve_deployContract"
        && let Some(deployment) = result.get("result")
        && let Some(contract_id) = deployment.get("contract_id").and_then(Value::as_str)
    {
        sqlx::query(
            "INSERT INTO environment_deployments
                (environment_id,project_id,contract_id,wasm_hash,upload_hash,create_hash,source_account,created_by)
             VALUES($1,$2,$3,$4,$5,$6,$7,NULL)
             ON CONFLICT(environment_id,contract_id) DO UPDATE SET
                wasm_hash=EXCLUDED.wasm_hash,upload_hash=EXCLUDED.upload_hash,
                create_hash=EXCLUDED.create_hash",
        )
        .bind(environment_id)
        .bind(_project_id)
        .bind(contract_id)
        .bind(deployment.get("wasm_hash").and_then(Value::as_str))
        .bind(deployment.get("upload_hash").and_then(Value::as_str))
        .bind(deployment.get("create_hash").and_then(Value::as_str))
        .bind(body.pointer("/params/source_account").and_then(Value::as_str))
        .execute(&state.db)
        .await
        .map_err(Error::internal)?;
        record_activity(
            &state.db,
            _project_id,
            environment_id,
            None,
            "contract.deployed",
            "Contract deployed through public RPC",
            json!({"contract_id":contract_id,"caller_class":"anonymous"}),
        )
        .await?;
    }
    Ok(Json(result))
}

/// Hosted JSON-RPC for the platform's authenticated REST surface (UI/backend).
/// Requires the user's platform token; the caller's org/project membership is
/// enforced. This is distinct from the public `/v/...` capability URL used by
/// external tools.
pub async fn environment_rpc_authed(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, environment_id)): Path<(String, String, Uuid)>,
    body: Option<Json<Value>>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let body = body
        .map(|Json(value)| value)
        .ok_or_else(|| Error::BadRequest("JSON-RPC body is required".into()))?;
    let method = body
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let request_id = body.get("id").map(Value::to_string);
    let started = Instant::now();
    let result = client(&state)?
        .environment_rpc(&actor(user_id, &auth), environment_id, &body)
        .await;
    write_rpc_log(
        &state.db,
        auth.project_id,
        environment_id,
        method,
        if result.is_ok() { "success" } else { "error" },
        started.elapsed().as_millis(),
        "member",
        request_id.as_deref(),
    )
    .await;
    Ok(Json(result.map_err(map_remote)?))
}

/// Tenderly-style admin RPC URL: the secret path suffix grants the same RPC
/// surface plus the capability to manage/mutate the environment. The secret is
/// validated against the environment's stored admin secret. `{env}` resolves
/// as UUID-or-rpc_slug exactly like the public URL.
pub async fn environment_rpc_admin(
    State(state): State<AppState>,
    Path((org, project, env, admin_secret)): Path<(String, String, String, String)>,
    body: Option<Json<Value>>,
) -> Result<Json<Value>, Error> {
    let (organization_id, project_id, environment_id) =
        resolve_env_segment(&state, &org, &project, &env).await?;
    let stored = sqlx::query_as::<
        _,
        (
            Option<String>,
            Option<String>,
            Option<chrono::DateTime<chrono::Utc>>,
            Option<String>,
        ),
    >(
        "SELECT rpc_admin_secret_hash,rpc_previous_secret_hash,
                rpc_previous_secret_expires_at,rpc_admin_secret
           FROM fork_environments WHERE id = $1 AND project_id = $2",
    )
    .bind(environment_id)
    .bind(project_id)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)?;
    let supplied_hash = secret_hash(&admin_secret);
    let current_valid = stored.0.as_deref() == Some(supplied_hash.as_str());
    let previous_valid = stored.1.as_deref() == Some(supplied_hash.as_str())
        && stored.2.is_some_and(|expires| expires > chrono::Utc::now());
    let legacy_valid = stored.3.as_deref() == Some(admin_secret.as_str());
    if !(current_valid || previous_valid || legacy_valid) {
        return Err(Error::Forbidden);
    }
    if legacy_valid {
        sqlx::query("UPDATE fork_environments SET rpc_admin_secret_hash=$1 WHERE id=$2")
            .bind(&supplied_hash)
            .bind(environment_id)
            .execute(&state.db)
            .await
            .map_err(Error::internal)?;
    }
    let body = body
        .map(|Json(value)| value)
        .ok_or_else(|| Error::BadRequest("JSON-RPC body is required".into()))?;
    let actor = sim::ServiceActor::fork_manager(
        Uuid::new_v4(),
        organization_id,
        project_id,
        Uuid::new_v4(),
    );
    let method = body
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let request_id = body.get("id").map(Value::to_string);
    let started = Instant::now();
    let result = client(&state)?
        .environment_rpc(&actor, environment_id, &body)
        .await;
    write_rpc_log(
        &state.db,
        project_id,
        environment_id,
        method,
        if result.is_ok() { "success" } else { "error" },
        started.elapsed().as_millis(),
        "admin",
        request_id.as_deref(),
    )
    .await;
    Ok(Json(result.map_err(map_remote)?))
}

#[derive(Deserialize)]
pub struct SetRpcSlugBody {
    /// The new public RPC name, or null to clear it (UUID-only routing).
    pub rpc_slug: Option<String>,
}

/// Sets or clears an environment's named-RPC-URL slug. Org-admin only
/// (ManageMembers) on top of the usual fork-session permission; collisions are
/// rejected 409 by the partial unique index, so concurrent claims are safe.
pub async fn set_environment_rpc_slug(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, environment_id)): Path<(String, String, Uuid)>,
    body: Option<Json<SetRpcSlugBody>>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    auth.require_org_admin()?;
    let slug = match body {
        Some(Json(SetRpcSlugBody {
            rpc_slug: Some(raw),
        })) => Some(validate_rpc_slug(&raw)?),
        Some(Json(SetRpcSlugBody { rpc_slug: None })) | None => None,
    };
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(
             SELECT 1 FROM fork_environments WHERE id = $1 AND project_id = $2
         )",
    )
    .bind(environment_id)
    .bind(auth.project_id)
    .fetch_one(&state.db)
    .await
    .map_err(Error::internal)?;
    if !exists {
        return Err(Error::NotFound);
    }
    let updated = sqlx::query(
        "UPDATE fork_environments SET rpc_slug = $1
          WHERE id = $2 AND project_id = $3",
    )
    .bind(slug.as_deref())
    .bind(environment_id)
    .bind(auth.project_id)
    .execute(&state.db)
    .await;
    if let Err(error) = updated {
        // unique_violation on uq_fork_environments_rpc_slug: someone else
        // holds this name in this project already.
        if error
            .as_database_error()
            .is_some_and(|db| db.code().as_deref() == Some("23505"))
        {
            return Err(Error::ConflictDetail(
                "rpc_slug is already used by another environment in this project".into(),
            ));
        }
        return Err(Error::internal(error));
    }
    let base = state.settings.api_base_url.trim_end_matches('/');
    let named_rpc_url = slug
        .as_ref()
        .map(|s| format!("{base}/v/{org}/{project}/{s}"));
    record_activity(
        &state.db,
        auth.project_id,
        environment_id,
        Some(user_id),
        "rpc.slug_updated",
        "Named RPC endpoint updated",
        json!({"rpc_slug":slug}),
    )
    .await?;
    Ok(Json(json!({
        "environment_id": environment_id,
        "rpc_slug": slug,
        "named_rpc_url": named_rpc_url,
        "uuid_rpc_url": format!("{base}/v/{org}/{project}/{environment_id}"),
    })))
}

#[derive(Debug, Deserialize)]
pub struct EnvironmentWalletBody {
    pub address: String,
    pub label: Option<String>,
    #[serde(default)]
    pub confirm_virtual: bool,
}

#[derive(Debug, Deserialize)]
pub struct EnvironmentWalletRenameBody {
    pub label: Option<String>,
}

pub async fn list_environment_wallets(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, environment_id)): Path<(String, String, Uuid)>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    ensure_environment(&state.db, auth.project_id, environment_id).await?;
    let mut wallets = sqlx::query_scalar::<_, Value>(
        "SELECT jsonb_build_object(
             'id',w.id,'address',w.address,'label',w.label,'created_at',w.created_at,
             'balances',COALESCE((
               SELECT jsonb_agg(jsonb_build_object(
                 'asset',latest.asset,'amount',latest.amount,'decimals',latest.decimals
               ) ORDER BY latest.asset)
               FROM (
                 SELECT
                   a.metadata->>'asset' AS asset,
                   SUM((a.metadata->>'amount_units')::numeric)::text AS amount,
                   (array_agg(COALESCE((a.metadata->>'decimals')::int,7)
                     ORDER BY a.created_at DESC,a.id DESC))[1] AS decimals
                 FROM environment_activity a
                 WHERE a.environment_id=w.environment_id
                   AND a.kind='wallet.funded'
                   AND a.metadata->>'address'=w.address
                   AND a.metadata->>'amount_units' IS NOT NULL
                 GROUP BY a.metadata->>'asset'
               ) latest
             ),'[]'::jsonb)
           )
           FROM environment_wallets w
          WHERE w.environment_id=$1 AND w.project_id=$2 ORDER BY w.created_at DESC,w.id DESC",
    )
    .bind(environment_id)
    .bind(auth.project_id)
    .fetch_all(&state.db)
    .await
    .map_err(Error::internal)?;
    enrich_environment_wallet_balances(&state, user_id, &auth, environment_id, &mut wallets).await;
    Ok(Json(json!({"wallets":wallets})))
}

pub async fn add_environment_wallet(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, environment_id)): Path<(String, String, Uuid)>,
    Json(body): Json<EnvironmentWalletBody>,
) -> Result<(axum::http::StatusCode, Json<Value>), Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    ensure_environment(&state.db, auth.project_id, environment_id).await?;
    let address = body.address.trim();
    if !valid_wallet_address(address) {
        return Err(Error::BadRequest(
            "address must be a valid Stellar G... or M... address".into(),
        ));
    }
    let already_linked = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(
             SELECT 1 FROM environment_wallets
              WHERE environment_id=$1 AND project_id=$2 AND address=$3
         )",
    )
    .bind(environment_id)
    .bind(auth.project_id)
    .bind(address)
    .fetch_one(&state.db)
    .await
    .map_err(Error::internal)?;
    if already_linked {
        return Err(Error::ConflictDetail(
            "This account is already linked to this environment.".into(),
        ));
    }
    let network = sqlx::query_scalar::<_, String>(
        "SELECT network FROM fork_environments WHERE id=$1 AND project_id=$2",
    )
    .bind(environment_id)
    .bind(auth.project_id)
    .fetch_one(&state.db)
    .await
    .map_err(Error::internal)?;
    let network_exists = source_network_account_exists(&network, address).await?;
    if network_exists == Some(false) && !body.confirm_virtual {
        return Ok((
            axum::http::StatusCode::OK,
            Json(json!({
                "linked": false,
                "network_exists": false,
                "requires_virtual_confirmation": true,
                "network": network,
                "message": format!("The address {address} has no account entry on the selected network. It can still be used as an account that exists only inside this virtual network. Continuing would create this as an account within this virtual network.")
            })),
        ));
    }
    let label = body
        .label
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if label.is_some_and(|value| value.len() > 80) {
        return Err(Error::BadRequest(
            "label must contain at most 80 characters".into(),
        ));
    }
    let virtual_only = network_exists == Some(false);
    if virtual_only {
        const INITIAL_ACCOUNT_RESERVE_UNITS: &str = "10000000";
        let upstream = json!({
            "address": address,
            "asset": "native",
            "amount": INITIAL_ACCOUNT_RESERVE_UNITS
        });
        client(&state)?
            .fund_environment(
                &actor(user_id, &auth),
                environment_id,
                &upstream,
                &format!("virtual-account-{environment_id}-{address}"),
            )
            .await
            .map_err(map_remote)?;
    }
    let row = sqlx::query_as::<_, (Uuid, chrono::DateTime<chrono::Utc>)>(
        "INSERT INTO environment_wallets(environment_id,project_id,address,label,created_by)
         VALUES($1,$2,$3,$4,$5)
         RETURNING id,created_at",
    )
    .bind(environment_id)
    .bind(auth.project_id)
    .bind(address)
    .bind(label)
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|error| {
        if error
            .as_database_error()
            .is_some_and(|db| db.code().as_deref() == Some("23505"))
        {
            Error::ConflictDetail("This account is already linked to this environment.".into())
        } else {
            Error::internal(error)
        }
    })?;
    record_activity(
        &state.db,
        auth.project_id,
        environment_id,
        Some(user_id),
        "wallet.linked",
        "Account linked",
        json!({"address":address,"label":label,"virtual_only":virtual_only}),
    )
    .await?;
    if virtual_only {
        record_activity(
            &state.db,
            auth.project_id,
            environment_id,
            Some(user_id),
            "wallet.account_created",
            "Virtual account created",
            json!({
                "address": address,
                "asset": "native",
                "amount": "1",
                "amount_units": "10000000",
                "decimals": 7,
                "reason": "minimum_account_reserve"
            }),
        )
        .await?;
        record_activity(
            &state.db,
            auth.project_id,
            environment_id,
            Some(user_id),
            "wallet.funded",
            "Initial account reserve funded",
            json!({
                "address": address,
                "asset": "native",
                "amount": "1",
                "amount_units": "10000000",
                "decimals": 7,
                "reason": "minimum_account_reserve"
            }),
        )
        .await?;
    }
    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({
            "id":row.0,"address":address,"label":label,"created_at":row.1,
            "network_exists":network_exists.unwrap_or(true),
            "virtual_only":virtual_only
        })),
    ))
}

pub async fn rename_environment_wallet(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, environment_id, wallet_id)): Path<(String, String, Uuid, Uuid)>,
    Json(body): Json<EnvironmentWalletRenameBody>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    ensure_environment(&state.db, auth.project_id, environment_id).await?;
    let label = body
        .label
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if label.is_some_and(|value| value.len() > 80) {
        return Err(Error::BadRequest(
            "label must contain at most 80 characters".into(),
        ));
    }
    let row = sqlx::query_as::<_, (String, Option<String>)>(
        "UPDATE environment_wallets
            SET label=$1
          WHERE id=$2 AND environment_id=$3 AND project_id=$4
      RETURNING address,label",
    )
    .bind(label)
    .bind(wallet_id)
    .bind(environment_id)
    .bind(auth.project_id)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)?;
    record_activity(
        &state.db,
        auth.project_id,
        environment_id,
        Some(user_id),
        "wallet.renamed",
        "Account label updated",
        json!({"address":row.0,"label":row.1}),
    )
    .await?;
    Ok(Json(json!({"id":wallet_id,"address":row.0,"label":row.1})))
}

pub async fn list_environment_deployments(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, environment_id)): Path<(String, String, Uuid)>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    ensure_environment(&state.db, auth.project_id, environment_id).await?;
    let deployments = sqlx::query_as::<
        _,
        (
            Uuid,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            chrono::DateTime<chrono::Utc>,
        ),
    >(
        "SELECT id,contract_id,wasm_hash,upload_hash,create_hash,source_account,created_at
           FROM environment_deployments WHERE environment_id=$1 AND project_id=$2
          ORDER BY created_at DESC,id DESC",
    )
    .bind(environment_id)
    .bind(auth.project_id)
    .fetch_all(&state.db)
    .await
    .map_err(Error::internal)?
    .into_iter()
    .map(|row| {
        json!({"id":row.0,"contract_id":row.1,"wasm_hash":row.2,
        "upload_hash":row.3,"create_hash":row.4,"source_account":row.5,"created_at":row.6})
    })
    .collect::<Vec<_>>();
    Ok(Json(json!({"deployments":deployments})))
}

#[derive(Debug, Deserialize)]
pub struct FundingAssetMetadataRequest {
    pub asset: String,
}

pub async fn resolve_funding_asset(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, environment_id)): Path<(String, String, Uuid)>,
    Json(body): Json<FundingAssetMetadataRequest>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    ensure_environment(&state.db, auth.project_id, environment_id).await?;
    let asset = body.asset.trim();
    if decode_strkey_payload(asset, 2 << 3, 32).is_none() {
        return Err(Error::BadRequest(
            "asset must be a standard SAC contract C... address".into(),
        ));
    }

    // Standard SAC amounts use Stellar's fixed seven-decimal precision. Keep
    // the resolved scale server-side so funding never relies on user input.
    Ok(Json(json!({
        "asset": asset,
        "label": format!("SAC {}", asset.chars().take(8).collect::<String>()),
        "decimals": 7,
    })))
}

#[derive(Debug, Deserialize)]
pub struct FundEnvironmentRequest {
    pub address: String,
    pub asset: String,
    pub amount: String,
    pub decimals: Option<u32>,
}

fn decimal_to_units(value: &str, decimals: u32) -> Result<String, Error> {
    if decimals > 18 {
        return Err(Error::BadRequest(
            "asset decimals must be between 0 and 18".into(),
        ));
    }
    let value = value.trim();
    if value.is_empty() || value.starts_with('-') || value.starts_with('+') {
        return Err(Error::BadRequest(
            "amount must be a positive decimal".into(),
        ));
    }
    let mut parts = value.split('.');
    let whole = parts.next().unwrap_or_default();
    let fraction = parts.next().unwrap_or_default();
    if parts.next().is_some()
        || whole.is_empty()
        || !whole.bytes().all(|byte| byte.is_ascii_digit())
        || !fraction.bytes().all(|byte| byte.is_ascii_digit())
        || fraction.len() > decimals as usize
    {
        return Err(Error::BadRequest(format!(
            "amount supports at most {decimals} decimal places"
        )));
    }
    let whole = whole
        .parse::<i128>()
        .map_err(|_| Error::BadRequest("amount is too large".into()))?;
    let fraction = if decimals == 0 {
        0
    } else {
        format!("{fraction:0<width$}", width = decimals as usize)
            .parse::<i128>()
            .map_err(|_| Error::BadRequest("amount is invalid".into()))?
    };
    let scale = 10_i128
        .checked_pow(decimals)
        .ok_or_else(|| Error::BadRequest("asset decimals are too large".into()))?;
    let units = whole
        .checked_mul(scale)
        .and_then(|value| value.checked_add(fraction))
        .filter(|value| *value > 0 && *value <= i64::MAX as i128)
        .ok_or_else(|| {
            Error::BadRequest("amount must be greater than zero and fit Stellar limits".into())
        })?;
    Ok(units.to_string())
}

pub async fn fund_environment(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, environment_id)): Path<(String, String, Uuid)>,
    headers: HeaderMap,
    Json(body): Json<FundEnvironmentRequest>,
) -> Result<(axum::http::StatusCode, Json<Value>), Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    auth.require_org_admin()?;
    ensure_environment(&state.db, auth.project_id, environment_id).await?;
    let key = required_idempotency_key(&headers)?;
    let linked = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(
             SELECT 1 FROM environment_wallets
              WHERE environment_id=$1 AND project_id=$2 AND address=$3
         )",
    )
    .bind(environment_id)
    .bind(auth.project_id)
    .bind(body.address.trim())
    .fetch_one(&state.db)
    .await
    .map_err(Error::internal)?;
    if !linked {
        return Err(Error::BadRequest(
            "account must be linked to this environment before it can be funded".into(),
        ));
    }
    if !valid_wallet_address(body.address.trim()) || !body.address.starts_with('G') {
        return Err(Error::BadRequest(
            "funding requires a plain Stellar G... account".into(),
        ));
    }
    let native = matches!(body.asset.to_ascii_lowercase().as_str(), "native" | "xlm");
    if !native && decode_strkey_payload(&body.asset, 2 << 3, 32).is_none() {
        return Err(Error::BadRequest(
            "asset must be native or a standard SAC contract C... address".into(),
        ));
    }
    let decimals = if native {
        7
    } else {
        body.decimals.unwrap_or(7)
    };
    let units = decimal_to_units(&body.amount, decimals)?;
    let asset = if native {
        "native"
    } else {
        body.asset.as_str()
    };
    let upstream = json!({"address":body.address.trim(),"asset":asset,"amount":units});
    let value = client(&state)?
        .fund_environment(&actor(user_id, &auth), environment_id, &upstream, key)
        .await
        .map_err(map_remote)?;
    record_activity(
        &state.db,
        auth.project_id,
        environment_id,
        Some(user_id),
        "wallet.funded",
        "Virtual balance updated",
        json!({
            "address":body.address.trim(),"asset":asset,"amount":body.amount,
            "amount_units":units,"decimals":decimals
        }),
    )
    .await?;
    Ok((axum::http::StatusCode::CREATED, Json(value)))
}

#[derive(Debug, Deserialize)]
pub struct EnvironmentListQuery {
    pub limit: Option<i64>,
}

pub async fn environment_activity(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, environment_id)): Path<(String, String, Uuid)>,
    Query(query): Query<EnvironmentListQuery>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    ensure_environment(&state.db, auth.project_id, environment_id).await?;
    let limit = query.limit.unwrap_or(50).clamp(1, 100);
    let mut items = sqlx::query_as::<
        _,
        (
            Uuid,
            String,
            String,
            Value,
            Option<Uuid>,
            chrono::DateTime<chrono::Utc>,
        ),
    >(
        "SELECT id,kind,summary,metadata,actor_id,created_at FROM environment_activity
          WHERE environment_id=$1 AND project_id=$2 ORDER BY created_at DESC,id DESC LIMIT $3",
    )
    .bind(environment_id)
    .bind(auth.project_id)
    .bind(limit)
    .fetch_all(&state.db)
    .await
    .map_err(Error::internal)?
    .into_iter()
    .map(|row| {
        json!({"id":row.0,"kind":row.1,"summary":row.2,
        "metadata":row.3,"actor_id":row.4,"created_at":row.5})
    })
    .collect::<Vec<_>>();
    let receipts = client(&state)?
        .environment_receipts(&actor(user_id, &auth), environment_id)
        .await
        .map_err(map_remote)?;
    for receipt in receipts
        .get("receipts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        items.push(json!({"id":format!("tx:{}",receipt.get("tx_hash").and_then(Value::as_str).unwrap_or("unknown")),
            "kind":"transaction.mined","summary":"Virtual transaction mined","metadata":receipt,
            "created_at":receipt.get("created_at").cloned().unwrap_or(Value::Null)}));
    }
    items.sort_by(|a, b| {
        b.get("created_at")
            .and_then(Value::as_str)
            .cmp(&a.get("created_at").and_then(Value::as_str))
    });
    items.truncate(limit as usize);
    Ok(Json(json!({"activity":items,"next_cursor":Value::Null})))
}

pub async fn environment_rpc_logs(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, environment_id)): Path<(String, String, Uuid)>,
    Query(query): Query<EnvironmentListQuery>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    ensure_environment(&state.db, auth.project_id, environment_id).await?;
    let limit = query.limit.unwrap_or(100).clamp(1, 200);
    sqlx::query("DELETE FROM environment_rpc_logs WHERE created_at < now() - interval '30 days'")
        .execute(&state.db)
        .await
        .map_err(Error::internal)?;
    let logs = sqlx::query_as::<
        _,
        (
            Uuid,
            String,
            String,
            i32,
            String,
            Option<String>,
            chrono::DateTime<chrono::Utc>,
        ),
    >(
        "SELECT id,method,status,latency_ms,caller_class,request_id,created_at
           FROM environment_rpc_logs WHERE environment_id=$1 AND project_id=$2
          ORDER BY created_at DESC,id DESC LIMIT $3",
    )
    .bind(environment_id)
    .bind(auth.project_id)
    .bind(limit)
    .fetch_all(&state.db)
    .await
    .map_err(Error::internal)?
    .into_iter()
    .map(|row| {
        json!({"id":row.0,"method":row.1,"status":row.2,
        "latency_ms":row.3,"caller_class":row.4,"request_id":row.5,"created_at":row.6})
    })
    .collect::<Vec<_>>();
    Ok(Json(
        json!({"logs":logs,"retention_days":30,"next_cursor":Value::Null}),
    ))
}

pub async fn rotate_environment_rpc_secret(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, environment_id)): Path<(String, String, Uuid)>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    auth.require_org_admin()?;
    ensure_environment(&state.db, auth.project_id, environment_id).await?;
    let secret = Uuid::new_v4().to_string();
    sqlx::query(
        "UPDATE fork_environments SET rpc_previous_secret_hash=rpc_admin_secret_hash,
                rpc_previous_secret_expires_at=now()+interval '5 minutes',
                rpc_admin_secret_hash=$1,rpc_admin_secret=$2,rpc_secret_rotated_at=now()
          WHERE id=$3 AND project_id=$4",
    )
    .bind(secret_hash(&secret))
    .bind(&secret)
    .bind(environment_id)
    .bind(auth.project_id)
    .execute(&state.db)
    .await
    .map_err(Error::internal)?;
    let segment: Option<String> =
        sqlx::query_scalar("SELECT rpc_slug FROM fork_environments WHERE id=$1")
            .bind(environment_id)
            .fetch_one(&state.db)
            .await
            .map_err(Error::internal)?;
    let segment = segment.unwrap_or_else(|| environment_id.to_string());
    let base = state.settings.api_base_url.trim_end_matches('/');
    record_activity(
        &state.db,
        auth.project_id,
        environment_id,
        Some(user_id),
        "rpc.credentials_rotated",
        "RPC credentials rotated",
        json!({"overlap_minutes":5}),
    )
    .await?;
    Ok(Json(json!({"admin_secret":secret,
        "admin_rpc_url":format!("{base}/v/{org}/{project}/{segment}/{secret}"),
        "previous_secret_expires_in_seconds":300})))
}

pub async fn public_environment_explorer(
    State(state): State<AppState>,
    Path((org, project, env)): Path<(String, String, String)>,
) -> Result<Json<Value>, Error> {
    let (organization_id, project_id, environment_id) =
        resolve_env_segment(&state, &org, &project, &env).await?;
    let environment = sqlx::query_as::<_, (String, String, i64, i32, String)>(
        "SELECT name,network,COALESCE(state_ledger,base_ledger_sequence),protocol,sync_status
           FROM fork_environments WHERE id=$1 AND project_id=$2 AND public_explorer_enabled",
    )
    .bind(environment_id)
    .bind(project_id)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)?;
    let deployments = sqlx::query_as::<_, (String, Option<String>, chrono::DateTime<chrono::Utc>)>(
        "SELECT contract_id,wasm_hash,created_at FROM environment_deployments
          WHERE environment_id=$1 ORDER BY created_at DESC LIMIT 100",
    )
    .bind(environment_id)
    .fetch_all(&state.db)
    .await
    .map_err(Error::internal)?
    .into_iter()
    .map(|row| json!({"contract_id":row.0,"wasm_hash":row.1,"created_at":row.2}))
    .collect::<Vec<_>>();
    let public_actor =
        sim::ServiceActor::public_rpc(Uuid::new_v4(), organization_id, project_id, Uuid::new_v4());
    let receipts = client(&state)?
        .environment_receipts(&public_actor, environment_id)
        .await
        .map_err(map_remote)?;
    Ok(Json(
        json!({"environment":{"id":environment_id,"name":environment.0,"network":environment.1,
        "state_ledger":environment.2,"protocol":environment.3,"status":environment.4},
        "deployments":deployments,"transactions":receipts.get("receipts").cloned().unwrap_or_else(||json!([]))}),
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
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<(axum::http::StatusCode, Json<Value>), Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let idempotency_key = required_idempotency_key(&headers)?;
    let operation = format!("fork:{environment_id}:{revision_id}");
    let digest = request_hash(&body)?;
    if let Some((stored_hash, response)) = sqlx::query_as::<_, (String, Value)>(
        "SELECT request_hash,response FROM environment_mutations
          WHERE project_id=$1 AND idempotency_key=$2 AND operation=$3",
    )
    .bind(auth.project_id)
    .bind(idempotency_key)
    .bind(&operation)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?
    {
        if stored_hash != digest {
            return Err(Error::ConflictDetail(
                "Idempotency key was reused with different input".into(),
            ));
        }
        return Ok((axum::http::StatusCode::CREATED, Json(response)));
    }
    let environment = client(&state)?
        .branch_environment_revision(
            &actor(user_id, &auth),
            environment_id,
            revision_id,
            &body,
            idempotency_key,
        )
        .await
        .map_err(map_remote)?;
    persist_environment(&state.db, auth.project_id, &environment).await?;
    sqlx::query(
        "INSERT INTO environment_mutations(project_id,idempotency_key,operation,request_hash,response)
         VALUES($1,$2,$3,$4,$5)",
    )
    .bind(auth.project_id)
    .bind(idempotency_key)
    .bind(operation)
    .bind(digest)
    .bind(&environment)
    .execute(&state.db)
    .await
    .map_err(Error::internal)?;
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

pub async fn step_environment_sync(
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
        run_environment_action(state, user, path, "sync/step", None, Some(idempotency_key)).await?;
    Ok((axum::http::StatusCode::ACCEPTED, response))
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

    #[test]
    fn rpc_slug_validation_normalizes_and_enforces_collision_rules() {
        // Canonical form: trimmed + lowercased.
        assert_eq!(
            validate_rpc_slug("  Mainnet-Prod  ").expect("valid slug"),
            "mainnet-prod"
        );
        assert_eq!(validate_rpc_slug("Fork-1").expect("digits ok"), "fork-1");
        // Charset / shape rules.
        for bad in [
            "",               // empty
            "   ",            // whitespace only
            "-leading",       // leading hyphen
            "trailing-",      // trailing hyphen
            "double--hyphen", // '--'
            "has space",      // space
            "slash/segment",  // path trick
            "dot.name",       // '.' not in charset
            "Ünïcode",        // non-ascii
            "UPPER_lower",    // underscore not allowed
        ] {
            assert!(validate_rpc_slug(bad).is_err(), "{bad:?} must be rejected");
        }
        // A slug that parses as a UUID would make /v/{org}/{project}/{env}
        // resolution ambiguous with the env-id namespace — never allowed.
        assert!(validate_rpc_slug("00000000-0000-0000-0000-000000000001").is_err());
        // Reserved words.
        for reserved in ["admin", "rpc", "health", "docs", "api", "ADMIN"] {
            assert!(
                validate_rpc_slug(reserved).is_err(),
                "{reserved} is reserved"
            );
        }
        // Length bound (63) and boundary values.
        let max = "a".repeat(RPC_SLUG_MAX_LEN);
        assert!(validate_rpc_slug(&max).is_ok());
        assert!(validate_rpc_slug(&format!("{max}a")).is_err());
    }

    #[test]
    fn org_admin_gate_requires_manage_members() {
        use shared::Permission;
        let admin = ProjectAuth {
            organization_id: Uuid::new_v4(),
            project_id: Uuid::new_v4(),
            permissions: PermissionSet::from(&[Permission::ManageMembers][..]).raw(),
        };
        assert!(admin.require_org_admin().is_ok());
        // A fork-session member without the admin bit cannot name URLs.
        let member = ProjectAuth {
            organization_id: Uuid::new_v4(),
            project_id: Uuid::new_v4(),
            permissions: PermissionSet::from(&[Permission::ManageForkSessions][..]).raw(),
        };
        assert!(matches!(member.require_org_admin(), Err(Error::Forbidden)));
    }

    #[test]
    fn exact_decimal_funding_never_rounds() {
        assert_eq!(decimal_to_units("1", 7).unwrap(), "10000000");
        assert_eq!(decimal_to_units("1.0000001", 7).unwrap(), "10000001");
        assert_eq!(decimal_to_units("0.0000001", 7).unwrap(), "1");
        assert!(decimal_to_units("0.00000001", 7).is_err());
        assert!(decimal_to_units("0", 7).is_err());
        assert!(decimal_to_units("-1", 7).is_err());
        assert!(decimal_to_units("1e3", 7).is_err());
    }

    #[test]
    fn stellar_wallet_validation_checks_checksum_and_version() {
        let valid = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
        assert!(valid_wallet_address(valid));
        let mut corrupted = valid.as_bytes().to_vec();
        *corrupted.last_mut().unwrap() = b'A';
        assert!(!valid_wallet_address(
            std::str::from_utf8(&corrupted).unwrap()
        ));
        assert!(!valid_wallet_address(
            "CA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
        ));
        assert!(!valid_wallet_address("G-not-a-strkey"));
    }

    #[tokio::test]
    async fn rpc_slug_unique_index_blocks_project_collisions_only() {
        let pg = spawn_postgres().await;
        run_migrations(&pg.pool).await;

        let owner_user_id: Uuid = sqlx::query_scalar(
            "INSERT INTO users(email,email_verified)
             VALUES('rpc-slug@releeve.test',true) RETURNING id",
        )
        .fetch_one(&pg.pool)
        .await
        .expect("owner is created");
        let organization_id: Uuid = sqlx::query_scalar(
            "INSERT INTO organizations(slug,name,is_personal,owner_user_id)
             VALUES('rpc-slug','RPC slug',false,$1) RETURNING id",
        )
        .bind(owner_user_id)
        .fetch_one(&pg.pool)
        .await
        .expect("organization is created");
        let project_a = create_project(&pg.pool, organization_id, "project-a").await;
        let project_b = create_project(&pg.pool, organization_id, "project-b").await;

        let seed_pool = pg.pool.clone();
        let seed = move |project: Uuid, id: Uuid| {
            let pool = seed_pool.clone();
            async move {
                let env = environment(id, "Slug lab", 1);
                persist_environment(&pool, project, &env).await
            }
        };

        let first = Uuid::new_v4();
        seed(project_a, first).await.expect("first env persisted");
        sqlx::query("UPDATE fork_environments SET rpc_slug='mainnet-prod' WHERE id=$1")
            .bind(first)
            .execute(&pg.pool)
            .await
            .expect("slug set");

        // Same project, different case -> collides through lower(rpc_slug).
        let second = Uuid::new_v4();
        seed(project_a, second).await.expect("second env persisted");
        let case_conflict =
            sqlx::query("UPDATE fork_environments SET rpc_slug='Mainnet-Prod' WHERE id=$1")
                .bind(second)
                .execute(&pg.pool)
                .await;
        assert!(
            case_conflict.is_err(),
            "case-insensitive duplicate slug must violate the unique index"
        );

        // NULL slugs coexist freely.
        let third = Uuid::new_v4();
        seed(project_a, third).await.expect("third env persisted");
        let nulls: i64 =
            sqlx::query_scalar("SELECT count(*) FROM fork_environments WHERE rpc_slug IS NULL")
                .fetch_one(&pg.pool)
                .await
                .expect("null-slug count");
        assert_eq!(nulls, 2, "unset slugs are legal and unlimited");

        // The same name in ANOTHER project of the same org is fine: the URL
        // already contains the project segment, so scoping is per-project.
        let fourth = Uuid::new_v4();
        seed(project_b, fourth).await.expect("other project env");
        let other_project =
            sqlx::query("UPDATE fork_environments SET rpc_slug='mainnet-prod' WHERE id=$1")
                .bind(fourth)
                .execute(&pg.pool)
                .await;
        assert!(
            other_project.is_ok(),
            "same slug in a different project cannot collide"
        );
    }
}
