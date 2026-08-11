"use client";

import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  AlarmClock,
  ArrowLeft,
  Bell,
  Blocks,
  Box,
  Braces,
  Bug,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Code2,
  Copy,
  Database,
  FileCode2,
  History,
  KeyRound,
  Layers3,
  ListFilter,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserRound,
  Wallet,
  X,
  Zap,
} from "lucide-react";

import { api } from "@/lib/api";
import { getRecentLedgers } from "@/lib/explorer-api";
import { truncateEntity } from "@/lib/explorer-routes";

import "./project-workflows.css";

export type ProjectScope = {
  organization: string | null;
  project: string | null;
  network: "mainnet" | "testnet" | "futurenet";
};

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
  address: string;
  network: string;
  last_synced_at?: string | null;
};

type Environment = {
  id: string;
  name: string;
  network: string;
  protocol: number;
  base_ledger_sequence: number;
  sync_status: string;
  sync_enabled: boolean;
};

type Simulation = {
  id: string;
  status: string;
  function_name: string;
  base_ledger_sequence: number;
  created_at: string;
  completed_at?: string | null;
  fork_core_summary?: unknown;
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

function scopePath(scope: ProjectScope, path: string) {
  if (!scope.organization || !scope.project) return null;
  return `/api/v1/${encodeURIComponent(scope.organization)}/${encodeURIComponent(scope.project)}${path}`;
}

function cursorValue<T>(page: CursorPage<T>, direction: "next" | "prev") {
  return page.pagination?.[`${direction}_cursor`] ?? page[`${direction}_cursor`] ?? null;
}

function timeLabel(value?: string | null) {
  if (!value) return "Not synced";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not synced";
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)} hr ago`;
  return `${Math.floor(minutes / 1_440)} days ago`;
}

function errorMessage(cause: unknown, fallback: string) {
  if (cause instanceof Error) console.error(cause);
  return fallback;
}

function Header({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return <div className="pw-header"><div><h1>{title}</h1><p>{description}</p></div>{actions && <div className="pw-actions">{actions}</div>}</div>;
}

function Button({ children, primary, danger, iconOnly, className = "", type, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; danger?: boolean; iconOnly?: boolean }) {
  return <button type={type ?? (primary && !props.onClick ? "submit" : "button")} className={`pw-button ${primary ? "pw-button-primary" : ""} ${danger ? "pw-button-danger" : ""} ${iconOnly ? "pw-icon-button" : ""} ${className}`} {...props}>{children}</button>;
}

function Message({ children, error }: { children: ReactNode; error?: boolean }) {
  return <div className={`pw-message ${error ? "pw-message-error" : ""}`}>{children}</div>;
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const color = ["healthy", "success", "enabled", "syncing"].includes(normalized) ? "var(--green)" : ["failed", "error", "degraded"].includes(normalized) ? "var(--red)" : "var(--text-dim)";
  return <span className="pw-badge" style={{ color }}><span className="pw-badge-dot" />{status}</span>;
}

function Modal({ title, children, onClose, footer }: { title: string; children: ReactNode; onClose: () => void; footer: ReactNode }) {
  return <div className="pw-modal-backdrop" role="presentation" onMouseDown={onClose}><div className="pw-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}><div className="pw-modal-head"><strong>{title}</strong><Button iconOnly aria-label="Close" onClick={onClose}><X size={16} /></Button></div><div className="pw-modal-body">{children}</div><div className="pw-modal-foot">{footer}</div></div></div>;
}

function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return <div className="pw-empty"><div className="pw-empty-inner"><span className="pw-empty-icon">{icon}</span><h2>{title}</h2><p>{body}</p>{action}</div></div>;
}

function Pagination({ page, onPage }: { page: CursorPage<unknown>; onPage: (cursor: string | null) => void }) {
  const previous = cursorValue(page, "prev");
  const next = cursorValue(page, "next");
  if (!previous && !next) return null;
  return <div className="pw-actions" style={{ justifyContent: "flex-end", marginTop: 10 }}><Button disabled={!previous} onClick={() => onPage(previous)}><ArrowLeft size={14} /> Back</Button><Button disabled={!next} onClick={() => onPage(next)}>Next <ChevronRight size={14} /></Button></div>;
}

function CatalogToolbar({ query, setQuery, placeholder, onAdd, addLabel }: { query: string; setQuery: (value: string) => void; placeholder: string; onAdd: () => void; addLabel: string }) {
  return <div className="pw-toolbar"><div className="pw-search"><Search size={15} /><input className="pw-field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} /></div><div className="pw-actions"><Button aria-label="Filters"><ListFilter size={15} /> Filters</Button><Button primary onClick={onAdd}><Plus size={15} /> {addLabel}</Button></div></div>;
}

function TxRows({ page, network, onOpen }: { page: CursorPage<ProjectTransaction>; network: string; onOpen: (hash: string) => void }) {
  if (!page.data.length) return <EmptyState icon={<History size={22} />} title="No activity yet" body="Transactions involving this entity will appear here as they are indexed." />;
  return <div className="pw-table"><div className="pw-row pw-row-header" style={{ gridTemplateColumns: "minmax(210px, 1fr) 130px 110px 120px 120px" }}><span>Transaction</span><span>Operation</span><span>Status</span><span>Ledger</span><span>Time</span></div>{page.data.map((transaction, index) => { const hash = transaction.hash || transaction.tx_hash || ""; return <button key={hash || index} className="pw-row" style={{ gridTemplateColumns: "minmax(210px, 1fr) 130px 110px 120px 120px" }} onClick={() => hash && onOpen(hash)}><span className="pw-mono">{truncateEntity(hash || "Unavailable", 12, 9)}</span><span>{transaction.operation_type || "Invocation"}</span><StatusBadge status={transaction.status || "unknown"} /><span>{transaction.ledger_sequence?.toLocaleString() || "-"}</span><span>{timeLabel(transaction.timestamp)}</span></button>; })}</div>;
}

export function WalletsPage({ scope }: { scope: ProjectScope }) {
  const router = useRouter();
  const [page, setPage] = useState<CursorPage<TrackedEntity>>({ data: [] });
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [transactions, setTransactions] = useState<CursorPage<ProjectTransaction>>({ data: [] });
  const [tab, setTab] = useState<"overview" | "transactions" | "assets">("overview");
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (cursor: string | null = null) => {
    const path = scopePath(scope, `/accounts?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    if (!path) return;
    try { setPage(await api.get<CursorPage<TrackedEntity>>(path)); setError(null); } catch (cause) { setError(errorMessage(cause, "Could not load wallets.")); }
  }, [scope]);
  useEffect(() => { void load(); }, [load]);

  const track = async (event: FormEvent) => {
    event.preventDefault();
    const path = scopePath(scope, "/accounts");
    if (!path || !address.trim()) return;
    setLoading(true);
    try { await api.post(path, { address: address.trim(), tags: [] }); setAddress(""); setShowAdd(false); setError(null); await load(); } catch (cause) { setError(errorMessage(cause, "Could not add this wallet.")); } finally { setLoading(false); }
  };

  const openWallet = async (value: string) => {
    const base = scopePath(scope, `/accounts/${encodeURIComponent(value)}`);
    if (!base) return;
    setLoading(true);
    try {
      const [summary, txPage] = await Promise.all([api.get<Record<string, unknown>>(base), api.get<CursorPage<ProjectTransaction>>(`${base}/transactions?limit=20`)]);
      setSelected(summary); setTransactions(txPage); setTab("overview"); setError(null);
    } catch (cause) { setError(errorMessage(cause, "Could not open this wallet.")); } finally { setLoading(false); }
  };

  const visible = page.data.filter((entity) => !query.trim() || entity.address.toLowerCase().includes(query.trim().toLowerCase()));
  const selectedAddress = selected ? String(selected.address) : "";
  const holdings = Array.isArray(selected?.token_holdings) ? selected.token_holdings as Array<Record<string, unknown>> : [];

  if (selected) return <div className="pw-page"><div className="pw-detail-head"><div className="pw-inline"><Button iconOnly aria-label="Back to wallets" onClick={() => setSelected(null)}><ArrowLeft size={16} /></Button><div className="pw-detail-title"><p>Wallet</p><h1 className="pw-mono">{selectedAddress}</h1><p>{scope.network} / shared project address book</p></div></div><div className="pw-actions"><Button onClick={() => navigator.clipboard.writeText(selectedAddress)}><Copy size={14} /> Copy</Button><Button onClick={() => router.push(`/explorer/${scope.network}/account/${encodeURIComponent(selectedAddress)}`)}>Explorer</Button><Button primary onClick={() => router.push(`/simulator?impersonate=${encodeURIComponent(selectedAddress)}`)}><Play size={14} /> Simulate as wallet</Button></div></div><div className="pw-surface"><div className="pw-stats"><div className="pw-stat"><span>XLM balance</span><strong>{String(selected.xlm_balance ?? "Unavailable")}</strong></div><div className="pw-stat"><span>Assets</span><strong>{holdings.length}</strong></div><div className="pw-stat"><span>Network</span><strong>{String(selected.network ?? scope.network)}</strong></div><div className="pw-stat"><span>Project tracking</span><strong>{selected.tracked ? "Tracked" : "Not tracked"}</strong></div></div><div className="pw-tabs"><button data-active={tab === "overview"} onClick={() => setTab("overview")}>Overview</button><button data-active={tab === "transactions"} onClick={() => setTab("transactions")}>Transactions</button><button data-active={tab === "assets"} onClick={() => setTab("assets")}>Assets</button></div>{tab === "overview" && <div className="pw-panel-body"><div className="pw-kv"><span>Account ID</span><span className="pw-mono">{selectedAddress}</span><span>Network</span><span>{String(selected.network ?? scope.network)}</span><span>Source map</span><span>{String(selected.source_map_status ?? "not available")}</span><span>Last indexed activity</span><span>{transactions.data[0] ? timeLabel(transactions.data[0].timestamp) : "No indexed activity"}</span></div></div>}{tab === "transactions" && <><TxRows page={transactions} network={scope.network} onOpen={(hash) => router.push(`/explorer/${scope.network}/transaction/${encodeURIComponent(hash)}`)} /><Pagination page={transactions} onPage={async (cursor) => { const path = scopePath(scope, `/accounts/${encodeURIComponent(selectedAddress)}/transactions?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`); if (path) setTransactions(await api.get(path)); }} /></>}{tab === "assets" && <div className="pw-table">{holdings.length ? holdings.map((holding, index) => <div className="pw-row" style={{ gridTemplateColumns: "minmax(160px, 1fr) 180px 180px" }} key={index}><span className="pw-mono">{String(holding.asset ?? "XLM")}</span><span>{String(holding.balance ?? "Unavailable")}</span><span>{holding.usd_value ? `$${String(holding.usd_value)}` : "No price"}</span></div>) : <EmptyState icon={<CircleDollarSign size={22} />} title="No indexed balances" body="Asset balances will appear after this account has been observed by the indexer." />}</div>}</div></div>;

  return <div className="pw-page"><Header title="Wallets" description="A project-wide catalog for Stellar accounts, treasuries, issuers, signers, and test identities." />{error && <Message error>{error}</Message>}<div className="pw-surface"><CatalogToolbar query={query} setQuery={setQuery} placeholder="Search Stellar account IDs" onAdd={() => setShowAdd(true)} addLabel="Add wallet" />{loading && !page.data.length ? <EmptyState icon={<LoaderCircle className="animate-spin" size={22} />} title="Loading wallets" body="Fetching the project address book." /> : !scope.project ? <EmptyState icon={<Wallet size={22} />} title="Select a project" body="Wallet catalogs are scoped to a Releeve project." /> : !visible.length ? <EmptyState icon={<Wallet size={22} />} title={query ? "No matching wallets" : "No wallets yet"} body={query ? "Try another account ID." : "Add an account to share it with everyone in this project."} action={!query ? <Button primary onClick={() => setShowAdd(true)}><Plus size={15} /> Add wallet</Button> : undefined} /> : <div className="pw-table"><div className="pw-row pw-row-header" style={{ gridTemplateColumns: "minmax(240px, 1fr) 140px 150px 40px" }}><span>Account</span><span>Network</span><span>Last synced</span><span /></div>{visible.map((entity) => <button className="pw-row" style={{ gridTemplateColumns: "minmax(240px, 1fr) 140px 150px 40px" }} key={entity.address} onClick={() => void openWallet(entity.address)}><span className="pw-mono">{truncateEntity(entity.address, 15, 11)}</span><span>{entity.network || scope.network}</span><span>{timeLabel(entity.last_synced_at)}</span><ChevronRight size={15} /></button>)}</div>}</div><Pagination page={page} onPage={load} />{showAdd && <Modal title="Add wallet" onClose={() => setShowAdd(false)} footer={<><Button onClick={() => setShowAdd(false)}>Cancel</Button><Button primary disabled={loading || !address.trim()} onClick={() => document.getElementById("add-wallet-form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))}>{loading ? <LoaderCircle size={14} /> : <Plus size={14} />} Add wallet</Button></>}><form id="add-wallet-form" onSubmit={track}><label className="pw-label">Stellar account ID<input autoFocus className="pw-field pw-mono" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="G..." /></label></form><Message>The account is saved only in this project. Releeve never stores its secret key.</Message></Modal>}</div>;
}

function hasContractDetail(value: unknown): boolean {
  return value !== null && value !== undefined;
}

export function ContractsPage({ scope }: { scope: ProjectScope }) {
  const router = useRouter();
  const [page, setPage] = useState<CursorPage<TrackedEntity>>({ data: [] });
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [transactions, setTransactions] = useState<CursorPage<ProjectTransaction>>({ data: [] });
  const [events, setEvents] = useState<CursorPage<ContractEvent>>({ data: [] });
  const [source, setSource] = useState<Record<string, unknown> | null>(null);
  const [verifications, setVerifications] = useState<CursorPage<Record<string, any>>>({ data: [] });
  const [tab, setTab] = useState<"overview" | "transactions" | "events" | "source" | "verification">("overview");
  const [sourceKind, setSourceKind] = useState<"github" | "archive">("github");
  const [repository, setRepository] = useState("");
  const [commit, setCommit] = useState("");
  const [packagePath, setPackagePath] = useState(".");
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [uploadId, setUploadId] = useState("");
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (cursor: string | null = null) => {
    const path = scopePath(scope, `/contracts?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    if (!path) return;
    try { setPage(await api.get(path)); setError(null); } catch (cause) { setError(errorMessage(cause, "Could not load contracts.")); }
  }, [scope]);
  useEffect(() => { void load(); }, [load]);

  const track = async (event: FormEvent) => {
    event.preventDefault();
    const path = scopePath(scope, "/contracts");
    if (!path || !address.trim()) return;
    setLoading(true);
    try { await api.post(path, { address: address.trim(), tags: [] }); setAddress(""); setShowAdd(false); setError(null); await load(); } catch (cause) { setError(errorMessage(cause, "Could not add this contract.")); } finally { setLoading(false); }
  };

  const openContract = async (value: string) => {
    const base = scopePath(scope, `/contracts/${encodeURIComponent(value)}`);
    if (!base) return;
    setLoading(true);
    try {
      const [summary, txResult, eventResult, sourceResult, verificationResult] = await Promise.all([
        api.get<Record<string, unknown>>(base),
        api.get<CursorPage<ProjectTransaction>>(`${base}/transactions?limit=20`).catch(() => ({ data: [] })),
        api.get<CursorPage<ContractEvent>>(`${base}/events?limit=20`).catch(() => ({ data: [] })),
        api.get<Record<string, unknown>>(`${base}/source`).catch(() => null),
        api.get<CursorPage<Record<string, any>>>(`${base}/verifications?limit=20`).catch(() => ({ data: [] })),
      ]);
      setSelected(summary); setTransactions(txResult); setEvents(eventResult); setSource(sourceResult); setVerifications(verificationResult); setTab("overview"); setError(null);
    } catch (cause) { setError(errorMessage(cause, "Could not open this contract.")); } finally { setLoading(false); }
  };

  const visible = page.data.filter((entity) => !query.trim() || entity.address.toLowerCase().includes(query.trim().toLowerCase()));
  const selectedAddress = selected ? String(selected.address) : "";
  const verification = selected?.verification as Record<string, unknown> | undefined;
  const toolchain = selected?.toolchain as Record<string, unknown> | undefined;

  const refreshVerifications = async () => {
    const base = scopePath(scope, `/contracts/${encodeURIComponent(selectedAddress)}`);
    if (base) setVerifications(await api.get(`${base}/verifications?limit=20`));
  };

  const uploadArchive = async (file: File | null) => {
    if (!file) return;
    const path = scopePath(scope, `/contracts/${encodeURIComponent(selectedAddress)}/verification-upload`);
    if (!path) return;
    setLoading(true);
    try {
      const uploaded = await api.upload<{ upload_id: string }>(path, file);
      setUploadId(uploaded.upload_id);
      setError(null);
    } catch (cause) { setError(errorMessage(cause, "Could not inspect and store this source archive.")); }
    finally { setLoading(false); }
  };

  const submitVerification = async (event: FormEvent) => {
    event.preventDefault();
    const path = scopePath(scope, `/contracts/${encodeURIComponent(selectedAddress)}/verify`);
    if (!path) return;
    const sourceInput = sourceKind === "github"
      ? { kind: "github", repository: repository.trim(), commit: commit.trim().toLowerCase(), package_path: packagePath.trim() || ".", installation_id: null }
      : { kind: "archive", upload_id: uploadId, package_path: packagePath.trim() || "." };
    setLoading(true);
    try {
      await api.post(path, { visibility, source: sourceInput, recipe_id: "rust-soroban-1" });
      await refreshVerifications();
      setError(null);
    } catch (cause) { setError(errorMessage(cause, "Could not submit this verification.")); }
    finally { setLoading(false); }
  };

  if (hasContractDetail(selected)) return <ContractDetailView
    selected={selected!} address={selectedAddress} network={scope.network} verification={verification}
    toolchain={toolchain} transactions={transactions} events={events} source={source}
    verifications={verifications} tab={tab} setTab={setTab} router={router}
    onBack={() => setSelected(null)} sourceKind={sourceKind} setSourceKind={setSourceKind}
    repository={repository} setRepository={setRepository} commit={commit} setCommit={setCommit}
    packagePath={packagePath} setPackagePath={setPackagePath} visibility={visibility}
    setVisibility={setVisibility} uploadId={uploadId} loading={loading}
    onUpload={uploadArchive} onSubmit={submitVerification} onRefresh={refreshVerifications}
  />;

  if (selected) return <div className="pw-page"><div className="pw-detail-head"><div className="pw-inline"><Button iconOnly aria-label="Back to contracts" onClick={() => setSelected(null)}><ArrowLeft size={16} /></Button><div className="pw-detail-title"><p>Soroban contract</p><h1 className="pw-mono">{selectedAddress}</h1><p>{scope.network} / shared contract catalog</p></div></div><div className="pw-actions"><Button onClick={() => navigator.clipboard.writeText(selectedAddress)}><Copy size={14} /> Copy</Button><Button onClick={() => router.push(`/explorer/${scope.network}/contract/${encodeURIComponent(selectedAddress)}`)}>Explorer</Button><Button primary onClick={() => router.push(`/simulator?contract=${encodeURIComponent(selectedAddress)}`)}><Play size={14} /> Simulate</Button></div></div><div className="pw-surface"><div className="pw-stats"><div className="pw-stat"><span>Verification</span><strong>{String(verification?.status ?? "unverified")}</strong></div><div className="pw-stat"><span>WASM hash</span><strong className="pw-mono">{selected.current_wasm_hash ? truncateEntity(String(selected.current_wasm_hash), 8, 7) : "Unavailable"}</strong></div><div className="pw-stat"><span>Events indexed</span><strong>{events.data.length}</strong></div><div className="pw-stat"><span>Debug symbols</span><strong>{toolchain?.debug_symbols_present ? "Present" : "Not available"}</strong></div></div><div className="pw-tabs"><button data-active={tab === "overview"} onClick={() => setTab("overview")}>Overview</button><button data-active={tab === "transactions"} onClick={() => setTab("transactions")}>Transactions</button><button data-active={tab === "events"} onClick={() => setTab("events")}>Events</button><button data-active={tab === "source"} onClick={() => setTab("source")}>Source and WASM</button></div>{tab === "overview" && <div className="pw-panel-body"><div className="pw-kv"><span>Contract ID</span><span className="pw-mono">{selectedAddress}</span><span>Contract type</span><span>{String(selected.type ?? "contract")}</span><span>Soroban SDK</span><span>{String(toolchain?.soroban_sdk_version ?? "Unavailable")}</span><span>Rust version</span><span>{String(toolchain?.rust_version ?? "Unavailable")}</span><span>WASM target</span><span>{String(toolchain?.wasm_target ?? "Unavailable")}</span><span>Source mapping</span><span>{String(selected.source_map_status ?? "not available")}</span></div></div>}{tab === "transactions" && <TxRows page={transactions} network={scope.network} onOpen={(hash) => router.push(`/explorer/${scope.network}/transaction/${encodeURIComponent(hash)}`)} />}{tab === "events" && <div className="pw-table">{events.data.length ? events.data.map((event, index) => <button className="pw-row" style={{ gridTemplateColumns: "120px minmax(180px, 1fr) minmax(220px, 1fr) 130px" }} key={event.id || index} onClick={() => event.tx_hash && router.push(`/explorer/${scope.network}/transaction/${encodeURIComponent(event.tx_hash)}`)}><span>{event.ledger_sequence?.toLocaleString() || "-"}</span><span className="pw-mono">{JSON.stringify(event.topics)}</span><span className="pw-mono">{JSON.stringify(event.data)}</span><span>{timeLabel(event.timestamp)}</span></button>) : <EmptyState icon={<Activity size={22} />} title="No contract events" body="Indexed Soroban diagnostic and contract events will appear here." />}</div>}{tab === "source" && <div className="pw-panel-body">{source ? <pre className="pw-json">{JSON.stringify(source, null, 2)}</pre> : <EmptyState icon={<FileCode2 size={22} />} title="Source is not verified" body="Verified source, toolchain metadata, and WASM mapping will appear here when available." />}</div>}</div></div>;

  return <div className="pw-page"><Header title="Contracts" description="Track the Soroban contracts your application calls, with shared verification and simulation entry points." />{error && <Message error>{error}</Message>}<div className="pw-surface"><CatalogToolbar query={query} setQuery={setQuery} placeholder="Search Soroban contract IDs" onAdd={() => setShowAdd(true)} addLabel="Add contract" />{loading && !page.data.length ? <EmptyState icon={<LoaderCircle size={22} />} title="Loading contracts" body="Fetching the project contract catalog." /> : !scope.project ? <EmptyState icon={<Box size={22} />} title="Select a project" body="Contract catalogs are scoped to a Releeve project." /> : !visible.length ? <EmptyState icon={<Box size={22} />} title={query ? "No matching contracts" : "No contracts yet"} body={query ? "Try another contract ID." : "Add a Soroban contract to make it available to the whole project."} action={!query ? <Button primary onClick={() => setShowAdd(true)}><Plus size={15} /> Add contract</Button> : undefined} /> : <div className="pw-table"><div className="pw-row pw-row-header" style={{ gridTemplateColumns: "minmax(240px, 1fr) 140px 150px 40px" }}><span>Contract</span><span>Network</span><span>Last synced</span><span /></div>{visible.map((entity) => <button className="pw-row" style={{ gridTemplateColumns: "minmax(240px, 1fr) 140px 150px 40px" }} key={entity.address} onClick={() => void openContract(entity.address)}><span className="pw-mono">{truncateEntity(entity.address, 15, 11)}</span><span>{entity.network || scope.network}</span><span>{timeLabel(entity.last_synced_at)}</span><ChevronRight size={15} /></button>)}</div>}</div><Pagination page={page} onPage={load} />{showAdd && <Modal title="Add contract" onClose={() => setShowAdd(false)} footer={<><Button onClick={() => setShowAdd(false)}>Cancel</Button><Button primary disabled={loading || !address.trim()} onClick={() => document.getElementById("add-contract-form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))}>{loading ? <LoaderCircle size={14} /> : <Plus size={14} />} Add contract</Button></>}><form id="add-contract-form" onSubmit={track}><label className="pw-label">Soroban contract ID<input autoFocus className="pw-field pw-mono" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="C..." /></label></form></Modal>}</div>;
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
  const { selected, address, network, verification, toolchain, transactions, events, source, verifications, tab, setTab, router } = props;
  return <div className="pw-page"><div className="pw-detail-head"><div className="pw-inline"><Button iconOnly aria-label="Back to contracts" onClick={props.onBack}><ArrowLeft size={16} /></Button><div className="pw-detail-title"><p>Soroban contract</p><h1 className="pw-mono">{address}</h1><p>{network} / shared contract catalog</p></div></div><div className="pw-actions"><Button onClick={() => navigator.clipboard.writeText(address)}><Copy size={14} /> Copy</Button><Button onClick={() => router.push(`/explorer/${network}/contract/${encodeURIComponent(address)}`)}>Explorer</Button><Button primary onClick={() => router.push(`/simulator?contract=${encodeURIComponent(address)}`)}><Play size={14} /> Simulate</Button></div></div><div className="pw-surface"><div className="pw-stats"><div className="pw-stat"><span>Verification</span><strong>{String(verification?.status ?? "unverified")}</strong></div><div className="pw-stat"><span>WASM hash</span><strong className="pw-mono">{selected.current_wasm_hash ? truncateEntity(String(selected.current_wasm_hash), 8, 7) : "Unavailable"}</strong></div><div className="pw-stat"><span>Events indexed</span><strong>{events.data.length}</strong></div><div className="pw-stat"><span>Debug symbols</span><strong>{toolchain?.debug_symbols_present ? "Present" : "Not available"}</strong></div></div><div className="pw-tabs"><button data-active={tab === "overview"} onClick={() => setTab("overview")}>Overview</button><button data-active={tab === "transactions"} onClick={() => setTab("transactions")}>Transactions</button><button data-active={tab === "events"} onClick={() => setTab("events")}>Events</button><button data-active={tab === "source"} onClick={() => setTab("source")}>Source and WASM</button><button data-active={tab === "verification"} onClick={() => setTab("verification")}>Verification</button></div>{tab === "overview" && <div className="pw-panel-body"><div className="pw-kv"><span>Contract ID</span><span className="pw-mono">{address}</span><span>Contract type</span><span>{String(selected.type ?? "contract")}</span><span>Soroban SDK</span><span>{String(toolchain?.soroban_sdk_version ?? "Unavailable")}</span><span>Rust version</span><span>{String(toolchain?.rust_version ?? "Unavailable")}</span><span>WASM target</span><span>{String(toolchain?.wasm_target ?? "Unavailable")}</span><span>Source mapping</span><span>{String(selected.source_map_status ?? "not available")}</span></div></div>}{tab === "transactions" && <TxRows page={transactions} network={network} onOpen={(hash) => router.push(`/explorer/${network}/transaction/${encodeURIComponent(hash)}`)} />}{tab === "events" && <div className="pw-table">{events.data.length ? events.data.map((event, index) => <button className="pw-row" style={{ gridTemplateColumns: "120px minmax(180px, 1fr) minmax(220px, 1fr) 130px" }} key={event.id || index} onClick={() => event.tx_hash && router.push(`/explorer/${network}/transaction/${encodeURIComponent(event.tx_hash)}`)}><span>{event.ledger_sequence?.toLocaleString() || "-"}</span><span className="pw-mono">{JSON.stringify(event.topics)}</span><span className="pw-mono">{JSON.stringify(event.data)}</span><span>{timeLabel(event.timestamp)}</span></button>) : <EmptyState icon={<Activity size={22} />} title="No contract events" body="Indexed contract events will appear here." />}</div>}{tab === "source" && <div className="pw-panel-body">{source ? <pre className="pw-json">{JSON.stringify(source, null, 2)}</pre> : <EmptyState icon={<FileCode2 size={22} />} title="Source is not available" body="Source appears after an immutable package has passed its custody checks." />}</div>}{tab === "verification" && <VerificationPanel {...props} />}</div></div>;
}

function VerificationPanel(props: ContractDetailProps) {
  return <div className="pw-verification"><form className="pw-verification-form" onSubmit={props.onSubmit}><div className="pw-inline" style={{ justifyContent: "space-between" }}><h2>Verify deployed WASM</h2><div className="pw-segmented"><button type="button" data-active={props.sourceKind === "github"} onClick={() => props.setSourceKind("github")}>GitHub commit</button><button type="button" data-active={props.sourceKind === "archive"} onClick={() => props.setSourceKind("archive")}>Source archive</button></div></div>{props.sourceKind === "github" ? <div className="pw-field-grid"><label className="pw-label">Repository<input className="pw-field pw-mono" value={props.repository} onChange={(event) => props.setRepository(event.target.value)} placeholder="owner/repository" required /></label><label className="pw-label">Commit SHA<input className="pw-field pw-mono" value={props.commit} onChange={(event) => props.setCommit(event.target.value)} placeholder="40-character commit" minLength={40} maxLength={40} required /></label></div> : <label className="pw-label">ZIP source package<input className="pw-field" type="file" accept=".zip,application/zip" onChange={(event) => void props.onUpload(event.target.files?.[0] ?? null)} required={!props.uploadId} />{props.uploadId && <span className="pw-mono">Stored as {props.uploadId}</span>}</label>}<div className="pw-field-grid"><label className="pw-label">Package path<input className="pw-field pw-mono" value={props.packagePath} onChange={(event) => props.setPackagePath(event.target.value)} /></label><label className="pw-label">Visibility<select className="pw-field" value={props.visibility} onChange={(event) => props.setVisibility(event.target.value as "private" | "public")}><option value="private">Private to project</option><option value="public">Public evidence</option></select></label></div><div className="pw-actions" style={{ justifyContent: "flex-end" }}><Button onClick={() => void props.onRefresh()}><RotateCcw size={14} /> Refresh</Button><Button primary disabled={props.loading || (props.sourceKind === "archive" && !props.uploadId)}><ShieldCheck size={14} /> Submit verification</Button></div></form><div className="pw-verification-history"><h2>Evidence history</h2>{props.verifications.data.length ? props.verifications.data.map((item) => { const capabilities = item.capabilities ?? {}; return <div className="pw-verification-run" key={item.id}><div className="pw-inline" style={{ justifyContent: "space-between" }}><div><strong>{item.legacy_claim ? "Legacy claim" : "SourceLens verification"}</strong><p className="pw-mono">{item.source_lens_verification_id ?? item.id}</p></div><StatusBadge status={item.source_lens_status ?? item.status ?? "unknown"} /></div><div className="pw-capability-grid">{[["Build provenance", capabilities.provenance], ["Source match", capabilities.source_match], ["Source map", capabilities.source_map], ["Trace", capabilities.trace], ["Debugger", capabilities.debug_level]].map(([label, value]) => <div key={label}><span>{label}</span><StatusBadge status={String(value ?? "unavailable")} /></div>)}</div>{item.failure_reason && <Message error>{String(item.failure_reason)}</Message>}<div className="pw-inline"><span>{item.visibility}</span><span>{item.recipe_id ?? "legacy"}</span><span>{timeLabel(item.created_at)}</span></div></div>; }) : <EmptyState icon={<ShieldCheck size={22} />} title="No verification evidence" body="Submit an immutable source identity to begin." />}</div></div>;
}

function EnvironmentCard({ environment, onOpen }: { environment: Environment; onOpen: () => void }) {
  return <button className="pw-env-tile" onClick={onOpen}><div className="pw-inline" style={{ justifyContent: "space-between" }}><Blocks size={18} /><StatusBadge status={environment.sync_status} /></div><h3>{environment.name}</h3><p>{environment.network} / protocol {environment.protocol}</p><p style={{ marginTop: 5 }}>Ledger {environment.base_ledger_sequence.toLocaleString()}</p></button>;
}

export function VirtualEnvPage({ scope }: { scope: ProjectScope }) {
  const router = useRouter();
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [selected, setSelected] = useState<Environment | null>(null);
  const [tab, setTab] = useState<"overview" | "overrides" | "simulations" | "settings">("overview");
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [baseLedger, setBaseLedger] = useState("");
  const [sync, setSync] = useState(true);
  const [rename, setRename] = useState("");
  const [overrideJson, setOverrideJson] = useState('{\n  "type": "ledger",\n  "sequence": null,\n  "timestamp": null,\n  "reason": ""\n}');
  const [overrides, setOverrides] = useState<unknown[]>([]);
  const [runs, setRuns] = useState<Simulation[]>([]);
  const [rollbackLedger, setRollbackLedger] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const path = scopePath(scope, "/environments");
  const load = useCallback(async () => {
    if (!path) return;
    try { const response = await api.get<{ environments: Environment[] }>(path); setEnvironments(response.environments ?? []); setSelected((current) => current ? response.environments?.find((item) => item.id === current.id) ?? current : null); setError(null); } catch (cause) { setError(errorMessage(cause, "Fork Core environments are unavailable.")); }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { let active = true; getRecentLedgers(scope.network, 1).then(({ data }) => { if (active && data?.data[0]) setBaseLedger(String(data.data[0].sequence)); }).catch(() => undefined); return () => { active = false; }; }, [scope.network]);

  const openEnvironment = async (environment: Environment) => {
    setSelected(environment); setRename(environment.name); setRollbackLedger(String(environment.base_ledger_sequence)); setTab("overview");
    const overridePath = scopePath(scope, `/environments/${encodeURIComponent(environment.id)}/overrides`);
    const simulationsPath = scopePath(scope, "/simulations");
    const [overrideResult, runResult] = await Promise.all([overridePath ? api.get<{ overrides: unknown[] }>(overridePath).catch(() => ({ overrides: [] })) : { overrides: [] }, simulationsPath ? api.get<{ simulations: Simulation[] }>(simulationsPath).catch(() => ({ simulations: [] })) : { simulations: [] }]);
    setOverrides(overrideResult.overrides ?? []); setRuns(runResult.simulations ?? []);
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!path || !name.trim() || !baseLedger.trim()) return;
    setLoading(true);
    try { await api.post(path, { name: name.trim(), network: scope.network, protocol: 27, base_ledger_sequence: Number(baseLedger), sync_enabled: sync }); setName(""); setShowCreate(false); setMessage("Environment created and handed to Fork Core."); setError(null); await load(); } catch (cause) { setError(errorMessage(cause, "Could not create the environment.")); } finally { setLoading(false); }
  };

  const action = async (suffix: string, body?: unknown) => {
    if (!selected) return;
    const target = scopePath(scope, `/environments/${encodeURIComponent(selected.id)}${suffix}`);
    if (!target) return;
    setLoading(true);
    try { await api.post(target, body); setMessage(`${selected.name} updated.`); setError(null); await load(); if (suffix === "/overrides") await openEnvironment(selected); } catch (cause) { setError(errorMessage(cause, "Environment action failed.")); } finally { setLoading(false); }
  };

  const updateName = async () => {
    if (!selected || !rename.trim()) return;
    const target = scopePath(scope, `/environments/${encodeURIComponent(selected.id)}`);
    if (!target) return;
    try { await api.patch(target, { name: rename.trim() }); setMessage("Environment renamed."); await load(); } catch (cause) { setError(errorMessage(cause, "Could not rename the environment.")); }
  };

  const addOverride = async () => {
    try { await action("/overrides", JSON.parse(overrideJson)); } catch { setError("Override must be valid JSON."); }
  };

  const remove = async () => {
    if (!selected) return;
    const target = scopePath(scope, `/environments/${encodeURIComponent(selected.id)}`);
    if (!target) return;
    try { await api.delete(target); setSelected(null); setMessage("Environment deleted."); await load(); } catch (cause) { setError(errorMessage(cause, "Could not delete the environment.")); }
  };

  if (selected) return <div className="pw-page"><div className="pw-detail-head"><div className="pw-inline"><Button iconOnly aria-label="Back to environments" onClick={() => setSelected(null)}><ArrowLeft size={16} /></Button><div className="pw-detail-title"><p>Virtual environment</p><h1>{selected.name}</h1><p>{selected.network} / protocol {selected.protocol} / base ledger {selected.base_ledger_sequence.toLocaleString()}</p></div></div><div className="pw-actions"><Button onClick={() => void action(selected.sync_enabled ? "/sync/stop" : "/sync/start")}>{selected.sync_enabled ? <Pause size={14} /> : <Play size={14} />}{selected.sync_enabled ? "Pause sync" : "Start sync"}</Button><Button primary onClick={() => router.push(`/simulator?environment=${encodeURIComponent(selected.id)}`)}><Play size={14} /> Simulate</Button></div></div>{message && <Message>{message}</Message>}{error && <Message error>{error}</Message>}<div className="pw-surface"><div className="pw-stats"><div className="pw-stat"><span>Sync status</span><strong><StatusBadge status={selected.sync_status} /></strong></div><div className="pw-stat"><span>Base ledger</span><strong>{selected.base_ledger_sequence.toLocaleString()}</strong></div><div className="pw-stat"><span>Persisted overrides</span><strong>{overrides.length}</strong></div><div className="pw-stat"><span>Protocol</span><strong>{selected.protocol}</strong></div></div><div className="pw-tabs"><button data-active={tab === "overview"} onClick={() => setTab("overview")}>Overview</button><button data-active={tab === "overrides"} onClick={() => setTab("overrides")}>State overrides</button><button data-active={tab === "simulations"} onClick={() => setTab("simulations")}>Simulations</button><button data-active={tab === "settings"} onClick={() => setTab("settings")}>Settings</button></div>{tab === "overview" && <div className="pw-panel-body"><div className="pw-kv"><span>Environment ID</span><span className="pw-mono">{selected.id}</span><span>Network</span><span>{selected.network}</span><span>Continuous sync</span><span>{selected.sync_enabled ? "Enabled" : "Paused"}</span><span>Execution protocol</span><span>Protocol {selected.protocol}</span></div></div>}{tab === "overrides" && <div className="pw-panel-body"><div className="pw-field-grid"><label className="pw-label pw-span-full">Override JSON<textarea className="pw-field pw-mono" rows={8} value={overrideJson} onChange={(event) => setOverrideJson(event.target.value)} /></label><div className="pw-span-full pw-actions" style={{ justifyContent: "flex-end" }}><Button primary onClick={() => void addOverride()} disabled={loading}><Plus size={14} /> Apply override</Button></div></div><div style={{ marginTop: 16 }}>{overrides.length ? <pre className="pw-json">{JSON.stringify(overrides, null, 2)}</pre> : <EmptyState icon={<SlidersHorizontal size={22} />} title="No persisted overrides" body="Balance, contract storage, TTL, ledger sequence, and timestamp overrides will appear here." />}</div></div>}{tab === "simulations" && <div className="pw-table">{runs.length ? runs.map((run) => <button className="pw-row" style={{ gridTemplateColumns: "minmax(180px, 1fr) 120px 140px 140px" }} key={run.id} onClick={() => router.push(`/simulator?run=${encodeURIComponent(run.id)}`)}><span className="pw-mono">{run.function_name}</span><StatusBadge status={run.status} /><span>{run.base_ledger_sequence.toLocaleString()}</span><span>{timeLabel(run.created_at)}</span></button>) : <EmptyState icon={<History size={22} />} title="No simulations yet" body="Run a transaction against this environment to see its history here." action={<Button primary onClick={() => router.push(`/simulator?environment=${encodeURIComponent(selected.id)}`)}><Play size={14} /> New simulation</Button>} />}</div>}{tab === "settings" && <div className="pw-panel-body"><div className="pw-field-grid"><label className="pw-label">Environment name<input className="pw-field" value={rename} onChange={(event) => setRename(event.target.value)} /></label><div className="pw-label"><span>&nbsp;</span><Button onClick={() => void updateName()}>Rename</Button></div><label className="pw-label">Rollback to ledger<input className="pw-field" type="number" value={rollbackLedger} onChange={(event) => setRollbackLedger(event.target.value)} /></label><div className="pw-label"><span>&nbsp;</span><Button onClick={() => void action("/rollback", { to_ledger: Number(rollbackLedger) })}><RotateCcw size={14} /> Roll back</Button></div><div className="pw-span-full" style={{ borderTop: "1px solid var(--border)", marginTop: 8, paddingTop: 14 }}><Button danger onClick={() => void remove()}><Trash2 size={14} /> Delete environment</Button></div></div></div>}</div></div>;

  return <div className="pw-page"><Header title="Virtual environments" description="Fork Stellar ledger state into controlled, continuously synchronized Soroban workspaces." actions={<Button primary onClick={() => setShowCreate(true)}><Plus size={15} /> Create environment</Button>} />{message && <Message>{message}</Message>}{error && <Message error>{error}</Message>}{!scope.project ? <div className="pw-surface"><EmptyState icon={<Blocks size={22} />} title="Select a project" body="Virtual environments are isolated by project." /></div> : environments.length ? <div className="pw-environment-grid">{environments.map((environment) => <EnvironmentCard key={environment.id} environment={environment} onOpen={() => void openEnvironment(environment)} />)}</div> : <div className="pw-surface"><EmptyState icon={<Blocks size={22} />} title="Create your first virtual environment" body="Start from a real mainnet or testnet ledger, keep it synchronized, then apply controlled state and time overrides." action={<Button primary onClick={() => setShowCreate(true)}><Plus size={15} /> Create environment</Button>} /></div>}{showCreate && <Modal title="Create virtual environment" onClose={() => setShowCreate(false)} footer={<><Button onClick={() => setShowCreate(false)}>Cancel</Button><Button primary disabled={loading || !name.trim() || !baseLedger} onClick={() => document.getElementById("create-environment-form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))}>{loading ? <LoaderCircle size={14} /> : <Plus size={14} />} Create</Button></>}><form id="create-environment-form" onSubmit={create} className="pw-modal-body" style={{ padding: 0 }}><label className="pw-label">Name<input autoFocus className="pw-field" value={name} onChange={(event) => setName(event.target.value)} placeholder="Checkout regression" /></label><label className="pw-label">Network<select className="pw-field" value={scope.network} disabled><option>{scope.network}</option></select></label><label className="pw-label">Base ledger<input className="pw-field" type="number" value={baseLedger} onChange={(event) => setBaseLedger(event.target.value)} /></label><label className="pw-inline"><input type="checkbox" checked={sync} onChange={(event) => setSync(event.target.checked)} /> Continuously sync new ledger closes</label></form></Modal>}</div>;
}

function Accordion({ icon, title, open, onToggle, children }: { icon: ReactNode; title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return <div className="pw-accordion"><button type="button" onClick={onToggle}>{icon}{title}<ChevronDown size={15} style={{ transform: open ? "rotate(180deg)" : undefined }} /></button>{open && <div className="pw-accordion-body">{children}</div>}</div>;
}

export function SimulatorPage({ scope }: { scope: ProjectScope }) {
  const router = useRouter();
  const search = useSearchParams();
  const requestedLedger = search.get("ledger");
  const sourceTransaction = search.get("tx");
  const [editor, setEditor] = useState(Boolean(search.get("contract") || search.get("impersonate") || search.get("environment") || search.get("run") || requestedLedger || sourceTransaction));
  const [view, setView] = useState<"input" | "split" | "output">("split");
  const [resultTab, setResultTab] = useState<"summary" | "calls" | "events" | "state" | "resources" | "raw">("summary");
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [runs, setRuns] = useState<Simulation[]>([]);
  const [environmentId, setEnvironmentId] = useState(search.get("environment") ?? "");
  const [contractId, setContractId] = useState(search.get("contract") ?? "");
  const [functionName, setFunctionName] = useState(search.get("function") ?? "");
  const [argsMode, setArgsMode] = useState<"decoded" | "raw">("decoded");
  const [args, setArgs] = useState(search.get("args") ?? "[]");
  const [hostFunctionXdr, setHostFunctionXdr] = useState("");
  const [sourceAccountXdr, setSourceAccountXdr] = useState("");
  const [impersonate, setImpersonate] = useState(search.get("impersonate") ?? "");
  const [increaseLedger, setIncreaseLedger] = useState("0");
  const [timestamp, setTimestamp] = useState("");
  const [balanceTarget, setBalanceTarget] = useState("");
  const [balanceAsset, setBalanceAsset] = useState("XLM");
  const [balanceAmount, setBalanceAmount] = useState("");
  const [balanceKeyXdr, setBalanceKeyXdr] = useState("");
  const [storageKeyXdr, setStorageKeyXdr] = useState("");
  const [storageValueXdr, setStorageValueXdr] = useState("");
  const [ttlKeyXdr, setTtlKeyXdr] = useState("");
  const [liveUntilLedger, setLiveUntilLedger] = useState("");
  const [footprintKeys, setFootprintKeys] = useState("");
  const [advancedOverrides, setAdvancedOverrides] = useState("[]");
  const [captureTrace, setCaptureTrace] = useState(Boolean(sourceTransaction));
  const [selectedRun, setSelectedRun] = useState<Record<string, unknown> | null>(null);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<string | null>(() => {
    if (sourceTransaction) return "Transaction context was prefilled from the explorer. Re-simulation runs the decoded invocation against the selected private environment; it never resubmits the original transaction.";
    if (requestedLedger) return `Ledger ${requestedLedger} is the requested snapshot context. Select or create an environment based on that ledger before running an invocation.`;
    if (search.get("impersonate") && !search.get("contract")) return "The wallet is prefilled as an impersonated signer. A wallet is not simulated by itself; choose the contract function it should authorize.";
    if (search.get("contract")) return "The contract target is prefilled. Choose a function and arguments to simulate an invocation against an isolated environment.";
    return null;
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const environmentPath = scopePath(scope, "/environments");
  const simulationPath = scopePath(scope, "/simulations");
  const selectedEnvironment = environments.find((environment) => environment.id === environmentId);
  const load = useCallback(async () => {
    if (!environmentPath || !simulationPath) return;
    try {
      const [environmentResult, simulationResult] = await Promise.all([api.get<{ environments: Environment[] }>(environmentPath), api.get<{ simulations: Simulation[] }>(simulationPath)]);
      setEnvironments(environmentResult.environments ?? []); setRuns(simulationResult.simulations ?? []); setEnvironmentId((current) => current || environmentResult.environments?.find((environment) => requestedLedger && environment.base_ledger_sequence === Number(requestedLedger))?.id || environmentResult.environments?.[0]?.id || ""); setError(null);
    } catch (cause) { setError(errorMessage(cause, "Could not load simulation data.")); }
  }, [environmentPath, requestedLedger, simulationPath]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const run = search.get("run"); if (run && simulationPath) api.get<Record<string, unknown>>(`${simulationPath}/${encodeURIComponent(run)}`).then(setSelectedRun).catch((cause) => setError(errorMessage(cause, "Could not load the simulation."))); }, [search, simulationPath]);

  const toggle = (section: string) => setOpenSections((current) => ({ ...current, [section]: !current[section] }));
  const buildOverrides = () => {
    const parsed = JSON.parse(advancedOverrides);
    if (!Array.isArray(parsed)) throw new Error("Advanced overrides must be a JSON array.");
    const built: unknown[] = [...parsed];
    const baseLedger = selectedEnvironment?.base_ledger_sequence ?? 0;
    const increase = Number(increaseLedger || 0);
    if (increase > 0 || timestamp) built.push({ type: "ledger", sequence: increase > 0 ? baseLedger + increase : null, timestamp: timestamp ? new Date(timestamp).toISOString() : null });
    if (balanceTarget || balanceAmount || balanceKeyXdr) {
      if (!balanceTarget || !balanceAmount || !balanceKeyXdr) throw new Error("Balance override requires account, amount, and ledger-key XDR.");
      built.push({ type: "balance", target: balanceTarget, asset: balanceAsset || "XLM", amount: balanceAmount, ledger_key_xdr: balanceKeyXdr });
    }
    if (storageKeyXdr || storageValueXdr) {
      if (!contractId || !storageKeyXdr || !storageValueXdr) throw new Error("State override requires contract, ledger-key XDR, and value XDR.");
      built.push({ type: "storage", contract_id: contractId, ledger_key_xdr: storageKeyXdr, value_xdr: storageValueXdr });
    }
    if (ttlKeyXdr || liveUntilLedger) {
      if (!ttlKeyXdr || !liveUntilLedger) throw new Error("TTL override requires ledger-key XDR and live-until ledger.");
      built.push({ type: "ttl", ledger_key_xdr: ttlKeyXdr, live_until_ledger: Number(liveUntilLedger) });
    }
    return built;
  };

  const simulate = async () => {
    if (!environmentId || !contractId.trim() || !functionName.trim()) { setError("Choose an environment and provide a contract and function."); return; }
    let parsedArgs: unknown;
    let overrides: unknown[];
    try { parsedArgs = JSON.parse(args); overrides = buildOverrides(); } catch (cause) { setError(errorMessage(cause, "Arguments and overrides must be valid JSON.")); return; }
    const path = scopePath(scope, `/environments/${encodeURIComponent(environmentId)}/simulate`);
    if (!path) return;
    setLoading(true); setView("split");
    try {
      const response = await api.post<Record<string, unknown>>(path, { request: { network: scope.network, protocol: selectedEnvironment?.protocol ?? 27, contract_id: contractId.trim(), function_name: functionName.trim(), args: parsedArgs, host_function_xdr: argsMode === "raw" ? hostFunctionXdr.trim() || null : null, source_account_xdr: sourceAccountXdr.trim() || null, transaction_envelope_xdr: null, base_ledger_sequence: selectedEnvironment?.base_ledger_sequence ?? null, ledger: null, explicit_ledger_keys: footprintKeys.split(/[\n,]/).map((value) => value.trim()).filter(Boolean), overrides, impersonate: impersonate.split(",").map((value) => value.trim()).filter(Boolean), capture_trace: captureTrace } });
      setSelectedRun(response); setResultTab("summary"); setMessage("Simulation queued. The output panel will show persisted Fork Core evidence."); setError(null); await load();
    } catch (cause) { setError(errorMessage(cause, "Could not queue simulation.")); } finally { setLoading(false); }
  };

  const openRun = async (run: Simulation) => {
    if (!simulationPath) return;
    setEditor(true); setLoading(true);
    try { setSelectedRun(await api.get(`${simulationPath}/${encodeURIComponent(run.id)}`)); setView("output"); setError(null); } catch (cause) { setError(errorMessage(cause, "Could not load this simulation.")); } finally { setLoading(false); }
  };

  const analyzeRun = async () => {
    const simulationId = typeof selectedRun?.id === "string" ? selectedRun.id : null;
    if (!simulationId || !simulationPath) return;
    setLoading(true);
    try {
      const accepted = await api.post<{ analysis_id: string }>(`${simulationPath}/${encodeURIComponent(simulationId)}/analysis`, {});
      router.push(`/debugger/${encodeURIComponent(accepted.analysis_id)}`);
    } catch (cause) {
      setError(errorMessage(cause, "Could not start trace analysis. Confirm this run was created with trace capture enabled."));
    } finally {
      setLoading(false);
    }
  };

  const detail = (selectedRun?.fork_core ?? selectedRun) as Record<string, unknown> | null;
  const detailResult = (detail?.result ?? detail) as Record<string, unknown> | null;
  const outputForTab = useMemo(() => {
    if (!detailResult) return null;
    if (resultTab === "calls") return detailResult.call_tree ?? [];
    if (resultTab === "events") return detailResult.events ?? [];
    if (resultTab === "state") return detailResult.state_changes ?? [];
    if (resultTab === "resources") return detailResult.resources ?? {};
    if (resultTab === "raw") return selectedRun;
    return { status: detailResult.status ?? detail?.status ?? "queued", base_ledger_sequence: detailResult.base_ledger_sequence, protocol: detailResult.protocol, normalized_result: detailResult.normalized_result, error: detailResult.error };
  }, [detail, detailResult, resultTab, selectedRun]);
  const canAnalyze = typeof selectedRun?.id === "string" && Boolean(detailResult?.execution_trace);

  if (!editor) return <div className="pw-page pw-simulator-entry"><div className="pw-simulator-hero"><div><span className="pw-empty-icon"><Play size={23} /></span><h1>Simulator</h1><p>Preview Soroban transactions against real ledger snapshots, inspect exact state and authorization effects, and test controlled what-if scenarios without signing or submitting.</p><Button primary onClick={() => setEditor(true)}><Play size={15} /> Simulate transaction</Button></div></div><div className="pw-capabilities"><div className="pw-capability"><ShieldCheck size={18} /><h3>Impersonate scoped accounts</h3><p>Exercise Soroban authorization paths as approved Stellar accounts without possessing their secret keys.</p></div><div className="pw-capability"><SlidersHorizontal size={18} /><h3>Override ledger state</h3><p>Change balances, contract storage, TTL, ledger sequence, timestamp, and explicit footprints in an isolated snapshot.</p></div><div className="pw-capability"><Activity size={18} /><h3>Inspect execution evidence</h3><p>Review calls, events, state changes, host resources, normalized output, and structured failures.</p></div></div>{runs.length > 0 && <div style={{ marginTop: 22 }}><Header title="Recent simulations" description="Persisted runs from this project." /><div className="pw-surface pw-table">{runs.slice(0, 8).map((run) => <button className="pw-row" style={{ gridTemplateColumns: "minmax(180px, 1fr) 120px 140px 140px" }} key={run.id} onClick={() => void openRun(run)}><span className="pw-mono">{run.function_name}</span><StatusBadge status={run.status} /><span>{run.base_ledger_sequence.toLocaleString()}</span><span>{timeLabel(run.created_at)}</span></button>)}</div></div>}</div>;

  const showInput = view !== "output";
  const showOutput = view !== "input";
  return <div className="pw-page pw-sim-editor"><div className="pw-sim-top"><div className="pw-inline"><Button iconOnly aria-label="Exit editor" onClick={() => setEditor(false)}><ArrowLeft size={15} /></Button><h1>New simulation</h1></div><div className="pw-segmented"><button data-active={view === "input"} onClick={() => setView("input")}>Input</button><button data-active={view === "split"} onClick={() => setView("split")}>Split</button><button data-active={view === "output"} onClick={() => setView("output")}>Output</button></div><div className="pw-actions"><Button onClick={() => navigator.clipboard.writeText(location.href)}><Copy size={14} /> Copy draft link</Button>{canAnalyze && <Button onClick={() => void analyzeRun()}><Bug size={14} /> Analyze trace</Button>}<Button primary disabled={loading || !environmentId} onClick={() => void simulate()}>{loading ? <LoaderCircle size={14} /> : <Play size={14} />} Simulate</Button></div></div>{error && <Message error>{error}</Message>}{message && <Message>{message}</Message>}<div className="pw-sim-layout" style={{ gridTemplateColumns: view === "input" ? "1fr" : view === "output" ? "1fr" : undefined }}>{showInput && <div className="pw-sim-input"><div className="pw-sim-context"><label className="pw-inline"><Database size={16} /><select className="pw-field" value={environmentId} onChange={(event) => setEnvironmentId(event.target.value)} style={{ width: "auto", minWidth: 210 }}><option value="">Select virtual environment</option>{environments.map((environment) => <option key={environment.id} value={environment.id}>{environment.name} / {environment.network}</option>)}</select></label><span className="pw-mono" style={{ color: "var(--text-dim)" }}>ledger {selectedEnvironment?.base_ledger_sequence?.toLocaleString() ?? "pending"}</span></div><div className="pw-sim-compose"><div className="pw-step-rail"><div className="pw-step"><span className="pw-step-number">1</span><span>Invoke</span></div><div className="pw-step-actions"><Button iconOnly aria-label="Add step" disabled title="Bundles are coming after single-call parity"><Plus size={15} /></Button><Button iconOnly aria-label="Reset" onClick={() => { setContractId(""); setFunctionName(""); setArgs("[]"); }}><RotateCcw size={14} /></Button></div></div><div className="pw-sim-form"><div className="pw-sim-section"><h2><Zap size={16} /> Transaction parameters</h2><div className="pw-field-grid"><label className="pw-label pw-span-full">Source account XDR<input className="pw-field pw-mono" value={sourceAccountXdr} onChange={(event) => setSourceAccountXdr(event.target.value)} placeholder="Optional source account XDR" /></label><label className="pw-label pw-span-full">Contract ID<input className="pw-field pw-mono" value={contractId} onChange={(event) => setContractId(event.target.value)} placeholder="C..." /></label><label className="pw-label pw-span-full">Function<input className="pw-field pw-mono" value={functionName} onChange={(event) => setFunctionName(event.target.value)} placeholder="transfer" /></label><div className="pw-span-full pw-inline" style={{ justifyContent: "space-between" }}><span style={{ color: "var(--text-dim)", fontSize: 11.5 }}>Invocation input</span><div className="pw-segmented"><button data-active={argsMode === "decoded"} onClick={() => setArgsMode("decoded")}>Decoded</button><button data-active={argsMode === "raw"} onClick={() => setArgsMode("raw")}>Raw XDR</button></div></div>{argsMode === "decoded" ? <label className="pw-label pw-span-full">Arguments JSON<textarea className="pw-field pw-mono" rows={5} value={args} onChange={(event) => setArgs(event.target.value)} /></label> : <label className="pw-label pw-span-full">Host-function XDR<textarea className="pw-field pw-mono" rows={5} value={hostFunctionXdr} onChange={(event) => setHostFunctionXdr(event.target.value)} /></label>}</div></div><Accordion icon={<UserRound size={16} />} title="Impersonate accounts" open={Boolean(openSections.impersonate)} onToggle={() => toggle("impersonate")}><label className="pw-label">Approved account IDs<input className="pw-field pw-mono" value={impersonate} onChange={(event) => setImpersonate(event.target.value)} placeholder="G..., G..." /></label></Accordion><Accordion icon={<CircleDollarSign size={16} />} title="Override balance" open={Boolean(openSections.balance)} onToggle={() => toggle("balance")}><div className="pw-field-grid"><label className="pw-label">Account<input className="pw-field pw-mono" value={balanceTarget} onChange={(event) => setBalanceTarget(event.target.value)} placeholder="G..." /></label><label className="pw-label">Asset<input className="pw-field" value={balanceAsset} onChange={(event) => setBalanceAsset(event.target.value)} /></label><label className="pw-label">Amount<input className="pw-field" value={balanceAmount} onChange={(event) => setBalanceAmount(event.target.value)} placeholder="1000.0000000" /></label><label className="pw-label">Ledger-key XDR<input className="pw-field pw-mono" value={balanceKeyXdr} onChange={(event) => setBalanceKeyXdr(event.target.value)} /></label></div></Accordion><Accordion icon={<Layers3 size={16} />} title="Increase ledger" open={Boolean(openSections.ledger)} onToggle={() => toggle("ledger")}><label className="pw-label">Ledgers after snapshot<input className="pw-field" type="number" min="0" value={increaseLedger} onChange={(event) => setIncreaseLedger(event.target.value)} /></label></Accordion><Accordion icon={<Clock3 size={16} />} title="Override timestamp" open={Boolean(openSections.timestamp)} onToggle={() => toggle("timestamp")}><label className="pw-label">Ledger close time<input className="pw-field" type="datetime-local" value={timestamp} onChange={(event) => setTimestamp(event.target.value)} /></label></Accordion><Accordion icon={<Braces size={16} />} title="Contract state override" open={Boolean(openSections.state)} onToggle={() => toggle("state")}><label className="pw-label">Ledger-key XDR<textarea className="pw-field pw-mono" rows={3} value={storageKeyXdr} onChange={(event) => setStorageKeyXdr(event.target.value)} /></label><label className="pw-label">Replacement value XDR<textarea className="pw-field pw-mono" rows={3} value={storageValueXdr} onChange={(event) => setStorageValueXdr(event.target.value)} /></label></Accordion><Accordion icon={<AlarmClock size={16} />} title="TTL override" open={Boolean(openSections.ttl)} onToggle={() => toggle("ttl")}><div className="pw-field-grid"><label className="pw-label">Ledger-key XDR<input className="pw-field pw-mono" value={ttlKeyXdr} onChange={(event) => setTtlKeyXdr(event.target.value)} /></label><label className="pw-label">Live until ledger<input className="pw-field" type="number" value={liveUntilLedger} onChange={(event) => setLiveUntilLedger(event.target.value)} /></label></div></Accordion><Accordion icon={<KeyRound size={16} />} title="Explicit footprint" open={Boolean(openSections.footprint)} onToggle={() => toggle("footprint")}><label className="pw-label">Ledger-key XDR values<textarea className="pw-field pw-mono" rows={4} value={footprintKeys} onChange={(event) => setFootprintKeys(event.target.value)} placeholder="One key per line" /></label></Accordion><Accordion icon={<Bug size={16} />} title="Debugger evidence" open={Boolean(openSections.debugger)} onToggle={() => toggle("debugger")}><label className="pw-inline"><input type="checkbox" checked={captureTrace} onChange={(event) => setCaptureTrace(event.target.checked)} /> Capture observation-only execution trace</label></Accordion><Accordion icon={<Code2 size={16} />} title="Advanced overrides" open={Boolean(openSections.advanced)} onToggle={() => toggle("advanced")}><label className="pw-label">Override array<textarea className="pw-field pw-mono" rows={6} value={advancedOverrides} onChange={(event) => setAdvancedOverrides(event.target.value)} /></label></Accordion></div></div></div>}{showOutput && <div className="pw-output"><div className="pw-tabs"><button data-active={resultTab === "summary"} onClick={() => setResultTab("summary")}>Summary</button><button data-active={resultTab === "calls"} onClick={() => setResultTab("calls")}>Calls</button><button data-active={resultTab === "events"} onClick={() => setResultTab("events")}>Events</button><button data-active={resultTab === "state"} onClick={() => setResultTab("state")}>State</button><button data-active={resultTab === "resources"} onClick={() => setResultTab("resources")}>Resources</button><button data-active={resultTab === "raw"} onClick={() => setResultTab("raw")}>Raw</button></div>{selectedRun ? <div className="pw-panel-body"><pre className="pw-json">{JSON.stringify(outputForTab, null, 2)}</pre>{detailResult?.status === "pending" && <div className="pw-actions" style={{ marginTop: 14 }}><Button onClick={() => void load()}><RotateCcw size={14} /> Refresh status</Button></div>}</div> : <div className="pw-output-placeholder"><div><strong>Run the invocation to see the simulation</strong>Calls, authorization, state changes, events, resources, return values, and structured errors will appear here.</div></div>}</div>}</div></div>;
}

type DebugTimelineEvent = {
  sequence: number;
  frame_id?: string | null;
  kind: string;
  source?: { file?: string; line?: number; column?: number; function?: string | null } | null;
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
  page: { cursor: number; limit: number; total: number; next_cursor?: number | null };
};

export function DebuggerPage({ scope, analysisId }: { scope: ProjectScope; analysisId: string }) {
  const router = useRouter();
  const base = scopePath(scope, `/debugger/${encodeURIComponent(analysisId)}`);
  const [workspace, setWorkspace] = useState<Record<string, any> | null>(null);
  const [trace, setTrace] = useState<DebugTracePage["trace"] | null>(null);
  const [timeline, setTimeline] = useState<DebugTimelineEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [current, setCurrent] = useState(0);
  const [panel, setPanel] = useState<"state" | "auth" | "events" | "resources">("state");
  const [breakpoint, setBreakpoint] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTrace = useCallback(async (cursor = 0, append = false) => {
    if (!base) return;
    const page = await api.get<DebugTracePage>(`${base}/trace?cursor=${cursor}&limit=500`);
    setTrace(page.trace);
    setTimeline((items) => append ? [...items, ...page.timeline] : page.timeline);
    setNextCursor(page.page.next_cursor ?? null);
    setTotal(page.page.total);
  }, [base]);

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

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const analysisStatus = String(workspace?.analysis?.status ?? "queued");
    const debugStatus = String(workspace?.debugger?.status ?? "queued");
    if (["failed", "cancelled", "dead_letter"].includes(analysisStatus) || debugStatus === "succeeded" || trace) return;
    const timer = window.setInterval(() => void refresh(), 1_500);
    return () => window.clearInterval(timer);
  }, [refresh, trace, workspace]);

  const frames = trace?.frames ?? [];
  const frameDepth = useMemo(() => new Map(frames.map((frame) => [frame.id, frame.depth])), [frames]);
  const event = timeline[current];
  const move = (mode: "into" | "over" | "out" | "continue") => {
    if (!timeline.length) return;
    const depth = event?.frame_id ? frameDepth.get(event.frame_id) ?? 0 : 0;
    let target = current + 1;
    if (mode === "over") target = timeline.findIndex((item, index) => index > current && (item.frame_id ? frameDepth.get(item.frame_id) ?? 0 : 0) <= depth);
    if (mode === "out") target = timeline.findIndex((item, index) => index > current && (item.frame_id ? frameDepth.get(item.frame_id) ?? 0 : 0) < depth);
    if (mode === "continue") {
      const normalized = breakpoint.trim().toLowerCase();
      target = timeline.findIndex((item, index) => index > current && (item.kind === "error" || (normalized && `${item.source?.file ?? ""}:${item.source?.line ?? ""}`.toLowerCase() === normalized)));
    }
    setCurrent(Math.min(target < 0 ? timeline.length - 1 : target, timeline.length - 1));
  };
  const evidence = panel === "state" ? trace?.state_changes : panel === "auth" ? trace?.auth : panel === "events" ? trace?.events : trace?.resources;
  const analysisStatus = String(workspace?.analysis?.status ?? "queued");
  const debugStatus = String(workspace?.debugger?.status ?? (analysisStatus === "succeeded" ? "starting" : "waiting"));

  return <div className="pw-page pw-debugger"><div className="pw-debug-head"><div className="pw-inline"><Button iconOnly aria-label="Back to simulator" onClick={() => router.push("/simulator")}><ArrowLeft size={15} /></Button><div className="pw-detail-title"><p>Recorded execution</p><h1>Debugger</h1><p className="pw-mono">{analysisId}</p></div></div><div className="pw-actions"><StatusBadge status={debugStatus} /><Button onClick={() => void refresh()}><RotateCcw size={14} /> Refresh</Button></div></div>{error && <Message error>{error}</Message>}{!trace ? <div className="pw-surface"><EmptyState icon={analysisStatus === "failed" ? <X size={22} /> : <LoaderCircle className="animate-spin" size={22} />} title={analysisStatus === "failed" ? "Analysis failed" : "Preparing recorded evidence"} body={analysisStatus === "failed" ? String(workspace?.analysis?.failure_code ?? "SourceLens could not analyze this trace.") : `Analysis ${analysisStatus}; debugger ${debugStatus}.`} /></div> : <><div className="pw-debug-toolbar"><div className="pw-actions"><Button onClick={() => move("into")} title="Move to the next recorded event"><ChevronRight size={14} /> Step into</Button><Button onClick={() => move("over")} title="Move past nested call events">Step over</Button><Button onClick={() => move("out")} title="Move to the parent frame">Step out</Button><Button primary onClick={() => move("continue")}><Play size={14} /> Continue</Button></div><label className="pw-inline pw-breakpoint"><span>Breakpoint</span><input className="pw-field pw-mono" value={breakpoint} onChange={(input) => setBreakpoint(input.target.value)} placeholder="src/lib.rs:42" /></label><span className="pw-mono pw-debug-counter">{timeline.length ? current + 1 : 0} / {total}</span></div>{trace.limitations.length > 0 && <div className="pw-debug-limitations">{trace.limitations.map((limitation) => <StatusBadge key={limitation} status={limitation.replaceAll("_", " ")} />)}</div>}<div className="pw-debug-grid"><aside className="pw-debug-calls"><h2>Call tree</h2>{frames.map((frame) => <button key={frame.id} data-active={event?.frame_id === frame.id} style={{ paddingLeft: 12 + frame.depth * 15 }} onClick={() => { const index = timeline.findIndex((item) => item.frame_id === frame.id); if (index >= 0) setCurrent(index); }}><ChevronRight size={13} /><span><strong>{frame.function}</strong><small className="pw-mono">{truncateEntity(frame.contract_id, 9, 7)}</small></span>{(frame.trapped || frame.rolled_back) && <StatusBadge status={frame.trapped ? "trapped" : "rolled back"} />}</button>)}</aside><section className="pw-debug-source"><div className="pw-debug-source-head"><span className="pw-mono">{event?.source?.file ?? "Execution evidence"}{event?.source?.line ? `:${event.source.line}:${event.source.column ?? 0}` : ""}</span><StatusBadge status={event?.kind ?? "no event"} /></div><div className="pw-debug-event"><span className="pw-mono">#{event?.sequence ?? 0}</span><h2>{event?.source?.function ?? event?.kind?.replaceAll("_", " ") ?? "No event selected"}</h2><pre className="pw-json">{JSON.stringify(event?.data ?? {}, null, 2)}</pre></div><div className="pw-debug-timeline">{timeline.map((item, index) => <button key={`${item.sequence}-${index}`} data-active={index === current} onClick={() => setCurrent(index)}><span>{item.sequence}</span><strong>{item.kind.replaceAll("_", " ")}</strong><span className="pw-mono">{item.source ? `${item.source.file}:${item.source.line}` : item.frame_id ?? "host"}</span></button>)}{nextCursor !== null && <Button onClick={() => void loadTrace(nextCursor, true)}>Load more events</Button>}</div></section><aside className="pw-debug-evidence"><div className="pw-tabs"><button data-active={panel === "state"} onClick={() => setPanel("state")}>State</button><button data-active={panel === "auth"} onClick={() => setPanel("auth")}>Auth</button><button data-active={panel === "events"} onClick={() => setPanel("events")}>Events</button><button data-active={panel === "resources"} onClick={() => setPanel("resources")}>Resources</button></div><pre className="pw-json">{JSON.stringify(evidence ?? [], null, 2)}</pre></aside></div></>}</div>;
}

export function AlertsPage({ scope }: { scope: ProjectScope }) {
  const router = useRouter();
  const [page, setPage] = useState<CursorPage<AlertRule>>({ data: [] });
  const [selected, setSelected] = useState<AlertRule | null>(null);
  const [history, setHistory] = useState<CursorPage<AlertFiring>>({ data: [] });
  const [tab, setTab] = useState<"overview" | "history">("overview");
  const [showBuilder, setShowBuilder] = useState(false);
  const [editing, setEditing] = useState<AlertRule | null>(null);
  const [name, setName] = useState("");
  const [targetType, setTargetType] = useState("project");
  const [targetValue, setTargetValue] = useState("");
  const [matchLogic, setMatchLogic] = useState<"all" | "any">("all");
  const [enabled, setEnabled] = useState(true);
  const [expressions, setExpressions] = useState<Array<{ type: string; params: string }>>([{ type: "failed_transaction", params: "{}" }]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const alertsPath = scopePath(scope, "/alerts");
  const load = useCallback(async (cursor: string | null = null) => {
    if (!alertsPath) return;
    try { setPage(await api.get(`${alertsPath}?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)); setError(null); } catch (cause) { setError(errorMessage(cause, "Could not load alerts.")); }
  }, [alertsPath]);
  useEffect(() => { void load(); }, [load]);

  const resetBuilder = (rule?: AlertRule) => {
    setEditing(rule ?? null); setName(rule?.name ?? ""); setTargetType(rule?.target.type ?? "project"); setTargetValue(rule?.target.value ?? ""); setMatchLogic(rule?.match_logic ?? "all"); setEnabled(rule?.enabled ?? true); setExpressions(rule?.expressions.map((expression) => ({ type: expression.type, params: JSON.stringify(expression.params ?? {}, null, 2) })) ?? [{ type: "failed_transaction", params: "{}" }]); setShowBuilder(true);
  };

  const save = async () => {
    if (!alertsPath || !name.trim()) { setError("Alert name is required."); return; }
    let parsedExpressions: AlertExpression[];
    try { parsedExpressions = expressions.map((expression) => ({ type: expression.type, params: JSON.parse(expression.params || "{}") })); } catch { setError("Every condition must contain valid params JSON."); return; }
    const body = { name: name.trim(), target: { type: targetType, value: targetType === "project" ? null : targetValue.trim() || null }, expressions: parsedExpressions, match_logic: matchLogic, destinations: editing?.destinations ?? [], enabled };
    setLoading(true);
    try { if (editing) await api.patch(`${alertsPath}/${encodeURIComponent(editing.id)}`, body); else await api.post(alertsPath, body); setShowBuilder(false); setMessage(editing ? "Alert updated." : "Alert created."); setError(null); await load(); } catch (cause) { setError(errorMessage(cause, "Could not save the alert.")); } finally { setLoading(false); }
  };

  const openAlert = async (rule: AlertRule) => {
    setSelected(rule); setTab("overview");
    if (!alertsPath) return;
    try { setHistory(await api.get(`${alertsPath}/${encodeURIComponent(rule.id)}/history?limit=20`)); } catch { setHistory({ data: [] }); }
  };

  const patchEnabled = async (rule: AlertRule, value: boolean) => {
    if (!alertsPath) return;
    try { await api.patch(`${alertsPath}/${encodeURIComponent(rule.id)}`, { name: rule.name, target: rule.target, expressions: rule.expressions, match_logic: rule.match_logic, destinations: rule.destinations, enabled: value }); setSelected({ ...rule, enabled: value }); await load(); } catch (cause) { setError(errorMessage(cause, "Could not update the alert.")); }
  };

  const remove = async (rule: AlertRule) => {
    if (!alertsPath) return;
    try { await api.delete(`${alertsPath}/${encodeURIComponent(rule.id)}`); setSelected(null); setMessage("Alert deleted."); await load(); } catch (cause) { setError(errorMessage(cause, "Could not delete the alert.")); }
  };

  const visible = page.data.filter((rule) => !query.trim() || `${rule.name} ${rule.target.value ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  if (selected) return <div className="pw-page"><div className="pw-detail-head"><div className="pw-inline"><Button iconOnly aria-label="Back to alerts" onClick={() => setSelected(null)}><ArrowLeft size={16} /></Button><div className="pw-detail-title"><p>Monitoring rule</p><h1>{selected.name}</h1><p>Created {timeLabel(selected.created_at)}</p></div></div><div className="pw-actions"><Button onClick={() => resetBuilder(selected)}><Settings2 size={14} /> Edit</Button><Button onClick={() => void patchEnabled(selected, !selected.enabled)}>{selected.enabled ? <Pause size={14} /> : <Play size={14} />}{selected.enabled ? "Pause" : "Enable"}</Button><Button danger onClick={() => void remove(selected)}><Trash2 size={14} /> Delete</Button></div></div>{error && <Message error>{error}</Message>}<div className="pw-surface"><div className="pw-stats"><div className="pw-stat"><span>Status</span><strong><StatusBadge status={selected.enabled ? "enabled" : "paused"} /></strong></div><div className="pw-stat"><span>Target</span><strong>{selected.target.type}</strong></div><div className="pw-stat"><span>Conditions</span><strong>{selected.expressions.length}</strong></div><div className="pw-stat"><span>Firings loaded</span><strong>{history.data.length}</strong></div></div><div className="pw-tabs"><button data-active={tab === "overview"} onClick={() => setTab("overview")}>Rule</button><button data-active={tab === "history"} onClick={() => setTab("history")}>Firing history</button></div>{tab === "overview" && <div className="pw-panel-body"><div className="pw-kv"><span>Target type</span><span>{selected.target.type}</span><span>Target value</span><span className="pw-mono">{selected.target.value || "Entire project"}</span><span>Match logic</span><span>Match {selected.match_logic} conditions</span><span>Conditions</span><span>{selected.expressions.map((expression) => expressionOptions.find(([value]) => value === expression.type)?.[1] ?? expression.type).join(", ")}</span><span>Destinations</span><span>{selected.destinations.length || "No delivery destination"}</span></div></div>}{tab === "history" && <div className="pw-table">{history.data.length ? history.data.map((firing) => <button className="pw-row" style={{ gridTemplateColumns: "170px minmax(210px, 1fr) minmax(210px, 1fr)" }} key={firing.id} onClick={() => firing.tx_hash && router.push(`/explorer/${scope.network}/transaction/${encodeURIComponent(firing.tx_hash)}`)}><span>{timeLabel(firing.fired_at)}</span><span className="pw-mono">{firing.tx_hash ? truncateEntity(firing.tx_hash, 12, 9) : "No transaction"}</span><span className="pw-mono">{firing.simulation_id ? truncateEntity(firing.simulation_id, 10, 8) : "On-chain"}</span></button>) : <EmptyState icon={<History size={22} />} title="No firings" body="Matches from indexed on-chain transactions and simulations will appear here." />}</div>}</div></div>;

  return <div className="pw-page"><Header title="Alerts" description="Monitor Stellar transactions, Soroban calls, events, balances, state changes, and simulation failures." actions={<Button primary onClick={() => resetBuilder()}><Plus size={15} /> Create alert</Button>} />{message && <Message>{message}</Message>}{error && <Message error>{error}</Message>}<div className="pw-surface"><CatalogToolbar query={query} setQuery={setQuery} placeholder="Search alert rules" onAdd={() => resetBuilder()} addLabel="Create alert" />{!scope.project ? <EmptyState icon={<Bell size={22} />} title="Select a project" body="Monitoring rules are scoped to a Releeve project." /> : !visible.length ? <EmptyState icon={<Bell size={22} />} title={query ? "No matching alerts" : "No alert rules"} body={query ? "Try another rule name or target." : "Create a rule for failures, calls, events, balance changes, or state changes."} action={!query ? <Button primary onClick={() => resetBuilder()}><Plus size={15} /> Create alert</Button> : undefined} /> : <div className="pw-table"><div className="pw-row pw-row-header" style={{ gridTemplateColumns: "minmax(190px, 1fr) 160px minmax(180px, 1fr) 110px 40px" }}><span>Rule</span><span>Target</span><span>Conditions</span><span>Status</span><span /></div>{visible.map((rule) => <button className="pw-row" style={{ gridTemplateColumns: "minmax(190px, 1fr) 160px minmax(180px, 1fr) 110px 40px" }} key={rule.id} onClick={() => void openAlert(rule)}><span>{rule.name}</span><span className="pw-mono">{rule.target.value ? truncateEntity(rule.target.value, 8, 6) : rule.target.type}</span><span>{rule.expressions.length} / match {rule.match_logic}</span><StatusBadge status={rule.enabled ? "enabled" : "paused"} /><ChevronRight size={15} /></button>)}</div>}</div><Pagination page={page} onPage={load} />{showBuilder && <Modal title={editing ? "Edit alert" : "Create alert"} onClose={() => setShowBuilder(false)} footer={<><Button onClick={() => setShowBuilder(false)}>Cancel</Button><Button primary disabled={loading || !name.trim() || !expressions.length} onClick={() => void save()}>{loading ? <LoaderCircle size={14} /> : <Bell size={14} />} {editing ? "Save changes" : "Create alert"}</Button></>}><label className="pw-label">Rule name<input autoFocus className="pw-field" value={name} onChange={(event) => setName(event.target.value)} placeholder="Failed checkout invocation" /></label><div className="pw-field-grid"><label className="pw-label">Target<select className="pw-field" value={targetType} onChange={(event) => setTargetType(event.target.value)}><option value="project">Entire project</option><option value="network">Network</option><option value="address">Wallet or contract</option><option value="tag">Tag</option></select></label>{targetType !== "project" && <label className="pw-label">Target value<input className="pw-field pw-mono" value={targetValue} onChange={(event) => setTargetValue(event.target.value)} placeholder={targetType === "address" ? "G... or C..." : targetType === "network" ? scope.network : "production"} /></label>}</div><label className="pw-label">Match<select className="pw-field" value={matchLogic} onChange={(event) => setMatchLogic(event.target.value as "all" | "any")}><option value="all">All conditions</option><option value="any">Any condition</option></select></label><div className="pw-label"><span>Conditions</span>{expressions.map((expression, index) => <div className="pw-surface" style={{ padding: 10 }} key={index}><div className="pw-inline"><select className="pw-field" value={expression.type} onChange={(event) => setExpressions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value } : item))}>{expressionOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><Button iconOnly danger aria-label="Remove condition" disabled={expressions.length === 1} onClick={() => setExpressions((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} /></Button></div><label className="pw-label" style={{ marginTop: 8 }}>Params JSON<textarea className="pw-field pw-mono" rows={3} value={expression.params} onChange={(event) => setExpressions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, params: event.target.value } : item))} /></label></div>)}<Button onClick={() => setExpressions((current) => [...current, { type: "event_emitted", params: "{}" }])}><Plus size={14} /> Add condition</Button></div><label className="pw-inline"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Enable immediately</label></Modal>}</div>;
}
