//! Normalized domain models produced by decoding Horizon / Soroban-RPC and
//! written to Postgres. These are the schema-facing types; wire decoding lives
//! in [`crate::decode`].

use serde::{Deserialize, Serialize};

/// A ledger/block header.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LedgerRecord {
    pub sequence: i64,
    pub network: String,
    pub hash: String,
    pub parent_hash: Option<String>,
    pub transaction_count: i64,
    pub size_bytes: i64,
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub base_operation_fee: Option<String>,
    pub base_reserve: Option<String>,
    pub total_cpu_instructions: Option<i64>,
    pub resource_limit: Option<i64>,
}

/// Resource usage metrics dug out of Soroban diagnostic events. Per the
/// protocol-23 contract, each is OPTIONAL — a node without
/// `ENABLE_SOROBAN_DIAGNOSTIC_EVENTS` must yield `None`, never a fake 0.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ResourceMetrics {
    pub cpu_instructions: Option<i64>,
    pub cpu_instruction_limit: Option<i64>,
    pub memory_bytes: Option<i64>,
    pub invoke_time_nsecs: Option<i64>,
    pub disk_read_bytes: Option<i64>,
    pub disk_read_bytes_limit: Option<i64>,
    pub write_bytes: Option<i64>,
    pub write_bytes_limit: Option<i64>,
    pub max_rw_key_byte: Option<i64>,
    pub max_rw_data_byte: Option<i64>,
    pub resource_fee: Option<String>,
}

/// A single ledger-inclusion transaction with its decoded detail.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TxRecord {
    pub hash: String,
    pub network: String,
    pub ledger_sequence: i64,
    pub status: TxStatus,
    pub source_account: String,
    pub operation_type: String,
    /// Explicit target decoded from the classic operation, separate from asset flow.
    pub operation_target_address: Option<String>,
    pub operation_target_kind: Option<String>,
    /// Requested operation data is separate from applied fund-flow effects.
    pub operation_details: serde_json::Value,
    pub fee_charged: Option<String>,
    pub sequence_number: Option<String>,
    pub application_order: i64,
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub metrics: ResourceMetrics,
    /// Invocation-API detail, present only for Soroban host-function calls.
    pub call_tree: Vec<CallTreeNode>,
    pub state_changes: Vec<StateChange>,
    pub events: Vec<Event>,
    pub fund_flow: Vec<FundFlowEdge>,
    /// Raw XDR retained for forensic debugging / later phases.
    pub raw_result_meta_xdr: Option<String>,
    pub raw_envelope_xdr: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum TxStatus {
    Success,
    Failed,
}

/// A node in the Soroban call tree (`tx_call_tree_nodes`).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct CallTreeNode {
    /// Index of the parent node within the same call tree; `None` for the root.
    pub parent_index: Option<i64>,
    pub contract_id: String,
    pub function_name: String,
    pub args: serde_json::Value,
    pub return_value: Option<serde_json::Value>,
    /// Depth reconstructed by the decoder (root = 0).
    pub depth: i64,
    /// Stable execution order from diagnostic evidence or envelope order.
    pub sequence: i64,
}

/// A ledger entry mutated by a Soroban invocation (`tx_state_changes`).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct StateChange {
    pub entry_type: String,
    pub entry_key: String,
    pub value_before: Option<serde_json::Value>,
    pub value_after: Option<serde_json::Value>,
    /// Index of the call-tree node that caused this change, if any.
    pub caused_by_node: Option<i64>,
    pub sequence: i64,
    /// `exact` comes from ordered diagnostics; `contract` is inferred by the
    /// owning contract; `transaction` means the protocol exposes no child cause.
    pub cause_confidence: String,
}

/// A Soroban event (`tx_events`). Protocol-23 knows three buckets.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Event {
    pub contract_id: String,
    pub topics: Vec<String>,
    pub data: serde_json::Value,
    pub caused_by_node: Option<i64>,
    pub sequence: i64,
    pub event_type: String,
    pub successful: Option<bool>,
    pub stage: Option<String>,
}

/// A classic payment edge (`tx_fund_flow_edges`).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct FundFlowEdge {
    pub from_address: String,
    pub to_address: String,
    pub asset: String,
    pub amount: String,
    pub caused_by_node: Option<i64>,
    pub sequence: i64,
    pub asset_type: String,
    pub usd_value: Option<String>,
}

/// A single live ledger entry returned by Soroban-RPC `getLedgerEntries`.
///
/// **Source-of-truth rule:** `getLedgerEntries` returns *specific* ledger
/// entries (accounts/contracts/trustlines) — it never enumerates ledgers or
/// transactions. The decoder therefore maps each entry to an entity snapshot
/// and *never* to a block/transaction record. Used for fork-core snapshots and
/// lazy profile enrichment only.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EntitySnapshot {
    pub network: String,
    pub entry_type: String,
    pub key: String,
    pub value: serde_json::Value,
}

/// The Soroban-RPC `getLedgerEntries` response, sparse on purpose.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerEntriesResponse {
    pub entries: Vec<LedgerEntry>,
    pub latest_ledger: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LedgerEntry {
    pub key: String,
    pub xdr: String,
    pub last_modified_ledger_seq: Option<i64>,
}
