//! Contract spec loading for decoded simulation invocation.
//!
//! `POST /api/v1/{org}/{project}/simulations/contract-spec` resolves a
//! deployed contract's `contractspecv0` WASM custom section and returns a
//! structured, renderable description (function list + UDT type table) so the
//! frontend can offer typed parameter editors instead of raw JSON.

use std::io::Cursor;

use axum::{
    Json,
    extract::{Path, State},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use shared::Error;
use stellar_xdr::{
    ContractCodeEntry, ContractExecutable, Hash, LedgerEntry, LedgerEntryData, LedgerKey,
    LedgerKeyContractCode, Limited, Limits, ReadXdr, ScContractInstance, ScSpecEntry,
    ScSpecTypeDef, ScSpecUdtUnionCaseV0, ScVal, WriteXdr,
};
use uuid::Uuid;
use wasmparser::{Parser, Payload};

use crate::{
    extract::AuthUser,
    simulations::{ProjectAuth, authorize, contract_instance_ledger_key, read_ledger_entries},
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct ContractSpecRequest {
    pub network: String,
    pub contract_id: String,
    pub environment_id: Option<Uuid>,
}

/// Structured, renderable description of an `ScSpecTypeDef`. The frontend
/// derives labels client-side from `kind` and nests composite descriptors so it
/// can render a matching editor (and validate input) for every shape.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ContractSpecType {
    Val,
    Bool,
    Void,
    Error,
    U32,
    I32,
    U64,
    I64,
    Timepoint,
    Duration,
    U128,
    I128,
    U256,
    I256,
    Bytes,
    String,
    Symbol,
    Address,
    MuxedAddress,
    BytesN {
        n: u32,
    },
    Option {
        inner: Box<ContractSpecType>,
    },
    Result {
        ok: Box<ContractSpecType>,
        err: Box<ContractSpecType>,
    },
    Vec {
        elem: Box<ContractSpecType>,
    },
    Map {
        key: Box<ContractSpecType>,
        value: Box<ContractSpecType>,
    },
    Tuple {
        elems: Vec<ContractSpecType>,
    },
    Udt {
        name: String,
    },
}

pub async fn contract_spec(
    State(state): State<AppState>,
    AuthUser { user_id }: AuthUser,
    Path((org, project)): Path<(String, String)>,
    Json(request): Json<ContractSpecRequest>,
) -> Result<Json<Value>, Error> {
    let auth = authorize(&state, user_id, &org, &project).await?;
    let wasm = read_deployed_wasm(
        &state,
        user_id,
        &auth,
        &request.network,
        request.environment_id,
        &request.contract_id,
    )
    .await?;
    let entries = extract_contract_spec(&wasm)?;
    Ok(Json(build_spec_response(
        &request.contract_id,
        &request.network,
        &entries,
    )))
}

fn type_descriptor(spec: &ScSpecTypeDef) -> ContractSpecType {
    match spec {
        ScSpecTypeDef::Val => ContractSpecType::Val,
        ScSpecTypeDef::Bool => ContractSpecType::Bool,
        ScSpecTypeDef::Void => ContractSpecType::Void,
        ScSpecTypeDef::Error => ContractSpecType::Error,
        ScSpecTypeDef::U32 => ContractSpecType::U32,
        ScSpecTypeDef::I32 => ContractSpecType::I32,
        ScSpecTypeDef::U64 => ContractSpecType::U64,
        ScSpecTypeDef::I64 => ContractSpecType::I64,
        ScSpecTypeDef::Timepoint => ContractSpecType::Timepoint,
        ScSpecTypeDef::Duration => ContractSpecType::Duration,
        ScSpecTypeDef::U128 => ContractSpecType::U128,
        ScSpecTypeDef::I128 => ContractSpecType::I128,
        ScSpecTypeDef::U256 => ContractSpecType::U256,
        ScSpecTypeDef::I256 => ContractSpecType::I256,
        ScSpecTypeDef::Bytes => ContractSpecType::Bytes,
        ScSpecTypeDef::String => ContractSpecType::String,
        ScSpecTypeDef::Symbol => ContractSpecType::Symbol,
        ScSpecTypeDef::Address => ContractSpecType::Address,
        ScSpecTypeDef::MuxedAddress => ContractSpecType::MuxedAddress,
        ScSpecTypeDef::BytesN(bytes_n) => ContractSpecType::BytesN { n: bytes_n.n },
        ScSpecTypeDef::Option(option) => ContractSpecType::Option {
            inner: Box::new(type_descriptor(&option.value_type)),
        },
        ScSpecTypeDef::Result(result) => ContractSpecType::Result {
            ok: Box::new(type_descriptor(&result.ok_type)),
            err: Box::new(type_descriptor(&result.error_type)),
        },
        ScSpecTypeDef::Vec(vec) => ContractSpecType::Vec {
            elem: Box::new(type_descriptor(&vec.element_type)),
        },
        ScSpecTypeDef::Map(map) => ContractSpecType::Map {
            key: Box::new(type_descriptor(&map.key_type)),
            value: Box::new(type_descriptor(&map.value_type)),
        },
        ScSpecTypeDef::Tuple(tuple) => ContractSpecType::Tuple {
            elems: tuple.value_types.iter().map(type_descriptor).collect(),
        },
        ScSpecTypeDef::Udt(udt) => ContractSpecType::Udt {
            name: udt.name.to_string(),
        },
    }
}

/// Payload type of a union case: unit cases carry no value, tuple cases carry a
/// single descriptor (or a `tuple` for multi-value payloads).
fn union_case_descriptor(case: &ScSpecUdtUnionCaseV0) -> Value {
    match case {
        ScSpecUdtUnionCaseV0::VoidV0(_) => Value::Null,
        ScSpecUdtUnionCaseV0::TupleV0(tuple) => {
            let types = tuple.type_.iter().map(type_descriptor).collect::<Vec<_>>();
            match types.len() {
                1 => json!(types.into_iter().next().expect("len checked above")),
                _ => json!(ContractSpecType::Tuple { elems: types }),
            }
        }
    }
}

fn union_case_name(case: &ScSpecUdtUnionCaseV0) -> String {
    match case {
        ScSpecUdtUnionCaseV0::VoidV0(case) => case.name.to_string(),
        ScSpecUdtUnionCaseV0::TupleV0(case) => case.name.to_string(),
    }
}

fn build_spec_response(contract_id: &str, network: &str, entries: &[ScSpecEntry]) -> Value {
    let mut functions = Vec::new();
    let mut contract_types = serde_json::Map::new();
    for entry in entries {
        match entry {
            ScSpecEntry::FunctionV0(function) => {
                functions.push(json!({
                    "name": function.name.to_string(),
                    "inputs": function.inputs.iter().map(|input| json!({
                        "name": input.name.to_string(),
                        "type": type_descriptor(&input.type_),
                    })).collect::<Vec<_>>(),
                    "outputs": function.outputs.iter().map(|output| json!({
                        "type": type_descriptor(output),
                    })).collect::<Vec<_>>(),
                }));
            }
            ScSpecEntry::UdtStructV0(structure) => {
                contract_types.insert(
                    structure.name.to_string(),
                    json!({
                        "kind": "struct",
                        "fields": structure.fields.iter().map(|field| json!({
                            "name": field.name.to_string(),
                            "type": type_descriptor(&field.type_),
                        })).collect::<Vec<_>>(),
                    }),
                );
            }
            ScSpecEntry::UdtEnumV0(enum_def) => {
                contract_types.insert(
                    enum_def.name.to_string(),
                    json!({
                        "kind": "enum",
                        "variants": enum_def.cases.iter().map(|case| json!({
                            "name": case.name.to_string(),
                            "type": null,
                        })).collect::<Vec<_>>(),
                    }),
                );
            }
            ScSpecEntry::UdtUnionV0(union_def) => {
                contract_types.insert(
                    union_def.name.to_string(),
                    json!({
                        "kind": "union",
                        "variants": union_def.cases.iter().map(|case| json!({
                            "name": union_case_name(case),
                            "type": union_case_descriptor(case),
                        })).collect::<Vec<_>>(),
                    }),
                );
            }
            ScSpecEntry::UdtErrorEnumV0(error_enum) => {
                contract_types.insert(
                    error_enum.name.to_string(),
                    json!({
                        "kind": "error_enum",
                        "variants": error_enum.cases.iter().map(|case| json!({
                            "name": case.name.to_string(),
                            "type": null,
                        })).collect::<Vec<_>>(),
                    }),
                );
            }
            ScSpecEntry::EventV0(_) => {}
        }
    }
    json!({
        "contract_id": contract_id,
        "network": network,
        "capability": "available",
        "functions": functions,
        "contract_types": contract_types,
    })
}

/// Decodes a `getLedgerEntries` entry payload. Modern Stellar RPC returns the
/// `LedgerEntryData` union (with `lastModifiedLedgerSeq` as a sibling field);
/// some RPC flavors return the full `LedgerEntry`. Accept both.
fn decode_ledger_data(xdr: &str) -> Result<LedgerEntryData, Error> {
    if let Ok(data) = LedgerEntryData::from_xdr_base64(xdr, Limits::none()) {
        return Ok(data);
    }
    LedgerEntry::from_xdr_base64(xdr, Limits::none())
        .map(|entry| entry.data)
        .map_err(|error| Error::BadRequest(format!("ledger entry is invalid XDR: {error}")))
}

/// Resolves a deployed contract's WASM bytes via the two-step ledger read:
/// contract instance entry (→ wasm hash) then contract code entry (→ bytes).
async fn read_deployed_wasm(
    state: &AppState,
    user_id: Uuid,
    auth: &ProjectAuth,
    network: &str,
    environment_id: Option<Uuid>,
    contract_id: &str,
) -> Result<Vec<u8>, Error> {
    let instance_key = contract_instance_ledger_key(contract_id)?;
    let instance_result = read_ledger_entries(
        state,
        user_id,
        auth,
        network,
        environment_id,
        vec![instance_key],
    )
    .await?;
    let instance_xdr = instance_result
        .pointer("/entries/0/xdr")
        .and_then(Value::as_str)
        .ok_or(Error::NotFound)?;
    let instance_entry = decode_ledger_data(instance_xdr)?;
    let wasm_hash = match instance_entry {
        LedgerEntryData::ContractData(data) => match data.val {
            ScVal::ContractInstance(ScContractInstance { executable, .. }) => match executable {
                ContractExecutable::Wasm(hash) => hash.0,
                _ => {
                    return Err(Error::Unprocessable(
                        "contract is not backed by WASM".into(),
                    ));
                }
            },
            _ => return Err(Error::NotFound),
        },
        _ => return Err(Error::NotFound),
    };
    let code_key = LedgerKey::ContractCode(LedgerKeyContractCode {
        hash: Hash(wasm_hash),
    })
    .to_xdr_base64(Limits::none())
    .map_err(Error::internal)?;
    let code_result = read_ledger_entries(
        state,
        user_id,
        auth,
        network,
        environment_id,
        vec![code_key],
    )
    .await?;
    let code_xdr = code_result
        .pointer("/entries/0/xdr")
        .and_then(Value::as_str)
        .ok_or(Error::NotFound)?;
    let code_entry = decode_ledger_data(code_xdr)?;
    match code_entry {
        LedgerEntryData::ContractCode(ContractCodeEntry { code, .. }) => Ok(code.to_vec()),
        _ => Err(Error::NotFound),
    }
}

/// Locates the `contractspecv0` custom section and decodes the concatenated
/// `ScSpecEntry` XDR stream it contains.
fn extract_contract_spec(wasm: &[u8]) -> Result<Vec<ScSpecEntry>, Error> {
    let mut spec_bytes = None;
    for payload in Parser::new(0).parse_all(wasm) {
        match payload
            .map_err(|error| Error::BadRequest(format!("contract WASM is invalid: {error}")))?
        {
            Payload::CustomSection(section) if section.name() == "contractspecv0" => {
                spec_bytes = Some(section.data().to_vec());
                break;
            }
            _ => {}
        }
    }
    let spec_bytes = spec_bytes.ok_or_else(|| {
        Error::Unprocessable("this contract does not expose a contract spec".into())
    })?;
    let mut cursor = Cursor::new(spec_bytes);
    let mut limited = Limited::new(&mut cursor, Limits::none());
    ScSpecEntry::read_xdr_iter(&mut limited)
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|error| Error::BadRequest(format!("contract spec is invalid XDR: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use stellar_xdr::{
        ScSpecFunctionInputV0, ScSpecFunctionV0, ScSpecTypeBytesN, ScSpecTypeMap, ScSpecTypeOption,
        ScSpecTypeResult, ScSpecTypeTuple, ScSpecTypeUdt, ScSpecTypeVec, ScSpecUdtEnumCaseV0,
        ScSpecUdtEnumV0, ScSpecUdtStructFieldV0, ScSpecUdtStructV0, ScSymbol, StringM, VecM,
        WriteXdr,
    };

    fn fn_input(name: &str, type_: ScSpecTypeDef) -> ScSpecFunctionInputV0 {
        ScSpecFunctionInputV0 {
            doc: StringM::try_from(Vec::new()).expect("doc"),
            name: StringM::try_from(name.as_bytes().to_vec()).expect("name"),
            type_,
        }
    }

    fn function(name: &str, inputs: Vec<ScSpecFunctionInputV0>) -> ScSpecEntry {
        ScSpecEntry::FunctionV0(ScSpecFunctionV0 {
            doc: StringM::try_from(Vec::new()).expect("doc"),
            name: ScSymbol::try_from(name.as_bytes().to_vec()).expect("symbol"),
            inputs: VecM::try_from(inputs).expect("inputs"),
            outputs: VecM::try_from(Vec::new()).expect("outputs"),
        })
    }

    fn encode_u32(out: &mut Vec<u8>, mut value: u32) {
        loop {
            let byte = (value & 0x7f) as u8;
            value >>= 7;
            if value != 0 {
                out.push(byte | 0x80);
            } else {
                out.push(byte);
                break;
            }
        }
    }

    /// Wraps the encoded spec entries in a minimal, structurally valid WASM
    /// module whose `contractspecv0` custom section carries them.
    fn wasm_with_spec(entries: &[ScSpecEntry]) -> Vec<u8> {
        let mut payload = Vec::new();
        for entry in entries {
            payload.extend(entry.to_xdr(Limits::none()).expect("entry encodes"));
        }
        let name = b"contractspecv0";
        let mut wasm = b"\0asm\x01\0\0\0".to_vec();
        let mut section = Vec::new();
        section.push(0_u8);
        encode_u32(&mut section, (1 + name.len() + payload.len()) as u32);
        encode_u32(&mut section, name.len() as u32);
        section.extend_from_slice(name);
        section.extend_from_slice(&payload);
        wasm.extend(section);
        wasm
    }

    /// Mirrors the well-known demo-storage contract: `DataKey` enum
    /// (`Admin`/`Balance`), a `Foo` struct, and functions using the scalar,
    /// composite, and UDT shapes the frontend must render.
    fn demo_storage_spec_entries() -> Vec<ScSpecEntry> {
        let data_key_enum = ScSpecEntry::UdtEnumV0(ScSpecUdtEnumV0 {
            doc: StringM::try_from(Vec::new()).expect("doc"),
            lib: StringM::try_from(b"soroban_sdk".to_vec()).expect("lib"),
            name: StringM::try_from(b"DataKey".to_vec()).expect("name"),
            cases: VecM::try_from(vec![
                ScSpecUdtEnumCaseV0 {
                    doc: StringM::try_from(Vec::new()).expect("doc"),
                    name: StringM::try_from(b"Admin".to_vec()).expect("name"),
                    value: 0,
                },
                ScSpecUdtEnumCaseV0 {
                    doc: StringM::try_from(Vec::new()).expect("doc"),
                    name: StringM::try_from(b"Balance".to_vec()).expect("name"),
                    value: 1,
                },
            ])
            .expect("cases"),
        });
        let foo_struct = ScSpecEntry::UdtStructV0(ScSpecUdtStructV0 {
            doc: StringM::try_from(Vec::new()).expect("doc"),
            lib: StringM::try_from(b"demo".to_vec()).expect("lib"),
            name: StringM::try_from(b"Foo".to_vec()).expect("name"),
            fields: VecM::try_from(vec![ScSpecUdtStructFieldV0 {
                doc: StringM::try_from(Vec::new()).expect("doc"),
                name: StringM::try_from(b"a".to_vec()).expect("name"),
                type_: ScSpecTypeDef::U32,
            }])
            .expect("fields"),
        });
        vec![
            data_key_enum,
            foo_struct,
            function(
                "somefunction",
                vec![
                    fn_input("me", ScSpecTypeDef::U32),
                    fn_input(
                        "them",
                        ScSpecTypeDef::Vec(Box::new(ScSpecTypeVec {
                            element_type: Box::new(ScSpecTypeDef::Address),
                        })),
                    ),
                    fn_input(
                        "maybe",
                        ScSpecTypeDef::Option(Box::new(ScSpecTypeOption {
                            value_type: Box::new(ScSpecTypeDef::Udt(ScSpecTypeUdt {
                                name: StringM::try_from(b"DataKey".to_vec()).expect("name"),
                            })),
                        })),
                    ),
                    fn_input(
                        "lookup",
                        ScSpecTypeDef::Map(Box::new(ScSpecTypeMap {
                            key_type: Box::new(ScSpecTypeDef::Symbol),
                            value_type: Box::new(ScSpecTypeDef::I128),
                        })),
                    ),
                ],
            ),
            function(
                "range",
                vec![
                    fn_input(
                        "bounds",
                        ScSpecTypeDef::Tuple(Box::new(ScSpecTypeTuple {
                            value_types: VecM::try_from(vec![
                                ScSpecTypeDef::U32,
                                ScSpecTypeDef::U32,
                            ])
                            .expect("tuple"),
                        })),
                    ),
                    fn_input("fixed", ScSpecTypeDef::BytesN(ScSpecTypeBytesN { n: 32 })),
                    fn_input(
                        "outcome",
                        ScSpecTypeDef::Result(Box::new(ScSpecTypeResult {
                            ok_type: Box::new(ScSpecTypeDef::I128),
                            error_type: Box::new(ScSpecTypeDef::Udt(ScSpecTypeUdt {
                                name: StringM::try_from(b"Foo".to_vec()).expect("name"),
                            })),
                        })),
                    ),
                ],
            ),
        ]
    }

    #[test]
    fn parses_demo_storage_spec_and_builds_descriptors() {
        let entries = demo_storage_spec_entries();
        let wasm = wasm_with_spec(&entries);
        let decoded = extract_contract_spec(&wasm).expect("spec parses");
        assert_eq!(decoded.len(), entries.len());
        let response = build_spec_response("CABC", "testnet", &decoded);
        assert_eq!(response["contract_id"], "CABC");
        assert_eq!(response["network"], "testnet");
        assert_eq!(response["capability"], "available");

        let functions = response["functions"].as_array().expect("functions");
        assert_eq!(functions.len(), 2);
        assert_eq!(functions[0]["name"], "somefunction");
        let inputs = functions[0]["inputs"].as_array().expect("inputs");
        assert_eq!(inputs.len(), 4);
        assert_eq!(inputs[0]["name"], "me");
        assert_eq!(inputs[0]["type"], json!({ "kind": "u32" }));
        assert_eq!(
            inputs[1]["type"],
            json!({ "kind": "vec", "elem": { "kind": "address" } })
        );
        assert_eq!(
            inputs[2]["type"],
            json!({ "kind": "option", "inner": { "kind": "udt", "name": "DataKey" } })
        );
        assert_eq!(
            inputs[3]["type"],
            json!({
                "kind": "map",
                "key": { "kind": "symbol" },
                "value": { "kind": "i128" }
            })
        );
        let range_inputs = functions[1]["inputs"].as_array().expect("range inputs");
        assert_eq!(
            range_inputs[0]["type"],
            json!({ "kind": "tuple", "elems": [{ "kind": "u32" }, { "kind": "u32" }] })
        );
        assert_eq!(
            range_inputs[1]["type"],
            json!({ "kind": "bytes_n", "n": 32 })
        );
        assert_eq!(
            range_inputs[2]["type"],
            json!({
                "kind": "result",
                "ok": { "kind": "i128" },
                "err": { "kind": "udt", "name": "Foo" }
            })
        );

        let types = response["contract_types"].as_object().expect("types");
        assert_eq!(types["DataKey"]["kind"], "enum");
        assert_eq!(
            types["DataKey"]["variants"],
            json!([
                { "name": "Admin", "type": null },
                { "name": "Balance", "type": null }
            ])
        );
        assert_eq!(types["Foo"]["kind"], "struct");
        assert_eq!(
            types["Foo"]["fields"],
            json!([{ "name": "a", "type": { "kind": "u32" } }])
        );
    }

    #[test]
    fn wasm_without_spec_section_is_unprocessable() {
        let wasm = b"\0asm\x01\0\0\0";
        match extract_contract_spec(wasm) {
            Err(Error::Unprocessable(_)) => {}
            other => panic!("expected unprocessable, got {other:?}"),
        }
    }

    #[test]
    fn malformed_wasm_is_bad_request() {
        match extract_contract_spec(&[0xff, 0xfe, 0x00]) {
            Err(Error::BadRequest(_)) => {}
            other => panic!("expected bad request, got {other:?}"),
        }
    }

    #[test]
    fn truncated_spec_xdr_is_bad_request() {
        let entries = demo_storage_spec_entries();
        let mut truncated = wasm_with_spec(&entries[..1]);
        truncated.truncate(truncated.len() - 3);
        match extract_contract_spec(&truncated) {
            Err(Error::BadRequest(_)) => {}
            other => panic!("expected bad request, got {other:?}"),
        }
    }

    #[tokio::test]
    #[ignore = "hits live Testnet RPC"]
    async fn live_testnet_contract_spec_resolves_known_contract() {
        use crate::simulations::contract_instance_ledger_key;
        let contract_id = "CBZH3SA6OYYUO4ALAQEL2A2RQVIE675NDGFF5QCN3ELH3P7UIDF3FJJW";
        let rpc = "https://soroban-testnet.stellar.org";
        let http = reqwest::Client::new();
        let call = |keys: Vec<String>| {
            let http = &http;
            async move {
                let response = http
                    .post(rpc)
                    .json(&json!({
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "getLedgerEntries",
                        "params": { "keys": keys }
                    }))
                    .send()
                    .await
                    .expect("rpc responds");
                let value: Value = response.json().await.expect("rpc json");
                value.get("result").cloned().unwrap_or(value)
            }
        };
        let instance_key = contract_instance_ledger_key(contract_id).expect("instance key");
        let instance_result = call(vec![instance_key]).await;
        eprintln!(
            "instance_result: {}",
            serde_json::to_string_pretty(&instance_result).unwrap()
        );
        let instance_xdr = instance_result
            .pointer("/entries/0/xdr")
            .and_then(Value::as_str)
            .expect("instance entry present");
        let instance = decode_ledger_data(instance_xdr).expect("instance entry decodes");
        let wasm_hash = match instance {
            LedgerEntryData::ContractData(data) => match data.val {
                ScVal::ContractInstance(ScContractInstance { executable, .. }) => {
                    match executable {
                        ContractExecutable::Wasm(hash) => hash.0,
                        _ => panic!("contract is not backed by WASM"),
                    }
                }
                _ => panic!("instance val is not a contract instance"),
            },
            _ => panic!("entry is not contract data"),
        };
        let code_key = LedgerKey::ContractCode(LedgerKeyContractCode {
            hash: Hash(wasm_hash),
        })
        .to_xdr_base64(Limits::none())
        .expect("code key encodes");
        let code_result = call(vec![code_key]).await;
        let code_xdr = code_result
            .pointer("/entries/0/xdr")
            .and_then(Value::as_str)
            .expect("code entry present");
        let code = decode_ledger_data(code_xdr).expect("code entry decodes");
        let wasm = match code {
            LedgerEntryData::ContractCode(entry) => entry.code.to_vec(),
            _ => panic!("entry is not contract code"),
        };
        let entries = extract_contract_spec(&wasm).expect("spec parses");
        let response = build_spec_response(contract_id, "testnet", &entries);
        let functions = response["functions"].as_array().expect("functions");
        assert!(
            !functions.is_empty(),
            "expected functions for {contract_id}: {response}"
        );
        eprintln!(
            "functions: {}",
            serde_json::to_string_pretty(&functions).expect("functions json")
        );
    }
}
