export const DEFAULT_EXPLORER_NETWORK = "mainnet";

export type ExplorerNetwork = string;

export const explorerRoutes = {
  ledger: (network: ExplorerNetwork, sequence: string | number) =>
    `/${network}/ledger/${encodeURIComponent(String(sequence))}`,
  tx: (network: ExplorerNetwork, hash: string) =>
    `/${network}/tx/${encodeURIComponent(hash)}`,
  account: (network: ExplorerNetwork, address: string) =>
    `/${network}/account/${encodeURIComponent(address)}`,
  contract: (network: ExplorerNetwork, address: string) =>
    `/${network}/contract/${encodeURIComponent(address)}`,
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
