//! Soroban-RPC client for the **second** ingestion path and for entity
//! snapshots. Distinct from the Horizon client by design (phase2 §Ingestion):
//!
//! - `getTransaction(hash)` → decoded invocation detail.
//! - `getEvents` → filtered contract events (the transfer feed).
//! - `getLedgerEntries(keys)` → **specific entries only** (accounts/contracts/
//!   trustlines). It returns entries for keys you name — it does **not**
//!   enumerate ledgers or transactions, so it is never used for block/tx
//!   discovery (a guard test pins this down in `decode`).
//!
//! Shares the same upstream politeness (backoff + circuit breaker) as Horizon.

use serde_json::{Value, json};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::upstream::{Backoff, CircuitBreaker, FetchError, Reachable, fetch_with_policy};

pub struct SorobanRpcClient {
    http: reqwest::Client,
    base: String,
    breaker: CircuitBreaker,
    backoff: Backoff,
    next_id: AtomicU64,
}

impl SorobanRpcClient {
    pub fn new(base: impl Into<String>, backoff: Backoff, breaker: CircuitBreaker) -> Self {
        Self {
            http: reqwest::Client::new(),
            base: base.into(),
            breaker,
            backoff,
            next_id: AtomicU64::new(1),
        }
    }

    fn build(&self, method: &str, params: Value) -> Value {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        })
    }

    async fn post_json(&mut self, method: &str, params: Value) -> Result<Value, FetchError> {
        let http = self.http.clone();
        let url = self.base.clone();
        let body =
            serde_json::to_string(&self.build(method, params)).unwrap_or_else(|_| "{}".into());
        fetch_with_policy(&mut self.breaker, &self.backoff, move || {
            let http = http.clone();
            let url = url.clone();
            let body = body.clone();
            async move {
                match http
                    .post(&url)
                    .json(&serde_json::from_str::<Value>(&body).unwrap())
                    .send()
                    .await
                {
                    Ok(resp) if resp.status().is_success() => match resp.json::<Value>().await {
                        Ok(v) => Reachable::Success(v),
                        Err(_) => Reachable::Retryable,
                    },
                    Ok(resp) if resp.status().is_client_error() => Reachable::NonRetryable,
                    Ok(_) | Err(_) => Reachable::Retryable,
                }
            }
        })
        .await
    }

    /// RPC standard envelope: `{ result?: T, error?: {message, code} }`.
    fn result(v: Value) -> Result<Value, FetchError> {
        if let Some(err) = v.get("error") {
            tracing::warn!(error = %err, "soroban rpc error");
            return Err(FetchError::NonRetryable);
        }
        v.get("result").cloned().ok_or(FetchError::NonRetryable)
    }

    /// Submit a JSON-RPC call returning the `result` object.
    pub async fn call(&mut self, method: &str, params: Value) -> Result<Value, FetchError> {
        let body = self.post_json(method, params).await?;
        Self::result(body)
    }

    /// `getTransaction` — full decoded invocation detail for one hash.
    pub async fn get_transaction(&mut self, hash: &str) -> Result<Value, FetchError> {
        let result = self.call("getTransaction", json!({ "hash": hash })).await?;
        Self::post_get_transaction(result)
    }

    /// Maps a `getTransaction` result to a fetch outcome. A result `status` of
    /// `NOT_FOUND` is a definitive impossibility (the hash is unknown to that
    /// node) — a retry will never succeed, so it is `NonRetryable`. `PENDING`
    /// and success pass through for the caller to interpret.
    fn post_get_transaction(result: Value) -> Result<Value, FetchError> {
        if result.get("status").and_then(Value::as_str) == Some("NOT_FOUND") {
            return Err(FetchError::NonRetryable);
        }
        Ok(result)
    }

    /// `getLedgerEntries` — **specific keys only**, used for entity snapshots.
    pub async fn get_ledger_entries(&mut self, keys: &[&str]) -> Result<Value, FetchError> {
        let keyvals: Vec<Value> = keys.iter().map(|k| json!({ "key": k })).collect();
        self.call("getLedgerEntries", json!({ "keys": keyvals }))
            .await
    }

    /// `getEvents` — contract event logs for a range (enriching invocation
    /// detail). Passed to the caller as params chosen by the worker.
    pub async fn get_events(&mut self, params: Value) -> Result<Value, FetchError> {
        self.call("getEvents", params).await
    }

    /// `getLatestLedger` — a lightweight latest-ledger hint (not discovery).
    pub async fn get_latest_ledger(&mut self) -> Result<Value, FetchError> {
        self.call("getLatestLedger", json!({})).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_envelope_carries_method_and_params() {
        let c = SorobanRpcClient::new(
            "http://example.test",
            Backoff {
                base: std::time::Duration::from_millis(1),
                max: std::time::Duration::from_millis(5),
                jitter: 0.0,
                max_attempts: 2,
            },
            CircuitBreaker::new(3, std::time::Duration::from_millis(100)),
        );
        let req = c.build("getTransaction", json!({ "hash": "abc" }));
        assert_eq!(req["method"], "getTransaction");
        assert_eq!(req["params"]["hash"], "abc");
        assert!(req["id"].as_u64().is_some());
    }

    #[test]
    fn rpc_error_maps_to_non_retryable() {
        let out =
            SorobanRpcClient::result(json!({ "error": { "code": -32601, "message": "nope" } }));
        assert_eq!(out, Err(FetchError::NonRetryable));
        assert!(SorobanRpcClient::result(json!({ "result": { "foo": 1 } })).is_ok());
    }

    #[test]
    fn not_found_transaction_is_non_retryable() {
        assert_eq!(
            SorobanRpcClient::post_get_transaction(json!({ "status": "NOT_FOUND" })),
            Err(FetchError::NonRetryable)
        );
        // PENDING and SUCCESS are not the caller's error to raise.
        assert!(SorobanRpcClient::post_get_transaction(json!({ "status": "PENDING" })).is_ok());
        assert!(SorobanRpcClient::post_get_transaction(json!({ "status": "SUCCESS" })).is_ok());
    }
}
