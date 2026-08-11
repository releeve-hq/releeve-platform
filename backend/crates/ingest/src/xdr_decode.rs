use std::collections::{HashMap, HashSet};

use serde_json::{Map, Value, json};
use stellar_xdr::{
    ContractEvent, ContractEventBody, ContractEventType, ContractId, DiagnosticEvent,
    FeeBumpTransactionInnerTx, Hash, HostFunction, LedgerEntry, LedgerEntryChange,
    LedgerEntryChanges, LedgerEntryData, LedgerKey, Limits, Operation, OperationBody, ReadXdr,
    ScAddress, ScVal, SorobanAuthorizedFunction, SorobanAuthorizedInvocation, TransactionEnvelope,
    TransactionExt, TransactionMeta, WriteXdr,
};

use crate::models::{CallTreeNode, Event, FundFlowEdge, ResourceMetrics, StateChange, TxRecord};

pub fn enrich_from_xdr(tx: &mut TxRecord, rpc: &Value) {
    let mut envelope_calls = Vec::new();
    let mut auth_events = Vec::new();
    if let Some(envelope_xdr) = string_field(rpc, &["envelopeXdr", "envelope_xdr"])
        && let Ok(envelope) = TransactionEnvelope::from_xdr_base64(envelope_xdr, Limits::none())
    {
        if tx.source_account.is_empty()
            && let Some(source) = envelope_source(&envelope)
        {
            tx.source_account = source;
        }
        envelope_calls = envelope_calls_and_auth(&envelope, &mut auth_events);
        apply_declared_resources(&envelope, &mut tx.metrics);
    }

    let mut decoded = MetaDecode::default();
    if let Some(meta_xdr) = string_field(rpc, &["resultMetaXdr", "result_meta_xdr"])
        && let Ok(meta) = TransactionMeta::from_xdr_base64(meta_xdr, Limits::none())
    {
        decoded = decode_meta(&meta);
    }

    if decoded.calls.is_empty() {
        let diagnostics = rpc_diagnostic_events(rpc);
        if !diagnostics.is_empty() {
            let evidence = decode_diagnostics(&diagnostics);
            decoded.calls = evidence.calls;
            decoded.events = evidence.events;
            merge_metrics(&mut decoded.metrics, evidence.metrics);
        }
    }

    if decoded.events.is_empty() {
        decoded.events = decode_rpc_event_xdr(rpc);
    }
    if decoded.calls.is_empty() {
        decoded.calls = envelope_calls;
        decoded.events.extend(auth_events);
    }

    if let Some(return_value) = decoded.return_value
        && let Some(root) = decoded.calls.first_mut()
        && root.return_value.is_none()
    {
        root.return_value = Some(return_value);
    }

    if !decoded.calls.is_empty() {
        tx.call_tree = decoded.calls;
        if let Some(root) = tx.call_tree.first() {
            tx.operation_target_address = Some(root.contract_id.clone());
            tx.operation_target_kind = Some("contract".to_string());
        }
    }
    if !decoded.events.is_empty() {
        dedupe_events(&mut decoded.events);
        tx.events = decoded.events;
    }
    if !decoded.state_changes.is_empty() {
        tx.state_changes = decoded.state_changes;
    }
    merge_metrics(&mut tx.metrics, decoded.metrics);

    assign_inferred_causes(tx);
    let transfers = transfers_from_events(&tx.events);
    if !transfers.is_empty() {
        tx.fund_flow = transfers;
    }
}

fn string_field<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
}

fn envelope_source(envelope: &TransactionEnvelope) -> Option<String> {
    match envelope {
        TransactionEnvelope::Tx(tx) => Some(tx.tx.source_account.to_string()),
        TransactionEnvelope::TxFeeBump(fee_bump) => match &fee_bump.tx.inner_tx {
            FeeBumpTransactionInnerTx::Tx(inner) => Some(inner.tx.source_account.to_string()),
        },
        TransactionEnvelope::TxV0(tx) => Some(tx.tx.source_account_ed25519.to_string()),
    }
}

fn envelope_calls_and_auth(
    envelope: &TransactionEnvelope,
    auth_events: &mut Vec<Event>,
) -> Vec<CallTreeNode> {
    match envelope {
        TransactionEnvelope::Tx(tx) => {
            calls_from_operations(tx.tx.operations.as_ref(), auth_events)
        }
        TransactionEnvelope::TxFeeBump(fee_bump) => match &fee_bump.tx.inner_tx {
            FeeBumpTransactionInnerTx::Tx(inner) => {
                calls_from_operations(inner.tx.operations.as_ref(), auth_events)
            }
        },
        TransactionEnvelope::TxV0(tx) => {
            calls_from_operations(tx.tx.operations.as_ref(), auth_events)
        }
    }
}

fn calls_from_operations(
    operations: &[Operation],
    auth_events: &mut Vec<Event>,
) -> Vec<CallTreeNode> {
    let mut calls = Vec::new();
    for op in operations {
        if let OperationBody::InvokeHostFunction(invoke) = &op.body {
            match &invoke.host_function {
                HostFunction::InvokeContract(args) => calls.push(CallTreeNode {
                    parent_index: None,
                    contract_id: args.contract_address.to_string(),
                    function_name: args.function_name.to_string(),
                    args: scvals_json(args.args.as_ref()),
                    return_value: None,
                    depth: 0,
                    sequence: calls.len() as i64,
                }),
                HostFunction::CreateContract(_) | HostFunction::CreateContractV2(_) => {
                    calls.push(CallTreeNode {
                        parent_index: None,
                        contract_id: "contract_create".to_string(),
                        function_name: invoke.host_function.name().to_string(),
                        args: json!({ "host_function": invoke.host_function.name() }),
                        return_value: None,
                        depth: 0,
                        sequence: calls.len() as i64,
                    })
                }
                HostFunction::UploadContractWasm(_) => {}
            }

            for auth in invoke.auth.iter() {
                let root_index = calls.len() as i64;
                push_authorized_invocation(&mut calls, &auth.root_invocation, None, 0);
                auth_events.push(Event {
                    contract_id: calls
                        .get(root_index as usize)
                        .map(|call| call.contract_id.clone())
                        .unwrap_or_else(|| "authorization".to_string()),
                    topics: vec!["authorization".to_string()],
                    data: json!({
                        "credentials": format!("{:?}", auth.credentials),
                        "root_call": root_index,
                    }),
                    caused_by_node: Some(root_index),
                    sequence: auth_events.len() as i64,
                    event_type: "diagnostic".to_string(),
                    successful: None,
                    stage: Some("authorization".to_string()),
                });
            }
        }
    }
    merge_calls(&mut calls);
    calls
}

fn push_authorized_invocation(
    out: &mut Vec<CallTreeNode>,
    invocation: &SorobanAuthorizedInvocation,
    parent: Option<i64>,
    depth: i64,
) {
    let index = out.len() as i64;
    match &invocation.function {
        SorobanAuthorizedFunction::ContractFn(args) => out.push(CallTreeNode {
            parent_index: parent,
            contract_id: args.contract_address.to_string(),
            function_name: args.function_name.to_string(),
            args: scvals_json(args.args.as_ref()),
            return_value: None,
            depth,
            sequence: index,
        }),
        other => out.push(CallTreeNode {
            parent_index: parent,
            contract_id: "contract_create".to_string(),
            function_name: other.name().to_string(),
            args: json!({ "authorized_function": other.name() }),
            return_value: None,
            depth,
            sequence: index,
        }),
    }
    for child in invocation.sub_invocations.iter() {
        push_authorized_invocation(out, child, Some(index), depth + 1);
    }
}

fn merge_calls(calls: &mut Vec<CallTreeNode>) {
    let mut deduped = Vec::new();
    let mut old_to_new = HashMap::new();
    for (old_index, mut call) in calls.drain(..).enumerate() {
        let duplicate = if call.parent_index.is_none() {
            deduped.iter().position(|existing: &CallTreeNode| {
                existing.parent_index.is_none()
                    && existing.contract_id == call.contract_id
                    && existing.function_name == call.function_name
                    && existing.args == call.args
            })
        } else {
            None
        };
        let new_index = if let Some(existing) = duplicate {
            existing as i64
        } else {
            call.parent_index = call
                .parent_index
                .and_then(|parent| old_to_new.get(&parent).copied());
            call.sequence = deduped.len() as i64;
            deduped.push(call);
            (deduped.len() - 1) as i64
        };
        old_to_new.insert(old_index as i64, new_index);
    }
    *calls = deduped;
}

fn apply_declared_resources(envelope: &TransactionEnvelope, metrics: &mut ResourceMetrics) {
    let ext = match envelope {
        TransactionEnvelope::Tx(tx) => Some(&tx.tx.ext),
        TransactionEnvelope::TxFeeBump(fee_bump) => match &fee_bump.tx.inner_tx {
            FeeBumpTransactionInnerTx::Tx(inner) => Some(&inner.tx.ext),
        },
        TransactionEnvelope::TxV0(_) => None,
    };
    if let Some(TransactionExt::V1(data)) = ext {
        metrics.cpu_instruction_limit = Some(i64::from(data.resources.instructions));
        metrics.disk_read_bytes_limit = Some(i64::from(data.resources.disk_read_bytes));
        metrics.write_bytes_limit = Some(i64::from(data.resources.write_bytes));
        metrics.resource_fee = Some(data.resource_fee.to_string());
    }
}

#[derive(Default)]
struct MetaDecode {
    return_value: Option<Value>,
    events: Vec<Event>,
    state_changes: Vec<StateChange>,
    calls: Vec<CallTreeNode>,
    metrics: ResourceMetrics,
}

fn decode_meta(meta: &TransactionMeta) -> MetaDecode {
    let mut out = MetaDecode::default();
    match meta {
        TransactionMeta::V0(ops) => {
            for op in ops.iter() {
                push_changes(&mut out.state_changes, &op.changes);
            }
        }
        TransactionMeta::V1(v1) => {
            push_changes(&mut out.state_changes, &v1.tx_changes);
            for op in v1.operations.iter() {
                push_changes(&mut out.state_changes, &op.changes);
            }
        }
        TransactionMeta::V2(v2) => {
            push_changes(&mut out.state_changes, &v2.tx_changes_before);
            for op in v2.operations.iter() {
                push_changes(&mut out.state_changes, &op.changes);
            }
            push_changes(&mut out.state_changes, &v2.tx_changes_after);
        }
        TransactionMeta::V3(v3) => {
            push_changes(&mut out.state_changes, &v3.tx_changes_before);
            for op in v3.operations.iter() {
                push_changes(&mut out.state_changes, &op.changes);
            }
            push_changes(&mut out.state_changes, &v3.tx_changes_after);
            if let Some(meta) = &v3.soroban_meta {
                out.return_value = Some(scval_json(&meta.return_value));
                if meta.diagnostic_events.is_empty() {
                    out.events.extend(
                        meta.events.iter().enumerate().map(|(index, event)| {
                            event_model(event, None, index as i64, None, None)
                        }),
                    );
                } else {
                    let evidence = decode_diagnostics(&meta.diagnostic_events);
                    out.calls = evidence.calls;
                    out.events = evidence.events;
                    out.metrics = evidence.metrics;
                }
            }
        }
        TransactionMeta::V4(v4) => {
            push_changes(&mut out.state_changes, &v4.tx_changes_before);
            for op in v4.operations.iter() {
                push_changes(&mut out.state_changes, &op.changes);
                out.events
                    .extend(op.events.iter().enumerate().map(|(index, event)| {
                        event_model(
                            event,
                            None,
                            index as i64,
                            None,
                            Some("operation".to_string()),
                        )
                    }));
            }
            push_changes(&mut out.state_changes, &v4.tx_changes_after);
            if let Some(meta) = &v4.soroban_meta {
                out.return_value = meta.return_value.as_ref().map(scval_json);
            }
            out.events
                .extend(v4.events.iter().enumerate().map(|(index, event)| {
                    event_model(
                        &event.event,
                        None,
                        index as i64,
                        None,
                        Some(event.stage.to_string()),
                    )
                }));
            if !v4.diagnostic_events.is_empty() {
                let evidence = decode_diagnostics(&v4.diagnostic_events);
                out.calls = evidence.calls;
                out.events = evidence.events;
                out.metrics = evidence.metrics;
            }
        }
    }
    out
}

fn push_changes(out: &mut Vec<StateChange>, changes: &LedgerEntryChanges) {
    let mut pending: HashMap<String, usize> = HashMap::new();
    for change in changes.0.iter() {
        match change {
            LedgerEntryChange::State(entry) => {
                let key = entry_key_for_entry(entry);
                let index = out.len();
                out.push(StateChange {
                    entry_type: entry_type(entry),
                    entry_key: key.clone(),
                    value_before: Some(ledger_entry_json(entry)),
                    value_after: None,
                    caused_by_node: None,
                    sequence: index as i64,
                    cause_confidence: "transaction".to_string(),
                });
                pending.insert(key, index);
            }
            LedgerEntryChange::Created(entry)
            | LedgerEntryChange::Updated(entry)
            | LedgerEntryChange::Restored(entry) => {
                let key = entry_key_for_entry(entry);
                if let Some(index) = pending.remove(&key) {
                    out[index].value_after = Some(ledger_entry_json(entry));
                } else {
                    out.push(StateChange {
                        entry_type: entry_type(entry),
                        entry_key: key,
                        value_before: None,
                        value_after: Some(ledger_entry_json(entry)),
                        caused_by_node: None,
                        sequence: out.len() as i64,
                        cause_confidence: "transaction".to_string(),
                    });
                }
            }
            LedgerEntryChange::Removed(key) => {
                let key_label = ledger_key_label(key);
                if let Some(index) = pending.remove(&key_label) {
                    out[index].value_after = None;
                } else {
                    out.push(StateChange {
                        entry_type: ledger_key_type(key),
                        entry_key: key_label,
                        value_before: Some(ledger_key_json(key)),
                        value_after: None,
                        caused_by_node: None,
                        sequence: out.len() as i64,
                        cause_confidence: "transaction".to_string(),
                    });
                }
            }
        }
    }
}

#[derive(Default)]
struct DiagnosticDecode {
    calls: Vec<CallTreeNode>,
    events: Vec<Event>,
    metrics: ResourceMetrics,
}

fn decode_diagnostics(diagnostics: &[DiagnosticEvent]) -> DiagnosticDecode {
    let mut out = DiagnosticDecode::default();
    let mut stack: Vec<i64> = Vec::new();
    for (sequence, diagnostic) in diagnostics.iter().enumerate() {
        let raw = raw_event(&diagnostic.event);
        let action = raw.topics.first().map(String::as_str);
        let caused_by = match action {
            Some("fn_call") => {
                let index = out.calls.len() as i64;
                let parent = stack.last().copied();
                out.calls.push(CallTreeNode {
                    parent_index: parent,
                    contract_id: diagnostic_contract_label(&diagnostic.event)
                        .unwrap_or_else(|| raw.contract_id.clone()),
                    function_name: raw
                        .topics
                        .get(2)
                        .cloned()
                        .unwrap_or_else(|| "unknown".to_string()),
                    args: raw.data.clone(),
                    return_value: None,
                    depth: stack.len() as i64,
                    sequence: sequence as i64,
                });
                stack.push(index);
                Some(index)
            }
            Some("fn_return") => {
                let function = raw.topics.get(1).map(String::as_str);
                let position = stack.iter().rposition(|index| {
                    function.is_none_or(|name| out.calls[*index as usize].function_name == name)
                });
                if let Some(position) = position {
                    let index = stack[position];
                    out.calls[index as usize].return_value = Some(raw.data.clone());
                    stack.truncate(position);
                    Some(index)
                } else {
                    stack.pop()
                }
            }
            _ => stack.last().copied(),
        };

        if metric_event(&raw, &mut out.metrics) {
            continue;
        }
        if matches!(action, Some("error") | Some("fn_error"))
            && let Some(index) = caused_by
        {
            out.calls[index as usize].return_value = Some(json!({ "error": raw.data }));
        }
        out.events.push(event_model(
            &diagnostic.event,
            caused_by,
            sequence as i64,
            Some(diagnostic.in_successful_contract_call),
            Some("execution".to_string()),
        ));
    }
    out
}

fn rpc_diagnostic_events(rpc: &Value) -> Vec<DiagnosticEvent> {
    rpc.get("diagnosticEventsXdr")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter_map(|raw| DiagnosticEvent::from_xdr_base64(raw, Limits::none()).ok())
        .collect()
}

fn decode_rpc_event_xdr(rpc: &Value) -> Vec<Event> {
    let mut out = Vec::new();
    if let Some(events) = rpc.get("events") {
        if let Some(items) = events.get("transactionEventsXdr").and_then(Value::as_array) {
            for raw in items.iter().filter_map(Value::as_str) {
                if let Ok(event) =
                    stellar_xdr::TransactionEvent::from_xdr_base64(raw, Limits::none())
                {
                    out.push(event_model(
                        &event.event,
                        None,
                        out.len() as i64,
                        None,
                        Some(event.stage.to_string()),
                    ));
                }
            }
        }
        if let Some(groups) = events.get("contractEventsXdr").and_then(Value::as_array) {
            for group in groups {
                for raw in group
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                {
                    if let Ok(event) = ContractEvent::from_xdr_base64(raw, Limits::none()) {
                        out.push(event_model(
                            &event,
                            None,
                            out.len() as i64,
                            None,
                            Some("operation".to_string()),
                        ));
                    }
                }
            }
        }
    }
    out
}

fn raw_event(event: &ContractEvent) -> Event {
    event_model(event, None, 0, None, None)
}

fn event_model(
    event: &ContractEvent,
    caused_by_node: Option<i64>,
    sequence: i64,
    successful: Option<bool>,
    stage: Option<String>,
) -> Event {
    let ContractEventBody::V0(body) = &event.body;
    let mut topics = body.topics.iter().map(scval_label).collect::<Vec<_>>();
    if topics.first().map(String::as_str) == Some("fn_call")
        && let Some(contract_id) = diagnostic_contract_label(event)
        && let Some(topic) = topics.get_mut(1)
    {
        *topic = contract_id;
    }
    Event {
        contract_id: event
            .contract_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "system".to_string()),
        topics,
        data: scval_json(&body.data),
        caused_by_node,
        sequence,
        event_type: match event.type_ {
            ContractEventType::Contract => "contract",
            ContractEventType::System => "system",
            ContractEventType::Diagnostic => "diagnostic",
        }
        .to_string(),
        successful,
        stage,
    }
}

fn metric_event(event: &Event, metrics: &mut ResourceMetrics) -> bool {
    if event.topics.first().map(String::as_str) != Some("core_metrics") {
        return false;
    }
    let Some(name) = event.topics.get(1).map(String::as_str) else {
        return false;
    };
    let value = json_integer(&event.data).and_then(|raw| raw.parse::<i64>().ok());
    match name {
        "cpu_insn" => metrics.cpu_instructions = value,
        "mem_byte" => metrics.memory_bytes = value,
        "invoke_time_nsecs" => metrics.invoke_time_nsecs = value,
        "ledger_read_byte" => metrics.disk_read_bytes = value,
        "ledger_write_byte" => metrics.write_bytes = value,
        "max_rw_key_byte" => metrics.max_rw_key_byte = value,
        "max_rw_data_byte" => metrics.max_rw_data_byte = value,
        _ => {}
    }
    true
}

fn merge_metrics(target: &mut ResourceMetrics, source: ResourceMetrics) {
    target.cpu_instructions = source.cpu_instructions.or(target.cpu_instructions);
    target.cpu_instruction_limit = source
        .cpu_instruction_limit
        .or(target.cpu_instruction_limit);
    target.memory_bytes = source.memory_bytes.or(target.memory_bytes);
    target.invoke_time_nsecs = source.invoke_time_nsecs.or(target.invoke_time_nsecs);
    target.disk_read_bytes = source.disk_read_bytes.or(target.disk_read_bytes);
    target.disk_read_bytes_limit = source
        .disk_read_bytes_limit
        .or(target.disk_read_bytes_limit);
    target.write_bytes = source.write_bytes.or(target.write_bytes);
    target.write_bytes_limit = source.write_bytes_limit.or(target.write_bytes_limit);
    target.max_rw_key_byte = source.max_rw_key_byte.or(target.max_rw_key_byte);
    target.max_rw_data_byte = source.max_rw_data_byte.or(target.max_rw_data_byte);
    target.resource_fee = source.resource_fee.or_else(|| target.resource_fee.clone());
}

fn assign_inferred_causes(tx: &mut TxRecord) {
    for event in &mut tx.events {
        if event.caused_by_node.is_none() {
            event.caused_by_node = tx
                .call_tree
                .iter()
                .enumerate()
                .rev()
                .find(|(_, call)| call.contract_id == event.contract_id)
                .map(|(index, _)| index as i64);
        }
    }
    for change in &mut tx.state_changes {
        if change.caused_by_node.is_some() {
            continue;
        }
        let contract = change
            .entry_key
            .split(':')
            .find(|part| part.starts_with('C') && part.len() >= 20);
        if let Some(contract) = contract
            && let Some((index, _)) = tx
                .call_tree
                .iter()
                .enumerate()
                .rev()
                .find(|(_, call)| call.contract_id == contract)
        {
            change.caused_by_node = Some(index as i64);
            change.cause_confidence = "contract".to_string();
        }

        if change.caused_by_node.is_none() && !tx.call_tree.is_empty() {
            change.caused_by_node = Some(0);
            change.cause_confidence = "transaction".to_string();
        }
    }
}

fn transfers_from_events(events: &[Event]) -> Vec<FundFlowEdge> {
    let mut out = Vec::new();
    for event in events {
        let action = event.topics.first().map(String::as_str);
        let (from, to) = match action {
            Some("transfer") => (event.topics.get(1).cloned(), event.topics.get(2).cloned()),
            Some("mint") => (Some("Mint".to_string()), event.topics.get(1).cloned()),
            Some("burn") | Some("clawback") => {
                (event.topics.get(1).cloned(), Some("Burn".to_string()))
            }
            Some("fee") => (
                event.topics.get(1).cloned(),
                Some("Network fee".to_string()),
            ),
            _ => continue,
        };
        let (Some(from), Some(to), Some(amount)) = (from, to, json_amount(&event.data)) else {
            continue;
        };
        let asset = event
            .topics
            .get(3)
            .cloned()
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| {
                if event.contract_id == "system" {
                    "XLM".to_string()
                } else {
                    event.contract_id.clone()
                }
            });
        out.push(FundFlowEdge {
            from_address: from,
            to_address: to,
            asset_type: if asset == "XLM" || asset.eq_ignore_ascii_case("native") {
                "native"
            } else if asset.starts_with('C') {
                "soroban_token"
            } else {
                "stellar_asset"
            }
            .to_string(),
            asset,
            amount,
            caused_by_node: event.caused_by_node,
            sequence: event.sequence,
            usd_value: None,
        });
    }
    out.sort_by_key(|edge| edge.sequence);
    out
}

fn dedupe_events(events: &mut Vec<Event>) {
    let mut seen = HashSet::new();
    events.retain(|event| {
        seen.insert(format!(
            "{}|{}|{}|{}|{:?}",
            event.contract_id,
            event.event_type,
            event.topics.join("|"),
            event.data,
            event.successful
        ))
    });
    for (index, event) in events.iter_mut().enumerate() {
        event.sequence = index as i64;
    }
}

fn json_amount(value: &Value) -> Option<String> {
    value
        .get("amount")
        .and_then(json_integer)
        .or_else(|| json_integer(value))
        .or_else(|| {
            value.as_array()?.iter().find_map(|entry| {
                (entry.get("key").and_then(Value::as_str) == Some("amount"))
                    .then(|| entry.get("value").and_then(json_integer))
                    .flatten()
            })
        })
}

fn json_integer(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        Value::Object(object) => object
            .get("value")
            .and_then(json_integer)
            .or_else(|| object.get("amount").and_then(json_integer)),
        _ => None,
    }
}

fn scval_json(value: &ScVal) -> Value {
    match value {
        ScVal::Bool(value) => json!(value),
        ScVal::Void => Value::Null,
        ScVal::U32(value) => json!(value),
        ScVal::I32(value) => json!(value),
        ScVal::U64(value) => json!(value.to_string()),
        ScVal::I64(value) => json!(value.to_string()),
        ScVal::Timepoint(value) => json!(value.0.to_string()),
        ScVal::Duration(value) => json!(value.0.to_string()),
        ScVal::U128(value) => json!(u128_parts(value.hi, value.lo)),
        ScVal::I128(value) => json!(i128_parts(value.hi, value.lo)),
        ScVal::U256(value) => {
            json!({ "type": "u256", "parts": [value.hi_hi.to_string(), value.hi_lo.to_string(), value.lo_hi.to_string(), value.lo_lo.to_string()] })
        }
        ScVal::I256(value) => {
            json!({ "type": "i256", "parts": [value.hi_hi.to_string(), value.hi_lo.to_string(), value.lo_hi.to_string(), value.lo_lo.to_string()] })
        }
        ScVal::Bytes(value) => {
            let bytes: &[u8] = value.as_ref();
            json!({ "type": "bytes", "value": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes) })
        }
        ScVal::String(value) => json!(value.to_string()),
        ScVal::Symbol(value) => json!(value.to_string()),
        ScVal::Vec(Some(value)) => scvals_json(value.as_ref()),
        ScVal::Vec(None) => json!([]),
        ScVal::Map(Some(value)) => {
            let mut object = Map::new();
            let mut fallback = Vec::new();
            let mut object_safe = true;
            for entry in value.iter() {
                let key = scval_json(&entry.key);
                let val = scval_json(&entry.val);
                if let Some(key) = key.as_str()
                    && !object.contains_key(key)
                {
                    object.insert(key.to_string(), val.clone());
                } else {
                    object_safe = false;
                }
                fallback.push(json!({ "key": key, "value": val }));
            }
            if object_safe {
                Value::Object(object)
            } else {
                Value::Array(fallback)
            }
        }
        ScVal::Map(None) => json!({}),
        ScVal::Address(value) => json!(value.to_string()),
        ScVal::Error(value) => json!({ "type": "error", "value": format!("{value:?}") }),
        ScVal::ContractInstance(value) => {
            json!({ "type": "contract_instance", "value": format!("{value:?}") })
        }
        ScVal::LedgerKeyContractInstance => json!({ "type": "ledger_key_contract_instance" }),
        ScVal::LedgerKeyNonce(value) => {
            json!({ "type": "ledger_key_nonce", "value": format!("{value:?}") })
        }
        ScVal::ExecutableTag(value) => {
            json!({ "type": "executable_tag", "value": value.to_string() })
        }
    }
}

fn u128_parts(hi: u64, lo: u64) -> String {
    ((u128::from(hi) << 64) | u128::from(lo)).to_string()
}

fn i128_parts(hi: i64, lo: u64) -> String {
    ((i128::from(hi) << 64) | i128::from(lo)).to_string()
}

fn scvals_json(values: &[ScVal]) -> Value {
    json!(values.iter().map(scval_json).collect::<Vec<_>>())
}

fn scval_label(value: &ScVal) -> String {
    match scval_json(value) {
        Value::String(value) => value,
        other => other.to_string(),
    }
}

fn diagnostic_contract_label(event: &ContractEvent) -> Option<String> {
    let ContractEventBody::V0(body) = &event.body;
    contract_identifier_label(body.topics.get(1)?)
}

fn contract_identifier_label(value: &ScVal) -> Option<String> {
    match value {
        ScVal::Address(address) => Some(address.to_string()),
        ScVal::Bytes(value) => {
            let bytes: &[u8] = value.as_ref();
            let hash: [u8; 32] = bytes.try_into().ok()?;
            Some(ContractId(Hash(hash)).to_string())
        }
        _ => None,
    }
}

fn entry_type(entry: &LedgerEntry) -> String {
    ledger_entry_data_type(&entry.data).to_string()
}

fn entry_key_for_entry(entry: &LedgerEntry) -> String {
    match &entry.data {
        LedgerEntryData::Account(value) => value.account_id.to_string(),
        LedgerEntryData::Data(value) => format!("{}:{:?}", value.account_id, value.data_name),
        LedgerEntryData::Offer(value) => format!("{}:{}", value.seller_id, value.offer_id),
        LedgerEntryData::Trustline(value) => format!("{}:{:?}", value.account_id, value.asset),
        LedgerEntryData::ContractData(value) => format!(
            "{}:{}",
            sc_address_label(&value.contract),
            scval_label(&value.key)
        ),
        LedgerEntryData::ContractCode(value) => format!("wasm:{}", hex_hash(value.hash.0)),
        _ => format!("{:?}", entry.data),
    }
}

fn ledger_entry_json(entry: &LedgerEntry) -> Value {
    let mut decoded = json!({
        "last_modified_ledger": entry.last_modified_ledger_seq,
        "entry_type": entry_type(entry),
        "key": entry_key_for_entry(entry),
        "xdr": entry.to_xdr_base64(Limits::none()).ok()
    });

    if let LedgerEntryData::ContractData(contract_data) = &entry.data {
        decoded["contract"] = json!(sc_address_label(&contract_data.contract));
        decoded["data_key"] = scval_json(&contract_data.key);
        decoded["durability"] = json!(contract_data.durability.to_string().to_lowercase());
        decoded["value"] = scval_json(&contract_data.val);
    }

    decoded
}

fn ledger_key_type(key: &LedgerKey) -> String {
    match key {
        LedgerKey::Account(_) => "account",
        LedgerKey::Trustline(_) => "trustline",
        LedgerKey::Offer(_) => "offer",
        LedgerKey::Data(_) => "data",
        LedgerKey::ClaimableBalance(_) => "claimable_balance",
        LedgerKey::LiquidityPool(_) => "liquidity_pool",
        LedgerKey::ContractData(_) => "contract_data",
        LedgerKey::ContractCode(_) => "contract_code",
        LedgerKey::ConfigSetting(_) => "config_setting",
        LedgerKey::Ttl(_) => "ttl",
    }
    .to_string()
}

fn ledger_entry_data_type(data: &LedgerEntryData) -> &'static str {
    match data {
        LedgerEntryData::Account(_) => "account",
        LedgerEntryData::Trustline(_) => "trustline",
        LedgerEntryData::Offer(_) => "offer",
        LedgerEntryData::Data(_) => "data",
        LedgerEntryData::ClaimableBalance(_) => "claimable_balance",
        LedgerEntryData::LiquidityPool(_) => "liquidity_pool",
        LedgerEntryData::ContractData(_) => "contract_data",
        LedgerEntryData::ContractCode(_) => "contract_code",
        LedgerEntryData::ConfigSetting(_) => "config_setting",
        LedgerEntryData::Ttl(_) => "ttl",
    }
}

fn ledger_key_label(key: &LedgerKey) -> String {
    match key {
        LedgerKey::ContractData(value) => format!(
            "{}:{}",
            sc_address_label(&value.contract),
            scval_label(&value.key)
        ),
        LedgerKey::ContractCode(value) => format!("wasm:{}", hex_hash(value.hash.0)),
        _ => ledger_key_json(key).to_string(),
    }
}

fn ledger_key_json(key: &LedgerKey) -> Value {
    json!({
        "entry_type": ledger_key_type(key),
        "xdr": key.to_xdr_base64(Limits::none()).ok(),
        "debug": format!("{key:?}")
    })
}

fn sc_address_label(address: &ScAddress) -> String {
    address.to_string()
}

fn hex_hash(hash: [u8; 32]) -> String {
    hash.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_legacy_fn_call_diagnostic() {
        let encoded = "AAAAAQAAAAAAAAAAAAAAAgAAAAAAAAADAAAADwAAAAdmbl9jYWxsAAAAAA0AAAAgLBi+OHXZBohzTiGKq9fBlYkq5CgEgp7YF1ScdkNcoMsAAAAPAAAADnN5bmNfYXNzZXRfcG5sAAAAAAAPAAAABExJTks=";
        let event = DiagnosticEvent::from_xdr_base64(encoded, Limits::none())
            .expect("legacy diagnostic XDR should decode");
        let decoded = decode_diagnostics(&[event]);

        assert_eq!(decoded.calls.len(), 1);
        assert_eq!(decoded.calls[0].function_name, "sync_asset_pnl");
        assert_eq!(
            decoded.calls[0].contract_id,
            "CAWBRPRYOXMQNCDTJYQYVK6XYGKYSKXEFACIFHWYC5KJY5SDLSQMXBCF"
        );
        assert_eq!(decoded.calls[0].args, json!("LINK"));
    }
}
