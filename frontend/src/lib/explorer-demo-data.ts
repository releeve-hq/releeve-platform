import { DEFAULT_EXPLORER_NETWORK } from "@/lib/explorer-routes";

export type ExplorerLedger = {
  sequence: string;
  txs: string;
  gas: string;
  pct: string;
  gwei: string;
  time: string;
};

export type ExplorerTransaction = {
  method: string;
  hash: string;
  from: string;
  to: string;
  ledger: string;
  time: string;
  status: "success" | "failed";
  fee: string;
  amount: string;
  contractCalls: string[];
};

export const DEMO_NETWORK = DEFAULT_EXPLORER_NETWORK;

export const DEMO_ACCOUNTS = {
  alpha: "GAEQ2YORJQX4SA6LWWCPXYSVUWVKFZMSSYJQKJXUQW22J6B4MJ5AO3",
  beta: "GB7N3K5RFDGHEJZJ52UDXVH6EJXAMNRP5K2MYSF4XQ57FCQMV3L2ZTK",
  gamma: "GDRB5XBNJITMUMTN3KW5FY4CVXURH6J3SF5Q6K7YAZB62FDZAFQ3T7P",
};

export const DEMO_CONTRACTS = {
  swap: "CBKQJ2DW7TQ7OZ6MZCH3QWZLD3UBIVQ2H3JDFIGAOQ3YVXWWAGQXSWAP",
  token: "CDLZFC3SYJYDZT7K67VZ6A35FOCEPEHVOD4P2LTYH5NUTOKEN4Y6K",
  vault: "CCAVLT7AHDGWUMQKRNEKJCAMMZQJRGMDTUS4TEK6JWLVAULTP7N",
};

export const DEMO_LEDGERS: ExplorerLedger[] = [
  { sequence: "25660523", txs: "284 txs", gas: "38,138,218", pct: "64%", gwei: "0.041", time: "11 minutes ago" },
  { sequence: "25660522", txs: "213 txs", gas: "26,564,052", pct: "44%", gwei: "0.042", time: "12 minutes ago" },
  { sequence: "25660521", txs: "244 txs", gas: "35,025,833", pct: "58%", gwei: "0.041", time: "12 minutes ago" },
  { sequence: "25660520", txs: "233 txs", gas: "33,144,396", pct: "55%", gwei: "0.041", time: "12 minutes ago" },
  { sequence: "25660519", txs: "286 txs", gas: "29,770,186", pct: "50%", gwei: "0.041", time: "12 minutes ago" },
  { sequence: "25660518", txs: "211 txs", gas: "21,196,915", pct: "35%", gwei: "0.042", time: "12 minutes ago" },
  { sequence: "25660517", txs: "286 txs", gas: "26,147,639", pct: "44%", gwei: "0.043", time: "13 minutes ago" },
  { sequence: "25660516", txs: "311 txs", gas: "28,878,197", pct: "48%", gwei: "0.043", time: "13 minutes ago" },
  { sequence: "25660515", txs: "224 txs", gas: "25,357,491", pct: "42%", gwei: "0.044", time: "13 minutes ago" },
  { sequence: "25660514", txs: "176 txs", gas: "22,302,055", pct: "37%", gwei: "0.045", time: "13 minutes ago" },
];

export const DEMO_TRANSACTIONS: ExplorerTransaction[] = [
  {
    method: "swap",
    hash: "0x6abc72a4f1d9b0c8e274231987bd4a5cf303d35862c3d9f14cdaabe8ab5781b4",
    from: DEMO_ACCOUNTS.alpha,
    to: DEMO_CONTRACTS.swap,
    ledger: "25660523",
    time: "11 min ago",
    status: "success",
    fee: "0.00012 XLM",
    amount: "1,204.50 USDC",
    contractCalls: [DEMO_CONTRACTS.swap, DEMO_CONTRACTS.token],
  },
  {
    method: "transfer",
    hash: "0xe274231987bd4a5cf303d35862c3d9f14cdaabe8ab5781b46abc72a4f1d9b0c8",
    from: DEMO_ACCOUNTS.beta,
    to: DEMO_ACCOUNTS.alpha,
    ledger: "25660523",
    time: "11 min ago",
    status: "success",
    fee: "0.00010 XLM",
    amount: "84.00 XLM",
    contractCalls: [],
  },
  {
    method: "mint",
    hash: "0xd35862c3d9f14cdaabe8ab5781b46abc72a4f1d9b0c8e274231987bd4a5cf303",
    from: DEMO_ACCOUNTS.gamma,
    to: DEMO_CONTRACTS.token,
    ledger: "25660522",
    time: "12 min ago",
    status: "success",
    fee: "0.00014 XLM",
    amount: "420.00 RLV",
    contractCalls: [DEMO_CONTRACTS.token],
  },
  {
    method: "deposit",
    hash: "0xc3d9f14cdaabe8ab5781b46abc72a4f1d9b0c8e274231987bd4a5cf303d35862",
    from: DEMO_ACCOUNTS.alpha,
    to: DEMO_CONTRACTS.vault,
    ledger: "25660521",
    time: "12 min ago",
    status: "success",
    fee: "0.00011 XLM",
    amount: "250.00 USDC",
    contractCalls: [DEMO_CONTRACTS.vault, DEMO_CONTRACTS.token],
  },
];

export function findDemoLedger(sequence: string): ExplorerLedger {
  return DEMO_LEDGERS.find((ledger) => ledger.sequence === sequence) ?? {
    sequence,
    txs: "0 txs",
    gas: "0",
    pct: "0%",
    gwei: "0.000",
    time: "Untracked",
  };
}

export function findDemoTransaction(hash: string): ExplorerTransaction {
  return DEMO_TRANSACTIONS.find((tx) => tx.hash === hash) ?? {
    method: "unknown",
    hash,
    from: DEMO_ACCOUNTS.alpha,
    to: DEMO_CONTRACTS.swap,
    ledger: DEMO_LEDGERS[0].sequence,
    time: "Untracked",
    status: "success",
    fee: "n/a",
    amount: "n/a",
    contractCalls: [DEMO_CONTRACTS.swap],
  };
}

export function transactionsForLedger(sequence: string): ExplorerTransaction[] {
  const matches = DEMO_TRANSACTIONS.filter((tx) => tx.ledger === sequence);
  return matches.length > 0 ? matches : DEMO_TRANSACTIONS.slice(0, 2);
}

export function transactionsForEntity(address: string): ExplorerTransaction[] {
  const matches = DEMO_TRANSACTIONS.filter(
    (tx) => tx.from === address || tx.to === address || tx.contractCalls.includes(address),
  );
  return matches.length > 0 ? matches : DEMO_TRANSACTIONS.slice(0, 2);
}
