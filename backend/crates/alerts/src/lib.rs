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
    EventEmitted,
    EventParameter,
    TokenTransfer,
    AllowlistedCallers,
    BlocklistedCallers,
    BalanceChange,
    StateChange,
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
    #[error("delivery failed: {0}")]
    Delivery(String),
}

pub async fn evaluate_alert(
    expressions: &[AlertExpression],
    logic: MatchLogic,
    tx: &TransactionFacts,
) -> Result<EvaluationOutcome, AlertError> {
    if expressions.is_empty() {
        return Err(AlertError::Invalid(
            "at least one expression is required".into(),
        ));
    }
    let mut results = Vec::with_capacity(expressions.len());
    for expression in expressions {
        let result = evaluate_expression(expression, tx).await?;
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
) -> Result<bool, AlertError> {
    let p = &expression.params;
    Ok(match expression.expression_type {
        ExpressionType::SuccessfulTransaction => tx.status.eq_ignore_ascii_case("success"),
        ExpressionType::FailedTransaction => tx.status.eq_ignore_ascii_case("failed"),
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
        ExpressionType::BalanceChange => tx
            .fund_flow
            .iter()
            .filter(|edge| {
                let addr = p.get("address").and_then(Value::as_str);
                addr.is_none_or(|a| edge.from == a || edge.to == a)
            })
            .any(|edge| {
                let Ok(actual) = edge.amount.parse::<i128>() else {
                    return false;
                };
                let Some(expected) = params_i128(p, "value") else {
                    return false;
                };
                let comparator = p.get("comparator").and_then(Value::as_str).unwrap_or(">=");
                compare_i128(actual, expected, comparator)
            }),
        ExpressionType::StateChange => tx.state_changes.iter().any(|change| {
            string_param_matches(p, "entry_type", &change.entry_type)
                && string_param_matches(p, "storage_key", &change.key)
                && string_param_matches(p, "key", &change.key)
                && state_condition_matches(change, p)
        }),
    })
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

/// Reads a param as an exact integer, accepting either a JSON number or a
/// numeric string (amounts are stroops and must never round through f64).
fn params_i128(params: &Value, key: &str) -> Option<i128> {
    params
        .get(key)
        .and_then(|v| v.as_str().and_then(|s| s.parse::<i128>().ok()))
        .or_else(|| params.get(key).and_then(Value::as_i64).map(i128::from))
}

fn compare_i128(actual: i128, expected: i128, comparator: &str) -> bool {
    match comparator {
        "==" => actual == expected,
        "!=" => actual != expected,
        ">" => actual > expected,
        "<" => actual < expected,
        ">=" => actual >= expected,
        "<=" => actual <= expected,
        _ => false,
    }
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
    let Some(condition) = condition else {
        return change.before != change.after;
    };
    // Comparison operator on the new value, e.g.
    // `{ "comparator": ">", "value": 1500 }` against `change.after` (the stored
    // value after the transaction). Non-numeric values simply do not match.
    if let Some(comparator) = condition.get("comparator").and_then(Value::as_str) {
        let Some(expected) = params_i128(condition, "value") else {
            return false;
        };
        let Some(actual) = change.after.as_ref().and_then(numeric_value_of) else {
            return false;
        };
        return compare_i128(actual, expected, comparator);
    }
    value_condition_matches(
        &json!({ "before": change.before, "after": change.after }),
        Some(condition),
    )
}

/// Extracts an integer from a state-change value (ingest `ledger_entry_json` or
/// a bare `scval_json`): decimal-string ints, JSON numbers, or an object's
/// `value` field.
fn numeric_value_of(value: &Value) -> Option<i128> {
    match value {
        Value::String(s) => s.parse::<i128>().ok(),
        Value::Number(n) => n.as_i64().map(i128::from),
        Value::Object(map) => map
            .get("value")
            .and_then(numeric_value_of)
            .or_else(|| map.get("amount").and_then(numeric_value_of)),
        _ => None,
    }
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
        // Covers the 9 supported triggers on a successful tx.
        let expressions = vec![
            AlertExpression {
                expression_type: ExpressionType::SuccessfulTransaction,
                params: json!({}),
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
                expression_type: ExpressionType::AllowlistedCallers,
                params: json!({ "addresses": ["GBLOCKED"] }),
            },
            AlertExpression {
                expression_type: ExpressionType::BlocklistedCallers,
                params: json!({ "addresses": ["GBLOCKED"] }),
            },
            AlertExpression {
                expression_type: ExpressionType::BalanceChange,
                params: json!({ "address": "GBLOCKED", "comparator": ">=", "value": 40 }),
            },
            AlertExpression {
                expression_type: ExpressionType::StateChange,
                params: json!({ "storage_key": "balance:GBLOCKED", "condition": { "any_change": true } }),
            },
        ];
        let outcome = evaluate_alert(&expressions, MatchLogic::All, &tx())
            .await
            .unwrap();
        assert!(outcome.matched);
    }

    #[tokio::test]
    async fn state_change_numeric_comparator_matches_new_value() {
        let key = "CAWBRPRYOXMQNCDTJYQYVK6XYGKYSKXEFACIFHWYC5KJY5SDLSQMXBCF:[\"Balance\",\"GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF\"]";
        let mut facts = tx();
        facts.state_changes = vec![StateChangeRecord {
            entry_type: "contract_data".into(),
            key: key.into(),
            before: Some(json!({ "value": "1500" })),
            after: Some(json!({ "value": "2000" })),
        }];
        let expr = |params: serde_json::Value| AlertExpression {
            expression_type: ExpressionType::StateChange,
            params,
        };
        // "new value > 1500" fires.
        let matched = evaluate_expression(
            &expr(
                json!({ "storage_key": key, "condition": { "comparator": ">", "value": "1500" } }),
            ),
            &facts,
        )
        .await
        .unwrap();
        assert!(matched, "value 2000 must satisfy > 1500");
        // "new value < 1500" does not.
        let not_matched = evaluate_expression(
            &expr(
                json!({ "storage_key": key, "condition": { "comparator": "<", "value": "1500" } }),
            ),
            &facts,
        )
        .await
        .unwrap();
        assert!(!not_matched, "value 2000 must not satisfy < 1500");
        // Non-numeric values never satisfy a numeric comparator.
        facts.state_changes[0].after = Some(json!({ "value": { "symbol": "paused" } }));
        let non_numeric = evaluate_expression(
            &expr(json!({ "storage_key": key, "condition": { "comparator": ">", "value": "0" } })),
            &facts,
        )
        .await
        .unwrap();
        assert!(
            !non_numeric,
            "non-numeric value must not satisfy a numeric comparator"
        );
    }

    #[tokio::test]
    async fn match_logic_any_and_all_are_distinct() {
        let expressions = vec![
            AlertExpression {
                expression_type: ExpressionType::FailedTransaction,
                params: json!({}),
            },
            AlertExpression {
                expression_type: ExpressionType::TokenTransfer,
                params: json!({ "asset": "XLM" }),
            },
        ];
        assert!(
            evaluate_alert(&expressions, MatchLogic::Any, &tx())
                .await
                .unwrap()
                .matched
        );
        assert!(
            !evaluate_alert(&expressions, MatchLogic::All, &tx())
                .await
                .unwrap()
                .matched
        );
    }

    #[tokio::test]
    async fn balance_change_compares_with_all_comparators_i128() {
        // tx() has one fund_flow edge: GBLOCKED -> GALICE, XLM, amount "42".
        let base = |comparator: &str, value: i64| AlertExpression {
            expression_type: ExpressionType::BalanceChange,
            params: json!({ "address": "GBLOCKED", "comparator": comparator, "value": value }),
        };
        // value is accepted as a JSON number or a numeric string.
        for (comparator, value, expect) in [
            ("==", 42, true),
            ("==", 43, false),
            ("!=", 43, true),
            ("!=", 42, false),
            (">", 41, true),
            (">", 42, false),
            ("<", 43, true),
            ("<", 42, false),
            (">=", 42, true),
            (">=", 43, false),
            ("<=", 42, true),
            ("<=", 41, false),
        ] {
            let expr = base(comparator, value);
            let outcome = evaluate_alert(&[expr], MatchLogic::All, &tx())
                .await
                .unwrap();
            assert_eq!(
                outcome.matched, expect,
                "comparator {comparator} value {value}"
            );
        }
        // String form of value also works (stroops must not round through f64).
        let expr = AlertExpression {
            expression_type: ExpressionType::BalanceChange,
            params: json!({ "address": "GBLOCKED", "comparator": ">=", "value": "42" }),
        };
        assert!(
            evaluate_alert(&[expr], MatchLogic::All, &tx())
                .await
                .unwrap()
                .matched
        );
        // Large i128 amounts (beyond f64 precision) compare exactly.
        let big_tx = TransactionFacts {
            fund_flow: vec![FundFlowEdge {
                from: "GBLOCKED".into(),
                to: "GALICE".into(),
                asset: "XLM".into(),
                amount: "9007199254740993".into(),
            }],
            ..tx()
        };
        let expr = AlertExpression {
            expression_type: ExpressionType::BalanceChange,
            params: json!({ "address": "GBLOCKED", "comparator": "==", "value": "9007199254740993" }),
        };
        assert!(
            evaluate_alert(&[expr], MatchLogic::All, &big_tx)
                .await
                .unwrap()
                .matched
        );
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
