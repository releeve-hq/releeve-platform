export const DEFAULT_EXPLORER_NETWORK = "mainnet";

export type ExplorerNetwork = string;

export const explorerRoutes = {
  ledger: (network: ExplorerNetwork, sequence: string | number) =>
    `/explorer/${encodeURIComponent(network)}/ledger/${encodeURIComponent(String(sequence))}`,
  tx: (network: ExplorerNetwork, hash: string) =>
    `/explorer/${encodeURIComponent(network)}/tx/${encodeURIComponent(hash)}`,
  account: (network: ExplorerNetwork, address: string) =>
    `/explorer/${encodeURIComponent(network)}/account/${encodeURIComponent(address)}`,
  contract: (network: ExplorerNetwork, address: string) =>
    `/explorer/${encodeURIComponent(network)}/contract/${encodeURIComponent(address)}`,
  token: (network: ExplorerNetwork, asset: string) =>
    `/explorer/${encodeURIComponent(network)}/token/${encodeURIComponent(asset)}`,
};

export function isContractAddress(address: string): boolean {
  return address.trim().toUpperCase().startsWith("C");
}

export function addressRoute(network: ExplorerNetwork, address: string): string {
  return isContractAddress(address)
    ? explorerRoutes.contract(network, address)
    : explorerRoutes.account(network, address);
}

export function truncateEntity(value: string | number, head = 8, tail = 6): string {
  const text = String(value);
  if (text.length <= head + tail + 3) return text;
  return `${text.slice(0, head)}...${text.slice(-tail)}`;
}

type StoredWorkspaceShape = {
  organization?: unknown;
  project?: unknown;
  projectId?: unknown;
};

function readStoredWorkspace(): StoredWorkspaceShape | null {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(
      localStorage.getItem("releeve-active-workspace") || "null",
    ) as StoredWorkspaceShape | null;
  } catch {
    return null;
  }
}

/// Canonical base for the remembered project (`/projects/:id`), or null
/// when nothing usable is stored. Project IDs are globally unique and
/// rename-proof, unlike slugs.
function storedProjectBase(): string | null {
  const stored = readStoredWorkspace();
  if (typeof stored?.projectId === "string" && stored.projectId) {
    return `/projects/${encodeURIComponent(stored.projectId)}`;
  }
  return null;
}

/// Project home URL from the locally remembered workspace (client only).
/// Used by explorer chrome to link back without depending on app state.
export function storedProjectHome(): string {
  return storedProjectBase() ?? "/organizations";
}

/// Project-scoped section URL from the remembered workspace.
export function storedProjectSection(section: string): string {
  const base = storedProjectBase();
  return base ? `${base}/${section}` : "/organizations";
}
export function storedProjectAlerts(contract?: string): string {
  const base = storedProjectBase();
  if (!base) return "/organizations";
  return contract ? `${base}/alerts?contract=${encodeURIComponent(contract)}` : `${base}/alerts`;
}
export function storedProjectContract(address: string): string {
  const base = storedProjectBase();
  return base ? `${base}/contracts/${encodeURIComponent(address)}` : "/organizations";
}

export function stellarExpertRoute(network: ExplorerNetwork, kind: "tx" | "account" | "contract" | "ledger", value: string | number): string {
  const base = network === "mainnet"
    ? "https://stellar.expert/explorer/public"
    : `https://stellar.expert/explorer/${encodeURIComponent(network)}`;
  return `${base}/${kind}/${encodeURIComponent(String(value))}`;
}
