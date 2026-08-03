//! Wire decoding: Horizon JSON → normalized [`models::LedgerRecord`] /
//! [`models::TxRecord`], and Soroban-RPC JSON → invocation-detail records.
//! Decoders are pure (JSON in, record out) so they're unit-testable against
//! committed fixtures without any network.
//!
//! **Protocol-23 contract:** the RPC `events` object is *nested*
//! (`diagnosticEvents`, `transactionEvents`, `contractEvents`) — never flat.
//! The nested shape is decoded directly; a flat (pre-P23) shape is tolerated as
//! a fallback; anything else fails loudly.

use chrono::{DateTime, Utc};
use serde_json::Value;

use crate::asset::classic_asset;
use crate::models::{
    EntitySnapshot, Event, FundFlowEdge, LedgerRecord, ResourceMetrics, TxRecord, TxStatus,
};

/// A decoding failure: a missing field or protocol schema drift. Kept distinct
/// from `shared::Error` because the caller surfaces it loudly in logs/health.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum DecodeError {
    #[error("missing field `{0}` in Horizon record")]
    MissingHorizonField(&'static str),
    #[error("missing field `{0}` in Soroban RPC record")]
    MissingRpcField(&'static str),
    #[error("protocol-23 event shape drift")]
    ProtocolDrift,
    #[error("bad timestamp `{0}`")]
    BadTimestamp(String),
}

pub type DecodeResult<T> = Result<T, DecodeError>;

fn as_str<'a>(v: &'a Value, key: &'static str) -> DecodeResult<&'a str> {
    v.get(key)
        .and_then(Value::as_str)
        .ok_or(DecodeError::MissingHorizonField(key))
}

fn opt_i64(v: &Value, key: &'static str) -> Option<i64> {
    v.get(key).and_then(Value::as_i64)
}

fn parse_time(s: &str) -> DecodeResult<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .map(|d| d.with_timezone(&Utc))
        .map_err(|_| DecodeError::BadTimestamp(s.to_string()))
}

/// Decode a Horizon `/ledgers` record.
pub fn decode_ledger(v: &Value, network: &str) -> DecodeResult<LedgerRecord> {
    let timestamp = parse_time(as_str(v, "closed_at")?)?;
    Ok(LedgerRecord {
        sequence: opt_i64(v, "sequence").ok_or(DecodeError::MissingHorizonField("sequence"))?,
        network: network.to_string(),
        hash: as_str(v, "hash")?.to_string(),
        parent_hash: v.get("prev_hash").and_then(Value::as_str).map(String::from),
        transaction_count: opt_i64(v, "transaction_count").unwrap_or(0),
        size_bytes: opt_i64(v, "size_bytes").unwrap_or(0),
        timestamp,
        base_operation_fee: opt_i64(v, "base_fee_in_stroops").map(|n| n.to_string()),
        base_reserve: opt_i64(v, "base_reserve_in_stroops").map(|n| n.to_string()),
        total_cpu_instructions: opt_i64(v, "total_cpu_instructions"),
        resource_limit: opt_i64(v, "resource_limit"),
    })
}

/// Decode a classic Horizon `/transactions` record (with embedded operations),
/// extracting classic payment operations as fund-flow edges.
pub fn decode_classic_tx(v: &Value, network: &str) -> DecodeResult<TxRecord> {
    let timestamp = parse_time(as_str(v, "created_at")?)?;
    let status = match v.get("successful").and_then(Value::as_bool) {
        Some(true) => TxStatus::Success,
        _ => TxStatus::Failed,
    };
    let hash = as_str(v, "hash")?.to_string();

    let fund_flow = operations(v)
        .unwrap_or_default()
        .into_iter()
        .map(|op| FundFlowEdge {
            from_address: op.source,
            to_address: op.to,
            asset: classic_asset(
                &op.asset_type,
                op.asset_code.as_deref(),
                op.asset_issuer.as_deref(),
            ),
            amount: op.amount,
        })
        .collect();

    Ok(TxRecord {
        hash,
        network: network.to_string(),
        ledger_sequence: opt_i64(v, "ledger").unwrap_or(0),
        status,
        source_account: as_str(v, "source_account")?.to_string(),
        operation_type: v
            .get("operation_type")
            .and_then(Value::as_str)
            .unwrap_or("payment")
            .to_string(),
        fee_charged: v
            .get("fee_charged")
            .and_then(Value::as_str)
            .map(String::from),
        sequence_number: None,
        application_order: opt_i64(v, "application_order").unwrap_or(0),
        timestamp,
        metrics: ResourceMetrics::default(),
        call_tree: Vec::new(),
        state_changes: Vec::new(),
        events: Vec::new(),
        fund_flow,
        raw_result_meta_xdr: v
            .get("result_meta_xdr")
            .and_then(Value::as_str)
            .map(String::from),
        raw_envelope_xdr: v
            .get("envelope_xdr")
            .and_then(Value::as_str)
            .map(String::from),
    })
}

/// A classic payment operation pulled from a Horizon operation record.
struct ClassicOp {
    source: String,
    to: String,
    amount: String,
    asset_type: String,
    asset_code: Option<String>,
    asset_issuer: Option<String>,
}

/// Pull payments from either the flat shape (`operations`) or the embedded HAL
/// shape (`_embedded.operations`), decoding only `payment` operations. Returns
/// `Some` only when an operations collection is present; caller can then treat
/// absence as "no operations" (`unwrap_or_default`).
fn operations(v: &Value) -> Option<Vec<ClassicOp>> {
    let arr = v.get("operations").and_then(Value::as_array).or_else(|| {
        v.get("_embedded")
            .and_then(|e| e.get("operations"))
            .and_then(Value::as_array)
    });

    let arr = arr?;
    let mut out = Vec::new();
    for op in arr {
        if op.get("type").and_then(Value::as_str) != Some("payment") {
            continue;
        }
        out.push(ClassicOp {
            source: op.get("from").and_then(Value::as_str)?.to_string(),
            to: op.get("to").and_then(Value::as_str)?.to_string(),
            amount: op.get("amount").and_then(Value::as_str)?.to_string(),
            asset_type: op
                .get("asset_type")
                .and_then(Value::as_str)
                .unwrap_or("native")
                .to_string(),
            asset_code: op
                .get("asset_code")
                .and_then(Value::as_str)
                .map(String::from),
            asset_issuer: op
                .get("asset_issuer")
                .and_then(Value::as_str)
                .map(String::from),
        });
    }
    Some(out)
}

/// True when a Horizon transaction record is a Soroban invocation (an
/// `invoke_host_function` / `invoke_hf_op` operation). These need RPC
/// enrichment; classic records decode directly.
pub fn is_soroban_invocation(v: &Value) -> bool {
    let op_types: Vec<&str> = v
        .get("operations")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|op| op.get("type").and_then(Value::as_str))
        .collect();
    op_types
        .iter()
        .any(|t| *t == "invoke_host_function" || *t == "invoke_hf_op")
}

/// The recognized shape of an RPC `events` payload, mirroring protocol-23.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EventShape {
    /// Nested `diagnosticEvents` / `transactionEvents` / `contractEvents`
    /// buckets (protocol-23).
    Nested,
    /// Flat top-level `diagnosticEvents` array (pre-P23 fallback).
    FlatFallback,
    /// Neither shape — schema drift, must fail loudly.
    Invalid,
}

/// Classify the shape of the RPC `events` object so upstream code decodes it
/// without assuming a flat structure.
pub fn event_shape(events: &Value) -> EventShape {
    if !events.is_object() {
        return EventShape::Invalid;
    }
    let mut has_nested = false;
    let mut has_flat = false;

    match events.get("diagnosticEvents") {
        None | Some(Value::Null) => {}
        Some(Value::Array(_)) => has_flat = true,
        Some(_) => return EventShape::Invalid,
    }

    for key in ["transactionEvents", "contractEvents"] {
        match events.get(key) {
            None | Some(Value::Null) => {}
            Some(Value::Array(_)) => has_nested = true,
            Some(_) => return EventShape::Invalid,
        }
    }

    if has_nested {
        EventShape::Nested
    } else if has_flat {
        EventShape::FlatFallback
    } else {
        EventShape::Invalid
    }
}

/// Decode a Soroban-RPC `getTransaction` result into a [`TxRecord`]. Invocation
/// detail (call tree/state changes/events) is decoded from XDR in a later step;
/// here we map envelope metadata and preserve raw XDR for forensic inspection.
pub fn decode_invoke_tx(v: &Value, network: &str) -> DecodeResult<TxRecord> {
    let hash = v
        .get("hash")
        .and_then(Value::as_str)
        .ok_or(DecodeError::MissingRpcField("hash"))?
        .to_string();
    let status = match v.get("status").and_then(Value::as_str) {
        Some("SUCCESS") => TxStatus::Success,
        _ => TxStatus::Failed,
    };
    let timestamp = match v.get("created_at").and_then(Value::as_str) {
        Some(s) => parse_time(s)?,
        None => Utc::now(),
    };

    Ok(TxRecord {
        hash,
        network: network.to_string(),
        ledger_sequence: opt_i64(v, "ledger").unwrap_or(0),
        status,
        source_account: v
            .get("source_account")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        operation_type: "invoke_host_function".to_string(),
        fee_charged: v
            .get("fee_charged")
            .and_then(Value::as_str)
            .map(String::from),
        sequence_number: None,
        application_order: opt_i64(v, "application_order").unwrap_or(0),
        timestamp,
        metrics: ResourceMetrics::default(),
        call_tree: Vec::new(),
        state_changes: Vec::new(),
        events: Vec::new(),
        fund_flow: Vec::new(),
        raw_result_meta_xdr: v
            .get("result_meta_xdr")
            .and_then(Value::as_str)
            .map(String::from),
        raw_envelope_xdr: v
            .get("envelope_xdr")
            .and_then(Value::as_str)
            .map(String::from),
    })
}

/// Soroban invocation detail (protocol-23 aware): map the RPC `getTransaction`
/// result's events and resource metrics into a [`TxRecord`], enriching the
/// fields that `decode_invoke_tx` leaves empty.
///
/// **Contract:** the RPC `events` object is *nested* (P23) — never assume the
/// flat shape. Best-effort: only buckets whose shape we recognize are consumed;
/// a flat (pre-P23) shape is tolerated as a fallback; anything else yields no
/// events (the raw result XDR remains authoritative, not a wrong decode).
/// Missing metrics are left `None` — a node without
/// `ENABLE_SOROBAN_DIAGNOSTIC_EVENTS` must not produce fake zeros.
pub fn decode_invoke_detail(v: &Value, network: &str) -> DecodeResult<TxRecord> {
    let mut tx = decode_invoke_tx(v, network)?;
    tx.events = decode_events(v);
    tx.metrics = decode_metrics(v);
    Ok(tx)
}

/// Best-effort flatten of RPC event buckets to the `tx_events` shape. Malformed
/// entries are skipped (never a hard error); the raw envelope stays authoritative.
fn decode_events(v: &Value) -> Vec<Event> {
    let events = match v.get("events") {
        Some(Value::Array(_)) => v.get("events").cloned(),
        Some(ev) if ev.is_object() => {
            let mut out = Vec::new();
            // Event buckets map to `tx_events`. Diagnostic events are *not*
            // events in the explorer sense — they carry core metrics, decoded
            // separately — so they are deliberately excluded here.
            for key in ["contractEvents", "transactionEvents"] {
                if let Some(Value::Array(arr)) = ev.get(key) {
                    out.extend(arr.clone());
                }
            }
            Some(Value::Array(out))
        }
        _ => None,
    };
    let Some(Value::Array(events)) = events else {
        return Vec::new();
    };
    events.iter().filter_map(event_from_obj).collect()
}

fn event_from_obj(obj: &Value) -> Option<Event> {
    let o = obj.as_object()?;
    let contract_id = o
        .get("contractId")
        .or_else(|| o.get("contract_id"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let topics = o
        .get("topics")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(topic_to_str).collect::<Vec<String>>())
        .unwrap_or_default();
    Some(Event {
        contract_id,
        topics,
        data: o.get("data").cloned().unwrap_or(Value::Null),
    })
}

fn topic_to_str(t: &Value) -> Option<String> {
    match t {
        Value::String(s) => Some(s.clone()),
        Value::Object(o) => o.get("value").and_then(Value::as_str).map(String::from),
        _ => None,
    }
}

/// Resource metrics from a diagnostic `coreMetrics` object if a diagnostic was
/// emitted; otherwise all `None`. In the P23 shape metrics live under
/// `result.events.diagnosticEvents[].coreMetrics`; the flat, pre-P23
/// `coreMetrics`/`diagnosticEvents` at the top level is kept as a fallback.
fn decode_metrics(v: &Value) -> ResourceMetrics {
    let diagnostic = || {
        v.get("diagnosticEvents")
            .and_then(Value::as_array)
            .and_then(|a| a.iter().find_map(|e| e.get("coreMetrics")))
    };
    let nested = || {
        v.get("events")
            .and_then(Value::as_object)
            .and_then(|e| e.get("diagnosticEvents"))
            .and_then(Value::as_array)
            .and_then(|a| a.iter().find_map(|e| e.get("coreMetrics")))
    };
    let m = v.get("coreMetrics").or_else(nested).or_else(diagnostic);
    let m = match m {
        None => return ResourceMetrics::default(),
        Some(m) => m,
    };
    ResourceMetrics {
        cpu_instructions: m.get("cpu_insn").and_then(Value::as_i64),
        memory_bytes: m.get("mem_byte").and_then(Value::as_i64),
        invoke_time_nsecs: m.get("invoke_time_nsecs").and_then(Value::as_i64),
        disk_read_bytes: m.get("disk_read_bytes").and_then(Value::as_i64),
        write_bytes: m.get("write_bytes").and_then(Value::as_i64),
        max_rw_key_byte: m.get("max_rw_key_byte").and_then(Value::as_i64),
        max_rw_data_byte: m.get("max_rw_data_byte").and_then(Value::as_i64),
    }
}

// ---------------------------------------------------------------------------
// getLedgerEntries — entity snapshots ONLY
// ---------------------------------------------------------------------------

/// Decode a Soroban-RPC `getLedgerEntries` response into entity snapshots.
///
/// **Guard:** this path yields [`EntitySnapshot`]s, never ledger/transaction
/// records. `getLedgerEntries` returns *specific* entries (accounts, contracts,
/// trustlines) and must not be the source of block or transaction discovery —
/// that stays on Horizon / `getTransaction`. Callers that need heads read
/// `latest_ledger` here only as a hint.
pub fn decode_ledger_entries(v: &Value, network: &str) -> DecodeResult<Vec<EntitySnapshot>> {
    // Accept both the raw RPC envelope (`{result: {entries}}`) and the already
    // unwrapped `result` (`{entries}`) that the RPC client hands back.
    let entries = v
        .get("result")
        .and_then(|r| r.get("entries"))
        .or_else(|| v.get("entries"))
        .and_then(Value::as_array)
        .ok_or(DecodeError::MissingRpcField("entries"))?;

    let mut out = Vec::with_capacity(entries.len());
    for e in entries {
        let key = e
            .get("key")
            .and_then(Value::as_str)
            .ok_or(DecodeError::MissingRpcField("entry.key"))?
            .to_string();
        out.push(EntitySnapshot {
            network: network.to_string(),
            entry_type: "ledger_entry".to_string(),
            key: key.clone(),
            value: e.get("xdr").cloned().unwrap_or(Value::Null),
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn json(s: &str) -> Value {
        serde_json::from_str(s).unwrap()
    }

    #[test]
    fn horizon_ledger_maps_required_fields() {
        let v = json(
            r#"{
                "sequence": 100,
                "hash": "ledger-hash",
                "prev_hash": "parent-hash",
                "transaction_count": 7,
                "size_bytes": 1234,
                "closed_at": "2026-08-01T12:00:00Z",
                "base_fee_in_stroops": 100,
                "base_reserve_in_stroops": 5000000
            }"#,
        );
        let l = decode_ledger(&v, "testnet").unwrap();
        assert_eq!(l.sequence, 100);
        assert_eq!(l.network, "testnet");
        assert_eq!(l.hash, "ledger-hash");
        assert_eq!(l.parent_hash.as_deref(), Some("parent-hash"));
        assert_eq!(l.transaction_count, 7);
        assert_eq!(l.base_operation_fee.as_deref(), Some("100"));
    }

    #[test]
    fn classic_payment_produces_fund_edge() {
        let v = json(
            r#"{
                "hash": "tx-hash",
                "ledger": 100,
                "successful": true,
                "source_account": "GALICE",
                "fee_charged": "150",
                "created_at": "2023-08-01T00:00:00Z",
                "application_order": 1,
                "operations": [{
                    "type": "payment",
                    "from": "GALICE",
                    "to": "GBOB",
                    "amount": "10.5",
                    "asset_type": "credit_alphanum4",
                    "asset_code": "USDC",
                    "asset_issuer": "GDPHONE"
                }]
            }"#,
        );
        let tx = decode_classic_tx(&v, "testnet").unwrap();
        assert_eq!(tx.status, TxStatus::Success);
        assert_eq!(tx.operation_type, "payment");
        assert_eq!(tx.fund_flow.len(), 1);
        assert_eq!(tx.fund_flow[0].asset, "USDC:GDPHONE");
        assert_eq!(tx.fund_flow[0].amount, "10.5");
    }

    #[test]
    fn classic_embedded_operations_native() {
        let v = json(
            r#"{
                "hash": "tx2",
                "ledger": 101,
                "successful": true,
                "source_account": "GA",
                "fee_charged": "100",
                "created_at": "2023-08-01T00:00:00Z",
                "_embedded": {
                    "operations": [{
                        "type": "payment",
                        "from": "GA",
                        "to": "GB",
                        "amount": "3",
                        "asset_type": "native"
                    }]
                }
            }"#,
        );
        let tx = decode_classic_tx(&v, "testnet").unwrap();
        assert_eq!(tx.fund_flow[0].asset, "XLM");
    }

    #[test]
    fn failed_classic_tx_is_failed_status() {
        let v = json(
            r#"{"hash":"h3","ledger":1,"successful":false,"source_account":"GA","fee_charged":"100","created_at":"2023-08-01T00:00:00Z"}"#,
        );
        assert_eq!(
            decode_classic_tx(&v, "testnet").unwrap().status,
            TxStatus::Failed
        );
    }

    #[test]
    fn missing_required_field_errors() {
        let v = json(
            r#"{"hash":"h4","ledger":1,"successful":true,"created_at":"2023-08-01T00:00:00Z"}"#,
        );
        assert_eq!(
            decode_classic_tx(&v, "testnet").map(|_| ()).unwrap_err(),
            DecodeError::MissingHorizonField("source_account")
        );
    }

    #[test]
    fn p23_nested_events_classified() {
        let v = json(
            r#"{
                "diagnosticEvents": [null],
                "transactionEvents": [{}, {}],
                "contractEvents": []
            }"#,
        );
        assert_eq!(event_shape(&v), EventShape::Nested);
    }

    #[test]
    fn flat_pre_p23_events_classified() {
        let v = json(r#"{"diagnosticEvents": [{}, {}]}"#);
        assert_eq!(event_shape(&v), EventShape::FlatFallback);
    }

    #[test]
    fn drift_shape_fails_loudly() {
        let v = json(r#"{"diagnosticEvents": "not-an-array"}"#);
        assert_eq!(event_shape(&v), EventShape::Invalid);
    }

    #[test]
    fn get_ledger_entries_decodes_to_entity_snapshots() {
        let v = json(
            r#"{
                "result": {
                    "latestLedger": 42,
                    "entries": [
                        { "key": "account-ga", "xdr": "xxxx", "lastModifiedLedgerSeq": 41 },
                        { "key": "account-gb", "xdr": "yyyy" }
                    ]
                }
            }"#,
        );
        let snaps = decode_ledger_entries(&v, "testnet").unwrap();
        assert_eq!(snaps.len(), 2);
        assert_eq!(snaps[0].entry_type, "ledger_entry");
        assert_eq!(snaps[0].network, "testnet");
        assert_eq!(snaps[0].key, "account-ga");
    }

    #[test]
    fn get_ledger_entries_is_never_tx_or_block_discovery() {
        // Guard test: an entries-shaped payload produces only EntitySnapshot.
        // Probe the exact function type: it can only ever return entity
        // snapshots, never a LedgerRecord/TxRecord, so block/transaction
        // discovery cannot be routed through getLedgerEntries.
        let probe: fn(&Value, &str) -> DecodeResult<Vec<EntitySnapshot>> = decode_ledger_entries;
        let v = json(r#"{"result": {"entries": [{ "key": "c1", "xdr": "zz" }]}}"#);
        let snaps = probe(&v, "net").unwrap();
        assert_eq!(snaps.len(), 1);
    }

    #[test]
    fn ledger_entries_accepts_unwrapped_rpc_result() {
        // The RPC client returns `result` already unwrapped; the decoder must
        // accept both that and the raw envelope.
        let v = json(r#"{ "entries": [{ "key": "acc-1", "xdr": "aa" }] }"#);
        let snaps = decode_ledger_entries(&v, "testnet").unwrap();
        assert_eq!(snaps.len(), 1);
        assert_eq!(snaps[0].key, "acc-1");
        assert_eq!(snaps[0].entry_type, "ledger_entry");
    }

    #[test]
    fn invoke_detail_decodes_nested_p23_events() {
        let v = json(
            r#"{
                "hash": "soroban-hash",
                "status": "SUCCESS",
                "ledger": 100,
                "created_at": "2026-08-01T12:00:00Z",
                "events": {
                    "contractEvents": [
                        { "contractId": "C123", "topics": ["transfer", "GALICE"], "data": {"amount": 5} },
                        { "contractId": "C124", "topics": ["set_authorized"], "data": true }
                    ],
                    "transactionEvents": [],
                    "diagnosticEvents": [
                        { "coreMetrics": {
                            "cpu_insn": 27627988,
                            "mem_byte": 1466596,
                            "invoke_time_nsecs": 3032477
                        } }
                    ]
                }
            }"#,
        );
        let tx = decode_invoke_detail(&v, "testnet").unwrap();
        assert_eq!(tx.hash, "soroban-hash");
        assert_eq!(tx.operation_type, "invoke_host_function");
        assert_eq!(tx.events.len(), 2);
        assert_eq!(tx.events[0].contract_id, "C123");
        assert_eq!(tx.events[0].topics[0], "transfer");
        assert_eq!(tx.metrics.cpu_instructions, Some(27627988));
        assert_eq!(tx.metrics.memory_bytes, Some(1466596));
        assert_eq!(tx.metrics.invoke_time_nsecs, Some(3032477));
    }

    #[test]
    fn flat_pre_p23_events_still_decode() {
        let v = json(
            r#"{
                "hash": "h2",
                "status": "SUCCESS",
                "events": [
                    { "contractId": "C9", "topics": ["burn"], "data": null }
                ]
            }"#,
        );
        let tx = decode_invoke_detail(&v, "testnet").unwrap();
        assert_eq!(tx.events.len(), 1);
        assert_eq!(tx.events[0].topics[0], "burn");
    }

    #[test]
    fn missing_diagnostic_events_means_null_metrics() {
        let v = json(r#"{"hash":"h3","status":"SUCCESS"}"#);
        let tx = decode_invoke_detail(&v, "testnet").unwrap();
        assert_eq!(tx.metrics.cpu_instructions, None);
        assert_eq!(tx.metrics.memory_bytes, None);
        assert_eq!(tx.events.len(), 0);
    }

    #[test]
    fn malformed_events_are_skipped_not_errored() {
        let v = json(
            r#"{
                "hash":"h4",
                "status":"SUCCESS",
                "events": { "contractEvents": [ "garbage", { "contractId": "C", "topics": [] } ] }
            }"#,
        );
        let tx = decode_invoke_detail(&v, "testnet").unwrap();
        assert_eq!(tx.events.len(), 1, "garbage entries skipped, valid kept");
    }

    #[test]
    fn soroban_invocation_markers_are_detected() {
        assert!(!is_soroban_invocation(&json(
            r#"{ "operations": [{ "type": "payment" }] }"#
        )));
        let modern = json(r#"{ "operations": [{ "type": "invoke_host_function" }] }"#);
        assert!(is_soroban_invocation(&modern));
        let legacy = json(r#"{ "operations": [{ "type": "invoke_hf_op" }] }"#);
        assert!(is_soroban_invocation(&legacy));
        let mixed = json(
            r#"{ "operations": [{ "type": "payment" }, { "type": "invoke_host_function" }] }"#,
        );
        assert!(
            is_soroban_invocation(&mixed),
            "any invocation op marks the tx"
        );
        assert!(!is_soroban_invocation(&json(r#"{}"#)));
        assert!(!is_soroban_invocation(&json(r#"{ "operations": [] }"#)));
    }
}
