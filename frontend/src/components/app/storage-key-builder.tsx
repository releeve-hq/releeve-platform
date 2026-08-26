"use client";

// Structured storage-key builder powered by the SourceLens storage-schema
// endpoints. Given a verified contract, it shows the contract's `contracttype`
// key catalog (e.g. `DataKey`), collects field values, and builds either:
//   - an alert `storage_key` + comparison `condition` (onParams), or
//   - the `ledger_key_xdr` (onKey) for a simulation state override.
// Field values are rendered as canonical ScVal JSON that the SourceLens codec
// accepts (bare strkeys for Address, tagged objects for everything else).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";

type Scope = { organization: string | null; project: string | null };

type StorageFieldShape = { name: string; type: string; category: string };
type StorageKeyShape = {
  variant: string;
  kind: string;
  fields: StorageFieldShape[];
  value_type: string | null;
};
type StorageEnumShape = { name: string; variants: StorageKeyShape[] };
type StorageSchema = {
  enums: StorageEnumShape[];
  structs: unknown[];
  source_files_scanned: number;
  unsupported: string[];
};

export type BuiltStorageKey = {
  ledger_key_xdr: string;
  storage_key: string;
  contract: string;
  durability: string;
  key: unknown;
  variant: string | null;
  kind: string;
  fields: unknown[];
};

interface StorageKeyBuilderProps {
  scope: Scope;
  contractAddress?: string;
  verificationId?: string;
  onKey?: (key: BuiltStorageKey) => void;
  onParams?: (params: Record<string, unknown>) => void;
  onValue?: (valueXdr: string) => void;
  defaultOperator?: string;
}

const NUMERIC_TYPES = new Set([
  "u32", "i32", "u64", "i64", "u128", "i128", "u256", "i256",
]);

export default function StorageKeyBuilder({
  scope,
  contractAddress,
  verificationId: verificationIdProp,
  onKey,
  onParams,
  onValue,
  defaultOperator = "any_change",
}: StorageKeyBuilderProps) {
  const [verificationId, setVerificationId] = useState<string | null>(
    verificationIdProp ?? null,
  );
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [schema, setSchema] = useState<StorageSchema | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [enumName, setEnumName] = useState<string>("");
  const [variantName, setVariantName] = useState<string>("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [operator, setOperator] = useState<string>(defaultOperator);
  const [threshold, setThreshold] = useState<string>("");
  const [built, setBuilt] = useState<BuiltStorageKey | null>(null);
  const [valueJson, setValueJson] = useState<string>("");
  const [valueError, setValueError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const basePath = useMemo(
    () => `/api/v1/${scope.organization ?? ""}/${scope.project ?? ""}`,
    [scope],
  );
  // Keep the latest callbacks in refs so the encode effect never re-fires on
  // parent re-renders (which would loop: encode -> setParams -> re-render).
  const onKeyRef = useRef(onKey);
  const onParamsRef = useRef(onParams);
  const onValueRef = useRef(onValue);
  useEffect(() => {
    onKeyRef.current = onKey;
    onParamsRef.current = onParams;
    onValueRef.current = onValue;
  });

  // Resolve the platform verification id when only the contract address is given.
  useEffect(() => {
    if (verificationId || !contractAddress) return;
    let cancelled = false;
    (async () => {
      try {
        const history = await api.get<any>(
          `/api/v1/${scope.organization}/${scope.project}/contracts/${contractAddress}/verifications?limit=10`,
        );
        const latest = (history.data ?? []).find(
          (item: any) => item.status === "succeeded",
        );
        if (latest?.id) {
          setVerificationId(String(latest.id));
        } else {
          setVerificationError("Contract has no successful verification — storage keys are unavailable.");
        }
      } catch (err: any) {
        if (!cancelled) {
          setVerificationError(err?.message ?? "Could not resolve contract verification.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [verificationId, contractAddress, scope, basePath]);

  // Load the storage-schema once the verification id is known.
  useEffect(() => {
    if (!verificationId) return;
    let cancelled = false;
    setSchemaLoading(true);
    setError(null);
    (async () => {
      try {
        const payload = await api.get<any>(
          `${basePath}/verifications/${verificationId}/storage-schema`,
        );
        if (cancelled) return;
        const next: StorageSchema = payload.storage_schema ?? {
          enums: [],
          structs: [],
          source_files_scanned: 0,
          unsupported: [],
        };
        setSchema(next);
        const preferred = next.enums.find((item) => item.name === "DataKey") ?? next.enums[0];
        setEnumName(preferred?.name ?? "");
        setVariantName(preferred?.variants[0]?.variant ?? "");
        setFieldValues({});
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? "Could not load the storage schema.");
      } finally {
        if (!cancelled) setSchemaLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [verificationId, basePath]);

  const selectedEnum = useMemo(
    () => schema?.enums.find((item) => item.name === enumName),
    [schema, enumName],
  );
  const selectedVariant = useMemo(
    () => selectedEnum?.variants.find((item) => item.variant === variantName),
    [selectedEnum, variantName],
  );

  const canCompare = useMemo(() => {
    if (operator === "any_change") return true;
    const valueType = selectedVariant?.value_type;
    if (valueType && NUMERIC_TYPES.has(valueType)) return true;
    // Without a declared value type the eval-time check is numeric-safe anyway.
    return true;
  }, [operator, selectedVariant]);

  // Build field ScVal JSON from the entered values.
  const buildFields = useCallback((): { fields: unknown[]; ok: boolean } => {
    if (!selectedVariant) return { fields: [], ok: false };
    const fields: unknown[] = [];
    for (let index = 0; index < selectedVariant.fields.length; index += 1) {
      const shape = selectedVariant.fields[index];
      const raw = (fieldValues[`${index}`] ?? "").trim();
      if (raw === "") return { fields: [], ok: false };
      switch (shape.category) {
        case "address":
          fields.push(raw);
          break;
        case "uint":
        case "int": {
          const tag = NUMERIC_TYPES.has(shape.type) ? shape.type : "i128";
          const isSmall = tag === "u32" || tag === "i32";
          fields.push(isSmall ? { [tag]: Number(raw) } : { [tag]: String(raw) });
          break;
        }
        case "bool":
          fields.push({ bool: raw === "true" });
          break;
        case "symbol":
          fields.push({ symbol: raw });
          break;
        case "string":
          fields.push({ string: raw });
          break;
        case "bytes":
          fields.push({ bytes: raw });
          break;
        default: {
          // opaque / contracttype struct: accept canonical ScVal JSON as-is.
          try {
            fields.push(JSON.parse(raw));
          } catch {
            return { fields: [], ok: false };
          }
        }
      }
    }
    return { fields, ok: true };
  }, [selectedVariant, fieldValues]);

  // Encode whenever variant/fields change.
  useEffect(() => {
    if (!verificationId || !variantName) {
      setBuilt(null);
      return;
    }
    const { fields, ok } = buildFields();
    if (!ok) {
      setBuilt(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = await api.post<BuiltStorageKey>(
          `${basePath}/verifications/${verificationId}/storage-keys/encode`,
          { variant: variantName, fields },
        );
        if (cancelled) return;
        setBuilt(result);
        setError(null);
        onKeyRef.current?.(result);
        onParamsRef.current?.({
          entry_type: "contract_data",
          storage_key: result.storage_key,
          condition:
            operator === "any_change"
              ? { any_change: true }
              : { comparator: operator, value: threshold },
        });
      } catch (err: any) {
        if (!cancelled) {
          setBuilt(null);
          setError(err?.message ?? "Could not build the storage key.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    verificationId,
    basePath,
    variantName,
    buildFields,
    operator,
    threshold,
  ]);

  // Build a full LedgerEntryData value XDR when the key is built and a value is
  // entered (the override value editor — fork-core needs the full entry).
  useEffect(() => {
    if (!verificationId || !built || !onValueRef.current || !valueJson.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(valueJson);
    } catch {
      setValueError("Value must be valid canonical ScVal JSON.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = await api.post<{ value_xdr: string }>(
          `${basePath}/verifications/${verificationId}/storage-keys/build-value`,
          {
            contract: built.contract,
            key: built.key,
            durability: built.durability === "temporary" ? "temporary" : "persistent",
            value: parsed,
          },
        );
        if (cancelled) return;
        setValueError(null);
        onValueRef.current?.(result.value_xdr);
      } catch (err: any) {
        if (!cancelled) setValueError(err?.message ?? "Could not build the value XDR.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [verificationId, basePath, built, valueJson]);

  if (verificationError) {
    return <p className="pw-hint pw-error">{verificationError}</p>;
  }
  if (!verificationId) {
    return <p className="pw-hint">Loading verification…</p>;
  }
  if (schemaLoading) {
    return <p className="pw-hint">Loading storage schema…</p>;
  }
  if (!schema || schema.enums.length === 0) {
    return (
      <p className="pw-hint">
        No storage-key schema was found in the verified source. The contract may
        not use a <code>#[contracttype]</code> key enum, or it used an unsupported
        encoding — use the raw XDR/JSON fields instead.
      </p>
    );
  }

  return (
    <div className="pw-storage-key-builder">
      {schema.enums.length > 1 && (
        <label className="pw-label">
          Key enum
          <select
            className="pw-field"
            value={enumName}
            onChange={(event) => {
              const next = schema.enums.find((item) => item.name === event.target.value);
              setEnumName(event.target.value);
              setVariantName(next?.variants[0]?.variant ?? "");
              setFieldValues({});
            }}
          >
            {schema.enums.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="pw-label">
        Storage key
        <select
          className="pw-field"
          value={variantName}
          onChange={(event) => {
            setVariantName(event.target.value);
            setFieldValues({});
          }}
        >
          {(selectedEnum?.variants ?? []).map((item) => (
            <option key={item.variant} value={item.variant}>
              {item.variant}
            </option>
          ))}
        </select>
      </label>

      {(selectedVariant?.fields ?? []).map((field, index) => (
        <label className="pw-label" key={`${selectedVariant?.variant ?? ""}-${field.name}`}>
          {selectedVariant?.kind === "tuple" ? field.type : field.name}
          {field.category === "opaque" && <span className="pw-hint"> (raw ScVal JSON)</span>}
          <input
            className="pw-field pw-mono"
            value={fieldValues[`${index}`] ?? ""}
            onChange={(event) =>
              setFieldValues((current) => ({ ...current, [`${index}`]: event.target.value }))
            }
            placeholder={
              field.category === "address"
                ? "G… or C… strkey"
                : field.category === "bytes"
                  ? "hex"
                  : field.category === "opaque"
                    ? '{"symbol":"..."}'
                    : field.type
            }
          />
        </label>
      ))}

      <div className="pw-alert-condition-row">
        <label className="pw-label">
          When value
          <select
            className="pw-field"
            value={operator}
            onChange={(event) => setOperator(event.target.value)}
          >
            <option value="any_change">changes</option>
            <option value="==">equals</option>
            <option value="!=">not equal</option>
            <option value=">">greater than</option>
            <option value=">=">greater than or equal</option>
            <option value="<">less than</option>
            <option value="<=">less than or equal</option>
          </select>
        </label>
        {operator !== "any_change" && (
          <label className="pw-label">
            Threshold
            <input
              className="pw-field pw-mono"
              value={threshold}
              onChange={(event) => setThreshold(event.target.value)}
              placeholder="1500"
            />
          </label>
        )}
      </div>

      {canCompare ? null : (
        <p className="pw-hint">This key stores a non-numeric value — comparison is limited to equality.</p>
      )}
      {onValue && built && (
        <label className="pw-label">
          Override value (canonical ScVal JSON)
          <textarea
            className="pw-field pw-mono"
            rows={2}
            value={valueJson}
            onChange={(event) => setValueJson(event.target.value)}
            placeholder='{"i128":"2000"}'
          />
        </label>
      )}
      {valueError && <p className="pw-error">{valueError}</p>}
      {error && <p className="pw-error">{error}</p>}
      {built && (
        <p className="pw-hint pw-mono">
          {built.variant ? `${built.variant}(…)` : "key"} → {built.storage_key.slice(0, 90)}
          {built.storage_key.length > 90 ? "…" : ""}
        </p>
      )}
    </div>
  );
}