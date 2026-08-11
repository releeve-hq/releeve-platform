//! Phase 3 explorer entity API: decoded transaction/account/contract/ledger
//! detail plus project-tracked tags, comments, priority, verification, and
//! contract call routing.

use std::collections::HashSet;

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::{Json, body::Bytes};
use chrono::{DateTime, Utc};
use ingest::decode::{decode_classic_tx, decode_invoke_detail, decode_ledger};
use ingest::rpc::SorobanRpcClient;
use ingest::state::{upsert_ledger, upsert_tx};
use ingest::upstream::{Backoff, CircuitBreaker};
use serde::Deserialize;
use serde_json::{Value, json};
use shared::{Cursor, Error, Paged, Pagination, Permission, PermissionSet, clamp_limit};
use sqlx::{PgPool, Row};
use std::time::Duration;
use uuid::Uuid;

use crate::extract::AuthUser;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct PageQuery {
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub tag: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TxListQuery {
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub address: Option<String>,
    #[serde(default)]
    pub contract: Option<String>,
    #[serde(default)]
    pub function: Option<String>,
    #[serde(default, rename = "type")]
    pub tx_type: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    pub q: String,
    #[serde(default = "default_scope")]
    pub scope: String,
}

#[derive(Debug, Deserialize)]
pub struct LookupQuery {
    pub q: String,
}

#[derive(Debug, Deserialize)]
pub struct AccountTxQuery {
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default, rename = "type")]
    pub kind: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct EventQuery {
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default, rename = "type")]
    pub event_type: Option<String>,
    #[serde(default)]
    pub from_ledger: Option<i64>,
    #[serde(default)]
    pub to_ledger: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct CallMode {
    #[serde(default = "default_call_mode")]
    pub mode: String,
}

fn default_scope() -> String {
    "all".to_owned()
}

fn default_call_mode() -> String {
    "simulate".to_owned()
}

#[derive(Clone)]
struct ProjectAuth {
    organization_id: Uuid,
    project_id: Uuid,
    network: String,
    email_verified: bool,
    perms: PermissionSet,
}

impl ProjectAuth {
    fn require(&self, p: Permission) -> Result<(), Error> {
        if self.perms.contains(p) {
            Ok(())
        } else {
            Err(Error::Forbidden)
        }
    }

    fn require_verified(&self) -> Result<(), Error> {
        if self.email_verified {
            Ok(())
        } else {
            Err(Error::EmailUnverified)
        }
    }

    fn require_mutation(&self) -> Result<(), Error> {
        self.require(Permission::UpdateProjects)?;
        self.require_verified()
    }
}

async fn resolve_project(
    state: &AppState,
    user_id: Uuid,
    org_slug: &str,
    project_slug: &str,
) -> Result<ProjectAuth, Error> {
    let row = sqlx::query_as::<_, (Uuid, Uuid, String, bool, i16)>(
        r#"
        SELECT o.id, p.id, p.network, u.email_verified, m.permissions
        FROM organizations o
        JOIN organization_members m ON m.organization_id = o.id AND m.user_id = $1
        JOIN users u ON u.id = m.user_id
        JOIN projects p ON p.organization_id = o.id AND p.slug = $3
        WHERE o.slug = $2
        "#,
    )
    .bind(user_id)
    .bind(org_slug)
    .bind(project_slug)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)?;

    Ok(ProjectAuth {
        organization_id: row.0,
        project_id: row.1,
        network: row.2,
        email_verified: row.3,
        perms: PermissionSet(row.4),
    })
}

fn source_lens(state: &AppState) -> Result<&source_lens_client::SourceLensClient, Error> {
    state
        .source_lens
        .as_ref()
        .ok_or_else(|| Error::ServiceUnavailable("source_lens".into()))
}

fn source_lens_actor(
    user_id: Uuid,
    auth: &ProjectAuth,
    request_id: Uuid,
) -> source_lens_client::ServiceActor {
    source_lens_client::ServiceActor::project_member(
        user_id,
        auth.organization_id,
        auth.project_id,
        request_id,
        auth.perms.contains(Permission::UpdateProjects),
    )
}

fn map_source_lens(error: source_lens_client::Error) -> Error {
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

fn parse_time_cursor(raw: Option<&str>) -> Result<Option<(DateTime<Utc>, String)>, Error> {
    let Some(raw) = raw.filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let cursor = Cursor::decode(raw).map_err(|_| Error::BadRequest("malformed cursor".into()))?;
    let ts = DateTime::parse_from_rfc3339(&cursor.sort_key)
        .map_err(|_| Error::BadRequest("malformed cursor".into()))?
        .with_timezone(&Utc);
    Ok(Some((ts, cursor.stable_id)))
}

fn parse_seq_cursor(raw: Option<&str>) -> Result<Option<(i64, String)>, Error> {
    let Some(raw) = raw.filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let cursor = Cursor::decode(raw).map_err(|_| Error::BadRequest("malformed cursor".into()))?;
    let seq = cursor
        .sort_key
        .parse::<i64>()
        .map_err(|_| Error::BadRequest("malformed cursor".into()))?;
    Ok(Some((seq, cursor.stable_id)))
}

fn parse_text_cursor(raw: Option<&str>) -> Result<Option<(String, String)>, Error> {
    let Some(raw) = raw.filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let cursor = Cursor::decode(raw).map_err(|_| Error::BadRequest("malformed cursor".into()))?;
    Ok(Some((cursor.sort_key, cursor.stable_id)))
}

fn paged_json(
    data: Vec<Value>,
    cursors: Vec<(String, String)>,
    limit: i64,
    had_cursor: bool,
) -> Paged<Value> {
    let has_more = data.len() as i64 > limit;
    let data: Vec<Value> = data.into_iter().take(limit as usize).collect();
    let cursors: Vec<(String, String)> = cursors.into_iter().take(limit as usize).collect();
    let next_cursor = if has_more {
        cursors
            .last()
            .map(|(sort, id)| Cursor::new(sort.clone(), id.clone()).encode())
    } else {
        None
    };
    let prev_cursor = if had_cursor {
        cursors
            .first()
            .map(|(sort, id)| Cursor::new(sort.clone(), id.clone()).encode())
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

fn unique_or_conflict(e: sqlx::Error) -> Error {
    if matches!(
        &e,
        sqlx::Error::Database(db) if db.is_unique_violation()
    ) {
        Error::Conflict
    } else {
        Error::internal(e)
    }
}

fn numeric_str(row: &sqlx::postgres::PgRow, name: &str) -> Option<String> {
    row.try_get::<Option<String>, _>(name).ok().flatten()
}

// ---- Transaction detail -------------------------------------------------------------

pub async fn public_lookup(
    State(state): State<AppState>,
    Path(network): Path<String>,
    Query(q): Query<LookupQuery>,
) -> Result<Json<Value>, Error> {
    let query = q.q.trim();
    if query.is_empty() {
        return Ok(Json(json!({ "query": query, "suggestions": [] })));
    }
    let base = horizon_url_for_network(&network)
        .ok_or_else(|| Error::BadRequest(format!("unsupported explorer network: {network}")))?;
    let mut suggestions = Vec::new();

    if query.len() == 64 && query.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        let local = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM transactions WHERE network = $1 AND lower(hash) = lower($2))",
        )
        .bind(&network)
        .bind(query)
        .fetch_one(&state.db)
        .await
        .map_err(Error::internal)?;
        if local || upstream_exists(&format!("{base}/transactions/{query}")).await {
            suggestions.push(json!({
                "kind": "transaction", "value": query,
                "label": "Transaction", "description": "Open decoded transaction detail"
            }));
        }
    } else if query.starts_with('G') && query.len() == 56 {
        if upstream_exists(&format!("{base}/accounts/{query}")).await {
            suggestions.push(json!({
                "kind": "account", "value": query,
                "label": "Wallet / Account", "description": "Open balances and transaction history"
            }));
        }
    } else if query.starts_with('C') && query.len() == 56 {
        let local = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM contracts WHERE network = $1 AND address = $2
                UNION ALL
                SELECT 1 FROM tx_call_tree_nodes c
                JOIN transactions t ON t.hash = c.tx_hash
                WHERE t.network = $1 AND c.contract_id = $2
            )
            "#,
        )
        .bind(&network)
        .bind(query)
        .fetch_one(&state.db)
        .await
        .map_err(Error::internal)?;
        if local || upstream_exists(&format!("{base}/contracts/{query}")).await {
            suggestions.push(json!({
                "kind": "contract", "value": query,
                "label": "Contract", "description": "Open contract activity and events"
            }));
        }
    } else if query.bytes().all(|byte| byte.is_ascii_digit())
        && let Ok(sequence) = query.parse::<i64>()
    {
        let local = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM ledgers WHERE network = $1 AND sequence = $2)",
        )
        .bind(&network)
        .bind(sequence)
        .fetch_one(&state.db)
        .await
        .map_err(Error::internal)?;
        if local || upstream_exists(&format!("{base}/ledgers/{sequence}")).await {
            suggestions.push(json!({
                "kind": "ledger", "value": query,
                "label": format!("Ledger {sequence}"), "description": "Open ledger detail"
            }));
        }
    }

    Ok(Json(json!({ "query": query, "suggestions": suggestions })))
}

async fn upstream_exists(url: &str) -> bool {
    reqwest::Client::new()
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .is_ok_and(|response| response.status().is_success())
}

pub async fn public_tx_detail(
    State(state): State<AppState>,
    Path((network, hash)): Path<(String, String)>,
) -> Result<Json<Value>, Error> {
    Ok(Json(
        load_tx_detail(&state.db, &network, &hash, &state.settings.soroban_rpc_url).await?,
    ))
}

async fn load_tx_detail(
    pool: &PgPool,
    network: &str,
    hash: &str,
    configured_rpc_url: &str,
) -> Result<Value, Error> {
    let mut row = match tx_header_row(pool, network, hash).await {
        Ok(row) => row,
        Err(Error::NotFound) => {
            let (horizon_tx, _) = fetch_horizon_tx_with_fund_flow(network, hash).await?;
            ensure_horizon_ledger(pool, network, &horizon_tx).await?;
            let tx = decode_classic_tx(&horizon_tx, network).map_err(Error::internal)?;
            upsert_tx(pool, &tx).await.map_err(Error::internal)?;
            tx_header_row(pool, network, hash).await?
        }
        Err(error) => return Err(error),
    };

    let operation_type = row.get::<String, _>("operation_type");
    let is_soroban_invocation = operation_type == "invoke_host_function";
    if is_soroban_invocation {
        if let Some(rpc_url) = rpc_url_for_network(network, configured_rpc_url) {
            match fetch_rpc_tx_detail(&rpc_url, network, hash).await {
                Ok(tx) => {
                    upsert_tx(pool, &tx).await.map_err(|err| {
                        tracing::error!(%err, hash, network, "failed to persist RPC-enriched explorer transaction");
                        Error::internal(err)
                    })?;
                    row = tx_header_row(pool, network, hash).await?;
                }
                Err(error) => {
                    tracing::warn!(?error, hash, network, "RPC explorer enrichment failed");
                }
            }
        }
    }

    let mut flow = fund_flow(pool, hash).await?;
    // A Soroban invocation can legitimately move no asset. Its empty flow must
    // not trigger the classic Horizon fallback, which only has the envelope
    // root and would overwrite a decoded nested RPC trace.
    if flow.is_empty()
        && !is_soroban_invocation
        && let Ok((horizon_tx, horizon_flow)) = fetch_horizon_tx_with_fund_flow(network, hash).await
    {
        if let Ok(tx) = decode_classic_tx(&horizon_tx, network) {
            let should_fetch_rpc = tx.operation_type == "invoke_host_function"
                && call_tree_count(pool, hash).await? == 0;
            upsert_tx(pool, &tx).await.map_err(|err| {
                tracing::error!(%err, hash, network, "failed to persist Horizon-enriched explorer transaction");
                Error::internal(err)
            })?;
            row = tx_header_row(pool, network, hash).await?;
            if should_fetch_rpc
                && let Some(rpc_url) = rpc_url_for_network(network, configured_rpc_url)
            {
                match fetch_rpc_tx_detail(&rpc_url, network, hash).await {
                    Ok(tx) => {
                        upsert_tx(pool, &tx).await.map_err(|err| {
                            tracing::error!(%err, hash, network, "failed to persist RPC detail after Horizon fetch");
                            Error::internal(err)
                        })?;
                        row = tx_header_row(pool, network, hash).await?;
                    }
                    Err(error) => {
                        tracing::warn!(
                            ?error,
                            hash,
                            network,
                            "RPC explorer enrichment after Horizon fetch failed"
                        );
                    }
                }
            }
        }
        flow = horizon_flow;
    }
    if flow.is_empty() {
        flow = fund_flow(pool, hash).await?;
    }
    let calls = call_tree(pool, hash).await?;
    let states = state_changes(pool, hash).await?;
    let events = tx_events(pool, hash).await?;
    let annotations = annotations(pool, hash).await?;

    Ok(json!({
        "hash": row.get::<String, _>("hash"),
        "network": row.get::<String, _>("network"),
        "status": row.get::<String, _>("status"),
        "ledger": row.get::<i64, _>("ledger_sequence"),
        "timestamp": row.get::<DateTime<Utc>, _>("timestamp"),
        "source_account": row.get::<String, _>("source_account"),
        "operation_type": row.get::<String, _>("operation_type"),
        "operation_target_address": row.get::<Option<String>, _>("operation_target_address"),
        "operation_target_kind": row.get::<Option<String>, _>("operation_target_kind"),
        "fee_charged": numeric_str(&row, "fee_charged"),
        "sequence_number": row.get::<Option<String>, _>("sequence_number"),
        "application_order": row.get::<Option<i32>, _>("application_order"),
        "resource_usage": {
            "cpu_instructions": row.get::<Option<i64>, _>("cpu_instructions"),
            "cpu_instruction_limit": row.get::<Option<i64>, _>("cpu_instruction_limit"),
            "memory_bytes": row.get::<Option<i64>, _>("memory_bytes"),
            "invoke_time_nsecs": row.get::<Option<i64>, _>("invoke_time_nsecs"),
            "disk_read_bytes": row.get::<Option<i64>, _>("disk_read_bytes"),
            "disk_read_bytes_limit": row.get::<Option<i64>, _>("disk_read_bytes_limit"),
            "write_bytes": row.get::<Option<i64>, _>("write_bytes"),
            "write_bytes_limit": row.get::<Option<i64>, _>("write_bytes_limit"),
            "max_rw_key_byte": row.get::<Option<i32>, _>("max_rw_key_byte"),
            "max_rw_data_byte": row.get::<Option<i32>, _>("max_rw_data_byte"),
            "resource_fee": numeric_str(&row, "resource_fee")
        },
        "call_tree": calls,
        "state_changes": states,
        "events": events,
        "fund_flow": flow,
        "annotations": annotations,
        "source_map_status": "not_available"
    }))
}

async fn tx_header_row(
    pool: &PgPool,
    network: &str,
    hash: &str,
) -> Result<sqlx::postgres::PgRow, Error> {
    sqlx::query(
        r#"
        SELECT hash, network, ledger_sequence, status, source_account, operation_type,
               operation_target_address, operation_target_kind,
               fee_charged::text, sequence_number, application_order, timestamp,
               cpu_instructions, memory_bytes, invoke_time_nsecs, disk_read_bytes,
               write_bytes, max_rw_key_byte, max_rw_data_byte,
               cpu_instruction_limit, disk_read_bytes_limit, write_bytes_limit,
               resource_fee::text
        FROM transactions
        WHERE network = $1 AND hash = $2
        "#,
    )
    .bind(network)
    .bind(hash)
    .fetch_optional(pool)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)
}

async fn call_tree(pool: &PgPool, hash: &str) -> Result<Vec<Value>, Error> {
    let rows = sqlx::query(
        r#"
        SELECT id, parent_node_id, contract_id, function_name, args, return_value, depth, sequence
        FROM tx_call_tree_nodes
        WHERE tx_hash = $1
        ORDER BY sequence ASC, id ASC
        "#,
    )
    .bind(hash)
    .fetch_all(pool)
    .await
    .map_err(Error::internal)?;

    let mut nodes = Vec::with_capacity(rows.len());
    for row in rows {
        nodes.push(json!({
            "id": row.get::<Uuid, _>("id"),
            "parent_id": row.get::<Option<Uuid>, _>("parent_node_id"),
            "contract_id": row.get::<String, _>("contract_id"),
            "function_name": row.get::<String, _>("function_name"),
            "args": row.get::<Value, _>("args"),
            "return_value": row.get::<Option<Value>, _>("return_value"),
            "depth": row.get::<i32, _>("depth"),
            "sequence": row.get::<i32, _>("sequence")
        }));
    }
    Ok(nodes)
}

async fn call_tree_count(pool: &PgPool, hash: &str) -> Result<i64, Error> {
    sqlx::query_scalar("SELECT count(*) FROM tx_call_tree_nodes WHERE tx_hash = $1")
        .bind(hash)
        .fetch_one(pool)
        .await
        .map_err(Error::internal)
}

fn explorer_backoff() -> Backoff {
    Backoff {
        base: Duration::from_millis(250),
        max: Duration::from_secs(5),
        jitter: 0.1,
        max_attempts: 3,
    }
}

fn explorer_breaker() -> CircuitBreaker {
    CircuitBreaker::new(3, Duration::from_secs(30))
}

fn rpc_url_for_network(network: &str, configured_rpc_url: &str) -> Option<String> {
    match network {
        "testnet" => Some("https://soroban-testnet.stellar.org".to_string()),
        "mainnet" if !configured_rpc_url.trim().is_empty() => Some(configured_rpc_url.to_string()),
        _ => None,
    }
}

async fn fetch_rpc_tx_detail(
    rpc_url: &str,
    network: &str,
    hash: &str,
) -> Result<ingest::models::TxRecord, Error> {
    let mut rpc = SorobanRpcClient::new(rpc_url, explorer_backoff(), explorer_breaker());
    let detail = rpc.get_transaction(hash).await.map_err(|err| {
        Error::BadRequest(format!(
            "Soroban RPC transaction detail unavailable: {err:?}"
        ))
    })?;
    decode_invoke_detail(&detail, network).map_err(Error::internal)
}

async fn state_changes(pool: &PgPool, hash: &str) -> Result<Vec<Value>, Error> {
    let rows = sqlx::query(
        r#"
        SELECT id, caused_by_node_id, entry_type, entry_key, value_before, value_after,
               sequence, cause_confidence
        FROM tx_state_changes
        WHERE tx_hash = $1
        ORDER BY sequence ASC, id ASC
        "#,
    )
    .bind(hash)
    .fetch_all(pool)
    .await
    .map_err(Error::internal)?;
    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.get::<Uuid, _>("id"),
                "entry_type": row.get::<String, _>("entry_type"),
                "key": row.get::<String, _>("entry_key"),
                "before": row.get::<Option<Value>, _>("value_before"),
                "after": row.get::<Option<Value>, _>("value_after"),
                "caused_by_call": row.get::<Option<Uuid>, _>("caused_by_node_id"),
                "sequence": row.get::<i32, _>("sequence"),
                "cause_confidence": row.get::<String, _>("cause_confidence")
            })
        })
        .collect())
}

async fn tx_events(pool: &PgPool, hash: &str) -> Result<Vec<Value>, Error> {
    let rows = sqlx::query(
        r#"
        SELECT id, contract_id, topics, data, caused_by_node_id, sequence,
               event_type, successful, stage
        FROM tx_events WHERE tx_hash = $1 ORDER BY sequence ASC, id ASC
        "#,
    )
    .bind(hash)
    .fetch_all(pool)
    .await
    .map_err(Error::internal)?;
    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.get::<Uuid, _>("id"),
                "contract_id": row.get::<String, _>("contract_id"),
                "topics": row.get::<Value, _>("topics"),
                "data": row.get::<Value, _>("data"),
                "caused_by_call": row.get::<Option<Uuid>, _>("caused_by_node_id"),
                "sequence": row.get::<i32, _>("sequence"),
                "event_type": row.get::<String, _>("event_type"),
                "successful": row.get::<Option<bool>, _>("successful"),
                "stage": row.get::<Option<String>, _>("stage")
            })
        })
        .collect())
}

async fn fund_flow(pool: &PgPool, hash: &str) -> Result<Vec<Value>, Error> {
    let rows = sqlx::query(
        r#"
        SELECT id, from_address, to_address, asset, amount::text, caused_by_node_id,
               sequence, asset_type, usd_value::text
        FROM tx_fund_flow_edges
        WHERE tx_hash = $1
        ORDER BY sequence ASC, id ASC
        "#,
    )
    .bind(hash)
    .fetch_all(pool)
    .await
    .map_err(Error::internal)?;
    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.get::<Uuid, _>("id"),
                "from": row.get::<String, _>("from_address"),
                "to": row.get::<String, _>("to_address"),
                "asset": row.get::<String, _>("asset"),
                "amount": row.get::<String, _>("amount"),
                "caused_by_call": row.get::<Option<Uuid>, _>("caused_by_node_id"),
                "sequence": row.get::<i32, _>("sequence"),
                "asset_type": row.get::<String, _>("asset_type"),
                "usd_value": numeric_str(&row, "usd_value")
            })
        })
        .collect())
}

fn horizon_url_for_network(network: &str) -> Option<&'static str> {
    match network {
        "mainnet" => Some("https://horizon.stellar.org"),
        "testnet" => Some("https://horizon-testnet.stellar.org"),
        _ => None,
    }
}

fn classic_asset_label(op: &Value) -> String {
    match op
        .get("asset_type")
        .and_then(Value::as_str)
        .unwrap_or("native")
    {
        "native" => "XLM".to_string(),
        _ => {
            let code = op
                .get("asset_code")
                .and_then(Value::as_str)
                .unwrap_or("ASSET");
            let issuer = op.get("asset_issuer").and_then(Value::as_str).unwrap_or("");
            if issuer.is_empty() {
                code.to_string()
            } else {
                format!("{code}:{issuer}")
            }
        }
    }
}

fn op_flow_edge(op: &Value) -> Option<Value> {
    match op.get("type").and_then(Value::as_str) {
        Some("payment") => Some(json!({
            "id": op.get("id").and_then(Value::as_str).unwrap_or("horizon"),
            "from": op.get("from").and_then(Value::as_str)?,
            "to": op.get("to").and_then(Value::as_str)?,
            "asset": classic_asset_label(op),
            "amount": op.get("amount").and_then(Value::as_str)?
        })),
        Some("create_account") => Some(json!({
            "id": op.get("id").and_then(Value::as_str).unwrap_or("horizon"),
            "from": op.get("funder").and_then(Value::as_str)?,
            "to": op.get("account").and_then(Value::as_str)?,
            "asset": "XLM",
            "amount": op.get("starting_balance").and_then(Value::as_str)?
        })),
        _ => None,
    }
}

async fn fetch_horizon_tx_with_fund_flow(
    network: &str,
    hash: &str,
) -> Result<(Value, Vec<Value>), Error> {
    let base = horizon_url_for_network(network)
        .ok_or_else(|| Error::BadRequest(format!("unsupported explorer network: {network}")))?;
    let client = reqwest::Client::new();
    let mut tx = client
        .get(format!("{base}/transactions/{hash}"))
        .send()
        .await
        .map_err(Error::internal)?
        .error_for_status()
        .map_err(Error::internal)?
        .json::<Value>()
        .await
        .map_err(Error::internal)?;
    let body = client
        .get(format!("{base}/transactions/{hash}/operations?limit=200"))
        .send()
        .await
        .map_err(Error::internal)?
        .error_for_status()
        .map_err(Error::internal)?
        .json::<Value>()
        .await
        .map_err(Error::internal)?;
    let rows = body
        .get("_embedded")
        .and_then(|embedded| embedded.get("records"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if let Some(obj) = tx.as_object_mut() {
        obj.insert("operations".to_string(), Value::Array(rows.clone()));
    }
    Ok((tx, rows.iter().filter_map(op_flow_edge).collect()))
}

async fn ensure_horizon_ledger(pool: &PgPool, network: &str, tx: &Value) -> Result<(), Error> {
    let sequence = tx
        .get("ledger")
        .and_then(Value::as_i64)
        .ok_or_else(|| Error::BadRequest("Horizon transaction did not include a ledger".into()))?;
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM ledgers WHERE network = $1 AND sequence = $2)",
    )
    .bind(network)
    .bind(sequence)
    .fetch_one(pool)
    .await
    .map_err(Error::internal)?;
    if exists {
        return Ok(());
    }
    let base = horizon_url_for_network(network)
        .ok_or_else(|| Error::BadRequest(format!("unsupported explorer network: {network}")))?;
    let body = reqwest::Client::new()
        .get(format!("{base}/ledgers/{sequence}"))
        .send()
        .await
        .map_err(Error::internal)?
        .error_for_status()
        .map_err(Error::internal)?
        .json::<Value>()
        .await
        .map_err(Error::internal)?;
    let ledger = decode_ledger(&body, network).map_err(Error::internal)?;
    upsert_ledger(pool, &ledger)
        .await
        .map_err(Error::internal)?;
    Ok(())
}

async fn annotations(pool: &PgPool, hash: &str) -> Result<Vec<Value>, Error> {
    let rows = sqlx::query(
        r#"
        SELECT id, target_type, target_id, priority, body, author_user_id, created_at
        FROM tx_comments
        WHERE tx_hash = $1
        ORDER BY created_at DESC, id DESC
        "#,
    )
    .bind(hash)
    .fetch_all(pool)
    .await
    .map_err(Error::internal)?;
    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.get::<Uuid, _>("id"),
                "target_type": row.get::<String, _>("target_type"),
                "target_id": row.get::<Uuid, _>("target_id"),
                "priority": row.get::<Option<String>, _>("priority"),
                "body": row.get::<Option<String>, _>("body"),
                "author_user_id": row.get::<Uuid, _>("author_user_id"),
                "created_at": row.get::<DateTime<Utc>, _>("created_at")
            })
        })
        .collect())
}

// ---- Search -------------------------------------------------------------------------

const SEARCH_SCOPES: &[&str] = &[
    "all", "from", "to", "function", "contract", "file", "comment", "metric",
];

pub async fn tx_search(
    State(state): State<AppState>,
    Path((network, hash)): Path<(String, String)>,
    Query(q): Query<SearchQuery>,
) -> Result<Json<Value>, Error> {
    if !SEARCH_SCOPES.contains(&q.scope.as_str()) {
        return Err(Error::BadRequest("invalid search scope".into()));
    }
    let detail =
        load_tx_detail(&state.db, &network, &hash, &state.settings.soroban_rpc_url).await?;
    let query = q.q.to_lowercase();
    let mut results = Vec::new();

    if matches!(q.scope.as_str(), "all" | "function" | "contract") {
        for call in detail["call_tree"].as_array().into_iter().flatten() {
            let function = call["function_name"].as_str().unwrap_or("").to_lowercase();
            let contract = call["contract_id"].as_str().unwrap_or("").to_lowercase();
            if (q.scope == "all" && (function.contains(&query) || contract.contains(&query)))
                || (q.scope == "function" && function.contains(&query))
                || (q.scope == "contract" && contract.contains(&query))
            {
                results.push(json!({ "kind": "call", "item": call }));
            }
        }
    }
    if matches!(q.scope.as_str(), "all" | "from" | "to") {
        for edge in detail["fund_flow"].as_array().into_iter().flatten() {
            let from = edge["from"].as_str().unwrap_or("").to_lowercase();
            let to = edge["to"].as_str().unwrap_or("").to_lowercase();
            if (q.scope == "all" && (from.contains(&query) || to.contains(&query)))
                || (q.scope == "from" && from.contains(&query))
                || (q.scope == "to" && to.contains(&query))
            {
                results.push(json!({ "kind": "fund_flow", "item": edge }));
            }
        }
    }
    if matches!(q.scope.as_str(), "all" | "comment") {
        for ann in detail["annotations"].as_array().into_iter().flatten() {
            if ann["body"]
                .as_str()
                .unwrap_or("")
                .to_lowercase()
                .contains(&query)
            {
                results.push(json!({ "kind": "comment", "item": ann }));
            }
        }
    }
    if matches!(q.scope.as_str(), "all" | "metric")
        && let Some(metrics) = detail["resource_usage"].as_object()
    {
        for (name, value) in metrics {
            if name.to_lowercase().contains(&query) {
                results.push(json!({ "kind": "metric", "name": name, "value": value }));
            }
        }
    }

    Ok(Json(json!({ "data": results })))
}

// ---- Ledgers ------------------------------------------------------------------------

pub async fn ledger_detail(
    State(state): State<AppState>,
    Path((network, sequence)): Path<(String, i64)>,
) -> Result<Json<Value>, Error> {
    Ok(Json(load_ledger(&state.db, &network, sequence).await?))
}

pub async fn public_ledger_transactions(
    State(state): State<AppState>,
    Path((network, sequence)): Path<(String, i64)>,
    Query(q): Query<PageQuery>,
) -> Result<Json<Paged<Value>>, Error> {
    let limit = clamp_limit(q.limit);
    let cursor = parse_time_cursor(q.cursor.as_deref())?;
    let page = transaction_page(&state.db, &network, limit, cursor, |sql, binds| {
        binds.push(json!(sequence.to_string()));
        let n = binds.len();
        sql.push_str(&format!(" AND ledger_sequence = ${n}::bigint"));
        Ok(())
    })
    .await?;
    Ok(Json(page))
}

pub async fn latest_ledger(
    State(state): State<AppState>,
    Path(network): Path<String>,
) -> Result<Json<Value>, Error> {
    let seq = sqlx::query_scalar::<_, i64>(
        "SELECT sequence FROM ledgers WHERE network = $1 ORDER BY sequence DESC LIMIT 1",
    )
    .bind(&network)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)?;
    Ok(Json(load_ledger(&state.db, &network, seq).await?))
}

async fn load_ledger(pool: &PgPool, network: &str, sequence: i64) -> Result<Value, Error> {
    let query = || {
        sqlx::query(
            r#"
        SELECT sequence, hash, parent_hash, transaction_count, size_bytes, timestamp,
               base_operation_fee::text, base_reserve::text,
               total_cpu_instructions, resource_limit
        FROM ledgers WHERE network = $1 AND sequence = $2
        "#,
        )
    };
    let mut row = query()
        .bind(network)
        .bind(sequence)
        .fetch_optional(pool)
        .await
        .map_err(Error::internal)?;
    if row.is_none() {
        let base = horizon_url_for_network(network)
            .ok_or_else(|| Error::BadRequest(format!("unsupported explorer network: {network}")))?;
        let body = reqwest::Client::new()
            .get(format!("{base}/ledgers/{sequence}"))
            .send()
            .await
            .map_err(Error::internal)?
            .error_for_status()
            .map_err(|_| Error::NotFound)?
            .json::<Value>()
            .await
            .map_err(Error::internal)?;
        let ledger = decode_ledger(&body, network).map_err(Error::internal)?;
        upsert_ledger(pool, &ledger)
            .await
            .map_err(Error::internal)?;
        row = query()
            .bind(network)
            .bind(sequence)
            .fetch_optional(pool)
            .await
            .map_err(Error::internal)?;
    }
    let row = row.ok_or(Error::NotFound)?;
    let total = row.get::<Option<i64>, _>("total_cpu_instructions");
    let limit = row.get::<Option<i64>, _>("resource_limit");
    let percent = match (total, limit) {
        (Some(t), Some(l)) if l > 0 => Some(((t as f64 / l as f64) * 100.0).round() as i64),
        _ => None,
    };
    Ok(json!({
        "sequence": row.get::<i64, _>("sequence"),
        "hash": row.get::<String, _>("hash"),
        "parent_hash": row.get::<Option<String>, _>("parent_hash"),
        "transaction_count": row.get::<Option<i32>, _>("transaction_count"),
        "size_bytes": row.get::<Option<i32>, _>("size_bytes"),
        "timestamp": row.get::<DateTime<Utc>, _>("timestamp"),
        "base_operation_fee": numeric_str(&row, "base_operation_fee"),
        "base_reserve": numeric_str(&row, "base_reserve"),
        "aggregate_resource_usage": {
            "total_cpu_instructions": total,
            "resource_limit": limit,
            "percent_used": percent
        }
    }))
}

// ---- Project transaction lists ------------------------------------------------------

pub async fn project_transactions(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project)): Path<(String, String)>,
    Query(q): Query<TxListQuery>,
) -> Result<Json<Paged<Value>>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    let limit = clamp_limit(q.limit);
    let cursor = parse_time_cursor(q.cursor.as_deref())?;
    let page = transaction_page(&state.db, &auth.network, limit, cursor, |sql, binds| {
        if let Some(address) = q.address.as_deref() {
            binds.push(json!(address));
            let n = binds.len();
            sql.push_str(&format!(
                " AND (source_account = ${n} OR EXISTS (SELECT 1 FROM tx_fund_flow_edges e WHERE e.tx_hash = transactions.hash AND (e.from_address = ${n} OR e.to_address = ${n})))"
            ));
        }
        if let Some(contract) = q.contract.as_deref() {
            binds.push(json!(contract));
            let n = binds.len();
            sql.push_str(&format!(
                " AND EXISTS (SELECT 1 FROM tx_call_tree_nodes c WHERE c.tx_hash = transactions.hash AND c.contract_id = ${n})"
            ));
        }
        if let Some(function) = q.function.as_deref() {
            binds.push(json!(function));
            let n = binds.len();
            sql.push_str(&format!(
                " AND EXISTS (SELECT 1 FROM tx_call_tree_nodes c WHERE c.tx_hash = transactions.hash AND c.function_name = ${n})"
            ));
        }
        if let Some(kind) = q.tx_type.as_deref() {
            let op = tx_type_to_operation(kind)?;
            binds.push(json!(op));
            let n = binds.len();
            sql.push_str(&format!(" AND operation_type = ${n}"));
        }
        Ok(())
    })
    .await?;
    Ok(Json(page))
}

fn tx_type_to_operation(kind: &str) -> Result<&'static str, Error> {
    match kind {
        "payments" => Ok("payment"),
        "invocations" => Ok("invoke_host_function"),
        "trustline_offer" => Ok("trustline_offer"),
        "token_transfers" => Ok("payment"),
        _ => Err(Error::BadRequest("invalid transaction type filter".into())),
    }
}

async fn transaction_page(
    pool: &PgPool,
    network: &str,
    limit: i64,
    cursor: Option<(DateTime<Utc>, String)>,
    decorate: impl FnOnce(&mut String, &mut Vec<Value>) -> Result<(), Error>,
) -> Result<Paged<Value>, Error> {
    let mut sql = String::from(
        r#"
        SELECT
            hash,
            network,
            ledger_sequence,
            status,
            source_account,
            operation_type,
            timestamp,
            application_order,
            COALESCE((
                SELECT e.to_address
                FROM tx_fund_flow_edges e
                WHERE e.tx_hash = transactions.hash
                ORDER BY e.sequence, e.id
                LIMIT 1
            ), (
                SELECT c.contract_id
                FROM tx_call_tree_nodes c
                WHERE c.tx_hash = transactions.hash
                ORDER BY c.sequence, c.id
                LIMIT 1
            ), operation_target_address) AS destination_account,
            CASE
                WHEN operation_type IN (
                    'manage_data',
                    'set_options',
                    'manage_sell_offer',
                    'manage_buy_offer',
                    'change_trust',
                    'allow_trust',
                    'bump_sequence',
                    'begin_sponsoring_future_reserves',
                    'end_sponsoring_future_reserves',
                    'revoke_sponsorship',
                    'clawback',
                    'clawback_claimable_balance',
                    'set_trust_line_flags',
                    'multi_operation'
                ) THEN source_account
                ELSE NULL
            END AS affected_account,
            CASE
                WHEN EXISTS (SELECT 1 FROM tx_fund_flow_edges e WHERE e.tx_hash = transactions.hash)
                    THEN 'transfer'
                WHEN EXISTS (SELECT 1 FROM tx_call_tree_nodes c WHERE c.tx_hash = transactions.hash)
                    THEN 'contract'
                WHEN operation_target_address IS NOT NULL
                    THEN COALESCE(operation_target_kind, 'entity')
                WHEN operation_type IN (
                    'manage_data', 'set_options', 'manage_sell_offer', 'manage_buy_offer',
                    'change_trust', 'allow_trust', 'bump_sequence',
                    'begin_sponsoring_future_reserves', 'end_sponsoring_future_reserves',
                    'revoke_sponsorship', 'set_trust_line_flags', 'multi_operation'
                ) THEN 'account_effect'
                ELSE 'none'
            END AS target_kind,
            (
                SELECT e.amount::text
                FROM tx_fund_flow_edges e
                WHERE e.tx_hash = transactions.hash
                ORDER BY e.sequence, e.id
                LIMIT 1
            ) AS amount,
            (
                SELECT e.asset
                FROM tx_fund_flow_edges e
                WHERE e.tx_hash = transactions.hash
                ORDER BY e.sequence, e.id
                LIMIT 1
            ) AS asset,
            (
                SELECT count(*)
                FROM tx_call_tree_nodes c
                WHERE c.tx_hash = transactions.hash
            ) AS call_count,
            (
                SELECT c.contract_id
                FROM tx_call_tree_nodes c
                WHERE c.tx_hash = transactions.hash
                ORDER BY c.sequence, c.id
                LIMIT 1
            ) AS root_contract,
            (
                SELECT c.function_name
                FROM tx_call_tree_nodes c
                WHERE c.tx_hash = transactions.hash
                ORDER BY c.sequence, c.id
                LIMIT 1
            ) AS root_function
        FROM transactions
        WHERE network = $1
        "#,
    );
    let mut binds = vec![json!(network)];
    decorate(&mut sql, &mut binds)?;
    if cursor.is_some() {
        sql.push_str(" AND (timestamp, hash) < ($");
        sql.push_str(&(binds.len() + 1).to_string());
        sql.push_str(", $");
        sql.push_str(&(binds.len() + 2).to_string());
        sql.push(')');
    }
    sql.push_str(" ORDER BY timestamp DESC, hash DESC LIMIT $");
    let limit_slot = binds.len() + if cursor.is_some() { 3 } else { 1 };
    sql.push_str(&limit_slot.to_string());

    let mut q = sqlx::query(&sql);
    for bind in binds {
        if let Some(s) = bind.as_str() {
            q = q.bind(s.to_owned());
        }
    }
    let had_cursor = cursor.is_some();
    if let Some((ts, hash)) = cursor {
        q = q.bind(ts).bind(hash);
    }
    let rows = q
        .bind(limit + 1)
        .fetch_all(pool)
        .await
        .map_err(Error::internal)?;
    let mut data = Vec::new();
    let mut cursors = Vec::new();
    for row in rows {
        let ts = row.get::<DateTime<Utc>, _>("timestamp");
        let hash = row.get::<String, _>("hash");
        cursors.push((ts.to_rfc3339(), hash.clone()));
        data.push(json!({
            "hash": hash,
            "network": row.get::<String, _>("network"),
            "ledger": row.get::<i64, _>("ledger_sequence"),
            "status": row.get::<String, _>("status"),
            "source_account": row.get::<String, _>("source_account"),
            "operation_type": row.get::<String, _>("operation_type"),
            "destination_account": row.get::<Option<String>, _>("destination_account"),
            "affected_account": row.get::<Option<String>, _>("affected_account"),
            "target_kind": row.get::<String, _>("target_kind"),
            "amount": row.get::<Option<String>, _>("amount"),
            "asset": row.get::<Option<String>, _>("asset"),
            "call_trace": {
                "count": row.get::<Option<i64>, _>("call_count").unwrap_or(0),
                "root_contract": row.get::<Option<String>, _>("root_contract"),
                "root_function": row.get::<Option<String>, _>("root_function")
            },
            "timestamp": ts,
            "application_order": row.get::<Option<i32>, _>("application_order")
        }));
    }
    Ok(paged_json(data, cursors, limit, had_cursor))
}

// ---- Comments + priority -----------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TargetRef {
    #[serde(rename = "type")]
    pub target_type: String,
    pub id: Uuid,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommentRequest {
    pub target: TargetRef,
    pub text: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PriorityRequest {
    pub target: TargetRef,
    pub level: String,
}

pub async fn add_comment(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, hash)): Path<(String, String, String)>,
    Json(req): Json<CommentRequest>,
) -> Result<Json<Value>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    auth.require_mutation()?;
    ensure_tx(&state.db, &auth.network, &hash).await?;
    validate_target(&state.db, &hash, &req.target).await?;
    if req.text.trim().is_empty() {
        return Err(Error::BadRequest("comment text is required".into()));
    }
    let row = insert_annotation(
        &state.db,
        &hash,
        &req.target.target_type,
        req.target.id,
        None,
        Some(req.text.trim()),
        user_id,
    )
    .await?;
    Ok(Json(row))
}

pub async fn set_priority(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, hash)): Path<(String, String, String)>,
    Json(req): Json<PriorityRequest>,
) -> Result<Json<Value>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    auth.require_mutation()?;
    ensure_tx(&state.db, &auth.network, &hash).await?;
    validate_target(&state.db, &hash, &req.target).await?;
    if !["high", "medium", "low"].contains(&req.level.as_str()) {
        return Err(Error::BadRequest("invalid priority level".into()));
    }
    let row = insert_annotation(
        &state.db,
        &hash,
        &req.target.target_type,
        req.target.id,
        Some(&req.level),
        None,
        user_id,
    )
    .await?;
    Ok(Json(row))
}

async fn insert_annotation(
    pool: &PgPool,
    hash: &str,
    target_type: &str,
    target_id: Uuid,
    priority: Option<&str>,
    body: Option<&str>,
    user_id: Uuid,
) -> Result<Value, Error> {
    let row = sqlx::query(
        r#"
        INSERT INTO tx_comments (tx_hash, target_type, target_id, priority, body, author_user_id)
        VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING id, target_type, target_id, priority, body, author_user_id, created_at
        "#,
    )
    .bind(hash)
    .bind(target_type)
    .bind(target_id)
    .bind(priority)
    .bind(body)
    .bind(user_id)
    .fetch_one(pool)
    .await
    .map_err(Error::internal)?;
    Ok(json!({
        "id": row.get::<Uuid, _>("id"),
        "target_type": row.get::<String, _>("target_type"),
        "target_id": row.get::<Uuid, _>("target_id"),
        "priority": row.get::<Option<String>, _>("priority"),
        "body": row.get::<Option<String>, _>("body"),
        "author_user_id": row.get::<Uuid, _>("author_user_id"),
        "created_at": row.get::<DateTime<Utc>, _>("created_at")
    }))
}

async fn ensure_tx(pool: &PgPool, network: &str, hash: &str) -> Result<(), Error> {
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM transactions WHERE network = $1 AND hash = $2)",
    )
    .bind(network)
    .bind(hash)
    .fetch_one(pool)
    .await
    .map_err(Error::internal)?;
    if exists { Ok(()) } else { Err(Error::NotFound) }
}

async fn validate_target(pool: &PgPool, hash: &str, target: &TargetRef) -> Result<(), Error> {
    let exists: bool = match target.target_type.as_str() {
        "call_node" => sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM tx_call_tree_nodes WHERE tx_hash = $1 AND id = $2)",
        )
        .bind(hash)
        .bind(target.id)
        .fetch_one(pool)
        .await
        .map_err(Error::internal)?,
        "state_change" => sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM tx_state_changes WHERE tx_hash = $1 AND id = $2)",
        )
        .bind(hash)
        .bind(target.id)
        .fetch_one(pool)
        .await
        .map_err(Error::internal)?,
        "event" => sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM tx_events WHERE tx_hash = $1 AND id = $2)",
        )
        .bind(hash)
        .bind(target.id)
        .fetch_one(pool)
        .await
        .map_err(Error::internal)?,
        _ => return Err(Error::BadRequest("invalid annotation target type".into())),
    };
    if exists {
        Ok(())
    } else {
        Err(Error::BadRequest(
            "annotation target does not belong to transaction".into(),
        ))
    }
}

// ---- Accounts ----------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AddEntityRequest {
    pub address: String,
    #[serde(default)]
    pub tags: Vec<Uuid>,
}

pub async fn public_account(
    State(state): State<AppState>,
    Path((network, address)): Path<(String, String)>,
) -> Result<Json<Value>, Error> {
    Ok(Json(
        account_summary(&state.db, None, &network, &address).await?,
    ))
}

pub async fn public_account_transactions(
    State(state): State<AppState>,
    Path((network, address)): Path<(String, String)>,
    Query(q): Query<AccountTxQuery>,
) -> Result<Json<Paged<Value>>, Error> {
    let limit = clamp_limit(q.limit);
    let cursor = parse_time_cursor(q.cursor.as_deref())?;
    let page = transaction_page(&state.db, &network, limit, cursor, |sql, binds| {
        binds.push(json!(address));
        let n = binds.len();
        sql.push_str(&format!(
            " AND (source_account = ${n} OR EXISTS (SELECT 1 FROM tx_fund_flow_edges e WHERE e.tx_hash = transactions.hash AND (e.from_address = ${n} OR e.to_address = ${n})))"
        ));
        if let Some(kind) = q.kind.as_deref() {
            let op = tx_type_to_operation(kind)?;
            binds.push(json!(op));
            let n = binds.len();
            sql.push_str(&format!(" AND operation_type = ${n}"));
        }
        Ok(())
    })
    .await?;
    Ok(Json(page))
}

pub async fn list_accounts(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project)): Path<(String, String)>,
    Query(q): Query<PageQuery>,
) -> Result<Json<Paged<Value>>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    Ok(Json(
        entity_list(&state.db, "wallets", auth.project_id, q).await?,
    ))
}

pub async fn add_account(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project)): Path<(String, String)>,
    Json(req): Json<AddEntityRequest>,
) -> Result<Json<Value>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    auth.require_mutation()?;
    let id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO wallets (project_id, address, network) VALUES ($1,$2,$3) ON CONFLICT (project_id, address) DO UPDATE SET network = EXCLUDED.network RETURNING id",
    )
    .bind(auth.project_id)
    .bind(req.address.trim())
    .bind(&auth.network)
    .fetch_one(&state.db)
    .await
    .map_err(unique_or_conflict)?;
    attach_tags_checked(&state.db, auth.project_id, "wallet", id, &req.tags).await?;
    Ok(Json(
        account_summary(
            &state.db,
            Some(auth.project_id),
            &auth.network,
            req.address.trim(),
        )
        .await?,
    ))
}

pub async fn project_account(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, address)): Path<(String, String, String)>,
) -> Result<Json<Value>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    Ok(Json(
        account_summary(&state.db, Some(auth.project_id), &auth.network, &address).await?,
    ))
}

pub async fn account_transactions(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, address)): Path<(String, String, String)>,
    Query(q): Query<AccountTxQuery>,
) -> Result<Json<Paged<Value>>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    let limit = clamp_limit(q.limit);
    let cursor = parse_time_cursor(q.cursor.as_deref())?;
    let page = transaction_page(&state.db, &auth.network, limit, cursor, |sql, binds| {
        binds.push(json!(address));
        let n = binds.len();
        sql.push_str(&format!(
            " AND (source_account = ${n} OR EXISTS (SELECT 1 FROM tx_fund_flow_edges e WHERE e.tx_hash = transactions.hash AND (e.from_address = ${n} OR e.to_address = ${n})))"
        ));
        if let Some(kind) = q.kind.as_deref() {
            let op = tx_type_to_operation(kind)?;
            binds.push(json!(op));
            let n = binds.len();
            sql.push_str(&format!(" AND operation_type = ${n}"));
        }
        Ok(())
    })
    .await?;
    Ok(Json(page))
}

async fn account_summary(
    pool: &PgPool,
    project_id: Option<Uuid>,
    network: &str,
    address: &str,
) -> Result<Value, Error> {
    let tracked = match project_id {
        Some(project_id) => sqlx::query("SELECT id, last_synced_at FROM wallets WHERE project_id = $1 AND address = $2")
            .bind(project_id)
            .bind(address)
            .fetch_optional(pool)
            .await
            .map_err(Error::internal)?,
        None => sqlx::query("SELECT id, last_synced_at FROM wallets WHERE network = $1 AND address = $2 ORDER BY last_synced_at DESC NULLS LAST LIMIT 1")
            .bind(network)
            .bind(address)
            .fetch_optional(pool)
            .await
            .map_err(Error::internal)?,
    };
    let wallet_id = tracked.as_ref().map(|r| r.get::<Uuid, _>("id"));
    let tags = match (project_id, wallet_id) {
        (Some(project_id), Some(id)) => entity_tags(pool, project_id, "wallet", id).await?,
        _ => Vec::new(),
    };
    let mut xlm = latest_holding(pool, network, address, "XLM").await?;
    if xlm.as_ref().is_none_or(|(balance, _)| balance.is_empty())
        && let Ok(balance) = fetch_horizon_xlm_balance(network, address).await
    {
        xlm = Some((balance, None));
    }
    let token_holdings = holdings(pool, network, address).await?;
    Ok(json!({
        "address": address,
        "network": network,
        "tracked": wallet_id.is_some(),
        "xlm_balance": xlm.as_ref().map(|h| h.0.clone()),
        "usd_value": xlm.and_then(|h| h.1),
        "token_holdings": token_holdings,
        "tags": tags,
        "source_map_status": "not_available"
    }))
}

async fn fetch_horizon_xlm_balance(network: &str, address: &str) -> Result<String, Error> {
    let base = horizon_url_for_network(network)
        .ok_or_else(|| Error::BadRequest(format!("unsupported explorer network: {network}")))?;
    let body = reqwest::Client::new()
        .get(format!("{base}/accounts/{address}"))
        .send()
        .await
        .map_err(Error::internal)?
        .error_for_status()
        .map_err(Error::internal)?
        .json::<Value>()
        .await
        .map_err(Error::internal)?;
    body.get("balances")
        .and_then(Value::as_array)
        .and_then(|balances| {
            balances.iter().find_map(|balance| {
                (balance.get("asset_type").and_then(Value::as_str) == Some("native"))
                    .then(|| {
                        balance
                            .get("balance")
                            .and_then(Value::as_str)
                            .map(String::from)
                    })
                    .flatten()
            })
        })
        .ok_or_else(|| Error::NotFound)
}

async fn latest_holding(
    pool: &PgPool,
    network: &str,
    address: &str,
    asset: &str,
) -> Result<Option<(String, Option<String>)>, Error> {
    let row = sqlx::query(
        r#"
        SELECT (value->>'balance') AS balance,
               CASE WHEN p.price_usd IS NULL OR value->>'balance' IS NULL
                    THEN NULL
                    ELSE ((value->>'balance')::numeric * p.price_usd)::text
               END AS usd_value
        FROM entity_snapshots s
        LEFT JOIN token_prices p ON p.network = s.network AND p.asset = $3
        WHERE s.network = $1
          AND s.entry_type IN ('account','trustline')
          AND s.entry_key LIKE '%' || $2 || '%'
          AND ($3 = 'XLM' OR s.entry_key LIKE '%' || $3 || '%')
        ORDER BY s.updated_at DESC
        LIMIT 1
        "#,
    )
    .bind(network)
    .bind(address)
    .bind(asset)
    .fetch_optional(pool)
    .await
    .map_err(Error::internal)?;
    Ok(row.map(|r| {
        (
            r.get::<Option<String>, _>("balance").unwrap_or_default(),
            r.get::<Option<String>, _>("usd_value"),
        )
    }))
}

async fn holdings(pool: &PgPool, network: &str, address: &str) -> Result<Vec<Value>, Error> {
    let rows = sqlx::query(
        r#"
        SELECT COALESCE(value->>'asset', 'XLM') AS asset,
               value->>'balance' AS balance,
               CASE WHEN p.price_usd IS NULL OR value->>'balance' IS NULL
                    THEN NULL
                    ELSE ((value->>'balance')::numeric * p.price_usd)::text
               END AS usd_value
        FROM entity_snapshots s
        LEFT JOIN token_prices p ON p.network = s.network AND p.asset = COALESCE(value->>'asset', 'XLM')
        WHERE s.network = $1
          AND s.entry_type IN ('account','trustline')
          AND s.entry_key LIKE '%' || $2 || '%'
        ORDER BY asset ASC
        "#,
    )
    .bind(network)
    .bind(address)
    .fetch_all(pool)
    .await
    .map_err(Error::internal)?;
    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "asset": row.get::<String, _>("asset"),
                "balance": row.get::<Option<String>, _>("balance"),
                "usd_value": row.get::<Option<String>, _>("usd_value")
            })
        })
        .collect())
}

// ---- Contracts ---------------------------------------------------------------------

pub async fn public_contract(
    State(state): State<AppState>,
    Path((network, address)): Path<(String, String)>,
) -> Result<Json<Value>, Error> {
    Ok(Json(
        contract_summary(&state.db, None, &network, &address).await?,
    ))
}

pub async fn list_contracts(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project)): Path<(String, String)>,
    Query(q): Query<PageQuery>,
) -> Result<Json<Paged<Value>>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    Ok(Json(
        entity_list(&state.db, "contracts", auth.project_id, q).await?,
    ))
}

pub async fn add_contract(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project)): Path<(String, String)>,
    Json(req): Json<AddEntityRequest>,
) -> Result<Json<Value>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    auth.require_mutation()?;
    let id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO contracts (project_id, address, network) VALUES ($1,$2,$3) ON CONFLICT (project_id, address) DO UPDATE SET network = EXCLUDED.network RETURNING id",
    )
    .bind(auth.project_id)
    .bind(req.address.trim())
    .bind(&auth.network)
    .fetch_one(&state.db)
    .await
    .map_err(unique_or_conflict)?;
    attach_tags_checked(&state.db, auth.project_id, "contract", id, &req.tags).await?;
    Ok(Json(
        contract_summary(
            &state.db,
            Some(auth.project_id),
            &auth.network,
            req.address.trim(),
        )
        .await?,
    ))
}

pub async fn project_contract(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, address)): Path<(String, String, String)>,
) -> Result<Json<Value>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    Ok(Json(
        contract_summary(&state.db, Some(auth.project_id), &auth.network, &address).await?,
    ))
}

async fn contract_summary(
    pool: &PgPool,
    project_id: Option<Uuid>,
    network: &str,
    address: &str,
) -> Result<Value, Error> {
    let row = match project_id {
        Some(project_id) => sqlx::query(
            r#"
            SELECT id, contract_type, deployment_tx_hash, deployment_timestamp,
                   verification_status, verification_type, verified_at,
                   rust_version, soroban_sdk_version, wasm_target, opt_level,
                   wasm_opt_applied, debug_symbols_present, current_wasm_hash
            FROM contracts WHERE project_id = $1 AND address = $2
            "#,
        )
        .bind(project_id)
        .bind(address)
        .fetch_optional(pool)
        .await
        .map_err(Error::internal)?,
        None => sqlx::query(
            r#"
            SELECT id, contract_type, deployment_tx_hash, deployment_timestamp,
                   verification_status, verification_type, verified_at,
                   rust_version, soroban_sdk_version, wasm_target, opt_level,
                   wasm_opt_applied, debug_symbols_present, current_wasm_hash
            FROM contracts WHERE network = $1 AND address = $2
            ORDER BY last_synced_at DESC NULLS LAST LIMIT 1
            "#,
        )
        .bind(network)
        .bind(address)
        .fetch_optional(pool)
        .await
        .map_err(Error::internal)?,
    };

    let tags = match (project_id, row.as_ref().map(|r| r.get::<Uuid, _>("id"))) {
        (Some(project_id), Some(id)) => entity_tags(pool, project_id, "contract", id).await?,
        _ => Vec::new(),
    };
    Ok(match row {
        Some(row) => json!({
            "address": address,
            "network": network,
            "tracked": true,
            "type": row.get::<String, _>("contract_type"),
            "deployment": {
                "tx_hash": row.get::<Option<String>, _>("deployment_tx_hash"),
                "timestamp": row.get::<Option<DateTime<Utc>>, _>("deployment_timestamp")
            },
            "verification": {
                "status": row.get::<String, _>("verification_status"),
                "type": row.get::<Option<String>, _>("verification_type"),
                "timestamp": row.get::<Option<DateTime<Utc>>, _>("verified_at")
            },
            "toolchain": {
                "rust_version": row.get::<Option<String>, _>("rust_version"),
                "soroban_sdk_version": row.get::<Option<String>, _>("soroban_sdk_version"),
                "wasm_target": row.get::<Option<String>, _>("wasm_target"),
                "opt_level": row.get::<Option<String>, _>("opt_level"),
                "wasm_opt_applied": row.get::<Option<bool>, _>("wasm_opt_applied"),
                "debug_symbols_present": row.get::<bool, _>("debug_symbols_present")
            },
            "current_wasm_hash": row.get::<Option<String>, _>("current_wasm_hash"),
            "source_map_status": "not_available",
            "tags": tags
        }),
        None => json!({
            "address": address,
            "network": network,
            "tracked": false,
            "type": "contract",
            "verification": { "status": "unverified", "type": null, "timestamp": null },
            "toolchain": {
                "rust_version": null, "soroban_sdk_version": null, "wasm_target": null,
                "opt_level": null, "wasm_opt_applied": null, "debug_symbols_present": false
            },
            "source_map_status": "not_available",
            "tags": tags
        }),
    })
}

pub async fn public_contract_transactions(
    State(state): State<AppState>,
    Path((network, address)): Path<(String, String)>,
    Query(q): Query<PageQuery>,
) -> Result<Json<Paged<Value>>, Error> {
    Ok(Json(
        contract_transaction_page(&state.db, &network, &address, q).await?,
    ))
}

pub async fn contract_transactions(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, address)): Path<(String, String, String)>,
    Query(q): Query<PageQuery>,
) -> Result<Json<Paged<Value>>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    Ok(Json(
        contract_transaction_page(&state.db, &auth.network, &address, q).await?,
    ))
}

async fn contract_transaction_page(
    pool: &PgPool,
    network: &str,
    address: &str,
    q: PageQuery,
) -> Result<Paged<Value>, Error> {
    let limit = clamp_limit(q.limit);
    let cursor = parse_time_cursor(q.cursor.as_deref())?;
    transaction_page(pool, network, limit, cursor, |sql, binds| {
        binds.push(json!(address));
        let n = binds.len();
        sql.push_str(&format!(
            " AND EXISTS (SELECT 1 FROM tx_call_tree_nodes c WHERE c.tx_hash = transactions.hash AND c.contract_id = ${n})"
        ));
        Ok(())
    })
    .await
}

pub async fn public_contract_events(
    State(state): State<AppState>,
    Path((network, address)): Path<(String, String)>,
    Query(q): Query<EventQuery>,
) -> Result<Json<Paged<Value>>, Error> {
    Ok(Json(
        contract_event_page(&state.db, &network, &address, q).await?,
    ))
}

pub async fn contract_events(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, address)): Path<(String, String, String)>,
    Query(q): Query<EventQuery>,
) -> Result<Json<Paged<Value>>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    Ok(Json(
        contract_event_page(&state.db, &auth.network, &address, q).await?,
    ))
}

async fn contract_event_page(
    pool: &PgPool,
    network: &str,
    address: &str,
    q: EventQuery,
) -> Result<Paged<Value>, Error> {
    let limit = clamp_limit(q.limit);
    let cursor = parse_seq_cursor(q.cursor.as_deref())?;
    let mut sql = String::from(
        r#"
        SELECT e.id, e.tx_hash, e.contract_id, e.topics, e.data, e.caused_by_node_id,
               e.sequence, e.event_type, e.successful, e.stage,
               t.ledger_sequence, t.timestamp
        FROM tx_events e
        JOIN transactions t ON t.hash = e.tx_hash
        WHERE t.network = $1 AND e.contract_id = $2
        "#,
    );
    if q.event_type.is_some() {
        sql.push_str(" AND e.topics::text ILIKE '%' || $3 || '%'");
    }
    let mut next = if q.event_type.is_some() { 4 } else { 3 };
    if let Some(from) = q.from_ledger {
        sql.push_str(&format!(" AND t.ledger_sequence >= ${next}"));
        next += 1;
        let _ = from;
    }
    if let Some(to) = q.to_ledger {
        sql.push_str(&format!(" AND t.ledger_sequence <= ${next}"));
        next += 1;
        let _ = to;
    }
    if cursor.is_some() {
        sql.push_str(&format!(
            " AND (t.ledger_sequence, e.id::text) < (${next}, ${})",
            next + 1
        ));
        next += 2;
    }
    sql.push_str(&format!(
        " ORDER BY t.ledger_sequence DESC, e.id DESC LIMIT ${next}"
    ));

    let mut query = sqlx::query(&sql).bind(network).bind(address);
    if let Some(kind) = &q.event_type {
        query = query.bind(kind);
    }
    if let Some(from) = q.from_ledger {
        query = query.bind(from);
    }
    if let Some(to) = q.to_ledger {
        query = query.bind(to);
    }
    let had_cursor = cursor.is_some();
    if let Some((seq, id)) = cursor {
        query = query.bind(seq).bind(id);
    }
    let rows = query
        .bind(limit + 1)
        .fetch_all(pool)
        .await
        .map_err(Error::internal)?;
    let mut data = Vec::new();
    let mut cursors = Vec::new();
    for row in rows {
        let seq = row.get::<i64, _>("ledger_sequence");
        let id = row.get::<Uuid, _>("id");
        cursors.push((seq.to_string(), id.to_string()));
        data.push(json!({
            "id": id,
            "tx_hash": row.get::<String, _>("tx_hash"),
            "contract_id": row.get::<String, _>("contract_id"),
            "topics": row.get::<Value, _>("topics"),
            "data": row.get::<Value, _>("data"),
            "caused_by_call": row.get::<Option<Uuid>, _>("caused_by_node_id"),
            "sequence": row.get::<i32, _>("sequence"),
            "event_type": row.get::<String, _>("event_type"),
            "successful": row.get::<Option<bool>, _>("successful"),
            "stage": row.get::<Option<String>, _>("stage"),
            "ledger": seq,
            "timestamp": row.get::<DateTime<Utc>, _>("timestamp")
        }));
    }
    Ok(paged_json(data, cursors, limit, had_cursor))
}

pub async fn contract_source(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, address)): Path<(String, String, String)>,
) -> Result<Json<Value>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    let contract_id = contract_id(&state.db, auth.project_id, &address).await?;
    let row = sqlx::query(
        r#"
        SELECT source_archive_url, compiler_settings, spec_xdr, creation_wasm_ref,
               deployed_wasm_ref, source_map_ref, source_map_status
        FROM contract_source WHERE contract_id = $1
        "#,
    )
    .bind(contract_id)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?;
    Ok(Json(match row {
        Some(row) => json!({
            "source_archive_url": row.get::<Option<String>, _>("source_archive_url"),
            "compiler_settings": row.get::<Option<Value>, _>("compiler_settings"),
            "spec_xdr": row.get::<Option<String>, _>("spec_xdr"),
            "creation_wasm_ref": row.get::<Option<String>, _>("creation_wasm_ref"),
            "deployed_wasm_ref": row.get::<Option<String>, _>("deployed_wasm_ref"),
            "source_map_ref": row.get::<Option<String>, _>("source_map_ref"),
            "source_map_status": row.get::<String, _>("source_map_status")
        }),
        None => json!({
            "source_archive_url": null,
            "compiler_settings": null,
            "spec_xdr": null,
            "creation_wasm_ref": null,
            "deployed_wasm_ref": null,
            "source_map_ref": null,
            "source_map_status": "not_available"
        }),
    }))
}

pub async fn contract_upgrades(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, address)): Path<(String, String, String)>,
) -> Result<Json<Value>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    let contract_id = contract_id(&state.db, auth.project_id, &address).await?;
    let rows = sqlx::query(
        "SELECT id, wasm_hash, tx_hash, effective_at FROM contract_wasm_history WHERE contract_id = $1 ORDER BY effective_at DESC, id DESC",
    )
    .bind(contract_id)
    .fetch_all(&state.db)
    .await
    .map_err(Error::internal)?;
    Ok(Json(json!({
        "data": rows.into_iter().map(|row| json!({
            "id": row.get::<Uuid, _>("id"),
            "wasm_hash": row.get::<String, _>("wasm_hash"),
            "tx_hash": row.get::<String, _>("tx_hash"),
            "effective_at": row.get::<DateTime<Utc>, _>("effective_at")
        })).collect::<Vec<_>>()
    })))
}

async fn contract_id(pool: &PgPool, project_id: Uuid, address: &str) -> Result<Uuid, Error> {
    sqlx::query_scalar("SELECT id FROM contracts WHERE project_id = $1 AND address = $2")
        .bind(project_id)
        .bind(address)
        .fetch_optional(pool)
        .await
        .map_err(Error::internal)?
        .ok_or(Error::NotFound)
}

// ---- Verification -------------------------------------------------------------------

pub async fn upload_verification_source(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, address)): Path<(String, String, String)>,
    bytes: Bytes,
) -> Result<(StatusCode, Json<Value>), Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    auth.require_mutation()?;
    contract_id(&state.db, auth.project_id, &address).await?;
    if bytes.is_empty() || bytes.len() > 50 * 1024 * 1024 {
        return Err(Error::BadRequest(
            "source archive must be a non-empty ZIP up to 50 MiB".into(),
        ));
    }
    let uploaded = source_lens(&state)?
        .create_upload(&source_lens_actor(user_id, &auth, Uuid::new_v4()), &bytes)
        .await
        .map_err(map_source_lens)?;
    Ok((StatusCode::CREATED, Json(uploaded)))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VerifyRequest {
    pub visibility: String,
    #[serde(default)]
    pub source: Option<Value>,
    #[serde(default)]
    pub source_archive_url: Option<String>,
    #[serde(default = "default_recipe_id")]
    pub recipe_id: String,
}

fn default_recipe_id() -> String {
    "rust-soroban-1".into()
}

pub async fn submit_verification(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, address)): Path<(String, String, String)>,
    headers: HeaderMap,
    Json(req): Json<VerifyRequest>,
) -> Result<(StatusCode, Json<Value>), Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    auth.require_mutation()?;
    if !["public", "private"].contains(&req.visibility.as_str()) {
        return Err(Error::BadRequest("invalid verification visibility".into()));
    }
    let source = req.source.ok_or_else(|| {
        if req.source_archive_url.is_some() {
            Error::BadRequest(
                "mutable source_archive_url submissions are retired; submit an immutable GitHub commit or SourceLens upload_id".into(),
            )
        } else {
            Error::BadRequest("source is required".into())
        }
    })?;
    if req.recipe_id.trim().is_empty() || req.recipe_id.len() > 128 {
        return Err(Error::BadRequest("invalid build recipe".into()));
    }
    let contract = sqlx::query(
        "SELECT id,current_wasm_hash FROM contracts WHERE project_id=$1 AND address=$2",
    )
    .bind(auth.project_id)
    .bind(&address)
    .fetch_optional(&state.db)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)?;
    let contract_id = contract.get::<Uuid, _>("id");
    let wasm_hash = contract
        .get::<Option<String>, _>("current_wasm_hash")
        .ok_or_else(|| Error::BadRequest("contract Wasm hash is not indexed yet".into()))?;
    let idempotency_key = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty() && value.len() <= 128)
        .map(str::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let request_id = Uuid::new_v4();
    let accepted = source_lens(&state)?
        .create_verification(
            &source_lens_actor(user_id, &auth, request_id),
            &idempotency_key,
            &json!({
                "network": &auth.network,
                "contract_id": &address,
                "wasm_hash": &wasm_hash,
                "visibility": &req.visibility,
                "source": &source,
                "recipe_id": &req.recipe_id,
            }),
        )
        .await
        .map_err(map_source_lens)?;
    let source_lens_id = accepted
        .verification_id
        .ok_or_else(|| Error::ServiceUnavailable("source_lens_invalid_response".into()))?;
    let id = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO contract_verifications
            (contract_id, submitted_by, visibility, source_archive_url,
             source_lens_verification_id, source_lens_job_id, source_lens_status,
             source_input, recipe_id, legacy_claim)
        VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,false)
        ON CONFLICT (source_lens_verification_id) WHERE source_lens_verification_id IS NOT NULL
        DO UPDATE SET source_lens_job_id=EXCLUDED.source_lens_job_id
        RETURNING id
        "#,
    )
    .bind(contract_id)
    .bind(user_id)
    .bind(&req.visibility)
    .bind(source_lens_id)
    .bind(accepted.job_id)
    .bind(&accepted.status)
    .bind(&source)
    .bind(req.recipe_id.trim())
    .fetch_one(&state.db)
    .await
    .map_err(Error::internal)?;
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({
            "verification_id": id,
            "status": "submitted",
            "source_lens": {
                "verification_id": source_lens_id,
                "job_id": accepted.job_id,
                "status": accepted.status,
                "created": accepted.created
            }
        })),
    ))
}

pub async fn verification_history(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, address)): Path<(String, String, String)>,
    Query(q): Query<PageQuery>,
) -> Result<Json<Paged<Value>>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    let contract_id = contract_id(&state.db, auth.project_id, &address).await?;
    if let Some(client) = &state.source_lens {
        match client
            .list_verifications(&source_lens_actor(user_id, &auth, Uuid::new_v4()))
            .await
        {
            Ok(remote) => {
                for verification in remote
                    .get("data")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    let Some(remote_id) = verification
                        .get("id")
                        .and_then(Value::as_str)
                        .and_then(|value| Uuid::parse_str(value).ok())
                    else {
                        continue;
                    };
                    let remote_status = verification
                        .get("status")
                        .and_then(Value::as_str)
                        .unwrap_or("failed");
                    let capabilities = verification
                        .get("capabilities")
                        .cloned()
                        .unwrap_or_else(|| json!({}));
                    let compatibility_status = match remote_status {
                        "queued" => "submitted",
                        "running" => "compiling",
                        "succeeded" => "verified",
                        _ => "failed",
                    };
                    sqlx::query(
                        r#"
                        UPDATE contract_verifications v
                        SET source_lens_status=$2, status=$3, capability_summary=$4,
                            built_wasm_hash=$5, failure_reason=$6,
                            source_lens_synced_at=now(),
                            completed_at=CASE WHEN $2 IN ('succeeded','failed','cancelled','dead_letter')
                                              THEN COALESCE(completed_at,now()) ELSE completed_at END
                        FROM contracts c
                        WHERE v.contract_id=c.id AND c.project_id=$1
                          AND v.source_lens_verification_id=$7
                        "#,
                    )
                    .bind(auth.project_id)
                    .bind(remote_status)
                    .bind(compatibility_status)
                    .bind(&capabilities)
                    .bind(verification.get("built_wasm_hash").and_then(Value::as_str))
                    .bind(verification.get("failure_code").and_then(Value::as_str))
                    .bind(remote_id)
                    .execute(&state.db)
                    .await
                    .map_err(Error::internal)?;
                }
                if let Some(capabilities) =
                    remote
                        .get("data")
                        .and_then(Value::as_array)
                        .and_then(|items| {
                            items.iter().find_map(|item| {
                                (item.get("contract_id").and_then(Value::as_str)
                                    == Some(address.as_str()))
                                .then(|| item.get("capabilities").cloned())
                                .flatten()
                            })
                        })
                {
                    sqlx::query(
                        "UPDATE contracts SET source_lens_capabilities=$2,source_lens_synced_at=now() WHERE id=$1",
                    )
                    .bind(contract_id)
                    .bind(capabilities)
                    .execute(&state.db)
                    .await
                    .map_err(Error::internal)?;
                }
            }
            Err(error) => {
                tracing::warn!(%error, "could not refresh SourceLens verification summaries")
            }
        }
    }
    let limit = clamp_limit(q.limit);
    let cursor = parse_time_cursor(q.cursor.as_deref())?;
    let mut sql = String::from(
        r#"
        SELECT id, visibility, status, source_archive_url, rust_version,
               soroban_sdk_version, wasm_target, opt_level, wasm_opt_applied,
               built_wasm_hash, failure_reason, created_at, completed_at,
               source_lens_verification_id, source_lens_job_id, source_lens_status,
               capability_summary, source_input, recipe_id, source_lens_synced_at, legacy_claim
        FROM contract_verifications
        WHERE contract_id = $1
        "#,
    );
    if cursor.is_some() {
        sql.push_str(" AND (created_at, id::text) < ($2, $3)");
    }
    sql.push_str(if cursor.is_some() {
        " ORDER BY created_at DESC, id DESC LIMIT $4"
    } else {
        " ORDER BY created_at DESC, id DESC LIMIT $2"
    });
    let mut query = sqlx::query(&sql).bind(contract_id);
    let had_cursor = cursor.is_some();
    if let Some((ts, id)) = cursor {
        query = query.bind(ts).bind(id);
    }
    let rows = query
        .bind(limit + 1)
        .fetch_all(&state.db)
        .await
        .map_err(Error::internal)?;
    let mut data = Vec::new();
    let mut cursors = Vec::new();
    for row in rows {
        let id = row.get::<Uuid, _>("id");
        let ts = row.get::<DateTime<Utc>, _>("created_at");
        cursors.push((ts.to_rfc3339(), id.to_string()));
        data.push(json!({
            "id": id,
            "visibility": row.get::<String, _>("visibility"),
            "status": row.get::<String, _>("status"),
            "source_archive_url": row.get::<Option<String>, _>("source_archive_url"),
            "toolchain": {
                "rust_version": row.get::<Option<String>, _>("rust_version"),
                "soroban_sdk_version": row.get::<Option<String>, _>("soroban_sdk_version"),
                "wasm_target": row.get::<Option<String>, _>("wasm_target"),
                "opt_level": row.get::<Option<String>, _>("opt_level"),
                "wasm_opt_applied": row.get::<Option<bool>, _>("wasm_opt_applied")
            },
            "built_wasm_hash": row.get::<Option<String>, _>("built_wasm_hash"),
            "failure_reason": row.get::<Option<String>, _>("failure_reason"),
            "source_lens_verification_id": row.get::<Option<Uuid>, _>("source_lens_verification_id"),
            "source_lens_job_id": row.get::<Option<Uuid>, _>("source_lens_job_id"),
            "source_lens_status": row.get::<Option<String>, _>("source_lens_status"),
            "capabilities": row.get::<Value, _>("capability_summary"),
            "source": row.get::<Option<Value>, _>("source_input"),
            "recipe_id": row.get::<Option<String>, _>("recipe_id"),
            "source_lens_synced_at": row.get::<Option<DateTime<Utc>>, _>("source_lens_synced_at"),
            "legacy_claim": row.get::<bool, _>("legacy_claim"),
            "created_at": ts,
            "completed_at": row.get::<Option<DateTime<Utc>>, _>("completed_at")
        }));
    }
    Ok(Json(paged_json(data, cursors, limit, had_cursor)))
}

/// Verification worker seam used by tests and future async job runners.
pub async fn complete_verification(
    pool: &PgPool,
    verification_id: Uuid,
    built_wasm_hash: &str,
) -> Result<Value, Error> {
    let row = sqlx::query(
        r#"
        SELECT v.contract_id, v.visibility, c.current_wasm_hash
        FROM contract_verifications v
        JOIN contracts c ON c.id = v.contract_id
        WHERE v.id = $1
        "#,
    )
    .bind(verification_id)
    .fetch_optional(pool)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)?;
    let contract_id = row.get::<Uuid, _>("contract_id");
    let expected = row.get::<Option<String>, _>("current_wasm_hash");
    let visibility = row.get::<String, _>("visibility");
    let verified = expected.as_deref() == Some(built_wasm_hash);
    let status = if verified { "verified" } else { "failed" };
    let failure = if verified {
        None
    } else {
        Some("built wasm hash does not match deployed contract")
    };

    let mut tx = pool.begin().await.map_err(Error::internal)?;
    sqlx::query(
        "UPDATE contract_verifications SET status = $2, built_wasm_hash = $3, failure_reason = $4, completed_at = now() WHERE id = $1",
    )
    .bind(verification_id)
    .bind(status)
    .bind(built_wasm_hash)
    .bind(failure)
    .execute(&mut *tx)
    .await
    .map_err(Error::internal)?;
    if verified {
        sqlx::query(
            r#"
            UPDATE contracts
            SET verification_status = 'verified', verification_type = $2, verified_at = now()
            WHERE id = $1
            "#,
        )
        .bind(contract_id)
        .bind(visibility)
        .execute(&mut *tx)
        .await
        .map_err(Error::internal)?;
    }
    tx.commit().await.map_err(Error::internal)?;
    Ok(
        json!({ "verification_id": verification_id, "status": status, "built_wasm_hash": built_wasm_hash, "failure_reason": failure }),
    )
}

// ---- Contract call ------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContractCallRequest {
    pub function_name: String,
    #[serde(default)]
    pub args: Vec<Value>,
}

pub async fn contract_call(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, address)): Path<(String, String, String)>,
    Query(mode): Query<CallMode>,
    Json(req): Json<ContractCallRequest>,
) -> Result<Json<Value>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    contract_id(&state.db, auth.project_id, &address).await?;
    if req.function_name.trim().is_empty() {
        return Err(Error::BadRequest("function_name is required".into()));
    }
    match mode.mode.as_str() {
        "simulate" => simulate_contract_call(&state, &auth.network, &address, &req).await,
        "run" => {
            auth.require_mutation()?;
            let signer = sqlx::query("SELECT id, public_key FROM project_signers WHERE project_id = $1 AND network = $2 ORDER BY created_at DESC LIMIT 1")
                .bind(auth.project_id)
                .bind(&auth.network)
                .fetch_optional(&state.db)
                .await
                .map_err(Error::internal)?
                .ok_or(Error::SignerNotConfigured)?;
            Ok(Json(json!({
                "mode": "run",
                "submitted": true,
                "network": auth.network,
                "contract_id": address,
                "function_name": req.function_name,
                "args": req.args,
                "signer_id": signer.get::<Uuid, _>("id"),
                "signer_public_key": signer.get::<String, _>("public_key"),
                "submit_status": "stubbed"
            })))
        }
        _ => Err(Error::BadRequest("invalid call mode".into())),
    }
}

async fn simulate_contract_call(
    state: &AppState,
    network: &str,
    address: &str,
    req: &ContractCallRequest,
) -> Result<Json<Value>, Error> {
    if state.settings.soroban_rpc_url.trim().is_empty() {
        return Err(Error::ServiceUnavailable("soroban_rpc".into()));
    }
    let client = reqwest::Client::new();
    let rpc_req = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "simulateTransaction",
        "params": {
            "network": network,
            "contract_id": address,
            "function_name": req.function_name,
            "args": req.args
        }
    });
    let body: Value = client
        .post(&state.settings.soroban_rpc_url)
        .json(&rpc_req)
        .send()
        .await
        .map_err(Error::internal)?
        .json()
        .await
        .map_err(Error::internal)?;
    if let Some(error) = body.get("error") {
        return Ok(Json(
            json!({ "mode": "simulate", "status": "error", "rpc_error": error }),
        ));
    }
    Ok(Json(json!({
        "mode": "simulate",
        "status": "success",
        "network": network,
        "contract_id": address,
        "function_name": req.function_name,
        "args": req.args,
        "result": body.get("result").cloned().unwrap_or(Value::Null),
        "source_map_status": "not_available"
    })))
}

// ---- Tags ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateTagRequest {
    pub name: String,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AttachTagRequest {
    pub entity_type: String,
    pub entity_id: Uuid,
}

pub async fn list_tags(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project)): Path<(String, String)>,
    Query(q): Query<PageQuery>,
) -> Result<Json<Paged<Value>>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    let limit = clamp_limit(q.limit);
    let cursor = parse_text_cursor(q.cursor.as_deref())?;
    let mut sql = String::from("SELECT id, name, color FROM tags WHERE project_id = $1");
    if cursor.is_some() {
        sql.push_str(" AND (name, id::text) > ($2, $3) ORDER BY name ASC, id ASC LIMIT $4");
    } else {
        sql.push_str(" ORDER BY name ASC, id ASC LIMIT $2");
    }
    let mut query = sqlx::query(&sql).bind(auth.project_id);
    let had_cursor = cursor.is_some();
    if let Some((name, id)) = cursor {
        query = query.bind(name).bind(id);
    }
    let rows = query
        .bind(limit + 1)
        .fetch_all(&state.db)
        .await
        .map_err(Error::internal)?;
    let mut data = Vec::new();
    let mut cursors = Vec::new();
    for row in rows {
        let id = row.get::<Uuid, _>("id");
        let name = row.get::<String, _>("name");
        cursors.push((name.clone(), id.to_string()));
        data.push(
            json!({ "id": id, "name": name, "color": row.get::<Option<String>, _>("color") }),
        );
    }
    Ok(Json(paged_json(data, cursors, limit, had_cursor)))
}

pub async fn create_tag(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project)): Path<(String, String)>,
    Json(req): Json<CreateTagRequest>,
) -> Result<Json<Value>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    auth.require_mutation()?;
    if req.name.trim().is_empty() {
        return Err(Error::BadRequest("tag name is required".into()));
    }
    let row = sqlx::query(
        "INSERT INTO tags (project_id, name, color) VALUES ($1,$2,$3) RETURNING id, name, color",
    )
    .bind(auth.project_id)
    .bind(req.name.trim())
    .bind(req.color.as_deref())
    .fetch_one(&state.db)
    .await
    .map_err(unique_or_conflict)?;
    Ok(Json(json!({
        "id": row.get::<Uuid, _>("id"),
        "name": row.get::<String, _>("name"),
        "color": row.get::<Option<String>, _>("color")
    })))
}

pub async fn update_tag(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, tag_id)): Path<(String, String, Uuid)>,
    Json(req): Json<CreateTagRequest>,
) -> Result<Json<Value>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    auth.require_mutation()?;
    if req.name.trim().is_empty() {
        return Err(Error::BadRequest("tag name is required".into()));
    }
    let row = sqlx::query(
        r#"
        UPDATE tags SET name = $3, color = $4
        WHERE project_id = $1 AND id = $2
        RETURNING id, name, color
        "#,
    )
    .bind(auth.project_id)
    .bind(tag_id)
    .bind(req.name.trim())
    .bind(req.color.as_deref())
    .fetch_optional(&state.db)
    .await
    .map_err(unique_or_conflict)?
    .ok_or(Error::NotFound)?;
    Ok(Json(json!({
        "id": row.get::<Uuid, _>("id"),
        "name": row.get::<String, _>("name"),
        "color": row.get::<Option<String>, _>("color")
    })))
}

pub async fn delete_tag(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, tag_id)): Path<(String, String, Uuid)>,
) -> Result<Json<Value>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    auth.require_mutation()?;
    let gone = sqlx::query("DELETE FROM tags WHERE project_id = $1 AND id = $2")
        .bind(auth.project_id)
        .bind(tag_id)
        .execute(&state.db)
        .await
        .map_err(Error::internal)?
        .rows_affected();
    if gone == 0 {
        return Err(Error::NotFound);
    }
    Ok(Json(json!({ "deleted": true })))
}

pub async fn attach_tag(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, tag_id)): Path<(String, String, Uuid)>,
    Json(req): Json<AttachTagRequest>,
) -> Result<Json<Value>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    auth.require_mutation()?;
    attach_tags_checked(
        &state.db,
        auth.project_id,
        &req.entity_type,
        req.entity_id,
        &[tag_id],
    )
    .await?;
    Ok(Json(json!({ "attached": true })))
}

pub async fn detach_tag(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, tag_id, entity_id)): Path<(String, String, Uuid, Uuid)>,
) -> Result<Json<Value>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    auth.require_mutation()?;
    let gone = sqlx::query("DELETE FROM tag_attachments WHERE tag_id = $1 AND entity_id = $2")
        .bind(tag_id)
        .bind(entity_id)
        .execute(&state.db)
        .await
        .map_err(Error::internal)?
        .rows_affected();
    Ok(Json(json!({ "detached": gone > 0 })))
}

async fn attach_tags_checked(
    pool: &PgPool,
    project_id: Uuid,
    entity_type: &str,
    entity_id: Uuid,
    tags: &[Uuid],
) -> Result<(), Error> {
    if !["wallet", "contract"].contains(&entity_type) {
        return Err(Error::BadRequest("invalid tag entity type".into()));
    }
    let entity_exists: bool = match entity_type {
        "wallet" => sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM wallets WHERE project_id = $1 AND id = $2)",
        )
        .bind(project_id)
        .bind(entity_id)
        .fetch_one(pool)
        .await
        .map_err(Error::internal)?,
        "contract" => sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM contracts WHERE project_id = $1 AND id = $2)",
        )
        .bind(project_id)
        .bind(entity_id)
        .fetch_one(pool)
        .await
        .map_err(Error::internal)?,
        _ => false,
    };
    if !entity_exists {
        return Err(Error::BadRequest(
            "tag target is not tracked by this project".into(),
        ));
    }
    let unique: HashSet<Uuid> = tags.iter().copied().collect();
    for tag_id in unique {
        let tag_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM tags WHERE project_id = $1 AND id = $2)",
        )
        .bind(project_id)
        .bind(tag_id)
        .fetch_one(pool)
        .await
        .map_err(Error::internal)?;
        if !tag_exists {
            return Err(Error::BadRequest(
                "tag does not belong to this project".into(),
            ));
        }
        sqlx::query(
            "INSERT INTO tag_attachments (tag_id, entity_type, entity_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
        )
        .bind(tag_id)
        .bind(entity_type)
        .bind(entity_id)
        .execute(pool)
        .await
        .map_err(Error::internal)?;
    }
    Ok(())
}

async fn entity_tags(
    pool: &PgPool,
    project_id: Uuid,
    entity_type: &str,
    entity_id: Uuid,
) -> Result<Vec<Value>, Error> {
    let rows = sqlx::query(
        r#"
        SELECT t.id, t.name, t.color
        FROM tags t
        JOIN tag_attachments a ON a.tag_id = t.id
        WHERE t.project_id = $1 AND a.entity_type = $2 AND a.entity_id = $3
        ORDER BY t.name ASC
        "#,
    )
    .bind(project_id)
    .bind(entity_type)
    .bind(entity_id)
    .fetch_all(pool)
    .await
    .map_err(Error::internal)?;
    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.get::<Uuid, _>("id"),
                "name": row.get::<String, _>("name"),
                "color": row.get::<Option<String>, _>("color")
            })
        })
        .collect())
}

async fn entity_list(
    pool: &PgPool,
    table: &str,
    project_id: Uuid,
    q: PageQuery,
) -> Result<Paged<Value>, Error> {
    let limit = clamp_limit(q.limit);
    let cursor = parse_text_cursor(q.cursor.as_deref())?;
    let entity_type = match table {
        "wallets" => "wallet",
        "contracts" => "contract",
        _ => {
            return Err(Error::internal(std::io::Error::other(
                "invalid entity table",
            )));
        }
    };
    let (select, order) = match table {
        "wallets" => (
            "SELECT w.id, w.address, w.network, w.last_synced_at FROM wallets w WHERE w.project_id = $1",
            "ORDER BY w.address ASC, w.id ASC",
        ),
        "contracts" => (
            "SELECT c.id, c.address, c.network, c.last_synced_at FROM contracts c WHERE c.project_id = $1",
            "ORDER BY c.address ASC, c.id ASC",
        ),
        _ => {
            return Err(Error::internal(std::io::Error::other(
                "invalid entity table",
            )));
        }
    };
    let mut sql = select.to_owned();
    let tag = q.tag.filter(|t| !t.trim().is_empty());
    if tag.is_some() {
        let alias = if table == "wallets" { "w" } else { "c" };
        sql.push_str(&format!(
            " AND EXISTS (
                SELECT 1 FROM tag_attachments a
                JOIN tags t ON t.id = a.tag_id
                WHERE t.project_id = $1
                  AND a.entity_type = '{entity_type}'
                  AND a.entity_id = {alias}.id
                  AND (t.name = $2 OR t.id::text = $2)
            )"
        ));
    }
    let cursor_base = if tag.is_some() { 3 } else { 2 };
    if cursor.is_some() {
        let alias = if table == "wallets" { "w" } else { "c" };
        sql.push_str(&format!(
            " AND ({alias}.address, {alias}.id::text) > (${cursor_base}, ${}) ",
            cursor_base + 1
        ));
        sql.push_str(order);
        sql.push_str(&format!(" LIMIT ${}", cursor_base + 2));
    } else {
        sql.push(' ');
        sql.push_str(order);
        sql.push_str(&format!(" LIMIT ${cursor_base}"));
    }
    let mut query = sqlx::query(&sql).bind(project_id);
    if let Some(tag) = tag {
        query = query.bind(tag);
    }
    let had_cursor = cursor.is_some();
    if let Some((address, id)) = cursor {
        query = query.bind(address).bind(id);
    }
    let rows = query
        .bind(limit + 1)
        .fetch_all(pool)
        .await
        .map_err(Error::internal)?;
    let mut data = Vec::new();
    let mut cursors = Vec::new();
    for row in rows {
        let id = row.get::<Uuid, _>("id");
        let address = row.get::<String, _>("address");
        cursors.push((address.clone(), id.to_string()));
        data.push(json!({
            "id": id,
            "address": address,
            "network": row.get::<String, _>("network"),
            "last_synced_at": row.get::<Option<DateTime<Utc>>, _>("last_synced_at")
        }));
    }
    Ok(paged_json(data, cursors, limit, had_cursor))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tx_type_mapping_rejects_unknown_values() {
        assert_eq!(tx_type_to_operation("payments").unwrap(), "payment");
        assert!(tx_type_to_operation("nfts").is_err());
    }

    #[test]
    fn known_search_scopes_exclude_opcode() {
        assert!(SEARCH_SCOPES.contains(&"function"));
        assert!(SEARCH_SCOPES.contains(&"metric"));
        assert!(!SEARCH_SCOPES.contains(&"opcode"));
    }
}
