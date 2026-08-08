"use client";

import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { api, ApiError } from "@/lib/api";
import { getRecentLedgers } from "@/lib/explorer-api";
import { truncateEntity } from "@/lib/explorer-routes";

export type ProjectScope = {
  organization: string | null;
  project: string | null;
  network: "mainnet" | "testnet" | "futurenet";
};

type CursorPage<T> = {
  data: T[];
  next_cursor?: string | null;
  prev_cursor?: string | null;
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
};

const fieldStyle = {
  width: "100%",
  minHeight: 34,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  borderRadius: 5,
  padding: "7px 9px",
  font: "inherit",
  fontSize: 12.5,
} as const;

const buttonStyle = {
  minHeight: 32,
  border: "1px solid var(--border)",
  background: "var(--panel)",
  color: "var(--text)",
  borderRadius: 5,
  padding: "6px 10px",
  font: "inherit",
  fontSize: 12,
  fontWeight: 650,
  cursor: "pointer",
} as const;

const primaryButtonStyle = {
  ...buttonStyle,
  borderColor: "var(--green)",
  background: "var(--green)",
  color: "#fff",
} as const;

function scopePath(scope: ProjectScope, path: string) {
  if (!scope.organization || !scope.project) return null;
  return `/api/v1/${encodeURIComponent(scope.organization)}/${encodeURIComponent(scope.project)}${path}`;
}

function timeLabel(value?: string | null) {
  if (!value) return "Not synced yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not synced yet";
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)} hr ago`;
  return `${Math.floor(minutes / 1_440)} days ago`;
}

function Surface({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return <div style={{ border: "1px solid var(--border)", background: "var(--panel)", borderRadius: 6, ...style }}>{children}</div>;
}

function PageMessage({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "error" }) {
  return <div style={{ padding: "15px 2px", color: tone === "error" ? "var(--red)" : "var(--text-faint)", fontSize: 12.5 }}>{children}</div>;
}

function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, margin: "2px 3px 17px" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>{title}</h1>
        <p style={{ margin: "5px 0 0", color: "var(--text-dim)", fontSize: 12.5, lineHeight: 1.5 }}>{description}</p>
      </div>
      {action}
    </div>
  );
}

function Pagination({ page, onPage }: { page: CursorPage<unknown>; onPage: (cursor: string | null) => void }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
      <button type="button" style={buttonStyle} disabled={!page.prev_cursor} onClick={() => onPage(page.prev_cursor ?? null)}>Back</button>
      <button type="button" style={buttonStyle} disabled={!page.next_cursor} onClick={() => onPage(page.next_cursor ?? null)}>Next</button>
    </div>
  );
}

function EntityTable({ entities, kind, network, onOpen }: { entities: TrackedEntity[]; kind: "account" | "contract"; network: string; onOpen: (address: string) => void }) {
  return (
    <Surface>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 130px 120px", gap: 12, padding: "10px 12px", borderBottom: "1px solid var(--border)", color: "var(--text-faint)", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase" }}>
        <span>{kind === "account" ? "Account" : "Contract"}</span><span>Network</span><span>Last synced</span>
      </div>
      {entities.map((entity) => (
        <button key={entity.address} type="button" onClick={() => onOpen(entity.address)} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 130px 120px", gap: 12, width: "100%", textAlign: "left", padding: "12px", border: 0, borderBottom: "1px solid var(--border)", background: "transparent", color: "var(--text)", font: "inherit", cursor: "pointer" }}>
          <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "underline", textDecorationColor: "var(--border)", textUnderlineOffset: 3 }}>{truncateEntity(entity.address, 13, 9)}</span>
          <span style={{ color: "var(--text-dim)", fontSize: 12 }}>{entity.network || network}</span>
          <span style={{ color: "var(--text-dim)", fontSize: 12 }}>{timeLabel(entity.last_synced_at)}</span>
        </button>
      ))}
    </Surface>
  );
}

export function WalletsPage({ scope }: { scope: ProjectScope }) {
  const router = useRouter();
  const [page, setPage] = useState<CursorPage<TrackedEntity>>({ data: [] });
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [address, setAddress] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (cursor: string | null = null) => {
    const path = scopePath(scope, `/accounts?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    if (!path) return;
    try { setPage(await api.get<CursorPage<TrackedEntity>>(path)); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load accounts."); }
  }, [scope]);

  useEffect(() => { void load(); }, [load]);

  const track = async (event: FormEvent) => {
    event.preventDefault();
    const path = scopePath(scope, "/accounts");
    if (!path || !address.trim()) return;
    try {
      await api.post(path, { address: address.trim(), tags: [] });
      setAddress(""); setMessage("Account is now tracked in this project."); setError(null); void load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not track this account."); }
  };
  const openAccount = async (value: string) => {
    const path = scopePath(scope, `/accounts/${encodeURIComponent(value)}`);
    if (!path) return;
    try { setSelected(await api.get<Record<string, unknown>>(path)); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load this account."); }
  };

  return <div>
    <PageHeader title="Wallets" description="Track Stellar accounts your project depends on, then open their on-chain activity in one step." />
    <Surface style={{ padding: 12, marginBottom: 16 }}>
      <form onSubmit={track} style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input aria-label="Stellar account address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="G... Stellar account address" style={{ ...fieldStyle, flex: 1 }} />
        <button type="submit" style={primaryButtonStyle}>Track account</button>
      </form>
    </Surface>
    {message && <PageMessage>{message}</PageMessage>}
    {error && <PageMessage tone="error">{error}</PageMessage>}
    {!scope.project ? <PageMessage>Select a project to manage tracked accounts.</PageMessage> : page.data.length === 0 ? <PageMessage>No accounts are tracked yet.</PageMessage> : <>
      <EntityTable entities={page.data} kind="account" network={scope.network} onOpen={openAccount} />
      <Pagination page={page} onPage={load} />
    </>}
    {selected && <Surface style={{ padding: 14, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}><span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5 }}>{String(selected.address)}</span><button type="button" style={buttonStyle} onClick={() => setSelected(null)}>Close</button></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginBottom: 12 }}><span style={{ color: "var(--text-dim)", fontSize: 12 }}>XLM balance<br /><strong style={{ color: "var(--text)" }}>{String(selected.xlm_balance ?? "Unavailable")}</strong></span><span style={{ color: "var(--text-dim)", fontSize: 12 }}>Tracked<br /><strong style={{ color: "var(--text)" }}>{selected.tracked ? "Yes" : "No"}</strong></span><span style={{ color: "var(--text-dim)", fontSize: 12 }}>Assets<br /><strong style={{ color: "var(--text)" }}>{Array.isArray(selected.token_holdings) ? selected.token_holdings.length : 0}</strong></span></div>
      <div style={{ display: "flex", gap: 8 }}><button type="button" style={buttonStyle} onClick={() => router.push(`/explorer/${scope.network}/account/${encodeURIComponent(String(selected.address))}`)}>Open explorer</button><button type="button" style={primaryButtonStyle} onClick={() => router.push(`/simulator?impersonate=${encodeURIComponent(String(selected.address))}`)}>Simulate as account</button></div>
    </Surface>}
  </div>;
}

export function ContractsPage({ scope }: { scope: ProjectScope }) {
  const router = useRouter();
  const [page, setPage] = useState<CursorPage<TrackedEntity>>({ data: [] });
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (cursor: string | null = null) => {
    const path = scopePath(scope, `/contracts?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    if (!path) return;
    try { setPage(await api.get<CursorPage<TrackedEntity>>(path)); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load contracts."); }
  }, [scope]);
  useEffect(() => { void load(); }, [load]);
  const track = async (event: FormEvent) => {
    event.preventDefault();
    const path = scopePath(scope, "/contracts");
    if (!path || !address.trim()) return;
    try { await api.post(path, { address: address.trim(), tags: [] }); setAddress(""); setError(null); void load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not track this contract."); }
  };
  const openContract = async (value: string) => {
    const path = scopePath(scope, `/contracts/${encodeURIComponent(value)}`);
    if (!path) return;
    try { setSelected(await api.get<Record<string, unknown>>(path)); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load this contract."); }
  };

  return <div>
    <PageHeader title="Contracts" description="Build a shared catalog of Soroban contracts with verification and simulation entry points." />
    <Surface style={{ padding: 12, marginBottom: 16 }}>
      <form onSubmit={track} style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input aria-label="Soroban contract address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="C... Soroban contract address" style={{ ...fieldStyle, flex: 1 }} />
        <button type="submit" style={primaryButtonStyle}>Track contract</button>
      </form>
    </Surface>
    {error && <PageMessage tone="error">{error}</PageMessage>}
    {!scope.project ? <PageMessage>Select a project to manage tracked contracts.</PageMessage> : page.data.length === 0 ? <PageMessage>No contracts are tracked yet.</PageMessage> : <>
      <EntityTable entities={page.data} kind="contract" network={scope.network} onOpen={openContract} />
      <Pagination page={page} onPage={load} />
    </>}
    {selected && <Surface style={{ padding: 14, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}><span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5 }}>{String(selected.address)}</span><button type="button" style={buttonStyle} onClick={() => setSelected(null)}>Close</button></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginBottom: 12 }}><span style={{ color: "var(--text-dim)", fontSize: 12 }}>Verification<br /><strong style={{ color: "var(--text)" }}>{String((selected.verification as { status?: string } | undefined)?.status ?? "unverified")}</strong></span><span style={{ color: "var(--text-dim)", fontSize: 12 }}>WASM hash<br /><strong style={{ color: "var(--text)" }}>{selected.current_wasm_hash ? truncateEntity(String(selected.current_wasm_hash), 8, 6) : "Unavailable"}</strong></span><span style={{ color: "var(--text-dim)", fontSize: 12 }}>Debug symbols<br /><strong style={{ color: "var(--text)" }}>{(selected.toolchain as { debug_symbols_present?: boolean } | undefined)?.debug_symbols_present ? "Present" : "Unavailable"}</strong></span></div>
      <div style={{ display: "flex", gap: 8 }}><button type="button" style={buttonStyle} onClick={() => router.push(`/explorer/${scope.network}/contract/${encodeURIComponent(String(selected.address))}`)}>Open explorer</button><button type="button" style={primaryButtonStyle} onClick={() => router.push(`/simulator?contract=${encodeURIComponent(String(selected.address))}`)}>Simulate contract</button></div>
    </Surface>}
  </div>;
}

function EnvironmentStatus({ environment }: { environment: Environment }) {
  const color = environment.sync_status === "healthy" || environment.sync_status === "syncing" ? "var(--green)" : environment.sync_status === "error" ? "var(--red)" : "var(--text-faint)";
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color, fontSize: 12 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />{environment.sync_status}</span>;
}

export function VirtualEnvPage({ scope }: { scope: ProjectScope }) {
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [selected, setSelected] = useState<Environment | null>(null);
  const [name, setName] = useState("");
  const [baseLedger, setBaseLedger] = useState("");
  const [sync, setSync] = useState(true);
  const [rename, setRename] = useState("");
  const [overrideJson, setOverrideJson] = useState("{}");
  const [rollbackLedger, setRollbackLedger] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const path = scopePath(scope, "/environments");
  const load = useCallback(async () => {
    if (!path) return;
    try { const response = await api.get<{ environments: Environment[] }>(path); setEnvironments(response.environments ?? []); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : "Fork Core environments are unavailable."); }
  }, [path]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let active = true;
    getRecentLedgers(scope.network, 1).then(({ data }) => { if (active && data?.data[0]) setBaseLedger(String(data.data[0].sequence)); });
    return () => { active = false; };
  }, [scope.network]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!path || !name.trim() || !baseLedger.trim()) return;
    try {
      await api.post(path, { name: name.trim(), network: scope.network, protocol: 27, base_ledger_sequence: Number(baseLedger), sync_enabled: sync });
      setName(""); setMessage("Environment created. Its snapshot and sync state are managed by Fork Core."); setError(null); void load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create the environment."); }
  };
  const action = async (environment: Environment, suffix: string, body?: unknown, method: "get" | "post" = "post") => {
    const actionPath = scopePath(scope, `/environments/${encodeURIComponent(environment.id)}${suffix}`);
    if (!actionPath) return;
    try {
      if (method === "get") await api.get(actionPath);
      else await api.post(actionPath, body);
      setMessage(`${environment.name} updated.`); setError(null); void load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Environment action failed."); }
  };
  const manage = (environment: Environment) => {
    setSelected(environment);
    setRename(environment.name);
    setRollbackLedger(String(environment.base_ledger_sequence));
  };
  const updateName = async () => {
    if (!selected || !rename.trim()) return;
    const target = scopePath(scope, `/environments/${encodeURIComponent(selected.id)}`);
    if (!target) return;
    try {
      await api.patch(target, { name: rename.trim() });
      setMessage("Environment name updated."); setError(null); void load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update the environment."); }
  };
  const addOverride = async () => {
    if (!selected) return;
    let body: unknown;
    try { body = JSON.parse(overrideJson); } catch { setError("Override must be valid JSON."); return; }
    await action(selected, "/overrides", body);
  };
  const rollback = async () => {
    if (!selected || !rollbackLedger.trim()) return;
    await action(selected, "/rollback", { to_ledger: Number(rollbackLedger) });
  };
  const remove = async () => {
    if (!selected) return;
    const target = scopePath(scope, `/environments/${encodeURIComponent(selected.id)}`);
    if (!target) return;
    try {
      await api.delete(target);
      setSelected(null); setMessage("Environment deleted."); setError(null); void load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete the environment."); }
  };

  return <div>
    <PageHeader title="Virtual environments" description="Fork a network ledger into a controlled Soroban workspace. Sync and overrides are always visible." />
    <Surface style={{ padding: 12, marginBottom: 16 }}>
      <form onSubmit={create} style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1fr) 150px auto auto", gap: 8, alignItems: "center" }}>
        <input aria-label="Environment name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Environment name" style={fieldStyle} />
        <input aria-label="Base ledger" type="number" value={baseLedger} onChange={(event) => setBaseLedger(event.target.value)} placeholder="Base ledger" style={fieldStyle} />
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-dim)", fontSize: 12, whiteSpace: "nowrap" }}><input type="checkbox" checked={sync} onChange={(event) => setSync(event.target.checked)} /> Continuous sync</label>
        <button type="submit" style={primaryButtonStyle}>Create environment</button>
      </form>
    </Surface>
    {message && <PageMessage>{message}</PageMessage>}
    {error && <PageMessage tone="error">{error}</PageMessage>}
    {!scope.project ? <PageMessage>Select a project to manage environments.</PageMessage> : environments.length === 0 ? <PageMessage>No virtual environments yet. Create one from a current ledger above.</PageMessage> : <Surface>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(150px, 1fr) 120px 120px 135px 210px", gap: 12, padding: "10px 12px", borderBottom: "1px solid var(--border)", color: "var(--text-faint)", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase" }}><span>Environment</span><span>Network</span><span>Base ledger</span><span>Status</span><span>Controls</span></div>
      {environments.map((environment) => <div key={environment.id} style={{ display: "grid", gridTemplateColumns: "minmax(150px, 1fr) 120px 120px 135px 210px", gap: 12, alignItems: "center", padding: "12px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontWeight: 650, fontSize: 12.5 }}>{environment.name}</span><span style={{ color: "var(--text-dim)", fontSize: 12 }}>{environment.network} p{environment.protocol}</span><span style={{ color: "var(--text-dim)", fontSize: 12 }}>{environment.base_ledger_sequence.toLocaleString()}</span><EnvironmentStatus environment={environment} />
        <span style={{ display: "flex", gap: 6 }}><button type="button" style={buttonStyle} onClick={() => void action(environment, environment.sync_enabled ? "/sync/stop" : "/sync/start")}>{environment.sync_enabled ? "Pause" : "Sync"}</button><button type="button" style={buttonStyle} onClick={() => manage(environment)}>Manage</button></span>
      </div>)}
    </Surface>}
    {selected && <Surface style={{ padding: 14, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12 }}><span style={{ fontWeight: 700, fontSize: 13 }}>{selected.name}</span><button type="button" style={buttonStyle} onClick={() => setSelected(null)}>Close</button></div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8, marginBottom: 12 }}><input aria-label="Environment name" value={rename} onChange={(event) => setRename(event.target.value)} style={fieldStyle} /><button type="button" style={buttonStyle} onClick={() => void updateName()}>Rename</button></div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(180px, .55fr)", gap: 12 }}>
        <label style={{ color: "var(--text-dim)", fontSize: 11.5 }}>Persisted override JSON<textarea value={overrideJson} onChange={(event) => setOverrideJson(event.target.value)} rows={5} style={{ ...fieldStyle, marginTop: 5, resize: "vertical", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }} /></label>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, justifyContent: "flex-end" }}><button type="button" style={buttonStyle} onClick={() => void addOverride()}>Apply override</button><input aria-label="Rollback ledger" type="number" value={rollbackLedger} onChange={(event) => setRollbackLedger(event.target.value)} style={fieldStyle} /><button type="button" style={buttonStyle} onClick={() => void rollback()}>Rollback to ledger</button><button type="button" style={{ ...buttonStyle, color: "var(--red)" }} onClick={() => void remove()}>Delete environment</button></div>
      </div>
    </Surface>}
  </div>;
}

export function SimulatorPage({ scope }: { scope: ProjectScope }) {
  const search = useSearchParams();
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [runs, setRuns] = useState<Simulation[]>([]);
  const [environmentId, setEnvironmentId] = useState("");
  const [contractId, setContractId] = useState(search.get("contract") ?? "");
  const [functionName, setFunctionName] = useState("");
  const [args, setArgs] = useState("[]");
  const [hostFunctionXdr, setHostFunctionXdr] = useState("");
  const [impersonate, setImpersonate] = useState(search.get("impersonate") ?? "");
  const [overrides, setOverrides] = useState("[]");
  const [selectedRun, setSelectedRun] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const environmentPath = scopePath(scope, "/environments");
  const simulationPath = scopePath(scope, "/simulations");
  const load = useCallback(async () => {
    if (!environmentPath || !simulationPath) return;
    try {
      const [environmentResult, simulationResult] = await Promise.all([api.get<{ environments: Environment[] }>(environmentPath), api.get<{ simulations: Simulation[] }>(simulationPath)]);
      setEnvironments(environmentResult.environments ?? []); setRuns(simulationResult.simulations ?? []); setEnvironmentId((current) => current || environmentResult.environments?.[0]?.id || ""); setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load simulation data."); }
  }, [environmentPath, simulationPath]);
  useEffect(() => { void load(); }, [load]);

  const simulate = async (event: FormEvent) => {
    event.preventDefault();
    if (!environmentId || !contractId.trim() || !functionName.trim()) { setError("Choose an environment and provide a contract and function."); return; }
    let parsedArgs: unknown; let parsedOverrides: unknown;
    try { parsedArgs = JSON.parse(args); parsedOverrides = JSON.parse(overrides); } catch { setError("Arguments and overrides must be valid JSON."); return; }
    const path = scopePath(scope, `/environments/${encodeURIComponent(environmentId)}/simulate`);
    if (!path) return;
    try {
      await api.post(path, { request: { network: scope.network, protocol: 27, contract_id: contractId.trim(), function_name: functionName.trim(), args: parsedArgs, host_function_xdr: hostFunctionXdr.trim() || null, source_account_xdr: null, transaction_envelope_xdr: null, base_ledger_sequence: null, ledger: null, explicit_ledger_keys: [], overrides: parsedOverrides, impersonate: impersonate.split(",").map((value) => value.trim()).filter(Boolean) } });
      setMessage("Simulation queued. Fork Core will persist the result and its execution evidence."); setError(null); void load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Could not queue simulation."); }
  };
  const openRun = async (run: Simulation) => {
    if (!simulationPath) return;
    try { setSelectedRun(await api.get<Record<string, unknown>>(`${simulationPath}/${encodeURIComponent(run.id)}`)); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load this simulation."); }
  };

  return <div>
    <PageHeader title="Simulator" description="Preview a Soroban invocation against a tracked virtual environment. Releeve never signs or submits the transaction." />
    <Surface style={{ padding: 14, marginBottom: 16 }}>
      <form onSubmit={simulate} style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 11 }}>
        <label style={{ color: "var(--text-dim)", fontSize: 11.5 }}>Environment<select aria-label="Environment" value={environmentId} onChange={(event) => setEnvironmentId(event.target.value)} style={{ ...fieldStyle, marginTop: 5 }}><option value="">Select environment</option>{environments.map((environment) => <option key={environment.id} value={environment.id}>{environment.name} · {environment.network} · ledger {environment.base_ledger_sequence}</option>)}</select></label>
        <label style={{ color: "var(--text-dim)", fontSize: 11.5 }}>Contract ID<input value={contractId} onChange={(event) => setContractId(event.target.value)} placeholder="C..." style={{ ...fieldStyle, marginTop: 5 }} /></label>
        <label style={{ color: "var(--text-dim)", fontSize: 11.5 }}>Function<input value={functionName} onChange={(event) => setFunctionName(event.target.value)} placeholder="balance, transfer, ..." style={{ ...fieldStyle, marginTop: 5 }} /></label>
        <label style={{ color: "var(--text-dim)", fontSize: 11.5 }}>Impersonate accounts (optional)<input value={impersonate} onChange={(event) => setImpersonate(event.target.value)} placeholder="G..., G..." style={{ ...fieldStyle, marginTop: 5 }} /></label>
        <label style={{ color: "var(--text-dim)", fontSize: 11.5, gridColumn: "1 / -1" }}>Host-function XDR (optional for supported invocation paths)<textarea value={hostFunctionXdr} onChange={(event) => setHostFunctionXdr(event.target.value)} rows={2} style={{ ...fieldStyle, marginTop: 5, resize: "vertical" }} /></label>
        <label style={{ color: "var(--text-dim)", fontSize: 11.5 }}>Arguments JSON<textarea value={args} onChange={(event) => setArgs(event.target.value)} rows={4} style={{ ...fieldStyle, marginTop: 5, resize: "vertical", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }} /></label>
        <label style={{ color: "var(--text-dim)", fontSize: 11.5 }}>State / ledger overrides JSON<textarea value={overrides} onChange={(event) => setOverrides(event.target.value)} rows={4} style={{ ...fieldStyle, marginTop: 5, resize: "vertical", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }} /></label>
        <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}><button type="submit" style={primaryButtonStyle} disabled={!environments.length}>Queue simulation</button></div>
      </form>
    </Surface>
    {message && <PageMessage>{message}</PageMessage>}
    {error && <PageMessage tone="error">{error}</PageMessage>}
    {!scope.project ? <PageMessage>Select a project to use the simulator.</PageMessage> : runs.length === 0 ? <PageMessage>No simulations have been queued in this project yet.</PageMessage> : <Surface>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 110px 140px 155px", gap: 12, padding: "10px 12px", borderBottom: "1px solid var(--border)", color: "var(--text-faint)", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase" }}><span>Invocation</span><span>Status</span><span>Base ledger</span><span>Created</span></div>
      {runs.map((run) => <button key={run.id} type="button" onClick={() => void openRun(run)} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 110px 140px 155px", gap: 12, width: "100%", textAlign: "left", padding: "12px", border: 0, borderBottom: "1px solid var(--border)", background: "transparent", color: "var(--text)", font: "inherit", fontSize: 12.5, cursor: "pointer" }}><span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{run.function_name}</span><span style={{ color: run.status === "success" ? "var(--green)" : run.status === "failed" || run.status === "error" ? "var(--red)" : "var(--text-dim)" }}>{run.status}</span><span style={{ color: "var(--text-dim)" }}>{run.base_ledger_sequence.toLocaleString()}</span><span style={{ color: "var(--text-dim)" }}>{timeLabel(run.created_at)}</span></button>)}
    </Surface>}
    {selectedRun && <Surface style={{ padding: 14, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 10 }}><span style={{ fontSize: 13, fontWeight: 700 }}>Simulation result</span><button type="button" style={buttonStyle} onClick={() => setSelectedRun(null)}>Close</button></div>
      <pre style={{ margin: 0, maxHeight: 320, overflow: "auto", color: "var(--text-dim)", fontSize: 11.5, lineHeight: 1.55, whiteSpace: "pre-wrap", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{JSON.stringify(selectedRun, null, 2)}</pre>
    </Surface>}
  </div>;
}
