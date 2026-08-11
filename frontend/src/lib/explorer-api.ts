const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8080";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ResourceUsage = {
  cpu_instructions?: number | null;
  cpu_instruction_limit?: number | null;
  memory_bytes?: number | null;
  invoke_time_nsecs?: number | null;
  disk_read_bytes?: number | null;
  disk_read_bytes_limit?: number | null;
  write_bytes?: number | null;
  write_bytes_limit?: number | null;
  max_rw_key_byte?: number | null;
  max_rw_data_byte?: number | null;
  resource_fee?: string | null;
};

export type TxCallTreeNode = {
  id: string;
  parent_id?: string | null;
  contract_id: string;
  function_name: string;
  args: JsonValue;
  return_value?: JsonValue;
  depth: number;
  sequence: number;
};

export type TxStateChange = {
  id: string;
  entry_type: string;
  key: string;
  before?: JsonValue;
  after?: JsonValue;
  caused_by_call?: string | null;
  sequence: number;
  cause_confidence: "exact" | "contract" | "transaction" | string;
};

export type TxEvent = {
  id: string;
  contract_id: string;
  topics: JsonValue;
  data: JsonValue;
  caused_by_call?: string | null;
  sequence: number;
  event_type: string;
  successful?: boolean | null;
  stage?: string | null;
};

export type TxFundFlowEdge = {
  id: string;
  from: string;
  to: string;
  asset: string;
  amount: string;
  caused_by_call?: string | null;
  sequence: number;
  asset_type: string;
  usd_value?: string | null;
};

export type TxAnnotation = {
  id?: string;
  body?: string;
  target_type?: string;
  target_id?: string;
  [key: string]: JsonValue | undefined;
};

export type ExplorerTxDetail = {
  hash: string;
  network: string;
  status: string;
  ledger: number;
  timestamp: string;
  source_account: string;
  operation_type: string;
  operation_target_address?: string | null;
  operation_target_kind?: string | null;
  fee_charged?: string | null;
  sequence_number?: string | null;
  application_order?: number | null;
  resource_usage: ResourceUsage;
  call_tree: TxCallTreeNode[];
  state_changes: TxStateChange[];
  events: TxEvent[];
  fund_flow: TxFundFlowEdge[];
  annotations: TxAnnotation[];
  source_map_status: string;
};

export type ExplorerLedgerDetail = {
  sequence: number;
  hash: string;
  parent_hash?: string | null;
  transaction_count?: number | null;
  size_bytes?: number | null;
  timestamp: string;
  base_operation_fee?: string | null;
  base_reserve?: string | null;
  aggregate_resource_usage: {
    total_cpu_instructions?: number | null;
    resource_limit?: number | null;
    percent_used?: number | null;
  };
};

export type ExplorerAccountDetail = {
  address: string;
  network: string;
  tracked: boolean;
  xlm_balance?: string | null;
  usd_value?: string | null;
  token_holdings: Array<{ asset: string; balance?: string | null; usd_value?: string | null }>;
};

export type ExplorerContractDetail = {
  address: string;
  network: string;
  tracked: boolean;
  type: string;
  current_wasm_hash?: string | null;
  verification: { status: string; type?: string | null; timestamp?: string | null };
  toolchain: {
    rust_version?: string | null;
    soroban_sdk_version?: string | null;
    wasm_target?: string | null;
    opt_level?: string | null;
    wasm_opt_applied?: boolean | null;
    debug_symbols_present: boolean;
  };
};

export type ExplorerFetchResult<T> = {
  data: T | null;
  error: string | null;
};

export type ExplorerPage<T> = {
  limit: number;
  next_cursor: string | null;
  prev_cursor: string | null;
  data: T[];
};

export type ExplorerLiveFeed = {
  network: string;
  generated_at: string;
  transactions: ExplorerPage<ExplorerFeedTransaction>;
  ledgers: ExplorerPage<ExplorerFeedLedger>;
  error?: string;
};

export type ExplorerFeedTransaction = {
  hash: string;
  network: string;
  ledger?: number | null;
  ledger_sequence: number | null;
  status: 'success' | 'failed' | string;
  source_account: string;
  destination_account?: string | null;
  affected_account?: string | null;
  target_kind?: "transfer" | "contract" | "account_effect" | "none" | string;
  operation_type: string;
  timestamp: string;
  fee_charged?: string | null;
  amount?: string | null;
  asset?: string | null;
  call_trace?: {
    count: number;
    root_contract?: string | null;
    root_function?: string | null;
  };
};

export type ExplorerAccountTransaction = Omit<ExplorerFeedTransaction, "ledger_sequence"> & {
  ledger_sequence?: number | null;
};

export type ExplorerPagedEnvelope<T> = {
  data: T[];
  pagination: {
    limit: number;
    next_cursor: string | null;
    prev_cursor: string | null;
  };
};

export type ExplorerFeedLedger = {
  sequence: number;
  network: string;
  hash: string;
  transaction_count: number | null;
  timestamp: string;
  total_cpu_instructions?: number | null;
  resource_limit?: number | null;
};

export type ExplorerTokenTransfer = {
  tx_hash: string;
  from_address: string;
  to_address: string;
  asset: string;
  amount: string;
  timestamp: string;
};

export type ExplorerLookupSuggestion = {
  kind: "transaction" | "account" | "contract" | "ledger";
  value: string;
  label: string;
  description: string;
};

export type ExplorerLookupResponse = {
  query: string;
  suggestions: ExplorerLookupSuggestion[];
};

async function publicExplorerGet<T>(path: string, signal?: AbortSignal): Promise<ExplorerFetchResult<T>> {
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    });

    if (!res.ok) {
      const detail = await res.json().catch(() => null) as { message?: string; error?: string } | null;
      const error = detail?.message ?? detail?.error ?? (res.status === 404
        ? "No matching explorer record was found on this network."
        : res.status >= 500
          ? "The explorer service is temporarily unavailable."
          : `The explorer request could not be completed (${res.status}).`);
      return { data: null, error };
    }

    return { data: (await res.json()) as T, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Explorer API unavailable";
    return { data: null, error: message };
  }
}

async function publicExplorerPost<T>(path: string): Promise<ExplorerFetchResult<T>> {
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      method: "POST",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      return { data: null, error: `Explorer API returned ${res.status}` };
    }

    return { data: (await res.json()) as T, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Explorer API unavailable";
    return { data: null, error: message };
  }
}

export function getTransactionDetail(network: string, hash: string) {
  return publicExplorerGet<ExplorerTxDetail>(
    `/api/v1/explorer/${encodeURIComponent(network)}/tx/${encodeURIComponent(hash)}`,
  );
}

export function getLedgerDetail(network: string, sequence: string) {
  return publicExplorerGet<ExplorerLedgerDetail>(
    `/api/v1/explorer/${encodeURIComponent(network)}/ledger/${encodeURIComponent(sequence)}`,
  );
}

export function getAccountDetail(network: string, address: string) {
  return publicExplorerGet<ExplorerAccountDetail>(
    `/api/v1/explorer/${encodeURIComponent(network)}/account/${encodeURIComponent(address)}`,
  );
}

export function getAccountTransactions(network: string, address: string, limit = 20, cursor?: string | null) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set("cursor", cursor);
  return publicExplorerGet<ExplorerPagedEnvelope<ExplorerAccountTransaction>>(
    `/api/v1/explorer/${encodeURIComponent(network)}/account/${encodeURIComponent(address)}/transactions?${query.toString()}`,
  );
}

export function getContractDetail(network: string, address: string) {
  return publicExplorerGet<ExplorerContractDetail>(
    `/api/v1/explorer/${encodeURIComponent(network)}/contract/${encodeURIComponent(address)}`,
  );
}

export function lookupExplorer(network: string, query: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ q: query });
  return publicExplorerGet<ExplorerLookupResponse>(
    `/api/v1/explorer/${encodeURIComponent(network)}/lookup?${params.toString()}`,
    signal,
  );
}

export function getLedgerTransactions(network: string, sequence: string | number, limit = 20, cursor?: string | null) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set("cursor", cursor);
  return publicExplorerGet<ExplorerPagedEnvelope<ExplorerAccountTransaction>>(
    `/api/v1/explorer/${encodeURIComponent(network)}/ledger/${encodeURIComponent(String(sequence))}/transactions?${query.toString()}`,
  );
}

export function getContractTransactions(network: string, address: string, limit = 20, cursor?: string | null) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set("cursor", cursor);
  return publicExplorerGet<ExplorerPagedEnvelope<ExplorerAccountTransaction>>(
    `/api/v1/explorer/${encodeURIComponent(network)}/contract/${encodeURIComponent(address)}/transactions?${query.toString()}`,
  );
}

export type ExplorerContractEvent = TxEvent & { tx_hash: string; ledger: number; timestamp: string };

export function getContractEvents(network: string, address: string, limit = 20, cursor?: string | null) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set("cursor", cursor);
  return publicExplorerGet<ExplorerPagedEnvelope<ExplorerContractEvent>>(
    `/api/v1/explorer/${encodeURIComponent(network)}/contract/${encodeURIComponent(address)}/events?${query.toString()}`,
  );
}

export function syncExplorerNetwork(network: string) {
  return publicExplorerPost<{ network: string; ledgers_ingested: number }>(
    `/api/v1/explorer/${encodeURIComponent(network)}/sync`,
  );
}

export function getRecentTransactions(network: string, limit: number, cursor?: string | null, refresh = false) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set('cursor', cursor);
  if (refresh) query.set("refresh", "true");
  return publicExplorerGet<ExplorerPage<ExplorerFeedTransaction>>(
    `/api/v1/explorer/${encodeURIComponent(network)}/transactions/latest?${query.toString()}`,
  );
}

export function getRecentLedgers(network: string, limit: number, cursor?: string | null, refresh = false) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set('cursor', cursor);
  if (refresh) query.set("refresh", "true");
  return publicExplorerGet<ExplorerPage<ExplorerFeedLedger>>(
    `/api/v1/explorer/${encodeURIComponent(network)}/ledgers?${query.toString()}`,
  );
}

export function getTokenTransfers(network: string, asset: string, limit = 20, cursor?: string | null) {
  const query = new URLSearchParams({ limit: String(limit), asset, window: "30d" });
  if (cursor) query.set("cursor", cursor);
  return publicExplorerGet<ExplorerPage<ExplorerTokenTransfer>>(
    `/api/v1/explorer/${encodeURIComponent(network)}/transfers?${query.toString()}`,
  );
}

export function explorerLiveUrl(network: string) {
  return `${BACKEND_URL}/api/v1/explorer/${encodeURIComponent(network)}/live`;
}
