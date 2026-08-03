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
use crate::models::{FundFlowEdge, LedgerRecord, ResourceMetrics, TxRecord, TxStatus};

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
}
