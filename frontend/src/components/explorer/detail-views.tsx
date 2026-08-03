import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import {
  AddressLink,
  ContractLink,
  LedgerLink,
  TxHashLink,
  isContractAddress,
  truncateEntity,
} from "@/components/explorer/entity-links";
import {
  type ExplorerTxDetail,
  type JsonValue,
  type TxCallTreeNode,
  getTransactionDetail,
} from "@/lib/explorer-api";
import {
  DEMO_CONTRACTS,
  findDemoLedger,
  findDemoTransaction,
  transactionsForEntity,
  transactionsForLedger,
  type ExplorerTransaction,
} from "@/lib/explorer-demo-data";

type DetailProps = {
  network: string;
};

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  background: "#09090b",
  color: "#f4f4f5",
  padding: "28px min(5vw, 56px)",
};

const shellStyle: CSSProperties = {
  maxWidth: 1120,
  margin: "0 auto",
};

const cardStyle: CSSProperties = {
  background: "#111113",
  border: "1px solid #27272a",
  borderRadius: 8,
  overflow: "hidden",
  marginTop: 16,
};

const rowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(150px, 1fr) minmax(160px, 1.1fr) minmax(150px, 1fr) 92px",
  gap: 14,
  alignItems: "center",
  padding: "12px 14px",
  borderTop: "1px solid #27272a",
  fontSize: 13,
};

const monoStyle: CSSProperties = {
  fontFamily: "var(--font-mono), monospace",
};

function ExplorerFrame({ title, eyebrow, actions, children }: { title: ReactNode; eyebrow: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <main style={pageStyle}>
      <div style={shellStyle}>
        <Link href="/dashboard" style={{ color: "#a1a1aa", fontSize: 13, textDecoration: "none" }}>
          Back to dashboard
        </Link>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginTop: 24 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "#71717a", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>{eyebrow}</div>
            <h1 style={{ fontSize: 28, lineHeight: 1.15, margin: "8px 0 0", fontWeight: 750, overflowWrap: "anywhere" }}>{title}</h1>
          </div>
          {actions}
        </div>
        {children}
      </div>
    </main>
  );
}

function FieldGrid({ fields }: { fields: Array<{ label: string; value: ReactNode; sub?: ReactNode }> }) {
  return (
    <section style={{ ...cardStyle, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
      {fields.map((field) => (
        <div key={field.label} style={{ padding: 16, borderRight: "1px solid #27272a", minWidth: 0 }}>
          <div style={{ color: "#71717a", fontSize: 11, marginBottom: 6 }}>{field.label}</div>
          <div style={{ color: "#f4f4f5", fontSize: 14, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis" }}>{field.value}</div>
          {field.sub && <div style={{ color: "#71717a", fontSize: 12, marginTop: 4 }}>{field.sub}</div>}
        </div>
      ))}
    </section>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 14px", color: "#d4d4d8", fontWeight: 700, fontSize: 14 }}>
        <span>{title}</span>
        {typeof count === "number" && <span style={{ color: "#71717a", fontSize: 12, fontWeight: 600 }}>{count}</span>}
      </div>
      {children}
    </section>
  );
}

function EmptySection({ children }: { children: ReactNode }) {
  return <div style={{ padding: 14, color: "#71717a", borderTop: "1px solid #27272a", fontSize: 13 }}>{children}</div>;
}

function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "green" | "red" | "neutral" }) {
  const colors = {
    green: ["rgba(52,211,153,.12)", "#34d399", "rgba(52,211,153,.28)"],
    red: ["rgba(251,113,133,.12)", "#fb7185", "rgba(251,113,133,.28)"],
    neutral: ["rgba(161,161,170,.10)", "#d4d4d8", "#27272a"],
  } as const;
  const [background, color, borderColor] = colors[tone];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", border: `1px solid ${borderColor}`, background, color, borderRadius: 999, padding: "3px 9px", fontSize: 12, fontWeight: 700 }}>
      {children}
    </span>
  );
}

function TransactionTable({ transactions, network, title = "Transactions" }: { transactions: ExplorerTransaction[]; network: string; title?: string }) {
  return (
    <Section title={title} count={transactions.length}>
      <div style={{ ...rowStyle, borderTop: "1px solid #27272a", color: "#71717a", fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>
        <span>Transaction</span>
        <span>Route</span>
        <span>Ledger</span>
        <span>Status</span>
      </div>
      {transactions.map((tx) => (
        <div key={tx.hash} style={rowStyle}>
          <span style={{ minWidth: 0 }}>
            <TxHashLink hash={tx.hash} network={network} />
            <span style={{ display: "block", color: "#71717a", fontSize: 12, marginTop: 3 }}>{tx.method}</span>
          </span>
          <span style={{ minWidth: 0, color: "#a1a1aa" }}>
            <AddressLink address={tx.from} network={network} />
            <span style={{ margin: "0 8px", color: "#52525b" }}>to</span>
            <AddressLink address={tx.to} network={network} />
          </span>
          <span>
            <LedgerLink sequence={tx.ledger} network={network} />
          </span>
          <span style={{ color: tx.status === "success" ? "#34d399" : "#fb7185", fontWeight: 700 }}>{tx.status}</span>
        </div>
      ))}
    </Section>
  );
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatFee(value: string | null | undefined) {
  if (!value) return { primary: "n/a", secondary: null };
  if (/^\d+$/.test(value)) {
    const xlm = Number(value) / 10_000_000;
    return { primary: `${xlm.toFixed(7)} XLM`, secondary: `${value} stroops` };
  }
  return { primary: value, secondary: null };
}

function formatJson(value: JsonValue | undefined) {
  if (value === undefined || value === null) return "null";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function topicLabels(topics: JsonValue) {
  if (!Array.isArray(topics)) return [];
  return topics.map((topic) => {
    if (typeof topic === "string") return topic;
    if (topic && typeof topic === "object" && !Array.isArray(topic) && typeof topic.value === "string") return topic.value;
    return JSON.stringify(topic);
  });
}

function shortMetric(value: number | null | undefined) {
  return typeof value === "number" ? value.toLocaleString() : "n/a";
}

function demoTxDetail(network: string, hash: string): ExplorerTxDetail {
  const tx = findDemoTransaction(hash);
  const [amount = tx.amount, asset = "XLM"] = tx.amount.split(" ");
  return {
    hash: tx.hash,
    network,
    status: tx.status,
    ledger: Number(tx.ledger),
    timestamp: tx.time,
    source_account: tx.from,
    operation_type: tx.method,
    fee_charged: tx.fee,
    sequence_number: "demo-sequence",
    application_order: 0,
    resource_usage: {
      cpu_instructions: 250000,
      memory_bytes: 98304,
      invoke_time_nsecs: 1200000,
      disk_read_bytes: 4096,
      write_bytes: 2048,
      max_rw_key_byte: 128,
      max_rw_data_byte: 512,
    },
    call_tree: tx.contractCalls.map((contract, index) => ({
      id: `demo-call-${index}`,
      parent_id: index === 0 ? null : "demo-call-0",
      contract_id: contract,
      function_name: index === 0 ? tx.method : "transfer",
      args: { from: tx.from, to: tx.to, amount },
      return_value: { ok: true },
      depth: index,
    })),
    state_changes: [],
    events: tx.contractCalls.map((contract, index) => ({
      id: `demo-event-${index}`,
      contract_id: contract,
      topics: [tx.method, asset],
      data: { amount, source: tx.from },
    })),
    fund_flow: [{ id: "demo-flow", from: tx.from, to: tx.to, asset, amount }],
    annotations: [],
    source_map_status: "not_available",
  };
}

function primaryCounterparty(tx: ExplorerTxDetail) {
  const flowTarget = tx.fund_flow.find((edge) => edge.to !== tx.source_account)?.to;
  return flowTarget ?? tx.call_tree[0]?.contract_id ?? tx.events[0]?.contract_id ?? null;
}

function uniqueContracts(tx: ExplorerTxDetail) {
  return Array.from(
    new Set([
      ...tx.call_tree.map((node) => node.contract_id).filter(Boolean),
      ...tx.events.map((event) => event.contract_id).filter(Boolean),
      ...tx.fund_flow.flatMap((edge) => [edge.from, edge.to]).filter(isContractAddress),
    ]),
  );
}

function TraceRow({ node, network }: { node: TxCallTreeNode; network: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "92px minmax(160px, 1fr) minmax(180px, 1.4fr)", gap: 12, padding: "12px 14px", borderTop: "1px solid #27272a", alignItems: "start", fontSize: 13 }}>
      <div style={{ color: "#71717a", ...monoStyle }}>{node.depth === 0 ? "ROOT" : `CALL ${node.depth}`}</div>
      <div style={{ paddingLeft: Math.min(node.depth, 6) * 14, minWidth: 0 }}>
        <ContractLink address={node.contract_id} network={network} />
        <div style={{ color: "#71717a", marginTop: 4 }}>
          {node.parent_id ? <>parent {truncateEntity(node.parent_id, 6, 4)}</> : "entrypoint"}
        </div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: "#f4f4f5", fontWeight: 700 }}>{node.function_name}</div>
        <pre style={{ margin: "6px 0 0", color: "#a1a1aa", fontSize: 12, whiteSpace: "pre-wrap", overflowWrap: "anywhere", ...monoStyle }}>
          {formatJson(node.args)}
        </pre>
        {node.return_value !== undefined && (
          <pre style={{ margin: "6px 0 0", color: "#34d399", fontSize: 12, whiteSpace: "pre-wrap", overflowWrap: "anywhere", ...monoStyle }}>
            =&gt; {formatJson(node.return_value)}
          </pre>
        )}
      </div>
    </div>
  );
}

function FundFlowTable({ tx, network }: { tx: ExplorerTxDetail; network: string }) {
  if (tx.fund_flow.length === 0) return <EmptySection>No asset movement was decoded for this transaction.</EmptySection>;
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(150px, 1fr) minmax(150px, 1fr) 120px 140px", gap: 12, padding: "11px 14px", borderTop: "1px solid #27272a", color: "#71717a", fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>
        <span>From</span>
        <span>To</span>
        <span>Asset</span>
        <span>Amount</span>
      </div>
      {tx.fund_flow.map((edge) => (
        <div key={edge.id} style={{ display: "grid", gridTemplateColumns: "minmax(150px, 1fr) minmax(150px, 1fr) 120px 140px", gap: 12, padding: "12px 14px", borderTop: "1px solid #27272a", fontSize: 13, alignItems: "center" }}>
          <AddressLink address={edge.from} network={network} />
          <AddressLink address={edge.to} network={network} />
          <span style={{ color: "#a1a1aa" }}>{edge.asset}</span>
          <span style={{ color: edge.from === tx.source_account ? "#fb7185" : "#34d399", fontWeight: 700, ...monoStyle }}>{edge.amount}</span>
        </div>
      ))}
    </>
  );
}

function ResourceProfiler({ tx }: { tx: ExplorerTxDetail }) {
  const metrics = [
    ["CPU instructions", shortMetric(tx.resource_usage.cpu_instructions)],
    ["Memory", `${shortMetric(tx.resource_usage.memory_bytes)} bytes`],
    ["Invoke time", `${shortMetric(tx.resource_usage.invoke_time_nsecs)} ns`],
    ["Disk read", `${shortMetric(tx.resource_usage.disk_read_bytes)} bytes`],
    ["Write", `${shortMetric(tx.resource_usage.write_bytes)} bytes`],
    ["Max key", `${shortMetric(tx.resource_usage.max_rw_key_byte)} bytes`],
    ["Max data", `${shortMetric(tx.resource_usage.max_rw_data_byte)} bytes`],
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", borderTop: "1px solid #27272a" }}>
      {metrics.map(([label, value]) => (
        <div key={label} style={{ padding: 14, borderRight: "1px solid #27272a", borderBottom: "1px solid #27272a" }}>
          <div style={{ color: "#71717a", fontSize: 11, marginBottom: 6 }}>{label}</div>
          <div style={{ color: "#f4f4f5", fontSize: 14, fontWeight: 750, ...monoStyle }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

export function LedgerDetailView({ network, sequence }: DetailProps & { sequence: string }) {
  const ledger = findDemoLedger(sequence);
  const transactions = transactionsForLedger(sequence);

  return (
    <ExplorerFrame eyebrow={`${network} ledger`} title={<LedgerLink sequence={sequence} network={network} />}>
      <FieldGrid
        fields={[
          { label: "Transactions", value: ledger.txs },
          { label: "Resource usage", value: `${ledger.gas} (${ledger.pct})` },
          { label: "Gas price", value: `${ledger.gwei} Gwei` },
          { label: "Closed", value: ledger.time },
        ]}
      />
      <TransactionTable transactions={transactions} network={network} title="Transactions in this ledger" />
    </ExplorerFrame>
  );
}

export async function TransactionDetailView({ network, hash }: DetailProps & { hash: string }) {
  const fetched = await getTransactionDetail(network, hash);
  const tx = fetched.data ?? demoTxDetail(network, hash);
  const fee = formatFee(tx.fee_charged);
  const counterparty = primaryCounterparty(tx);
  const contracts = uniqueContracts(tx);
  const firstFlow = tx.fund_flow[0];

  return (
    <ExplorerFrame
      eyebrow={`${network} transaction`}
      title={<TxHashLink hash={tx.hash} network={network} />}
      actions={
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
          <Pill tone={tx.status.toLowerCase() === "success" ? "green" : "red"}>{tx.status}</Pill>
          <Pill>Source map: {tx.source_map_status}</Pill>
        </div>
      }
    >
      {fetched.error && (
        <div style={{ marginTop: 16, border: "1px solid rgba(251,191,36,.35)", background: "rgba(251,191,36,.08)", color: "#fbbf24", borderRadius: 8, padding: 12, fontSize: 13 }}>
          Backend lookup did not return this transaction yet, so this page is showing indexed-demo shape data. Reason: {fetched.error}.
        </div>
      )}

      <FieldGrid
        fields={[
          { label: "Network", value: tx.network },
          { label: "Status", value: <Pill tone={tx.status.toLowerCase() === "success" ? "green" : "red"}>{tx.status}</Pill> },
          { label: "Ledger", value: <LedgerLink sequence={tx.ledger} network={network} /> },
          { label: "Timestamp", value: formatTimestamp(tx.timestamp) },
          { label: "From", value: <AddressLink address={tx.source_account} network={network} /> },
          { label: "To", value: counterparty ? <AddressLink address={counterparty} network={network} /> : "n/a" },
          { label: "Value", value: firstFlow ? `${firstFlow.amount} ${firstFlow.asset}` : "No decoded transfer" },
          { label: "Tx fee", value: fee.primary, sub: fee.secondary },
          { label: "Operation type", value: tx.operation_type },
          { label: "Application order", value: tx.application_order ?? "n/a" },
          { label: "Sequence number", value: tx.sequence_number ?? "n/a" },
        ]}
      />

      <nav style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
        {["Summary", "Contracts", "Events", "State", "Fund Flow", "Resource Profiler"].map((label) => (
          <a key={label} href={`#${label.toLowerCase().replaceAll(" ", "-")}`} style={{ color: "#d4d4d8", border: "1px solid #27272a", borderRadius: 999, padding: "7px 11px", fontSize: 12, textDecoration: "none" }}>
            {label}
          </a>
        ))}
      </nav>

      <div id="summary">
        <Section title="Summary">
          <div style={{ padding: 14, borderTop: "1px solid #27272a", color: "#a1a1aa", fontSize: 13, lineHeight: 1.7 }}>
            This is the Stellar/Soroban transaction view for <TxHashLink hash={tx.hash} network={network} />. It belongs to ledger{" "}
            <LedgerLink sequence={tx.ledger} network={network} /> and was submitted by <AddressLink address={tx.source_account} network={network} />.
            {counterparty && <> The primary counterparty is <AddressLink address={counterparty} network={network} />.</>}
          </div>
        </Section>
      </div>

      <div id="contracts">
        <Section title="Contracts" count={contracts.length}>
          {contracts.length === 0 ? (
            <EmptySection>No Soroban contract references were decoded.</EmptySection>
          ) : (
            contracts.map((contract) => (
              <div key={contract} style={{ padding: "12px 14px", borderTop: "1px solid #27272a", fontSize: 13 }}>
                <ContractLink address={contract} network={network} />
              </div>
            ))
          )}
        </Section>
      </div>

      <div id="events">
        <Section title="Events" count={tx.events.length}>
          {tx.events.length === 0 ? (
            <EmptySection>No contract events were decoded.</EmptySection>
          ) : (
            tx.events.map((event) => (
              <div key={event.id} style={{ padding: "12px 14px", borderTop: "1px solid #27272a", fontSize: 13 }}>
                <div style={{ marginBottom: 8 }}>
                  <ContractLink address={event.contract_id} network={network} />
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                  {topicLabels(event.topics).map((topic, index) => (
                    <Pill key={`${event.id}-${index}`}>{topic}</Pill>
                  ))}
                </div>
                <pre style={{ margin: 0, color: "#a1a1aa", fontSize: 12, whiteSpace: "pre-wrap", overflowWrap: "anywhere", ...monoStyle }}>{formatJson(event.data)}</pre>
              </div>
            ))
          )}
        </Section>
      </div>

      <div id="state">
        <Section title="State" count={tx.state_changes.length}>
          {tx.state_changes.length === 0 ? (
            <EmptySection>No ledger-entry state changes were decoded.</EmptySection>
          ) : (
            tx.state_changes.map((change) => (
              <div key={change.id} style={{ display: "grid", gridTemplateColumns: "minmax(160px, .8fr) minmax(180px, 1fr) minmax(180px, 1fr)", gap: 12, padding: "12px 14px", borderTop: "1px solid #27272a", fontSize: 13 }}>
                <div>
                  <div style={{ color: "#f4f4f5", fontWeight: 700 }}>{change.entry_type}</div>
                  <div style={{ color: "#71717a", marginTop: 4, overflowWrap: "anywhere", ...monoStyle }}>{change.key}</div>
                </div>
                <pre style={{ margin: 0, color: "#fb7185", whiteSpace: "pre-wrap", overflowWrap: "anywhere", ...monoStyle }}>{formatJson(change.before)}</pre>
                <pre style={{ margin: 0, color: "#34d399", whiteSpace: "pre-wrap", overflowWrap: "anywhere", ...monoStyle }}>{formatJson(change.after)}</pre>
              </div>
            ))
          )}
        </Section>
      </div>

      <div id="fund-flow">
        <Section title="Fund Flow" count={tx.fund_flow.length}>
          <FundFlowTable tx={tx} network={network} />
        </Section>
      </div>

      <div id="resource-profiler">
        <Section title="Resource Profiler">
          <ResourceProfiler tx={tx} />
        </Section>
      </div>

      <Section title="Full Trace" count={tx.call_tree.length}>
        {tx.call_tree.length === 0 ? (
          <EmptySection>No Soroban call tree was decoded for this transaction.</EmptySection>
        ) : (
          tx.call_tree.map((node) => <TraceRow key={node.id} node={node} network={network} />)
        )}
      </Section>
    </ExplorerFrame>
  );
}

export function AccountDetailView({ network, address }: DetailProps & { address: string }) {
  const transactions = transactionsForEntity(address);

  return (
    <ExplorerFrame eyebrow={`${network} account`} title={<AddressLink address={address} network={network} />}>
      <FieldGrid
        fields={[
          { label: "Address", value: <AddressLink address={address} network={network} /> },
          { label: "Type", value: isContractAddress(address) ? "Contract" : "Classic account" },
          { label: "Balance", value: "4.82 XLM" },
          { label: "Tracked", value: "Public lookup" },
        ]}
      />
      <TransactionTable transactions={transactions} network={network} title="Account transaction history" />
    </ExplorerFrame>
  );
}

export function ContractDetailView({ network, address }: DetailProps & { address: string }) {
  const transactions = transactionsForEntity(address);
  const eventContracts = [address, DEMO_CONTRACTS.token, DEMO_CONTRACTS.vault].filter((value, index, values) => values.indexOf(value) === index);

  return (
    <ExplorerFrame eyebrow={`${network} contract`} title={<ContractLink address={address} network={network} />}>
      <FieldGrid
        fields={[
          { label: "Contract", value: <ContractLink address={address} network={network} /> },
          { label: "Verification", value: address === DEMO_CONTRACTS.token ? "Verified" : "Not available" },
          { label: "Wasm hash", value: truncateEntity(`wasm-${address}`) },
          { label: "Tracked", value: "Public lookup" },
        ]}
      />
      <TransactionTable transactions={transactions} network={network} title="Contract transactions" />

      <Section title="Events and contract references" count={eventContracts.length}>
        {eventContracts.map((contract, index) => (
          <div key={contract} style={{ padding: "12px 14px", borderTop: "1px solid #27272a", color: "#a1a1aa", fontSize: 13 }}>
            event[{index}].contract = <ContractLink address={contract} network={network} />
          </div>
        ))}
      </Section>
    </ExplorerFrame>
  );
}
