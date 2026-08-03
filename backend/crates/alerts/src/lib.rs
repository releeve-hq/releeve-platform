//! `alerts` - monitoring rule evaluation and delivery helpers (Phase 4).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::time::Duration;

pub const DELIVERY_BACKOFF_SECONDS: [i64; 5] = [30, 60, 120, 240, 480];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchLogic {
    All,
    Any,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TargetType {
    Address,
    Network,
    Project,
    Tag,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AlertTarget {
    #[serde(rename = "type")]
    pub target_type: TargetType,
    pub value: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExpressionType {
    SuccessfulTransaction,
    FailedTransaction,
    TxError,
    FunctionCall,
    FunctionParams,
    EventEmitted,
    EventParameter,
    TokenTransfer,
    AllowlistedCallers,
    BlocklistedCallers,
    BalanceChange,
    TransactionValue,
    StateChange,
    ViewFunction,
    NoAction,
    TokenTransferMatcher,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AlertExpression {
    #[serde(rename = "type")]
    pub expression_type: ExpressionType,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TransactionFacts {
    pub hash: String,
    pub network: String,
    pub status: String,
    pub ledger: i64,
    pub timestamp: DateTime<Utc>,
    pub source_account: String,
    pub operation_type: String,
    pub fee_charged: Option<String>,
    #[serde(default)]
    pub call_tree: Vec<CallNode>,
    #[serde(default)]
    pub events: Vec<EventRecord>,
    #[serde(default)]
    pub state_changes: Vec<StateChangeRecord>,
    #[serde(default)]
    pub fund_flow: Vec<FundFlowEdge>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CallNode {
    pub contract_id: String,
    pub function_name: String,
    #[serde(default)]
    pub args: Value,
    #[serde(default)]
    pub return_value: Option<Value>,
    pub depth: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EventRecord {
    pub contract_id: String,
    #[serde(default)]
    pub topics: Value,
    #[serde(default)]
    pub data: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StateChangeRecord {
    pub entry_type: String,
    pub key: String,
    #[serde(default)]
    pub before: Option<Value>,
    #[serde(default)]
    pub after: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FundFlowEdge {
    pub from: String,
    pub to: String,
    pub asset: String,
    pub amount: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EvaluationOutcome {
    pub matched: bool,
    pub expression_results: Vec<bool>,
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum AlertError {
    #[error("invalid alert: {0}")]
    Invalid(String),
    #[error("view function failed: {0}")]
    ViewFunction(String),
    #[error("delivery failed: {0}")]
    Delivery(String),
}

#[async_trait::async_trait]
pub trait ViewFunctionRunner: Send + Sync {
    async fn simulate_view_function(&self, params: &Value) -> Result<Value, AlertError>;
}

pub struct SorobanRpcViewRunner {
    client: reqwest::Client,
    rpc_url: String,
}

impl SorobanRpcViewRunner {
    pub fn new(rpc_url: impl Into<String>) -> Self {
        Self {
            client: reqwest::Client::new(),
            rpc_url: rpc_url.into(),
        }
    }
}

#[async_trait::async_trait]
impl ViewFunctionRunner for SorobanRpcViewRunner {
    async fn simulate_view_function(&self, params: &Value) -> Result<Value, AlertError> {
        if self.rpc_url.trim().is_empty() {
            return Err(AlertError::ViewFunction("soroban RPC URL is empty".into()));
        }
        let tx = params
            .get("transaction")
            .or_else(|| params.get("tx"))
            .cloned()
            .unwrap_or_else(|| {
                json!({
                    "contract_id": params.get("contract_id"),
                    "function_name": params.get("function_name"),
                    "args": params.get("args").cloned().unwrap_or(Value::Array(vec![]))
                })
            });
        let envelope = json!({
            "jsonrpc": "2.0",
            "id": "releeve-alert-view-function",
            "method": "simulateTransaction",
            "params": { "transaction": tx }
        });
        let res = self
            .client
            .post(&self.rpc_url)
            .json(&envelope)
            .send()
            .await
            .map_err(|e| AlertError::ViewFunction(e.to_string()))?;
        let status = res.status();
        let body: Value = res
            .json()
            .await
            .map_err(|e| AlertError::ViewFunction(e.to_string()))?;
        if !status.is_success() {
            return Err(AlertError::ViewFunction(format!("RPC returned {status}")));
        }
        Ok(body.get("result").cloned().unwrap_or(body))
    }
}

pub async fn evaluate_alert(
    expressions: &[AlertExpression],
    logic: MatchLogic,
    tx: &TransactionFacts,
    view_runner: Option<&dyn ViewFunctionRunner>,
) -> Result<EvaluationOutcome, AlertError> {
    if expressions.is_empty() {
        return Err(AlertError::Invalid(
            "at least one expression is required".into(),
        ));
    }
    let mut results = Vec::with_capacity(expressions.len());
    for expression in expressions {
        let result = evaluate_expression(expression, tx, view_runner).await?;
        results.push(result);
    }
    let matched = match logic {
        MatchLogic::All => results.iter().all(|r| *r),
        MatchLogic::Any => results.iter().any(|r| *r),
    };
    Ok(EvaluationOutcome {
        matched,
        expression_results: results,
    })
}

pub async fn evaluate_expression(
    expression: &AlertExpression,
    tx: &TransactionFacts,
    view_runner: Option<&dyn ViewFunctionRunner>,
) -> Result<bool, AlertError> {
    let p = &expression.params;
    Ok(match expression.expression_type {
        ExpressionType::SuccessfulTransaction => tx.status.eq_ignore_ascii_case("success"),
        ExpressionType::FailedTransaction => tx.status.eq_ignore_ascii_case("failed"),
        ExpressionType::TxError => {
            tx.status.eq_ignore_ascii_case("failed")
                || p.get("error")
                    .is_some_and(|needle| value_contains(&json!(tx), needle))
        }
        ExpressionType::FunctionCall => tx.call_tree.iter().any(|node| {
            string_param_matches(p, "contract_id", &node.contract_id)
                && string_param_matches(p, "function_name", &node.function_name)
        }),
        ExpressionType::FunctionParams => tx.call_tree.iter().any(|node| {
            string_param_matches(p, "contract_id", &node.contract_id)
                && string_param_matches(p, "function_name", &node.function_name)
                && param_object_matches(&node.args, p.get("params").or_else(|| p.get("args")))
        }),
        ExpressionType::EventEmitted => tx.events.iter().any(|event| {
            string_param_matches(p, "contract_id", &event.contract_id)
                && optional_contains(p.get("topic"), &event.topics)
        }),
        ExpressionType::EventParameter => tx.events.iter().any(|event| {
            string_param_matches(p, "contract_id", &event.contract_id)
                && optional_contains(p.get("topic"), &event.topics)
                && param_object_matches(&event.data, p.get("params").or_else(|| p.get("data")))
        }),
        ExpressionType::TokenTransfer => tx.fund_flow.iter().any(|edge| transfer_matches(p, edge)),
        ExpressionType::AllowlistedCallers => {
            let allowed = address_set(p, "addresses");
            allowed.is_empty() || allowed.contains(&tx.source_account)
        }
        ExpressionType::BlocklistedCallers => {
            let blocked = address_set(p, "addresses");
            blocked.contains(&tx.source_account)
        }
        ExpressionType::BalanceChange | ExpressionType::TransactionValue => tx
            .fund_flow
            .iter()
            .filter(|edge| transfer_matches(p, edge))
            .any(|edge| numeric_condition(edge.amount.parse::<f64>().ok(), p)),
        ExpressionType::StateChange => tx.state_changes.iter().any(|change| {
            string_param_matches(p, "entry_type", &change.entry_type)
                && string_param_matches(p, "storage_key", &change.key)
                && string_param_matches(p, "key", &change.key)
                && state_condition_matches(change, p)
        }),
        ExpressionType::ViewFunction => {
            let runner = view_runner.ok_or_else(|| {
                AlertError::ViewFunction("view_function expression requires a runner".into())
            })?;
            let result = runner.simulate_view_function(p).await?;
            value_condition_matches(&result, p.get("condition"))
        }
        ExpressionType::NoAction => false,
        ExpressionType::TokenTransferMatcher => token_transfer_matcher(tx, p),
    })
}

pub fn no_action_should_fire(
    last_activity: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
    inactivity_window_seconds: i64,
) -> bool {
    match last_activity {
        None => true,
        Some(last) => now.signed_duration_since(last).num_seconds() >= inactivity_window_seconds,
    }
}

fn string_param_matches(params: &Value, key: &str, actual: &str) -> bool {
    match params.get(key).and_then(Value::as_str) {
        Some(expected) => expected.eq_ignore_ascii_case(actual),
        None => true,
    }
}

fn optional_contains(needle: Option<&Value>, haystack: &Value) -> bool {
    match needle {
        None => true,
        Some(needle) => value_contains(haystack, needle),
    }
}

fn value_contains(haystack: &Value, needle: &Value) -> bool {
    if haystack == needle {
        return true;
    }
    match haystack {
        Value::String(s) => needle.as_str().is_some_and(|n| s.contains(n)),
        Value::Array(items) => items.iter().any(|v| value_contains(v, needle)),
        Value::Object(map) => map.values().any(|v| value_contains(v, needle)),
        _ => false,
    }
}

fn param_object_matches(actual: &Value, expected: Option<&Value>) -> bool {
    let Some(expected) = expected else {
        return true;
    };
    match expected {
        Value::Object(map) => map
            .iter()
            .all(|(key, val)| actual.get(key).is_some_and(|a| value_contains(a, val))),
        _ => value_contains(actual, expected),
    }
}

fn address_set(params: &Value, key: &str) -> HashSet<String> {
    params
        .get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(ToOwned::to_owned)
        .collect()
}

fn transfer_matches(params: &Value, edge: &FundFlowEdge) -> bool {
    string_param_matches(params, "from", &edge.from)
        && string_param_matches(params, "to", &edge.to)
        && string_param_matches(params, "asset", &edge.asset)
}

fn numeric_condition(value: Option<f64>, params: &Value) -> bool {
    let Some(value) = value else {
        return false;
    };
    let min = params
        .get("min")
        .or_else(|| params.get("threshold"))
        .and_then(Value::as_f64);
    let max = params.get("max").and_then(Value::as_f64);
    min.is_none_or(|m| value >= m) && max.is_none_or(|m| value <= m)
}

fn state_condition_matches(change: &StateChangeRecord, params: &Value) -> bool {
    let condition = params.get("condition");
    if condition.is_none() {
        return change.before != change.after;
    }
    value_condition_matches(
        &json!({ "before": change.before, "after": change.after }),
        condition,
    )
}

fn value_condition_matches(value: &Value, condition: Option<&Value>) -> bool {
    let Some(condition) = condition else {
        return true;
    };
    if let Some(expected) = condition.get("equals") {
        return value_contains(value, expected);
    }
    if condition
        .get("any_change")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return value.get("before") != value.get("after");
    }
    let selected = condition
        .get("path")
        .and_then(Value::as_str)
        .and_then(|path| select_path(value, path))
        .unwrap_or(value);
    let numeric = selected
        .as_f64()
        .or_else(|| selected.as_str()?.parse().ok());
    numeric_condition(numeric, condition)
}

fn select_path<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = value;
    for part in path.split('.') {
        current = current.get(part)?;
    }
    Some(current)
}

fn token_transfer_matcher(tx: &TransactionFacts, params: &Value) -> bool {
    let asset = params.get("asset").and_then(Value::as_str);
    let event_mentions_transfer = tx.events.iter().any(|event| {
        optional_contains(Some(&Value::String("transfer".into())), &event.topics)
            && asset.is_none_or(|a| value_contains(&event.data, &Value::String(a.into())))
    });
    let flow_mentions_asset = tx
        .fund_flow
        .iter()
        .any(|edge| asset.is_none_or(|a| edge.asset.eq_ignore_ascii_case(a)));
    event_mentions_transfer == flow_mentions_asset
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryStatus {
    Success,
    Failed,
    Pending,
    Retry,
    Skipped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DestinationKind {
    Email,
    Slack,
    Telegram,
    Discord,
    Sentry,
    Pagerduty,
    Webhook,
    Action,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeliveryPayload {
    pub event_type: String,
    pub alert_id: Option<String>,
    pub tx_hash: Option<String>,
    pub simulation_id: Option<String>,
    pub project_id: Option<String>,
    pub fired_at: DateTime<Utc>,
    #[serde(default)]
    pub data: Value,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeliveryAttempt {
    pub status: DeliveryStatus,
    pub response_code: Option<u16>,
    pub should_retry: bool,
}

pub fn webhook_signature(secret: &str, payload: &str, timestamp: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    hasher.update(payload.as_bytes());
    hasher.update(timestamp.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn next_backoff_seconds(attempt: i32) -> Option<i64> {
    if attempt <= 0 {
        return Some(DELIVERY_BACKOFF_SECONDS[0]);
    }
    DELIVERY_BACKOFF_SECONDS
        .get((attempt - 1) as usize)
        .copied()
}

pub fn delivery_body(payload: &DeliveryPayload) -> Result<String, AlertError> {
    serde_json::to_string(payload).map_err(|e| AlertError::Delivery(e.to_string()))
}

pub async fn health_probe(url: &str, timeout_seconds: u64) -> Result<(), AlertError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_seconds))
        .build()
        .map_err(|e| AlertError::Delivery(e.to_string()))?;
    let res = client
        .get(url)
        .send()
        .await
        .map_err(|e| AlertError::Delivery(e.to_string()))?;
    if res.status().is_success() {
        Ok(())
    } else {
        Err(AlertError::Delivery(format!(
            "health probe returned {}",
            res.status()
        )))
    }
}

pub async fn post_json_delivery(
    url: &str,
    signing_secret: Option<&str>,
    payload: &DeliveryPayload,
    timeout_seconds: u64,
) -> Result<DeliveryAttempt, AlertError> {
    let body = delivery_body(payload)?;
    let timestamp = Utc::now().timestamp().to_string();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_seconds))
        .build()
        .map_err(|e| AlertError::Delivery(e.to_string()))?;
    let mut req = client
        .post(url)
        .header("content-type", "application/json")
        .header("x-releeve-timestamp", &timestamp)
        .body(body.clone());
    if let Some(secret) = signing_secret {
        req = req.header(
            "x-releeve-signature",
            webhook_signature(secret, &body, &timestamp),
        );
    }
    let res = req
        .send()
        .await
        .map_err(|e| AlertError::Delivery(e.to_string()))?;
    let code = res.status().as_u16();
    Ok(DeliveryAttempt {
        status: if res.status().is_success() {
            DeliveryStatus::Success
        } else {
            DeliveryStatus::Retry
        },
        response_code: Some(code),
        should_retry: !res.status().is_success(),
    })
}

pub async fn deliver_http_destination(
    kind: DestinationKind,
    config: &Value,
    payload: &DeliveryPayload,
) -> Result<DeliveryAttempt, AlertError> {
    match kind {
        DestinationKind::Email => Ok(DeliveryAttempt {
            status: DeliveryStatus::Pending,
            response_code: None,
            should_retry: false,
        }),
        DestinationKind::Slack | DestinationKind::Discord => {
            let url = config
                .get("webhook_url")
                .and_then(Value::as_str)
                .ok_or_else(|| AlertError::Delivery("missing webhook_url".into()))?;
            post_json_delivery(url, None, payload, 5).await
        }
        DestinationKind::Telegram => {
            let token = config
                .get("bot_token")
                .and_then(Value::as_str)
                .ok_or_else(|| AlertError::Delivery("missing bot_token".into()))?;
            let chat_id = config
                .get("chat_id")
                .and_then(Value::as_str)
                .ok_or_else(|| AlertError::Delivery("missing chat_id".into()))?;
            let url = format!("https://api.telegram.org/bot{token}/sendMessage");
            let wrapped = DeliveryPayload {
                data: json!({ "chat_id": chat_id, "text": delivery_body(payload)? }),
                ..payload.clone()
            };
            post_json_delivery(&url, None, &wrapped, 5).await
        }
        DestinationKind::Sentry => {
            let dsn = config
                .get("dsn")
                .and_then(Value::as_str)
                .ok_or_else(|| AlertError::Delivery("missing dsn".into()))?;
            post_json_delivery(dsn, None, payload, 5).await
        }
        DestinationKind::Pagerduty => {
            let url = "https://events.pagerduty.com/v2/enqueue";
            let key = config
                .get("integration_key")
                .and_then(Value::as_str)
                .ok_or_else(|| AlertError::Delivery("missing integration_key".into()))?;
            let wrapped = DeliveryPayload {
                data: json!({
                    "routing_key": key,
                    "event_action": "trigger",
                    "payload": {
                        "summary": "Releeve alert fired",
                        "source": "releeve",
                        "severity": "error",
                        "custom_details": payload
                    }
                }),
                ..payload.clone()
            };
            post_json_delivery(url, None, &wrapped, 5).await
        }
        DestinationKind::Webhook => {
            let url = config
                .get("url")
                .or_else(|| config.get("webhook_url"))
                .and_then(Value::as_str)
                .ok_or_else(|| AlertError::Delivery("missing url".into()))?;
            let secret = config.get("signing_secret").and_then(Value::as_str);
            let timeout = config
                .get("timeout_seconds")
                .and_then(Value::as_u64)
                .unwrap_or(5);
            post_json_delivery(url, secret, payload, timeout).await
        }
        DestinationKind::Action => Ok(DeliveryAttempt {
            status: DeliveryStatus::Skipped,
            response_code: None,
            should_retry: false,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn tx() -> TransactionFacts {
        TransactionFacts {
            hash: "tx1".into(),
            network: "testnet".into(),
            status: "success".into(),
            ledger: 10,
            timestamp: Utc.timestamp_opt(100, 0).unwrap(),
            source_account: "GBLOCKED".into(),
            operation_type: "invoke_host_function".into(),
            fee_charged: Some("100".into()),
            call_tree: vec![CallNode {
                contract_id: "CCONTRACT".into(),
                function_name: "liquidate".into(),
                args: json!({ "amount": 42, "asset": "XLM" }),
                return_value: Some(json!({ "ok": true })),
                depth: 0,
            }],
            events: vec![EventRecord {
                contract_id: "CCONTRACT".into(),
                topics: json!(["transfer", "XLM"]),
                data: json!({ "amount": 42, "asset": "XLM" }),
            }],
            state_changes: vec![StateChangeRecord {
                entry_type: "contract_data".into(),
                key: "balance:GBLOCKED".into(),
                before: Some(json!(1)),
                after: Some(json!(43)),
            }],
            fund_flow: vec![FundFlowEdge {
                from: "GBLOCKED".into(),
                to: "GALICE".into(),
                asset: "XLM".into(),
                amount: "42".into(),
            }],
        }
    }

    #[tokio::test]
    async fn expression_matchers_cover_core_positive_paths() {
        let expressions = vec![
            AlertExpression {
                expression_type: ExpressionType::SuccessfulTransaction,
                params: json!({}),
            },
            AlertExpression {
                expression_type: ExpressionType::FunctionCall,
                params: json!({ "function_name": "liquidate" }),
            },
            AlertExpression {
                expression_type: ExpressionType::FunctionParams,
                params: json!({ "params": { "asset": "XLM" } }),
            },
            AlertExpression {
                expression_type: ExpressionType::EventEmitted,
                params: json!({ "topic": "transfer" }),
            },
            AlertExpression {
                expression_type: ExpressionType::EventParameter,
                params: json!({ "data": { "asset": "XLM" } }),
            },
            AlertExpression {
                expression_type: ExpressionType::TokenTransfer,
                params: json!({ "asset": "XLM", "to": "GALICE" }),
            },
            AlertExpression {
                expression_type: ExpressionType::BlocklistedCallers,
                params: json!({ "addresses": ["GBLOCKED"] }),
            },
            AlertExpression {
                expression_type: ExpressionType::BalanceChange,
                params: json!({ "asset": "XLM", "min": 40 }),
            },
            AlertExpression {
                expression_type: ExpressionType::TransactionValue,
                params: json!({ "asset": "XLM", "threshold": 42 }),
            },
            AlertExpression {
                expression_type: ExpressionType::StateChange,
                params: json!({ "storage_key": "balance:GBLOCKED", "condition": { "any_change": true } }),
            },
            AlertExpression {
                expression_type: ExpressionType::TokenTransferMatcher,
                params: json!({ "asset": "XLM" }),
            },
        ];
        let outcome = evaluate_alert(&expressions, MatchLogic::All, &tx(), None)
            .await
            .unwrap();
        assert!(outcome.matched);
    }

    #[tokio::test]
    async fn match_logic_any_and_all_are_distinct() {
        let expressions = vec![
            AlertExpression {
                expression_type: ExpressionType::FunctionCall,
                params: json!({ "function_name": "missing" }),
            },
            AlertExpression {
                expression_type: ExpressionType::TokenTransfer,
                params: json!({ "asset": "XLM" }),
            },
        ];
        assert!(
            evaluate_alert(&expressions, MatchLogic::Any, &tx(), None)
                .await
                .unwrap()
                .matched
        );
        assert!(
            !evaluate_alert(&expressions, MatchLogic::All, &tx(), None)
                .await
                .unwrap()
                .matched
        );
    }

    struct StubView;

    #[async_trait::async_trait]
    impl ViewFunctionRunner for StubView {
        async fn simulate_view_function(&self, _: &Value) -> Result<Value, AlertError> {
            Ok(json!({ "result": { "price": 10 } }))
        }
    }

    #[tokio::test]
    async fn view_function_uses_runner_and_condition() {
        let expr = AlertExpression {
            expression_type: ExpressionType::ViewFunction,
            params: json!({ "condition": { "path": "result.price", "min": 9 } }),
        };
        assert!(
            evaluate_expression(&expr, &tx(), Some(&StubView))
                .await
                .unwrap()
        );
    }

    #[test]
    fn no_action_window_detects_inactivity() {
        let now = Utc.timestamp_opt(1000, 0).unwrap();
        assert!(no_action_should_fire(None, now, 60));
        assert!(no_action_should_fire(
            Some(Utc.timestamp_opt(900, 0).unwrap()),
            now,
            60
        ));
        assert!(!no_action_should_fire(
            Some(Utc.timestamp_opt(980, 0).unwrap()),
            now,
            60
        ));
    }

    #[test]
    fn webhook_signature_is_stable_and_backoff_is_bounded() {
        assert_eq!(
            webhook_signature("secret", "{\"a\":1}", "123"),
            webhook_signature("secret", "{\"a\":1}", "123")
        );
        assert_eq!(next_backoff_seconds(1), Some(30));
        assert_eq!(next_backoff_seconds(5), Some(480));
        assert_eq!(next_backoff_seconds(6), None);
    }
}
