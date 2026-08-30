//! Alert evaluation hook for the ingest worker.
//!
//! Called immediately after a transaction is persisted, so alerts fire
//! with no polling delay and no wasted compute when idle. Evaluation is
//! per-project (fan-out over distinct `project_id` with enabled alerts) and
//! is idempotent via `alert_firings` dedup.

use alerts::{AlertExpression, AlertTarget, MatchLogic, TransactionFacts};
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use uuid::Uuid;

pub async fn evaluate_for_tx(
    pool: &PgPool,
    network: &str,
    hash: &str,
) -> Result<Vec<Uuid>, sqlx::Error> {
    // Load all distinct projects that have at least one enabled alert.
    // This is the cheapest fan-out: only projects that can actually fire.
    let project_ids: Vec<Uuid> =
        sqlx::query_scalar("SELECT DISTINCT project_id FROM alerts WHERE enabled = true")
            .fetch_all(pool)
            .await?;

    let mut fired = Vec::new();
    for pid in project_ids {
        // Reuse the same per-project evaluation as the API, but without
        // requiring AppState. This is intentionally best-effort: one project's
        // failure must not block others or ingestion.
        match evaluate_project_tx(pool, pid, network, hash).await {
            Ok(mut ids) => fired.append(&mut ids),
            Err(e) => {
                tracing::warn!(project_id=%pid, hash=%hash, error=%e, "alert evaluation failed")
            }
        }
    }
    Ok(fired)
}

async fn evaluate_project_tx(
    pool: &PgPool,
    project_id: Uuid,
    network: &str,
    hash: &str,
) -> Result<Vec<Uuid>, sqlx::Error> {
    let tx = match load_tx_facts(pool, network, hash).await? {
        Some(tx) => tx,
        None => return Ok(vec![]),
    };
    let alert_rows = sqlx::query("SELECT id FROM alerts WHERE project_id = $1 AND enabled = true")
        .bind(project_id)
        .fetch_all(pool)
        .await?;
    let mut fired = Vec::new();
    for r in alert_rows {
        let alert_id: Uuid = r.get("id");
        if let Some(fid) = evaluate_one_alert(pool, project_id, alert_id, &tx).await? {
            fired.push(fid);
        }
    }
    Ok(fired)
}

struct LoadedAlert {
    id: Uuid,
    name: String,
    target: AlertTarget,
    match_logic: MatchLogic,
    expressions: Vec<AlertExpression>,
    destinations: Vec<(Uuid, String)>, // (destination_id, scope)
}

async fn load_alert(
    pool: &PgPool,
    project_id: Uuid,
    alert_id: Uuid,
) -> Result<Option<LoadedAlert>, sqlx::Error> {
    let row = sqlx::query(
        "SELECT id, name, target_type, target_value, match_logic FROM alerts WHERE project_id = $1 AND id = $2"
    )
    .bind(project_id)
    .bind(alert_id)
    .fetch_optional(pool)
    .await?;
    let Some(row) = row else { return Ok(None) };
    let rows = sqlx::query(
        "SELECT expression_type, params FROM alert_expressions WHERE alert_id = $1 ORDER BY id ASC",
    )
    .bind(alert_id)
    .fetch_all(pool)
    .await?;
    let mut expressions = Vec::new();
    for r in rows {
        let t: String = r.get("expression_type");
        let params: Value = r.get("params");
        let expr: AlertExpression =
            serde_json::from_value(json!({"type": t, "params": params})).unwrap();
        expressions.push(expr);
    }

    let dest_rows = sqlx::query(
        "SELECT destination_id, destination_scope FROM alert_destinations WHERE alert_id = $1",
    )
    .bind(alert_id)
    .fetch_all(pool)
    .await?;
    let dests = dest_rows
        .into_iter()
        .map(|r| {
            (
                r.get::<Uuid, _>("destination_id"),
                r.get::<String, _>("destination_scope"),
            )
        })
        .collect();

    let target = AlertTarget {
        target_type: match row.get::<String, _>("target_type").as_str() {
            "address" => alerts::TargetType::Address,
            "network" => alerts::TargetType::Network,
            "project" => alerts::TargetType::Project,
            "tag" => alerts::TargetType::Tag,
            _ => alerts::TargetType::Project,
        },
        value: row.get("target_value"),
    };
    let match_logic = match row.get::<String, _>("match_logic").as_str() {
        "any" => MatchLogic::Any,
        _ => MatchLogic::All,
    };
    Ok(Some(LoadedAlert {
        id: row.get("id"),
        name: row.get("name"),
        target,
        match_logic,
        expressions,
        destinations: dests,
    }))
}

async fn evaluate_one_alert(
    pool: &PgPool,
    project_id: Uuid,
    alert_id: Uuid,
    tx: &TransactionFacts,
) -> Result<Option<Uuid>, sqlx::Error> {
    let Some(alert) = load_alert(pool, project_id, alert_id).await? else {
        return Ok(None);
    };
    if !target_matches(pool, project_id, &alert, tx).await? {
        return Ok(None);
    }
    // Balance Change carries the watched address in scope; inject it into the
    // expression params for the pure evaluator.
    let expressions: Vec<alerts::AlertExpression> = alert
        .expressions
        .iter()
        .map(|e| {
            if matches!(e.expression_type, alerts::ExpressionType::BalanceChange)
                && let Some(addr) = alert.target.value.as_ref()
            {
                let mut params = e.params.clone();
                params["address"] = json!(addr);
                alerts::AlertExpression {
                    expression_type: e.expression_type.clone(),
                    params,
                }
            } else {
                e.clone()
            }
        })
        .collect();
    let outcome = match alerts::evaluate_alert(&expressions, alert.match_logic, tx).await {
        Ok(o) => o,
        Err(_) => return Ok(None),
    };
    if !outcome.matched {
        return Ok(None);
    }
    // Enriched firing context for history page
    let firing_context = json!({
        "alert_name": alert.name,
        "scope": alert.target,
        "project_id": project_id,
        "network": tx.network,
        "transaction_hash": tx.hash,
        "ledger": tx.ledger,
        "timestamp": tx.timestamp,
        "source_account": tx.source_account,
        "observed_value": tx.status,
        "condition": "status == success",
    });
    let firing_id: Option<Uuid> = sqlx::query_scalar(
        "INSERT INTO alert_firings (alert_id, tx_hash, firing_context) VALUES ($1,$2,$3) ON CONFLICT (alert_id, tx_hash) WHERE simulation_id IS NULL DO NOTHING RETURNING id"
    )
    .bind(alert.id)
    .bind(&tx.hash)
    .bind(&firing_context)
    .fetch_optional(pool)
    .await?;
    let Some(fid) = firing_id else {
        return Ok(None);
    };
    for (dest_id, scope) in alert.destinations {
        let _ = sqlx::query(
            "INSERT INTO destination_deliveries (destination_id, destination_scope, event_type, alert_id, status, attempt) VALUES ($1,$2,'alert_fired',$3,'pending',1)"
        )
        .bind(dest_id)
        .bind(&scope)
        .bind(alert.id)
        .execute(pool)
        .await;
    }
    Ok(Some(fid))
}

async fn project_addresses(
    pool: &PgPool,
    project_id: Uuid,
    network: Option<&str>,
) -> Result<Vec<String>, sqlx::Error> {
    let sql = match network {
        Some(net) => format!(
            "SELECT address FROM wallets WHERE project_id = $1 AND network = '{net}'
             UNION SELECT address FROM contracts WHERE project_id = $1 AND network = '{net}'"
        ),
        None => format!(
            "SELECT address FROM wallets WHERE project_id = $1
             UNION SELECT address FROM contracts WHERE project_id = $1"
        ),
    };
    let rows = sqlx::query(&sql).bind(project_id).fetch_all(pool).await?;
    Ok(rows.into_iter().map(|r| r.get::<String, _>(0)).collect())
}

async fn tagged_addresses(
    pool: &PgPool,
    project_id: Uuid,
    tag: &str,
) -> Result<Vec<String>, sqlx::Error> {
    let rows = sqlx::query(
        r#"
        SELECT w.address FROM tags t
        JOIN tag_attachments a ON a.tag_id = t.id
        JOIN wallets w ON a.entity_type = 'wallet' AND w.id = a.entity_id
        WHERE t.project_id = $1 AND t.name = $2
        UNION
        SELECT c.address FROM tags t
        JOIN tag_attachments a ON a.tag_id = t.id
        JOIN contracts c ON a.entity_type = 'contract' AND c.id = a.entity_id
        WHERE t.project_id = $1 AND t.name = $2
        "#,
    )
    .bind(project_id)
    .bind(tag)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| r.get::<String, _>(0)).collect())
}

fn tx_involves(tx: &TransactionFacts, addresses: &[String]) -> bool {
    addresses.iter().any(|a| {
        tx.source_account == *a
            || tx.fund_flow.iter().any(|e| e.from == *a || e.to == *a)
            || tx.call_tree.iter().any(|c| c.contract_id == *a)
    })
}

async fn target_matches(
    pool: &PgPool,
    project_id: Uuid,
    alert: &LoadedAlert,
    tx: &TransactionFacts,
) -> Result<bool, sqlx::Error> {
    let is_contract_event = alert.expressions.iter().any(|e| {
        matches!(
            e.expression_type,
            alerts::ExpressionType::EventEmitted | alerts::ExpressionType::EventParameter
        )
    });
    if is_contract_event {
        // Contract Event binds to exactly ONE contract chosen from the scope.
        let Some(contract) = alert.target.value.as_ref() else {
            return Ok(false);
        };
        return Ok(tx.events.iter().any(|ev| ev.contract_id == *contract));
    }
    let is_transfer = alert
        .expressions
        .iter()
        .any(|e| matches!(e.expression_type, alerts::ExpressionType::TokenTransfer));
    if is_transfer {
        let addresses: Vec<String> = match alert.target.target_type {
            alerts::TargetType::Network => {
                project_addresses(pool, project_id, alert.target.value.as_deref()).await?
            }
            alerts::TargetType::Project => project_addresses(pool, project_id, None).await?,
            alerts::TargetType::Address => {
                if let Some(addr) = alert.target.value.as_ref() {
                    vec![addr.clone()]
                } else {
                    return Ok(false);
                }
            }
            alerts::TargetType::Tag => {
                let Some(tag) = alert.target.value.as_ref() else {
                    return Ok(false);
                };
                tagged_addresses(pool, project_id, tag).await?
            }
        };
        if addresses.is_empty() {
            return Ok(false);
        }
        let expr = alert
            .expressions
            .iter()
            .find(|e| matches!(e.expression_type, alerts::ExpressionType::TokenTransfer));
        let params = expr.map(|e| &e.params);
        let direction = params
            .and_then(|p| p.get("direction"))
            .and_then(Value::as_str)
            .map(str::to_ascii_lowercase);
        let asset = params.and_then(|p| p.get("asset")).and_then(Value::as_str);
        return Ok(tx.fund_flow.iter().any(|edge| {
            let addr_match = addresses.iter().any(|a| match direction.as_deref() {
                Some("from") => edge.from == *a,
                Some("to") => edge.to == *a,
                _ => edge.from == *a || edge.to == *a,
            });
            let asset_match = asset.is_none_or(|a| edge.asset.eq_ignore_ascii_case(a));
            addr_match && asset_match
        }));
    }
    let addresses: Vec<String> = match alert.target.target_type {
        alerts::TargetType::Network => {
            project_addresses(pool, project_id, alert.target.value.as_deref()).await?
        }
        alerts::TargetType::Project => project_addresses(pool, project_id, None).await?,
        alerts::TargetType::Address => {
            if let Some(addr) = alert.target.value.as_ref() {
                vec![addr.clone()]
            } else {
                return Ok(false);
            }
        }
        alerts::TargetType::Tag => {
            let Some(tag) = alert.target.value.as_ref() else {
                return Ok(false);
            };
            tagged_addresses(pool, project_id, tag).await?
        }
    };
    Ok(tx_involves(tx, &addresses))
}

async fn load_tx_facts(
    pool: &PgPool,
    network: &str,
    hash: &str,
) -> Result<Option<TransactionFacts>, sqlx::Error> {
    let row = sqlx::query(
        "SELECT hash, network, ledger_sequence, status, source_account, operation_type, fee_charged::text, timestamp FROM transactions WHERE network = $1 AND hash = $2"
    )
    .bind(network)
    .bind(hash)
    .fetch_optional(pool)
    .await?;
    let Some(row) = row else { return Ok(None) };
    let call_rows = sqlx::query("SELECT contract_id, function_name, args, return_value, depth FROM tx_call_tree_nodes WHERE tx_hash = $1 ORDER BY depth ASC, id ASC")
        .bind(hash)
        .fetch_all(pool)
        .await?;
    let event_rows = sqlx::query(
        "SELECT contract_id, topics, data FROM tx_events WHERE tx_hash = $1 ORDER BY id ASC",
    )
    .bind(hash)
    .fetch_all(pool)
    .await?;
    let state_rows = sqlx::query("SELECT entry_type, entry_key, value_before, value_after FROM tx_state_changes WHERE tx_hash = $1 ORDER BY id ASC")
        .bind(hash)
        .fetch_all(pool)
        .await?;
    let flow_rows = sqlx::query("SELECT from_address, to_address, asset, amount::text FROM tx_fund_flow_edges WHERE tx_hash = $1 ORDER BY id ASC")
        .bind(hash)
        .fetch_all(pool)
        .await?;
    Ok(Some(TransactionFacts {
        hash: row.get("hash"),
        network: row.get("network"),
        status: row.get("status"),
        ledger: row.get("ledger_sequence"),
        timestamp: row.get("timestamp"),
        source_account: row.get("source_account"),
        operation_type: row.get("operation_type"),
        fee_charged: row.get("fee_charged"),
        call_tree: call_rows
            .into_iter()
            .map(|r| alerts::CallNode {
                contract_id: r.get("contract_id"),
                function_name: r.get("function_name"),
                args: r.get("args"),
                return_value: r.get("return_value"),
                depth: i64::from(r.get::<i32, _>("depth")),
            })
            .collect(),
        events: event_rows
            .into_iter()
            .map(|r| alerts::EventRecord {
                contract_id: r.get("contract_id"),
                topics: r.get("topics"),
                data: r.get("data"),
            })
            .collect(),
        state_changes: state_rows
            .into_iter()
            .map(|r| alerts::StateChangeRecord {
                entry_type: r.get("entry_type"),
                key: r.get("entry_key"),
                before: r.get("value_before"),
                after: r.get("value_after"),
            })
            .collect(),
        fund_flow: flow_rows
            .into_iter()
            .map(|r| alerts::FundFlowEdge {
                from: r.get("from_address"),
                to: r.get("to_address"),
                asset: r.get("asset"),
                amount: r.get("amount"),
            })
            .collect(),
    }))
}
