"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Clock3,
  Code2,
  Database,
  FastForward,
  GitFork,
  GitCompareArrows,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  SkipBack,
  SkipForward,
  UserRound,
  X,
  Zap,
} from "lucide-react";

import { ApiError, api } from "@/lib/api";
import type { ProjectScope } from "./project-pages";
import "./replay-pages.css";
import "./replay-timeline.css";

type ReplayView = {
  id: string;
  status: string;
  stage: string;
  progress: number;
  selected_transactions: number;
  dependency_transactions: number;
  result?: Record<string, unknown> | null;
  error?: { code?: string; detail?: string } | null;
};

type TimelineEvent = {
  ordinal: number;
  transaction_hash: string;
  ledger_sequence: number;
  close_time: number;
  application_order: number;
  successful: boolean;
  fee_bump: boolean;
  source_account?: string;
  accounts?: string[];
  invoked_contracts: string[];
  contracts: string[];
  event_xdr: string[];
  event_count?: number;
  footprint_keys: number;
  read_write_keys: number;
  state_changes: Array<{ type: string; ledger_key_xdr: string; live_until_ledger?: number | null }>;
  state_change_count?: number;
  metadata_source?: string;
};

type TimelineView = {
  id: string;
  network: string;
  start_ledger: number;
  end_ledger: number;
  target_contracts: string[];
  target_accounts: string[];
  preview: boolean;
  status: string;
  stage: string;
  progress: number;
  selected_transactions: number;
  dependency_transactions: number;
  footprint_keys: number;
  cached_contracts: number;
  cache_status: string;
  prepared_through_ledger?: number | null;
  events: TimelineEvent[];
  next_after?: number | null;
  error?: { code?: string; detail?: string } | null;
};

type HistoryTarget = {
  type: "contract" | "account";
  address: string;
  transaction_count: number;
  first_ledger: number;
  last_ledger: number;
};

type HistoryTargetWindow = {
  start_ledger: number;
  end_ledger: number;
  start_time: number;
  end_time: number;
  targets: HistoryTarget[];
};

function projectPath(scope: ProjectScope, suffix: string) {
  if (!scope.organization || !scope.project) return null;
  return `/api/v1/${scope.organization}/${scope.project}${suffix}`;
}

function parseJson<T>(value: string, fallback: T): T {
  if (!value.trim()) return fallback;
  return JSON.parse(value) as T;
}

function NetworkSelect() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  return (
    <div className="rp-select" ref={ref}>
      <button type="button" className="rp-select-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span><Image src="/stellar-logo.jpg" alt="" width={16} height={16} />Mainnet</span><ChevronDown size={14} className={open ? "open" : ""} />
      </button>
      <div className={`rp-select-menu${open ? " open" : ""}`} role="listbox" aria-label="Replay network">
        <button type="button" role="option" aria-selected="true" onClick={() => setOpen(false)}><span><Image src="/stellar-logo.jpg" alt="" width={16} height={16} />Mainnet</span><Check size={13} /></button>
        <button type="button" role="option" aria-selected="false" aria-disabled="true" disabled><span><Image src="/stellar-logo.jpg" alt="" width={16} height={16} />Testnet</span><small>Latest only</small></button>
      </div>
    </div>
  );
}

export function NewReplayPage({ scope }: { scope: ProjectScope }) {
  const router = useRouter();
  const search = useSearchParams();
  const [mode, setMode] = useState<"exact_transaction" | "contract_window">(
    search.get("transaction") || search.get("audit") ? "exact_transaction" : "contract_window",
  );
  const [transactionHash, setTransactionHash] = useState(search.get("transaction") ?? "");
  const [startLedger, setStartLedger] = useState("");
  const [endLedger, setEndLedger] = useState("");
  const [contracts, setContracts] = useState(search.get("contract") ?? "");
  const [captureTrace, setCaptureTrace] = useState(true);
  const [replace, setReplace] = useState(false);
  const [sourceAccount, setSourceAccount] = useState("");
  const [sequence, setSequence] = useState("1");
  const [contractId, setContractId] = useState(search.get("contract") ?? "");
  const [functionName, setFunctionName] = useState("");
  const [args, setArgs] = useState("[]");
  const [overrides, setOverrides] = useState("[]");
  const [setupInvocations, setSetupInvocations] = useState("[]");
  const [replacements, setReplacements] = useState("[]");
  const [coverage, setCoverage] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const coveragePath = projectPath(scope, "/history/coverage?network=mainnet");

  useEffect(() => {
    if (!coveragePath) return;
    api.get<Record<string, unknown>>(coveragePath).then(setCoverage).catch(() => setCoverage(null));
  }, [coveragePath]);

  const submit = async () => {
    const path = projectPath(scope, "/replays");
    if (!path) return;
    setBusy(true);
    setError("");
    try {
      const common = {
        network: "mainnet",
        capture_trace: captureTrace,
        overrides: parseJson<unknown[]>(overrides, []),
      };
      const body = mode === "exact_transaction"
        ? {
            ...common,
            mode,
            transaction_hash: transactionHash.trim(),
            replacement: replace ? {
              type: "decoded",
              contract_id: contractId.trim(),
              function_name: functionName.trim(),
              args: parseJson<unknown[]>(args, []),
              source_account: sourceAccount.trim(),
              sequence_number: Number(sequence),
            } : undefined,
          }
        : {
            ...common,
            mode,
            start_ledger: Number(startLedger),
            end_ledger: Number(endLedger),
            target_contracts: contracts.split(/[\n,]/).map(value => value.trim()).filter(Boolean),
            setup_invocations: parseJson<unknown[]>(setupInvocations, []),
            replacements: parseJson<unknown[]>(replacements, []),
          };
      const response = await api.post<{ id: string }>(path, body, {
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      router.push(`/replays/${response.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : "Replay could not be created.");
    } finally {
      setBusy(false);
    }
  };

  const coverageText = coverage?.available
    ? `${Number(coverage.earliest_ledger).toLocaleString()} – ${Number(coverage.latest_ledger).toLocaleString()}`
    : "Recorder is not release-ready";

  return (
    <div className="rp-page">
      <div className="rp-heading"><div><h1>Historical replay</h1><p>Compare canonical Mainnet execution with state, code, caller, and argument counterfactuals.</p></div><NetworkSelect /></div>
      <div className="rp-coverage"><ShieldCheck size={15} /><span>Verified P27 coverage</span><strong>{coverageText}</strong></div>
      <div className="rp-mode-tabs" role="tablist">
        <button className={mode === "exact_transaction" ? "active" : ""} onClick={() => setMode("exact_transaction")}><RotateCcw size={14} />Exact transaction</button>
        <button className={mode === "contract_window" ? "active" : ""} onClick={() => setMode("contract_window")}><Clock3 size={14} />Contract window</button>
      </div>
      <div className="rp-grid">
        <section className="rp-card">
          <h2>{mode === "exact_transaction" ? "Canonical position" : "Replay window"}</h2>
          {mode === "exact_transaction" ? (
            <label>Transaction hash<input value={transactionHash} onChange={event => setTransactionHash(event.target.value)} placeholder="64-character Mainnet transaction hash" /></label>
          ) : <>
            <div className="rp-inline"><label>Start ledger<input inputMode="numeric" value={startLedger} onChange={event => setStartLedger(event.target.value)} /></label><label>End ledger<input inputMode="numeric" value={endLedger} onChange={event => setEndLedger(event.target.value)} /></label></div>
            <label>Target contracts<textarea value={contracts} onChange={event => setContracts(event.target.value)} placeholder="One C… contract per line" /></label>
          </>}
          <label className="rp-check"><input type="checkbox" checked={captureTrace} onChange={event => setCaptureTrace(event.target.checked)} /><span>Capture SourceLens execution traces</span></label>
        </section>
        <section className="rp-card">
          <h2>Counterfactual branch</h2>
          {mode === "exact_transaction" ? <>
            <label className="rp-check"><input type="checkbox" checked={replace} onChange={event => setReplace(event.target.checked)} /><span>Replace canonical invocation</span></label>
            {replace && <div className="rp-replacement">
              <label>Caller account<input value={sourceAccount} onChange={event => setSourceAccount(event.target.value)} placeholder="G…" /></label>
              <label>Contract<input value={contractId} onChange={event => setContractId(event.target.value)} placeholder="C…" /></label>
              <div className="rp-inline"><label>Function<input value={functionName} onChange={event => setFunctionName(event.target.value)} /></label><label>Sequence<input inputMode="numeric" value={sequence} onChange={event => setSequence(event.target.value)} /></label></div>
              <label>Arguments (JSON)<textarea value={args} onChange={event => setArgs(event.target.value)} /></label>
            </div>}
          </> : <>
            <label>Setup deployments / invocations (JSON)<textarea value={setupInvocations} onChange={event => setSetupInvocations(event.target.value)} placeholder='[{"type":"prepared","transaction_envelope_xdr":"…"}]' /></label>
            <label>Canonical replacements (JSON)<textarea value={replacements} onChange={event => setReplacements(event.target.value)} placeholder='[{"transaction_hash":"…","invocation":{…}}]' /></label>
          </>}
          <label>State, balance, TTL, or contract-code overrides (JSON)<textarea value={overrides} onChange={event => setOverrides(event.target.value)} placeholder='[{"type":"storage",…}]' /></label>
        </section>
      </div>
      {error && <div className="rp-error">{error}</div>}
      <div className="rp-actions"><button className="rp-primary" disabled={busy || (mode === "exact_transaction" ? !transactionHash.trim() : !startLedger || !endLedger || !contracts.trim())} onClick={() => void submit()}>{busy ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />}Start verified replay</button></div>
    </div>
  );
}

export function NewTimelinePage({ scope }: { scope: ProjectScope }) {
  const router = useRouter();
  const search = useSearchParams();
  const [coverage, setCoverage] = useState<Record<string, unknown> | null>(null);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [period, setPeriod] = useState(5);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [targetQuery, setTargetQuery] = useState("");
  const [targetWindow, setTargetWindow] = useState<HistoryTargetWindow | null>(null);
  const [selected, setSelected] = useState<HistoryTarget[]>(() => {
    const contract = search.get("contract")?.trim().toUpperCase();
    return contract ? [{ type: "contract", address: contract, transaction_count: 0, first_ledger: 0, last_ledger: 0 }] : [];
  });
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [targetError, setTargetError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const coveragePath = projectPath(scope, "/history/coverage?network=mainnet");

  useEffect(() => {
    if (!coveragePath) return;
    api.get<Record<string, unknown>>(coveragePath).then(setCoverage).catch(caught => {
      setError(caught instanceof Error ? caught.message : "Coverage could not be loaded.");
    });
  }, [coveragePath]);

  useEffect(() => {
    if (!coverage?.available || endTime) return;
    const latest = Number(coverage.latest_close_time || Math.floor(Date.now() / 1000));
    const earliest = Number(coverage.earliest_close_time || latest - Number(coverage.verified_ledgers ?? 60) * 5);
    const minutes = Boolean(coverage.preview) ? 5 : 60;
    const start = Math.max(earliest, latest - minutes * 60);
    setPeriod(minutes);
    setStartTime(start);
    setEndTime(latest);
    setCustomStart(new Date(start * 1000).toISOString().slice(0, 16));
    setCustomEnd(new Date(latest * 1000).toISOString().slice(0, 16));
  }, [coverage, endTime]);

  useEffect(() => {
    if (!startTime || !endTime) return;
    const base = projectPath(scope, "/history/targets");
    if (!base) return;
    let stopped = false;
    const timer = setTimeout(async () => {
      setTargetsLoading(true);
      setTargetError("");
      try {
        const query = encodeURIComponent(targetQuery.trim().toUpperCase());
        const value = await api.get<HistoryTargetWindow>(`${base}?start_time=${startTime}&end_time=${endTime}&query=${query}&limit=40`);
        if (!stopped) setTargetWindow(value);
      } catch (caught) {
        if (!stopped) setTargetError(caught instanceof Error ? caught.message : "Targets could not be discovered.");
      } finally {
        if (!stopped) setTargetsLoading(false);
      }
    }, targetQuery ? 180 : 0);
    return () => { stopped = true; clearTimeout(timer); };
  }, [endTime, scope, startTime, targetQuery]);

  const choosePeriod = (minutes: number) => {
    if (!coverage?.available) return;
    const latest = Number(coverage.latest_close_time || Math.floor(Date.now() / 1000));
    const earliest = Number(coverage.earliest_close_time || latest - Number(coverage.verified_ledgers ?? 60) * 5);
    const start = Math.max(earliest, latest - minutes * 60);
    setPeriod(minutes);
    setStartTime(start);
    setEndTime(latest);
    setCustomStart(new Date(start * 1000).toISOString().slice(0, 16));
    setCustomEnd(new Date(latest * 1000).toISOString().slice(0, 16));
    setTargetWindow(null);
    setSelected([]);
  };

  const applyCustomPeriod = () => {
    const start = Math.floor(new Date(customStart).getTime() / 1000);
    const end = Math.floor(new Date(customEnd).getTime() / 1000);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
      setError("Choose a valid start and end time.");
      return;
    }
    setError("");
    setPeriod(0);
    setStartTime(start);
    setEndTime(end);
    setTargetWindow(null);
    setSelected([]);
  };

  const toggleTarget = (target: HistoryTarget) => {
    setSelected(current => current.some(item => item.type === target.type && item.address === target.address)
      ? current.filter(item => item.type !== target.type || item.address !== target.address)
      : current.length < 32 ? [...current, target] : current);
  };

  const submit = async () => {
    const path = projectPath(scope, "/history/timelines");
    if (!path) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.post<{ id: string }>(path, {
        network: "mainnet",
        start_ledger: targetWindow?.start_ledger,
        end_ledger: targetWindow?.end_ledger,
        target_contracts: selected.filter(target => target.type === "contract").map(target => target.address),
        target_accounts: selected.filter(target => target.type === "account").map(target => target.address),
      }, { headers: { "Idempotency-Key": crypto.randomUUID() } });
      router.push(`/replays/timeline/${response.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : "Timeline could not be created.");
    } finally {
      setBusy(false);
    }
  };

  const earliestClose = Number(coverage?.earliest_close_time);
  const latestClose = Number(coverage?.latest_close_time);
  const coverageText = coverage?.available
    ? Number.isFinite(earliestClose) && Number.isFinite(latestClose)
      ? `${new Date(earliestClose * 1000).toLocaleString()} – ${new Date(latestClose * 1000).toLocaleString()}`
      : `${Number(coverage.earliest_ledger).toLocaleString()} – ${Number(coverage.latest_ledger).toLocaleString()}`
    : "Recorder is warming";

  return <div className="rp-page">
    <div className="rp-heading"><div><h1>Historical playback</h1><p>Stream what happened without executing it. Pause anywhere and fork only when you want to change the outcome.</p></div><NetworkSelect /></div>
    <div className="rp-coverage"><ShieldCheck size={15} /><span>Verified P27 coverage</span><strong>{coverageText}</strong>{Boolean(coverage?.preview) && <small>Local 5-minute preview</small>}</div>
    <section className="rp-card rp-time-first">
      <div className="rp-step-heading"><b>1</b><div><h2>Choose when</h2><p>Target discovery is constrained to this verified period before any history is loaded.</p></div></div>
      <div className="rp-periods">{[[5, "5 min"], [30, "30 min"], [60, "1 hour"], [360, "6 hours"], [1440, "24 hours"], [10080, "7 days"]].map(([minutes, label]) => <button type="button" key={minutes} className={period === minutes ? "active" : ""} onClick={() => choosePeriod(Number(minutes))}>{label}</button>)}</div>
      <div className="rp-custom-period"><label>From<input type="datetime-local" value={customStart} onChange={event => setCustomStart(event.target.value)} /></label><label>To<input type="datetime-local" value={customEnd} onChange={event => setCustomEnd(event.target.value)} /></label><button type="button" className="rp-secondary" onClick={applyCustomPeriod}>Apply range</button></div>
      {targetWindow && <div className="rp-window-proof"><ShieldCheck size={13} />Resolved exactly to ledgers {targetWindow.start_ledger.toLocaleString()}–{targetWindow.end_ledger.toLocaleString()}</div>}
    </section>
    <section className={`rp-card rp-target-picker${startTime ? "" : " disabled"}`}>
      <div className="rp-step-heading"><b>2</b><div><h2>Select what to watch</h2><p>Contracts and transaction source accounts active inside the chosen period.</p></div><span>{selected.length}/32 selected</span></div>
      <div className="rp-target-search"><Search size={15} /><input value={targetQuery} onChange={event => setTargetQuery(event.target.value)} placeholder="Search or paste a C… contract / G… account" />{targetsLoading && <LoaderCircle size={14} className="spin" />}</div>
      {selected.length > 0 && <div className="rp-selected-targets">{selected.map(target => <button type="button" key={`${target.type}:${target.address}`} onClick={() => toggleTarget(target)}>{target.type === "contract" ? <Database size={12} /> : <UserRound size={12} />}<span>{target.address.slice(0, 8)}…{target.address.slice(-6)}</span><X size={11} /></button>)}</div>}
      <div className="rp-target-results">{targetWindow?.targets.map(target => {
        const active = selected.some(item => item.type === target.type && item.address === target.address);
        return <button type="button" className={active ? "active" : ""} key={`${target.type}:${target.address}`} onClick={() => toggleTarget(target)}><i>{target.type === "contract" ? <Database size={14} /> : <UserRound size={14} />}</i><div><strong className="rp-mono">{target.address}</strong><span>{target.type === "contract" ? "Contract" : "Source account"}</span></div><b>{target.transaction_count.toLocaleString()} tx</b>{active && <Check size={14} />}</button>;
      })}{!targetsLoading && targetWindow?.targets.length === 0 && <div className="rp-empty">No active contracts or accounts match this period and search.</div>}</div>
      {targetError && <div className="rp-error">{targetError}</div>}
    </section>
    <section className="rp-card rp-fast-path"><div className="rp-load-story"><span><Database size={16} /><b>1</b><i>Index playback appears</i><small>No R2 wait and no canonical execution.</small></span><span><Zap size={16} /><b>2</b><i>Fork cache warms</i><small>Evidence, state and WASM load behind playback.</small></span><span><GitFork size={16} /><b>3</b><i>Pause and branch</i><small>Only the modified lane executes.</small></span></div></section>
    <button type="button" className="rp-text-action" onClick={() => router.push("/replays/new?audit=1")}><RotateCcw size={13} />Open exact transaction audit</button>
    {error && <div className="rp-error">{error}</div>}
    <div className="rp-actions"><button className="rp-primary" disabled={busy || !coverage?.available || !targetWindow || selected.length === 0} onClick={() => void submit()}>{busy ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />}Open interactive timeline</button></div>
  </div>;
}

const activeStatuses = new Set(["queued", "planning", "materializing", "executing"]);
const timelineLoadingStatuses = new Set(["queued", "indexing", "streaming", "prewarming"]);

export function ReplayDetailPage({ scope, replayId }: { scope: ProjectScope; replayId: string }) {
  const router = useRouter();
  const [replay, setReplay] = useState<ReplayView | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("Replay branch");
  const [analysisTransaction, setAnalysisTransaction] = useState("");
  const [busy, setBusy] = useState(false);
  const resource = projectPath(scope, `/replays/${replayId}`);
  useEffect(() => {
    if (!resource) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const value = await api.get<ReplayView>(resource);
        if (stopped) return;
        setReplay(value);
        if (activeStatuses.has(value.status)) timer = setTimeout(load, 1500);
      } catch (caught) {
        if (!stopped) setError(caught instanceof Error ? caught.message : "Replay could not be loaded.");
      }
    };
    void load();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [resource]);

  const result = replay?.result ?? {};
  const parity = (result as { baseline_parity?: { passed?: boolean } }).baseline_parity;
  const replayMode = (result as { mode?: string }).mode;
  const modifiedTransactions = (replayMode === "timeline_branch"
    ? ((result as { transactions?: Array<{ transaction_hash?: string; modified?: { execution_trace?: unknown } }> }).transactions ?? [])
        .map(transaction => ({ transaction_hash: transaction.transaction_hash, execution_trace: transaction.modified?.execution_trace }))
    : ((result as { modified?: { transactions?: Array<{ transaction_hash?: string; execution_trace?: unknown }> } }).modified?.transactions ?? []))
    .filter(transaction => transaction.execution_trace);
  const firstTraceTransaction = modifiedTransactions[0]?.transaction_hash ?? "";
  useEffect(() => {
    if (!analysisTransaction && firstTraceTransaction) setAnalysisTransaction(firstTraceTransaction);
  }, [analysisTransaction, firstTraceTransaction]);
  const promote = async () => {
    if (!resource) return;
    setBusy(true);
    try {
      const response = await api.post<{ environment_id: string }>(`${resource}/promote`, { name }, { headers: { "Idempotency-Key": crypto.randomUUID() } });
      router.push(`/vnet/${response.environment_id}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Promotion failed."); }
    finally { setBusy(false); }
  };
  const cancel = async () => {
    if (!resource) return;
    await api.post(`${resource}/cancel`);
    setReplay(current => current ? { ...current, status: "cancelled", stage: "cancelled", progress: 100 } : current);
  };
  const analyze = async () => {
    if (!resource) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.post<{ analysis_id: string }>(`${resource}/analysis`, {
        transaction_hash: replayMode === "contract_window" || replayMode === "timeline_branch" ? analysisTransaction : undefined,
      }, { headers: { "Idempotency-Key": crypto.randomUUID() } });
      router.push(`/debugger/${response.analysis_id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "SourceLens analysis could not be created.");
    } finally {
      setBusy(false);
    }
  };
  const exactTraceAvailable = Boolean((result as { modified?: { execution_trace?: unknown } }).modified?.execution_trace);
  const analysisAvailable = exactTraceAvailable || modifiedTransactions.length > 0;
  if (!replay) return <div className="rp-page rp-loading">{error || "Loading replay evidence…"}</div>;
  return (
    <div className="rp-page">
      <button className="rp-back" onClick={() => router.push("/replays/new")}><ArrowLeft size={14} />New replay</button>
      <div className="rp-heading"><div><h1>Replay evidence</h1><p className="rp-mono">{replay.id}</p></div><span className={`rp-status ${replay.status}`}>{activeStatuses.has(replay.status) && <LoaderCircle size={13} className="spin" />}{replay.status.replaceAll("_", " ")}</span></div>
      <section className="rp-progress-card"><div><span>{replay.stage.replaceAll("_", " ")}</span><strong>{replay.progress}%</strong></div><div className="rp-progress"><i style={{ width: `${replay.progress}%` }} /></div><div className="rp-counts"><span>{replay.selected_transactions} selected</span><span>{replay.dependency_transactions} dependencies</span><span>{parity?.passed === true ? "Canonical parity passed" : parity?.passed === false ? "Canonical parity failed" : "Parity pending"}</span></div></section>
      {error && <div className="rp-error">{error}</div>}
      {replay.error && <div className="rp-error"><strong>{replay.error.code}</strong> {replay.error.detail}</div>}
      {replay.result && <div className="rp-comparison">
        <section className="rp-card"><h2><ShieldCheck size={15} />Baseline</h2><pre>{JSON.stringify((result as Record<string, unknown>).original ?? (result as Record<string, unknown>).baseline_parity, null, 2)}</pre></section>
        <section className="rp-card"><h2><GitCompareArrows size={15} />Modified branch</h2><pre>{JSON.stringify((result as Record<string, unknown>).modified ?? (result as Record<string, unknown>).divergence_point, null, 2)}</pre></section>
      </div>}
      {analysisAvailable && <section className="rp-card rp-promote"><div><h2>Debug the modified trace</h2><p>Send the captured SDK 22 execution trace to SourceLens for source-level analysis.</p></div>{(replayMode === "contract_window" || replayMode === "timeline_branch") && <><input list="replay-trace-transactions" value={analysisTransaction} onChange={event => setAnalysisTransaction(event.target.value)} placeholder="Transaction hash" /><datalist id="replay-trace-transactions">{modifiedTransactions.map(transaction => transaction.transaction_hash && <option key={transaction.transaction_hash} value={transaction.transaction_hash} />)}</datalist></>}<button className="rp-secondary" disabled={busy || ((replayMode === "contract_window" || replayMode === "timeline_branch") && !analysisTransaction)} onClick={() => void analyze()}>{busy ? <LoaderCircle className="spin" size={14} /> : <Code2 size={14} />}Analyze in SourceLens</button></section>}
      {replay.status === "success" && (result as { promotion_eligible?: boolean }).promotion_eligible && <section className="rp-card rp-promote"><div><h2>Keep this branch</h2><p>Creates a permanent capsule and a fully reversible frozen virtual network.</p></div><input value={name} onChange={event => setName(event.target.value)} /><button className="rp-primary" disabled={busy || !name.trim()} onClick={() => void promote()}>{busy ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}Promote</button></section>}
      {activeStatuses.has(replay.status) && <div className="rp-actions"><button className="rp-secondary" onClick={() => void cancel()}><Pause size={14} />Cancel replay</button></div>}
    </div>
  );
}

export function TimelineDetailPage({ scope, timelineId }: { scope: ProjectScope; timelineId: string }) {
  const router = useRouter();
  const [timeline, setTimeline] = useState<TimelineView | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(12);
  const [overrides, setOverrides] = useState("[]");
  const [setupInvocations, setSetupInvocations] = useState("[]");
  const [replacements, setReplacements] = useState("[]");
  const [captureTrace, setCaptureTrace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const resource = projectPath(scope, `/history/timelines/${timelineId}`);

  useEffect(() => {
    if (!resource) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const collected = new Map<number, TimelineEvent>();
        let after = -1;
        let latest: TimelineView | null = null;
        for (;;) {
          const value = await api.get<TimelineView>(`${resource}?after=${after}&limit=500`);
          latest = value;
          for (const event of value.events ?? []) collected.set(event.ordinal, event);
          if ((value.events?.length ?? 0) < 500) break;
          after = value.events[value.events.length - 1]?.ordinal ?? after;
        }
        if (stopped || !latest) return;
        setTimeline(latest);
        setEvents(Array.from(collected.values()).sort((left, right) => left.ordinal - right.ordinal));
        if (timelineLoadingStatuses.has(latest.status)) timer = setTimeout(load, 750);
      } catch (caught) {
        if (!stopped) setError(caught instanceof Error ? caught.message : "Timeline could not be loaded.");
      }
    };
    void load();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [resource]);

  useEffect(() => {
    if (!playing || playhead >= events.length - 1) return;
    const current = events[playhead];
    const next = events[playhead + 1];
    const virtualGapMs = Math.max(0, (next.close_time - current.close_time) * 1000);
    const delay = Math.min(2500, Math.max(100, virtualGapMs / speed));
    const timer = setTimeout(() => setPlayhead(value => Math.min(value + 1, events.length - 1)), delay);
    return () => clearTimeout(timer);
  }, [events, playhead, playing, speed]);

  useEffect(() => {
    if (playing && events.length > 0 && playhead >= events.length - 1) setPlaying(false);
  }, [events.length, playhead, playing]);

  const fork = async () => {
    if (!resource || !events[playhead]) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.post<{ id: string }>(`${resource}/fork`, {
        from_ordinal: events[playhead].ordinal,
        overrides: parseJson<unknown[]>(overrides, []),
        setup_invocations: parseJson<unknown[]>(setupInvocations, []),
        replacements: parseJson<unknown[]>(replacements, []),
        capture_trace: captureTrace,
      }, { headers: { "Idempotency-Key": crypto.randomUUID() } });
      router.push(`/replays/${response.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Timeline could not be forked.");
    } finally {
      setBusy(false);
    }
  };

  const selected = events[playhead];
  const visibleStart = Math.max(0, playhead - 20);
  const visibleEnd = Math.min(events.length, visibleStart + 80);
  const cacheReady = timeline?.cache_status === "ready" && timeline?.status === "ready";
  if (!timeline) return <div className="rp-page rp-loading">{error || "Opening canonical timeline…"}</div>;

  return <div className="rp-page rp-timeline-page">
    <button className="rp-back" onClick={() => router.push("/replays/new")}><ArrowLeft size={14} />New timeline</button>
    <div className="rp-heading"><div><h1>Watched timeline</h1><p>{timeline.start_ledger.toLocaleString()} → {timeline.end_ledger.toLocaleString()} · {events.length.toLocaleString()} relevant interactions</p></div><span className={`rp-status ${timeline.status}`}>{timelineLoadingStatuses.has(timeline.status) && <LoaderCircle size={13} className="spin" />}{timeline.stage.replaceAll("_", " ")}</span></div>
    <section className="rp-progress-card rp-cache-progress">
      <div><span>{timeline.status === "ready" ? "Fork cache ready" : timeline.stage.replaceAll("_", " ")}</span><strong>{timeline.progress}%</strong></div>
      <div className="rp-progress"><i style={{ width: `${timeline.progress}%` }} /></div>
      <div className="rp-counts"><span><Database size={13} />{events.length} metadata events</span><span>{timeline.dependency_transactions} dependencies</span><span>{timeline.footprint_keys} keys</span><span>{timeline.cached_contracts} contracts/WASM</span>{timeline.preview && <span>Local preview</span>}</div>
    </section>
    {error && <div className="rp-error">{error}</div>}
    {timeline.error && <div className="rp-error"><strong>{timeline.error.code}</strong> {timeline.error.detail}</div>}

    <section className="rp-player">
      <div className="rp-player-controls">
        <button type="button" onClick={() => setPlayhead(0)} disabled={!events.length}><SkipBack size={15} /></button>
        <button type="button" className="rp-play" onClick={() => setPlaying(value => !value)} disabled={!events.length}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
        <button type="button" onClick={() => setPlayhead(value => Math.min(value + 1, events.length - 1))} disabled={!events.length}><SkipForward size={15} /></button>
        <div className="rp-speed"><FastForward size={14} />{[3, 6, 12, 24].map(value => <button type="button" key={value} className={speed === value ? "active" : ""} onClick={() => setSpeed(value)}>{value}×</button>)}</div>
        <button type="button" className="rp-live" onClick={() => setPlayhead(Math.max(0, events.length - 1))}>Jump to latest</button>
      </div>
      <div className="rp-scrubber"><input aria-label="Timeline playhead" type="range" min={0} max={Math.max(0, events.length - 1)} value={Math.min(playhead, Math.max(0, events.length - 1))} onChange={event => { setPlaying(false); setPlayhead(Number(event.target.value)); }} /><div><span>Ledger {selected?.ledger_sequence.toLocaleString() ?? "—"}</span><span>{selected ? new Date(selected.close_time * 1000).toLocaleTimeString() : "Waiting for metadata"}</span><span>Interaction {events.length ? playhead + 1 : 0}/{events.length}</span></div></div>
    </section>

    <div className="rp-timeline-layout">
      <section className="rp-event-stream">
        <div className="rp-section-title"><div><h2>Canonical activity</h2><p>Recorded metadata; nothing in this lane is being executed.</p></div><span><ShieldCheck size={13} />Verified</span></div>
        <div className="rp-event-list">{events.slice(visibleStart, visibleEnd).map(event => <button type="button" key={event.transaction_hash} className={`rp-event${event.ordinal === selected?.ordinal ? " active" : ""}`} onClick={() => { setPlaying(false); setPlayhead(event.ordinal); }}><i className={event.successful ? "success" : "failed"} /><div><strong>Ledger {event.ledger_sequence.toLocaleString()}</strong><span className="rp-mono">{event.transaction_hash.slice(0, 12)}…{event.transaction_hash.slice(-8)}</span></div><div><span>{event.event_count ?? event.event_xdr?.length ?? 0} events</span><span>{event.state_change_count ?? event.state_changes?.length ?? 0} state changes</span></div></button>)}</div>
      </section>
      <aside className="rp-playhead-card">
        <div className="rp-section-title"><div><h2>Selected playhead</h2><p>{selected ? `Immediately before interaction ${selected.ordinal + 1}` : "Waiting for activity"}</p></div></div>
        {selected ? <div className="rp-playhead-details"><dl><div><dt>Ledger</dt><dd>{selected.ledger_sequence.toLocaleString()}</dd></div><div><dt>Application order</dt><dd>{selected.application_order}</dd></div><div><dt>Footprint</dt><dd>{selected.footprint_keys} keys</dd></div><div><dt>Read/write</dt><dd>{selected.read_write_keys} keys</dd></div>{selected.source_account && <div><dt>Source</dt><dd className="rp-mono">{selected.source_account.slice(0, 7)}…{selected.source_account.slice(-5)}</dd></div>}</dl><div className="rp-contract-chips">{(selected.contracts ?? []).slice(0, 5).map(contract => <span key={contract}>{contract.slice(0, 8)}…{contract.slice(-5)}</span>)}</div></div> : <div className="rp-empty">No relevant interactions were loaded.</div>}
        <div className={`rp-ready-callout ${cacheReady ? "ready" : "warming"}`}>{cacheReady ? <><Zap size={15} /><div><strong>Fork ready</strong><span>State and contract code are preheated at this timeline.</span></div></> : <><LoaderCircle size={15} className="spin" /><div><strong>Playback is available</strong><span>Fork state is still warming in the background.</span></div></>}</div>
        <label>State/code overrides (JSON)<textarea value={overrides} onChange={event => setOverrides(event.target.value)} /></label>
        <details><summary>Advanced branch actions</summary><label>Setup deployments or invocations<textarea value={setupInvocations} onChange={event => setSetupInvocations(event.target.value)} /></label><label>Canonical replacements<textarea value={replacements} onChange={event => setReplacements(event.target.value)} /></label></details>
        <label className="rp-check"><input type="checkbox" checked={captureTrace} onChange={event => setCaptureTrace(event.target.checked)} /><span>Capture SourceLens traces</span></label>
        <button type="button" className="rp-primary" disabled={!selected || !cacheReady || busy} onClick={() => void fork()}>{busy ? <LoaderCircle size={14} className="spin" /> : <GitFork size={14} />}Fork from this playhead</button>
      </aside>
    </div>
  </div>;
}

export function ReplayPage({ scope }: { scope: ProjectScope }) {
  const pathname = usePathname();
  const search = useSearchParams();
  if (pathname.startsWith("/replays/timeline/")) {
    return <TimelineDetailPage scope={scope} timelineId={decodeURIComponent(pathname.split("/")[3] ?? "")} />;
  }
  const id = pathname.startsWith("/replays/") && pathname !== "/replays/new" ? decodeURIComponent(pathname.split("/")[2] ?? "") : null;
  if (id) return <ReplayDetailPage scope={scope} replayId={id} />;
  return search.get("transaction") || search.get("audit") ? <NewReplayPage scope={scope} /> : <NewTimelinePage scope={scope} />;
}
