//! Postgres persistence. These are **idempotent** by construction: re-ingesting
//! a ledger range is a no-op because every top-level upsert is keyed on the
//! ledger `sequence` / transaction `hash` primary keys and child rows are only
//! written when the parent is newly inserted (the whole batch runs in one
//! transaction). A worker can resume after a crash without gaps or dupes.

use sqlx::PgConnection;
use sqlx::postgres::PgPool;
use uuid::Uuid;

use crate::models::{EntitySnapshot, LedgerRecord, StateChange, TxRecord, TxStatus};

/// Rehydrated result of persisting a transaction.
pub struct UpsertOutcome {
    /// True if the row already existed and was skipped (no-op).
    pub already_present: bool,
    /// DB ids assigned to call-tree nodes in order; index `i` corresponds to
    /// call_tree `i`. Empty for classic transactions.
    pub node_ids: Vec<Uuid>,
}

/// Write a ledger header, avoiding duplicates. Returns `true` when newly
/// inserted.
pub async fn upsert_ledger(pool: &PgPool, l: &LedgerRecord) -> Result<bool, sqlx::Error> {
    let res = sqlx::query(
        r#"
        INSERT INTO ledgers (
            sequence, network, hash, parent_hash, transaction_count, size_bytes,
            timestamp, base_operation_fee, base_reserve, total_cpu_instructions, resource_limit
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::numeric,$9::numeric,$10,$11)
        ON CONFLICT (sequence) DO NOTHING
        RETURNING sequence
        "#,
    )
    .bind(l.sequence)
    .bind(&l.network)
    .bind(&l.hash)
    .bind(&l.parent_hash)
    .bind(l.transaction_count)
    .bind(l.size_bytes)
    .bind(l.timestamp)
    .bind(&l.base_operation_fee)
    .bind(&l.base_reserve)
    .bind(l.total_cpu_instructions)
    .bind(l.resource_limit)
    .fetch_optional(pool)
    .await?;
    Ok(res.is_some())
}

/// Write or enrich a transaction and its decoded child rows atomically.
pub async fn upsert_tx(pool: &PgPool, tx: &TxRecord) -> Result<UpsertOutcome, sqlx::Error> {
    let mut db = pool.begin().await?;

    let inserted: bool = sqlx::query_scalar(
        r#"
        INSERT INTO transactions (
            hash, network, ledger_sequence, status, source_account, operation_type,
            operation_target_address, operation_target_kind,
            fee_charged, sequence_number, application_order, timestamp,
            cpu_instructions, memory_bytes, invoke_time_nsecs, disk_read_bytes,
            write_bytes, max_rw_key_byte, max_rw_data_byte,
            cpu_instruction_limit, disk_read_bytes_limit, write_bytes_limit, resource_fee,
            raw_result_meta_xdr, raw_envelope_xdr
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::numeric,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::numeric,$24,$25)
        ON CONFLICT (hash) DO UPDATE SET
            network = EXCLUDED.network,
            ledger_sequence = EXCLUDED.ledger_sequence,
            status = EXCLUDED.status,
            source_account = EXCLUDED.source_account,
            operation_type = EXCLUDED.operation_type,
            operation_target_address = COALESCE(EXCLUDED.operation_target_address, transactions.operation_target_address),
            operation_target_kind = COALESCE(EXCLUDED.operation_target_kind, transactions.operation_target_kind),
            fee_charged = COALESCE(EXCLUDED.fee_charged, transactions.fee_charged),
            sequence_number = COALESCE(EXCLUDED.sequence_number, transactions.sequence_number),
            application_order = EXCLUDED.application_order,
            timestamp = EXCLUDED.timestamp,
            cpu_instructions = COALESCE(EXCLUDED.cpu_instructions, transactions.cpu_instructions),
            memory_bytes = COALESCE(EXCLUDED.memory_bytes, transactions.memory_bytes),
            invoke_time_nsecs = COALESCE(EXCLUDED.invoke_time_nsecs, transactions.invoke_time_nsecs),
            disk_read_bytes = COALESCE(EXCLUDED.disk_read_bytes, transactions.disk_read_bytes),
            write_bytes = COALESCE(EXCLUDED.write_bytes, transactions.write_bytes),
            max_rw_key_byte = COALESCE(EXCLUDED.max_rw_key_byte, transactions.max_rw_key_byte),
            max_rw_data_byte = COALESCE(EXCLUDED.max_rw_data_byte, transactions.max_rw_data_byte),
            cpu_instruction_limit = COALESCE(EXCLUDED.cpu_instruction_limit, transactions.cpu_instruction_limit),
            disk_read_bytes_limit = COALESCE(EXCLUDED.disk_read_bytes_limit, transactions.disk_read_bytes_limit),
            write_bytes_limit = COALESCE(EXCLUDED.write_bytes_limit, transactions.write_bytes_limit),
            resource_fee = COALESCE(EXCLUDED.resource_fee, transactions.resource_fee),
            raw_result_meta_xdr = COALESCE(EXCLUDED.raw_result_meta_xdr, transactions.raw_result_meta_xdr),
            raw_envelope_xdr = COALESCE(EXCLUDED.raw_envelope_xdr, transactions.raw_envelope_xdr)
        RETURNING (xmax = 0) AS inserted
        "#,
    )
    .bind(&tx.hash)
    .bind(&tx.network)
    .bind(tx.ledger_sequence)
    .bind(status_sql(tx.status))
    .bind(&tx.source_account)
    .bind(&tx.operation_type)
    .bind(&tx.operation_target_address)
    .bind(&tx.operation_target_kind)
    .bind(&tx.fee_charged)
    .bind(&tx.sequence_number)
    .bind(tx.application_order)
    .bind(tx.timestamp)
    .bind(tx.metrics.cpu_instructions)
    .bind(tx.metrics.memory_bytes)
    .bind(tx.metrics.invoke_time_nsecs)
    .bind(tx.metrics.disk_read_bytes)
    .bind(tx.metrics.write_bytes)
    .bind(tx.metrics.max_rw_key_byte)
    .bind(tx.metrics.max_rw_data_byte)
    .bind(tx.metrics.cpu_instruction_limit)
    .bind(tx.metrics.disk_read_bytes_limit)
    .bind(tx.metrics.write_bytes_limit)
    .bind(&tx.metrics.resource_fee)
    .bind(&tx.raw_result_meta_xdr)
    .bind(&tx.raw_envelope_xdr)
    .fetch_one(&mut *db)
    .await?;

    let new = inserted;
    let replace_detail = new
        || !tx.call_tree.is_empty()
        || !tx.state_changes.is_empty()
        || !tx.events.is_empty()
        || !tx.fund_flow.is_empty();
    let node_ids = if replace_detail {
        delete_invocation_detail(&mut db, &tx.hash).await?;
        let ids = insert_call_tree(&mut db, &tx.hash, &tx.call_tree).await?;
        insert_state_changes(&mut db, &tx.hash, &tx.state_changes, &ids).await?;
        insert_events(&mut db, &tx.hash, &tx.events, &ids).await?;
        ids
    } else {
        Vec::new()
    };
    if new || !tx.fund_flow.is_empty() {
        delete_fund_flow(&mut db, &tx.hash).await?;
        insert_fund_flow(&mut db, &tx.hash, &tx.fund_flow, &node_ids).await?;
    }

    db.commit().await?;
    Ok(UpsertOutcome {
        already_present: !new,
        node_ids,
    })
}

async fn delete_invocation_detail(db: &mut PgConnection, tx_hash: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM tx_state_changes WHERE tx_hash = $1")
        .bind(tx_hash)
        .execute(&mut *db)
        .await?;
    sqlx::query("DELETE FROM tx_events WHERE tx_hash = $1")
        .bind(tx_hash)
        .execute(&mut *db)
        .await?;
    sqlx::query("DELETE FROM tx_call_tree_nodes WHERE tx_hash = $1")
        .bind(tx_hash)
        .execute(&mut *db)
        .await?;
    Ok(())
}

async fn delete_fund_flow(db: &mut PgConnection, tx_hash: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM tx_fund_flow_edges WHERE tx_hash = $1")
        .bind(tx_hash)
        .execute(&mut *db)
        .await?;
    Ok(())
}

/// Persist entity snapshots from `getLedgerEntries` (idempotent by
/// `(network, entry_key)`). Returns the number persisted this call.
pub async fn upsert_snapshots(
    pool: &PgPool,
    network: &str,
    ledger_sequence: Option<i64>,
    snapshots: &[EntitySnapshot],
) -> Result<usize, sqlx::Error> {
    let mut persisted = 0;
    for s in snapshots {
        let n = sqlx::query(
            r#"
            INSERT INTO entity_snapshots (network, entry_type, entry_key, xdr, value, ledger_sequence, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6, now())
            ON CONFLICT (network, entry_key) DO UPDATE SET
                entry_type       = EXCLUDED.entry_type,
                xdr              = EXCLUDED.xdr,
                value            = EXCLUDED.value,
                ledger_sequence  = EXCLUDED.ledger_sequence,
                updated_at       = now()
            "#,
        )
        .bind(network)
        .bind(&s.entry_type)
        .bind(&s.key)
        .bind(optional_str(&s.value))
        .bind(&s.value)
        .bind(ledger_sequence)
        .execute(pool)
        .await?;
        persisted += n.rows_affected() as usize;
    }
    Ok(persisted)
}

fn optional_str(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::String(s) => Some(s.clone()),
        _ => None,
    }
}

fn status_sql(s: TxStatus) -> &'static str {
    match s {
        TxStatus::Success => "success",
        TxStatus::Failed => "failed",
    }
}

async fn insert_call_tree(
    db: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tx_hash: &str,
    nodes: &[crate::models::CallTreeNode],
) -> Result<Vec<Uuid>, sqlx::Error> {
    // Parent references are by index; we insert in order and capture each fresh
    // uuid so children can reference their parent id.
    let mut ids: Vec<Uuid> = Vec::with_capacity(nodes.len());
    for n in nodes {
        let parent = n.parent_index.and_then(|i| ids.get(i as usize)).copied();
        let id: Uuid = sqlx::query_scalar(
            r#"
            INSERT INTO tx_call_tree_nodes
                (tx_hash, parent_node_id, contract_id, function_name, args, return_value, depth, sequence)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            RETURNING id
            "#,
        )
        .bind(tx_hash)
        .bind(parent)
        .bind(&n.contract_id)
        .bind(&n.function_name)
        .bind(&n.args)
        .bind(&n.return_value)
        .bind(n.depth)
        .bind(n.sequence)
        .fetch_one(&mut **db)
        .await?;
        ids.push(id);
    }
    Ok(ids)
}

async fn insert_state_changes(
    db: &mut PgConnection,
    tx_hash: &str,
    changes: &[StateChange],
    node_ids: &[Uuid],
) -> Result<(), sqlx::Error> {
    for c in changes {
        let caused_by = c
            .caused_by_node
            .and_then(|i| node_ids.get(i as usize))
            .copied();
        sqlx::query(
            r#"
            INSERT INTO tx_state_changes
                (tx_hash, caused_by_node_id, entry_type, entry_key, value_before, value_after, sequence, cause_confidence)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            "#,
        )
        .bind(tx_hash)
        .bind(caused_by)
        .bind(&c.entry_type)
        .bind(&c.entry_key)
        .bind(&c.value_before)
        .bind(&c.value_after)
        .bind(c.sequence)
        .bind(&c.cause_confidence)
        .execute(&mut *db)
        .await?;
    }
    Ok(())
}

async fn insert_events(
    db: &mut PgConnection,
    tx_hash: &str,
    events: &[crate::models::Event],
    node_ids: &[Uuid],
) -> Result<(), sqlx::Error> {
    for e in events {
        let topics = serde_json::json!(e.topics);
        let caused_by = e
            .caused_by_node
            .and_then(|index| node_ids.get(index as usize))
            .copied();
        sqlx::query(
            r#"
            INSERT INTO tx_events
                (tx_hash, contract_id, topics, data, caused_by_node_id, sequence, event_type, successful, stage)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            "#,
        )
        .bind(tx_hash)
        .bind(&e.contract_id)
        .bind(topics)
        .bind(&e.data)
        .bind(caused_by)
        .bind(e.sequence)
        .bind(&e.event_type)
        .bind(e.successful)
        .bind(&e.stage)
        .execute(&mut *db)
        .await?;
    }
    Ok(())
}

async fn insert_fund_flow(
    db: &mut PgConnection,
    tx_hash: &str,
    edges: &[crate::models::FundFlowEdge],
    node_ids: &[Uuid],
) -> Result<(), sqlx::Error> {
    for e in edges {
        let caused_by = e
            .caused_by_node
            .and_then(|index| node_ids.get(index as usize))
            .copied();
        sqlx::query(
            r#"
            INSERT INTO tx_fund_flow_edges
                (tx_hash, from_address, to_address, asset, amount, caused_by_node_id, sequence, asset_type, usd_value)
            VALUES ($1,$2,$3,$4,$5::numeric,$6,$7,$8,$9::numeric)
            "#,
        )
        .bind(tx_hash)
        .bind(&e.from_address)
        .bind(&e.to_address)
        .bind(&e.asset)
        .bind(&e.amount)
        .bind(caused_by)
        .bind(e.sequence)
        .bind(&e.asset_type)
        .bind(&e.usd_value)
        .execute(&mut *db)
        .await?;
    }
    Ok(())
}
