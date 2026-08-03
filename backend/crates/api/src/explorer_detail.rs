//! Phase 3 explorer entity API: decoded transaction/account/contract/ledger
//! detail plus project-tracked tags, comments, priority, verification, and
//! contract call routing.

use std::collections::HashSet;

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use shared::{Cursor, Error, Paged, Pagination, Permission, PermissionSet, clamp_limit};
use sqlx::{PgPool, Row};
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
    let row = sqlx::query_as::<_, (Uuid, String, bool, i16)>(
        r#"
        SELECT p.id, p.network, u.email_verified, m.permissions
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
        project_id: row.0,
        network: row.1,
        email_verified: row.2,
        perms: PermissionSet(row.3),
    })
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

pub async fn public_tx_detail(
    State(state): State<AppState>,
    Path((network, hash)): Path<(String, String)>,
) -> Result<Json<Value>, Error> {
    Ok(Json(load_tx_detail(&state.db, &network, &hash).await?))
}

async fn load_tx_detail(pool: &PgPool, network: &str, hash: &str) -> Result<Value, Error> {
    let row = sqlx::query(
        r#"
        SELECT hash, network, ledger_sequence, status, source_account, operation_type,
               fee_charged::text, sequence_number, application_order, timestamp,
               cpu_instructions, memory_bytes, invoke_time_nsecs, disk_read_bytes,
               write_bytes, max_rw_key_byte, max_rw_data_byte
        FROM transactions
        WHERE network = $1 AND hash = $2
        "#,
    )
    .bind(network)
    .bind(hash)
    .fetch_optional(pool)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)?;

    let calls = call_tree(pool, hash).await?;
    let states = state_changes(pool, hash).await?;
    let events = tx_events(pool, hash).await?;
    let flow = fund_flow(pool, hash).await?;
    let annotations = annotations(pool, hash).await?;

    Ok(json!({
        "hash": row.get::<String, _>("hash"),
        "network": row.get::<String, _>("network"),
        "status": row.get::<String, _>("status"),
        "ledger": row.get::<i64, _>("ledger_sequence"),
        "timestamp": row.get::<DateTime<Utc>, _>("timestamp"),
        "source_account": row.get::<String, _>("source_account"),
        "operation_type": row.get::<String, _>("operation_type"),
        "fee_charged": numeric_str(&row, "fee_charged"),
        "sequence_number": row.get::<Option<String>, _>("sequence_number"),
        "application_order": row.get::<Option<i32>, _>("application_order"),
        "resource_usage": {
            "cpu_instructions": row.get::<Option<i64>, _>("cpu_instructions"),
            "memory_bytes": row.get::<Option<i64>, _>("memory_bytes"),
            "invoke_time_nsecs": row.get::<Option<i64>, _>("invoke_time_nsecs"),
            "disk_read_bytes": row.get::<Option<i64>, _>("disk_read_bytes"),
            "write_bytes": row.get::<Option<i64>, _>("write_bytes"),
            "max_rw_key_byte": row.get::<Option<i32>, _>("max_rw_key_byte"),
            "max_rw_data_byte": row.get::<Option<i32>, _>("max_rw_data_byte")
        },
        "call_tree": calls,
        "state_changes": states,
        "events": events,
        "fund_flow": flow,
        "annotations": annotations,
        "source_map_status": "not_available"
    }))
}

async fn call_tree(pool: &PgPool, hash: &str) -> Result<Vec<Value>, Error> {
    let rows = sqlx::query(
        r#"
        SELECT id, parent_node_id, contract_id, function_name, args, return_value, depth
        FROM tx_call_tree_nodes
        WHERE tx_hash = $1
        ORDER BY depth ASC, id ASC
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
            "depth": row.get::<i32, _>("depth")
        }));
    }
    Ok(nodes)
}

async fn state_changes(pool: &PgPool, hash: &str) -> Result<Vec<Value>, Error> {
    let rows = sqlx::query(
        r#"
        SELECT id, caused_by_node_id, entry_type, entry_key, value_before, value_after
        FROM tx_state_changes
        WHERE tx_hash = $1
        ORDER BY id ASC
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
                "caused_by_call": row.get::<Option<Uuid>, _>("caused_by_node_id")
            })
        })
        .collect())
}

async fn tx_events(pool: &PgPool, hash: &str) -> Result<Vec<Value>, Error> {
    let rows = sqlx::query(
        "SELECT id, contract_id, topics, data FROM tx_events WHERE tx_hash = $1 ORDER BY id ASC",
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
                "data": row.get::<Value, _>("data")
            })
        })
        .collect())
}

async fn fund_flow(pool: &PgPool, hash: &str) -> Result<Vec<Value>, Error> {
    let rows = sqlx::query(
        r#"
        SELECT id, from_address, to_address, asset, amount::text
        FROM tx_fund_flow_edges
        WHERE tx_hash = $1
        ORDER BY id ASC
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
                "amount": row.get::<String, _>("amount")
            })
        })
        .collect())
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
    let detail = load_tx_detail(&state.db, &network, &hash).await?;
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
    let row = sqlx::query(
        r#"
        SELECT sequence, hash, parent_hash, transaction_count, size_bytes, timestamp,
               base_operation_fee::text, base_reserve::text,
               total_cpu_instructions, resource_limit
        FROM ledgers WHERE network = $1 AND sequence = $2
        "#,
    )
    .bind(network)
    .bind(sequence)
    .fetch_optional(pool)
    .await
    .map_err(Error::internal)?
    .ok_or(Error::NotFound)?;
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
        SELECT hash, network, ledger_sequence, status, source_account, operation_type,
               timestamp, application_order
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
    let xlm = latest_holding(pool, network, address, "XLM").await?;
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

pub async fn contract_transactions(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, address)): Path<(String, String, String)>,
    Query(q): Query<PageQuery>,
) -> Result<Json<Paged<Value>>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    let limit = clamp_limit(q.limit);
    let cursor = parse_time_cursor(q.cursor.as_deref())?;
    let page = transaction_page(&state.db, &auth.network, limit, cursor, |sql, binds| {
        binds.push(json!(address));
        let n = binds.len();
        sql.push_str(&format!(
            " AND EXISTS (SELECT 1 FROM tx_call_tree_nodes c WHERE c.tx_hash = transactions.hash AND c.contract_id = ${n})"
        ));
        Ok(())
    })
    .await?;
    Ok(Json(page))
}

pub async fn contract_events(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, address)): Path<(String, String, String)>,
    Query(q): Query<EventQuery>,
) -> Result<Json<Paged<Value>>, Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    let limit = clamp_limit(q.limit);
    let cursor = parse_seq_cursor(q.cursor.as_deref())?;
    let mut sql = String::from(
        r#"
        SELECT e.id, e.tx_hash, e.contract_id, e.topics, e.data, t.ledger_sequence, t.timestamp
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

    let mut query = sqlx::query(&sql).bind(&auth.network).bind(&address);
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
        .fetch_all(&state.db)
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
            "ledger": seq,
            "timestamp": row.get::<DateTime<Utc>, _>("timestamp")
        }));
    }
    Ok(Json(paged_json(data, cursors, limit, had_cursor)))
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

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VerifyRequest {
    pub visibility: String,
    pub source_archive_url: String,
    #[serde(default)]
    pub toolchain: Value,
}

pub async fn submit_verification(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project, address)): Path<(String, String, String)>,
    Json(req): Json<VerifyRequest>,
) -> Result<(StatusCode, Json<Value>), Error> {
    let auth = resolve_project(&state, user_id, &org, &project).await?;
    auth.require_mutation()?;
    if !["public", "private"].contains(&req.visibility.as_str()) {
        return Err(Error::BadRequest("invalid verification visibility".into()));
    }
    if req.source_archive_url.trim().is_empty() {
        return Err(Error::BadRequest("source_archive_url is required".into()));
    }
    let contract_id = contract_id(&state.db, auth.project_id, &address).await?;
    let id = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO contract_verifications
            (contract_id, submitted_by, visibility, source_archive_url,
             rust_version, soroban_sdk_version, wasm_target, opt_level, wasm_opt_applied)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING id
        "#,
    )
    .bind(contract_id)
    .bind(user_id)
    .bind(&req.visibility)
    .bind(req.source_archive_url.trim())
    .bind(req.toolchain.get("rust_version").and_then(Value::as_str))
    .bind(
        req.toolchain
            .get("soroban_sdk_version")
            .and_then(Value::as_str),
    )
    .bind(req.toolchain.get("wasm_target").and_then(Value::as_str))
    .bind(req.toolchain.get("opt_level").and_then(Value::as_str))
    .bind(
        req.toolchain
            .get("wasm_opt_applied")
            .and_then(Value::as_bool),
    )
    .fetch_one(&state.db)
    .await
    .map_err(Error::internal)?;
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({ "verification_id": id, "status": "submitted" })),
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
    let limit = clamp_limit(q.limit);
    let cursor = parse_time_cursor(q.cursor.as_deref())?;
    let mut sql = String::from(
        r#"
        SELECT id, visibility, status, source_archive_url, rust_version,
               soroban_sdk_version, wasm_target, opt_level, wasm_opt_applied,
               built_wasm_hash, failure_reason, created_at, completed_at
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
            "source_archive_url": row.get::<String, _>("source_archive_url"),
            "toolchain": {
                "rust_version": row.get::<Option<String>, _>("rust_version"),
                "soroban_sdk_version": row.get::<Option<String>, _>("soroban_sdk_version"),
                "wasm_target": row.get::<Option<String>, _>("wasm_target"),
                "opt_level": row.get::<Option<String>, _>("opt_level"),
                "wasm_opt_applied": row.get::<Option<bool>, _>("wasm_opt_applied")
            },
            "built_wasm_hash": row.get::<Option<String>, _>("built_wasm_hash"),
            "failure_reason": row.get::<Option<String>, _>("failure_reason"),
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
