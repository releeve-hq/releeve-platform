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
  memory_bytes?: number | null;
  invoke_time_nsecs?: number | null;
  disk_read_bytes?: number | null;
  write_bytes?: number | null;
  max_rw_key_byte?: number | null;
  max_rw_data_byte?: number | null;
};

export type TxCallTreeNode = {
  id: string;
  parent_id?: string | null;
  contract_id: string;
  function_name: string;
  args: JsonValue;
  return_value?: JsonValue;
  depth: number;
};

export type TxStateChange = {
  id: string;
  entry_type: string;
  key: string;
  before?: JsonValue;
  after?: JsonValue;
  caused_by_call?: string | null;
};

export type TxEvent = {
  id: string;
  contract_id: string;
  topics: JsonValue;
  data: JsonValue;
};

export type TxFundFlowEdge = {
  id: string;
  from: string;
  to: string;
  asset: string;
  amount: string;
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

export type ExplorerFetchResult<T> = {
  data: T | null;
  error: string | null;
};

async function publicExplorerGet<T>(path: string): Promise<ExplorerFetchResult<T>> {
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
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
