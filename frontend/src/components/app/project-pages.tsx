"use client";

import { type FormEvent, type MouseEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  Check,
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
  MoreVertical,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
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
import { getRecentLedgers, lookupExplorer } from "@/lib/explorer-api";
import { truncateEntity } from "@/lib/explorer-routes";

import "./project-workflows.css";

export type ProjectScope = {
  organization: string | null;
  project: string | null;
  network: "mainnet" | "testnet" | "futurenet";
};

const contractNetworks = ["mainnet", "testnet", "futurenet"] as const;
type ContractNetwork = typeof contractNetworks[number];

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

const refreshSpinDelay = () => new Promise<void>((resolve) => {
  window.setTimeout(resolve, MIN_REFRESH_SPIN_MS);
});

const walletCheckNetworks = ["mainnet", "testnet"] as const;
type WalletCheckNetwork = typeof walletCheckNetworks[number];
type WalletNetworkCheck = { exists: boolean; loading: boolean; error: string | null };

const emptyWalletNetworkChecks = (): Record<WalletCheckNetwork, WalletNetworkCheck> => ({
  mainnet: { exists: false, loading: false, error: null },
  testnet: { exists: false, loading: false, error: null },
});

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

function headerIcon(title: string) {
  const key = title.toLowerCase();
  if (key.includes("wallet")) return <Wallet size={38} strokeWidth={1.35} />;
  if (key.includes("contract")) return <Box size={38} strokeWidth={1.35} />;
  if (key.includes("environment")) return <Blocks size={38} strokeWidth={1.35} />;
  if (key.includes("simulator") || key.includes("simulation")) return <Play size={38} strokeWidth={1.35} />;
  if (key.includes("alert")) return <Bell size={38} strokeWidth={1.35} />;
  return <Activity size={38} strokeWidth={1.35} />;
}

function Header({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return <div className="pw-header"><div className="pw-header-mark" aria-hidden="true">{headerIcon(title)}</div><div className="pw-header-copy"><h1>{title}</h1><p>{description}</p></div>{actions && <div className="pw-actions">{actions}</div>}</div>;
}

function Button({ children, primary, danger, iconOnly, className = "", type, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; danger?: boolean; iconOnly?: boolean }) {
  return <button type={type ?? (primary && !props.onClick ? "submit" : "button")} className={`pw-button ${primary ? "pw-button-primary" : ""} ${danger ? "pw-button-danger" : ""} ${iconOnly ? "pw-icon-button" : ""} ${className}`} {...props}>{children}</button>;
}

function Message({ children, error }: { children: ReactNode; error?: boolean }) {
  return <div className={`pw-message ${error ? "pw-message-error" : ""}`}>{children}</div>;
}

function ToastPopup({ message, kind = "success", onDone }: { message: string | null; kind?: "success" | "error"; onDone: () => void }) {
  if (!message) return null;
  const Icon = kind === "error" ? XCircle : Check;
  if (typeof document === "undefined") return null;
  return createPortal((
    <div className="pw-toast-container" role="status" aria-live="polite">
      <div className={`pw-toast pw-toast-${kind}`} key={message}>
        <div className="pw-toast-fill" onAnimationEnd={onDone} />
        <div className="pw-toast-content">
          <Icon size={16} />
          <span>{message}</span>
        </div>
      </div>
    </div>
  ), document.body);
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const color = ["healthy", "success", "enabled", "syncing"].includes(normalized) ? "var(--green)" : ["failed", "error", "degraded"].includes(normalized) ? "var(--red)" : "var(--text-dim)";
  return <span className="pw-badge" style={{ color }}><span className="pw-badge-dot" />{status}</span>;
}

function StellarLogo({ size = 13 }: { size?: number }) {
  return <img src="/stellar-logo.jpg" alt="Stellar" width={size} height={size} className="pw-stellar-logo" />;
}

function NetworkLabel({ network }: { network: string }) {
  return <span className="pw-network-label"><StellarLogo />{network}</span>;
}

function Modal({ title, children, onClose, footer }: { title: string; children: ReactNode; onClose: () => void; footer: ReactNode }) {
  return <div className="pw-modal-backdrop" role="presentation" onMouseDown={onClose}><div className="pw-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}><div className="pw-modal-head"><strong>{title}</strong><Button iconOnly aria-label="Close" onClick={onClose}><X size={16} /></Button></div><div className="pw-modal-body">{children}</div><div className="pw-modal-foot">{footer}</div></div></div>;
}

function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return <div className="pw-empty"><div className="pw-empty-inner"><span className="pw-empty-icon">{icon}</span><h2>{title}</h2><p>{body}</p>{action}</div></div>;
}

function CreatePrompt({ onAction, label }: { onAction: () => void; label: string }) {
  return <div className="pw-create-box"><Button onClick={onAction}><Plus size={18} strokeWidth={2.75} /> {label}</Button></div>;
}

function Pagination({ page, onPage }: { page: CursorPage<unknown>; onPage: (cursor: string | null) => void }) {
  const previous = cursorValue(page, "prev");
  const next = cursorValue(page, "next");
  if (!previous && !next) return null;
  return <div className="pw-actions" style={{ justifyContent: "flex-end", marginTop: 10 }}><Button disabled={!previous} onClick={() => onPage(previous)}><ArrowLeft size={14} /> Back</Button><Button disabled={!next} onClick={() => onPage(next)}>Next <ChevronRight size={14} /></Button></div>;
}

function CatalogToolbar({ query, setQuery, placeholder, onAdd, addLabel, filters = true }: { query: string; setQuery: (value: string) => void; placeholder: string; onAdd: () => void; addLabel: string; filters?: boolean }) {
  return <div className="pw-toolbar"><div className="pw-search"><Search size={16} /><input className="pw-field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} /></div><div className="pw-toolbar-actions">{filters && <Button aria-label="Filter status"><ListFilter size={15} /> Filter status</Button>}<Button onClick={onAdd}><Plus size={15} /> {addLabel}</Button></div></div>;
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
  const [walletName, setWalletName] = useState("Wallet");
  const [walletVerified, setWalletVerified] = useState(false);
  const [verifyingWallet, setVerifyingWallet] = useState(false);
  const [walletVerifyError, setWalletVerifyError] = useState<string | null>(null);
  const [walletNetworkChecks, setWalletNetworkChecks] = useState<Record<WalletCheckNetwork, WalletNetworkCheck>>(() => emptyWalletNetworkChecks());
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastError, setToastError] = useState<string | null>(null);
  const [selectedWallets, setSelectedWallets] = useState<Set<string>>(() => new Set());
  const [tagTarget, setTagTarget] = useState<TrackedEntity | null>(null);
  const [bulkTagging, setBulkTagging] = useState(false);
  const [tagName, setTagName] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<TrackedEntity[] | null>(null);
  const [menuWallet, setMenuWallet] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<TrackedEntity | null>(null);
  const [renameName, setRenameName] = useState("");
  const [copiedWallet, setCopiedWallet] = useState<string | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const walletNameRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async (cursor: string | null = null) => {
    const path = scopePath(scope, `/accounts?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    if (!path) return;
    try {
      setPage(await api.get<CursorPage<TrackedEntity>>(path));
      setError(null);
      setToastError(null);
    } catch (cause) {
      setToastError(errorMessage(cause, "Could not load wallets."));
    }
  }, [scope]);

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

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!menuWallet) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".pw-row-menu-cell")) return;
      setMenuWallet(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuWallet]);

  const track = async (event: FormEvent) => {
    event.preventDefault();
    const path = scopePath(scope, "/accounts");
    if (!path || !address.trim() || !walletVerified) return;
    setLoading(true);
    try {
      await api.post(path, { address: address.trim(), name: walletName.trim() || "Wallet", tags: [] });
      setAddress("");
      setWalletName("Wallet");
      setWalletVerified(false);
      setShowAdd(false);
      setError(null);
      await load();
    } catch (cause) {
      setError(errorMessage(cause, "Could not add this wallet."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!showAdd) return;
    const value = address.trim();
    setWalletVerified(false);
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
      const results = await Promise.all(walletCheckNetworks.map(async (network) => {
        const result = await lookupExplorer(network, value, controller.signal);
        const exists = Boolean(result.data?.suggestions.some((suggestion) => suggestion.kind === "account" && suggestion.value.toUpperCase() === value.toUpperCase()));
        return [network, { exists, loading: false, error: exists ? null : result.error }] as const;
      }));
      if (controller.signal.aborted) return;
      const nextChecks = Object.fromEntries(results) as Record<WalletCheckNetwork, WalletNetworkCheck>;
      const activeNetwork = walletCheckNetworks.includes(scope.network as WalletCheckNetwork) ? scope.network as WalletCheckNetwork : null;
      const activeExists = activeNetwork ? nextChecks[activeNetwork].exists : false;
      const foundAnyNetwork = walletCheckNetworks.some((network) => nextChecks[network].exists);
      setWalletNetworkChecks(nextChecks);
      setWalletVerified(activeExists);
      setWalletVerifyError(foundAnyNetwork ? null : "This account was not found on mainnet or testnet.");
      setVerifyingWallet(false);
    }, 300);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [address, scope.network, showAdd]);

  const openWallet = async (value: string) => {
    const base = scopePath(scope, `/accounts/${encodeURIComponent(value)}`);
    if (!base) return;
    setLoading(true);
    try {
      const [summary, txPage] = await Promise.all([api.get<Record<string, unknown>>(base), api.get<CursorPage<ProjectTransaction>>(`${base}/transactions?limit=20`)]);
      setSelected(summary); setTransactions(txPage); setTab("overview"); setError(null);
    } catch (cause) { setError(errorMessage(cause, "Could not open this wallet.")); } finally { setLoading(false); }
  };

  const walletTagNames = useCallback((entity: TrackedEntity) => (entity.tags ?? []).map((tag) => typeof tag === "string" ? tag : tag.name ?? "").filter(Boolean), []);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return page.data;
    return page.data.filter((entity) => [entity.address, entity.name ?? "Wallet", entity.network, ...walletTagNames(entity)].some((value) => value.toLowerCase().includes(needle)));
  }, [page.data, query, walletTagNames]);
  const allVisibleSelected = visible.length > 0 && visible.every((entity) => selectedWallets.has(entity.address));
  const selectedVisible = visible.filter((entity) => selectedWallets.has(entity.address));
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selectedVisible.length > 0 && !allVisibleSelected;
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
      if (allVisibleSelected) visible.forEach((entity) => next.delete(entity.address));
      else visible.forEach((entity) => next.add(entity.address));
      return next;
    });
  };
  const copyWalletAddress = async (event: MouseEvent, value: string) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopiedWallet(value);
      window.setTimeout(() => setCopiedWallet((current) => current === value ? null : current), 1200);
    } catch (cause) {
      setError(errorMessage(cause, "Could not copy this wallet address."));
    }
  };
  const openRenameWallet = (entity: TrackedEntity) => {
    setMenuWallet(null);
    setRenameTarget(entity);
    setRenameName(entity.name?.trim() || "Wallet");
  };
  const renameWallet = async (event: FormEvent) => {
    event.preventDefault();
    if (!renameTarget || !renameName.trim()) return;
    const path = scopePath(scope, `/accounts/${encodeURIComponent(renameTarget.address)}`);
    if (!path) return;
    setLoading(true);
    try {
      await api.patch(path, { name: renameName.trim() });
      setPage((current) => ({
        ...current,
        data: current.data.map((entity) => entity.address === renameTarget.address ? { ...entity, name: renameName.trim() } : entity),
      }));
      setRenameTarget(null);
      setRenameName("");
      setError(null);
    } catch (cause) {
      const detail = errorMessage(cause, "Could not rename this wallet.");
      setError(detail === "Could not rename this wallet." ? `${detail} Make sure the backend has been restarted after the wallet rename route was added.` : detail);
    } finally {
      setLoading(false);
    }
  };
  const saveTag = async (event: FormEvent) => {
    event.preventDefault();
    const name = tagName.trim();
    const targets = bulkTagging ? selectedVisible : tagTarget ? [tagTarget] : [];
    if (!targets.length || !name) return;
    const entityIds = targets.map((entity) => entity.id).filter(Boolean) as string[];
    const path = scopePath(scope, "/tags");
    if (!path || entityIds.length !== targets.length) {
      setError("Reload this wallet list before adding a tag.");
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
      await Promise.all(entityIds.map((entityId) => api.post(`${path}/${encodeURIComponent(tag.id)}/attach`, { entity_type: "wallet", entity_id: entityId })));
      const taggedAddresses = new Set(targets.map((entity) => entity.address));
      setPage((current) => ({
        ...current,
        data: current.data.map((entity) => {
          if (!taggedAddresses.has(entity.address)) return entity;
          const existingTags = entity.tags ?? [];
          const hasTag = existingTags.some((item) => (typeof item === "string" ? item : item.name) === tag.name);
          return { ...entity, tags: hasTag ? existingTags : [...existingTags, tag] };
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
      await api.post(path, { addresses: targets.map((entity) => entity.address) });
      const removed = new Set(targets.map((entity) => entity.address));
      setPage((current) => ({ ...current, data: current.data.filter((entity) => !removed.has(entity.address)) }));
      setSelectedWallets((current) => {
        const next = new Set(current);
        removed.forEach((address) => next.delete(address));
        return next;
      });
      setError(null);
      setDeleteConfirm(false);
      setDeleteTargets(null);
    } catch (cause) {
      const detail = cause instanceof Error && cause.message ? ` ${cause.message}` : "";
      setError(`Could not delete the selected wallets.${detail}`);
    } finally {
      setLoading(false);
    }
  };
  const selectedAddress = selected ? String(selected.address) : "";
  const holdings = Array.isArray(selected?.token_holdings) ? selected.token_holdings as Array<Record<string, unknown>> : [];
  const foundWalletNetworks = walletCheckNetworks.filter((network) => walletNetworkChecks[network].exists);
  const activeWalletNetwork = walletCheckNetworks.includes(scope.network as WalletCheckNetwork) ? scope.network as WalletCheckNetwork : null;

  if (selected) {
    return (
      <div className="pw-page pw-wallets-page">
        <div className="pw-detail-head">
          <div className="pw-inline">
            <Button iconOnly aria-label="Back to wallets" onClick={() => setSelected(null)}><ArrowLeft size={16} /></Button>
            <EntityIdenticon value={selectedAddress} kind="account" size={34} />
            <div className="pw-detail-title">
              <p>Wallet</p>
              <h1 className="pw-mono">{selectedAddress}</h1>
              <p>{scope.network} / shared project address book</p>
            </div>
          </div>
          <div className="pw-actions">
            <Button onClick={() => navigator.clipboard.writeText(selectedAddress)}><Copy size={14} /> Copy</Button>
            <Button onClick={() => router.push(`/explorer/${scope.network}/account/${encodeURIComponent(selectedAddress)}`)}>Explorer</Button>
            <Button primary onClick={() => router.push(`/simulator?impersonate=${encodeURIComponent(selectedAddress)}`)}><Play size={14} /> Simulate as wallet</Button>
          </div>
        </div>
        <div className="pw-surface">
          <div className="pw-stats">
            <div className="pw-stat"><span>XLM balance</span><strong>{String(selected.xlm_balance ?? "Unavailable")}</strong></div>
            <div className="pw-stat"><span>Assets</span><strong>{holdings.length}</strong></div>
            <div className="pw-stat"><span>Network</span><strong>{String(selected.network ?? scope.network)}</strong></div>
            <div className="pw-stat"><span>Project tracking</span><strong>{selected.tracked ? "Tracked" : "Not tracked"}</strong></div>
          </div>
          <div className="pw-tabs">
            <button data-active={tab === "overview"} onClick={() => setTab("overview")}>Overview</button>
            <button data-active={tab === "transactions"} onClick={() => setTab("transactions")}>Transactions</button>
            <button data-active={tab === "assets"} onClick={() => setTab("assets")}>Assets</button>
          </div>
          {tab === "overview" && <div className="pw-panel-body"><div className="pw-kv"><span>Account ID</span><span className="pw-mono">{selectedAddress}</span><span>Network</span><span>{String(selected.network ?? scope.network)}</span><span>Source map</span><span>{String(selected.source_map_status ?? "not available")}</span><span>Last indexed activity</span><span>{transactions.data[0] ? timeLabel(transactions.data[0].timestamp) : "No indexed activity"}</span></div></div>}
          {tab === "transactions" && <><TxRows page={transactions} network={scope.network} onOpen={(hash) => router.push(`/explorer/${scope.network}/transaction/${encodeURIComponent(hash)}`)} /><Pagination page={transactions} onPage={async (cursor) => { const path = scopePath(scope, `/accounts/${encodeURIComponent(selectedAddress)}/transactions?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`); if (path) setTransactions(await api.get(path)); }} /></>}
          {tab === "assets" && <div className="pw-table">{holdings.length ? holdings.map((holding, index) => <div className="pw-row" style={{ gridTemplateColumns: "minmax(160px, 1fr) 180px 180px" }} key={index}><span className="pw-mono">{String(holding.asset ?? "XLM")}</span><span>{String(holding.balance ?? "Unavailable")}</span><span>{holding.usd_value ? `$${String(holding.usd_value)}` : "No price"}</span></div>) : <EmptyState icon={<CircleDollarSign size={22} />} title="No indexed balances" body="Asset balances will appear after this account has been observed by the indexer." />}</div>}
        </div>
      </div>
    );
  }

  const walletColumns = "34px minmax(260px, 1fr) 128px minmax(150px, .55fr) 96px 36px";

  return (
    <div className="pw-page pw-wallets-page">
      <ToastPopup message={toastError} kind="error" onDone={() => setToastError(null)} />
      <Header title="Wallets" description="Manage project wallets, treasuries, signers, issuers, and test identities in one shared catalog." />
      <div className="pw-surface">
        <div className="pw-toolbar">
          <div className="pw-search">
            <Search size={16} />
            <input className="pw-field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search wallets" />
          </div>
          <div className="pw-toolbar-actions">
            <Button iconOnly aria-label="Refresh wallets" title="Refresh wallets" disabled={loading || refreshing} onClick={() => void refreshList()}><RotateCcw className={refreshing ? "pw-spin" : ""} size={15} /></Button>
            <Button iconOnly aria-label="Tag selected wallets" title="Tag selected wallets" disabled={!selectedVisible.length} onClick={() => { setBulkTagging(true); setTagTarget(null); setTagName(""); }}><Tag size={15} /></Button>
            <Button iconOnly danger aria-label="Delete selected wallets" title="Delete selected wallets" disabled={!selectedVisible.length || loading} onClick={() => { setDeleteTargets(null); setDeleteConfirm(true); }}><Trash2 size={15} /></Button>
            <Button onClick={() => { setAddress(""); setWalletName("Wallet"); setWalletVerified(false); setWalletVerifyError(null); setShowAdd(true); }}><Plus size={15} /> Add wallet</Button>
          </div>
        </div>

        {loading && !page.data.length ? null : !scope.project ? null : visible.length ? (
          <div className="pw-table pw-wallet-table">
            <div className="pw-row pw-row-header pw-wallet-row" style={{ gridTemplateColumns: walletColumns }}>
              <span className="pw-select-cell"><input ref={selectAllRef} type="checkbox" aria-label="Select all wallets" checked={allVisibleSelected} onChange={toggleAllWallets} /></span>
              <span>Wallet</span>
              <span>Network</span>
              <span>Tags</span>
              <span>Type</span>
              <span />
            </div>
            {visible.map((entity) => {
              const tags = walletTagNames(entity);
              const label = entity.name?.trim() || "Wallet";
              return (
                <div className="pw-row pw-wallet-row pw-clickable-row" role="button" tabIndex={0} style={{ gridTemplateColumns: walletColumns }} key={entity.address} onClick={() => void openWallet(entity.address)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openWallet(entity.address); } }}>
                  <span className="pw-select-cell" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Select ${entity.address}`} checked={selectedWallets.has(entity.address)} onChange={() => toggleWallet(entity.address)} /></span>
                  <div className="pw-entity-cell">
                    <EntityIdenticon value={entity.address} kind="account" size={28} />
                    <span className="pw-wallet-copy-wrap">
                      <small>{label}</small>
                      <strong className="pw-mono pw-wallet-address">{truncateEntity(entity.address, 15, 11)}<button type="button" className="pw-copy-inline" aria-label={`Copy ${entity.address}`} onClick={(event) => void copyWalletAddress(event, entity.address)}><Copy size={12} /></button><span className="pw-copy-tooltip" data-visible={copiedWallet === entity.address}>Copied</span></strong>
                    </span>
                  </div>
                  <NetworkLabel network={entity.network || scope.network} />
                  <span className="pw-tag-cell" onClick={(event) => event.stopPropagation()}>{tags.length ? <span className="pw-tag-list">{tags.map((tag) => <span className="pw-tag-pill" key={`${entity.address}-${tag}`}><Tag size={11} />{tag}</span>)}</span> : <button type="button" className="pw-tag-add" onClick={() => { setTagTarget(entity); setBulkTagging(false); setTagName(""); }}><Plus size={11} />Add tag</button>}</span>
                  <span className="pw-type-label">Wallet</span>
                  <span className="pw-row-menu-cell" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                    <Button iconOnly aria-label={`Wallet actions for ${entity.address}`} aria-expanded={menuWallet === entity.address} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setMenuWallet((current) => current === entity.address ? null : entity.address); }}><MoreVertical size={15} /></Button>
                    {menuWallet === entity.address && (
                      <div className="pw-row-menu" role="menu">
                        <button type="button" role="menuitem" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setMenuWallet(null); setTagTarget(entity); setBulkTagging(false); setTagName(""); }}><Tag size={13} /> Add tag</button>
                        <button type="button" role="menuitem" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); openRenameWallet(entity); }}><Pencil size={13} /> Rename</button>
                        <button type="button" role="menuitem" className="pw-danger-menu-item" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setMenuWallet(null); setDeleteTargets([entity]); setDeleteConfirm(true); }}><Trash2 size={13} /> Delete</button>
                      </div>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
      <Pagination page={page} onPage={load} />

      {showAdd && (
        <Modal title="Add wallet" onClose={() => setShowAdd(false)} footer={<><Button onClick={() => setShowAdd(false)}>Cancel</Button><Button primary disabled={loading || verifyingWallet || !walletVerified || !address.trim()} onClick={() => document.getElementById("add-wallet-form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))}>{(loading || verifyingWallet) && <LoaderCircle size={14} />} Add wallet</Button></>}>
          <form id="add-wallet-form" onSubmit={track}>
            <label className="pw-label">Stellar account ID<input autoFocus className="pw-field pw-mono" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="G..." /></label>
            {address.trim() && (verifyingWallet || walletCheckNetworks.some((network) => walletNetworkChecks[network].exists)) && (
              <div className="pw-wallet-network-panel" aria-label="Wallet network availability">
                {walletCheckNetworks.filter((network) => verifyingWallet || walletNetworkChecks[network].exists).map((network) => {
                  const check = walletNetworkChecks[network];
                  return (
                    <div className="pw-wallet-network-row" key={network} data-active={scope.network === network}>
                      <label className="pw-wallet-network-check">
                        <input type="checkbox" checked={check.exists} readOnly />
                        <span><NetworkLabel network={network} /><small>{check.loading ? "Checking..." : "Found on network"}</small></span>
                      </label>
                      {check.exists && <button type="button" className="pw-rename-link" onClick={() => walletNameRef.current?.focus()}><Pencil size={12} /> Rename</button>}
                    </div>
                  );
                })}
              </div>
            )}
            <label className="pw-label">Name<input ref={walletNameRef} className="pw-field" value={walletName} onChange={(event) => setWalletName(event.target.value)} placeholder="Wallet" /></label>
          </form>
          {address.trim() && verifyingWallet && <Message>Checking mainnet and testnet...</Message>}
          {address.trim() && !verifyingWallet && foundWalletNetworks.length > 0 && activeWalletNetwork && !walletNetworkChecks[activeWalletNetwork].exists && <Message>This project is set to {scope.network}. Switch project network to add the wallet from {foundWalletNetworks.join(" or ")}.</Message>}
          {walletVerifyError && <Message error>{walletVerifyError}</Message>}
          <Message>The account is verified on {scope.network} before it is saved to this project. Releeve never stores its secret key.</Message>
        </Modal>
      )}

      {(tagTarget || bulkTagging) && (
        <Modal title={bulkTagging ? "Tag selected wallets" : "Add wallet tag"} onClose={() => { setTagTarget(null); setBulkTagging(false); }} footer={<><Button onClick={() => { setTagTarget(null); setBulkTagging(false); }}>Cancel</Button><Button primary disabled={loading || !tagName.trim()} onClick={() => document.getElementById("wallet-tag-form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))}>{loading ? <LoaderCircle size={14} /> : <Plus size={14} />} Save tag</Button></>}>
          <form id="wallet-tag-form" onSubmit={saveTag}>
            <label className="pw-label">Tag name<input autoFocus className="pw-field" value={tagName} onChange={(event) => setTagName(event.target.value)} placeholder="Treasury" /></label>
            <p className="pw-modal-note pw-mono">{bulkTagging ? `${selectedVisible.length} selected wallets` : tagTarget ? truncateEntity(tagTarget.address, 18, 12) : ""}</p>
          </form>
        </Modal>
      )}

      {renameTarget && (
        <Modal title="Rename wallet" onClose={() => { setRenameTarget(null); setRenameName(""); }} footer={<><Button onClick={() => { setRenameTarget(null); setRenameName(""); }}>Cancel</Button><Button primary disabled={loading || !renameName.trim()} onClick={() => document.getElementById("wallet-rename-form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))}>{loading ? <LoaderCircle size={14} /> : <Pencil size={14} />} Save name</Button></>}>
          <form id="wallet-rename-form" onSubmit={renameWallet}>
            <label className="pw-label">Wallet name<input autoFocus className="pw-field" value={renameName} onChange={(event) => setRenameName(event.target.value)} placeholder="Wallet" /></label>
            <p className="pw-modal-note pw-mono">{truncateEntity(renameTarget.address, 18, 12)}</p>
          </form>
        </Modal>
      )}

      {deleteConfirm && (
        <Modal title={deleteTargets?.length === 1 ? "Delete wallet" : "Delete selected wallets"} onClose={() => { setDeleteConfirm(false); setDeleteTargets(null); }} footer={<><Button onClick={() => { setDeleteConfirm(false); setDeleteTargets(null); }}>Cancel</Button><Button danger disabled={loading} onClick={() => void deleteSelectedWallets()}>{loading ? <LoaderCircle size={14} /> : <Trash2 size={14} />} Delete</Button></>}>
          <p className="pw-modal-note">Remove {(deleteTargets ?? selectedVisible).length} wallet{(deleteTargets ?? selectedVisible).length === 1 ? "" : "s"} from this project. This does not affect the Stellar account or its on-chain data.</p>
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
  const [contractName, setContractName] = useState("");
  const [contractColor, setContractColor] = useState("");
  const [contractNetwork, setContractNetwork] = useState<ContractNetwork>(scope.network);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [networkMenuOpen, setNetworkMenuOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedContracts, setSelectedContracts] = useState<Set<string>>(() => new Set());
  const [tagTarget, setTagTarget] = useState<TrackedEntity | null>(null);
  const [bulkTagging, setBulkTagging] = useState(false);
  const [tagName, setTagName] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<TrackedEntity[] | null>(null);
  const [menuContract, setMenuContract] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<TrackedEntity | null>(null);
  const [renameName, setRenameName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastError, setToastError] = useState<string | null>(null);
  const contractSelectAllRef = useRef<HTMLInputElement | null>(null);
  const contractAddressValid = isValidStellarContractId(address);

  const load = useCallback(async (cursor: string | null = null) => {
    const path = scopePath(scope, `/contracts?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    if (!path) return;
    try { setPage(await api.get(path)); setError(null); setToastError(null); } catch (cause) { setToastError(errorMessage(cause, "Could not load contracts.")); }
  }, [scope]);

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

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!menuContract) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".pw-row-menu-cell")) return;
      setMenuContract(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuContract]);

  const track = async (event: FormEvent) => {
    event.preventDefault();
    const path = scopePath(scope, "/contracts");
    if (!path || !contractAddressValid) return;
    setLoading(true);
    try { await api.post(path, { address: address.trim().toUpperCase(), network: contractNetwork, name: contractName.trim() || null, appearance_color: contractColor || null, tags: [] }); setAddress(""); setContractName(""); setContractColor(""); setContractNetwork(scope.network); setShowAdd(false); setError(null); setToastError(null); await load(); } catch (cause) { setToastError(errorMessage(cause, "Could not add this contract.")); } finally { setLoading(false); }
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

  const contractTagNames = useCallback((entity: TrackedEntity) => (entity.tags ?? []).map((tag) => typeof tag === "string" ? tag : tag.name ?? "").filter(Boolean), []);
  const visible = page.data.filter((entity) => !query.trim() || [entity.address, entity.name ?? "", entity.network, ...contractTagNames(entity)].some((value) => value.toLowerCase().includes(query.trim().toLowerCase())));
  const allContractsSelected = visible.length > 0 && visible.every((entity) => selectedContracts.has(entity.address));
  const selectedVisibleContracts = visible.filter((entity) => selectedContracts.has(entity.address));
  useEffect(() => {
    if (contractSelectAllRef.current) contractSelectAllRef.current.indeterminate = selectedVisibleContracts.length > 0 && !allContractsSelected;
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
      if (allContractsSelected) visible.forEach((entity) => next.delete(entity.address));
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
    const path = scopePath(scope, `/contracts/${encodeURIComponent(renameTarget.address)}`);
    if (!path) return;
    setLoading(true);
    try {
      await api.patch(path, { name: renameName.trim() });
      setPage((current) => ({
        ...current,
        data: current.data.map((entity) => entity.address === renameTarget.address ? { ...entity, name: renameName.trim() } : entity),
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
    const targets = bulkTagging ? selectedVisibleContracts : tagTarget ? [tagTarget] : [];
    if (!targets.length || !name) return;
    const entityIds = targets.map((entity) => entity.id).filter(Boolean) as string[];
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
      await Promise.all(entityIds.map((entityId) => api.post(`${path}/${encodeURIComponent(tag.id)}/attach`, { entity_type: "contract", entity_id: entityId })));
      const taggedAddresses = new Set(targets.map((entity) => entity.address));
      setPage((current) => ({
        ...current,
        data: current.data.map((entity) => {
          if (!taggedAddresses.has(entity.address)) return entity;
          const existingTags = entity.tags ?? [];
          const hasTag = existingTags.some((item) => (typeof item === "string" ? item : item.name) === tag.name);
          return { ...entity, tags: hasTag ? existingTags : [...existingTags, tag] };
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
      await api.post(path, { addresses: targets.map((entity) => entity.address) });
      const removed = new Set(targets.map((entity) => entity.address));
      setPage((current) => ({ ...current, data: current.data.filter((entity) => !removed.has(entity.address)) }));
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
      setToastError(errorMessage(cause, "Could not delete the selected contracts."));
    } finally {
      setLoading(false);
    }
  };
  const selectedAddress = selected ? String(selected.address) : "";
  const verification = selected?.verification as Record<string, unknown> | undefined;
  const toolchain = selected?.toolchain as Record<string, unknown> | undefined;
  const previewAddress = address.trim() || "CA3D5Y4XU6K2R8QZ9M1P4N7T5B2V6H8J3L9S0W1X2Y3Z4A5B6C7D8";
  const previewPeer = "GBZQY7F3L2A9K6M4X8C5V1N0T3R7S9P2D6H4J8L1Q5W3E0Y7U2I6O";
  const contractIconColor = contractColor || null;

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

  if (selected) return <div className="pw-page"><div className="pw-detail-head"><div className="pw-inline"><Button iconOnly aria-label="Back to contracts" onClick={() => setSelected(null)}><ArrowLeft size={16} /></Button><EntityIdenticon value={selectedAddress} kind="contract" size={34} /><div className="pw-detail-title"><p>Soroban contract</p><h1 className="pw-mono">{selectedAddress}</h1><p>{scope.network} / shared contract catalog</p></div></div><div className="pw-actions"><Button onClick={() => navigator.clipboard.writeText(selectedAddress)}><Copy size={14} /> Copy</Button><Button onClick={() => router.push(`/explorer/${scope.network}/contract/${encodeURIComponent(selectedAddress)}`)}>Explorer</Button><Button primary onClick={() => router.push(`/simulator?contract=${encodeURIComponent(selectedAddress)}`)}><Play size={14} /> Simulate</Button></div></div><div className="pw-surface"><div className="pw-stats"><div className="pw-stat"><span>Verification</span><strong>{String(verification?.status ?? "unverified")}</strong></div><div className="pw-stat"><span>WASM hash</span><strong className="pw-mono">{selected.current_wasm_hash ? truncateEntity(String(selected.current_wasm_hash), 8, 7) : "Unavailable"}</strong></div><div className="pw-stat"><span>Events indexed</span><strong>{events.data.length}</strong></div><div className="pw-stat"><span>Debug symbols</span><strong>{toolchain?.debug_symbols_present ? "Present" : "Not available"}</strong></div></div><div className="pw-tabs"><button data-active={tab === "overview"} onClick={() => setTab("overview")}>Overview</button><button data-active={tab === "transactions"} onClick={() => setTab("transactions")}>Transactions</button><button data-active={tab === "events"} onClick={() => setTab("events")}>Events</button><button data-active={tab === "source"} onClick={() => setTab("source")}>Source and WASM</button></div>{tab === "overview" && <div className="pw-panel-body"><div className="pw-kv"><span>Contract ID</span><span className="pw-mono">{selectedAddress}</span><span>Contract type</span><span>{String(selected.type ?? "contract")}</span><span>Soroban SDK</span><span>{String(toolchain?.soroban_sdk_version ?? "Unavailable")}</span><span>Rust version</span><span>{String(toolchain?.rust_version ?? "Unavailable")}</span><span>WASM target</span><span>{String(toolchain?.wasm_target ?? "Unavailable")}</span><span>Source mapping</span><span>{String(selected.source_map_status ?? "not available")}</span></div></div>}{tab === "transactions" && <TxRows page={transactions} network={scope.network} onOpen={(hash) => router.push(`/explorer/${scope.network}/transaction/${encodeURIComponent(hash)}`)} />}{tab === "events" && <div className="pw-table">{events.data.length ? events.data.map((event, index) => <button className="pw-row" style={{ gridTemplateColumns: "120px minmax(180px, 1fr) minmax(220px, 1fr) 130px" }} key={event.id || index} onClick={() => event.tx_hash && router.push(`/explorer/${scope.network}/transaction/${encodeURIComponent(event.tx_hash)}`)}><span>{event.ledger_sequence?.toLocaleString() || "-"}</span><span className="pw-mono">{JSON.stringify(event.topics)}</span><span className="pw-mono">{JSON.stringify(event.data)}</span><span>{timeLabel(event.timestamp)}</span></button>) : <EmptyState icon={<Activity size={22} />} title="No contract events" body="Indexed Soroban diagnostic and contract events will appear here." />}</div>}{tab === "source" && <div className="pw-panel-body">{source ? <pre className="pw-json">{JSON.stringify(source, null, 2)}</pre> : <EmptyState icon={<FileCode2 size={22} />} title="Source is not verified" body="Verified source, toolchain metadata, and WASM mapping will appear here when available." />}</div>}</div></div>;

  return (
    <div className="pw-page pw-contracts-page">
      <ToastPopup message={toastError} kind="error" onDone={() => setToastError(null)} />
      <Header title="Contracts" description="Manage Soroban contracts, verification state, source evidence, and simulation entry points in one place." />
      <div className="pw-surface">
        <div className="pw-toolbar">
          <div className="pw-search">
            <Search size={16} />
            <input className="pw-field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search contracts" />
          </div>
          <div className="pw-toolbar-actions">
            <Button onClick={() => router.push("/contracts?verify=1")}>Verify contract</Button>
            <Button iconOnly aria-label="Refresh contracts" title="Refresh contracts" disabled={loading || refreshing} onClick={() => void refreshList()}><RotateCcw className={refreshing ? "pw-spin" : ""} size={15} /></Button>
            <Button iconOnly aria-label="Tag selected contracts" title="Tag selected contracts" disabled={!selectedVisibleContracts.length} onClick={() => { setBulkTagging(true); setTagTarget(null); setTagName(""); }}><Tag size={15} /></Button>
            <Button iconOnly danger aria-label="Delete selected contracts" title="Delete selected contracts" disabled={!selectedVisibleContracts.length || loading} onClick={() => { setDeleteTargets(null); setDeleteConfirm(true); }}><Trash2 size={15} /></Button>
            <Button onClick={() => { setAddress(""); setContractName(""); setContractColor(""); setContractNetwork(scope.network); setAppearanceOpen(false); setShowAdd(true); }}><Plus size={15} /> Add contract</Button>
          </div>
        </div>
        {loading && !page.data.length ? null : !scope.project ? (
          <EmptyState icon={<Box size={22} />} title="Select a project" body="Contract catalogs are scoped to a Releeve project." />
        ) : visible.length ? (
          <div className="pw-table pw-contract-table">
            <div className="pw-row pw-row-header pw-wallet-row" style={{ gridTemplateColumns: "34px minmax(260px, 1fr) 128px minmax(150px, .55fr) 82px 36px" }}>
              <span className="pw-select-cell"><input ref={contractSelectAllRef} type="checkbox" aria-label="Select all contracts" checked={allContractsSelected} onChange={toggleAllContracts} /></span>
              <span>Contract</span><span>Network</span><span>Tags</span><span className="pw-verified-head">Verified</span><span />
            </div>
            {visible.map((entity) => {
              const label = entity.name?.trim() || "Soroban contract";
              const tags = contractTagNames(entity);
              const verified = String((entity as Record<string, unknown>).verification_status ?? (entity as Record<string, unknown>).status ?? "").toLowerCase() === "verified";
              return (
                <div className="pw-row pw-clickable-row" role="button" tabIndex={0} style={{ gridTemplateColumns: "34px minmax(260px, 1fr) 128px minmax(150px, .55fr) 82px 36px" }} key={entity.address} onClick={() => void openContract(entity.address)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openContract(entity.address); } }}>
                  <span className="pw-select-cell" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Select ${entity.address}`} checked={selectedContracts.has(entity.address)} onChange={() => toggleContract(entity.address)} /></span>
                  <span className="pw-entity-cell">
                    <EntityIdenticon value={entity.address} kind="contract" size={28} color={entity.appearance_color} />
                    <span><strong>{label}</strong><small className="pw-mono">{truncateEntity(entity.address, 15, 11)}</small></span>
                  </span>
                  <NetworkLabel network={entity.network || scope.network} />
                  <span className="pw-tag-cell" onClick={(event) => event.stopPropagation()}>{tags.length ? <span className="pw-tag-list">{tags.map((tag) => <span className="pw-tag-pill" key={`${entity.address}-${tag}`}><Tag size={11} />{tag}</span>)}</span> : <button type="button" className="pw-tag-add" onClick={() => { setTagTarget(entity); setBulkTagging(false); setTagName(""); }}><Plus size={11} />Add tag</button>}</span>
                  <span className={`pw-verify-state ${verified ? "pw-verified" : "pw-unverified"}`}>{verified ? <ShieldCheck size={14} /> : <X size={14} />}</span>
                  <span className="pw-row-menu-cell" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                    <Button iconOnly aria-label={`Contract actions for ${entity.address}`} aria-expanded={menuContract === entity.address} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setMenuContract((current) => current === entity.address ? null : entity.address); }}><MoreVertical size={15} /></Button>
                    {menuContract === entity.address && (
                      <div className="pw-row-menu" role="menu">
                        <button type="button" role="menuitem" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setMenuContract(null); setTagTarget(entity); setBulkTagging(false); setTagName(""); }}><Tag size={13} /> Add tag</button>
                        <button type="button" role="menuitem" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); openRenameContract(entity); }}><Pencil size={13} /> Rename</button>
                        <button type="button" role="menuitem" className="pw-danger-menu-item" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setMenuContract(null); setDeleteTargets([entity]); setDeleteConfirm(true); }}><Trash2 size={13} /> Delete</button>
                      </div>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
      <Pagination page={page} onPage={load} />
      {showAdd && (
        <Modal title="Add contract" onClose={() => setShowAdd(false)} footer={<><Button onClick={() => setShowAdd(false)}>Cancel</Button><Button primary disabled={loading || !contractAddressValid} onClick={() => document.getElementById("add-contract-form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))}>{loading ? <LoaderCircle size={14} /> : <Plus size={14} />} Save</Button></>}>
          <form id="add-contract-form" className="pw-add-contract-form" onSubmit={track}>
            <label className="pw-label">Contract ID<input autoFocus className="pw-field pw-mono" value={address} onChange={(event) => setAddress(event.target.value.trim().toUpperCase())} placeholder="C..." />{address.trim() && !contractAddressValid && <small>Enter a valid Stellar contract ID.</small>}</label>
            <label className="pw-label"><span className="pw-label-line">Name <span className="pw-label-optional">(optional)</span></span><input className="pw-field" value={contractName} onChange={(event) => setContractName(event.target.value)} placeholder="Enter name" /><small>Custom names keep important Soroban contracts recognizable across this project.</small></label>
            <label className="pw-label">Network<span className="pw-select-shell" onPointerDown={(event) => event.stopPropagation()}><button type="button" className="pw-select-trigger" aria-haspopup="listbox" aria-expanded={networkMenuOpen} onClick={() => setNetworkMenuOpen((open) => !open)}><NetworkLabel network={contractNetwork} /><ChevronDown size={15} /></button>{networkMenuOpen && <span className="pw-select-menu" role="listbox">{contractNetworks.map((network) => <button key={network} type="button" role="option" aria-selected={contractNetwork === network} data-active={contractNetwork === network} onClick={() => { setContractNetwork(network); setNetworkMenuOpen(false); }}><NetworkLabel network={network} /></button>)}</span>}</span></label>
            <div className="pw-contract-appearance">
              <button type="button" className="pw-accordion-trigger" onClick={() => setAppearanceOpen((open) => !open)} aria-expanded={appearanceOpen}><ChevronDown size={15} className={appearanceOpen ? "pw-rotated" : ""} /> Contract appearance</button>
              {appearanceOpen && (
                <div className="pw-accordion-panel">
                  <label className="pw-color-picker-row">
                    <span>Icon color</span>
                    <span className="pw-color-picker-control"><input type="color" value={contractColor || "#a3ff5f"} onChange={(event) => setContractColor(event.target.value)} /><button type="button" onClick={() => setContractColor("")}>Default</button></span>
                  </label>
                  <div className="pw-preview-section">
                    <p className="pw-preview-title">Transaction listing preview</p>
                    <div className="pw-address-list">
                      <div className="pw-address-column">
                        <span className="pw-address-label">From</span>
                        <div className="pw-address-item"><EntityIdenticon value={previewAddress} kind="contract" size={24} color={contractIconColor} /><span className="pw-address-text">{truncateEntity(previewAddress, 12, 9)}</span></div>
                      </div>
                      <div className="pw-address-column">
                        <span className="pw-address-label">To</span>
                        <div className="pw-address-item"><EntityIdenticon value={previewPeer} kind="account" size={24} /><span className="pw-address-text">{truncateEntity(previewPeer, 12, 9)}</span></div>
                      </div>
                    </div>
                  </div>
                  <div className="pw-trace-preview">
                    <p className="pw-preview-title">Trace preview</p>
                    <pre><span>[{contractName.trim() || "Contract"}] </span>{truncateEntity(previewAddress, 12, 9)} <b>=&gt;</b> {truncateEntity(previewPeer, 12, 9)}{"\n"}  .swap_exact_in(<i>asset</i> = "XLM", <i>amount</i> = 10000000) <b>=&gt;</b> ok</pre>
                  </div>
                </div>
              )}
            </div>
          </form>
        </Modal>
      )}
      {(tagTarget || bulkTagging) && (
        <Modal title={bulkTagging ? "Tag selected contracts" : "Add contract tag"} onClose={() => { setTagTarget(null); setBulkTagging(false); }} footer={<><Button onClick={() => { setTagTarget(null); setBulkTagging(false); }}>Cancel</Button><Button primary disabled={loading || !tagName.trim()} onClick={() => document.getElementById("contract-tag-form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))}>{loading ? <LoaderCircle size={14} /> : <Plus size={14} />} Save tag</Button></>}>
          <form id="contract-tag-form" onSubmit={saveContractTag}>
            <label className="pw-label">Tag name<input autoFocus className="pw-field" value={tagName} onChange={(event) => setTagName(event.target.value)} placeholder="Core protocol" /></label>
            <p className="pw-modal-note pw-mono">{bulkTagging ? `${selectedVisibleContracts.length} selected contracts` : tagTarget ? truncateEntity(tagTarget.address, 18, 12) : ""}</p>
          </form>
        </Modal>
      )}
      {renameTarget && (
        <Modal title="Rename contract" onClose={() => { setRenameTarget(null); setRenameName(""); }} footer={<><Button onClick={() => { setRenameTarget(null); setRenameName(""); }}>Cancel</Button><Button primary disabled={loading || !renameName.trim()} onClick={() => document.getElementById("contract-rename-form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))}>{loading ? <LoaderCircle size={14} /> : <Pencil size={14} />} Save name</Button></>}>
          <form id="contract-rename-form" onSubmit={renameContract}>
            <label className="pw-label">Contract name<input autoFocus className="pw-field" value={renameName} onChange={(event) => setRenameName(event.target.value)} placeholder="Soroban contract" /></label>
            <p className="pw-modal-note pw-mono">{truncateEntity(renameTarget.address, 18, 12)}</p>
          </form>
        </Modal>
      )}
      {deleteConfirm && (
        <Modal title={deleteTargets?.length === 1 ? "Delete contract" : "Delete selected contracts"} onClose={() => { setDeleteConfirm(false); setDeleteTargets(null); }} footer={<><Button onClick={() => { setDeleteConfirm(false); setDeleteTargets(null); }}>Cancel</Button><Button danger disabled={loading} onClick={() => void deleteSelectedContracts()}>{loading ? <LoaderCircle size={14} /> : <Trash2 size={14} />} Delete</Button></>}>
          <p className="pw-modal-note">Remove {(deleteTargets ?? selectedVisibleContracts).length} contract{(deleteTargets ?? selectedVisibleContracts).length === 1 ? "" : "s"} from this project. This does not affect the deployed Stellar contract or its on-chain data.</p>
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
  const { selected, address, network, verification, toolchain, transactions, events, source, verifications, tab, setTab, router } = props;
  return <div className="pw-page"><div className="pw-detail-head"><div className="pw-inline"><Button iconOnly aria-label="Back to contracts" onClick={props.onBack}><ArrowLeft size={16} /></Button><EntityIdenticon value={address} kind="contract" size={34} /><div className="pw-detail-title"><p>Soroban contract</p><h1 className="pw-mono">{address}</h1><p>{network} / shared contract catalog</p></div></div><div className="pw-actions"><Button onClick={() => navigator.clipboard.writeText(address)}><Copy size={14} /> Copy</Button><Button onClick={() => router.push(`/explorer/${network}/contract/${encodeURIComponent(address)}`)}>Explorer</Button><Button primary onClick={() => router.push(`/simulator?contract=${encodeURIComponent(address)}`)}><Play size={14} /> Simulate</Button></div></div><div className="pw-surface"><div className="pw-stats"><div className="pw-stat"><span>Verification</span><strong>{String(verification?.status ?? "unverified")}</strong></div><div className="pw-stat"><span>WASM hash</span><strong className="pw-mono">{selected.current_wasm_hash ? truncateEntity(String(selected.current_wasm_hash), 8, 7) : "Unavailable"}</strong></div><div className="pw-stat"><span>Events indexed</span><strong>{events.data.length}</strong></div><div className="pw-stat"><span>Debug symbols</span><strong>{toolchain?.debug_symbols_present ? "Present" : "Not available"}</strong></div></div><div className="pw-tabs"><button data-active={tab === "overview"} onClick={() => setTab("overview")}>Overview</button><button data-active={tab === "transactions"} onClick={() => setTab("transactions")}>Transactions</button><button data-active={tab === "events"} onClick={() => setTab("events")}>Events</button><button data-active={tab === "source"} onClick={() => setTab("source")}>Source and WASM</button><button data-active={tab === "verification"} onClick={() => setTab("verification")}>Verification</button></div>{tab === "overview" && <div className="pw-panel-body"><div className="pw-kv"><span>Contract ID</span><span className="pw-mono">{address}</span><span>Contract type</span><span>{String(selected.type ?? "contract")}</span><span>Soroban SDK</span><span>{String(toolchain?.soroban_sdk_version ?? "Unavailable")}</span><span>Rust version</span><span>{String(toolchain?.rust_version ?? "Unavailable")}</span><span>WASM target</span><span>{String(toolchain?.wasm_target ?? "Unavailable")}</span><span>Source mapping</span><span>{String(selected.source_map_status ?? "not available")}</span></div></div>}{tab === "transactions" && <TxRows page={transactions} network={network} onOpen={(hash) => router.push(`/explorer/${network}/transaction/${encodeURIComponent(hash)}`)} />}{tab === "events" && <div className="pw-table">{events.data.length ? events.data.map((event, index) => <button className="pw-row" style={{ gridTemplateColumns: "120px minmax(180px, 1fr) minmax(220px, 1fr) 130px" }} key={event.id || index} onClick={() => event.tx_hash && router.push(`/explorer/${network}/transaction/${encodeURIComponent(event.tx_hash)}`)}><span>{event.ledger_sequence?.toLocaleString() || "-"}</span><span className="pw-mono">{JSON.stringify(event.topics)}</span><span className="pw-mono">{JSON.stringify(event.data)}</span><span>{timeLabel(event.timestamp)}</span></button>) : <EmptyState icon={<Activity size={22} />} title="No contract events" body="Indexed contract events will appear here." />}</div>}{tab === "source" && <div className="pw-panel-body">{source ? <pre className="pw-json">{JSON.stringify(source, null, 2)}</pre> : <EmptyState icon={<FileCode2 size={22} />} title="Source is not available" body="Source appears after an immutable package has passed its custody checks." />}</div>}{tab === "verification" && <VerificationPanel {...props} />}</div></div>;
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
  const [query, setQuery] = useState("");
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
  const [toastError, setToastError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const path = scopePath(scope, "/environments");
  const load = useCallback(async () => {
    if (!path) return;
    try { const response = await api.get<{ environments: Environment[] }>(path); setEnvironments(response.environments ?? []); setSelected((current) => current ? response.environments?.find((item) => item.id === current.id) ?? current : null); setError(null); setToastError(null); } catch (cause) { setToastError(errorMessage(cause, "Fork Core environments are unavailable.")); }
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

  if (selected) return <div className="pw-page"><ToastPopup message={toastError} kind="error" onDone={() => setToastError(null)} /><div className="pw-detail-head"><div className="pw-inline"><Button iconOnly aria-label="Back to environments" onClick={() => setSelected(null)}><ArrowLeft size={16} /></Button><div className="pw-detail-title"><p>Virtual environment</p><h1>{selected.name}</h1><p>{selected.network} / protocol {selected.protocol} / base ledger {selected.base_ledger_sequence.toLocaleString()}</p></div></div><div className="pw-actions"><Button onClick={() => void action(selected.sync_enabled ? "/sync/stop" : "/sync/start")}>{selected.sync_enabled ? <Pause size={14} /> : <Play size={14} />}{selected.sync_enabled ? "Pause sync" : "Start sync"}</Button><Button primary onClick={() => router.push(`/simulator?environment=${encodeURIComponent(selected.id)}`)}><Play size={14} /> Simulate</Button></div></div>{message && <Message>{message}</Message>}{error && <Message error>{error}</Message>}<div className="pw-surface"><div className="pw-stats"><div className="pw-stat"><span>Sync status</span><strong><StatusBadge status={selected.sync_status} /></strong></div><div className="pw-stat"><span>Base ledger</span><strong>{selected.base_ledger_sequence.toLocaleString()}</strong></div><div className="pw-stat"><span>Persisted overrides</span><strong>{overrides.length}</strong></div><div className="pw-stat"><span>Protocol</span><strong>{selected.protocol}</strong></div></div><div className="pw-tabs"><button data-active={tab === "overview"} onClick={() => setTab("overview")}>Overview</button><button data-active={tab === "overrides"} onClick={() => setTab("overrides")}>State overrides</button><button data-active={tab === "simulations"} onClick={() => setTab("simulations")}>Simulations</button><button data-active={tab === "settings"} onClick={() => setTab("settings")}>Settings</button></div>{tab === "overview" && <div className="pw-panel-body"><div className="pw-kv"><span>Environment ID</span><span className="pw-mono">{selected.id}</span><span>Network</span><span>{selected.network}</span><span>Continuous sync</span><span>{selected.sync_enabled ? "Enabled" : "Paused"}</span><span>Execution protocol</span><span>Protocol {selected.protocol}</span></div></div>}{tab === "overrides" && <div className="pw-panel-body"><div className="pw-field-grid"><label className="pw-label pw-span-full">Override JSON<textarea className="pw-field pw-mono" rows={8} value={overrideJson} onChange={(event) => setOverrideJson(event.target.value)} /></label><div className="pw-span-full pw-actions" style={{ justifyContent: "flex-end" }}><Button primary onClick={() => void addOverride()} disabled={loading}><Plus size={14} /> Apply override</Button></div></div><div style={{ marginTop: 16 }}>{overrides.length ? <pre className="pw-json">{JSON.stringify(overrides, null, 2)}</pre> : <EmptyState icon={<SlidersHorizontal size={22} />} title="No persisted overrides" body="Balance, contract storage, TTL, ledger sequence, and timestamp overrides will appear here." />}</div></div>}{tab === "simulations" && <div className="pw-table">{runs.length ? runs.map((run) => <button className="pw-row" style={{ gridTemplateColumns: "minmax(180px, 1fr) 120px 140px 140px" }} key={run.id} onClick={() => router.push(`/simulator?run=${encodeURIComponent(run.id)}`)}><span className="pw-mono">{run.function_name}</span><StatusBadge status={run.status} /><span>{run.base_ledger_sequence.toLocaleString()}</span><span>{timeLabel(run.created_at)}</span></button>) : <EmptyState icon={<History size={22} />} title="No simulations yet" body="Run a transaction against this environment to see its history here." action={<Button primary onClick={() => router.push(`/simulator?environment=${encodeURIComponent(selected.id)}`)}><Play size={14} /> New simulation</Button>} />}</div>}{tab === "settings" && <div className="pw-panel-body"><div className="pw-field-grid"><label className="pw-label">Environment name<input className="pw-field" value={rename} onChange={(event) => setRename(event.target.value)} /></label><div className="pw-label"><span>&nbsp;</span><Button onClick={() => void updateName()}>Rename</Button></div><label className="pw-label">Rollback to ledger<input className="pw-field" type="number" value={rollbackLedger} onChange={(event) => setRollbackLedger(event.target.value)} /></label><div className="pw-label"><span>&nbsp;</span><Button onClick={() => void action("/rollback", { to_ledger: Number(rollbackLedger) })}><RotateCcw size={14} /> Roll back</Button></div><div className="pw-span-full" style={{ borderTop: "1px solid var(--border)", marginTop: 8, paddingTop: 14 }}><Button danger onClick={() => void remove()}><Trash2 size={14} /> Delete environment</Button></div></div></div>}</div></div>;

  const visible = environments.filter((environment) => !query.trim() || environment.name.toLowerCase().includes(query.trim().toLowerCase()) || environment.network.toLowerCase().includes(query.trim().toLowerCase()) || String(environment.base_ledger_sequence).includes(query.trim()));
  return <div className="pw-page"><ToastPopup message={toastError} kind="error" onDone={() => setToastError(null)} /><Header title="Virtual environments" description="Manage private forked ledgers, persisted overrides, sync, rollback, and simulation history from one place." />{message && <Message>{message}</Message>}<div className="pw-surface"><CatalogToolbar query={query} setQuery={setQuery} placeholder="Search environments" onAdd={() => setShowCreate(true)} addLabel="Create environment" />{!scope.project ? <div className="pw-page-note">Virtual environments are scoped to a project. Select a project to continue.</div> : visible.length ? <div className="pw-environment-grid">{visible.map((environment) => <EnvironmentCard key={environment.id} environment={environment} onOpen={() => void openEnvironment(environment)} />)}</div> : query ? <EmptyState icon={<Blocks size={22} />} title="No matching environments" body="Try another environment name, network, or ledger." /> : <CreatePrompt onAction={() => setShowCreate(true)} label="Create environment" />}</div>{showCreate && <Modal title="Create virtual environment" onClose={() => setShowCreate(false)} footer={<><Button onClick={() => setShowCreate(false)}>Cancel</Button><Button primary disabled={loading || !name.trim() || !baseLedger} onClick={() => document.getElementById("create-environment-form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))}>{loading ? <LoaderCircle size={14} /> : <Plus size={14} />} Create</Button></>}><form id="create-environment-form" onSubmit={create} className="pw-modal-body" style={{ padding: 0 }}><label className="pw-label">Name<input autoFocus className="pw-field" value={name} onChange={(event) => setName(event.target.value)} placeholder="Checkout regression" /></label><label className="pw-label">Network<select className="pw-field" value={scope.network} disabled><option>{scope.network}</option></select></label><label className="pw-label">Base ledger<input className="pw-field" type="number" value={baseLedger} onChange={(event) => setBaseLedger(event.target.value)} /></label><label className="pw-inline"><input type="checkbox" checked={sync} onChange={(event) => setSync(event.target.checked)} /> Continuously sync new ledger closes</label></form></Modal>}</div>;
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
  const [toastError, setToastError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const environmentPath = scopePath(scope, "/environments");
  const simulationPath = scopePath(scope, "/simulations");
  const selectedEnvironment = environments.find((environment) => environment.id === environmentId);
  const load = useCallback(async () => {
    if (!environmentPath || !simulationPath) return;
    try {
      const [environmentResult, simulationResult] = await Promise.all([api.get<{ environments: Environment[] }>(environmentPath), api.get<{ simulations: Simulation[] }>(simulationPath)]);
      setEnvironments(environmentResult.environments ?? []); setRuns(simulationResult.simulations ?? []); setEnvironmentId((current) => current || environmentResult.environments?.find((environment) => requestedLedger && environment.base_ledger_sequence === Number(requestedLedger))?.id || environmentResult.environments?.[0]?.id || ""); setError(null); setToastError(null);
    } catch (cause) { setToastError(errorMessage(cause, "Could not load simulation data.")); }
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

  if (!editor) return <div className="pw-page pw-simulator-entry"><ToastPopup message={toastError} kind="error" onDone={() => setToastError(null)} /><div className="pw-simulator-hero"><div><span className="pw-empty-icon"><Play size={23} /></span><h1>Simulator</h1><p>Preview Soroban transactions against real ledger snapshots, inspect exact state and authorization effects, and test controlled what-if scenarios without signing or submitting.</p><Button primary onClick={() => setEditor(true)}><Play size={15} /> Simulate transaction</Button></div></div><div className="pw-capabilities"><div className="pw-capability"><ShieldCheck size={18} /><h3>Impersonate scoped accounts</h3><p>Exercise Soroban authorization paths as approved Stellar accounts without possessing their secret keys.</p></div><div className="pw-capability"><SlidersHorizontal size={18} /><h3>Override ledger state</h3><p>Change balances, contract storage, TTL, ledger sequence, timestamp, and explicit footprints in an isolated snapshot.</p></div><div className="pw-capability"><Activity size={18} /><h3>Inspect execution evidence</h3><p>Review calls, events, state changes, host resources, normalized output, and structured failures.</p></div></div>{runs.length > 0 && <div style={{ marginTop: 22 }}><Header title="Recent simulations" description="Persisted runs from this project." /><div className="pw-surface pw-table">{runs.slice(0, 8).map((run) => <button className="pw-row" style={{ gridTemplateColumns: "minmax(180px, 1fr) 120px 140px 140px" }} key={run.id} onClick={() => void openRun(run)}><span className="pw-mono">{run.function_name}</span><StatusBadge status={run.status} /><span>{run.base_ledger_sequence.toLocaleString()}</span><span>{timeLabel(run.created_at)}</span></button>)}</div></div>}</div>;

  const showInput = view !== "output";
  const showOutput = view !== "input";
  return <div className="pw-page pw-sim-editor"><ToastPopup message={toastError} kind="error" onDone={() => setToastError(null)} /><div className="pw-sim-top"><div className="pw-inline"><Button iconOnly aria-label="Exit editor" onClick={() => setEditor(false)}><ArrowLeft size={15} /></Button><h1>New simulation</h1></div><div className="pw-segmented"><button data-active={view === "input"} onClick={() => setView("input")}>Input</button><button data-active={view === "split"} onClick={() => setView("split")}>Split</button><button data-active={view === "output"} onClick={() => setView("output")}>Output</button></div><div className="pw-actions"><Button onClick={() => navigator.clipboard.writeText(location.href)}><Copy size={14} /> Copy draft link</Button>{canAnalyze && <Button onClick={() => void analyzeRun()}><Bug size={14} /> Analyze trace</Button>}<Button primary disabled={loading || !environmentId} onClick={() => void simulate()}>{loading ? <LoaderCircle size={14} /> : <Play size={14} />} Simulate</Button></div></div>{error && <Message error>{error}</Message>}{message && <Message>{message}</Message>}<div className="pw-sim-layout" style={{ gridTemplateColumns: view === "input" ? "1fr" : view === "output" ? "1fr" : undefined }}>{showInput && <div className="pw-sim-input"><div className="pw-sim-context"><label className="pw-inline"><Database size={16} /><select className="pw-field" value={environmentId} onChange={(event) => setEnvironmentId(event.target.value)} style={{ width: "auto", minWidth: 210 }}><option value="">Select virtual environment</option>{environments.map((environment) => <option key={environment.id} value={environment.id}>{environment.name} / {environment.network}</option>)}</select></label><span className="pw-mono" style={{ color: "var(--text-dim)" }}>ledger {selectedEnvironment?.base_ledger_sequence?.toLocaleString() ?? "pending"}</span></div><div className="pw-sim-compose"><div className="pw-step-rail"><div className="pw-step"><span className="pw-step-number">1</span><span>Invoke</span></div><div className="pw-step-actions"><Button iconOnly aria-label="Add step" disabled title="Bundles are coming after single-call parity"><Plus size={15} /></Button><Button iconOnly aria-label="Reset" onClick={() => { setContractId(""); setFunctionName(""); setArgs("[]"); }}><RotateCcw size={14} /></Button></div></div><div className="pw-sim-form"><div className="pw-sim-section"><h2><Zap size={16} /> Transaction parameters</h2><div className="pw-field-grid"><label className="pw-label pw-span-full">Source account XDR<input className="pw-field pw-mono" value={sourceAccountXdr} onChange={(event) => setSourceAccountXdr(event.target.value)} placeholder="Optional source account XDR" /></label><label className="pw-label pw-span-full">Contract ID<input className="pw-field pw-mono" value={contractId} onChange={(event) => setContractId(event.target.value)} placeholder="C..." /></label><label className="pw-label pw-span-full">Function<input className="pw-field pw-mono" value={functionName} onChange={(event) => setFunctionName(event.target.value)} placeholder="transfer" /></label><div className="pw-span-full pw-inline" style={{ justifyContent: "space-between" }}><span style={{ color: "var(--text-dim)", fontSize: 11.5 }}>Invocation input</span><div className="pw-segmented"><button data-active={argsMode === "decoded"} onClick={() => setArgsMode("decoded")}>Decoded</button><button data-active={argsMode === "raw"} onClick={() => setArgsMode("raw")}>Raw XDR</button></div></div>{argsMode === "decoded" ? <label className="pw-label pw-span-full">Arguments JSON<textarea className="pw-field pw-mono" rows={5} value={args} onChange={(event) => setArgs(event.target.value)} /></label> : <label className="pw-label pw-span-full">Host-function XDR<textarea className="pw-field pw-mono" rows={5} value={hostFunctionXdr} onChange={(event) => setHostFunctionXdr(event.target.value)} /></label>}</div></div><Accordion icon={<UserRound size={16} />} title="Impersonate accounts" open={Boolean(openSections.impersonate)} onToggle={() => toggle("impersonate")}><label className="pw-label">Approved account IDs<input className="pw-field pw-mono" value={impersonate} onChange={(event) => setImpersonate(event.target.value)} placeholder="G..., G..." /></label></Accordion><Accordion icon={<CircleDollarSign size={16} />} title="Override balance" open={Boolean(openSections.balance)} onToggle={() => toggle("balance")}><div className="pw-field-grid"><label className="pw-label">Account<input className="pw-field pw-mono" value={balanceTarget} onChange={(event) => setBalanceTarget(event.target.value)} placeholder="G..." /></label><label className="pw-label">Asset<input className="pw-field" value={balanceAsset} onChange={(event) => setBalanceAsset(event.target.value)} /></label><label className="pw-label">Amount<input className="pw-field" value={balanceAmount} onChange={(event) => setBalanceAmount(event.target.value)} placeholder="1000.0000000" /></label><label className="pw-label">Ledger-key XDR<input className="pw-field pw-mono" value={balanceKeyXdr} onChange={(event) => setBalanceKeyXdr(event.target.value)} /></label></div></Accordion><Accordion icon={<Layers3 size={16} />} title="Increase ledger" open={Boolean(openSections.ledger)} onToggle={() => toggle("ledger")}><label className="pw-label">Ledgers after snapshot<input className="pw-field" type="number" min="0" value={increaseLedger} onChange={(event) => setIncreaseLedger(event.target.value)} /></label></Accordion><Accordion icon={<Clock3 size={16} />} title="Override timestamp" open={Boolean(openSections.timestamp)} onToggle={() => toggle("timestamp")}><label className="pw-label">Ledger close time<input className="pw-field" type="datetime-local" value={timestamp} onChange={(event) => setTimestamp(event.target.value)} /></label></Accordion><Accordion icon={<Braces size={16} />} title="Contract state override" open={Boolean(openSections.state)} onToggle={() => toggle("state")}><label className="pw-label">Ledger-key XDR<textarea className="pw-field pw-mono" rows={3} value={storageKeyXdr} onChange={(event) => setStorageKeyXdr(event.target.value)} /></label><label className="pw-label">Replacement value XDR<textarea className="pw-field pw-mono" rows={3} value={storageValueXdr} onChange={(event) => setStorageValueXdr(event.target.value)} /></label></Accordion><Accordion icon={<AlarmClock size={16} />} title="TTL override" open={Boolean(openSections.ttl)} onToggle={() => toggle("ttl")}><div className="pw-field-grid"><label className="pw-label">Ledger-key XDR<input className="pw-field pw-mono" value={ttlKeyXdr} onChange={(event) => setTtlKeyXdr(event.target.value)} /></label><label className="pw-label">Live until ledger<input className="pw-field" type="number" value={liveUntilLedger} onChange={(event) => setLiveUntilLedger(event.target.value)} /></label></div></Accordion><Accordion icon={<KeyRound size={16} />} title="Explicit footprint" open={Boolean(openSections.footprint)} onToggle={() => toggle("footprint")}><label className="pw-label">Ledger-key XDR values<textarea className="pw-field pw-mono" rows={4} value={footprintKeys} onChange={(event) => setFootprintKeys(event.target.value)} placeholder="One key per line" /></label></Accordion><Accordion icon={<Bug size={16} />} title="Debugger evidence" open={Boolean(openSections.debugger)} onToggle={() => toggle("debugger")}><label className="pw-inline"><input type="checkbox" checked={captureTrace} onChange={(event) => setCaptureTrace(event.target.checked)} /> Capture observation-only execution trace</label></Accordion><Accordion icon={<Code2 size={16} />} title="Advanced overrides" open={Boolean(openSections.advanced)} onToggle={() => toggle("advanced")}><label className="pw-label">Override array<textarea className="pw-field pw-mono" rows={6} value={advancedOverrides} onChange={(event) => setAdvancedOverrides(event.target.value)} /></label></Accordion></div></div></div>}{showOutput && <div className="pw-output"><div className="pw-tabs"><button data-active={resultTab === "summary"} onClick={() => setResultTab("summary")}>Summary</button><button data-active={resultTab === "calls"} onClick={() => setResultTab("calls")}>Calls</button><button data-active={resultTab === "events"} onClick={() => setResultTab("events")}>Events</button><button data-active={resultTab === "state"} onClick={() => setResultTab("state")}>State</button><button data-active={resultTab === "resources"} onClick={() => setResultTab("resources")}>Resources</button><button data-active={resultTab === "raw"} onClick={() => setResultTab("raw")}>Raw</button></div>{selectedRun ? <div className="pw-panel-body"><pre className="pw-json">{JSON.stringify(outputForTab, null, 2)}</pre>{detailResult?.status === "pending" && <div className="pw-actions" style={{ marginTop: 14 }}><Button onClick={() => void load()}><RotateCcw size={14} /> Refresh status</Button></div>}</div> : <div className="pw-output-placeholder"><div><strong>Run the invocation to see the simulation</strong>Calls, authorization, state changes, events, resources, return values, and structured errors will appear here.</div></div>}</div>}</div></div>;
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
