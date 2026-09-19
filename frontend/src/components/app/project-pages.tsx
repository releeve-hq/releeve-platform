"use client";

import {
  type FormEvent,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import StorageKeyBuilder from "./storage-key-builder";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  type LucideIcon,
  Activity,
  AlarmClock,
  ArrowLeft,
  Bell,
  Blocks,
  Box,
  Braces,
  Bug,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  CircleDollarSign,
  Clock3,
  Code2,
  Copy,
  Database,
  FileCode2,
  Filter,
  Globe,
  History,
  Layers3,
  LoaderCircle,
  MoreVertical,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Tag,
  Trash2,
  UserRound,
  Wallet,
  X,
  XCircle,
  Zap,
} from "lucide-react";

import { ApiError, api } from "@/lib/api";
import { EntityIdenticon } from "@/components/explorer/entity-identicon";
import { EntityCopyButton } from "@/components/explorer/entity-copy-button";
import { ContractExplorerDesign } from "@/components/explorer/entity-design-views";
import { WalletExplorerDesign } from "@/components/explorer/explorer-design-views";
import { getRecentLedgers, lookupExplorer } from "@/lib/explorer-api";
import type {
  ExplorerAccountDetail,
  ExplorerContractDetail,
} from "@/lib/explorer-api";
import { truncateEntity } from "@/lib/explorer-routes";

import "./project-workflows.css";
import { CreateEnvironmentModal, type CreateEnvironmentInput } from "./virtual-environment-ui";
const EnvironmentWorkspace = dynamic(
  () => import("./environment-workspace").then((module) => module.EnvironmentWorkspace),
  { ssr: false },
);

export type ProjectScope = {
  organization: string | null;
  project: string | null;
  projectId: string | null;
  network: "mainnet" | "testnet" | "futurenet";
};

const contractNetworks = ["mainnet", "testnet", "futurenet"] as const;
type ContractNetwork = (typeof contractNetworks)[number];
const simulationNetworks = ["mainnet", "testnet"] as const;

type PaginationState = {
  next_cursor?: string | null;
  prev_cursor?: string | null;
};

type CursorPage<T> = PaginationState & {
  data: T[];
  pagination?: PaginationState;
};

type TrackedEntity = {
  id?: string;
  name?: string | null;
  address: string;
  network: string;
  last_synced_at?: string | null;
  appearance_color?: string | null;
  tags?: Array<{ id?: string; name?: string; color?: string | null } | string>;
};

type ProjectTag = {
  id: string;
  name: string;
  color?: string | null;
};

const MIN_REFRESH_SPIN_MS = 650;

const refreshSpinDelay = () =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, MIN_REFRESH_SPIN_MS);
  });

const walletCheckNetworks = ["mainnet", "testnet"] as const;
type WalletCheckNetwork = (typeof walletCheckNetworks)[number];
type WalletNetworkCheck = {
  exists: boolean;
  loading: boolean;
  error: string | null;
};

const emptyWalletNetworkChecks = (): Record<
  WalletCheckNetwork,
  WalletNetworkCheck
> => ({
  mainnet: { exists: false, loading: false, error: null },
  testnet: { exists: false, loading: false, error: null },
});

type Environment = {
  id: string;
  name: string;
  network: string;
  created_at: string;
  protocol: number;
  base_ledger_sequence: number;
  sync_status: string;
  sync_enabled: boolean;
  mode?: "frozen" | "follow_latest";
  active_revision_id?: string | null;
  revision?: number | null;
  requested_ledger?: number | null;
  state_ledger?: number | null;
  execution_ledger?: number | null;
  state_hash?: string | null;
  verification_status?: string;
  initialization_status?: "preparing" | "ready" | "failed";
  initialization_progress?: number;
  initialization_error?: { code?: string; message?: string } | null;
  public_explorer_enabled?: boolean;
  rpc_slug?: string | null;
  rpc_url?: string;
  admin_rpc_url?: string;
  admin_secret?: string;
};

type Simulation = {
  id: string;
  status: string;
  source?: string | null;
  target?: string | null;
  function_name: string;
  base_ledger_sequence: number;
  created_at: string;
  completed_at?: string | null;
  fork_core_summary?: unknown;
  requested_ledger?: number | null;
  state_ledger?: number | null;
  execution_ledger?: number | null;
  stage?: string;
  progress?: number;
  fork_environment_id?: string | null;
};

type SimulationLedgerEntry = {
  key: string;
  raw_xdr?: string | null;
  value_xdr?: string | null;
  decoded_key: string;
  decoded_value: string;
  durability: string;
  ttl?: number | null;
};

// ---- Contract spec (auto-loaded from /simulations/contract-spec) ----

type ContractSpecType =
  | { kind: "val" }
  | { kind: "bool" }
  | { kind: "void" }
  | { kind: "error" }
  | { kind: "u32" }
  | { kind: "i32" }
  | { kind: "u64" }
  | { kind: "i64" }
  | { kind: "timepoint" }
  | { kind: "duration" }
  | { kind: "u128" }
  | { kind: "i128" }
  | { kind: "u256" }
  | { kind: "i256" }
  | { kind: "bytes" }
  | { kind: "string" }
  | { kind: "symbol" }
  | { kind: "address" }
  | { kind: "muxed_address" }
  | { kind: "bytes_n"; n: number }
  | { kind: "option"; inner: ContractSpecType }
  | { kind: "result"; ok: ContractSpecType; err: ContractSpecType }
  | { kind: "vec"; elem: ContractSpecType }
  | { kind: "map"; key: ContractSpecType; value: ContractSpecType }
  | { kind: "tuple"; elems: ContractSpecType[] }
  | { kind: "udt"; name: string };

type ContractSpecFunction = {
  name: string;
  inputs: Array<{ name: string; type: ContractSpecType }>;
  outputs: Array<{ type: ContractSpecType }>;
};

type ContractTypeDescriptor =
  | { kind: "struct"; fields: Array<{ name: string; type: ContractSpecType }> }
  | {
      kind: "enum";
      variants: Array<{ name: string; type: ContractSpecType | null }>;
    }
  | {
      kind: "union";
      variants: Array<{ name: string; type: ContractSpecType | null }>;
    }
  | {
      kind: "error_enum";
      variants: Array<{ name: string; type: ContractSpecType | null }>;
    };

type ContractTypes = Record<string, ContractTypeDescriptor>;

type ContractSpecResponse = {
  contract_id: string;
  network: string;
  capability: string;
  functions: ContractSpecFunction[];
  contract_types: ContractTypes;
};

type FunctionOption = {
  name: string;
  inputs: Array<{ name: string; type: ContractSpecType }>;
  fromSpec: boolean;
};

type TargetSuggestion = {
  kind: "account" | "contract";
  value: string;
  label: string;
  description: string;
};

/// Recursive editor value model. Scalar inputs stay as free text so users can
/// type freely; everything else is structured and validated as they type.
type EditorValue =
  | { kind: "scalar"; text: string }
  | { kind: "bool"; value: boolean }
  | { kind: "list"; items: EditorValue[] }
  | {
      kind: "map";
      rows: Array<{ key: EditorValue; value: EditorValue }>;
    }
  | { kind: "option"; some: boolean; value: EditorValue | null }
  | { kind: "result"; ok: boolean; value: EditorValue | null }
  | {
      kind: "udt";
      name: string;
      variant: string;
      fields: Record<string, EditorValue>;
    };

type ProjectTransaction = {
  hash?: string;
  tx_hash?: string;
  status?: string;
  ledger_sequence?: number;
  operation_type?: string;
  timestamp?: string;
  source_account?: string;
};

type ContractEvent = {
  id?: string;
  tx_hash?: string;
  topics?: unknown;
  data?: unknown;
  ledger_sequence?: number;
  timestamp?: string;
};

type AlertExpression = { type: string; params: unknown };
type AlertRule = {
  id: string;
  name: string;
  target: { type: string; value?: string | null };
  expressions: AlertExpression[];
  match_logic: "all" | "any";
  enabled: boolean;
  destinations: Array<{ id: string; scope: string }>;
  created_at: string;
};

type AlertFiring = {
  id: string;
  tx_hash?: string | null;
  simulation_id?: string | null;
  fired_at: string;
};

type DestinationRef = { id: string; scope: string };
type ProjectDestination = {
  id: string;
  scope: string;
  type: string;
  config?: Record<string, unknown>;
  created_at: string;
};
type AlertSection = "alerts" | "history" | "destinations";
type AlertBuilderStep = 1 | 2 | 3 | 4;

const expressionOptions = [
  ["failed_transaction", "Failed transaction"],
  ["successful_transaction", "Successful transaction"],
  ["tx_error", "Transaction error"],
  ["function_call", "Contract function call"],
  ["event_emitted", "Contract event emitted"],
  ["token_transfer", "Token transfer"],
  ["balance_change", "Balance change"],
  ["state_change", "Contract state change"],
  ["allowlisted_callers", "Allowlisted source account"],
  ["blocklisted_callers", "Blocklisted source account"],
  ["view_function", "View function result"],
] as const;

const alertTypeDetails: Record<
  string,
  { description: string; icon: LucideIcon }
> = {
  successful_transaction: {
    description: "Triggers whenever a successful transaction happens.",
    icon: Check,
  },
  failed_transaction: {
    description: "Triggers whenever a transaction fails.",
    icon: XCircle,
  },
  tx_error: {
    description: "Triggers whenever a transaction reports an error.",
    icon: Bug,
  },
  function_call: {
    description: "Triggers whenever a specific contract function is called.",
    icon: Code2,
  },
  event_emitted: {
    description: "Triggers whenever a specific contract event is emitted.",
    icon: Bell,
  },
  token_transfer: {
    description: "Triggers whenever a token transfer is detected.",
    icon: Wallet,
  },
  balance_change: {
    description: "Triggers when a native balance matches the conditions.",
    icon: CircleDollarSign,
  },
  state_change: {
    description: "Triggers whenever a contract state value changes.",
    icon: Braces,
  },
  allowlisted_callers: {
    description: "Triggers for calls from an allowlisted source account.",
    icon: ShieldCheck,
  },
  blocklisted_callers: {
    description: "Triggers for calls from a blocklisted source account.",
    icon: XCircle,
  },
  view_function: {
    description: "Triggers whenever a view function result changes.",
    icon: Layers3,
  },
};

const alertTargetDetails: Array<{
  type: string;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    type: "address",
    label: "Address",
    description: "Receive alerts for one account or contract address.",
    icon: UserRound,
  },
  {
    type: "network",
    label: "Network",
    description: "Receive alerts for addresses deployed on a network.",
    icon: Globe,
  },
  {
    type: "project",
    label: "Project",
    description: "Receive alerts for every address in this project.",
    icon: Blocks,
  },
  {
    type: "tag",
    label: "Tag",
    description: "Receive alerts for every address with a selected tag.",
    icon: Tag,
  },
];

const alertDestinationOptions: Array<{
  type: string;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  { type: "webhook", label: "Webhook", description: "Send alert payloads to an HTTPS endpoint.", icon: Zap },
  { type: "action", label: "Action", description: "Trigger a configured project action.", icon: Activity },
  { type: "email", label: "Email", description: "Deliver notifications to an email destination.", icon: Bell },
  { type: "slack", label: "Slack", description: "Post notifications to a Slack channel.", icon: Blocks },
  { type: "discord", label: "Discord", description: "Post notifications to a Discord channel.", icon: Box },
  { type: "telegram", label: "Telegram", description: "Send notifications to a Telegram chat.", icon: Wallet },
  { type: "sentry", label: "Sentry", description: "Forward alert events to Sentry.", icon: ShieldCheck },
  { type: "pagerduty", label: "PagerDuty", description: "Create incidents in PagerDuty.", icon: Clock3 },
];

function scopePath(scope: ProjectScope, path: string) {
  if (!scope.organization || !scope.project) return null;
  return `/api/v1/${encodeURIComponent(scope.organization)}/${encodeURIComponent(scope.project)}${path}`;
}

const stellarBase32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeStellarBase32(value: string): Uint8Array | null {
  const clean = value.trim().toUpperCase();
  let bits = 0;
  let buffer = 0;
  const output: number[] = [];
  for (const char of clean) {
    const index = stellarBase32Alphabet.indexOf(char);
    if (index < 0) return null;
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

function crc16Xmodem(bytes: Uint8Array) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let index = 0; index < 8; index += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function isValidStellarContractId(value: string) {
  const clean = value.trim().toUpperCase();
  if (!/^C[A-Z2-7]{55}$/.test(clean)) return false;
  const decoded = decodeStellarBase32(clean);
  if (!decoded || decoded.length !== 35 || decoded[0] !== 0x10) return false;
  const payload = decoded.slice(0, 33);
  const checksum = decoded[33] | (decoded[34] << 8);
  return crc16Xmodem(payload) === checksum;
}

function isValidStellarAddress(value: string) {
  const clean = value.trim().toUpperCase();
  if (!/^[CG][A-Z2-7]{55}$/.test(clean)) return false;
  const decoded = decodeStellarBase32(clean);
  if (!decoded || decoded.length !== 35) return false;
  const version = clean[0] === "C" ? 0x10 : 0x06;
  if (decoded[0] !== version) return false;
  const payload = decoded.slice(0, 33);
  const checksum = decoded[33] | (decoded[34] << 8);
  return crc16Xmodem(payload) === checksum;
}

const integerBounds: Record<string, { min: bigint; max: bigint }> = {
  u32: { min: BigInt(0), max: BigInt("4294967295") },
  i32: { min: BigInt("-2147483648"), max: BigInt("2147483647") },
  u64: { min: BigInt(0), max: BigInt("18446744073709551615") },
  i64: { min: BigInt("-9223372036854775808"), max: BigInt("9223372036854775807") },
  u128: { min: BigInt(0), max: BigInt("340282366920938463463374607431768211455") },
  i128: {
    min: BigInt("-170141183460469231731687303715884105728"),
    max: BigInt("170141183460469231731687303715884105727"),
  },
  u256: {
    min: BigInt(0),
    max: BigInt("115792089237316195423570985008687907853269984665640564039457584007913129639935"),
  },
  i256: {
    min: BigInt("-57896044618658097711785492504343953926634992332820282019728792003956564819968"),
    max: BigInt("57896044618658097711785492504343953926634992332820282019728792003956564819967"),
  },
};

function scalarKind(type: ContractSpecType): string {
  if (type.kind === "timepoint" || type.kind === "duration") return "u64";
  return type.kind;
}

function scalarPlaceholder(type: ContractSpecType): string {
  switch (type.kind) {
    case "address":
    case "muxed_address":
      return "C… or G…";
    case "u32":
      return "0 to 4294967295";
    case "i32":
      return "-2147483648 to 2147483647";
    case "u64":
    case "timepoint":
    case "duration":
      return "0 to 18446744073709551615";
    case "i64":
      return "-9223372036854775808 to 9223372036854775807";
    case "u128":
      return "0 to 340282366920938463463374607431768211455";
    case "i128":
      return "-170141183460469231731687303715884105728 to 170141183460469231731687303715884105727";
    case "u256":
      return "0 to 2^256-1";
    case "i256":
      return "-2^255 to 2^255-1";
    case "string":
      return "text";
    case "symbol":
      return "symbol (= 32 bytes)";
    case "bytes":
      return "hex, even length";
    case "bytes_n":
      return `hex, exactly ${type.n} bytes`;
    default:
      return "";
  }
}

function typeLabel(type: ContractSpecType): string {
  switch (type.kind) {
    case "u32":
      return "uint32";
    case "i32":
      return "int32";
    case "u64":
      return "uint64";
    case "i64":
      return "int64";
    case "u128":
      return "uint128";
    case "i128":
      return "int128";
    case "u256":
      return "uint256";
    case "i256":
      return "int256";
    case "timepoint":
      return "timepoint";
    case "duration":
      return "duration";
    case "bytes_n":
      return `bytesN(${type.n})`;
    case "option":
      return `option<${typeLabel(type.inner)}>`;
    case "result":
      return `result<${typeLabel(type.ok)}, ${typeLabel(type.err)}>`;
    case "vec":
      return `vec<${typeLabel(type.elem)}>`;
    case "map":
      return `map<${typeLabel(type.key)}, ${typeLabel(type.value)}>`;
    case "tuple":
      return `(${type.elems.map(typeLabel).join(", ")})`;
    case "udt":
      return type.name;
    default:
      return type.kind;
  }
}

function defaultUdtEditorValue(name: string, types: ContractTypes): EditorValue {
  const descriptor = types[name];
  if (!descriptor) return { kind: "udt", name, variant: "", fields: {} };
  if (descriptor.kind === "enum" || descriptor.kind === "error_enum") {
    return { kind: "udt", name, variant: descriptor.variants[0]?.name ?? "", fields: {} };
  }
  if (descriptor.kind === "union") {
    const first = descriptor.variants[0];
    const fields: Record<string, EditorValue> = {};
    if (first?.type) fields[first.name] = defaultEditorValue(first.type, types);
    return { kind: "udt", name, variant: first?.name ?? "", fields };
  }
  const fields: Record<string, EditorValue> = {};
  for (const field of descriptor.fields) fields[field.name] = defaultEditorValue(field.type, types);
  return { kind: "udt", name, variant: "", fields };
}

function defaultEditorValue(type: ContractSpecType, types: ContractTypes): EditorValue {
  switch (type.kind) {
    case "bool":
      return { kind: "bool", value: false };
    case "option":
      return { kind: "option", some: false, value: null };
    case "result":
      return { kind: "result", ok: true, value: null };
    case "vec":
      return { kind: "list", items: [] };
    case "tuple":
      return {
        kind: "list",
        items: type.elems.map((element) => defaultEditorValue(element, types)),
      };
    case "map":
      return { kind: "map", rows: [] };
    case "udt":
      return defaultUdtEditorValue(type.name, types);
    default:
      return { kind: "scalar", text: "" };
  }
}

function validateEditorValue(
  type: ContractSpecType,
  value: EditorValue,
  types: ContractTypes,
): string | null {
  switch (type.kind) {
    case "address":
    case "muxed_address": {
      const text = value.kind === "scalar" ? value.text.trim() : "";
      if (!text) return "Required";
      return isValidStellarAddress(text) ? null : "Enter a valid C… or G… Stellar address";
    }
    case "u32":
    case "i32":
    case "u64":
    case "i64":
    case "u128":
    case "i128":
    case "u256":
    case "i256":
    case "timepoint":
    case "duration": {
      const text = value.kind === "scalar" ? value.text.trim() : "";
      if (!text) return "Required";
      if (!/^-?\d+$/.test(text)) return "Enter a whole number";
      try {
        const number = BigInt(text);
        const bounds = integerBounds[scalarKind(type)];
        if (number < bounds.min || number > bounds.max) return "Number is out of range";
      } catch {
        return "Enter a whole number";
      }
      return null;
    }
    case "string": {
      const text = value.kind === "scalar" ? value.text : "";
      return text ? null : "Required";
    }
    case "symbol": {
      const text = value.kind === "scalar" ? value.text : "";
      if (!text) return "Required";
      return new TextEncoder().encode(text).length > 32 ? "Symbol must be = 32 bytes" : null;
    }
    case "bytes": {
      const text = value.kind === "scalar" ? value.text.trim() : "";
      if (!text) return "Required";
      if (!/^[0-9a-fA-F]*$/.test(text)) return "Hex only";
      return text.length % 2 === 0 ? null : "Hex must have an even number of digits";
    }
    case "bytes_n": {
      const text = value.kind === "scalar" ? value.text.trim() : "";
      if (!text) return "Required";
      if (!/^[0-9a-fA-F]*$/.test(text)) return "Hex only";
      if (text.length % 2 !== 0) return "Hex must have an even number of digits";
      return text.length / 2 === type.n ? null : `Expected exactly ${type.n} bytes`;
    }
    case "bool":
      return value.kind === "bool" ? null : "Required";
    case "option": {
      if (value.kind !== "option") return "Required";
      if (!value.some) return null;
      return value.value ? validateEditorValue(type.inner, value.value, types) : "Required";
    }
    case "result": {
      if (value.kind !== "result") return "Required";
      if (!value.value) return "Required";
      return validateEditorValue(value.ok ? type.ok : type.err, value.value, types);
    }
    case "vec": {
      if (value.kind !== "list") return "Required";
      for (const item of value.items) {
        const error = validateEditorValue(type.elem, item, types);
        if (error) return error;
      }
      return null;
    }
    case "tuple": {
      if (value.kind !== "list") return "Required";
      for (let index = 0; index < type.elems.length; index += 1) {
        const error = validateEditorValue(type.elems[index], value.items[index], types);
        if (error) return error;
      }
      return null;
    }
    case "map": {
      if (value.kind !== "map") return "Required";
      for (const row of value.rows) {
        const keyError = validateEditorValue(type.key, row.key, types);
        if (keyError) return `Key: ${keyError}`;
        const valueError = validateEditorValue(type.value, row.value, types);
        if (valueError) return `Value: ${valueError}`;
      }
      return null;
    }
    case "udt": {
      if (value.kind !== "udt") return "Required";
      const descriptor = types[type.name];
      if (!descriptor) return `Unknown type ${type.name}`;
      if (descriptor.kind === "enum" || descriptor.kind === "error_enum") {
        return descriptor.variants.some((variant) => variant.name === value.variant)
          ? null
          : "Pick a variant";
      }
      if (descriptor.kind === "union") {
        const variant = descriptor.variants.find((candidate) => candidate.name === value.variant);
        if (!variant) return "Pick a variant";
        if (!variant.type) return null;
        return value.fields[variant.name]
          ? validateEditorValue(variant.type, value.fields[variant.name], types)
          : "Required";
      }
      for (const field of descriptor.fields) {
        const error = validateEditorValue(field.type, value.fields[field.name], types);
        if (error) return `${field.name}: ${error}`;
      }
      return null;
    }
    default:
      return null;
  }
}

function editorValueToCanonical(
  type: ContractSpecType,
  value: EditorValue,
  types: ContractTypes,
): unknown {
  switch (type.kind) {
    case "address":
    case "muxed_address":
      return { address: value.kind === "scalar" ? value.text.trim() : "" };
    case "u32":
    case "i32":
      return { [type.kind]: Number(value.kind === "scalar" ? value.text.trim() : "") };
    case "u64":
    case "i64":
    case "u128":
    case "i128":
    case "u256":
    case "i256":
    case "timepoint":
    case "duration":
      return { [type.kind]: value.kind === "scalar" ? value.text.trim() : "" };
    case "string":
    case "symbol":
      return { [type.kind]: value.kind === "scalar" ? value.text : "" };
    case "bytes":
    case "bytes_n":
      return { bytes: value.kind === "scalar" ? value.text.trim() : "" };
    case "bool":
      return { bool: value.kind === "bool" ? value.value : false };
    case "void":
      return { void: null };
    case "option": {
      const option = value.kind === "option" ? value : { some: false, value: null };
      if (!option.some || !option.value) return { vec: [] };
      return editorValueToCanonical(type.inner, option.value, types);
    }
    case "result": {
      const result = value.kind === "result" ? value : { ok: true, value: null };
      const side = result.ok ? "Ok" : "Err";
      const payload = result.value
        ? editorValueToCanonical(result.ok ? type.ok : type.err, result.value, types)
        : null;
      return { vec: [{ symbol: side }, payload] };
    }
    case "vec": {
      const list = value.kind === "list" ? value : { items: [] as EditorValue[] };
      return {
        vec: list.items.map((item) => editorValueToCanonical(type.elem, item, types)),
      };
    }
    case "tuple": {
      const list = value.kind === "list" ? value : { items: [] as EditorValue[] };
      return {
        vec: type.elems.map((element, index) =>
          editorValueToCanonical(element, list.items[index], types),
        ),
      };
    }
    case "map": {
      const map =
        value.kind === "map" ? value : { rows: [] as Array<{ key: EditorValue; value: EditorValue }> };
      return {
        map: map.rows.map((row) => ({
          key: editorValueToCanonical(type.key, row.key, types),
          val: editorValueToCanonical(type.value, row.value, types),
        })),
      };
    }
    case "udt": {
      const udt = value.kind === "udt" ? value : { variant: "", fields: {} as Record<string, EditorValue> };
      const descriptor = types[type.name];
      if (descriptor?.kind === "struct") {
        return {
          vec: [
            { symbol: type.name },
            ...descriptor.fields.map((field) =>
              editorValueToCanonical(field.type, udt.fields[field.name], types),
            ),
          ],
        };
      }
      if (descriptor?.kind === "union") {
        const variant = descriptor.variants.find((candidate) => candidate.name === udt.variant);
        if (!variant?.type) return { symbol: udt.variant };
        return {
          vec: [
            { symbol: udt.variant },
            editorValueToCanonical(variant.type, udt.fields[udt.variant], types),
          ],
        };
      }
      return { symbol: udt.variant };
    }
    default:
      return null;
  }
}

function buildArgsFromParams(
  spec: ContractSpecResponse,
  functionName: string,
  values: Record<string, EditorValue>,
): unknown[] {
  const selected = spec.functions.find((fn) => fn.name === functionName);
  if (!selected) return [];
  return selected.inputs.map((input) => {
    const value = values[input.name];
    return value
      ? editorValueToCanonical(input.type, value, spec.contract_types)
      : null;
  });
}

function defaultValuesForFunction(
  fn: ContractSpecFunction | undefined,
  types: ContractTypes,
): Record<string, EditorValue> {
  if (!fn) return {};
  const values: Record<string, EditorValue> = {};
  for (const input of fn.inputs) {
    values[input.name] = defaultEditorValue(input.type, types);
  }
  return values;
}

function cursorValue<T>(page: CursorPage<T>, direction: "next" | "prev") {
  return (
    page.pagination?.[`${direction}_cursor`] ??
    page[`${direction}_cursor`] ??
    null
  );
}

function timeLabel(value?: string | null) {
  if (!value) return "Not synced";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not synced";
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - date.getTime()) / 60_000),
  );
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)} hr ago`;
  return `${Math.floor(minutes / 1_440)} days ago`;
}

function createdAtLabel(value?: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/// Page URL for a catalog section, staying inside a project-scoped URL
/// when a workspace is active (/projects/:id/...).
function projectSectionHref(scope: ProjectScope, section: "" | "simulator" | "accounts" | "contracts" | "alerts" | "activity" | "replays" | "vnet" | "debugger" | "settings"): string {
  if (!scope.projectId) return "/organizations";
  const base = `/projects/${encodeURIComponent(scope.projectId)}`;
  return section ? `${base}/${section}` : base;
}

/// Entity address from a project-scoped catalog URL:
/// /projects/:id/accounts|contracts/:address
function projectSectionAddress(pathname: string, section: "accounts" | "contracts"): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "projects" || parts.length < 4 || parts[2] !== section) return null;
  try {
    return decodeURIComponent(parts[3]);
  } catch {
    return null;
  }
}

/// Index URL for a catalog section, staying inside a project-scoped URL
/// when the current page is one (/projects/:id/...).
function sectionIndexHref(pathname: string, section: "accounts" | "contracts"): string {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "projects" && parts.length >= 2 && parts[1]) {
    return `/projects/${parts[1]}/${section}`;
  }
  return "/organizations";
}

function errorMessage(cause: unknown, fallback: string) {
  if (cause instanceof ApiError) return cause.message || fallback;
  if (cause instanceof Error) {
    console.error(cause);
    return cause.message || fallback;
  }
  return fallback;
}

/// Contract mark — the exact sidebar glyph, reused on the main page so the
/// header, empty state, and sidebar all render the identical icon.
function ContractGlyph({ size = 38 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.35} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3h9l3 3v15H6z" />
      <path d="M9 11l2 2 4-4M9 16h6" />
    </svg>
  );
}

function headerIcon(title: string) {
  const key = title.toLowerCase();
  if (key.includes("wallet") || key.includes("account")) return <Wallet size={38} strokeWidth={1.35} />;
  if (key.includes("contract")) return <ContractGlyph size={38} />;
  if (
    key.includes("environment") ||
    key.includes("virtual network") ||
    key.includes("virtual networks")
  )
    return <Blocks size={38} strokeWidth={1.35} />;
  if (key.includes("simulator") || key.includes("simulation"))
    return <Play size={38} strokeWidth={1.35} />;
  if (key.includes("alert")) return <Bell size={38} strokeWidth={1.35} />;
  return <Activity size={38} strokeWidth={1.35} />;
}

function Header({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="pw-header">
      <div className="pw-header-mark" aria-hidden="true">
        {headerIcon(title)}
      </div>
      <div className="pw-header-copy">
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="pw-actions">{actions}</div>}
    </div>
  );
}

function Button({
  children,
  primary,
  danger,
  iconOnly,
  className = "",
  type,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  primary?: boolean;
  danger?: boolean;
  iconOnly?: boolean;
}) {
  return (
    <button
      type={type ?? (primary && !props.onClick ? "submit" : "button")}
      className={`pw-button ${primary ? "pw-button-primary" : ""} ${danger ? "pw-button-danger" : ""} ${iconOnly ? "pw-icon-button" : ""} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

function Message({
  children,
  error,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div className={`pw-message ${error ? "pw-message-error" : ""}`}>
      {children}
    </div>
  );
}

function ToastPopup({
  message,
  kind = "success",
  onDone,
}: {
  message: string | null;
  kind?: "success" | "error";
  onDone: () => void;
}) {
  if (!message) return null;
  const Icon = kind === "error" ? XCircle : Check;
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="pw-toast-container" role="status" aria-live="polite">
      <div className={`pw-toast pw-toast-${kind}`} key={message}>
        <div className="pw-toast-fill" onAnimationEnd={onDone} />
        <div className="pw-toast-content">
          <Icon size={16} />
          <span>{message}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const color = ["healthy", "success", "enabled", "syncing"].includes(
    normalized,
  )
    ? "var(--green)"
    : ["failed", "error", "degraded"].includes(normalized)
      ? "var(--red)"
      : "var(--text-dim)";
  return (
    <span className="pw-badge" style={{ color }}>
      <span className="pw-badge-dot" />
      {status}
    </span>
  );
}

function StellarLogo({ size = 13 }: { size?: number }) {
  return (
    <img
      src="/stellar-logo.jpg"
      alt="Stellar"
      width={size}
      height={size}
      className="pw-stellar-logo"
    />
  );
}

function SimulatorIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      stroke="currentColor"
      strokeWidth="1.6"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 4v16M12 4v16M19 4v16" />
      <circle cx="5" cy="9" r="2" />
      <circle cx="12" cy="16" r="2" />
      <circle cx="19" cy="6" r="2" />
    </svg>
  );
}

function NetworkLabel({ network }: { network: string }) {
  return (
    <span className="pw-network-label">
      <StellarLogo />
      {network}
    </span>
  );
}

function Modal({
  title,
  children,
  onClose,
  footer,
  className,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer: ReactNode;
  className?: string;
}) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="pw-modal-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <div
        className={`pw-modal${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="pw-modal-head">
          <strong>{title}</strong>
          <Button iconOnly aria-label="Close" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>
        <div className="pw-modal-body">{children}</div>
        <div className="pw-modal-foot">{footer}</div>
      </div>
    </div>,
    document.body,
  );
}

function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  const alertEmpty =
    title.toLowerCase().includes("alert") ||
    body.toLowerCase().includes("monitoring rules are scoped");
  return (
    <div className={`pw-empty${alertEmpty ? " pw-alert-empty" : ""}`}>
      <div className="pw-empty-inner">
        <span className="pw-empty-icon">{icon}</span>
        <h2>{title}</h2>
        <p>{body}</p>
        {action}
      </div>
    </div>
  );
}

function CreatePrompt({
  onAction,
  label,
}: {
  onAction: () => void;
  label: string;
}) {
  return (
    <div className="pw-create-box">
      <Button onClick={onAction}>
        <Plus size={18} strokeWidth={2.75} /> {label}
      </Button>
    </div>
  );
}

function Pagination({
  page,
  onPage,
}: {
  page: CursorPage<unknown>;
  onPage: (cursor: string | null) => void;
}) {
  const previous = cursorValue(page, "prev");
  const next = cursorValue(page, "next");
  if (!previous && !next) return null;
  return (
    <div
      className="pw-actions"
      style={{ justifyContent: "flex-end", marginTop: 10 }}
    >
      <Button disabled={!previous} onClick={() => onPage(previous)}>
        <ArrowLeft size={14} /> Back
      </Button>
      <Button disabled={!next} onClick={() => onPage(next)}>
        Next <ChevronRight size={14} />
      </Button>
    </div>
  );
}



function TxRows({
  page,
  network,
  onOpen,
}: {
  page: CursorPage<ProjectTransaction>;
  network: string;
  onOpen: (hash: string) => void;
}) {
  if (!page.data.length)
    return (
      <EmptyState
        icon={<History size={22} />}
        title="No activity yet"
        body="Transactions involving this entity will appear here as they are indexed."
      />
    );
  return (
    <div className="pw-table">
      <div
        className="pw-row pw-row-header"
        style={{
          gridTemplateColumns: "minmax(210px, 1fr) 130px 110px 120px 120px",
        }}
      >
        <span>Transaction</span>
        <span>Operation</span>
        <span>Status</span>
        <span>Ledger</span>
        <span>Time</span>
      </div>
      {page.data.map((transaction, index) => {
        const hash = transaction.hash || transaction.tx_hash || "";
        return (
          <button
            key={hash || index}
            className="pw-row"
            style={{
              gridTemplateColumns: "minmax(210px, 1fr) 130px 110px 120px 120px",
            }}
            onClick={() => hash && onOpen(hash)}
          >
            <span className="pw-mono">
              {truncateEntity(hash || "Unavailable", 12, 9)}
            </span>
            <span>{transaction.operation_type || "Invocation"}</span>
            <StatusBadge status={transaction.status || "unknown"} />
            <span>{transaction.ledger_sequence?.toLocaleString() || "-"}</span>
            <span>{timeLabel(transaction.timestamp)}</span>
          </button>
        );
      })}
    </div>
  );
}

export function WalletsPage({ scope }: { scope: ProjectScope }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pathAddress = pathname.startsWith("/accounts/")
    ? decodeURIComponent(pathname.slice("/accounts/".length).split("/")[0] ?? "")
    : projectSectionAddress(pathname, "accounts");
  const requestedAddress = pathAddress || searchParams.get("address");
  const requestedNetwork = searchParams.get("network") ?? scope.network;
  const openedQueryAddress = useRef<string | null>(null);
  const [page, setPage] = useState<CursorPage<TrackedEntity>>({ data: [] });
  const [selected, setSelected] = useState<Record<string, unknown> | null>(
    null,
  );
  const [transactions, setTransactions] = useState<
    CursorPage<ProjectTransaction>
  >({ data: [] });
  const [tab, setTab] = useState<"overview" | "transactions" | "assets">(
    "overview",
  );
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [address, setAddress] = useState("");
  const [walletName, setWalletName] = useState("Account");
  const [walletVerified, setWalletVerified] = useState(false);
  const [verifyingWallet, setVerifyingWallet] = useState(false);
  const [walletVerifyError, setWalletVerifyError] = useState<string | null>(
    null,
  );
  const [walletSaveError, setWalletSaveError] = useState<string | null>(null);
  const [walletNetworkChecks, setWalletNetworkChecks] = useState<
    Record<WalletCheckNetwork, WalletNetworkCheck>
  >(() => emptyWalletNetworkChecks());
  const [walletNetwork, setWalletNetwork] = useState<WalletCheckNetwork | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastError, setToastError] = useState<string | null>(null);
  const [selectedWallets, setSelectedWallets] = useState<Set<string>>(
    () => new Set(),
  );
  const [tagTarget, setTagTarget] = useState<TrackedEntity | null>(null);
  const [bulkTagging, setBulkTagging] = useState(false);
  const [tagName, setTagName] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<TrackedEntity[] | null>(
    null,
  );
  const [menuWallet, setMenuWallet] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<TrackedEntity | null>(null);
  const [renameName, setRenameName] = useState("");
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const walletNameRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(
    async (cursor: string | null = null) => {
      const path = scopePath(
        scope,
        `/accounts?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      if (!path) return;
      try {
        setPage(await api.get<CursorPage<TrackedEntity>>(path));
        setError(null);
        setToastError(null);
      } catch (cause) {
        setToastError(errorMessage(cause, "Could not load accounts."));
      }
    },
    [scope],
  );

  const refreshList = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([load(), refreshSpinDelay()]);
      setSelectedWallets(new Set());
      setMenuWallet(null);
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!menuWallet) return;
    const close = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".pw-row-menu-cell")
      )
        return;
      setMenuWallet(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuWallet]);

  const track = async (event: FormEvent) => {
    event.preventDefault();
    const path = scopePath(scope, "/accounts");
    if (!path || !address.trim() || !walletVerified || !walletNetwork) return;
    setLoading(true);
    try {
      await api.post(path, {
        address: address.trim(),
        network: walletNetwork,
        name: walletName.trim() || "Account",
        tags: [],
      });
      setAddress("");
      setWalletName("Account");
      setWalletVerified(false);
      setWalletNetwork(null);
      setShowAdd(false);
      setError(null);
      setWalletSaveError(null);
      await load();
    } catch (cause) {
      const message = errorMessage(cause, "Could not add this account.");
      setWalletSaveError(message);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!showAdd) return;
    const value = address.trim();
    setWalletVerified(false);
    setWalletNetwork(null);
    setWalletVerifyError(null);
    if (!value) {
      setVerifyingWallet(false);
      setWalletNetworkChecks(emptyWalletNetworkChecks());
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setVerifyingWallet(true);
      setWalletNetworkChecks({
        mainnet: { exists: false, loading: true, error: null },
        testnet: { exists: false, loading: true, error: null },
      });
      const results = await Promise.all(
        walletCheckNetworks.map(async (network) => {
          const result = await lookupExplorer(
            network,
            value,
            controller.signal,
          );
          const exists = Boolean(
            result.data?.suggestions.some(
              (suggestion) =>
                suggestion.kind === "account" &&
                suggestion.value.toUpperCase() === value.toUpperCase(),
            ),
          );
          return [
            network,
            { exists, loading: false, error: exists ? null : result.error },
          ] as const;
        }),
      );
      if (controller.signal.aborted) return;
      const nextChecks = Object.fromEntries(results) as Record<
        WalletCheckNetwork,
        WalletNetworkCheck
      >;
      const foundNetworks = walletCheckNetworks.filter(
        (network) => nextChecks[network].exists,
      );
      const detectedNetwork = foundNetworks[0] ?? null;
      setWalletNetworkChecks(nextChecks);
      setWalletNetwork(detectedNetwork);
      setWalletVerified(Boolean(detectedNetwork));
      setWalletVerifyError(
        detectedNetwork
          ? null
          : "This account was not found on mainnet or testnet.",
      );
      setVerifyingWallet(false);
    }, 300);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [address, showAdd]);

  const openWallet = useCallback(async (value: string, network: string = scope.network) => {
    const base = scopePath(scope, `/accounts/${encodeURIComponent(value)}`);
    if (!base) return;
    const sectionBase = projectSectionHref(scope, "accounts");
    const detailPath = sectionBase === "/organizations" ? sectionBase : `${sectionBase}/${encodeURIComponent(value)}`;
    openedQueryAddress.current = value;
    if (pathname !== detailPath) router.push(detailPath);
    setLoading(true);
    const startedAt = performance.now();
    try {
      const summary = await api.get<Record<string, unknown>>(base);
      const summaryNetwork =
        typeof summary.network === "string" && summary.network.trim()
          ? summary.network
          : network;
      setSelected({ ...summary, network: summaryNetwork });
      setTab("overview");
      setError(null);
      if (process.env.NODE_ENV !== "production") {
        console.debug("[wallet-load] summary", {
          address: value,
          elapsedMs: Math.round(performance.now() - startedAt),
        });
      }
    } catch (cause) {
      setError(errorMessage(cause, "Could not open this account."));
    } finally {
      setLoading(false);
    }
  }, [pathname, router, scope]);

  useEffect(() => {
    if (!requestedAddress) {
      openedQueryAddress.current = null;
      return;
    }
    if (openedQueryAddress.current === requestedAddress) return;
    openedQueryAddress.current = requestedAddress;
    void openWallet(requestedAddress, requestedNetwork);
  }, [openWallet, requestedAddress, requestedNetwork]);

  const walletTagNames = useCallback(
    (entity: TrackedEntity) =>
      (entity.tags ?? [])
        .map((tag) => (typeof tag === "string" ? tag : (tag.name ?? "")))
        .filter(Boolean),
    [],
  );
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return page.data;
    return page.data.filter((entity) =>
      [
        entity.address,
        entity.name ?? "Account",
        entity.network,
        ...walletTagNames(entity),
      ].some((value) => value.toLowerCase().includes(needle)),
    );
  }, [page.data, query, walletTagNames]);
  const allVisibleSelected =
    visible.length > 0 &&
    visible.every((entity) => selectedWallets.has(entity.address));
  const selectedVisible = visible.filter((entity) =>
    selectedWallets.has(entity.address),
  );
  useEffect(() => {
    if (selectAllRef.current)
      selectAllRef.current.indeterminate =
        selectedVisible.length > 0 && !allVisibleSelected;
  }, [allVisibleSelected, selectedVisible.length]);
  const toggleWallet = (value: string) => {
    setSelectedWallets((current) => {
      const next = new Set(current);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };
  const toggleAllWallets = () => {
    setSelectedWallets((current) => {
      const next = new Set(current);
      if (allVisibleSelected)
        visible.forEach((entity) => next.delete(entity.address));
      else visible.forEach((entity) => next.add(entity.address));
      return next;
    });
  };
  const openRenameWallet = (entity: TrackedEntity) => {
    setMenuWallet(null);
    setRenameTarget(entity);
    setRenameName(entity.name?.trim() || "Account");
  };
  const renameWallet = async (event: FormEvent) => {
    event.preventDefault();
    if (!renameTarget || !renameName.trim()) return;
    const path = scopePath(
      scope,
      `/accounts/${encodeURIComponent(renameTarget.address)}`,
    );
    if (!path) return;
    setLoading(true);
    try {
      await api.patch(path, { name: renameName.trim() });
      setPage((current) => ({
        ...current,
        data: current.data.map((entity) =>
          entity.address === renameTarget.address
            ? { ...entity, name: renameName.trim() }
            : entity,
        ),
      }));
      setRenameTarget(null);
      setRenameName("");
      setError(null);
    } catch (cause) {
      const detail = errorMessage(cause, "Could not rename this account.");
      setError(
        detail === "Could not rename this account."
          ? `${detail} Make sure the backend has been restarted after the account rename route was added.`
          : detail,
      );
    } finally {
      setLoading(false);
    }
  };
  const saveTag = async (event: FormEvent) => {
    event.preventDefault();
    const name = tagName.trim();
    const targets = bulkTagging
      ? selectedVisible
      : tagTarget
        ? [tagTarget]
        : [];
    if (!targets.length || !name) return;
    const entityIds = targets
      .map((entity) => entity.id)
      .filter(Boolean) as string[];
    const path = scopePath(scope, "/tags");
    if (!path || entityIds.length !== targets.length) {
      setError("Reload this account list before adding a tag.");
      return;
    }
    setLoading(true);
    try {
      let tag: ProjectTag;
      try {
        tag = await api.post<ProjectTag>(path, { name, color: null });
      } catch (cause) {
        if (!(cause instanceof ApiError) || cause.status !== 409) throw cause;
        const tags = await api.get<CursorPage<ProjectTag>>(`${path}?limit=100`);
        const existing = tags.data.find((item) => item.name === name);
        if (!existing) throw cause;
        tag = existing;
      }
      await Promise.all(
        entityIds.map((entityId) =>
          api.post(`${path}/${encodeURIComponent(tag.id)}/attach`, {
            entity_type: "wallet",
            entity_id: entityId,
          }),
        ),
      );
      const taggedAddresses = new Set(targets.map((entity) => entity.address));
      setPage((current) => ({
        ...current,
        data: current.data.map((entity) => {
          if (!taggedAddresses.has(entity.address)) return entity;
          const existingTags = entity.tags ?? [];
          const hasTag = existingTags.some(
            (item) =>
              (typeof item === "string" ? item : item.name) === tag.name,
          );
          return {
            ...entity,
            tags: hasTag ? existingTags : [...existingTags, tag],
          };
        }),
      }));
      setTagTarget(null);
      setBulkTagging(false);
      setTagName("");
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause, "Could not save this tag."));
    } finally {
      setLoading(false);
    }
  };
  const deleteSelectedWallets = async () => {
    const targets = deleteTargets ?? selectedVisible;
    if (!targets.length) return;
    setLoading(true);
    try {
      const path = scopePath(scope, "/accounts/delete");
      if (!path) return;
      await api.post(path, {
        addresses: targets.map((entity) => entity.address),
      });
      const removed = new Set(targets.map((entity) => entity.address));
      setPage((current) => ({
        ...current,
        data: current.data.filter((entity) => !removed.has(entity.address)),
      }));
      setSelectedWallets((current) => {
        const next = new Set(current);
        removed.forEach((address) => next.delete(address));
        return next;
      });
      setError(null);
      setDeleteConfirm(false);
      setDeleteTargets(null);
    } catch (cause) {
      const detail =
        cause instanceof Error && cause.message ? ` ${cause.message}` : "";
      setError(`Could not delete the selected accounts.${detail}`);
    } finally {
      setLoading(false);
    }
  };
  const selectedAddress = selected ? String(selected.address) : "";
  const holdings = Array.isArray(selected?.token_holdings)
    ? (selected.token_holdings as Array<Record<string, unknown>>)
    : [];
  const foundWalletNetworks = walletCheckNetworks.filter(
    (network) => walletNetworkChecks[network].exists,
  );

  if (selected) {
    const walletDetail = selected as unknown as ExplorerAccountDetail;
    return (
      <div className="pw-page pw-wallets-page">
        <WalletExplorerDesign
          account={walletDetail}
          network={String(walletDetail.network ?? scope.network)}
          address={selectedAddress}
          label={typeof selected.name === "string" ? selected.name : null}
          embedded
           onBack={() => {
             setSelected(null);
             openedQueryAddress.current = selectedAddress;
             router.replace(sectionIndexHref(pathname, "accounts"));
           }}
        />
      </div>
    );
  }

  if (requestedAddress && !selected) {
    return (
      <div className="pw-page pw-wallets-page">
        <div className="pw-entity-loading" role="status" aria-live="polite">
          {error ? <Message error>{error}</Message> : <><LoaderCircle className="pw-spin" size={18} /> Loading account...</>}
        </div>
      </div>
    );
  }

  const walletColumns =
    "34px minmax(260px, 1fr) 128px minmax(150px, .55fr) 96px 36px";

  return (
    <div className="pw-page pw-wallets-page">
      <ToastPopup
        message={toastError}
        kind="error"
        onDone={() => setToastError(null)}
      />
      <Header
        title="Accounts"
        description="Manage project accounts, treasuries, signers, issuers, and test identities in one shared catalog."
      />
      <div className="pw-surface">
        <div className="pw-toolbar">
          <div className="pw-search">
            <Search size={16} />
            <input
              className="pw-field"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search accounts"
            />
          </div>
          <div className="pw-toolbar-actions">
            <Button
              iconOnly
              aria-label="Refresh accounts"
              title="Refresh accounts"
              disabled={loading || refreshing}
              onClick={() => void refreshList()}
            >
              <RotateCcw className={refreshing ? "pw-spin" : ""} size={15} />
            </Button>
            <Button
              iconOnly
              aria-label="Tag selected accounts"
              title="Tag selected accounts"
              disabled={!selectedVisible.length}
              onClick={() => {
                setBulkTagging(true);
                setTagTarget(null);
                setTagName("");
              }}
            >
              <Tag size={15} />
            </Button>
            <Button
              iconOnly
              danger
              aria-label="Delete selected accounts"
              title="Delete selected accounts"
              disabled={!selectedVisible.length || loading}
              onClick={() => {
                setDeleteTargets(null);
                setDeleteConfirm(true);
              }}
            >
              <Trash2 size={15} />
            </Button>
            <Button
              className="pw-catalog-create-button"
              onClick={() => {
                setAddress("");
                setWalletName("Account");
                setWalletVerified(false);
                setWalletNetwork(null);
                setWalletVerifyError(null);
                setShowAdd(true);
              }}
            >
              <Plus size={17} /> Add account
            </Button>
          </div>
        </div>

        {loading &&
        !page.data.length ? null : !scope.project ? null : visible.length ? (
          <div className="pw-table pw-wallet-table">
            <div
              className="pw-row pw-row-header pw-wallet-row"
              style={{ gridTemplateColumns: walletColumns }}
            >
              <span className="pw-select-cell">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  aria-label="Select all accounts"
                  checked={allVisibleSelected}
                  onChange={toggleAllWallets}
                />
              </span>
              <span>Account</span>
              <span>Network</span>
              <span>Tags</span>
              <span>Type</span>
              <span />
            </div>
            {visible.map((entity) => {
              const tags = walletTagNames(entity);
              const label = entity.name?.trim() || "Account";
              return (
                <div
                  className="pw-row pw-wallet-row pw-clickable-row"
                  role="button"
                  tabIndex={0}
                  style={{ gridTemplateColumns: walletColumns }}
                  key={entity.address}
                  onClick={() =>
                    void openWallet(
                      entity.address,
                      entity.network || scope.network,
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void openWallet(
                        entity.address,
                        entity.network || scope.network,
                      );
                    }
                  }}
                >
                  <span
                    className="pw-select-cell"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select ${entity.address}`}
                      checked={selectedWallets.has(entity.address)}
                      onChange={() => toggleWallet(entity.address)}
                    />
                  </span>
                  <div className="pw-entity-cell">
                    <EntityIdenticon
                      value={entity.address}
                      kind="account"
                      size={28}
                    />
                    <span className="pw-wallet-copy-wrap">
                      <strong className="pw-card-entity-name">{label}</strong>
                      <span className="pw-wallet-address pw-card-entity-address explorer-entity-link">
                        <span className="pw-card-entity-address-text pw-mono">
                          {truncateEntity(entity.address, 15, 11)}
                        </span>
                        <EntityCopyButton value={entity.address} label="account address" />
                      </span>
                    </span>
                  </div>
                  <NetworkLabel network={entity.network || scope.network} />
                  <span
                    className="pw-tag-cell"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {tags.length ? (
                      <span className="pw-tag-list">
                        {tags.map((tag) => (
                          <span
                            className="pw-tag-pill"
                            key={`${entity.address}-${tag}`}
                          >
                            <Tag size={11} />
                            {tag}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="pw-tag-add"
                        onClick={() => {
                          setTagTarget(entity);
                          setBulkTagging(false);
                          setTagName("");
                        }}
                      >
                        <Plus size={11} />
                        Add tag
                      </button>
                    )}
                  </span>
                  <span className="pw-type-label">Account</span>
                  <span
                    className="pw-row-menu-cell"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Button
                      iconOnly
                      aria-label={`Account actions for ${entity.address}`}
                      aria-expanded={menuWallet === entity.address}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        setMenuWallet((current) =>
                          current === entity.address ? null : entity.address,
                        );
                      }}
                    >
                      <MoreVertical size={15} />
                    </Button>
                    {menuWallet === entity.address && (
                      <div className="pw-row-menu" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            setMenuWallet(null);
                            setTagTarget(entity);
                            setBulkTagging(false);
                            setTagName("");
                          }}
                        >
                          <Tag size={13} /> Add tag
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            openRenameWallet(entity);
                          }}
                        >
                          <Pencil size={13} /> Rename
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="pw-danger-menu-item"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            setMenuWallet(null);
                            setDeleteTargets([entity]);
                            setDeleteConfirm(true);
                          }}
                        >
                          <Trash2 size={13} /> Delete
                        </button>
                      </div>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="pw-simulator-empty">
            <Wallet size={34} />
            <h2>{query ? "No matching accounts" : "No accounts yet"}</h2>
            <p>{query ? "Try another search." : "Add your first project account to manage it here."}</p>
          </div>
        )}
      </div>
      <Pagination page={page} onPage={load} />

      {showAdd && (
        <Modal
          title="Add account"
          onClose={() => setShowAdd(false)}
          footer={
            <>
              <Button onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button
                type="submit"
                form="add-wallet-form"
                primary
                disabled={
                  loading ||
                  verifyingWallet ||
                  !walletVerified ||
                  !walletNetwork ||
                  !address.trim()
                }
              >
                {(loading || verifyingWallet) && <LoaderCircle size={14} />} Add
                account
              </Button>
            </>
          }
        >
          <form id="add-wallet-form" onSubmit={track}>
            <label className="pw-label">
              Stellar account ID
              <input
                autoFocus
                className="pw-field pw-mono"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="G..."
              />
            </label>
            {address.trim() &&
              (verifyingWallet ||
                walletCheckNetworks.some(
                  (network) => walletNetworkChecks[network].exists,
                )) && (
                <div
                  className="pw-wallet-network-panel"
                  aria-label="Account network availability"
                >
                  {walletCheckNetworks
                    .filter(
                      (network) =>
                        verifyingWallet || walletNetworkChecks[network].exists,
                    )
                    .map((network) => {
                      const check = walletNetworkChecks[network];
                      return (
                        <div
                          className="pw-wallet-network-row"
                          key={network}
                          data-active={walletNetwork === network}
                        >
                          <label className="pw-wallet-network-check">
                            <input
                              type="checkbox"
                              checked={walletNetwork === network}
                              disabled={!check.exists}
                              onChange={() => {
                                if (check.exists) setWalletNetwork(network);
                              }}
                            />
                            <span>
                              <NetworkLabel network={network} />
                              <small>
                                {check.loading
                                  ? "Checking..."
                                  : "Found on network"}
                              </small>
                            </span>
                          </label>
                          {check.exists && (
                            <button
                              type="button"
                              className="pw-rename-link"
                              onClick={() => walletNameRef.current?.focus()}
                            >
                              <Pencil size={12} /> Rename
                            </button>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            <label className="pw-label">
              Name
              <input
                ref={walletNameRef}
                className="pw-field"
                value={walletName}
                onChange={(event) => setWalletName(event.target.value)}
                placeholder="Account"
              />
            </label>
          </form>
          {address.trim() && verifyingWallet && (
            <Message>Checking mainnet and testnet...</Message>
          )}
          {address.trim() &&
            !verifyingWallet &&
            foundWalletNetworks.length > 0 &&
            walletNetwork && (
              <Message>
                This account will be added on {walletNetwork}, independently of
                the project network.
              </Message>
            )}
          {walletVerifyError && <Message error>{walletVerifyError}</Message>}
          {walletSaveError && <Message error>{walletSaveError}</Message>}
          <Message>
            The account is verified on its selected Stellar network before it is
            saved to this project. Releeve never stores its secret key.
          </Message>
        </Modal>
      )}

      {(tagTarget || bulkTagging) && (
        <Modal
          title={bulkTagging ? "Tag selected accounts" : "Add account tag"}
          onClose={() => {
            setTagTarget(null);
            setBulkTagging(false);
          }}
          footer={
            <>
              <Button
                onClick={() => {
                  setTagTarget(null);
                  setBulkTagging(false);
                }}
              >
                Cancel
              </Button>
              <Button
                primary
                disabled={loading || !tagName.trim()}
                onClick={() =>
                  document
                    .getElementById("wallet-tag-form")
                    ?.dispatchEvent(
                      new Event("submit", { bubbles: true, cancelable: true }),
                    )
                }
              >
                {loading ? <LoaderCircle size={14} /> : <Plus size={14} />} Save
                tag
              </Button>
            </>
          }
        >
          <form id="wallet-tag-form" onSubmit={saveTag}>
            <label className="pw-label">
              Tag name
              <input
                autoFocus
                className="pw-field"
                value={tagName}
                onChange={(event) => setTagName(event.target.value)}
                placeholder="Treasury"
              />
            </label>
            <p className="pw-modal-note pw-mono">
              {bulkTagging
                ? `${selectedVisible.length} selected accounts`
                : tagTarget
                  ? truncateEntity(tagTarget.address, 18, 12)
                  : ""}
            </p>
          </form>
        </Modal>
      )}

      {renameTarget && (
        <Modal
          title="Rename account"
          onClose={() => {
            setRenameTarget(null);
            setRenameName("");
          }}
          footer={
            <>
              <Button
                onClick={() => {
                  setRenameTarget(null);
                  setRenameName("");
                }}
              >
                Cancel
              </Button>
              <Button
                primary
                disabled={loading || !renameName.trim()}
                onClick={() =>
                  document
                    .getElementById("wallet-rename-form")
                    ?.dispatchEvent(
                      new Event("submit", { bubbles: true, cancelable: true }),
                    )
                }
              >
                {loading ? <LoaderCircle size={14} /> : <Pencil size={14} />}{" "}
                Save name
              </Button>
            </>
          }
        >
          <form id="wallet-rename-form" onSubmit={renameWallet}>
            <label className="pw-label">
              Account name
              <input
                autoFocus
                className="pw-field"
                value={renameName}
                onChange={(event) => setRenameName(event.target.value)}
                placeholder="Account"
              />
            </label>
            <p className="pw-modal-note pw-mono">
              {truncateEntity(renameTarget.address, 18, 12)}
            </p>
          </form>
        </Modal>
      )}

      {deleteConfirm && (
        <Modal
          title={
            deleteTargets?.length === 1
              ? "Delete account"
              : "Delete selected accounts"
          }
          onClose={() => {
            setDeleteConfirm(false);
            setDeleteTargets(null);
          }}
          footer={
            <>
              <Button
                onClick={() => {
                  setDeleteConfirm(false);
                  setDeleteTargets(null);
                }}
              >
                Cancel
              </Button>
              <Button
                danger
                disabled={loading}
                onClick={() => void deleteSelectedWallets()}
              >
                {loading ? <LoaderCircle size={14} /> : <Trash2 size={14} />}{" "}
                Delete
              </Button>
            </>
          }
        >
          <p className="pw-modal-note">
              Remove {(deleteTargets ?? selectedVisible).length} account
            {(deleteTargets ?? selectedVisible).length === 1 ? "" : "s"} from
            this project. This does not affect the Stellar account or its
            on-chain data.
          </p>
        </Modal>
      )}
    </div>
  );
}

function hasContractDetail(value: unknown): boolean {
  return value !== null && value !== undefined;
}

export function ContractsPage({ scope }: { scope: ProjectScope }) {
  const router = useRouter();
  const pathname = usePathname();
  const requestedAddress = pathname.startsWith("/contracts/")
    ? decodeURIComponent(pathname.slice("/contracts/".length).split("/")[0] ?? "")
    : projectSectionAddress(pathname, "contracts");
  const openedQueryAddress = useRef<string | null>(null);
  const [page, setPage] = useState<CursorPage<TrackedEntity>>({ data: [] });
  const [selected, setSelected] = useState<Record<string, unknown> | null>(
    null,
  );
  const [selectedNetwork, setSelectedNetwork] = useState<
    ProjectScope["network"]
  >(scope.network);
  const [transactions, setTransactions] = useState<
    CursorPage<ProjectTransaction>
  >({ data: [] });
  const [events, setEvents] = useState<CursorPage<ContractEvent>>({ data: [] });
  const [source, setSource] = useState<Record<string, unknown> | null>(null);
  const [verifications, setVerifications] = useState<
    CursorPage<Record<string, any>>
  >({ data: [] });
  const [tab, setTab] = useState<
    "overview" | "transactions" | "events" | "source" | "verification"
  >("overview");
  const [sourceKind, setSourceKind] = useState<"github" | "archive">("github");
  const [repository, setRepository] = useState("");
  const [commit, setCommit] = useState("");
  const [packagePath, setPackagePath] = useState(".");
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [uploadId, setUploadId] = useState("");
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [address, setAddress] = useState("");
  const [contractName, setContractName] = useState("");
  const [contractColor, setContractColor] = useState("");
  const [contractNetwork, setContractNetwork] = useState<ContractNetwork>(
    scope.network,
  );
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [networkMenuOpen, setNetworkMenuOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedContracts, setSelectedContracts] = useState<Set<string>>(
    () => new Set(),
  );
  const [tagTarget, setTagTarget] = useState<TrackedEntity | null>(null);
  const [bulkTagging, setBulkTagging] = useState(false);
  const [tagName, setTagName] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<TrackedEntity[] | null>(
    null,
  );
  const [menuContract, setMenuContract] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<TrackedEntity | null>(null);
  const [renameName, setRenameName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastError, setToastError] = useState<string | null>(null);
  const contractSelectAllRef = useRef<HTMLInputElement | null>(null);
  const networkMenuRef = useRef<HTMLSpanElement | null>(null);
  const contractAddressValid = isValidStellarContractId(address);

  const load = useCallback(
    async (cursor: string | null = null) => {
      const path = scopePath(
        scope,
        `/contracts?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      if (!path) return;
      try {
        setPage(await api.get(path));
        setError(null);
        setToastError(null);
      } catch (cause) {
        setToastError(errorMessage(cause, "Could not load contracts."));
      }
    },
    [scope],
  );

  const refreshList = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([load(), refreshSpinDelay()]);
      setSelectedContracts(new Set());
      setMenuContract(null);
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!menuContract) return;
    const close = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".pw-row-menu-cell")
      )
        return;
      setMenuContract(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuContract]);
  useEffect(() => {
    if (!networkMenuOpen) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && networkMenuRef.current?.contains(event.target)) return;
      setNetworkMenuOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [networkMenuOpen]);

  const track = async (event: FormEvent) => {
    event.preventDefault();
    const path = scopePath(scope, "/contracts");
    if (!path || !contractAddressValid) return;
    setLoading(true);
    try {
      await api.post(path, {
        address: address.trim().toUpperCase(),
        network: contractNetwork,
        name: contractName.trim() || null,
        appearance_color: contractColor || null,
        tags: [],
      });
      setAddress("");
      setContractName("");
      setContractColor("");
      setContractNetwork(scope.network);
      setShowAdd(false);
      setError(null);
      setToastError(null);
      await load();
    } catch (cause) {
      setToastError(errorMessage(cause, "Could not add this contract."));
    } finally {
      setLoading(false);
    }
  };

  const openContract = async (
    value: string,
    network: ProjectScope["network"] = scope.network,
  ) => {
    const base = scopePath(scope, `/contracts/${encodeURIComponent(value)}`);
    if (!base) return;
    const sectionBase = projectSectionHref(scope, "contracts");
    const detailPath = sectionBase === "/organizations" ? sectionBase : `${sectionBase}/${encodeURIComponent(value)}`;
    openedQueryAddress.current = value;
    if (pathname !== detailPath) router.push(detailPath);
    setLoading(true);
    const startedAt = performance.now();
    try {
      const summary = await api.get<Record<string, unknown>>(base);
      setSelectedNetwork(network);
      setSelected(summary);
      setTab("overview");
      setError(null);
      if (process.env.NODE_ENV !== "production") {
        console.debug("[contract-load] summary", {
          address: value,
          elapsedMs: Math.round(performance.now() - startedAt),
        });
      }
    } catch (cause) {
      setError(errorMessage(cause, "Could not open this contract."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!requestedAddress) {
      openedQueryAddress.current = null;
      return;
    }
    if (openedQueryAddress.current === requestedAddress) return;
    openedQueryAddress.current = requestedAddress;
    void openContract(requestedAddress, scope.network);
  }, [openContract, requestedAddress, scope.network]);

  const contractTagNames = useCallback(
    (entity: TrackedEntity) =>
      (entity.tags ?? [])
        .map((tag) => (typeof tag === "string" ? tag : (tag.name ?? "")))
        .filter(Boolean),
    [],
  );
  const visible = page.data.filter(
    (entity) =>
      !query.trim() ||
      [
        entity.address,
        entity.name ?? "",
        entity.network,
        ...contractTagNames(entity),
      ].some((value) =>
        value.toLowerCase().includes(query.trim().toLowerCase()),
      ),
  );
  const allContractsSelected =
    visible.length > 0 &&
    visible.every((entity) => selectedContracts.has(entity.address));
  const selectedVisibleContracts = visible.filter((entity) =>
    selectedContracts.has(entity.address),
  );
  useEffect(() => {
    if (contractSelectAllRef.current)
      contractSelectAllRef.current.indeterminate =
        selectedVisibleContracts.length > 0 && !allContractsSelected;
  }, [allContractsSelected, selectedVisibleContracts.length]);
  const toggleContract = (value: string) => {
    setSelectedContracts((current) => {
      const next = new Set(current);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };
  const toggleAllContracts = () => {
    setSelectedContracts((current) => {
      const next = new Set(current);
      if (allContractsSelected)
        visible.forEach((entity) => next.delete(entity.address));
      else visible.forEach((entity) => next.add(entity.address));
      return next;
    });
  };
  const openRenameContract = (entity: TrackedEntity) => {
    setMenuContract(null);
    setRenameTarget(entity);
    setRenameName(entity.name?.trim() || "Soroban contract");
  };
  const renameContract = async (event: FormEvent) => {
    event.preventDefault();
    if (!renameTarget || !renameName.trim()) return;
    const path = scopePath(
      scope,
      `/contracts/${encodeURIComponent(renameTarget.address)}`,
    );
    if (!path) return;
    setLoading(true);
    try {
      await api.patch(path, { name: renameName.trim() });
      setPage((current) => ({
        ...current,
        data: current.data.map((entity) =>
          entity.address === renameTarget.address
            ? { ...entity, name: renameName.trim() }
            : entity,
        ),
      }));
      setRenameTarget(null);
      setRenameName("");
      setError(null);
      setToastError(null);
    } catch (cause) {
      setToastError(errorMessage(cause, "Could not rename this contract."));
    } finally {
      setLoading(false);
    }
  };
  const saveContractTag = async (event: FormEvent) => {
    event.preventDefault();
    const name = tagName.trim();
    const targets = bulkTagging
      ? selectedVisibleContracts
      : tagTarget
        ? [tagTarget]
        : [];
    if (!targets.length || !name) return;
    const entityIds = targets
      .map((entity) => entity.id)
      .filter(Boolean) as string[];
    const path = scopePath(scope, "/tags");
    if (!path || entityIds.length !== targets.length) {
      setToastError("Reload this contract list before adding a tag.");
      return;
    }
    setLoading(true);
    try {
      let tag: ProjectTag;
      try {
        tag = await api.post<ProjectTag>(path, { name, color: null });
      } catch (cause) {
        if (!(cause instanceof ApiError) || cause.status !== 409) throw cause;
        const tags = await api.get<CursorPage<ProjectTag>>(`${path}?limit=100`);
        const existing = tags.data.find((item) => item.name === name);
        if (!existing) throw cause;
        tag = existing;
      }
      await Promise.all(
        entityIds.map((entityId) =>
          api.post(`${path}/${encodeURIComponent(tag.id)}/attach`, {
            entity_type: "contract",
            entity_id: entityId,
          }),
        ),
      );
      const taggedAddresses = new Set(targets.map((entity) => entity.address));
      setPage((current) => ({
        ...current,
        data: current.data.map((entity) => {
          if (!taggedAddresses.has(entity.address)) return entity;
          const existingTags = entity.tags ?? [];
          const hasTag = existingTags.some(
            (item) =>
              (typeof item === "string" ? item : item.name) === tag.name,
          );
          return {
            ...entity,
            tags: hasTag ? existingTags : [...existingTags, tag],
          };
        }),
      }));
      setTagTarget(null);
      setBulkTagging(false);
      setTagName("");
      setError(null);
      setToastError(null);
    } catch (cause) {
      setToastError(errorMessage(cause, "Could not save this tag."));
    } finally {
      setLoading(false);
    }
  };
  const deleteSelectedContracts = async () => {
    const targets = deleteTargets ?? selectedVisibleContracts;
    if (!targets.length) return;
    setLoading(true);
    try {
      const path = scopePath(scope, "/contracts/delete");
      if (!path) return;
      await api.post(path, {
        addresses: targets.map((entity) => entity.address),
      });
      const removed = new Set(targets.map((entity) => entity.address));
      setPage((current) => ({
        ...current,
        data: current.data.filter((entity) => !removed.has(entity.address)),
      }));
      setSelectedContracts((current) => {
        const next = new Set(current);
        removed.forEach((address) => next.delete(address));
        return next;
      });
      setError(null);
      setToastError(null);
      setDeleteConfirm(false);
      setDeleteTargets(null);
    } catch (cause) {
      setToastError(
        errorMessage(cause, "Could not delete the selected contracts."),
      );
    } finally {
      setLoading(false);
    }
  };
  const selectedAddress = selected ? String(selected.address) : "";
  const verification = selected?.verification as
    Record<string, unknown> | undefined;
  const toolchain = selected?.toolchain as Record<string, unknown> | undefined;
  const previewAddress =
    address.trim() || "CA3D5Y4XU6K2R8QZ9M1P4N7T5B2V6H8J3L9S0W1X2Y3Z4A5B6C7D8";
  const previewPeer = "GBZQY7F3L2A9K6M4X8C5V1N0T3R7S9P2D6H4J8L1Q5W3E0Y7U2I6O";
  const contractIconColor = contractColor || null;

  const refreshVerifications = async () => {
    const base = scopePath(
      scope,
      `/contracts/${encodeURIComponent(selectedAddress)}`,
    );
    if (base) setVerifications(await api.get(`${base}/verifications?limit=20`));
  };

  const uploadArchive = async (file: File | null) => {
    if (!file) return;
    const path = scopePath(
      scope,
      `/contracts/${encodeURIComponent(selectedAddress)}/verification-upload`,
    );
    if (!path) return;
    setLoading(true);
    try {
      const uploaded = await api.upload<{ upload_id: string }>(path, file);
      setUploadId(uploaded.upload_id);
      setError(null);
    } catch (cause) {
      setError(
        errorMessage(cause, "Could not inspect and store this source archive."),
      );
    } finally {
      setLoading(false);
    }
  };

  const submitVerification = async (event: FormEvent) => {
    event.preventDefault();
    const path = scopePath(
      scope,
      `/contracts/${encodeURIComponent(selectedAddress)}/verify`,
    );
    if (!path) return;
    const sourceInput =
      sourceKind === "github"
        ? {
            kind: "github",
            repository: repository.trim(),
            commit: commit.trim().toLowerCase(),
            package_path: packagePath.trim() || ".",
            installation_id: null,
          }
        : {
            kind: "archive",
            upload_id: uploadId,
            package_path: packagePath.trim() || ".",
          };
    setLoading(true);
    try {
      await api.post(path, {
        visibility,
        source: sourceInput,
        recipe_id: "rust-soroban-1",
      });
      await refreshVerifications();
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause, "Could not submit this verification."));
    } finally {
      setLoading(false);
    }
  };

  if (hasContractDetail(selected)) {
    const contract: ExplorerContractDetail = {
      address: selectedAddress,
      network: selectedNetwork,
      tracked: true,
      name: typeof selected?.name === "string" ? selected.name : null,
      type: typeof selected?.type === "string" ? selected.type : "contract",
      current_wasm_hash:
        typeof selected?.current_wasm_hash === "string"
          ? selected.current_wasm_hash
          : null,
      verification: {
        status:
          typeof verification?.status === "string"
            ? verification.status
            : "unverified",
        type: typeof verification?.type === "string" ? verification.type : null,
        timestamp:
          typeof verification?.timestamp === "string"
            ? verification.timestamp
            : null,
      },
      toolchain: {
        rust_version:
          typeof toolchain?.rust_version === "string"
            ? toolchain.rust_version
            : null,
        soroban_sdk_version:
          typeof toolchain?.soroban_sdk_version === "string"
            ? toolchain.soroban_sdk_version
            : null,
        wasm_target:
          typeof toolchain?.wasm_target === "string"
            ? toolchain.wasm_target
            : null,
        opt_level:
          typeof toolchain?.opt_level === "string" ? toolchain.opt_level : null,
        wasm_opt_applied:
          typeof toolchain?.wasm_opt_applied === "boolean"
            ? toolchain.wasm_opt_applied
            : null,
        debug_symbols_present: toolchain?.debug_symbols_present === true,
      },
    };
    return (
      <div className="pw-page pw-contract-detail-page">
        <ContractExplorerDesign
          contract={contract}
          network={selectedNetwork}
          address={selectedAddress}
          embedded
          onBack={() => {
            setSelected(null);
            openedQueryAddress.current = selectedAddress;
            router.replace(sectionIndexHref(pathname, "contracts"));
          }}
        />
      </div>
    );
  }

  if (requestedAddress && !selected) {
    return (
      <div className="pw-page pw-contracts-page">
        <div className="pw-entity-loading" role="status" aria-live="polite">
          {error ? <Message error>{error}</Message> : <><LoaderCircle className="pw-spin" size={18} /> Loading contract...</>}
        </div>
      </div>
    );
  }

  if (selected)
    return (
      <div className="pw-page">
        <div className="pw-detail-head">
          <div className="pw-inline">
            <button
              className="pw-detail-back"
              type="button"
              aria-label="Back to contracts"
              onClick={() => setSelected(null)}
            >
              <ChevronLeft size={18} />
            </button>
            <EntityIdenticon
              value={selectedAddress}
              kind="contract"
              size={34}
            />
            <div className="pw-detail-title">
              <p>Soroban contract</p>
              <h1 className="pw-mono">{selectedAddress}</h1>
              <p>{scope.network} / shared contract catalog</p>
            </div>
          </div>
          <div className="pw-actions">
            <Button
              onClick={() => navigator.clipboard.writeText(selectedAddress)}
            >
              <Copy size={14} /> Copy
            </Button>
            <Button
              onClick={() =>
                router.push(
                  `/explorer/${scope.network}/contract/${encodeURIComponent(selectedAddress)}`,
                )
              }
            >
              Explorer
            </Button>
            <Button
              primary
              onClick={() =>
                router.push(
                  `/simulation/new?contract=${encodeURIComponent(selectedAddress)}`,
                )
              }
            >
              <Play size={14} /> Simulate
            </Button>
          </div>
        </div>
        <div className="pw-surface">
          <div className="pw-stats">
            <div className="pw-stat">
              <span>Verification</span>
              <strong>{String(verification?.status ?? "unverified")}</strong>
            </div>
            <div className="pw-stat">
              <span>WASM hash</span>
              <strong className="pw-mono">
                {selected.current_wasm_hash
                  ? truncateEntity(String(selected.current_wasm_hash), 8, 7)
                  : "Unavailable"}
              </strong>
            </div>
            <div className="pw-stat">
              <span>Events indexed</span>
              <strong>{events.data.length}</strong>
            </div>
            <div className="pw-stat">
              <span>Debug symbols</span>
              <strong>
                {toolchain?.debug_symbols_present ? "Present" : "Not available"}
              </strong>
            </div>
          </div>
          <div className="pw-tabs">
            <button
              data-active={tab === "overview"}
              onClick={() => setTab("overview")}
            >
              Overview
            </button>
            <button
              data-active={tab === "transactions"}
              onClick={() => setTab("transactions")}
            >
              Transactions
            </button>
            <button
              data-active={tab === "events"}
              onClick={() => setTab("events")}
            >
              Events
            </button>
            <button
              data-active={tab === "source"}
              onClick={() => setTab("source")}
            >
              Source and WASM
            </button>
          </div>
          {tab === "overview" && (
            <div className="pw-panel-body">
              <div className="pw-kv">
                <span>Contract ID</span>
                <span className="pw-mono">{selectedAddress}</span>
                <span>Contract type</span>
                <span>{String(selected.type ?? "contract")}</span>
                <span>Soroban SDK</span>
                <span>
                  {String(toolchain?.soroban_sdk_version ?? "Unavailable")}
                </span>
                <span>Rust version</span>
                <span>{String(toolchain?.rust_version ?? "Unavailable")}</span>
                <span>WASM target</span>
                <span>{String(toolchain?.wasm_target ?? "Unavailable")}</span>
                <span>Source mapping</span>
                <span>
                  {String(selected.source_map_status ?? "not available")}
                </span>
              </div>
            </div>
          )}
          {tab === "transactions" && (
            <TxRows
              page={transactions}
              network={scope.network}
              onOpen={(hash) =>
                router.push(
                  `/explorer/${scope.network}/tx/${encodeURIComponent(hash)}`,
                )
              }
            />
          )}
          {tab === "events" && (
            <div className="pw-table">
              {events.data.length ? (
                events.data.map((event, index) => (
                  <button
                    className="pw-row"
                    style={{
                      gridTemplateColumns:
                        "120px minmax(180px, 1fr) minmax(220px, 1fr) 130px",
                    }}
                    key={event.id || index}
                    onClick={() =>
                      event.tx_hash &&
                      router.push(
                        `/explorer/${scope.network}/tx/${encodeURIComponent(event.tx_hash)}`,
                      )
                    }
                  >
                    <span>
                      {event.ledger_sequence?.toLocaleString() || "-"}
                    </span>
                    <span className="pw-mono">
                      {JSON.stringify(event.topics)}
                    </span>
                    <span className="pw-mono">
                      {JSON.stringify(event.data)}
                    </span>
                    <span>{timeLabel(event.timestamp)}</span>
                  </button>
                ))
              ) : (
                <EmptyState
                  icon={<Activity size={22} />}
                  title="No contract events"
                  body="Indexed Soroban diagnostic and contract events will appear here."
                />
              )}
            </div>
          )}
          {tab === "source" && (
            <div className="pw-panel-body">
              {source ? (
                <pre className="pw-json">{JSON.stringify(source, null, 2)}</pre>
              ) : (
                <EmptyState
                  icon={<FileCode2 size={22} />}
                  title="Source is not verified"
                  body="Verified source, toolchain metadata, and WASM mapping will appear here when available."
                />
              )}
            </div>
          )}
        </div>
      </div>
    );

  return (
    <div className="pw-page pw-contracts-page">
      <ToastPopup
        message={toastError}
        kind="error"
        onDone={() => setToastError(null)}
      />
      <Header
        title="Contracts"
        description="Manage Soroban contracts, verification state, source evidence, and simulation entry points in one place."
      />
      <div className="pw-surface">
        <div className="pw-toolbar">
          <div className="pw-search">
            <Search size={16} />
            <input
              className="pw-field"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search contracts"
            />
          </div>
          <div className="pw-toolbar-actions">
            <Button className="pw-verify-contract-button" onClick={() => router.push(projectSectionHref(scope, "contracts"))}>
              Verify contract
            </Button>
            <Button
              iconOnly
              aria-label="Refresh contracts"
              title="Refresh contracts"
              disabled={loading || refreshing}
              onClick={() => void refreshList()}
            >
              <RotateCcw className={refreshing ? "pw-spin" : ""} size={15} />
            </Button>
            <Button
              iconOnly
              aria-label="Tag selected contracts"
              title="Tag selected contracts"
              disabled={!selectedVisibleContracts.length}
              onClick={() => {
                setBulkTagging(true);
                setTagTarget(null);
                setTagName("");
              }}
            >
              <Tag size={15} />
            </Button>
            <Button
              iconOnly
              danger
              aria-label="Delete selected contracts"
              title="Delete selected contracts"
              disabled={!selectedVisibleContracts.length || loading}
              onClick={() => {
                setDeleteTargets(null);
                setDeleteConfirm(true);
              }}
            >
              <Trash2 size={15} />
            </Button>
            <Button
              className="pw-catalog-create-button"
              onClick={() => {
                setAddress("");
                setContractName("");
                setContractColor("");
                setContractNetwork(scope.network);
                setAppearanceOpen(false);
                setShowAdd(true);
              }}
            >
              <Plus size={17} /> Add contract
            </Button>
          </div>
        </div>
        {loading && !page.data.length ? null : !scope.project ? (
          <EmptyState
            icon={<Box size={22} />}
            title="Select a project"
            body="Contract catalogs are scoped to a Releeve project."
          />
        ) : visible.length ? (
          <div className="pw-table pw-contract-table">
            <div
              className="pw-row pw-row-header pw-wallet-row"
              style={{
                gridTemplateColumns:
                  "34px minmax(260px, 1fr) 128px minmax(150px, .55fr) 82px 36px",
              }}
            >
              <span className="pw-select-cell">
                <input
                  ref={contractSelectAllRef}
                  type="checkbox"
                  aria-label="Select all contracts"
                  checked={allContractsSelected}
                  onChange={toggleAllContracts}
                />
              </span>
              <span>Contract</span>
              <span>Network</span>
              <span>Tags</span>
              <span className="pw-verified-head">Verified</span>
              <span />
            </div>
            {visible.map((entity) => {
              const label = entity.name?.trim() || "Soroban contract";
              const tags = contractTagNames(entity);
              const verified =
                String(
                  (entity as Record<string, unknown>).verification_status ??
                    (entity as Record<string, unknown>).status ??
                    "",
                ).toLowerCase() === "verified";
              return (
                <div
                  className="pw-row pw-clickable-row"
                  role="button"
                  tabIndex={0}
                  style={{
                    gridTemplateColumns:
                      "34px minmax(260px, 1fr) 128px minmax(150px, .55fr) 82px 36px",
                  }}
                  key={entity.address}
                  onClick={() => {
                    const network =
                      entity.network === "mainnet" ||
                      entity.network === "testnet" ||
                      entity.network === "futurenet"
                        ? entity.network
                        : scope.network;
                    void openContract(entity.address, network);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      const network =
                        entity.network === "mainnet" ||
                        entity.network === "testnet" ||
                        entity.network === "futurenet"
                          ? entity.network
                          : scope.network;
                      void openContract(entity.address, network);
                    }
                  }}
                >
                  <span
                    className="pw-select-cell"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select ${entity.address}`}
                      checked={selectedContracts.has(entity.address)}
                      onChange={() => toggleContract(entity.address)}
                    />
                  </span>
                  <span className="pw-entity-cell">
                    <EntityIdenticon
                      value={entity.address}
                      kind="contract"
                      size={28}
                      color={entity.appearance_color}
                    />
                    <span>
                      <strong className="pw-card-entity-name">{label}</strong>
                      <span className="pw-card-entity-address explorer-entity-link">
                        <small className="pw-card-entity-address-text pw-mono">
                          {truncateEntity(entity.address, 15, 11)}
                        </small>
                        <EntityCopyButton value={entity.address} label="contract address" />
                      </span>
                    </span>
                  </span>
                  <NetworkLabel network={entity.network || scope.network} />
                  <span
                    className="pw-tag-cell"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {tags.length ? (
                      <span className="pw-tag-list">
                        {tags.map((tag) => (
                          <span
                            className="pw-tag-pill"
                            key={`${entity.address}-${tag}`}
                          >
                            <Tag size={11} />
                            {tag}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="pw-tag-add"
                        onClick={() => {
                          setTagTarget(entity);
                          setBulkTagging(false);
                          setTagName("");
                        }}
                      >
                        <Plus size={11} />
                        Add tag
                      </button>
                    )}
                  </span>
                  <span
                    className={`pw-verify-state ${verified ? "pw-verified" : "pw-unverified"}`}
                  >
                    {verified ? <ShieldCheck size={14} /> : <X size={14} />}
                  </span>
                  <span
                    className="pw-row-menu-cell"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <Button
                      iconOnly
                      aria-label={`Contract actions for ${entity.address}`}
                      aria-expanded={menuContract === entity.address}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        setMenuContract((current) =>
                          current === entity.address ? null : entity.address,
                        );
                      }}
                    >
                      <MoreVertical size={15} />
                    </Button>
                    {menuContract === entity.address && (
                      <div className="pw-row-menu" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            setMenuContract(null);
                            setTagTarget(entity);
                            setBulkTagging(false);
                            setTagName("");
                          }}
                        >
                          <Tag size={13} /> Add tag
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            openRenameContract(entity);
                          }}
                        >
                          <Pencil size={13} /> Rename
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="pw-danger-menu-item"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            setMenuContract(null);
                            setDeleteTargets([entity]);
                            setDeleteConfirm(true);
                          }}
                        >
                          <Trash2 size={13} /> Delete
                        </button>
                      </div>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="pw-simulator-empty">
            <ContractGlyph size={34} />
            <h2>{query ? "No matching contracts" : "No contracts yet"}</h2>
            <p>{query ? "Try another search." : "Add your first Soroban contract to manage it here."}</p>
          </div>
        )}
      </div>
      <Pagination page={page} onPage={load} />
      {showAdd && (
        <Modal
          title="Add contract"
          onClose={() => setShowAdd(false)}
          footer={
            <>
              <Button onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button
                primary
                disabled={loading || !contractAddressValid}
                onClick={() =>
                  document
                    .getElementById("add-contract-form")
                    ?.dispatchEvent(
                      new Event("submit", { bubbles: true, cancelable: true }),
                    )
                }
              >
                {loading ? <LoaderCircle size={14} /> : <Plus size={14} />} Save
              </Button>
            </>
          }
        >
          <form
            id="add-contract-form"
            className="pw-add-contract-form"
            onSubmit={track}
          >
            <label className="pw-label">
              Contract ID
              <input
                autoFocus
                className="pw-field pw-mono"
                value={address}
                onChange={(event) =>
                  setAddress(event.target.value.trim().toUpperCase())
                }
                placeholder="C..."
              />
              {address.trim() && !contractAddressValid && (
                <small>Enter a valid Stellar contract ID.</small>
              )}
            </label>
            <label className="pw-label">
              <span className="pw-label-line">
                Name <span className="pw-label-optional">(optional)</span>
              </span>
              <input
                className="pw-field"
                value={contractName}
                onChange={(event) => setContractName(event.target.value)}
                placeholder="Enter name"
              />
              <small>
                Custom names keep important Soroban contracts recognizable
                across this project.
              </small>
            </label>
            <label className="pw-label">
              Network
                <span
                  className="pw-select-shell"
                  ref={networkMenuRef}
                  onPointerDown={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="pw-select-trigger"
                  aria-haspopup="listbox"
                  aria-expanded={networkMenuOpen}
                  onClick={() => setNetworkMenuOpen((open) => !open)}
                >
                  <NetworkLabel network={contractNetwork} />
                  <ChevronDown className={`pw-dropdown-chevron${networkMenuOpen ? " open" : ""}`} size={15} />
                </button>
                {networkMenuOpen && (
                  <span className="pw-select-menu" role="listbox">
                    {contractNetworks.map((network) => (
                      <button
                        key={network}
                        type="button"
                        role="option"
                        aria-selected={contractNetwork === network}
                        data-active={contractNetwork === network}
                        onClick={() => {
                          setContractNetwork(network);
                          setNetworkMenuOpen(false);
                        }}
                      >
                        <NetworkLabel network={network} />
                        {contractNetwork === network && <span className="pw-filter-option-check" aria-hidden="true"><Check size={10} /></span>}
                      </button>
                    ))}
                  </span>
                )}
              </span>
            </label>
            <div className="pw-contract-appearance">
              <button
                type="button"
                className="pw-accordion-trigger"
                onClick={() => setAppearanceOpen((open) => !open)}
                aria-expanded={appearanceOpen}
              >
                <ChevronDown className={`pw-dropdown-chevron${appearanceOpen ? " open" : ""}`} size={15} />{" "}
                Contract appearance
              </button>
              {appearanceOpen && (
                <div className="pw-accordion-panel">
                  <label className="pw-color-picker-row">
                    <span>Icon color</span>
                    <span className="pw-color-picker-control">
                      <input
                        type="color"
                        value={contractColor || "#a3ff5f"}
                        onChange={(event) =>
                          setContractColor(event.target.value)
                        }
                      />
                      <button
                        type="button"
                        onClick={() => setContractColor("")}
                      >
                        Default
                      </button>
                    </span>
                  </label>
                  <div className="pw-preview-section">
                    <p className="pw-preview-title">
                      Transaction listing preview
                    </p>
                    <div className="pw-address-list">
                      <div className="pw-address-column">
                        <span className="pw-address-label">From</span>
                        <div className="pw-address-item">
                          <EntityIdenticon
                            value={previewAddress}
                            kind="contract"
                            size={24}
                            color={contractIconColor}
                          />
                          <span className="pw-address-text">
                            {truncateEntity(previewAddress, 12, 9)}
                          </span>
                        </div>
                      </div>
                      <div className="pw-address-column">
                        <span className="pw-address-label">To</span>
                        <div className="pw-address-item">
                          <EntityIdenticon
                            value={previewPeer}
                            kind="account"
                            size={24}
                          />
                          <span className="pw-address-text">
                            {truncateEntity(previewPeer, 12, 9)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="pw-trace-preview">
                    <p className="pw-preview-title">Trace preview</p>
                    <pre>
                      <span>[{contractName.trim() || "Contract"}] </span>
                      {truncateEntity(previewAddress, 12, 9)} <b>=&gt;</b>{" "}
                      {truncateEntity(previewPeer, 12, 9)}
                      {"\n"} .swap_exact_in(<i>asset</i> = &quot;XLM&quot;,{" "}
                      <i>amount</i> = 10000000) <b>=&gt;</b> ok
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </form>
        </Modal>
      )}
      {(tagTarget || bulkTagging) && (
        <Modal
          title={bulkTagging ? "Tag selected contracts" : "Add contract tag"}
          onClose={() => {
            setTagTarget(null);
            setBulkTagging(false);
          }}
          footer={
            <>
              <Button
                onClick={() => {
                  setTagTarget(null);
                  setBulkTagging(false);
                }}
              >
                Cancel
              </Button>
              <Button
                primary
                disabled={loading || !tagName.trim()}
                onClick={() =>
                  document
                    .getElementById("contract-tag-form")
                    ?.dispatchEvent(
                      new Event("submit", { bubbles: true, cancelable: true }),
                    )
                }
              >
                {loading ? <LoaderCircle size={14} /> : <Plus size={14} />} Save
                tag
              </Button>
            </>
          }
        >
          <form id="contract-tag-form" onSubmit={saveContractTag}>
            <label className="pw-label">
              Tag name
              <input
                autoFocus
                className="pw-field"
                value={tagName}
                onChange={(event) => setTagName(event.target.value)}
                placeholder="Core protocol"
              />
            </label>
            <p className="pw-modal-note pw-mono">
              {bulkTagging
                ? `${selectedVisibleContracts.length} selected contracts`
                : tagTarget
                  ? truncateEntity(tagTarget.address, 18, 12)
                  : ""}
            </p>
          </form>
        </Modal>
      )}
      {renameTarget && (
        <Modal
          title="Rename contract"
          onClose={() => {
            setRenameTarget(null);
            setRenameName("");
          }}
          footer={
            <>
              <Button
                onClick={() => {
                  setRenameTarget(null);
                  setRenameName("");
                }}
              >
                Cancel
              </Button>
              <Button
                primary
                disabled={loading || !renameName.trim()}
                onClick={() =>
                  document
                    .getElementById("contract-rename-form")
                    ?.dispatchEvent(
                      new Event("submit", { bubbles: true, cancelable: true }),
                    )
                }
              >
                {loading ? <LoaderCircle size={14} /> : <Pencil size={14} />}{" "}
                Save name
              </Button>
            </>
          }
        >
          <form id="contract-rename-form" onSubmit={renameContract}>
            <label className="pw-label">
              Contract name
              <input
                autoFocus
                className="pw-field"
                value={renameName}
                onChange={(event) => setRenameName(event.target.value)}
                placeholder="Soroban contract"
              />
            </label>
            <p className="pw-modal-note pw-mono">
              {truncateEntity(renameTarget.address, 18, 12)}
            </p>
          </form>
        </Modal>
      )}
      {deleteConfirm && (
        <Modal
          title={
            deleteTargets?.length === 1
              ? "Delete contract"
              : "Delete selected contracts"
          }
          onClose={() => {
            setDeleteConfirm(false);
            setDeleteTargets(null);
          }}
          footer={
            <>
              <Button
                onClick={() => {
                  setDeleteConfirm(false);
                  setDeleteTargets(null);
                }}
              >
                Cancel
              </Button>
              <Button
                danger
                disabled={loading}
                onClick={() => void deleteSelectedContracts()}
              >
                {loading ? <LoaderCircle size={14} /> : <Trash2 size={14} />}{" "}
                Delete
              </Button>
            </>
          }
        >
          <p className="pw-modal-note">
            Remove {(deleteTargets ?? selectedVisibleContracts).length} contract
            {(deleteTargets ?? selectedVisibleContracts).length === 1
              ? ""
              : "s"}{" "}
            from this project. This does not affect the deployed Stellar
            contract or its on-chain data.
          </p>
        </Modal>
      )}
    </div>
  );
}

type ContractDetailProps = {
  selected: Record<string, unknown>;
  address: string;
  network: string;
  verification?: Record<string, unknown>;
  toolchain?: Record<string, unknown>;
  transactions: CursorPage<ProjectTransaction>;
  events: CursorPage<ContractEvent>;
  source: Record<string, unknown> | null;
  verifications: CursorPage<Record<string, any>>;
  tab: "overview" | "transactions" | "events" | "source" | "verification";
  setTab: (tab: ContractDetailProps["tab"]) => void;
  router: { push: (path: string) => void };
  onBack: () => void;
  sourceKind: "github" | "archive";
  setSourceKind: (kind: "github" | "archive") => void;
  repository: string;
  setRepository: (value: string) => void;
  commit: string;
  setCommit: (value: string) => void;
  packagePath: string;
  setPackagePath: (value: string) => void;
  visibility: "private" | "public";
  setVisibility: (value: "private" | "public") => void;
  uploadId: string;
  loading: boolean;
  onUpload: (file: File | null) => Promise<void>;
  onSubmit: (event: FormEvent) => Promise<void>;
  onRefresh: () => Promise<void>;
};

function ContractDetailView(props: ContractDetailProps) {
  const {
    selected,
    address,
    network,
    verification,
    toolchain,
    transactions,
    events,
    source,
    verifications,
    tab,
    setTab,
    router,
  } = props;
  return (
    <div className="pw-page">
      <div className="pw-detail-head">
        <div className="pw-inline">
          <button
            className="pw-detail-back"
            type="button"
            aria-label="Back to contracts"
            onClick={props.onBack}
          >
            <ChevronLeft size={18} />
          </button>
          <EntityIdenticon value={address} kind="contract" size={34} />
          <div className="pw-detail-title">
            <p>Soroban contract</p>
            <h1 className="pw-mono">{address}</h1>
            <p>{network} / shared contract catalog</p>
          </div>
        </div>
        <div className="pw-actions">
          <Button onClick={() => navigator.clipboard.writeText(address)}>
            <Copy size={14} /> Copy
          </Button>
          <Button
            onClick={() =>
              router.push(
                `/explorer/${network}/contract/${encodeURIComponent(address)}`,
              )
            }
          >
            Explorer
          </Button>
          <Button
            primary
            onClick={() =>
              router.push(`/simulation/new?contract=${encodeURIComponent(address)}`)
            }
          >
            <Play size={14} /> Simulate
          </Button>
        </div>
      </div>
      <div className="pw-surface">
        <div className="pw-stats">
          <div className="pw-stat">
            <span>Verification</span>
            <strong>{String(verification?.status ?? "unverified")}</strong>
          </div>
          <div className="pw-stat">
            <span>WASM hash</span>
            <strong className="pw-mono">
              {selected.current_wasm_hash
                ? truncateEntity(String(selected.current_wasm_hash), 8, 7)
                : "Unavailable"}
            </strong>
          </div>
          <div className="pw-stat">
            <span>Events indexed</span>
            <strong>{events.data.length}</strong>
          </div>
          <div className="pw-stat">
            <span>Debug symbols</span>
            <strong>
              {toolchain?.debug_symbols_present ? "Present" : "Not available"}
            </strong>
          </div>
        </div>
        <div className="pw-tabs">
          <button
            data-active={tab === "overview"}
            onClick={() => setTab("overview")}
          >
            Overview
          </button>
          <button
            data-active={tab === "transactions"}
            onClick={() => setTab("transactions")}
          >
            Transactions
          </button>
          <button
            data-active={tab === "events"}
            onClick={() => setTab("events")}
          >
            Events
          </button>
          <button
            data-active={tab === "source"}
            onClick={() => setTab("source")}
          >
            Source and WASM
          </button>
          <button
            data-active={tab === "verification"}
            onClick={() => setTab("verification")}
          >
            Verification
          </button>
        </div>
        {tab === "overview" && (
          <div className="pw-panel-body">
            <div className="pw-kv">
              <span>Contract ID</span>
              <span className="pw-mono">{address}</span>
              <span>Contract type</span>
              <span>{String(selected.type ?? "contract")}</span>
              <span>Soroban SDK</span>
              <span>
                {String(toolchain?.soroban_sdk_version ?? "Unavailable")}
              </span>
              <span>Rust version</span>
              <span>{String(toolchain?.rust_version ?? "Unavailable")}</span>
              <span>WASM target</span>
              <span>{String(toolchain?.wasm_target ?? "Unavailable")}</span>
              <span>Source mapping</span>
              <span>
                {String(selected.source_map_status ?? "not available")}
              </span>
            </div>
          </div>
        )}
        {tab === "transactions" && (
          <TxRows
            page={transactions}
            network={network}
            onOpen={(hash) =>
              router.push(
                `/explorer/${network}/tx/${encodeURIComponent(hash)}`,
              )
            }
          />
        )}
        {tab === "events" && (
          <div className="pw-table">
            {events.data.length ? (
              events.data.map((event, index) => (
                <button
                  className="pw-row"
                  style={{
                    gridTemplateColumns:
                      "120px minmax(180px, 1fr) minmax(220px, 1fr) 130px",
                  }}
                  key={event.id || index}
                  onClick={() =>
                    event.tx_hash &&
                    router.push(
                      `/explorer/${network}/tx/${encodeURIComponent(event.tx_hash)}`,
                    )
                  }
                >
                  <span>{event.ledger_sequence?.toLocaleString() || "-"}</span>
                  <span className="pw-mono">
                    {JSON.stringify(event.topics)}
                  </span>
                  <span className="pw-mono">{JSON.stringify(event.data)}</span>
                  <span>{timeLabel(event.timestamp)}</span>
                </button>
              ))
            ) : (
              <EmptyState
                icon={<Activity size={22} />}
                title="No contract events"
                body="Indexed contract events will appear here."
              />
            )}
          </div>
        )}
        {tab === "source" && (
          <div className="pw-panel-body">
            {source ? (
              <pre className="pw-json">{JSON.stringify(source, null, 2)}</pre>
            ) : (
              <EmptyState
                icon={<FileCode2 size={22} />}
                title="Source is not available"
                body="Source appears after an immutable package has passed its custody checks."
              />
            )}
          </div>
        )}
        {tab === "verification" && <VerificationPanel {...props} />}
      </div>
    </div>
  );
}

function VerificationPanel(props: ContractDetailProps) {
  return (
    <div className="pw-verification">
      <form className="pw-verification-form" onSubmit={props.onSubmit}>
        <div className="pw-inline" style={{ justifyContent: "space-between" }}>
          <h2>Verify deployed WASM</h2>
          <div className="pw-segmented">
            <button
              type="button"
              data-active={props.sourceKind === "github"}
              onClick={() => props.setSourceKind("github")}
            >
              GitHub commit
            </button>
            <button
              type="button"
              data-active={props.sourceKind === "archive"}
              onClick={() => props.setSourceKind("archive")}
            >
              Source archive
            </button>
          </div>
        </div>
        {props.sourceKind === "github" ? (
          <div className="pw-field-grid">
            <label className="pw-label">
              Repository
              <input
                className="pw-field pw-mono"
                value={props.repository}
                onChange={(event) => props.setRepository(event.target.value)}
                placeholder="owner/repository"
                required
              />
            </label>
            <label className="pw-label">
              Commit SHA
              <input
                className="pw-field pw-mono"
                value={props.commit}
                onChange={(event) => props.setCommit(event.target.value)}
                placeholder="40-character commit"
                minLength={40}
                maxLength={40}
                required
              />
            </label>
          </div>
        ) : (
          <label className="pw-label">
            ZIP source package
            <input
              className="pw-field"
              type="file"
              accept=".zip,application/zip"
              onChange={(event) =>
                void props.onUpload(event.target.files?.[0] ?? null)
              }
              required={!props.uploadId}
            />
            {props.uploadId && (
              <span className="pw-mono">Stored as {props.uploadId}</span>
            )}
          </label>
        )}
        <div className="pw-field-grid">
          <label className="pw-label">
            Package path
            <input
              className="pw-field pw-mono"
              value={props.packagePath}
              onChange={(event) => props.setPackagePath(event.target.value)}
            />
          </label>
          <label className="pw-label">
            Visibility
            <select
              className="pw-field"
              value={props.visibility}
              onChange={(event) =>
                props.setVisibility(event.target.value as "private" | "public")
              }
            >
              <option value="private">Private to project</option>
              <option value="public">Public evidence</option>
            </select>
          </label>
        </div>
        <div className="pw-actions" style={{ justifyContent: "flex-end" }}>
          <Button onClick={() => void props.onRefresh()}>
            <RotateCcw size={14} /> Refresh
          </Button>
          <Button
            primary
            disabled={
              props.loading ||
              (props.sourceKind === "archive" && !props.uploadId)
            }
          >
            <ShieldCheck size={14} /> Submit verification
          </Button>
        </div>
      </form>
      <div className="pw-verification-history">
        <h2>Evidence history</h2>
        {props.verifications.data.length ? (
          props.verifications.data.map((item) => {
            const capabilities = item.capabilities ?? {};
            return (
              <div className="pw-verification-run" key={item.id}>
                <div
                  className="pw-inline"
                  style={{ justifyContent: "space-between" }}
                >
                  <div>
                    <strong>
                      {item.legacy_claim
                        ? "Legacy claim"
                        : "SourceLens verification"}
                    </strong>
                    <p className="pw-mono">
                      {item.source_lens_verification_id ?? item.id}
                    </p>
                  </div>
                  <StatusBadge
                    status={item.source_lens_status ?? item.status ?? "unknown"}
                  />
                </div>
                <div className="pw-capability-grid">
                  {[
                    ["Build provenance", capabilities.provenance],
                    ["Source match", capabilities.source_match],
                    ["Source map", capabilities.source_map],
                    ["Trace", capabilities.trace],
                    ["Debugger", capabilities.debug_level],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <StatusBadge status={String(value ?? "unavailable")} />
                    </div>
                  ))}
                </div>
                {item.failure_reason && (
                  <Message error>{String(item.failure_reason)}</Message>
                )}
                <div className="pw-inline">
                  <span>{item.visibility}</span>
                  <span>{item.recipe_id ?? "legacy"}</span>
                  <span>{timeLabel(item.created_at)}</span>
                </div>
              </div>
            );
          })
        ) : (
          <EmptyState
            icon={<ShieldCheck size={22} />}
            title="No verification evidence"
            body="Submit an immutable source identity to begin."
          />
        )}
      </div>
    </div>
  );
}

function EnvironmentRow({
  environment,
  onOpen,
}: {
  environment: Environment;
  onOpen: () => void;
}) {
  const stateLedger = environment.state_ledger ?? environment.base_ledger_sequence;
  return (
    <div
      className="pw-row pw-clickable-row pw-environment-row"
      role="button"
      tabIndex={0}
      style={{ gridTemplateColumns: "minmax(260px, 1fr) 128px 140px 140px 110px 135px" }}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <span className="pw-entity-cell">
        <span>
          <strong>{environment.name}</strong>
          <small className="pw-mono">Revision {environment.revision ?? 1}</small>
        </span>
      </span>
      <NetworkLabel network={environment.network} />
      <span className="pw-environment-mode">
        {environment.mode === "follow_latest" ? "Network sync" : "Frozen"}
      </span>
      <span className="pw-mono">{stateLedger?.toLocaleString() ?? "Preparing"}</span>
      <StatusBadge status={environment.initialization_status === "preparing" ? "preparing" : environment.sync_status} />
      <span title={environment.created_at}>{createdAtLabel(environment.created_at)}</span>
    </div>
  );
}

export function VirtualEnvPage({ scope, environmentId }: { scope: ProjectScope; environmentId?: string }) {
  const router = useRouter();
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [selected, setSelected] = useState<Environment | null>(null);
  const [query, setQuery] = useState("");
  const [environmentFilter, setEnvironmentFilter] = useState<
    "all" | "mainnet" | "testnet" | "follow_latest" | "frozen" | "preparing" | "ready" | "failed"
  >("all");
  const [environmentFilterOpen, setEnvironmentFilterOpen] = useState(false);
  const environmentFilterRef = useRef<HTMLDivElement | null>(null);
  const [createWizard, setCreateWizard] = useState(false);
  const [runs, setRuns] = useState<Simulation[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toastError, setToastError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const path = scopePath(scope, "/environments");
  const simulationPath = scopePath(scope, "/simulations");
  const load = useCallback(async () => {
    if (!path) return;
    try {
      const [response, simulationResponse] = await Promise.all([
        api.get<{ environments: Environment[] }>(path),
        simulationPath ? api.get<{ simulations: Simulation[] }>(simulationPath) : Promise.resolve({ simulations: [] }),
      ]);
      setEnvironments(response.environments ?? []);
      setRuns(simulationResponse.simulations ?? []);
      setSelected((current) =>
        environmentId
          ? (response.environments?.find((item) => item.id === environmentId) ?? null)
          : current
            ? (response.environments?.find((item) => item.id === current.id) ?? current)
            : null,
      );
      setError(null);
      setToastError(null);
    } catch (cause) {
      setToastError(
        errorMessage(cause, "Fork Core environments are unavailable."),
      );
    }
  }, [environmentId, path, simulationPath]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!environmentFilterOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && environmentFilterRef.current?.contains(event.target)) return;
      setEnvironmentFilterOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [environmentFilterOpen]);
  const openEnvironment = (environment: Environment) => {
    setSelected(environment);
    const href = projectSectionHref(scope, "vnet");
    router.push(href === "/organizations" ? href : `${href}/${encodeURIComponent(environment.id)}/overview`);
  };

  const createEnvironment = async (input: CreateEnvironmentInput) => {
    if (!path) throw new Error("Select a project before creating an environment.");
    setLoading(true);
    try {
      const created = await api.post<Environment & { admin_secret?: string }>(path, input, {
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      setCreateWizard(false);
      setMessage(created.admin_secret
        ? "Environment ready. Its admin RPC secret is shown once in Configure."
        : "Environment ready.");
      setError(null);
      await load();
        openEnvironment(created);
    } catch (cause) {
      const message = errorMessage(cause, "Could not create the environment.");
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  };

  if (selected && path)
    return (
      <EnvironmentWorkspace
        environment={selected}
        basePath={path.slice(0, -"/environments".length)}
        scope={scope}
        onBack={() => {
          setSelected(null);
          router.push(projectSectionHref(scope, "vnet"));
        }}
        onDeleted={() => {
          setSelected(null);
          router.push(projectSectionHref(scope, "vnet"));
          void load();
        }}
        onRefresh={load}
      />
    );
  const visible = environments.filter((environment) => {
    const normalizedQuery = query.trim().toLowerCase();
    const status = environment.initialization_status === "preparing"
      ? "preparing"
      : environment.initialization_status === "failed"
        ? "failed"
        : "ready";
    const matchesQuery =
      !normalizedQuery ||
      environment.name.toLowerCase().includes(normalizedQuery) ||
      environment.network.toLowerCase().includes(normalizedQuery) ||
      String(environment.state_ledger ?? environment.base_ledger_sequence).includes(normalizedQuery);
    const matchesFilter =
      environmentFilter === "all" ||
      environmentFilter === environment.network ||
      environmentFilter === (environment.mode ?? "frozen") ||
      environmentFilter === status;
    return matchesQuery && matchesFilter;
  });
  const refreshList = async () => {
    setRefreshing(true);
    try {
      await Promise.all([load(), refreshSpinDelay()]);
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <div className="pw-page pw-environments-page">
      <ToastPopup
        message={toastError}
        kind="error"
        onDone={() => setToastError(null)}
      />
      <Header
        title="Virtual networks"
        description="Create, inspect, synchronize, simulate, and integrate isolated Stellar environments."
      />
      {message && <Message>{message}</Message>}
      {error && <Message error>{error}</Message>}
      <div className="pw-surface">
        <div className="pw-toolbar">
          <div className="pw-search">
            <Search size={16} />
            <input
              className="pw-field"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search environments"
            />
          </div>
          <div className="pw-environment-filter-control" ref={environmentFilterRef}>
            <Button
              aria-label="Filter virtual networks"
              title="Filter virtual networks"
              aria-expanded={environmentFilterOpen}
              data-active={environmentFilter !== "all"}
              onClick={() => setEnvironmentFilterOpen((open) => !open)}
            >
              <Filter size={15} /> Filter
            </Button>
            {environmentFilterOpen && (
              <div className="pw-simulator-filter-menu" role="menu" aria-label="Virtual network filters">
                {([
                  ["all", "All networks"],
                  ["mainnet", "Mainnet"],
                  ["testnet", "Testnet"],
                  ["follow_latest", "Network sync"],
                  ["frozen", "Frozen"],
                  ["ready", "Ready"],
                  ["preparing", "Preparing"],
                  ["failed", "Failed"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={environmentFilter === value}
                    data-active={environmentFilter === value}
                    onClick={() => {
                      setEnvironmentFilter(value);
                      setEnvironmentFilterOpen(false);
                    }}
                  >
                    <span>{label}</span>
                    {environmentFilter === value && <span className="pw-filter-option-check" aria-hidden="true"><Check size={10} /></span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="pw-toolbar-actions">
            <Button
              iconOnly
              aria-label="Refresh environments"
              title="Refresh environments"
              disabled={loading || refreshing}
              onClick={() => void refreshList()}
            >
              <RotateCcw className={refreshing ? "pw-spin" : ""} size={15} />
            </Button>
            <Button
              className="pw-catalog-create-button"
              onClick={() => setCreateWizard(true)}
            >
              <Plus size={17} /> Create environment
            </Button>
          </div>
        </div>
        {!scope.project ? (
          <div className="pw-page-note">
            Virtual networks are scoped to a project. Select a project to
            continue.
          </div>
        ) : visible.length ? (
          <div className="pw-table pw-environment-table">
            <div
              className="pw-row pw-row-header pw-environment-row"
              style={{ gridTemplateColumns: "minmax(260px, 1fr) 128px 140px 140px 110px 135px" }}
            >
              <span>Environment</span>
              <span>Network</span>
              <span>Mode</span>
              <span>State ledger</span>
              <span>Status</span>
              <span>Created At</span>
            </div>
            {visible.map((environment) => (
              <EnvironmentRow
                key={environment.id}
                environment={environment}
                onOpen={() => void openEnvironment(environment)}
              />
            ))}
          </div>
        ) : query.trim() || environmentFilter !== "all" ? (
          <div className="pw-catalog-empty">
            <Blocks size={20} />
            <strong>No matching environments</strong>
            <span>Try another environment name, network, or ledger.</span>
          </div>
        ) : (
          <>
            <CreatePrompt
              onAction={() => setCreateWizard(true)}
              label="Create environment"
            />
          </>
        )}
      </div>
      <CreateEnvironmentModal
        open={createWizard}
        onClose={() => setCreateWizard(false)}
        simulations={runs.filter((run) => ["success", "succeeded"].includes(run.status)).map((run) => ({
          id: run.id,
          label: `${run.function_name} / ledger ${(run.state_ledger ?? run.base_ledger_sequence)?.toLocaleString() ?? "pending"}`,
        }))}
        onCreate={createEnvironment}
      />
    </div>
  );
}

function Accordion({
  icon,
  title,
  open,
  onToggle,
  children,
  sectionId,
  selectionMode = false,
  active = false,
  onSelect,
}: {
  icon: ReactNode;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  sectionId?: string;
  selectionMode?: boolean;
  active?: boolean;
  onSelect?: () => void;
}) {
  const showing = selectionMode ? active : open;
  return (
    <div
      className="pw-accordion"
      data-input-section={sectionId}
      data-active={selectionMode && active ? "true" : undefined}
    >
      {selectionMode && (
        <div className="pw-input-section-heading">
          {icon}
          <span>{title}</span>
        </div>
      )}
      <button type="button" onClick={selectionMode ? onSelect : onToggle}>
        {icon}
        <span>{title}</span>
        {selectionMode ? (
          active && <span className="pw-input-section-check" aria-hidden="true"><Check size={13} /></span>
        ) : (
          <ChevronDown className={`pw-dropdown-chevron${open ? " open" : ""}`} size={15} />
        )}
      </button>
      {showing && <div className="pw-accordion-body">{children}</div>}
    </div>
  );
}

function ParamField({
  name,
  type,
  value,
  error,
  types,
  onChange,
  depth = 0,
}: {
  name: string;
  type: ContractSpecType;
  value: EditorValue;
  error?: string | null;
  types: ContractTypes;
  onChange: (value: EditorValue) => void;
  depth?: number;
}) {
  return (
    <div className="pw-param-field" data-depth={Math.min(depth, 4)}>
      <span className="pw-param-head">
        <span className="pw-param-name">{name}</span>
        <span className="pw-param-type">{typeLabel(type)}</span>
      </span>
      <TypeEditor type={type} value={value} types={types} onChange={onChange} depth={depth} />
      {error ? <span className="pw-param-error">{error}</span> : null}
    </div>
  );
}

function TypeEditor({
  type,
  value,
  types,
  onChange,
  depth,
}: {
  type: ContractSpecType;
  value: EditorValue;
  types: ContractTypes;
  onChange: (value: EditorValue) => void;
  depth: number;
}) {
  switch (type.kind) {
    case "address":
    case "muxed_address":
    case "u32":
    case "i32":
    case "u64":
    case "i64":
    case "u128":
    case "i128":
    case "u256":
    case "i256":
    case "timepoint":
    case "duration":
    case "string":
    case "symbol":
    case "bytes":
    case "bytes_n": {
      const text = value.kind === "scalar" ? value.text : "";
      return (
        <input
          className="pw-field pw-mono"
          value={text}
          onChange={(event) => onChange({ kind: "scalar", text: event.target.value })}
          placeholder={scalarPlaceholder(type)}
        />
      );
    }
    case "bool": {
      const bool = value.kind === "bool" ? value.value : false;
      return (
        <select
          className="pw-field"
          value={bool ? "true" : "false"}
          onChange={(event) =>
            onChange({ kind: "bool", value: event.target.value === "true" })
          }
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );
    }
    case "vec": {
      const isComplex =
        type.elem.kind === "udt" ||
        type.elem.kind === "map" ||
        type.elem.kind === "tuple" ||
        type.elem.kind === "option" ||
        type.elem.kind === "result" ||
        type.elem.kind === "vec";
      const list = value.kind === "list" ? value : { items: [] as EditorValue[] };
      if (isComplex) {
        return (
          <div className="pw-params-list">
            {list.items.map((item, index) => (
              <div className="pw-params-list-row" key={index}>
                <div className="pw-params-list-body">
                  <TypeEditor
                    type={type.elem}
                    value={item}
                    types={types}
                    depth={depth + 1}
                    onChange={(next) =>
                      onChange({
                        kind: "list",
                        items: list.items.map((existing, i) => (i === index ? next : existing)),
                      })
                    }
                  />
                </div>
                <button
                  type="button"
                  className="pw-param-remove"
                  aria-label="Remove element"
                  title="Remove element"
                  onClick={() =>
                    onChange({ kind: "list", items: list.items.filter((_, i) => i !== index) })
                  }
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="pw-param-add"
              onClick={() =>
                onChange({
                  kind: "list",
                  items: [...list.items, defaultEditorValue(type.elem, types)],
                })
              }
            >
              <Plus size={12} /> Add element
            </button>
          </div>
        );
      }
      const text = list.items.map((item) => (item.kind === "scalar" ? item.text : "")).join("\n");
      return (
        <textarea
          className="pw-field pw-mono pw-params-textarea"
          rows={Math.min(5, Math.max(1, list.items.length + 1))}
          value={text}
          onChange={(event) =>
            onChange({
              kind: "list",
              items: event.target.value
                .split(/[\s,]+/)
                .filter(Boolean)
                .map((part) => ({ kind: "scalar", text: part })),
            })
          }
          placeholder={type.elem.kind === "address" ? "One address per line — paste any chunk" : "One value per line"}
        />
      );
    }
    case "tuple": {
      const list = value.kind === "list" ? value : { items: [] as EditorValue[] };
      return (
        <div className="pw-params-tuple">
          {type.elems.map((element, index) => (
            <TypeEditor
              key={index}
              type={element}
              value={list.items[index] ?? defaultEditorValue(element, types)}
              types={types}
              depth={depth + 1}
              onChange={(next) =>
                onChange({
                  kind: "list",
                  items: list.items.map((existing, i) => (i === index ? next : existing)),
                })
              }
            />
          ))}
        </div>
      );
    }
    case "map": {
      const map =
        value.kind === "map"
          ? value
          : { rows: [] as Array<{ key: EditorValue; value: EditorValue }> };
      return (
        <div className="pw-params-map">
          {map.rows.map((row, index) => (
            <div className="pw-params-map-row" key={index}>
              <div className="pw-params-map-key">
                <span className="pw-param-type">key</span>
                <TypeEditor
                  type={type.key}
                  value={row.key}
                  types={types}
                  depth={depth + 1}
                  onChange={(key) =>
                    onChange({
                      kind: "map",
                      rows: map.rows.map((existing, i) => (i === index ? { ...existing, key } : existing)),
                    })
                  }
                />
              </div>
              <div className="pw-params-map-value">
                <span className="pw-param-type">value</span>
                <TypeEditor
                  type={type.value}
                  value={row.value}
                  types={types}
                  depth={depth + 1}
                  onChange={(val) =>
                    onChange({
                      kind: "map",
                      rows: map.rows.map((existing, i) => (i === index ? { ...existing, value: val } : existing)),
                    })
                  }
                />
              </div>
              <button
                type="button"
                className="pw-param-remove"
                aria-label="Remove map entry"
                title="Remove map entry"
                onClick={() =>
                  onChange({
                    kind: "map",
                    rows: map.rows.filter((_, i) => i !== index),
                  })
                }
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="pw-param-add"
            onClick={() =>
              onChange({
                kind: "map",
                rows: [
                  ...map.rows,
                  {
                    key: defaultEditorValue(type.key, types),
                    value: defaultEditorValue(type.value, types),
                  },
                ],
              })
            }
          >
            <Plus size={12} /> Add entry
          </button>
        </div>
      );
    }
    case "option": {
      const option =
        value.kind === "option"
          ? value
          : { some: false, value: null as EditorValue | null };
      return (
        <div className="pw-params-branch">
          <select
            className="pw-field pw-params-branch-select"
            value={option.some ? "some" : "none"}
            onChange={(event) => {
              const some = event.target.value === "some";
              onChange({
                kind: "option",
                some,
                value: some ? option.value ?? defaultEditorValue(type.inner, types) : null,
              });
            }}
          >
            <option value="none">None</option>
            <option value="some">Some</option>
          </select>
          {option.some && option.value && (
            <TypeEditor
              type={type.inner}
              value={option.value}
              types={types}
              depth={depth + 1}
              onChange={(next) => onChange({ kind: "option", some: true, value: next })}
            />
          )}
        </div>
      );
    }
    case "result": {
      const result =
        value.kind === "result"
          ? value
          : { ok: true, value: null as EditorValue | null };
      return (
        <div className="pw-params-branch">
          <select
            className="pw-field pw-params-branch-select"
            value={result.ok ? "ok" : "err"}
            onChange={(event) => {
              const ok = event.target.value === "ok";
              onChange({
                kind: "result",
                ok,
                value: result.value ?? defaultEditorValue(ok ? type.ok : type.err, types),
              });
            }}
          >
            <option value="ok">Ok</option>
            <option value="err">Err</option>
          </select>
          {result.value && (
            <TypeEditor
              type={result.ok ? type.ok : type.err}
              value={result.value}
              types={types}
              depth={depth + 1}
              onChange={(next) => onChange({ kind: "result", ok: result.ok, value: next })}
            />
          )}
        </div>
      );
    }
    case "udt": {
      const descriptor = types[type.name];
      const udt =
        value.kind === "udt"
          ? value
          : (defaultEditorValue(type, types) as {
              kind: "udt";
              name: string;
              variant: string;
              fields: Record<string, EditorValue>;
            });
      if (descriptor?.kind === "struct") {
        return (
          <div className="pw-params-udt">
            {descriptor.fields.map((field) => (
              <ParamField
                key={field.name}
                name={field.name}
                type={field.type}
                value={udt.fields[field.name] ?? defaultEditorValue(field.type, types)}
                types={types}
                depth={depth + 1}
                onChange={(next) =>
                  onChange({
                    kind: "udt",
                    name: type.name,
                    variant: "",
                    fields: { ...udt.fields, [field.name]: next },
                  })
                }
              />
            ))}
          </div>
        );
      }
      if (descriptor?.kind === "union") {
        const variant =
          descriptor.variants.find((candidate) => candidate.name === udt.variant) ??
          descriptor.variants[0];
        return (
          <div className="pw-params-udt">
            <select
              className="pw-field"
              value={udt.variant || variant?.name || ""}
              onChange={(event) => {
                const chosen = descriptor.variants.find((candidate) => candidate.name === event.target.value);
                const fields: Record<string, EditorValue> = {};
                if (chosen?.type) fields[chosen.name] = defaultEditorValue(chosen.type, types);
                onChange({ kind: "udt", name: type.name, variant: chosen?.name ?? "", fields });
              }}
            >
              {descriptor.variants.map((candidate) => (
                <option key={candidate.name} value={candidate.name}>
                  {candidate.name}
                </option>
              ))}
            </select>
            {variant?.type && (
              <TypeEditor
                type={variant.type}
                value={udt.fields[variant.name] ?? defaultEditorValue(variant.type, types)}
                types={types}
                depth={depth + 1}
                onChange={(next) =>
                  onChange({
                    kind: "udt",
                    name: type.name,
                    variant: variant.name,
                    fields: { ...udt.fields, [variant.name]: next },
                  })
                }
              />
            )}
          </div>
        );
      }
      const variants = descriptor?.variants ?? [];
      return (
        <div className="pw-params-udt">
          <select
            className="pw-field"
            value={udt.variant || variants[0]?.name || ""}
            onChange={(event) =>
              onChange({ kind: "udt", name: type.name, variant: event.target.value, fields: {} })
            }
          >
            {variants.map((candidate) => (
              <option key={candidate.name} value={candidate.name}>
                {candidate.name}
              </option>
            ))}
          </select>
        </div>
      );
    }
    default:
      return <span className="pw-param-type">{type.kind}</span>;
  }
}

export function SimulatorPage({
  scope,
  embeddedEnvironmentId,
  embeddedEnvironmentNetwork,
  newSimulation = false,
}: {
  scope: ProjectScope;
  embeddedEnvironmentId?: string;
  embeddedEnvironmentNetwork?: string;
  newSimulation?: boolean;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const requestedLedger = search.get("ledger");
  const sourceTransaction = search.get("tx");
  const [editor, setEditor] = useState(
    Boolean(
      embeddedEnvironmentId ||
      search.get("contract") ||
      search.get("environment") ||
      search.get("run") ||
      requestedLedger ||
      sourceTransaction ||
      newSimulation,
    ),
  );
  const [view, setView] = useState<"input" | "split" | "output">("split");
  const [activeInputSection, setActiveInputSection] = useState("parameters");
  const [resultTab, setResultTab] = useState<
    "summary" | "calls" | "auth" | "events" | "state" | "resources" | "raw"
  >("summary");
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [runs, setRuns] = useState<Simulation[]>([]);
  const [runQuery, setRunQuery] = useState("");
  const [runFilter, setRunFilter] = useState<"all" | "active" | "success" | "failed" | "cancelled">("all");
  const [runFilterOpen, setRunFilterOpen] = useState(false);
  const runFilterRef = useRef<HTMLDivElement | null>(null);
  const [environmentId, setEnvironmentId] = useState(
    embeddedEnvironmentId ?? search.get("environment") ?? "",
  );
  const [stateMode, setStateMode] = useState<
    "latest" | "ledger" | "environment"
  >(
    embeddedEnvironmentId || (!newSimulation && search.get("environment"))
      ? "environment"
      : requestedLedger
        ? "ledger"
        : "latest",
  );
  const requestedSimulationNetwork = search.get("network");
  const [simulationNetwork, setSimulationNetwork] = useState<
    "mainnet" | "testnet"
  >(
    requestedSimulationNetwork === "mainnet" || requestedSimulationNetwork === "testnet"
      ? requestedSimulationNetwork
      : scope.network === "testnet"
        ? "testnet"
        : "mainnet",
  );
  const [simulationNetworkMenuOpen, setSimulationNetworkMenuOpen] = useState(false);
  const simulationNetworkMenuRef = useRef<HTMLSpanElement | null>(null);
  const [historicalLedger, setHistoricalLedger] = useState(
    requestedLedger ?? "",
  );
  const [contractId, setContractId] = useState(search.get("contract") ?? "");
  const [functionName, setFunctionName] = useState(
    search.get("function") ?? "",
  );
  const [argsMode, setArgsMode] = useState<"decoded" | "raw">("decoded");
  const [args, setArgs] = useState(search.get("args") ?? "[]");
  const [contractSpec, setContractSpec] = useState<ContractSpecResponse | null>(null);
  const [contractSpecLoading, setContractSpecLoading] = useState(false);
  const [contractSpecError, setContractSpecError] = useState<string | null>(null);
  const [contractSpecRetry, setContractSpecRetry] = useState(0);
  const [paramValues, setParamValues] = useState<Record<string, EditorValue>>({});
  const specCacheRef = useRef(new Map<string, ContractSpecResponse>());
  const [sourceAccountXdr, setSourceAccountXdr] = useState("");
  const [sequenceNumber, setSequenceNumber] = useState<number | null>(null);
  const [sequenceLoading, setSequenceLoading] = useState(false);
  const [transactionEnvelopeXdr, setTransactionEnvelopeXdr] = useState("");
  const [increaseLedger, setIncreaseLedger] = useState("0");
  const [timestamp, setTimestamp] = useState("");
  const [balanceTarget, setBalanceTarget] = useState("");
  const [balanceAsset, setBalanceAsset] = useState("XLM");
  const [balanceAmount, setBalanceAmount] = useState("");
  const [storageKeyXdr, setStorageKeyXdr] = useState("");
  const [storageValueXdr, setStorageValueXdr] = useState("");
  const [contractEntries, setContractEntries] = useState<SimulationLedgerEntry[]>([]);
  const [contractEntrySearch, setContractEntrySearch] = useState("");
  const [contractEntriesLoading, setContractEntriesLoading] = useState(false);
  const [ttlKeyXdr, setTtlKeyXdr] = useState("");
  const [liveUntilLedger, setLiveUntilLedger] = useState("");
  const [advancedOverrides, setAdvancedOverrides] = useState("[]");
  const [captureTrace, setCaptureTrace] = useState(Boolean(sourceTransaction));
  const [selectedRun, setSelectedRun] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [functionMenuOpen, setFunctionMenuOpen] = useState(false);
  const [functionQuery, setFunctionQuery] = useState("");
  const functionMenuRef = useRef<HTMLSpanElement | null>(null);
  const [targetSuggestions, setTargetSuggestions] = useState<TargetSuggestion[]>([]);
  const [targetLookupOpen, setTargetLookupOpen] = useState(false);
  const [targetLookupLoading, setTargetLookupLoading] = useState(false);
  const [targetLookupError, setTargetLookupError] = useState<string | null>(null);
  const [sourceAccountError, setSourceAccountError] = useState<string | null>(null);
  const [targetActiveIndex, setTargetActiveIndex] = useState(0);
  const [sourceAccountSuggestions, setSourceAccountSuggestions] = useState<TargetSuggestion[]>([]);
  const [sourceAccountLookupOpen, setSourceAccountLookupOpen] = useState(false);
  const [sourceAccountLookupLoading, setSourceAccountLookupLoading] = useState(false);
  const [sourceAccountLookupError, setSourceAccountLookupError] = useState<string | null>(null);
  const [sourceAccountActiveIndex, setSourceAccountActiveIndex] = useState(0);
  const targetLookupRef = useRef<HTMLDivElement | null>(null);
  const sourceAccountLookupRef = useRef<HTMLDivElement | null>(null);
  const [functionAction, setFunctionAction] = useState<"source" | "spec" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toastError, setToastError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (newSimulation) {
      setEditor(true);
    } else if (!embeddedEnvironmentId) {
      setEditor(false);
    }
  }, [embeddedEnvironmentId, newSimulation]);
  const [resourceJobStatusPath, setResourceJobStatusPath] = useState<
    string | null
  >(null);
  const pollingGeneration = useRef(0);

  const environmentPath = scopePath(scope, "/environments");
  const simulationPath = scopePath(scope, "/simulations");
  const selectedEnvironment = environments.find(
    (environment) => environment.id === environmentId,
  );
  const requestNetwork = embeddedEnvironmentNetwork ?? (
    stateMode === "environment"
      ? selectedEnvironment?.network ?? simulationNetwork
      : simulationNetwork
  );
  const visibleContractEntries = contractEntries.filter((entry) =>
    `${entry.decoded_key} ${entry.decoded_value} ${entry.key}`
      .toLowerCase()
      .includes(contractEntrySearch.trim().toLowerCase()),
  );
  const confirmedContractTarget = targetSuggestions.some(
    (suggestion) =>
      suggestion.kind === "contract" && suggestion.value === contractId.trim(),
  );
  const functionOptions = useMemo<FunctionOption[]>(() => {
    const target = contractId.trim();
    if (!confirmedContractTarget) return [];
    const merged = new Map<string, FunctionOption>();
    for (const fn of contractSpec?.functions ?? []) {
      merged.set(fn.name, { name: fn.name, inputs: fn.inputs, fromSpec: true });
    }
    for (const name of Array.from(
      new Set(
        runs
          .filter((run) => target && run.target?.trim() === target)
          .map((run) => run.function_name.trim())
          .filter(Boolean),
      ),
    )) {
      if (!merged.has(name)) merged.set(name, { name, inputs: [], fromSpec: false });
    }
    if (functionName.trim() && !merged.has(functionName.trim())) {
      merged.set(functionName.trim(), {
        name: functionName.trim(),
        inputs: [],
        fromSpec: false,
      });
    }
    return Array.from(merged.values()).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }, [confirmedContractTarget, contractId, contractSpec, functionName, runs]);
  const visibleFunctionOptions = useMemo(() => {
    const query = functionQuery.trim().toLowerCase();
    return functionOptions.filter(
      (option) =>
        option.name.toLowerCase().includes(query) ||
        option.inputs.some(
          (input) =>
            input.name.toLowerCase().includes(query) ||
            typeLabel(input.type).toLowerCase().includes(query),
        ),
    );
  }, [functionOptions, functionQuery]);
  const selectedFunction =
    contractSpec?.functions.find((fn) => fn.name === functionName) ?? null;
  const paramErrors = useMemo(() => {
    if (!selectedFunction || !contractSpec) return {};
    const errors: Record<string, string | null> = {};
    for (const input of selectedFunction.inputs) {
      errors[input.name] = validateEditorValue(
        input.type,
        paramValues[input.name] ?? defaultEditorValue(input.type, contractSpec.contract_types),
        contractSpec.contract_types,
      );
    }
    return errors;
  }, [contractSpec, paramValues, selectedFunction]);
  const hasParamErrors = Object.values(paramErrors).some(Boolean);
  const load = useCallback(async () => {
    if (!environmentPath || !simulationPath) return;
    try {
      const [environmentResult, simulationResult] = await Promise.all([
        api.get<{ environments: Environment[] }>(environmentPath),
        api.get<{ simulations: Simulation[] }>(simulationPath),
      ]);
      setEnvironments(environmentResult.environments ?? []);
      setRuns(simulationResult.simulations ?? []);
      setEnvironmentId(
        (current) =>
          current ||
          environmentResult.environments?.find(
            (environment) =>
              requestedLedger &&
              environment.base_ledger_sequence === Number(requestedLedger),
          )?.id ||
          environmentResult.environments?.[0]?.id ||
          "",
      );
      setError(null);
      setToastError(null);
    } catch (cause) {
      setToastError(errorMessage(cause, "Could not load simulation data."));
    }
  }, [environmentPath, requestedLedger, simulationPath]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!runFilterOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && runFilterRef.current?.contains(event.target)) return;
      setRunFilterOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [runFilterOpen]);
  useEffect(() => {
    if (!functionMenuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && functionMenuRef.current?.contains(event.target)) return;
      setFunctionMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [functionMenuOpen]);
  useEffect(() => {
    if (!targetLookupOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && targetLookupRef.current?.contains(event.target)) return;
      setTargetLookupOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [targetLookupOpen]);
  useEffect(() => {
    if (!sourceAccountLookupOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && sourceAccountLookupRef.current?.contains(event.target)) return;
      setSourceAccountLookupOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [sourceAccountLookupOpen]);
  useEffect(() => {
    const normalized = contractId.trim();
    setTargetSuggestions([]);
    setTargetActiveIndex(0);
    if (!normalized) {
      setTargetSuggestions([]);
      setTargetLookupLoading(false);
      setTargetLookupError(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setTargetLookupLoading(true);
      setTargetLookupError(null);
      const result = await lookupExplorer(requestNetwork, normalized, controller.signal);
      if (controller.signal.aborted) return;
      setTargetSuggestions(
        (result.data?.suggestions ?? []).filter(
          (suggestion): suggestion is TargetSuggestion =>
            suggestion.kind === "account" || suggestion.kind === "contract",
        ),
      );
      setTargetActiveIndex(0);
      setTargetLookupError(result.error);
      setTargetLookupLoading(false);
      setTargetLookupOpen(true);
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [contractId, requestNetwork]);
  useEffect(() => {
    const normalized = sourceAccountXdr.trim();
    setSourceAccountSuggestions([]);
    setSourceAccountActiveIndex(0);
    if (!normalized) {
      setSourceAccountLookupLoading(false);
      setSourceAccountLookupError(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSourceAccountLookupLoading(true);
      setSourceAccountLookupError(null);
      const result = await lookupExplorer(requestNetwork, normalized, controller.signal);
      if (controller.signal.aborted) return;
      setSourceAccountSuggestions(
        (result.data?.suggestions ?? []).filter(
          (suggestion): suggestion is TargetSuggestion => suggestion.kind === "account",
        ),
      );
      setSourceAccountActiveIndex(0);
      setSourceAccountLookupError(
        result.error && /unsupported simulation network:/i.test(result.error)
          ? `No matching account found on ${requestNetwork}.`
          : result.error,
      );
      setSourceAccountLookupLoading(false);
      setSourceAccountLookupOpen(true);
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [requestNetwork, sourceAccountXdr]);
  useEffect(() => {
    if (!simulationNetworkMenuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        simulationNetworkMenuRef.current?.contains(event.target)
      ) return;
      setSimulationNetworkMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick, true);
  }, [simulationNetworkMenuOpen]);
  useEffect(() => {
    if (
      argsMode === "raw" ||
      stateMode === "ledger" ||
      !sourceAccountXdr.trim() ||
      !simulationPath
    ) {
      setSequenceNumber(null);
      setSequenceLoading(false);
      setSourceAccountError(null);
      return;
    }
    let cancelled = false;
    setSequenceNumber(null);
    setSequenceLoading(true);
    setSourceAccountError(null);
    const timer = window.setTimeout(() => {
      api.post<{ next_sequence_number: number }>(`${simulationPath}/sequence`, {
        network: requestNetwork,
        source_account: sourceAccountXdr.trim(),
        environment_id: stateMode === "environment" ? environmentId || null : null,
      }).then((response) => {
        if (!cancelled) {
          setSequenceNumber(response.next_sequence_number);
          setSourceAccountError(null);
        }
      }).catch((cause) => {
        if (!cancelled) {
          const rawMessage = errorMessage(
            cause,
            "The source account sequence could not be resolved from the selected state.",
          );
          const message = /unsupported simulation network:/i.test(rawMessage)
            ? `No matching account or contract found on ${requestNetwork}.`
            : rawMessage;
          setSourceAccountError(message);
        }
      }).finally(() => {
        if (!cancelled) setSequenceLoading(false);
      });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [argsMode, environmentId, requestNetwork, simulationPath, sourceAccountXdr, stateMode]);
  useEffect(() => {
    if (!contractId.trim() || !simulationPath) {
      setContractEntries([]);
      setStorageKeyXdr("");
      setStorageValueXdr("");
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setContractEntriesLoading(true);
      api.post<{ entries: SimulationLedgerEntry[] }>(`${simulationPath}/contract-entries`, {
        network: requestNetwork,
        contract_id: contractId.trim(),
        environment_id: stateMode === "environment" ? environmentId || null : null,
      }).then((response) => {
        if (cancelled) return;
        setContractEntries(response.entries ?? []);
        const first = response.entries?.[0];
        setStorageKeyXdr(first?.key ?? "");
        setStorageValueXdr(first?.value_xdr ?? "");
      }).catch(() => {
        if (!cancelled) setContractEntries([]);
      }).finally(() => {
        if (!cancelled) setContractEntriesLoading(false);
      });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [contractId, environmentId, requestNetwork, simulationPath, stateMode]);
  useEffect(() => {
    const target = contractId.trim();
    if (
      !simulationPath ||
      !target ||
      !isValidStellarContractId(target) ||
      !confirmedContractTarget
    ) {
      setContractSpec(null);
      setContractSpecError(null);
      setContractSpecLoading(false);
      setParamValues({});
      return;
    }
    const cacheKey = `${requestNetwork}:${target}`;
    const cached = specCacheRef.current.get(cacheKey);
    if (cached) {
      setContractSpec(cached);
      setContractSpecError(null);
      return;
    }
    let cancelled = false;
    setContractSpecLoading(true);
    const timer = window.setTimeout(() => {
      api.post<ContractSpecResponse>(`${simulationPath}/contract-spec`, {
        network: requestNetwork,
        contract_id: target,
        environment_id: stateMode === "environment" ? environmentId || null : null,
      }).then((response) => {
        if (cancelled) return;
        specCacheRef.current.set(cacheKey, response);
        setContractSpec(response);
        setContractSpecError(null);
      }).catch(() => {
        if (cancelled) return;
        setContractSpec(null);
        setContractSpecError("Error in finding indexed functions.");
      }).finally(() => {
        if (!cancelled) setContractSpecLoading(false);
      });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    confirmedContractTarget,
    contractId,
    environmentId,
    requestNetwork,
    simulationPath,
    stateMode,
    contractSpecRetry,
  ]);
  useEffect(() => {
    if (!selectedFunction || !contractSpec) return;
    setParamValues((current) => {
      const hasMissing = selectedFunction.inputs.some((input) => !(input.name in current));
      if (!hasMissing) return current;
      return { ...defaultValuesForFunction(selectedFunction, contractSpec.contract_types), ...current };
    });
  }, [contractSpec, selectedFunction]);

  const toggle = (section: string) =>
    setOpenSections((current) => ({
      ...current,
      [section]: !current[section],
    }));
  const buildOverrides = () => {
    const parsed = JSON.parse(advancedOverrides);
    if (!Array.isArray(parsed))
      throw new Error("Advanced overrides must be a JSON array.");
    const built: unknown[] = [...parsed];
    const baseLedger =
      stateMode === "environment"
        ? selectedEnvironment?.state_ledger ??
          selectedEnvironment?.base_ledger_sequence ??
          0
        : stateMode === "ledger"
          ? Number(historicalLedger)
          : 0;
    const increase = Number(increaseLedger || 0);
    if (stateMode === "latest" && increase > 0)
      throw new Error(
        "A relative ledger override requires a historical ledger or virtual network.",
      );
    if (increase > 0 || timestamp)
      built.push({
        type: "ledger",
        sequence: increase > 0 ? baseLedger + increase : null,
        timestamp: timestamp ? new Date(timestamp).toISOString() : null,
      });
    if (balanceTarget || balanceAmount) {
      if (!balanceTarget || !balanceAmount)
        throw new Error(
          "Balance override requires account and amount.",
        );
      built.push({
        type: "balance",
        target: balanceTarget,
        asset: balanceAsset || "XLM",
        amount: balanceAmount,
      });
    }
    if (storageKeyXdr || storageValueXdr) {
      if (!contractId || !storageKeyXdr || !storageValueXdr)
        throw new Error(
          "State override requires contract, ledger-key XDR, and value XDR.",
        );
      built.push({
        type: "storage",
        contract_id: contractId,
        ledger_key_xdr: storageKeyXdr,
        value_xdr: storageValueXdr,
      });
    }
    if (ttlKeyXdr || liveUntilLedger) {
      if (!ttlKeyXdr || !liveUntilLedger)
        throw new Error(
          "TTL override requires ledger-key XDR and live-until ledger.",
        );
      built.push({
        type: "ttl",
        ledger_key_xdr: ttlKeyXdr,
        live_until_ledger: Number(liveUntilLedger),
      });
    }
    return built;
  };

  const terminalSimulationStatuses = new Set([
    "success",
    "failed",
    "error",
    "cancelled",
    "inconclusive",
    "unavailable",
    "budget_limited",
  ]);

  const buildAuthoritativeRequest = () => {
    if (stateMode === "environment" && !environmentId)
      throw new Error("Choose a virtual network.");
    if (stateMode === "ledger") {
      const boundary = requestNetwork === "mainnet" ? 62447231 : 2070825;
      if (
        !Number.isSafeInteger(Number(historicalLedger)) ||
        Number(historicalLedger) < boundary
      )
        throw new Error(
          `Historical ${requestNetwork} simulations begin at ledger ${boundary.toLocaleString()}.`,
        );
    }
    if (
      argsMode === "decoded" &&
      (!contractId.trim() ||
        !functionName.trim() ||
        !sourceAccountXdr.trim() ||
        sequenceNumber === null)
    )
      throw new Error(
        "Decoded invocation requires a contract, function, and source account.",
      );
    if (argsMode === "raw" && !transactionEnvelopeXdr.trim())
      throw new Error("Paste a prepared transaction envelope XDR.");
    if (argsMode === "decoded" && selectedFunction) {
      if (hasParamErrors)
        throw new Error("Fix the highlighted arguments before running the simulation.");
    }

    const parsedArgs =
      argsMode === "decoded"
        ? selectedFunction && contractSpec
          ? buildArgsFromParams(contractSpec, functionName.trim(), paramValues)
          : JSON.parse(args)
        : [];
    const state_source =
      stateMode === "latest"
        ? { type: "latest" }
        : stateMode === "ledger"
          ? { type: "ledger", ledger_sequence: Number(historicalLedger) }
          : { type: "environment", environment_id: environmentId };
    const invocation =
      argsMode === "raw"
        ? {
            type: "prepared",
            transaction_envelope_xdr: transactionEnvelopeXdr.trim(),
          }
        : {
            type: "decoded",
            contract_id: contractId.trim(),
            function_name: functionName.trim(),
            args: parsedArgs,
            source_account: sourceAccountXdr.trim(),
            sequence_number: sequenceNumber,
          };
    return {
      network: requestNetwork,
      state_source,
      invocation,
      overrides: buildOverrides(),
      capture_trace: captureTrace,
    };
  };

  const pollSimulation = async (
    path: string,
    localId: string,
    generation: number,
    attempts: number,
    jobStatusPath?: string,
    initialRetryAfterMs = 1000,
  ) => {
    const terminalJobStatuses = new Set([
      "succeeded",
      "failed",
      "cancelled",
      "inconclusive",
      "unavailable",
      "budget_limited",
      "dead_letter",
    ]);
    let retryAfterMs = Math.min(Math.max(initialRetryAfterMs, 250), 5000);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, retryAfterMs));
      if (pollingGeneration.current !== generation) return;
      const polled = await api.get<Record<string, unknown>>(
        jobStatusPath ?? `${path}/${encodeURIComponent(localId)}`,
      );
      if (pollingGeneration.current !== generation) return;
      const fork = (polled.fork_core ?? polled) as Record<string, unknown>;
      const status = String(fork.status ?? "pending");
      retryAfterMs = Math.min(
        Math.max(Number(fork.retry_after_ms ?? 1000), 250),
        5000,
      );
      if (jobStatusPath && terminalJobStatuses.has(status)) {
        const completed = await api.get<Record<string, unknown>>(
          `${path}/${encodeURIComponent(localId)}`,
        );
        if (pollingGeneration.current !== generation) return;
        setSelectedRun(completed);
        return;
      }
      if (jobStatusPath) {
        setSelectedRun((current) => ({
          ...(current ?? {}),
          id: localId,
          fork_core: {
            ...(((current?.fork_core ?? {}) as Record<string, unknown>) ?? {}),
            ...polled,
          },
        }));
      } else {
        setSelectedRun(polled);
      }
      if (terminalSimulationStatuses.has(status)) return;
    }
  };

  const pollResourceJob = async (
    statusPath: string,
    jobId: string,
    generation: number,
    attempts: number,
    initialRetryAfterMs = 1000,
  ) => {
    const terminalStatuses = new Set([
      "succeeded",
      "failed",
      "cancelled",
      "inconclusive",
      "unavailable",
      "budget_limited",
      "dead_letter",
    ]);
    let retryAfterMs = Math.min(Math.max(initialRetryAfterMs, 250), 5000);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, retryAfterMs));
      if (pollingGeneration.current !== generation) return;
      const job = await api.get<Record<string, unknown>>(statusPath);
      if (pollingGeneration.current !== generation) return;
      const status = String(job.status ?? "queued");
      retryAfterMs = Math.min(
        Math.max(Number(job.retry_after_ms ?? 1000), 250),
        5000,
      );
      setSelectedRun({ job_id: jobId, fork_core: job });
      if (terminalStatuses.has(status)) {
        if (status !== "succeeded") {
          const lastError = job.last_error as
            | Record<string, unknown>
            | null
            | undefined;
          setToastError(
            typeof lastError?.message === "string"
              ? lastError.message
              : `Coverage repair ${status.replaceAll("_", " ")}.`,
          );
        }
        return;
      }
    }
  };

  const simulate = async () => {
    let request: ReturnType<typeof buildAuthoritativeRequest>;
    try {
      request = buildAuthoritativeRequest();
    } catch (cause) {
      const message = errorMessage(cause, "Arguments and overrides must be valid JSON.");
      if (/source account/i.test(message)) {
        setSourceAccountError(message);
        setError(null);
      } else {
        setError(message);
      }
      return;
    }
    const path = simulationPath;
    if (!path) return;
    setLoading(true);
    setView("split");
    setResourceJobStatusPath(null);
    const generation = pollingGeneration.current + 1;
    pollingGeneration.current = generation;
    try {
      const response = await api.post<Record<string, unknown>>(path, request);
      setResourceJobStatusPath(null);
      setSelectedRun(response);
      setResultTab("summary");
      setError(null);
      const localId = typeof response.id === "string" ? response.id : null;
      if (localId) {
        const accepted = (response.fork_core ?? {}) as Record<string, unknown>;
        const statusUrl =
          typeof accepted.status_url === "string" &&
          accepted.status_url.startsWith("/api/v1/")
            ? accepted.status_url
            : undefined;
        await pollSimulation(
          path,
          localId,
          generation,
          900,
          statusUrl,
          Number(accepted.retry_after_ms ?? 500),
        );
      }
      await load();
    } catch (cause) {
      const message = errorMessage(cause, "Could not queue simulation.");
      if (/source account/i.test(message)) {
        setSourceAccountError(message);
        setError(null);
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  const repairCoverage = async () => {
    if (stateMode !== "ledger") {
      setError("Coverage repair requires a historical ledger state source.");
      return;
    }
    let request: ReturnType<typeof buildAuthoritativeRequest>;
    try {
      request = buildAuthoritativeRequest();
    } catch (cause) {
      setError(
        errorMessage(cause, "Arguments and overrides must be valid JSON."),
      );
      return;
    }
    const path = scopePath(
      scope,
      `/networks/${encodeURIComponent(requestNetwork)}/coverage/repair`,
    );
    if (!path) return;
    setLoading(true);
    setView("split");
    setResourceJobStatusPath(null);
    const generation = pollingGeneration.current + 1;
    pollingGeneration.current = generation;
    try {
      const accepted = await api.post<Record<string, unknown>>(path, request, {
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      const jobId = typeof accepted.job_id === "string" ? accepted.job_id : null;
      const statusPath =
        typeof accepted.status_url === "string" &&
        accepted.status_url.startsWith("/api/v1/")
          ? accepted.status_url
          : null;
      if (!jobId || !statusPath)
        throw new Error("Coverage repair did not return a trackable job.");
      setResourceJobStatusPath(statusPath);
      setSelectedRun({ job_id: jobId, fork_core: accepted });
      setResultTab("summary");
      setError(null);
      await pollResourceJob(
        statusPath,
        jobId,
        generation,
        900,
        Number(accepted.retry_after_ms ?? 500),
      );
    } catch (cause) {
      setError(errorMessage(cause, "Could not queue coverage repair."));
    } finally {
      setLoading(false);
    }
  };

  const openRun = async (run: Simulation) => {
    if (!simulationPath) return;
    setEditor(true);
    setLoading(true);
    try {
      setResourceJobStatusPath(null);
      setSelectedRun(
        await api.get(`${simulationPath}/${encodeURIComponent(run.id)}`),
      );
      setView("output");
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause, "Could not load this simulation."));
    } finally {
      setLoading(false);
    }
  };

  const analyzeRun = async () => {
    const simulationId =
      typeof selectedRun?.id === "string" ? selectedRun.id : null;
    if (!simulationId || !simulationPath) return;
    setLoading(true);
    try {
      const accepted = await api.post<{ analysis_id: string }>(
        `${simulationPath}/${encodeURIComponent(simulationId)}/analysis`,
        {},
      );
      const debuggerBase = projectSectionHref(scope, "debugger");
      router.push(debuggerBase === "/organizations" ? debuggerBase : `${debuggerBase}/${encodeURIComponent(accepted.analysis_id)}`);
    } catch (cause) {
      setError(
        errorMessage(
          cause,
          "Could not start trace analysis. Confirm this run was created with trace capture enabled.",
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  const cancelRun = async () => {
    const generation = pollingGeneration.current + 1;
    pollingGeneration.current = generation;
    try {
      if (resourceJobStatusPath) {
        const jobId =
          typeof selectedRun?.job_id === "string" ? selectedRun.job_id : null;
        if (!jobId) return;
        await api.delete<Record<string, unknown>>(resourceJobStatusPath);
        setError(null);
        await pollResourceJob(resourceJobStatusPath, jobId, generation, 120);
        return;
      }
      const simulationId =
        typeof selectedRun?.id === "string" ? selectedRun.id : null;
      if (!simulationId || !simulationPath) return;
      await api.delete<Record<string, unknown>>(
        `${simulationPath}/${encodeURIComponent(simulationId)}`,
      );
      setSelectedRun((current) => ({
        ...(current ?? {}),
        fork_core: {
          ...(((current?.fork_core ?? {}) as Record<string, unknown>) ?? {}),
          status: "cancelling",
          stage: "cancelling",
        },
      }));
      setError(null);
      await pollSimulation(simulationPath, simulationId, generation, 120);
      await load();
    } catch (cause) {
      setError(errorMessage(cause, "Could not cancel the simulation."));
    }
  };

  const detail = (selectedRun?.fork_core ?? selectedRun) as Record<
    string,
    unknown
  > | null;
  const detailResult = (detail?.fork_result ?? detail?.result ?? detail) as Record<
    string,
    unknown
  > | null;
  const outputForTab = useMemo(() => {
    if (!detailResult) return null;
    if (resultTab === "calls") return detailResult.call_tree ?? [];
    if (resultTab === "auth")
      return (
        (detailResult.execution_trace as Record<string, unknown> | undefined)
          ?.auth ?? []
      );
    if (resultTab === "events") return detailResult.events ?? [];
    if (resultTab === "state") return detailResult.state_changes ?? [];
    if (resultTab === "resources") return detailResult.resources ?? {};
    if (resultTab === "raw") return selectedRun;
    return {
      status: detailResult.status ?? detail?.status ?? "queued",
      stage: detailResult.stage ?? detail?.stage,
      progress: detailResult.progress ?? detail?.progress,
      requested_ledger:
        detailResult.requested_ledger ?? detail?.requested_ledger,
      state_ledger: detailResult.state_ledger ?? detail?.state_ledger,
      execution_ledger:
        detailResult.execution_ledger ?? detail?.execution_ledger,
      protocol: detailResult.protocol ?? detail?.protocol,
      retry_count: detailResult.retry_count ?? detail?.retry_count,
      completeness_certificate:
        detailResult.completeness_certificate ??
        detail?.completeness_certificate,
      provenance: detailResult.provenance ?? detail?.provenance,
      normalized_result: detailResult.normalized_result,
      error: detailResult.error,
    };
  }, [detail, detailResult, resultTab, selectedRun]);
  const canAnalyze =
    typeof selectedRun?.id === "string" &&
    Boolean(detailResult?.execution_trace);
  const simulationStatus = String(detail?.status ?? detailResult?.status ?? "queued");
  const canCancel =
    (typeof selectedRun?.id === "string" ||
      (Boolean(resourceJobStatusPath) &&
        typeof selectedRun?.job_id === "string")) &&
    ![
      "success",
      "failed",
      "error",
      "cancelled",
      "inconclusive",
      "unavailable",
      "budget_limited",
      "cancelling",
    ].includes(simulationStatus);
  const normalizedRunQuery = runQuery.trim().toLowerCase();
  const visibleRuns = runs.filter((run) => {
    const status = String(run.status).toLowerCase();
    const matchesQuery =
      !normalizedRunQuery ||
      `${run.function_name} ${status} ${run.id} ${run.base_ledger_sequence}`
        .toLowerCase()
        .includes(normalizedRunQuery);
    const matchesFilter =
      runFilter === "all" ||
      (runFilter === "active" && ["queued", "running", "pending", "cancelling"].includes(status)) ||
      (runFilter === "success" && ["success", "succeeded"].includes(status)) ||
      (runFilter === "failed" && ["failed", "error", "inconclusive", "unavailable", "budget_limited"].includes(status)) ||
      (runFilter === "cancelled" && status === "cancelled");
    return matchesQuery && matchesFilter;
  });

  const refreshSimulations = async () => {
    setRefreshing(true);
    try {
      await Promise.all([load(), refreshSpinDelay()]);
    } finally {
      setRefreshing(false);
    }
  };

  if (!editor)
    return (
      <div className="pw-page pw-simulator-entry">
        <ToastPopup
          message={toastError}
          kind="error"
          onDone={() => setToastError(null)}
        />
        <div className="pw-simulator-hero">
          <div>
            <span className="pw-empty-icon" aria-hidden="true">
              <SimulatorIcon size={62} />
            </span>
            <h1>Simulator</h1>
            <p>
              Preview Soroban transactions against real ledger snapshots,
              inspect exact state and authorization
              <br />
              effects, and test controlled what-if scenarios without signing or
              submitting.
            </p>
          </div>
        </div>
        <div className="pw-simulator-catalog-toolbar">
          <label className="pw-search pw-simulator-search">
            <Search size={16} />
            <input
              className="pw-field"
              value={runQuery}
              onChange={(event) => setRunQuery(event.target.value)}
              placeholder="Search for a simulation"
              aria-label="Search for a simulation"
            />
          </label>
          <div className="pw-simulator-filter-control" ref={runFilterRef}>
            <Button
              aria-label="Filter simulations"
              title="Filter simulations"
              aria-expanded={runFilterOpen}
              data-active={runFilter !== "all"}
              onClick={() => setRunFilterOpen((open) => !open)}
            >
              <Filter size={15} /> Filter
            </Button>
            {runFilterOpen && (
              <div className="pw-simulator-filter-menu" role="menu" aria-label="Simulation filters">
                {([
                  ["all", "All simulations"],
                  ["active", "Active"],
                  ["success", "Successful"],
                  ["failed", "Failed"],
                  ["cancelled", "Cancelled"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={runFilter === value}
                    data-active={runFilter === value}
                    onClick={() => {
                      setRunFilter(value);
                      setRunFilterOpen(false);
                    }}
                  >
                    <span>{label}</span>
                    {runFilter === value && <span className="pw-filter-option-check" aria-hidden="true"><Check size={10} /></span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="pw-simulator-catalog-actions">
            <Button
              iconOnly
              aria-label="Refresh simulations"
              title="Refresh simulations"
              disabled={loading || refreshing}
              onClick={() => void refreshSimulations()}
            >
              <RotateCcw className={refreshing ? "pw-spin" : ""} size={15} />
            </Button>
            <Button
              primary
              className="pw-catalog-create-button"
              onClick={() => router.push("/simulation/new")}
            >
              <Plus size={17} /> New simulation
            </Button>
          </div>
        </div>
        {visibleRuns.length ? (
          <div className="pw-simulator-table">
            <div className="pw-simulator-table-row pw-simulator-table-head">
              <span>Id</span>
              <span>Status</span>
              <span>Source</span>
              <span>Target</span>
              <span>Function</span>
              <span>Network</span>
              <span>Ledger</span>
              <span>Created At</span>
              <span />
            </div>
            {visibleRuns.map((run) => (
              <button
                className="pw-simulator-table-row"
                type="button"
                key={run.id}
                onClick={() => void openRun(run)}
              >
                <span className="pw-simulator-id pw-mono" title={run.id}>{truncateEntity(run.id, 10, 6)}</span>
                <StatusBadge status={run.status} />
                <span className="pw-mono" title={run.source ?? undefined}>{run.source ? truncateEntity(run.source, 10, 6) : "—"}</span>
                <span className="pw-mono" title={run.target ?? undefined}>{run.target ? truncateEntity(run.target, 10, 6) : "—"}</span>
                <span className="pw-simulator-function">{run.function_name || "Contract invocation"}</span>
                <span>{scope.network}</span>
                <span>{run.base_ledger_sequence.toLocaleString()}</span>
                <span title={run.created_at}>{createdAtLabel(run.created_at)}</span>
                <span className="pw-simulator-row-arrow">
                  <ChevronRight size={15} />
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="pw-simulator-empty">
            <SimulatorIcon size={34} />
            <h2>{runQuery || runFilter !== "all" ? "No simulations found" : "Create a simulation"}</h2>
            <p>
              {runQuery || runFilter !== "all"
                ? "Try another function, status, ledger, or simulation ID."
                : "Preview a Soroban transaction against Stellar ledger state."}
            </p>
          </div>
        )}
      </div>
    );

  const showInput = view !== "output";
  const showOutput = view !== "input";
  return (
    <div className="pw-page pw-sim-editor">
      {functionAction && (
        <Modal
          title={functionAction === "source" ? "View Source" : "Load Spec"}
          className="pw-modal-large"
          onClose={() => setFunctionAction(null)}
          footer={<Button onClick={() => setFunctionAction(null)}>Close</Button>}
        >
          <div className="pw-function-action-modal-space" aria-hidden="true" />
        </Modal>
      )}
      <ToastPopup
        message={toastError ?? error}
        kind="error"
        onDone={() => {
          setToastError(null);
          setError(null);
        }}
      />
      <div className="pw-sim-top">
        <div className="pw-inline">
          <Button
            iconOnly
            className="pw-sim-back-button"
            aria-label="Exit editor"
            onClick={() => {
              if (embeddedEnvironmentId) {
                setEditor(false);
              } else if (newSimulation) {
                router.push(projectSectionHref(scope, "simulator"));
              } else {
                setEditor(false);
              }
            }}
          >
            <ChevronLeft size={18} />
          </Button>
          <h1>New simulation</h1>
        </div>
        <div className="pw-segmented">
          <button
            data-active={view === "input"}
            onClick={() => setView("input")}
          >
            Input
          </button>
          <button
            data-active={view === "split"}
            onClick={() => setView("split")}
          >
            Split
          </button>
          <button
            data-active={view === "output"}
            onClick={() => setView("output")}
          >
            Output
          </button>
        </div>
        <div className="pw-actions">
          <Button onClick={() => navigator.clipboard.writeText(location.href)}>
            <Copy size={14} /> Copy draft link
          </Button>
          {canAnalyze && (
            <Button onClick={() => void analyzeRun()}>
              <Bug size={14} /> Analyze trace
            </Button>
          )}
          {canCancel && (
            <Button danger onClick={() => void cancelRun()}>
              <X size={14} /> Cancel
            </Button>
          )}
          {stateMode === "ledger" && (
            <Button
              disabled={loading}
              onClick={() => void repairCoverage()}
            >
              {loading ? <LoaderCircle size={14} /> : <Database size={14} />} Repair coverage
            </Button>
          )}
          <Button
            primary
            disabled={loading || (stateMode === "environment" && !environmentId) || (argsMode === "decoded" && (sequenceLoading || sequenceNumber === null)) || (argsMode === "decoded" && !!selectedFunction && hasParamErrors)}
            onClick={() => void simulate()}
          >
            {loading ? <LoaderCircle size={14} /> : <Play size={14} />} Simulate
          </Button>
        </div>
      </div>
      <div
        className="pw-sim-layout"
        data-view={view}
        data-embedded={embeddedEnvironmentId ? "true" : "false"}
        style={{
          gridTemplateColumns:
            view === "output" ? "1fr" : undefined,
        }}
      >
        {showInput && (
          <div className="pw-sim-input">
            {!embeddedEnvironmentId && <div className="pw-sim-context">
              <div className="pw-segmented" aria-label="State source">
                <button data-active={stateMode === "latest"} onClick={() => setStateMode("latest")}>Latest</button>
                <button data-active={stateMode === "ledger"} onClick={() => setStateMode("ledger")}>Historical ledger</button>
                {!newSimulation && <button data-active={stateMode === "environment"} onClick={() => setStateMode("environment")}>Virtual network</button>}
              </div>
              <div className="pw-inline pw-sim-context-controls">
                {stateMode === "ledger" && <label className="pw-inline pw-sim-ledger-control"><Database size={16} /><input
                  aria-label="Ledger sequence"
                  className="pw-field pw-mono pw-sim-ledger-input" type="number" value={historicalLedger}
                  onChange={(event) => setHistoricalLedger(event.target.value)} placeholder="Ledger sequence" /></label>}
                {stateMode === "environment" && !newSimulation && <label className="pw-inline"><Database size={16} /><select
                  className="pw-field" value={environmentId} onChange={(event) => setEnvironmentId(event.target.value)}
                  style={{ width: "auto", minWidth: 210 }}><option value="">Select virtual network</option>
                  {environments.map((environment) => <option key={environment.id} value={environment.id}>
                    {environment.name} / revision {environment.revision ?? 1}
                  </option>)}</select></label>}
                {stateMode !== "environment" && <span
                  className="pw-select-shell pw-sim-network-select"
                  ref={simulationNetworkMenuRef}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    className="pw-select-trigger"
                    aria-label="Simulation network"
                    aria-haspopup="listbox"
                    aria-expanded={simulationNetworkMenuOpen}
                    onClick={() => setSimulationNetworkMenuOpen((open) => !open)}
                  >
                    <NetworkLabel network={simulationNetwork} />
                    <ChevronDown className={`pw-dropdown-chevron${simulationNetworkMenuOpen ? " open" : ""}`} size={15} />
                  </button>
                  {simulationNetworkMenuOpen && <span
                    className="pw-select-menu pw-sim-network-menu"
                    role="listbox"
                    aria-label="Simulation network options"
                  >
                    {simulationNetworks.map((network) => <button
                      key={network}
                      type="button"
                      role="option"
                      aria-selected={simulationNetwork === network}
                      data-active={simulationNetwork === network}
                      onClick={() => {
                        setSimulationNetwork(network);
                        setSimulationNetworkMenuOpen(false);
                      }}
                    >
                      <NetworkLabel network={network} />
                      {simulationNetwork === network && <span className="pw-filter-option-check" aria-hidden="true"><Check size={10} /></span>}
                    </button>)}
                  </span>}
                </span>}
              </div>
            </div>}
            <div className="pw-input-navigation" aria-label="Simulation input sections">
              {([
                ["parameters", <Zap key="parameters-icon" size={16} />, "Transaction parameters"],
                ["balance", <CircleDollarSign key="balance-icon" size={16} />, "Override balance"],
                ["ledger", <Layers3 key="ledger-icon" size={16} />, "Increase ledger"],
                ["timestamp", <Clock3 key="timestamp-icon" size={16} />, "Override timestamp"],
                ["state", <Braces key="state-icon" size={16} />, "Contract state override"],
                ["ttl", <AlarmClock key="ttl-icon" size={16} />, "TTL override"],
                ["debugger", <Bug key="debugger-icon" size={16} />, "Debugger evidence"],
                ["advanced", <Code2 key="advanced-icon" size={16} />, "Advanced overrides"],
              ] as const).map(([id, icon, label]) => (
                <button
                  key={id}
                  type="button"
                  data-active={activeInputSection === id}
                  onClick={() => setActiveInputSection(id)}
                >
                  {icon}
                  <span>{label}</span>
                  {activeInputSection === id && <span className="pw-input-section-check" aria-hidden="true"><Check size={13} /></span>}
                </button>
              ))}
            </div>
            <div className="pw-sim-compose">
              <div className="pw-step-rail">
                <div className="pw-step">
                  <span className="pw-step-number">1</span>
                  <span>Invoke</span>
                </div>
                <div className="pw-step-actions">
                  <Button
                    iconOnly
                    aria-label="Add step"
                    disabled
                    title="Bundles are coming after single-call parity"
                  >
                    <Plus size={15} />
                  </Button>
                  <Button
                    iconOnly
                    aria-label="Reset"
                    onClick={() => {
                      setContractId("");
                      setFunctionName("");
                      setArgs("[]");
                      setParamValues({});
                      setContractSpec(null);
                      setContractSpecError(null);
                    }}
                  >
                    <RotateCcw size={14} />
                  </Button>
                </div>
              </div>
              <div className="pw-sim-form">
                <div
                  className="pw-sim-section"
                  data-input-section="parameters"
                  data-active={view === "input" && activeInputSection === "parameters" ? "true" : undefined}
                >
                  <h2>
                    <Zap size={16} /> Transaction parameters
                  </h2>
                  <div className="pw-field-grid">
                    {argsMode === "decoded" && <><label className="pw-label pw-span-full">
                      Source account<div className="pw-source-account-lookup" ref={sourceAccountLookupRef}>
                        <input className="pw-field pw-mono" value={sourceAccountXdr}
                          onChange={(event) => {
                            setSourceAccountXdr(event.target.value);
                            setSourceAccountError(null);
                            setSourceAccountLookupOpen(true);
                          }}
                          onFocus={() => setSourceAccountLookupOpen(Boolean(sourceAccountXdr.trim()))}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") setSourceAccountLookupOpen(false);
                            if (event.key === "ArrowDown" && sourceAccountSuggestions.length) {
                              event.preventDefault();
                              setSourceAccountLookupOpen(true);
                              setSourceAccountActiveIndex((index) => (index + 1) % sourceAccountSuggestions.length);
                            }
                            if (event.key === "ArrowUp" && sourceAccountSuggestions.length) {
                              event.preventDefault();
                              setSourceAccountLookupOpen(true);
                              setSourceAccountActiveIndex((index) => (index - 1 + sourceAccountSuggestions.length) % sourceAccountSuggestions.length);
                            }
                            if (event.key === "Enter" && sourceAccountSuggestions[sourceAccountActiveIndex]) {
                              event.preventDefault();
                              setSourceAccountXdr(sourceAccountSuggestions[sourceAccountActiveIndex].value);
                              setSourceAccountError(null);
                              setSourceAccountLookupOpen(false);
                            }
                          }}
                          placeholder="G... account address"
                          role="combobox"
                          aria-autocomplete="list"
                          aria-controls="simulation-source-account-suggestions"
                          aria-expanded={sourceAccountLookupOpen && Boolean(sourceAccountXdr.trim())}
                          aria-describedby={sourceAccountError ? "simulation-source-account-error" : undefined} />
                        {sourceAccountLookupOpen && sourceAccountXdr.trim() && (
                          <div id="simulation-source-account-suggestions" className="pw-target-lookup-menu pw-source-account-menu" role="listbox" aria-label="Source account suggestions">
                            {sourceAccountLookupLoading ? (
                              <span className="pw-select-empty">Checking {requestNetwork}…</span>
                            ) : sourceAccountLookupError ? (
                              <span className="pw-select-empty">{sourceAccountLookupError}</span>
                            ) : sourceAccountSuggestions.length ? (
                              sourceAccountSuggestions.map((suggestion, index) => (
                                <button
                                  key={`${suggestion.kind}-${suggestion.value}`}
                                  type="button"
                                  role="option"
                                  aria-selected={index === sourceAccountActiveIndex}
                                  data-active={index === sourceAccountActiveIndex}
                                  onPointerMove={() => setSourceAccountActiveIndex(index)}
                                  onClick={() => {
                                    setSourceAccountXdr(suggestion.value);
                                    setSourceAccountError(null);
                                    setSourceAccountLookupOpen(false);
                                  }}
                                >
                                  <EntityIdenticon value={suggestion.value} kind="account" size={20} />
                                  <span className="pw-target-suggestion-copy">
                                    <strong>{suggestion.label}</strong>
                                  </span>
                                  <code>{truncateEntity(suggestion.value, 10, 6)}</code>
                                </button>
                              ))
                            ) : sourceAccountError ? (
                              <span id="simulation-source-account-error" className="pw-select-empty pw-source-account-feedback">{sourceAccountError}</span>
                            ) : (
                              <span className="pw-select-empty">No matching account found on {requestNetwork}.</span>
                            )}
                          </div>
                        )}
                      </div>
                    </label></>}
                    <div className="pw-label pw-target-field pw-span-full">
                      <span className="pw-target-head">
                        <label htmlFor="simulation-target">Target</label>
                        <span className="pw-function-actions">
                          <button type="button" onClick={() => setFunctionAction("source")}>View Source</button>
                        </span>
                      </span>
                      <div className="pw-target-lookup" ref={targetLookupRef}>
                        <input
                          id="simulation-target"
                          className="pw-field pw-mono"
                          value={contractId}
                          onChange={(event) => {
                            setContractId(event.target.value);
                            setTargetLookupOpen(true);
                          }}
                          onFocus={() => setTargetLookupOpen(Boolean(contractId.trim()))}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") setTargetLookupOpen(false);
                            if (event.key === "ArrowDown" && targetSuggestions.length) {
                              event.preventDefault();
                              setTargetLookupOpen(true);
                              setTargetActiveIndex((index) => (index + 1) % targetSuggestions.length);
                            }
                            if (event.key === "ArrowUp" && targetSuggestions.length) {
                              event.preventDefault();
                              setTargetLookupOpen(true);
                              setTargetActiveIndex((index) => (index - 1 + targetSuggestions.length) % targetSuggestions.length);
                            }
                            if (event.key === "Enter" && targetSuggestions[targetActiveIndex]) {
                              event.preventDefault();
                              setContractId(targetSuggestions[targetActiveIndex].value);
                              setTargetLookupOpen(false);
                            }
                          }}
                          placeholder="Contract ID or Account"
                          role="combobox"
                          aria-autocomplete="list"
                          aria-controls="simulation-target-suggestions"
                          aria-expanded={targetLookupOpen && Boolean(contractId.trim())}
                        />
                        {targetLookupOpen && contractId.trim() && (
                          <div id="simulation-target-suggestions" className="pw-target-lookup-menu" role="listbox" aria-label="Target suggestions">
                            {targetLookupLoading ? (
                              <span className="pw-select-empty">Checking {requestNetwork}…</span>
                            ) : targetLookupError ? (
                              <span className="pw-select-empty">{targetLookupError}</span>
                            ) : targetSuggestions.length ? (
                              targetSuggestions.map((suggestion, index) => (
                                <button
                                  key={`${suggestion.kind}-${suggestion.value}`}
                                  type="button"
                                  role="option"
                                  aria-selected={index === targetActiveIndex}
                                  data-active={index === targetActiveIndex}
                                  onPointerMove={() => setTargetActiveIndex(index)}
                                  onClick={() => {
                                    setContractId(suggestion.value);
                                    setTargetLookupOpen(false);
                                  }}
                                >
                                  <EntityIdenticon value={suggestion.value} kind={suggestion.kind} size={20} />
                                  <span className="pw-target-suggestion-copy">
                                    <strong>{suggestion.label}</strong>
                                  </span>
                                  <code>{truncateEntity(suggestion.value, 10, 6)}</code>
                                </button>
                              ))
                            ) : (
                              <span className="pw-select-empty">No matching account or contract found on {requestNetwork}.</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <label className="pw-label pw-function-field pw-span-full">
                      <span className="pw-function-head">
                        <span>Function</span>
                        <span className="pw-function-head-tools">
                          {contractSpecLoading && <span className="pw-spec-status">Loading functions…</span>}
                          <div className="pw-segmented">
                            <button type="button"
                              data-active={argsMode === "decoded"}
                              onClick={() => setArgsMode("decoded")}
                            >
                              Decoded
                            </button>
                            <button type="button"
                              data-active={argsMode === "raw"}
                              onClick={() => setArgsMode("raw")}
                            >
                              Prepared envelope
                            </button>
                          </div>
                        </span>
                      </span>
                      <span
                        className="pw-select-shell pw-function-select"
                        ref={functionMenuRef}
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="pw-select-trigger"
                          aria-haspopup="listbox"
                          aria-expanded={functionMenuOpen}
                          onClick={() => {
                            if (functionMenuOpen) {
                              setFunctionQuery("");
                              setFunctionMenuOpen(false);
                              return;
                            }
                            if (confirmedContractTarget && isValidStellarContractId(contractId.trim())) {
                              const cacheKey = `${requestNetwork}:${contractId.trim()}`;
                              const cached = specCacheRef.current.get(cacheKey);
                              if (cached) {
                                setContractSpec(cached);
                                setContractSpecError(null);
                              } else {
                                setContractSpec(null);
                                setContractSpecError(null);
                                setContractSpecRetry((value) => value + 1);
                              }
                            }
                            setFunctionMenuOpen(true);
                          }}
                        >
                          <span>
                            {contractSpecLoading ? (
                              <span className="pw-loading-label">
                                Loading functions<span className="pw-loading-dots" aria-hidden="true">...</span>
                              </span>
                            ) : functionName || "Select function"}
                          </span>
                          <ChevronDown className={`pw-dropdown-chevron${functionMenuOpen ? " open" : ""}`} size={15} />
                        </button>
                        {functionMenuOpen && (
                          <span className="pw-select-menu pw-function-select-menu" role="listbox" aria-label="Contract functions">
                            <label className="pw-function-search">
                              <Search size={13} />
                              <input
                                autoFocus
                                value={functionQuery}
                                onChange={(event) => setFunctionQuery(event.target.value)}
                                onClick={(event) => event.stopPropagation()}
                                placeholder="Search functions"
                                aria-label="Search functions"
                              />
                            </label>
                            <span className="pw-function-options">
                              {contractSpecLoading ? (
                                <span className="pw-select-empty pw-loading-label">
                                  Loading functions<span className="pw-loading-dots" aria-hidden="true">...</span>
                                </span>
                              ) : contractSpecError ? (
                                <span className="pw-select-empty pw-function-error">{contractSpecError}</span>
                              ) : visibleFunctionOptions.length ? visibleFunctionOptions.map((option) => (
                              <button
                                key={option.name}
                                type="button"
                                role="option"
                                aria-selected={functionName === option.name}
                                data-active={functionName === option.name}
                                onClick={() => {
                                  setFunctionName(option.name);
                                  setParamValues({});
                                  setFunctionMenuOpen(false);
                                }}
                              >
                                <span className="pw-function-option">
                                  <span className="pw-function-option-name">{option.name}</span>
                                  <span className="pw-function-option-params">
                                    {option.inputs.length
                                      ? option.inputs.map((input) => (
                                          <span key={input.name}>
                                            {input.name}: {typeLabel(input.type)}
                                          </span>
                                        ))
                                      : <span className="pw-function-option-none">no args</span>}
                                  </span>
                                </span>
                                {functionName === option.name && <span className="pw-filter-option-check" aria-hidden="true"><Check size={10} /></span>}
                              </button>
                              )) : (
                                <span className="pw-select-empty">{functionOptions.length ? "No matching functions" : "No indexed functions found"}</span>
                              )}
                            </span>
                          </span>
                        )}
                      </span>
                    </label>
                    {argsMode === "decoded" && functionName.trim() && (
                      <div className="pw-params pw-span-full">
                        <span className="pw-function-head">
                          <span>Arguments</span>
                          <span className="pw-function-head-tools">
                            {!contractSpecLoading && !contractSpec && contractSpecError && (
                              <span className="pw-spec-status">Spec unavailable — using raw JSON args</span>
                            )}
                          </span>
                        </span>
                        {selectedFunction && contractSpec ? (
                          <div className="pw-params-form">
                            {selectedFunction.inputs.length === 0 && (
                              <span className="pw-params-note">This function takes no arguments.</span>
                            )}
                            {selectedFunction.inputs.map((input) => (
                              <ParamField
                                key={input.name}
                                name={input.name}
                                type={input.type}
                                value={
                                  paramValues[input.name] ??
                                  defaultEditorValue(input.type, contractSpec.contract_types)
                                }
                                error={paramErrors[input.name]}
                                types={contractSpec.contract_types}
                                onChange={(next) =>
                                  setParamValues((current) => ({ ...current, [input.name]: next }))
                                }
                              />
                            ))}
                          </div>
                        ) : contractSpecLoading ? (
                          <span className="pw-params-note">Loading contract spec…</span>
                        ) : (
                          <textarea
                            className="pw-field pw-mono"
                            rows={5}
                            value={args}
                            onChange={(event) => setArgs(event.target.value)}
                            placeholder='[{ "u32": 42 }, { "address": "C…" }]'
                          />
                        )}
                      </div>
                    )}
                    {argsMode === "raw" && (
                      <label className="pw-label pw-span-full">
                        Transaction envelope XDR
                        <textarea
                          className="pw-field pw-mono"
                          rows={5}
                          value={transactionEnvelopeXdr}
                          onChange={(event) => setTransactionEnvelopeXdr(event.target.value)}
                        />
                      </label>
                    )}
                  </div>
                </div>
                <Accordion
                  icon={<CircleDollarSign size={16} />}
                  title="Override balance"
                  open={Boolean(openSections.balance)}
                  onToggle={() => toggle("balance")}
                  sectionId="balance"
                  selectionMode={view === "input"}
                  active={activeInputSection === "balance"}
                  onSelect={() => setActiveInputSection("balance")}
                >
                  <div className="pw-field-grid">
                    <label className="pw-label">
                      Account
                      <input
                        className="pw-field pw-mono"
                        value={balanceTarget}
                        onChange={(event) =>
                          setBalanceTarget(event.target.value)
                        }
                        placeholder="G..."
                      />
                    </label>
                    <label className="pw-label">
                      Asset
                      <input
                        className="pw-field"
                        value={balanceAsset}
                        onChange={(event) =>
                          setBalanceAsset(event.target.value)
                        }
                      />
                    </label>
                    <label className="pw-label">
                      Amount
                      <input
                        className="pw-field"
                        value={balanceAmount}
                        onChange={(event) =>
                          setBalanceAmount(event.target.value)
                        }
                        placeholder="1000.0000000"
                      />
                    </label>
                  </div>
                </Accordion>
                <Accordion
                  icon={<Layers3 size={16} />}
                  title="Increase ledger"
                  open={Boolean(openSections.ledger)}
                  onToggle={() => toggle("ledger")}
                  sectionId="ledger"
                  selectionMode={view === "input"}
                  active={activeInputSection === "ledger"}
                  onSelect={() => setActiveInputSection("ledger")}
                >
                  <label className="pw-label">
                    Ledgers after snapshot
                    <input
                      className="pw-field"
                      type="number"
                      min="0"
                      value={increaseLedger}
                      onChange={(event) =>
                        setIncreaseLedger(event.target.value)
                      }
                    />
                  </label>
                </Accordion>
                <Accordion
                  icon={<Clock3 size={16} />}
                  title="Override timestamp"
                  open={Boolean(openSections.timestamp)}
                  onToggle={() => toggle("timestamp")}
                  sectionId="timestamp"
                  selectionMode={view === "input"}
                  active={activeInputSection === "timestamp"}
                  onSelect={() => setActiveInputSection("timestamp")}
                >
                  <label className="pw-label">
                    Ledger close time
                    <input
                      className="pw-field"
                      type="datetime-local"
                      value={timestamp}
                      onChange={(event) => setTimestamp(event.target.value)}
                    />
                  </label>
                </Accordion>
                <Accordion
                  icon={<Braces size={16} />}
                  title="Contract state override"
                  open={Boolean(openSections.state)}
                  onToggle={() => toggle("state")}
                  sectionId="state"
                  selectionMode={view === "input"}
                  active={activeInputSection === "state"}
                  onSelect={() => setActiveInputSection("state")}
                >
                  <div className="pw-sim-storage-builder">
                    <StorageKeyBuilder
                      scope={scope}
                      contractAddress={contractId && /^C/.test(contractId) ? contractId : undefined}
                      onKey={(key) => setStorageKeyXdr(key.ledger_key_xdr)}
                      onValue={(valueXdr) => setStorageValueXdr(valueXdr)}
                    />
                  </div>
                  <label className="pw-label">
                    Search contract entries
                    <input
                      className="pw-field"
                      value={contractEntrySearch}
                      onChange={(event) => setContractEntrySearch(event.target.value)}
                      placeholder="Search decoded key or value"
                    />
                  </label>
                  <div className="pw-sim-entry-list" aria-busy={contractEntriesLoading}>
                    {contractEntriesLoading && <div className="pw-sim-entry-empty">Reading contract entries...</div>}
                    {!contractEntriesLoading && !visibleContractEntries.length && (
                      <div className="pw-sim-entry-empty">
                        {contractEntries.length ? "No entries match this search." : "Enter a contract ID to read its available entries."}
                      </div>
                    )}
                    {visibleContractEntries.map((entry) => (
                      <button
                        type="button"
                        key={entry.key}
                        className={`pw-sim-entry-row${storageKeyXdr === entry.key ? " is-selected" : ""}`}
                        onClick={() => {
                          setStorageKeyXdr(entry.key);
                          setStorageValueXdr(entry.value_xdr ?? "");
                        }}
                      >
                        <span className="pw-sim-entry-main">
                          <strong>{entry.decoded_key}</strong>
                          <span>{entry.decoded_value}</span>
                        </span>
                        <span className="pw-sim-entry-meta">
                          <span>{entry.durability}</span>
                          <span>TTL {entry.ttl ?? "Not reported"}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                  {storageKeyXdr && <div className="pw-sim-entry-detail">
                    <div><span>Decoded key</span><code>{contractEntries.find((entry) => entry.key === storageKeyXdr)?.decoded_key ?? "Unavailable"}</code></div>
                    <div><span>Current value</span><code>{contractEntries.find((entry) => entry.key === storageKeyXdr)?.decoded_value ?? "Unavailable"}</code></div>
                    <div><span>Raw key XDR</span><code>{storageKeyXdr}</code></div>
                    <div><span>Raw value XDR</span><code>{contractEntries.find((entry) => entry.key === storageKeyXdr)?.value_xdr ?? "Unavailable"}</code></div>
                    <div><span>TTL</span><code>{contractEntries.find((entry) => entry.key === storageKeyXdr)?.ttl ?? "Not reported"}</code></div>
                  </div>}
                  <label className="pw-label">
                    Replacement value XDR
                    <textarea
                      className="pw-field pw-mono"
                      rows={3}
                      value={storageValueXdr}
                      onChange={(event) =>
                        setStorageValueXdr(event.target.value)
                      }
                    />
                  </label>
                </Accordion>
                <Accordion
                  icon={<AlarmClock size={16} />}
                  title="TTL override"
                  open={Boolean(openSections.ttl)}
                  onToggle={() => toggle("ttl")}
                  sectionId="ttl"
                  selectionMode={view === "input"}
                  active={activeInputSection === "ttl"}
                  onSelect={() => setActiveInputSection("ttl")}
                >
                  <div className="pw-field-grid">
                    <label className="pw-label">
                      Ledger-key XDR
                      <input
                        className="pw-field pw-mono"
                        value={ttlKeyXdr}
                        onChange={(event) => setTtlKeyXdr(event.target.value)}
                      />
                    </label>
                    <label className="pw-label">
                      Live until ledger
                      <input
                        className="pw-field"
                        type="number"
                        value={liveUntilLedger}
                        onChange={(event) =>
                          setLiveUntilLedger(event.target.value)
                        }
                      />
                    </label>
                  </div>
                </Accordion>
                <Accordion
                  icon={<Bug size={16} />}
                  title="Debugger evidence"
                  open={Boolean(openSections.debugger)}
                  onToggle={() => toggle("debugger")}
                  sectionId="debugger"
                  selectionMode={view === "input"}
                  active={activeInputSection === "debugger"}
                  onSelect={() => setActiveInputSection("debugger")}
                >
                  <label className="pw-inline">
                    <input
                      type="checkbox"
                      checked={captureTrace}
                      onChange={(event) =>
                        setCaptureTrace(event.target.checked)
                      }
                    />{" "}
                    Capture observation-only execution trace
                  </label>
                </Accordion>
                <Accordion
                  icon={<Code2 size={16} />}
                  title="Advanced overrides"
                  open={Boolean(openSections.advanced)}
                  onToggle={() => toggle("advanced")}
                  sectionId="advanced"
                  selectionMode={view === "input"}
                  active={activeInputSection === "advanced"}
                  onSelect={() => setActiveInputSection("advanced")}
                >
                  <label className="pw-label">
                    Override array
                    <textarea
                      className="pw-field pw-mono"
                      rows={6}
                      value={advancedOverrides}
                      onChange={(event) =>
                        setAdvancedOverrides(event.target.value)
                      }
                    />
                  </label>
                </Accordion>
              </div>
            </div>
          </div>
        )}
        {showOutput && (
          <div className="pw-output">
            <div className="pw-tabs pw-sim-result-tabs">
              <button
                data-active={resultTab === "summary"}
                onClick={() => setResultTab("summary")}
              >
                Summary
              </button>
              <button
                data-active={resultTab === "calls"}
                onClick={() => setResultTab("calls")}
              >
                Calls
              </button>
              <button
                data-active={resultTab === "auth"}
                onClick={() => setResultTab("auth")}
              >
                Auth
              </button>
              <button
                data-active={resultTab === "events"}
                onClick={() => setResultTab("events")}
              >
                Events
              </button>
              <button
                data-active={resultTab === "state"}
                onClick={() => setResultTab("state")}
              >
                State
              </button>
              <button
                data-active={resultTab === "resources"}
                onClick={() => setResultTab("resources")}
              >
                Resources
              </button>
              <button
                data-active={resultTab === "raw"}
                onClick={() => setResultTab("raw")}
              >
                Raw
              </button>
            </div>
            {selectedRun ? (
              <div className="pw-panel-body">
                <pre className="pw-json">
                  {JSON.stringify(outputForTab, null, 2)}
                </pre>
                {detailResult?.status === "pending" && (
                  <div className="pw-actions" style={{ marginTop: 14 }}>
                    <Button onClick={() => void load()}>
                      <RotateCcw size={14} /> Refresh status
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="pw-output-placeholder">
                <div>
                  <strong>Run the invocation to see the simulation</strong>
                  Calls, authorization, state changes, events, resources, return
                  values, and structured errors will appear here.
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

type DebugTimelineEvent = {
  sequence: number;
  frame_id?: string | null;
  kind: string;
  source?: {
    file?: string;
    line?: number;
    column?: number;
    function?: string | null;
  } | null;
  data?: unknown;
};

type DebugFrame = {
  id: string;
  parent_id?: string | null;
  depth: number;
  contract_id: string;
  function: string;
  trapped: boolean;
  rolled_back: boolean;
  args?: unknown;
  result?: unknown;
  error?: unknown;
};

type DebugTracePage = {
  trace: {
    frames: DebugFrame[];
    state_changes: unknown[];
    events: unknown[];
    auth: unknown[];
    resources: unknown;
    limitations: string[];
    replay_parity?: boolean | null;
    truncated: boolean;
  };
  timeline: DebugTimelineEvent[];
  page: {
    cursor: number;
    limit: number;
    total: number;
    next_cursor?: number | null;
  };
};

export function DebuggerPage({
  scope,
  analysisId,
}: {
  scope: ProjectScope;
  analysisId: string;
}) {
  const router = useRouter();
  const base = scopePath(scope, `/debugger/${encodeURIComponent(analysisId)}`);
  const [workspace, setWorkspace] = useState<Record<string, any> | null>(null);
  const [trace, setTrace] = useState<DebugTracePage["trace"] | null>(null);
  const [timeline, setTimeline] = useState<DebugTimelineEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [current, setCurrent] = useState(0);
  const [panel, setPanel] = useState<"state" | "auth" | "events" | "resources">(
    "state",
  );
  const [breakpoint, setBreakpoint] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTrace = useCallback(
    async (cursor = 0, append = false) => {
      if (!base) return;
      const page = await api.get<DebugTracePage>(
        `${base}/trace?cursor=${cursor}&limit=500`,
      );
      setTrace(page.trace);
      setTimeline((items) =>
        append ? [...items, ...page.timeline] : page.timeline,
      );
      setNextCursor(page.page.next_cursor ?? null);
      setTotal(page.page.total);
    },
    [base],
  );

  const refresh = useCallback(async () => {
    if (!base || !analysisId) return;
    try {
      const value = await api.get<Record<string, any>>(base);
      setWorkspace(value);
      const analysisStatus = String(value.analysis?.status ?? "queued");
      if (analysisStatus === "succeeded" && !value.debugger && !starting) {
        setStarting(true);
        await api.post(base, {});
        setStarting(false);
        return;
      }
      if (value.debugger?.status === "succeeded") await loadTrace();
      setError(null);
    } catch (cause) {
      setStarting(false);
      setError(errorMessage(cause, "Could not load this debugger workspace."));
    }
  }, [analysisId, base, loadTrace, starting]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const analysisStatus = String(workspace?.analysis?.status ?? "queued");
    const debugStatus = String(workspace?.debugger?.status ?? "queued");
    if (
      ["failed", "cancelled", "dead_letter"].includes(analysisStatus) ||
      debugStatus === "succeeded" ||
      trace
    )
      return;
    const timer = window.setInterval(() => void refresh(), 1_500);
    return () => window.clearInterval(timer);
  }, [refresh, trace, workspace]);

  const frames = trace?.frames ?? [];
  const frameDepth = useMemo(
    () => new Map(frames.map((frame) => [frame.id, frame.depth])),
    [frames],
  );
  const event = timeline[current];
  const move = (mode: "into" | "over" | "out" | "continue") => {
    if (!timeline.length) return;
    const depth = event?.frame_id ? (frameDepth.get(event.frame_id) ?? 0) : 0;
    let target = current + 1;
    if (mode === "over")
      target = timeline.findIndex(
        (item, index) =>
          index > current &&
          (item.frame_id ? (frameDepth.get(item.frame_id) ?? 0) : 0) <= depth,
      );
    if (mode === "out")
      target = timeline.findIndex(
        (item, index) =>
          index > current &&
          (item.frame_id ? (frameDepth.get(item.frame_id) ?? 0) : 0) < depth,
      );
    if (mode === "continue") {
      const normalized = breakpoint.trim().toLowerCase();
      target = timeline.findIndex(
        (item, index) =>
          index > current &&
          (item.kind === "error" ||
            (normalized &&
              `${item.source?.file ?? ""}:${item.source?.line ?? ""}`.toLowerCase() ===
                normalized)),
      );
    }
    setCurrent(
      Math.min(target < 0 ? timeline.length - 1 : target, timeline.length - 1),
    );
  };
  const evidence =
    panel === "state"
      ? trace?.state_changes
      : panel === "auth"
        ? trace?.auth
        : panel === "events"
          ? trace?.events
          : trace?.resources;
  const analysisStatus = String(workspace?.analysis?.status ?? "queued");
  const debugStatus = String(
    workspace?.debugger?.status ??
      (analysisStatus === "succeeded" ? "starting" : "waiting"),
  );

  return (
    <div className="pw-page pw-debugger">
      <div className="pw-debug-head">
        <div className="pw-inline">
            <Button
              iconOnly
              aria-label="Back to simulator"
              onClick={() => router.push(projectSectionHref(scope, "simulator"))}
            >
            <ArrowLeft size={15} />
          </Button>
          <div className="pw-detail-title">
            <p>Recorded execution</p>
            <h1>Debugger</h1>
            <p className="pw-mono">{analysisId}</p>
          </div>
        </div>
        <div className="pw-actions">
          <StatusBadge status={debugStatus} />
          <Button onClick={() => void refresh()}>
            <RotateCcw size={14} /> Refresh
          </Button>
        </div>
      </div>
      {error && <Message error>{error}</Message>}
      {!trace ? (
        <div className="pw-surface">
          <EmptyState
            icon={
              analysisStatus === "failed" ? (
                <X size={22} />
              ) : (
                <LoaderCircle className="animate-spin" size={22} />
              )
            }
            title={
              analysisStatus === "failed"
                ? "Analysis failed"
                : "Preparing recorded evidence"
            }
            body={
              analysisStatus === "failed"
                ? String(
                    workspace?.analysis?.failure_code ??
                      "SourceLens could not analyze this trace.",
                  )
                : `Analysis ${analysisStatus}; debugger ${debugStatus}.`
            }
          />
        </div>
      ) : (
        <>
          <div className="pw-debug-toolbar">
            <div className="pw-actions">
              <Button
                onClick={() => move("into")}
                title="Move to the next recorded event"
              >
                <ChevronRight size={14} /> Step into
              </Button>
              <Button
                onClick={() => move("over")}
                title="Move past nested call events"
              >
                Step over
              </Button>
              <Button
                onClick={() => move("out")}
                title="Move to the parent frame"
              >
                Step out
              </Button>
              <Button primary onClick={() => move("continue")}>
                <Play size={14} /> Continue
              </Button>
            </div>
            <label className="pw-inline pw-breakpoint">
              <span>Breakpoint</span>
              <input
                className="pw-field pw-mono"
                value={breakpoint}
                onChange={(input) => setBreakpoint(input.target.value)}
                placeholder="src/lib.rs:42"
              />
            </label>
            <span className="pw-mono pw-debug-counter">
              {timeline.length ? current + 1 : 0} / {total}
            </span>
          </div>
          {trace.limitations.length > 0 && (
            <div className="pw-debug-limitations">
              {trace.limitations.map((limitation) => (
                <StatusBadge
                  key={limitation}
                  status={limitation.replaceAll("_", " ")}
                />
              ))}
            </div>
          )}
          <div className="pw-debug-grid">
            <aside className="pw-debug-calls">
              <h2>Call tree</h2>
              {frames.map((frame) => (
                <button
                  key={frame.id}
                  data-active={event?.frame_id === frame.id}
                  style={{ paddingLeft: 12 + frame.depth * 15 }}
                  onClick={() => {
                    const index = timeline.findIndex(
                      (item) => item.frame_id === frame.id,
                    );
                    if (index >= 0) setCurrent(index);
                  }}
                >
                  <ChevronRight size={13} />
                  <span>
                    <strong>{frame.function}</strong>
                    <small className="pw-mono">
                      {truncateEntity(frame.contract_id, 9, 7)}
                    </small>
                  </span>
                  {(frame.trapped || frame.rolled_back) && (
                    <StatusBadge
                      status={frame.trapped ? "trapped" : "rolled back"}
                    />
                  )}
                </button>
              ))}
            </aside>
            <section className="pw-debug-source">
              <div className="pw-debug-source-head">
                <span className="pw-mono">
                  {event?.source?.file ?? "Execution evidence"}
                  {event?.source?.line
                    ? `:${event.source.line}:${event.source.column ?? 0}`
                    : ""}
                </span>
                <StatusBadge status={event?.kind ?? "no event"} />
              </div>
              <div className="pw-debug-event">
                <span className="pw-mono">#{event?.sequence ?? 0}</span>
                <h2>
                  {event?.source?.function ??
                    event?.kind?.replaceAll("_", " ") ??
                    "No event selected"}
                </h2>
                <pre className="pw-json">
                  {JSON.stringify(event?.data ?? {}, null, 2)}
                </pre>
              </div>
              <div className="pw-debug-timeline">
                {timeline.map((item, index) => (
                  <button
                    key={`${item.sequence}-${index}`}
                    data-active={index === current}
                    onClick={() => setCurrent(index)}
                  >
                    <span>{item.sequence}</span>
                    <strong>{item.kind.replaceAll("_", " ")}</strong>
                    <span className="pw-mono">
                      {item.source
                        ? `${item.source.file}:${item.source.line}`
                        : (item.frame_id ?? "host")}
                    </span>
                  </button>
                ))}
                {nextCursor !== null && (
                  <Button onClick={() => void loadTrace(nextCursor, true)}>
                    Load more events
                  </Button>
                )}
              </div>
            </section>
            <aside className="pw-debug-evidence">
              <div className="pw-tabs">
                <button
                  data-active={panel === "state"}
                  onClick={() => setPanel("state")}
                >
                  State
                </button>
                <button
                  data-active={panel === "auth"}
                  onClick={() => setPanel("auth")}
                >
                  Auth
                </button>
                <button
                  data-active={panel === "events"}
                  onClick={() => setPanel("events")}
                >
                  Events
                </button>
                <button
                  data-active={panel === "resources"}
                  onClick={() => setPanel("resources")}
                >
                  Resources
                </button>
              </div>
              <pre className="pw-json">
                {JSON.stringify(evidence ?? [], null, 2)}
              </pre>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function AlertSectionNav({
  section,
  onChange,
  count,
}: {
  section: AlertSection;
  onChange: (section: AlertSection) => void;
  count: number;
}) {
  const navRef = useRef<HTMLElement | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  useEffect(() => {
    const syncIndicator = () => {
      const nav = navRef.current;
      const active = activeRef.current;
      if (!nav || !active) return;
      setIndicator({ left: active.offsetLeft, width: active.offsetWidth });
    };
    syncIndicator();
    window.addEventListener("resize", syncIndicator);
    const observer =
      typeof ResizeObserver === "undefined" || !navRef.current
        ? null
        : new ResizeObserver(syncIndicator);
    if (observer && navRef.current) observer.observe(navRef.current);
    return () => {
      window.removeEventListener("resize", syncIndicator);
      observer?.disconnect();
    };
  }, [section]);

  return (
    <nav ref={navRef} className="pw-alert-nav" aria-label="Alert sections">
      <button
        className="pw-alert-nav-button"
        ref={section === "alerts" ? activeRef : undefined}
        data-active={section === "alerts"}
        aria-current={section === "alerts" ? "page" : undefined}
        onClick={() => onChange("alerts")}
      >
        <Bell size={15} />
        Alerts
        <span className="pw-alert-count">{count}</span>
      </button>
      <button
        className="pw-alert-nav-button"
        ref={section === "history" ? activeRef : undefined}
        data-active={section === "history"}
        aria-current={section === "history" ? "page" : undefined}
        onClick={() => onChange("history")}
      >
        <History size={15} /> History
      </button>
      <button
        className="pw-alert-nav-button"
        ref={section === "destinations" ? activeRef : undefined}
        data-active={section === "destinations"}
        aria-current={section === "destinations" ? "page" : undefined}
        onClick={() => onChange("destinations")}
      >
        <Zap size={15} /> Destinations
      </button>
      <span
        className="pw-alert-nav-indicator"
        aria-hidden="true"
        style={{ width: indicator.width, transform: `translateX(${indicator.left}px)` }}
      />
    </nav>
  );
}

function AlertBuilderView({
  scope,
  editing,
  name,
  setName,
  targetType,
  setTargetType,
  targetValue,
  setTargetValue,
  matchLogic,
  setMatchLogic,
  enabled,
  setEnabled,
  expressions,
  setExpressions,
  destinationRefs,
  setDestinationRefs,
  destinations,
  destinationsLoading,
  refreshDestinations,
  loading,
  onBack,
  onSave,
}: {
  scope: ProjectScope;
  editing: AlertRule | null;
  name: string;
  setName: (value: string) => void;
  targetType: string;
  setTargetType: (value: string) => void;
  targetValue: string;
  setTargetValue: (value: string) => void;
  matchLogic: "all" | "any";
  setMatchLogic: (value: "all" | "any") => void;
  enabled: boolean;
  setEnabled: (value: boolean) => void;
  expressions: Array<{ type: string; params: string }>;
  setExpressions: Dispatch<SetStateAction<Array<{ type: string; params: string }>>>;
  destinationRefs: DestinationRef[];
  setDestinationRefs: Dispatch<SetStateAction<DestinationRef[]>>;
  destinations: ProjectDestination[];
  destinationsLoading: boolean;
  refreshDestinations: () => void;
  loading: boolean;
  onBack: () => void;
  onSave: () => void;
}) {
  const [step, setStep] = useState<AlertBuilderStep>(1);
  const selectedType = expressions[0]?.type ?? "";
  const stepComplete = (value: AlertBuilderStep) => {
    if (value === 1) return Boolean(selectedType);
    if (value === 2) return Boolean(targetType);
    if (value === 3) return Boolean(name.trim() && expressions.length);
    return destinationRefs.length > 0;
  };
  const toggleDestination = (destination: ProjectDestination) => {
    setDestinationRefs((current) =>
      current.some((item) => item.id === destination.id)
        ? current.filter((item) => item.id !== destination.id)
        : [...current, { id: destination.id, scope: destination.scope }],
    );
  };
  const updateExpression = (index: number, patch: Partial<{ type: string; params: string }>) =>
    setExpressions((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  const toggleStep = (value: AlertBuilderStep) =>
    setStep((current) => (current === value ? current : value));

  const stepTitle = (value: AlertBuilderStep) =>
    (value === 1 && "Type") ||
    (value === 2 && "Target") ||
    (value === 3 && "Parameters") ||
    "Destinations";
  const stepDescription = (value: AlertBuilderStep) =>
    (value === 1 && "Select an alert trigger type.") ||
    (value === 2 && "Select addresses for which the alert will be triggered.") ||
    (value === 3 && "Set alert trigger parameters.") ||
    "Select the destinations to which alert notifications will be sent.";

  return (
    <section className="pw-alert-builder" aria-labelledby="alert-builder-title">
      <div className="pw-alert-builder-head">
        <div>
          <button className="pw-alert-back" onClick={onBack}>
            <ArrowLeft size={15} /> Back to alerts
          </button>
          <h2 id="alert-builder-title">{editing ? "Edit alert" : "New alert"}</h2>
          <p>Build a focused notification rule for activity in this project.</p>
        </div>
        <span className="pw-alert-builder-status">
          {enabled ? "Enabled on save" : "Paused on save"}
        </span>
      </div>

      <div className="pw-alert-steps">
        {([1, 2, 3, 4] as AlertBuilderStep[]).map((value) => {
          const complete = stepComplete(value);
          const expanded = step === value;
          return (
            <div className={`pw-alert-step ${expanded ? "expanded" : ""} ${complete ? "finished" : ""}`} key={value}>
              <button className="pw-alert-step-header" onClick={() => toggleStep(value)} aria-expanded={expanded}>
                <span className="pw-alert-step-icon">
                  {complete && !expanded ? <Check size={15} /> : value}
                </span>
                <span className="pw-alert-step-info">
                  <strong>{stepTitle(value)}</strong>
                  <span>{stepDescription(value)}</span>
                </span>
                <ChevronDown className="pw-alert-step-chevron" size={17} />
              </button>
              <div className="pw-alert-step-body-wrapper">
                <div className="pw-alert-step-body-inner">
                  <div className="pw-alert-step-divider" />
                  <div className="pw-alert-step-body">
                    {value === 1 && (
                      <>
                        <div className="pw-alert-options-grid">
                          {expressionOptions.map(([type, label]) => (
                            (() => {
                              const detail = alertTypeDetails[type] ?? {
                                description: "Triggers when matching activity is detected.",
                                icon: Bell,
                              };
                              const OptionIcon = detail.icon;
                              return (
                                <button
                                  className="pw-alert-option"
                                  data-selected={selectedType === type}
                                  key={type}
                                  onClick={() => {
                                    setExpressions((current) => [
                                      { type, params: current[0]?.params ?? "{}" },
                                      ...current.slice(1),
                                    ]);
                                    setStep(2);
                                  }}
                                >
                                  <OptionIcon className="pw-alert-option-icon" size={17} />
                                  <span className="pw-alert-option-copy">
                                    <strong>{label}</strong>
                                    <small>{detail.description}</small>
                                  </span>
                                  {selectedType === type && <Check className="pw-alert-option-check" size={15} />}
                                </button>
                              );
                            })()
                          ))}
                        </div>
                        <div className="pw-alert-step-actions">
                          <Button primary onClick={() => setStep(2)} disabled={!selectedType}>
                            Continue <ChevronRight size={14} />
                          </Button>
                        </div>
                      </>
                    )}
                    {value === 2 && (
                      <>
                        <div className="pw-alert-options-grid pw-alert-target-grid">
                          {alertTargetDetails.map(({ type, label, description, icon: TargetIcon }) => (
                            <button
                              className="pw-alert-option"
                              data-selected={targetType === type}
                              key={type}
                              onClick={() => {
                                setTargetType(type);
                                setStep(3);
                              }}
                            >
                              <TargetIcon className="pw-alert-option-icon" size={17} />
                              <span className="pw-alert-option-copy">
                                <strong>{label}</strong>
                                <small>{description}</small>
                              </span>
                              {targetType === type && <Check className="pw-alert-option-check" size={15} />}
                            </button>
                          ))}
                        </div>
                        {targetType !== "project" && (
                          <label className="pw-label pw-alert-field-block">
                            Target value
                            <input
                              className="pw-field pw-mono"
                              value={targetValue}
                              onChange={(event) => setTargetValue(event.target.value)}
                              placeholder={targetType === "address" ? "G... or C..." : targetType === "network" ? scope.network : "production"}
                            />
                          </label>
                        )}
                        <div className="pw-alert-step-actions">
                          <Button primary onClick={() => setStep(3)}>Continue <ChevronRight size={14} /></Button>
                        </div>
                      </>
                    )}
                    {value === 3 && (
                      <>
                        <div className="pw-alert-parameter-grid">
                          <label className="pw-label">
                            Rule name
                            <input className="pw-field" autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Failed checkout invocation" />
                          </label>
                          <label className="pw-label">
                            Match conditions
                            <select className="pw-field" value={matchLogic} onChange={(event) => setMatchLogic(event.target.value as "all" | "any")}>
                              <option value="all">All conditions</option>
                              <option value="any">Any condition</option>
                            </select>
                          </label>
                        </div>
                        <div className="pw-label pw-alert-condition-list">
                          <span>Conditions</span>
                          {expressions.map((expression, index) => (
                            <div className="pw-alert-condition" key={index}>
                              <select className="pw-field" value={expression.type} onChange={(event) => updateExpression(index, { type: event.target.value })}>
                                {expressionOptions.map(([option, label]) => <option key={option} value={option}>{label}</option>)}
                              </select>
                              {expression.type === "state_change" ? (
                                <div className="pw-storage-key-builder-wrap">
                                  <StorageKeyBuilder
                                    scope={scope}
                                    contractAddress={targetType === "address" && /^[CG]/.test(targetValue) ? targetValue : undefined}
                                    onParams={(params) => updateExpression(index, { params: JSON.stringify(params) })}
                                  />
                                  <details className="pw-alert-advanced">
                                    <summary>Advanced params JSON</summary>
                                    <textarea className="pw-field pw-mono" rows={3} value={expression.params} onChange={(event) => updateExpression(index, { params: event.target.value })} aria-label={`Params JSON for condition ${index + 1}`} />
                                  </details>
                                </div>
                              ) : (
                                <textarea className="pw-field pw-mono" rows={3} value={expression.params} onChange={(event) => updateExpression(index, { params: event.target.value })} aria-label={`Params JSON for condition ${index + 1}`} />
                              )}
                              <Button iconOnly danger aria-label="Remove condition" disabled={expressions.length === 1} onClick={() => setExpressions((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} /></Button>
                            </div>
                          ))}
                          <Button onClick={() => setExpressions((current) => [...current, { type: "event_emitted", params: "{}" }])}><Plus size={14} /> Add condition</Button>
                        </div>
                        <label className="pw-inline pw-alert-enable"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Enable immediately</label>
                        <div className="pw-alert-step-actions">
                          <Button primary onClick={() => setStep(4)} disabled={!name.trim() || !expressions.length}>Continue <ChevronRight size={14} /></Button>
                        </div>
                      </>
                    )}
                    {value === 4 && (
                      <>
                        <div className="pw-alert-destinations-header">
                          <div>
                            <strong>Notification destinations</strong>
                            <p>Choose where matching activity should be delivered.</p>
                          </div>
                          <button className="pw-alert-refresh" onClick={refreshDestinations} disabled={destinationsLoading}>
                            <RotateCcw className={destinationsLoading ? "pw-spin" : ""} size={14} /> Refresh destinations
                          </button>
                        </div>
                        <div className="pw-alert-info"><Bell size={16} /><span>Click a configured integration to connect it. Each destination can be reused across alert rules.</span></div>
                        {destinationsLoading ? <div className="pw-alert-loading"><LoaderCircle className="pw-spin" size={16} /> Loading destinations</div> : (
                          <div className="pw-alert-integrations-grid">
                            {alertDestinationOptions.map(({ type, label, description, icon: DestinationIcon }) => {
                              const configured = destinations.filter((destination) => destination.type === type);
                              return configured.length ? configured.map((destination) => {
                                const selectedDestination = destinationRefs.some((item) => item.id === destination.id);
                                return (
                                  <button className="pw-alert-integration-card" data-configured="true" data-selected={selectedDestination} key={destination.id} onClick={() => toggleDestination(destination)}>
                                    <span className="pw-alert-integration-icon"><DestinationIcon size={18} /></span>
                                    <span className="pw-alert-integration-copy"><strong>{label}</strong><small>{destination.config?.url ? String(destination.config.url) : description}</small></span>
                                    <span className="pw-alert-destination-check">{selectedDestination && <Check size={14} />}</span>
                                  </button>
                                );
                              }) : (
                                <div className="pw-alert-integration-card" data-configured="false" key={type}>
                                  <span className="pw-alert-integration-icon"><DestinationIcon size={18} /></span>
                                  <span className="pw-alert-integration-copy"><strong>{label}</strong><small>{description}</small></span>
                                  <span className="pw-alert-integration-state">Not configured</span>
                                </div>
                              );
                            })}
                            {destinations.filter((destination) => !alertDestinationOptions.some((option) => option.type === destination.type)).map((destination) => {
                              const selectedDestination = destinationRefs.some((item) => item.id === destination.id);
                              return <button className="pw-alert-integration-card" data-configured="true" data-selected={selectedDestination} key={destination.id} onClick={() => toggleDestination(destination)}><span className="pw-alert-integration-icon"><Zap size={18} /></span><span className="pw-alert-integration-copy"><strong>{destination.type}</strong><small>{destination.config?.url ? String(destination.config.url) : "Project destination"}</small></span><span className="pw-alert-destination-check">{selectedDestination && <Check size={14} />}</span></button>;
                            })}
                          </div>
                        )}
                        <div className="pw-alert-step-actions"><Button onClick={() => setStep(3)}><ArrowLeft size={14} /> Back</Button></div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="pw-alert-actions">
        <Button onClick={onBack}>Cancel</Button>
        <Button primary disabled={loading || !name.trim() || !expressions.length} onClick={onSave}>
          {loading ? <LoaderCircle className="pw-spin" size={14} /> : <Bell size={14} />} {editing ? "Save changes" : "Create alert"}
        </Button>
      </div>
    </section>
  );
}

function AlertDestinationsView({
  destinations,
  loading,
  onRefresh,
}: {
  destinations: ProjectDestination[];
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="pw-surface pw-alert-section">
      <div className="pw-alert-section-head"><div><h2>Destinations</h2><p>Project-level endpoints available to your alert rules.</p></div><Button onClick={onRefresh} disabled={loading}><RotateCcw className={loading ? "pw-spin" : ""} size={14} /> Refresh</Button></div>
      {loading ? <div className="pw-alert-loading"><LoaderCircle className="pw-spin" size={16} /> Loading destinations</div> : destinations.length ? <div className="pw-alert-destination-list">{destinations.map((destination) => <div className="pw-alert-destination-row" key={destination.id}><span className="pw-alert-destination-icon"><Zap size={17} /></span><div><strong>{destination.type}</strong><span>{destination.config?.url ? String(destination.config.url) : "Project destination"}</span></div><code>{truncateEntity(destination.id, 8, 6)}</code></div>)}</div> : <EmptyState icon={<Zap size={22} />} title="No destinations" body="Project destinations will appear here when they are configured." />}
    </div>
  );
}

function AlertHistoryView({
  rows,
  loading,
}: {
  rows: Array<{ alert: AlertRule; firing: AlertFiring }>;
  loading: boolean;
}) {
  return (
    <div className="pw-surface pw-alert-section">
      <div className="pw-alert-section-head"><div><h2>History</h2><p>Recent alert firings across this project.</p></div></div>
      {loading ? <div className="pw-alert-loading"><LoaderCircle className="pw-spin" size={16} /> Loading history</div> : rows.length ? <div className="pw-alert-history-list">{rows.map(({ alert, firing }) => <div className="pw-alert-history-row" key={`${alert.id}-${firing.id}`}><span className="pw-alert-history-status"><Check size={14} /></span><div><strong>{alert.name}</strong><span>{timeLabel(firing.fired_at)}</span></div><code>{firing.tx_hash ? truncateEntity(firing.tx_hash, 12, 8) : "Simulation or indexed event"}</code></div>)}</div> : <EmptyState icon={<History size={22} />} title="No alert history" body="Matches from indexed transactions and simulations will appear here." />}
    </div>
  );
}

export function AlertsPage({ scope }: { scope: ProjectScope }) {
  const router = useRouter();
  const [page, setPage] = useState<CursorPage<AlertRule>>({ data: [] });
  const [selected, setSelected] = useState<AlertRule | null>(null);
  const [history, setHistory] = useState<CursorPage<AlertFiring>>({ data: [] });
  const [tab, setTab] = useState<"overview" | "history">("overview");
  const [section, setSection] = useState<AlertSection>("alerts");
  const [showBuilder, setShowBuilder] = useState(false);
  const [historyRows, setHistoryRows] = useState<Array<{ alert: AlertRule; firing: AlertFiring }>>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [destinations, setDestinations] = useState<ProjectDestination[]>([]);
  const [destinationsLoading, setDestinationsLoading] = useState(false);
  const [destinationRefs, setDestinationRefs] = useState<DestinationRef[]>([]);
  const [editing, setEditing] = useState<AlertRule | null>(null);
  const [name, setName] = useState("");
  const [targetType, setTargetType] = useState("project");
  const [targetValue, setTargetValue] = useState("");
  const [matchLogic, setMatchLogic] = useState<"all" | "any">("all");
  const [enabled, setEnabled] = useState(true);
  const [expressions, setExpressions] = useState<
    Array<{ type: string; params: string }>
  >([{ type: "failed_transaction", params: "{}" }]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkTagging, setBulkTagging] = useState(false);
  const [tagName, setTagName] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<AlertRule[] | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  const alertsPath = scopePath(scope, "/alerts");
  const destinationsPath = scopePath(scope, "/destinations");
  const load = useCallback(
    async (cursor: string | null = null) => {
      if (!alertsPath) return;
      try {
        setPage(
          await api.get(
            `${alertsPath}?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
          ),
        );
        setError(null);
      } catch (cause) {
        setError(errorMessage(cause, "Could not load alerts."));
      }
    },
    [alertsPath],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const loadDestinations = useCallback(async () => {
    if (!destinationsPath) return;
    setDestinationsLoading(true);
    try {
      const result = await api.get<CursorPage<ProjectDestination>>(`${destinationsPath}?limit=100`);
      setDestinations(result.data);
    } catch (cause) {
      setError(errorMessage(cause, "Could not load destinations."));
    } finally {
      setDestinationsLoading(false);
    }
  }, [destinationsPath]);
  useEffect(() => {
    void loadDestinations();
  }, [loadDestinations]);

  useEffect(() => {
    if (section !== "history" || !alertsPath) return;
    let active = true;
    setHistoryLoading(true);
    void Promise.all(
      page.data.map(async (alert) => {
        try {
          const result = await api.get<CursorPage<AlertFiring>>(
            `${alertsPath}/${encodeURIComponent(alert.id)}/history?limit=20`,
          );
          return result.data.map((firing) => ({ alert, firing }));
        } catch {
          return [];
        }
      }),
    ).then((results) => {
      if (!active) return;
      setHistoryRows(
        results
          .flat()
          .sort(
            (left, right) =>
              new Date(right.firing.fired_at).getTime() -
              new Date(left.firing.fired_at).getTime(),
          ),
      );
      setHistoryLoading(false);
    });
    return () => {
      active = false;
    };
  }, [alertsPath, page.data, section]);

  const resetBuilder = (rule?: AlertRule) => {
    setSelected(null);
    setEditing(rule ?? null);
    setName(rule?.name ?? "");
    setTargetType(rule?.target.type ?? "project");
    setTargetValue(rule?.target.value ?? "");
    setMatchLogic(rule?.match_logic ?? "all");
    setEnabled(rule?.enabled ?? true);
    setExpressions(
      rule?.expressions.map((expression) => ({
        type: expression.type,
        params: JSON.stringify(expression.params ?? {}, null, 2),
      })) ?? [{ type: "failed_transaction", params: "{}" }],
    );
    setDestinationRefs(rule?.destinations ?? []);
    setSection("alerts");
    setShowBuilder(true);
  };

  const save = async () => {
    if (!alertsPath || !name.trim()) {
      setError("Alert name is required.");
      return;
    }
    let parsedExpressions: AlertExpression[];
    try {
      parsedExpressions = expressions.map((expression) => ({
        type: expression.type,
        params: JSON.parse(expression.params || "{}"),
      }));
    } catch {
      setError("Every condition must contain valid params JSON.");
      return;
    }
    const body = {
      name: name.trim(),
      target: {
        type: targetType,
        value: targetType === "project" ? null : targetValue.trim() || null,
      },
      expressions: parsedExpressions,
      match_logic: matchLogic,
      destinations: destinationRefs,
      enabled,
    };
    setLoading(true);
    try {
      if (editing)
        await api.patch(
          `${alertsPath}/${encodeURIComponent(editing.id)}`,
          body,
        );
      else await api.post(alertsPath, body);
      setShowBuilder(false);
      setSection("alerts");
      setMessage(editing ? "Alert updated." : "Alert created.");
      setError(null);
      await load();
    } catch (cause) {
      setError(errorMessage(cause, "Could not save the alert."));
    } finally {
      setLoading(false);
    }
  };

  const openAlert = async (rule: AlertRule) => {
    setSelected(rule);
    setTab("overview");
    if (!alertsPath) return;
    try {
      setHistory(
        await api.get(
          `${alertsPath}/${encodeURIComponent(rule.id)}/history?limit=20`,
        ),
      );
    } catch {
      setHistory({ data: [] });
    }
  };

  const patchEnabled = async (rule: AlertRule, value: boolean) => {
    if (!alertsPath) return;
    try {
      await api.patch(`${alertsPath}/${encodeURIComponent(rule.id)}`, {
        name: rule.name,
        target: rule.target,
        expressions: rule.expressions,
        match_logic: rule.match_logic,
        destinations: rule.destinations,
        enabled: value,
      });
      setSelected({ ...rule, enabled: value });
      await load();
    } catch (cause) {
      setError(errorMessage(cause, "Could not update the alert."));
    }
  };

  const remove = async (rule: AlertRule) => {
    if (!alertsPath) return;
    try {
      await api.delete(`${alertsPath}/${encodeURIComponent(rule.id)}`);
      setSelected(null);
      setMessage("Alert deleted.");
      await load();
    } catch (cause) {
      setError(errorMessage(cause, "Could not delete the alert."));
    }
  };

  const visible = page.data.filter(
    (rule) =>
      !query.trim() ||
      `${rule.name} ${rule.target.value ?? ""}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const allVisibleSelected =
    visible.length > 0 && visible.every((rule) => selectedIds.has(rule.id));
  const selectedVisible = visible.filter((rule) => selectedIds.has(rule.id));
  useEffect(() => {
    if (selectAllRef.current)
      selectAllRef.current.indeterminate =
        selectedVisible.length > 0 && !allVisibleSelected;
  }, [allVisibleSelected, selectedVisible.length]);
  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAllSelected = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected)
        visible.forEach((rule) => next.delete(rule.id));
      else visible.forEach((rule) => next.add(rule.id));
      return next;
    });
  };
  const refreshList = async () => {
    setRefreshing(true);
    try {
      await Promise.all([load(), refreshSpinDelay()]);
      setSelectedIds(new Set());
    } finally {
      setRefreshing(false);
    }
  };
  const deleteSelected = async () => {
    const targets = deleteTargets ?? selectedVisible;
    if (!alertsPath || !targets.length) return;
    setLoading(true);
    try {
      await Promise.all(
        targets.map((rule) =>
          api.delete(`${alertsPath}/${encodeURIComponent(rule.id)}`),
        ),
      );
      const removed = new Set(targets.map((rule) => rule.id));
      setPage((current) => ({
        ...current,
        data: current.data.filter((rule) => !removed.has(rule.id)),
      }));
      setSelectedIds((current) => {
        const next = new Set(current);
        removed.forEach((id) => next.delete(id));
        return next;
      });
      setDeleteConfirm(false);
      setDeleteTargets(null);
      setMessage(
        targets.length === 1 ? "Alert deleted." : "Alerts deleted.",
      );
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause, "Could not delete the selected alerts."));
    } finally {
      setLoading(false);
    }
  };
  const saveTag = async (event: FormEvent) => {
    event.preventDefault();
    const name = tagName.trim();
    if (!selectedVisible.length || !name) return;
    const path = scopePath(scope, "/tags");
    if (!path) return;
    setLoading(true);
    try {
      let tag: ProjectTag;
      try {
        tag = await api.post<ProjectTag>(path, { name, color: null });
      } catch (cause) {
        if (!(cause instanceof ApiError) || cause.status !== 409) throw cause;
        const tags = await api.get<CursorPage<ProjectTag>>(`${path}?limit=100`);
        const existing = tags.data.find((item) => item.name === name);
        if (!existing) throw cause;
        tag = existing;
      }
      setBulkTagging(false);
      setTagName("");
      setMessage(
        `Tag "${tag.name}" created. Tags attach to accounts and contracts — reference this tag as an alert target.`,
      );
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause, "Could not create this tag."));
    } finally {
      setLoading(false);
    }
  };
  if (selected)
    return (
      <div className="pw-page">
        <div className="pw-detail-head">
          <div className="pw-inline">
            <Button
              iconOnly
              aria-label="Back to alerts"
              onClick={() => setSelected(null)}
            >
              <ArrowLeft size={16} />
            </Button>
            <div className="pw-detail-title">
              <p>Monitoring rule</p>
              <h1>{selected.name}</h1>
              <p>Created {timeLabel(selected.created_at)}</p>
            </div>
          </div>
          <div className="pw-actions">
            <Button onClick={() => resetBuilder(selected)}>
              <Settings2 size={14} /> Edit
            </Button>
            <Button
              onClick={() => void patchEnabled(selected, !selected.enabled)}
            >
              {selected.enabled ? <Pause size={14} /> : <Play size={14} />}
              {selected.enabled ? "Pause" : "Enable"}
            </Button>
            <Button danger onClick={() => void remove(selected)}>
              <Trash2 size={14} /> Delete
            </Button>
          </div>
        </div>
        {error && <Message error>{error}</Message>}
        <div className="pw-surface">
          <div className="pw-stats">
            <div className="pw-stat">
              <span>Status</span>
              <strong>
                <StatusBadge status={selected.enabled ? "enabled" : "paused"} />
              </strong>
            </div>
            <div className="pw-stat">
              <span>Target</span>
              <strong>{selected.target.type}</strong>
            </div>
            <div className="pw-stat">
              <span>Conditions</span>
              <strong>{selected.expressions.length}</strong>
            </div>
            <div className="pw-stat">
              <span>Firings loaded</span>
              <strong>{history.data.length}</strong>
            </div>
          </div>
          <div className="pw-tabs">
            <button
              data-active={tab === "overview"}
              onClick={() => setTab("overview")}
            >
              Rule
            </button>
            <button
              data-active={tab === "history"}
              onClick={() => setTab("history")}
            >
              Firing history
            </button>
          </div>
          {tab === "overview" && (
            <div className="pw-panel-body">
              <div className="pw-kv">
                <span>Target type</span>
                <span>{selected.target.type}</span>
                <span>Target value</span>
                <span className="pw-mono">
                  {selected.target.value || "Entire project"}
                </span>
                <span>Match logic</span>
                <span>Match {selected.match_logic} conditions</span>
                <span>Conditions</span>
                <span>
                  {selected.expressions
                    .map(
                      (expression) =>
                        expressionOptions.find(
                          ([value]) => value === expression.type,
                        )?.[1] ?? expression.type,
                    )
                    .join(", ")}
                </span>
                <span>Destinations</span>
                <span>
                  {selected.destinations.length || "No delivery destination"}
                </span>
              </div>
            </div>
          )}
          {tab === "history" && (
            <div className="pw-table">
              {history.data.length ? (
                history.data.map((firing) => (
                  <button
                    className="pw-row"
                    style={{
                      gridTemplateColumns:
                        "170px minmax(210px, 1fr) minmax(210px, 1fr)",
                    }}
                    key={firing.id}
                    onClick={() =>
                      firing.tx_hash &&
                      router.push(
                        `/explorer/${scope.network}/tx/${encodeURIComponent(firing.tx_hash)}`,
                      )
                    }
                  >
                    <span>{timeLabel(firing.fired_at)}</span>
                    <span className="pw-mono">
                      {firing.tx_hash
                        ? truncateEntity(firing.tx_hash, 12, 9)
                        : "No transaction"}
                    </span>
                    <span className="pw-mono">
                      {firing.simulation_id
                        ? truncateEntity(firing.simulation_id, 10, 8)
                        : "On-chain"}
                    </span>
                  </button>
                ))
              ) : (
                <EmptyState
                  icon={<History size={22} />}
                  title="No firings"
                  body="Matches from indexed on-chain transactions and simulations will appear here."
                />
              )}
            </div>
          )}
        </div>
      </div>
    );

  return (
    <div className="pw-page pw-alerts-page">
      {!showBuilder && (
        <>
          <Header
            title="Alerts"
            description="Monitor Stellar transactions, Soroban calls, events, balances, state changes, and simulation failures."
            actions={
              <Button primary className="pw-catalog-create-button" onClick={() => resetBuilder()}>
                <Plus size={17} /> Create alert
              </Button>
            }
          />
          {message && <Message>{message}</Message>}
          {error && <Message error>{error}</Message>}
          <AlertSectionNav
            section={section}
            onChange={(next) => {
              setSection(next);
              setShowBuilder(false);
            }}
            count={page.data.length}
          />
        </>
      )}
      {showBuilder ? (
        <AlertBuilderView
          scope={scope}
          editing={editing}
          name={name}
          setName={setName}
          targetType={targetType}
          setTargetType={setTargetType}
          targetValue={targetValue}
          setTargetValue={setTargetValue}
          matchLogic={matchLogic}
          setMatchLogic={setMatchLogic}
          enabled={enabled}
          setEnabled={setEnabled}
          expressions={expressions}
          setExpressions={setExpressions}
          destinationRefs={destinationRefs}
          setDestinationRefs={setDestinationRefs}
          destinations={destinations}
          destinationsLoading={destinationsLoading}
          refreshDestinations={() => void loadDestinations()}
          loading={loading}
          onBack={() => setShowBuilder(false)}
          onSave={() => void save()}
        />
      ) : section === "history" ? (
        <AlertHistoryView rows={historyRows} loading={historyLoading} />
      ) : section === "destinations" ? (
        <AlertDestinationsView destinations={destinations} loading={destinationsLoading} onRefresh={() => void loadDestinations()} />
      ) : (
      <div className="pw-surface">
        <div className="pw-toolbar">
          <div className="pw-search">
            <Search size={16} />
            <input
              className="pw-field"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search alert rules"
            />
          </div>
          <div className="pw-toolbar-actions">
            <Button
              iconOnly
              aria-label="Refresh alerts"
              title="Refresh alerts"
              disabled={loading || refreshing}
              onClick={() => void refreshList()}
            >
              <RotateCcw className={refreshing ? "pw-spin" : ""} size={15} />
            </Button>
            <Button
              iconOnly
              aria-label="Tag selected alerts"
              title="Tag selected alerts"
              disabled={!selectedVisible.length}
              onClick={() => {
                setBulkTagging(true);
                setTagName("");
              }}
            >
              <Tag size={15} />
            </Button>
            <Button
              iconOnly
              danger
              aria-label="Delete selected alerts"
              title="Delete selected alerts"
              disabled={!selectedVisible.length || loading}
              onClick={() => {
                setDeleteTargets(null);
                setDeleteConfirm(true);
              }}
            >
              <Trash2 size={15} />
            </Button>
          </div>
        </div>
        {!scope.project ? (
          <EmptyState
            icon={<Bell size={22} />}
            title="Select a project"
            body="Monitoring rules are scoped to a Releeve project."
          />
        ) : !visible.length ? (
          <div className="pw-simulator-empty">
            <Bell size={34} />
            <h2>{query ? "No matching alerts" : "No alert rules"}</h2>
            <p>
              {query
                ? "Try another rule name or target."
                : "Create a rule for failures, calls, events, balance changes, or state changes."}
            </p>
          </div>
        ) : (
          <div className="pw-table">
            <div
              className="pw-row pw-row-header"
              style={{
                gridTemplateColumns:
                  "36px minmax(190px, 1fr) 160px minmax(180px, 1fr) 110px 40px",
              }}
            >
              <span className="pw-select-cell">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  aria-label="Select all alerts"
                  checked={allVisibleSelected}
                  onChange={toggleAllSelected}
                />
              </span>
              <span>Rule</span>
              <span>Target</span>
              <span>Conditions</span>
              <span>Status</span>
              <span />
            </div>
{visible.map((rule) => (
              <div
                className="pw-row"
                role="button"
                tabIndex={0}
                style={{
                  gridTemplateColumns:
                    "36px minmax(190px, 1fr) 160px minmax(180px, 1fr) 110px 40px",
                }}
                key={rule.id}
                onClick={() => void openAlert(rule)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    void openAlert(rule);
                  }
                }}
              >
                <span
                  className="pw-select-cell"
                  onClick={(event) => event.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    aria-label={`Select ${rule.name}`}
                    checked={selectedIds.has(rule.id)}
                    onChange={() => toggleSelected(rule.id)}
                  />
                </span>
                <span>{rule.name}</span>
                <span className="pw-mono">
                  {rule.target.value
                    ? truncateEntity(rule.target.value, 8, 6)
                    : rule.target.type}
                </span>
                <span>
                  {rule.expressions.length} / match {rule.match_logic}
                </span>
                <StatusBadge status={rule.enabled ? "enabled" : "paused"} />
                <span>
                  <ChevronRight size={15} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      )}
      {!showBuilder && section === "alerts" && <Pagination page={page} onPage={load} />}
      {bulkTagging && (
        <Modal
          title="Tag selected alerts"
          onClose={() => {
            setBulkTagging(false);
            setTagName("");
          }}
          footer={
            <>
              <Button
                onClick={() => {
                  setBulkTagging(false);
                  setTagName("");
                }}
              >
                Cancel
              </Button>
              <Button
                primary
                disabled={loading || !tagName.trim()}
                onClick={() =>
                  document
                    .getElementById("alert-tag-form")
                    ?.dispatchEvent(
                      new Event("submit", { bubbles: true, cancelable: true }),
                    )
                }
              >
                {loading ? <LoaderCircle size={14} /> : <Tag size={14} />}{" "}
                Save tag
              </Button>
            </>
          }
        >
          <form
            id="alert-tag-form"
            onSubmit={saveTag}
            className="pw-modal-body"
            style={{ padding: 0 }}
          >
            <label className="pw-label">
              Tag name
              <input
                autoFocus
                className="pw-field"
                value={tagName}
                onChange={(event) => setTagName(event.target.value)}
                placeholder="production"
              />
            </label>
            <p className="pw-modal-note">
              {selectedVisible.length} selected alert rule
              {selectedVisible.length === 1 ? "" : "s"}. Tags attach to
              accounts and contracts; use the created tag as an alert target.
            </p>
          </form>
        </Modal>
      )}
      {deleteConfirm && (
        <Modal
          title={
            deleteTargets?.length === 1 ? "Delete alert" : "Delete selected alerts"
          }
          onClose={() => {
            setDeleteConfirm(false);
            setDeleteTargets(null);
          }}
          footer={
            <>
              <Button
                onClick={() => {
                  setDeleteConfirm(false);
                  setDeleteTargets(null);
                }}
              >
                Cancel
              </Button>
              <Button
                danger
                disabled={loading}
                onClick={() => void deleteSelected()}
              >
                {loading ? <LoaderCircle size={14} /> : <Trash2 size={14} />}{" "}
                Delete
              </Button>
            </>
          }
        >
          <p className="pw-modal-note">
            Remove {(deleteTargets ?? selectedVisible).length} alert rule
            {(deleteTargets ?? selectedVisible).length === 1 ? "" : "s"} from
            this project and stop future deliveries.
          </p>
        </Modal>
      )}
    </div>
  );
}
