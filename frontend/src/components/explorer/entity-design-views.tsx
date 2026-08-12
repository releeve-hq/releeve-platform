"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Bell,
  Box,
  Check,
  Copy,
  FileCode2,
  Globe2,
  Play,
  Share2,
} from "lucide-react";
import { GlobalExplorerSearch } from "@/components/explorer/global-explorer-search";
import {
  getContractEvents,
  getContractTransactions,
  getLedgerTransactions,
  type ExplorerAccountTransaction,
  type ExplorerContractDetail,
  type ExplorerContractEvent,
  type ExplorerLedgerDetail,
  type ExplorerPagedEnvelope,
} from "@/lib/explorer-api";
import {
  addressRoute,
  explorerRoutes,
  stellarExpertRoute,
  truncateEntity,
} from "@/lib/explorer-routes";

function formatTime(value?: string | null) {
  if (!value) return "Not indexed";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function ExplorerEntityShell({
  network,
  kind,
  value,
  children,
}: {
  network: string;
  kind: "ledger" | "contract";
  value: string | number;
  children: React.ReactNode;
}) {
  const share = async () =>
    navigator.share
      ? navigator.share({ title: `Releeve ${kind}`, url: window.location.href })
      : navigator.clipboard.writeText(window.location.href);
  return (
    <main className="entity-root">
      <header className="entity-top">
        <Link href="/home">
          <ArrowLeft /> Back to project
        </Link>
        <div className="entity-search">
          <GlobalExplorerSearch network={network} compact />
        </div>
        <div className="entity-actions">
          <button type="button" onClick={() => void share()}>
            <Share2 /> Share
          </button>
          <a
            href={stellarExpertRoute(network, kind, value)}
            target="_blank"
            rel="noreferrer"
            title="View in explorer"
            aria-label="View in explorer"
          >
            <Globe2 />
          </a>
        </div>
      </header>
      {children}
      <EntityStyles />
    </main>
  );
}

function EntityStyles() {
  return (
    <style>{`
    .entity-root{--bg:#1d1918;--panel:#262221;--border:#4a423c;--text:#f2efec;--dim:#9b9490;--faint:#716a66;--green:#2fa84f;--signal:#a3ff5f;min-height:100dvh;background:var(--bg);color:var(--text);font-family:var(--font-inter),system-ui,sans-serif;font-size:13px}.entity-root *{box-sizing:border-box}.entity-root a{color:inherit;text-decoration:none}.entity-top{height:65px;display:flex;align-items:center;gap:18px;padding:0 28px;border-bottom:1px solid var(--border)}.entity-top>a{display:flex;align-items:center;gap:8px;font-weight:600;white-space:nowrap}.entity-top svg{width:14px;height:14px}.entity-search{width:min(520px,100%);margin:auto}.entity-actions{display:flex;align-items:center;gap:13px}.entity-actions button,.entity-actions a{display:flex;align-items:center;gap:6px;border:0;background:transparent;color:var(--dim);font:inherit;font-size:12px;cursor:pointer}.entity-subhead{min-height:65px;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:12px 28px;border-bottom:1px solid var(--border)}.entity-title{display:flex;align-items:center;gap:9px;min-width:0}.entity-title>span:first-child{color:var(--dim);font-size:15px}.entity-title h1{margin:0;font:600 13px var(--font-mono),monospace;overflow:hidden;text-overflow:ellipsis}.entity-buttons{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.entity-button{height:34px;display:inline-flex;align-items:center;gap:6px;padding:0 11px;border:1px solid var(--border);border-radius:6px;background:var(--panel);color:var(--text);font:600 11px inherit;cursor:pointer}.entity-button.primary{background:#6e56cf;border-color:#6e56cf}.entity-button svg{width:13px}.entity-page{max-width:1400px;margin:auto;padding:25px 28px 60px}.entity-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 58px}.entity-field{display:grid;grid-template-columns:145px minmax(0,1fr);gap:15px;align-items:baseline;padding:7px 0}.entity-field dt{color:var(--faint);font-size:12px}.entity-field dd{min-width:0;margin:0;overflow-wrap:anywhere}.entity-field code{font:11px var(--font-mono),monospace}.entity-field a{text-decoration:underline;text-decoration-color:var(--border);text-underline-offset:3px}.entity-tabs{display:flex;gap:5px;margin-top:25px;padding-top:18px;border-bottom:1px solid var(--border)}.entity-tabs button{height:38px;padding:0 14px;border:1px solid transparent;border-bottom:0;border-radius:6px 6px 0 0;background:transparent;color:var(--dim);font:inherit;font-size:11.5px;cursor:pointer}.entity-tabs button.active{border-color:var(--border);background:var(--bg);color:var(--text);font-weight:700;margin-bottom:-1px}.entity-table-wrap{margin-top:18px;border:1px solid var(--border);border-radius:7px;overflow:auto}.entity-table-head{min-height:47px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 12px;background:var(--panel);border-bottom:1px solid var(--border)}.entity-table-head h2{margin:0;font-size:12.5px}.entity-table-head input,.entity-table-head select{height:30px;border:1px solid var(--border);border-radius:5px;background:var(--bg);color:var(--text);padding:0 8px;font:inherit;font-size:10.5px}.entity-table{width:100%;min-width:850px;border-collapse:collapse}.entity-table th,.entity-table td{text-align:left;padding:11px 13px;border-bottom:1px solid var(--border);font-size:11px}.entity-table th{color:var(--faint);font-size:9.5px}.entity-table td{color:var(--dim)}.entity-table tr:last-child td{border-bottom:0}.entity-table code{font:10.5px var(--font-mono),monospace}.entity-table a{text-decoration:underline;text-decoration-color:var(--border)}.status-ok{color:var(--green)}.entity-empty{padding:28px 14px;color:var(--faint);font-size:11.5px}.entity-pagination{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:12px}.entity-pagination button,.entity-pagination select{height:30px;border:1px solid var(--border);border-radius:5px;background:var(--panel);color:var(--text);font:inherit;font-size:10px;padding:0 8px}.entity-pagination button:disabled{opacity:.4}.verify-banner{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:22px;padding:12px 14px;border:1px solid #536c48;border-radius:6px;background:#22291f}.verify-banner>div{display:flex;align-items:center;gap:10px}.verify-banner svg{width:17px;color:var(--signal)}.verify-banner strong,.verify-banner span{display:block}.verify-banner strong{font-size:11.5px}.verify-banner span{margin-top:3px;color:var(--dim);font-size:10px}.json-cell{max-width:460px;max-height:170px;overflow:auto;white-space:pre-wrap;font:10px/1.5 var(--font-mono),monospace}@media(max-width:760px){.entity-top{height:auto;min-height:65px;align-items:flex-start;flex-wrap:wrap;padding:14px}.entity-search{order:3;flex-basis:100%}.entity-actions{margin-left:auto}.entity-subhead{align-items:flex-start;flex-direction:column;padding:14px}.entity-page{padding:20px 14px 45px}.entity-grid{grid-template-columns:1fr}.entity-field{grid-template-columns:112px minmax(0,1fr)}.entity-tabs{overflow-x:auto}.verify-banner{align-items:flex-start;flex-direction:column}}
  `}</style>
  );
}

function TransactionTable({
  rows,
  network,
  loading,
}: {
  rows: ExplorerAccountTransaction[];
  network: string;
  loading: boolean;
}) {
  return (
    <table className="entity-table">
      <thead>
        <tr>
          <th>Transaction hash</th>
          <th>Source</th>
          <th>Target</th>
          <th>Operation</th>
          <th>Ledger</th>
          <th>Status</th>
          <th>Closed</th>
        </tr>
      </thead>
      <tbody>
        {loading ? (
          <tr>
            <td colSpan={7}>Loading transactions...</td>
          </tr>
        ) : rows.length ? (
          rows.map((tx) => (
            <tr key={tx.hash}>
              <td>
                <Link href={explorerRoutes.tx(network, tx.hash)}>
                  <code>{truncateEntity(tx.hash, 8, 6)}</code>
                </Link>
              </td>
              <td>
                <Link href={addressRoute(network, tx.source_account)}>
                  <code>{truncateEntity(tx.source_account, 6, 5)}</code>
                </Link>
              </td>
              <td>
                {tx.destination_account ? (
                  <Link href={addressRoute(network, tx.destination_account)}>
                    <code>{truncateEntity(tx.destination_account, 6, 5)}</code>
                  </Link>
                ) : (
                  "No transfer"
                )}
              </td>
              <td>{tx.call_trace?.root_function ?? tx.operation_type}</td>
              <td>{tx.ledger_sequence ?? tx.ledger ?? "Not indexed"}</td>
              <td className={tx.status === "success" ? "status-ok" : ""}>
                {tx.status}
              </td>
              <td>{formatTime(tx.timestamp)}</td>
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={7}>No transactions are indexed for this entity.</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function usePagedTransactions(
  loader: (
    limit: number,
    cursor: string | null,
  ) => ReturnType<typeof getLedgerTransactions>,
) {
  const [limit, setLimit] = useState(20);
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [page, setPage] =
    useState<ExplorerPagedEnvelope<ExplorerAccountTransaction> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void loader(limit, cursor).then((result) => {
      if (!active) return;
      setPage(result.data);
      setError(result.error);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [cursor, limit, loader]);
  const next = () => {
    const value = page?.pagination.next_cursor;
    if (!value) return;
    setHistory((items) => [...items, cursor ?? ""]);
    setCursor(value);
  };
  const back = () =>
    setHistory((items) => {
      const previous = items.at(-1) ?? "";
      setCursor(previous || null);
      return items.slice(0, -1);
    });
  const changeLimit = (value: number) => {
    setLimit(value);
    setCursor(null);
    setHistory([]);
  };
  return {
    limit,
    page,
    loading,
    error,
    next,
    back,
    changeLimit,
    canBack: history.length > 0,
    pageNumber: history.length + 1,
  };
}

export function LedgerExplorerDesign({
  ledger,
  network,
}: {
  ledger: ExplorerLedgerDetail;
  network: string;
}) {
  const [tab, setTab] = useState<"transactions" | "overview">("transactions");
  const loader = useState(
    () => (limit: number, cursor: string | null) =>
      getLedgerTransactions(network, ledger.sequence, limit, cursor),
  )[0];
  const paging = usePagedTransactions(loader);
  return (
    <ExplorerEntityShell
      network={network}
      kind="ledger"
      value={ledger.sequence}
    >
      <section className="entity-subhead">
        <div className="entity-title">
          <span>Ledger</span>
          <h1>#{ledger.sequence.toLocaleString()}</h1>
        </div>
        <div className="entity-buttons">
          <Link
            className="entity-button"
            href={explorerRoutes.ledger(network, ledger.sequence - 1)}
          >
            Previous
          </Link>
          <Link
            className="entity-button"
            href={explorerRoutes.ledger(network, ledger.sequence + 1)}
          >
            Next
          </Link>
          <Link
            className="entity-button primary"
            href={`/simulator?ledger=${ledger.sequence}&network=${encodeURIComponent(network)}`}
          >
            <Play /> Simulate from ledger
          </Link>
        </div>
      </section>
      <div className="entity-page">
        <dl className="entity-grid">
          <EntityField label="Ledger hash">
            <code>{ledger.hash}</code>
          </EntityField>
          <EntityField label="Previous hash">
            {ledger.parent_hash ? (
              <code>{ledger.parent_hash}</code>
            ) : (
              "Not reported"
            )}
          </EntityField>
          <EntityField label="Closed at">
            {formatTime(ledger.timestamp)}
          </EntityField>
          <EntityField label="Transactions">
            {ledger.transaction_count ?? "Not indexed"}
          </EntityField>
          <EntityField label="Ledger size">
            {ledger.size_bytes
              ? `${ledger.size_bytes.toLocaleString()} bytes`
              : "Not reported"}
          </EntityField>
          <EntityField label="Base operation fee">
            {ledger.base_operation_fee
              ? `${ledger.base_operation_fee} stroops`
              : "Not reported"}
          </EntityField>
          <EntityField label="Base reserve">
            {ledger.base_reserve
              ? `${ledger.base_reserve} XLM`
              : "Not reported"}
          </EntityField>
          <EntityField label="CPU usage">
            {ledger.aggregate_resource_usage.total_cpu_instructions?.toLocaleString() ??
              "Not reported"}
          </EntityField>
        </dl>
        <div className="entity-tabs">
          <button
            className={tab === "transactions" ? "active" : ""}
            onClick={() => setTab("transactions")}
          >
            Transactions
          </button>
          <button
            className={tab === "overview" ? "active" : ""}
            onClick={() => setTab("overview")}
          >
            Overview
          </button>
        </div>
        {tab === "transactions" ? (
          <>
            <div className="entity-table-wrap">
              <div className="entity-table-head">
                <h2>Transactions in ledger</h2>
              </div>
              {paging.error ? (
                <div className="entity-empty">{paging.error}</div>
              ) : (
                <TransactionTable
                  rows={paging.page?.data ?? []}
                  network={network}
                  loading={paging.loading}
                />
              )}
            </div>
            <Paging paging={paging} />
          </>
        ) : (
          <div className="entity-table-wrap">
            <div className="entity-table-head">
              <h2>Aggregate resource data</h2>
            </div>
            <pre
              className="json-cell"
              style={{ maxWidth: "none", padding: 16 }}
            >
              {JSON.stringify(ledger.aggregate_resource_usage, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </ExplorerEntityShell>
  );
}

function EntityField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="entity-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

type Paging = ReturnType<typeof usePagedTransactions>;
function Paging({ paging }: { paging: Paging }) {
  return (
    <div className="entity-pagination">
      <select
        value={paging.limit}
        onChange={(event) => paging.changeLimit(Number(event.target.value))}
        aria-label="Rows per page"
      >
        {[20, 50, 100].map((limit) => (
          <option key={limit} value={limit}>
            {limit} per page
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!paging.canBack || paging.loading}
        onClick={paging.back}
      >
        Back
      </button>
      <span>{paging.pageNumber}</span>
      <button
        type="button"
        disabled={!paging.page?.pagination.next_cursor || paging.loading}
        onClick={paging.next}
      >
        Next
      </button>
    </div>
  );
}

export function ContractExplorerDesign({
  contract,
  network,
  address,
}: {
  contract: ExplorerContractDetail;
  network: string;
  address: string;
}) {
  const [tab, setTab] = useState<"transactions" | "events" | "overview">(
    "transactions",
  );
  const txLoader = useState(
    () => (limit: number, cursor: string | null) =>
      getContractTransactions(network, address, limit, cursor),
  )[0];
  const paging = usePagedTransactions(txLoader);
  const [events, setEvents] = useState<ExplorerContractEvent[]>([]);
  const [eventsError, setEventsError] = useState<string | null>(null);
  useEffect(() => {
    if (tab !== "events") return;
    let active = true;
    void getContractEvents(network, address, 20).then((result) => {
      if (!active) return;
      setEvents(result.data?.data ?? []);
      setEventsError(result.error);
    });
    return () => {
      active = false;
    };
  }, [address, network, tab]);
  return (
    <ExplorerEntityShell network={network} kind="contract" value={address}>
      <section className="entity-subhead">
        <div className="entity-title">
          <span>Contract</span>
          <h1>{address}</h1>
          <button
            className="entity-button"
            type="button"
            aria-label="Copy contract address"
            onClick={() => void navigator.clipboard.writeText(address)}
          >
            <Copy />
          </button>
        </div>
        <div className="entity-buttons">
          <Link
            className="entity-button"
            href={`/alerts?contract=${encodeURIComponent(address)}`}
          >
            <Bell /> Create alert
          </Link>
          <Link
            className="entity-button primary"
            href={`/simulator?contract=${encodeURIComponent(address)}`}
          >
            <Play /> Simulate
          </Link>
        </div>
      </section>
      <div className="entity-page">
        <div className="verify-banner">
          <div>
            {contract.verification.status === "verified" ? (
              <Check />
            ) : (
              <FileCode2 />
            )}
            <div>
              <strong>
                {contract.verification.status === "verified"
                  ? "Verified build"
                  : "Source verification is not available"}
              </strong>
              <span>
                {contract.verification.status === "verified"
                  ? "Build metadata and source mappings are available."
                  : "Decoded calls, events, state, and resources remain available without source verification."}
              </span>
            </div>
          </div>
          {contract.verification.status !== "verified" && (
            <Link
              className="entity-button"
              href={`/docs/simulations#contract-verification`}
            >
              Verification details
            </Link>
          )}
        </div>
        <dl className="entity-grid">
          <EntityField label="Contract address">
            <code>{address}</code>
          </EntityField>
          <EntityField label="Network">{network}</EntityField>
          <EntityField label="Type">{contract.type}</EntityField>
          <EntityField label="WASM hash">
            {contract.current_wasm_hash ? (
              <code>{contract.current_wasm_hash}</code>
            ) : (
              "Not indexed"
            )}
          </EntityField>
          <EntityField label="Verification">
            {contract.verification.status}
          </EntityField>
          <EntityField label="Project tracking">
            {contract.tracked ? "Tracked" : "Public lookup"}
          </EntityField>
          <EntityField label="Rust version">
            {contract.toolchain.rust_version ?? "Not attested"}
          </EntityField>
          <EntityField label="Soroban SDK">
            {contract.toolchain.soroban_sdk_version ?? "Not attested"}
          </EntityField>
          <EntityField label="Debug symbols">
            {contract.toolchain.debug_symbols_present
              ? "Present"
              : "Not supplied"}
          </EntityField>
          <EntityField label="Optimization">
            {contract.toolchain.opt_level ?? "Not attested"}
          </EntityField>
        </dl>
        <div className="entity-tabs">
          <button
            className={tab === "transactions" ? "active" : ""}
            onClick={() => setTab("transactions")}
          >
            Transactions
          </button>
          <button
            className={tab === "events" ? "active" : ""}
            onClick={() => setTab("events")}
          >
            Events
          </button>
          <button
            className={tab === "overview" ? "active" : ""}
            onClick={() => setTab("overview")}
          >
            Build metadata
          </button>
        </div>
        {tab === "transactions" ? (
          <>
            <div className="entity-table-wrap">
              <div className="entity-table-head">
                <h2>Contract transactions</h2>
              </div>
              {paging.error ? (
                <div className="entity-empty">{paging.error}</div>
              ) : (
                <TransactionTable
                  rows={paging.page?.data ?? []}
                  network={network}
                  loading={paging.loading}
                />
              )}
            </div>
            <Paging paging={paging} />
          </>
        ) : tab === "events" ? (
          <div className="entity-table-wrap">
            <div className="entity-table-head">
              <h2>Decoded events</h2>
            </div>
            {eventsError ? (
              <div className="entity-empty">{eventsError}</div>
            ) : (
              <table className="entity-table">
                <thead>
                  <tr>
                    <th>Ledger</th>
                    <th>Transaction</th>
                    <th>Type</th>
                    <th>Topics and data</th>
                    <th>Closed</th>
                  </tr>
                </thead>
                <tbody>
                  {events.length ? (
                    events.map((event) => (
                      <tr key={event.id}>
                        <td>{event.ledger}</td>
                        <td>
                          <Link
                            href={explorerRoutes.tx(network, event.tx_hash)}
                          >
                            <code>{truncateEntity(event.tx_hash)}</code>
                          </Link>
                        </td>
                        <td>{event.event_type}</td>
                        <td>
                          <pre className="json-cell">
                            {JSON.stringify(
                              { topics: event.topics, data: event.data },
                              null,
                              2,
                            )}
                          </pre>
                        </td>
                        <td>{formatTime(event.timestamp)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5}>No contract events are indexed.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <div className="entity-table-wrap">
            <div className="entity-table-head">
              <h2>Build metadata</h2>
            </div>
            <pre
              className="json-cell"
              style={{ maxWidth: "none", padding: 16 }}
            >
              {JSON.stringify(contract.toolchain, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </ExplorerEntityShell>
  );
}
