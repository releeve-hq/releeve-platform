"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  Activity, ArrowUpRight, Braces, Check, ChevronDown, ChevronLeft, CircleDollarSign, Code2,
  Copy, FileCode2, GitFork, Globe, KeyRound, Layers3, LoaderCircle, Pause,
  Play, Plug, Plus, RefreshCw, RotateCcw, Settings, Trash2, Upload, Wallet, X, MoreVertical,
  Search,
} from "lucide-react";
import { api } from "@/lib/api";
import { truncateEntity } from "@/lib/explorer-routes";
import { SimulatorPage } from "./project-pages";
import { WalletExplorerDesign } from "@/components/explorer/explorer-design-views";
import { EntityIdenticon } from "@/components/explorer/entity-identicon";
import type { ExplorerAccountDetail } from "@/lib/explorer-api";

export type EnvironmentRecord = {
  id: string;
  name: string;
  network: string;
  protocol: number;
  base_ledger_sequence: number;
  state_ledger?: number | null;
  execution_ledger?: number | null;
  requested_ledger?: number | null;
  sync_status: string;
  sync_enabled: boolean;
  mode?: "frozen" | "follow_latest";
  revision?: number | null;
  state_hash?: string | null;
  verification_status?: string;
  initialization_status?: "preparing" | "ready" | "failed";
  initialization_progress?: number;
  initialization_error?: { code?: string; message?: string } | null;
  public_explorer_enabled?: boolean;
  rpc_slug?: string | null;
  rpc_url?: string;
  admin_rpc_url?: string;
  admin_secret?: string;
};

type WalletLink = { id: string; address: string; label?: string | null; created_at: string; balances?: Array<{ asset: string; amount: string; decimals: number }> };
type Deployment = { id: string; contract_id: string; wasm_hash?: string; source_account?: string; created_at: string };
type ActivityItem = { id: string; kind: string; summary: string; metadata?: unknown; created_at?: string };
type FundingRecord = { id: string; address: string; asset: string; amount: string; decimals: number; created_at: string };
type RpcLog = { id: string; method: string; status: string; latency_ms: number; caller_class: string; created_at: string };
type Revision = { id: string; revision_number: number; state_ledger: number; state_hash: string; created_at: string };

type WorkspaceData = {
  wallets: WalletLink[];
  deployments: Deployment[];
  activity: ActivityItem[];
  logs: RpcLog[];
  revisions: Revision[];
};

const cache = new Map<string, { at: number; data: WorkspaceData }>();
const CACHE_MS = 5_000;

const tabs = [
  ["overview", "Overview", Globe], ["wallets", "Wallets", Wallet],
  ["contracts", "Contracts", FileCode2], ["fund", "Fund", CircleDollarSign],
  ["fork", "Fork", GitFork], ["simulations", "Simulation", Layers3],
  ["builder", "RPC Builder", Code2],
  ["integrate", "Integrate", Plug], ["activity", "Activity", Activity],
  ["configure", "Configure", Settings],
] as const;

const styles = `
.ew{--ew-green:#a3ff5f;display:flex;min-width:0;min-height:0;flex:1;flex-direction:column;overflow-x:hidden;color:var(--text)}
@media(min-width:900px){.ew{margin-top:-24px}}
.ew-top{display:flex;min-height:36px;align-items:center;justify-content:space-between;gap:16px;padding:4px 0 8px}.ew-title{display:flex;min-width:0;align-items:center;gap:9px}.ew-title h1{margin:0;font-size:17px;font-weight:500;line-height:20px}.ew-status{display:inline-flex;align-items:center;gap:6px;color:var(--text-dim);font-size:12px}.ew-dot{width:7px;height:7px;border-radius:50%;background:var(--green)}.ew-status[data-state=failed] .ew-dot{background:#ff6b6b}.ew-status[data-state=preparing] .ew-dot{animation:ewPulse 1.2s infinite}@keyframes ewPulse{50%{opacity:.3}}
.ew-tabs{position:sticky;top:0;z-index:60;display:flex;flex-wrap:wrap;gap:2px 4px;min-width:0;overflow-x:auto;overflow-y:hidden;border-bottom:1px solid var(--border);background:var(--bg);scrollbar-width:none}.ew-tabs::-webkit-scrollbar{display:none}.ew-tab{display:flex;min-width:0;flex:0 1 auto;align-items:center;gap:7px;height:42px;padding:0 9px;border:0;background:transparent;color:var(--text-dim);font:inherit;font-size:14px;cursor:pointer;transition:color .18s ease}.ew-tab svg{width:15px}.ew-tab[data-active=true]{color:var(--text)}.ew-indicator{position:absolute;bottom:-1px;height:2px;background:var(--green);transition:transform .22s ease,width .22s ease}
.ew-actions{display:flex;align-items:center;justify-content:flex-end;gap:6px;padding:0;border:0}.ew-btn,.ew-icon-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:30px;border:1px solid var(--border);border-radius:6px;padding:0 10px;background:var(--panel);color:var(--text);font:inherit;font-size:12px;cursor:pointer;transition:border-color .15s,background .15s}.ew-icon-btn{width:30px;padding:0}.ew-back-btn{width:26px;min-width:26px;min-height:28px;height:28px;padding:0;border-color:transparent;background:transparent;color:var(--text-dim)}.ew-btn:hover,.ew-icon-btn:hover{border-color:var(--text-faint);background:var(--panel-2)}.ew-back-btn:hover{border-color:var(--text-faint);background:transparent;color:var(--text)}.ew-btn.primary{border-color:#4f8d31;background:var(--green);color:#101310}.ew-btn.danger{color:#ff8585}.ew-btn:disabled{cursor:not-allowed;opacity:.5}.ew .pw-catalog-create-button{height:32px;min-height:32px;gap:6px;padding:0 10px;border:1px solid #0f8a4d;border-right-color:#0f8a4d;border-radius:6px;background:#078a4f;color:#fff;font-family:var(--font-inter),-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:12.5px;font-weight:650;letter-spacing:normal;line-height:normal}.ew .pw-catalog-create-button:hover:not(:disabled){border-color:#079d59;background:#079d59}
.ew-content{min-height:360px;padding:18px 0}.ew-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.ew-band{border-top:1px solid var(--border);padding:14px 0}.ew-band:first-child{border-top:0}.ew-band h2{margin:0 0 12px;font-size:14px;font-weight:500}.ew-rpc-band{padding-top:0}.ew-subtabs{display:flex;align-items:flex-end;gap:4px;margin-bottom:14px;border-bottom:1px solid var(--border)}.ew-subtab{position:relative;display:inline-flex;min-height:40px;align-items:center;gap:7px;border:0;padding:0 10px;background:transparent;color:var(--text-dim);font:inherit;font-size:13px;cursor:pointer}.ew-subtab[data-active=true]{color:var(--text)}.ew-subtab[data-active=true]::after{content:"";position:absolute;right:0;bottom:-1px;left:0;height:2px;background:var(--green)}.ew-kv{display:grid;grid-template-columns:minmax(130px,.55fr) minmax(0,1fr);gap:0}.ew-kv span{min-height:36px;padding:9px 0;border-bottom:1px solid var(--border);font-size:12px}.ew-kv span:nth-child(odd){color:var(--text-dim)}.ew-verification{display:inline-flex;align-items:center;gap:6px}.ew-kv .ew-verification{min-height:36px;padding:9px 0;color:var(--text)}.ew-verification-icon{display:inline-flex;width:17px;height:17px;align-items:center;justify-content:center;border:1px solid var(--border);border-radius:50%;color:var(--text-faint)}.ew-kv .ew-verification-icon{min-height:17px;height:17px;padding:0}.ew-verification-icon > span{display:block;width:5px;height:5px;min-height:5px;padding:0;border-radius:50%;background:var(--text-faint)}.ew-verification-icon svg{stroke-width:3}.ew-verification.is-verified .ew-verification-icon{border-color:var(--green);background:var(--green);color:#101310}.ew-verification.is-failed .ew-verification-icon{border-color:var(--red);background:var(--red);color:#fff}.ew-mono{overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.ew-section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.ew-section-head h2{margin:0}.ew-action-head{align-items:center}.ew-section-tools{display:flex;align-items:center;justify-content:flex-end;gap:8px;min-width:0}.ew-inline-search{position:relative;display:flex;width:min(240px,28vw);min-width:180px;height:36px;align-items:center}.ew-inline-search svg{position:absolute;left:11px;width:14px;height:14px;color:var(--text-dim);pointer-events:none}.ew-inline-search .ew-input{height:36px;min-height:36px;padding:0 10px 0 34px;background:var(--panel-2);font-size:12px}.ew-form{display:grid;max-width:680px;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.ew-field{display:grid;gap:6px;color:var(--text-dim);font-size:12px}.ew-field.full{grid-column:1/-1}.ew-input,.ew-textarea{width:100%;min-height:36px;border:1px solid var(--border);border-radius:6px;padding:8px 10px;background:var(--panel);color:var(--text);font:inherit;font-size:12px;transition:border-color .15s,box-shadow .15s}.ew-textarea{min-height:110px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.ew-input:focus,.ew-textarea:focus{outline:0;border-color:var(--text-faint);box-shadow:0 0 0 3px color-mix(in srgb,var(--text) 10%,transparent)}
.ew-wallet-table{overflow:visible;border:1px solid var(--border);border-radius:8px;background:var(--panel)}.ew-wallet-table-head,.ew-wallet-row{display:grid;grid-template-columns:minmax(260px,1fr) 128px minmax(150px,.55fr) 150px 36px;align-items:center;column-gap:20px;padding:0 16px}.ew-wallet-table-head{min-width:780px;min-height:40px;border-bottom:1px solid var(--border);color:var(--text-dim);font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.ew-wallet-row{min-width:780px;position:relative;width:100%;min-height:56px;border:0;border-bottom:1px solid var(--border);background:transparent;color:var(--text);font:inherit;text-align:left;cursor:pointer;transition:background .15s ease}.ew-wallet-row:last-child{border-bottom:0}.ew-wallet-row:hover{background:var(--panel-2)}.ew-wallet-row strong{font-size:12px;font-weight:500}.ew-wallet-row small{min-width:0;overflow:hidden;color:var(--text-dim);font-size:11px;text-overflow:ellipsis;white-space:nowrap}.ew-wallet-row > span:first-child:not(.ew-wallet-identity){display:grid;min-width:0;gap:3px}.ew-wallet-row > .ew-wallet-identity{display:flex;align-items:center;gap:10px}.ew-wallet-identity>svg{flex:0 0 auto}.ew-wallet-identity-copy{display:grid;min-width:0;gap:5px}.ew-wallet-identity-copy strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ew-wallet-row .ew-wallet-address{position:relative;display:flex;min-width:0;max-width:100%;align-items:center;gap:6px;overflow:hidden;color:var(--text-dim);font:11px ui-monospace,SFMono-Regular,Consolas,monospace;white-space:nowrap}.ew-address-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ew-copy-inline{display:inline-flex;width:16px;height:16px;flex:0 0 16px;align-items:center;justify-content:center;border:0;border-radius:0;padding:0;opacity:0;background:transparent;color:var(--text-dim);cursor:pointer;transform:translateX(-3px);transition:opacity .14s ease,transform .14s ease,color .14s ease}.ew-wallet-address:hover .ew-copy-inline,.ew-copy-inline:focus-visible{opacity:1;transform:translateX(0)}.ew-copy-inline:hover{color:var(--text)}.ew-wallet-actions{position:relative;justify-self:end}.ew-wallet-actions .ew-icon-btn{justify-self:end}.ew-wallet-menu{position:absolute;z-index:30;top:calc(100% + 5px);right:0;min-width:132px;display:grid;gap:2px;padding:4px;border:1px solid var(--border);border-radius:6px;background:var(--panel);box-shadow:0 12px 28px rgba(0,0,0,.32)}.ew-wallet-menu button{min-height:30px;border:0;border-radius:4px;padding:0 9px;background:transparent;color:var(--text-dim);font:inherit;font-size:12px;text-align:left;cursor:pointer}.ew-wallet-menu button:hover{background:var(--panel-2);color:var(--text)}.ew-link-empty{min-height:120px;display:grid;place-items:center;align-content:center;gap:7px;border:1px dashed var(--border);border-radius:6px;color:var(--text-dim);font-size:12px;text-align:center}.ew-link-empty strong{color:var(--text);font-size:13px;font-weight:500}.ew-wallet-dialog-backdrop{position:fixed;z-index:1000;inset:0;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.68)}.ew-wallet-dialog{width:min(430px,100%);border:1px solid var(--border);border-radius:8px;background:var(--panel);box-shadow:0 24px 80px rgba(0,0,0,.5)}.ew-wallet-dialog-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 20px;border-bottom:1px solid var(--border)}.ew-wallet-dialog-head h2{margin:0;font-size:16px;font-weight:500}.ew-wallet-dialog-body{display:grid;gap:14px;padding:20px}.ew-wallet-dialog-actions{display:flex;justify-content:flex-end;gap:8px;padding:0 20px 20px}.ew-wallet-dialog-error{color:var(--red);font-size:12px}.ew-wallet-dialog .ew-field{font-size:12px}
.ew-select{position:relative}.ew-select-trigger{display:flex;width:100%;min-height:36px;align-items:center;justify-content:space-between;gap:10px;border:1px solid var(--border);border-radius:6px;padding:0 10px;background:var(--panel);color:var(--text);font:inherit;font-size:12px;cursor:pointer}.ew-select-trigger:hover,.ew-select-trigger[aria-expanded=true]{border-color:var(--text-faint);background:var(--panel-2)}.ew-select-trigger:focus-visible{outline:0;box-shadow:0 0 0 3px color-mix(in srgb,var(--text) 10%,transparent)}.ew-select-trigger svg{transition:transform .2s ease}.ew-select-trigger[aria-expanded=true] svg{transform:rotate(180deg)}.ew-select-menu{position:absolute;z-index:20;top:calc(100% + 5px);left:0;right:0;display:grid;border:1px solid var(--border);border-radius:6px;padding:4px;background:var(--panel);box-shadow:0 14px 32px rgba(0,0,0,.4)}.ew-select-option{display:flex;min-height:32px;align-items:center;justify-content:space-between;border:0;border-radius:4px;padding:0 8px;background:transparent;color:var(--text-dim);font:inherit;font-size:12px;cursor:pointer;text-align:left}.ew-select-option:hover{background:var(--panel-2);color:var(--text)}.ew-select-check{display:grid;width:15px;height:15px;flex:0 0 15px;place-items:center;overflow:hidden;border-radius:50%;background:var(--green);color:#101310}.ew-select-check svg{width:10px;height:10px;stroke:currentColor;stroke-width:3}
.ew-list{display:grid;border-top:1px solid var(--border)}.ew-row{display:grid;grid-template-columns:minmax(180px,1fr) 140px 130px 36px;align-items:center;gap:12px;min-height:54px;border-bottom:1px solid var(--border);font-size:12px}.ew-row strong{font-weight:500}.ew-row small{color:var(--text-dim);font-size:12px}.ew-empty{display:grid;min-height:180px;place-items:center;border:1px dashed var(--border);border-radius:6px;color:var(--text-dim);font-size:13px;text-align:center}.ew-message{margin-bottom:12px;border:1px solid var(--border);border-radius:6px;padding:10px 12px;color:var(--text-dim);font-size:12px}.ew-message.error{border-color:#743d3d;color:#ff9a9a}.ew-code{position:relative;margin:0;overflow:auto;border:1px solid var(--border);border-radius:6px;padding:14px;background:var(--panel);color:var(--text-dim);font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap}.ew-progress{height:3px;overflow:hidden;background:var(--border)}.ew-progress span{display:block;height:100%;background:var(--green);transition:width .25s ease}
.ew-wallet-dialog-viewport{overflow:hidden}.ew-wallet-dialog-track{display:flex;width:200%;transform:translateX(0);transition:transform .24s ease}.ew-wallet-dialog-track.is-virtual{transform:translateX(-50%)}.ew-wallet-dialog-panel{width:50%;flex:0 0 50%}.ew-wallet-dialog-warning{display:grid;gap:10px}.ew-wallet-dialog-warning h3{margin:0;color:var(--text);font-size:14px;font-weight:500}.ew-wallet-dialog-warning p{margin:0;color:var(--text-dim);font-size:12px;line-height:1.55}.ew-wallet-dialog-warning strong{color:var(--text)}
.ew-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid var(--border);border-radius:6px}.ew-stat{display:grid;gap:5px;padding:11px 12px;border:0;border-right:1px solid var(--border);background:transparent;color:inherit;font:inherit;text-align:left}.ew-stat:last-child{border-right:0}.ew-stat:hover{background:var(--panel-2);cursor:pointer}.ew-stat small{color:var(--text-dim);font-size:11px}.ew-stat strong{font-size:15px;font-weight:500}.ew-search{position:relative;max-width:360px;margin:0 0 12px}.ew-search svg{position:absolute;left:10px;top:50%;width:14px;transform:translateY(-50%);color:var(--text-dim);pointer-events:none}.ew-search .ew-input{padding-left:32px}
@media(max-width:760px){.ew-grid,.ew-form{grid-template-columns:1fr}.ew-field.full{grid-column:auto}.ew-row{grid-template-columns:minmax(0,1fr) 84px 34px}.ew-row>:nth-child(3){display:none}.ew-top{align-items:flex-start}.ew-title h1{font-size:16px}}
.ew-content > .entity-root-embedded{top:0 !important}
.ew-simulation-band{padding-top:0}.ew-simulation-band > .pw-sim-editor{width:100%;max-width:none;margin:0;min-height:0}.ew-simulation-band .pw-sim-top{padding-left:0}.ew-simulation-band .pw-sim-top h1{font-size:14px}.ew-simulation-band .pw-sim-layout{min-height:calc(100vh - 220px)}.ew-simulation-band .pw-json{max-height:none;overflow:visible}
.ew-funding-table{overflow-x:auto}.ew-funding-table-head,.ew-funding-row{grid-template-columns:minmax(260px,1fr) minmax(150px,.75fr) 140px 90px 150px;min-width:780px}.ew-funding-row{cursor:default}.ew-funding-row:hover{background:transparent}.ew-wallet-balance,.ew-wallet-added{color:var(--text)!important}.ew-asset-logo{display:block;flex:0 0 auto;border-radius:50%;object-fit:cover}.ew-asset-selected,.ew-asset-option-label,.ew-asset-cell{display:inline-flex;min-width:0;align-items:center;gap:7px}.ew-asset-option-label span:last-child,.ew-asset-cell span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ew-asset-menu{max-height:260px;overflow:auto}.ew-asset-search{position:relative;display:flex;align-items:center;gap:7px;margin:2px 2px 5px;padding:0 8px;border:1px solid var(--border);border-radius:4px;color:var(--text-dim)}.ew-asset-search input{width:100%;height:30px;border:0;outline:0;background:transparent;color:var(--text);font:inherit;font-size:12px}.ew-asset-empty{padding:9px;color:var(--text-dim);font-size:12px}.ew-inline-field{display:flex;align-items:center;gap:8px}.ew-inline-field .ew-input{min-width:0}.ew-readonly-field{display:flex;align-items:center;justify-content:space-between}.ew-readonly-field strong{color:var(--text)}
@media(max-width:520px){.ew-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.ew-stat:nth-child(2){border-right:0}.ew-stat:nth-child(-n+2){border-bottom:1px solid var(--border)}}
@media(prefers-reduced-motion:reduce){.ew *{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
`;

function formatTime(value?: string) {
  if (!value) return "Pending";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Pending" : date.toLocaleString();
}

function VerificationBadge({ status }: { status?: string }) {
  const normalized = String(status ?? "pending").toLowerCase();
  const verified = normalized === "verified" || normalized === "certified";
  const failed = normalized === "failed" || normalized === "error" || normalized === "unavailable";
  return (
    <span className={`ew-verification${verified ? " is-verified" : failed ? " is-failed" : " is-pending"}`}>
      <span className="ew-verification-icon" aria-hidden="true">
        {verified ? <Check size={10} /> : failed ? <X size={10} /> : <span />}
      </span>
      {status ?? "pending"}
    </span>
  );
}

function decimalAmount(units: string, decimals: number) {
  const negative = units.startsWith("-");
  const digits = negative ? units.slice(1) : units;
  if (!/^\d+$/.test(digits) || decimals <= 0) return units;
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

async function blobToBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function WorkspaceSelect({ value, options, onChange, label, placeholder }: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const selected = options.find(option => option.value === value);
  const emptyLabel = placeholder ?? options[0]?.label ?? `Select ${label}`;
  return <div className="ew-select" ref={root}>
    <button type="button" className="ew-select-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={()=>setOpen(current=>!current)}><span>{selected?.label ?? emptyLabel}</span><ChevronDown size={14}/></button>
    {open&&<div className="ew-select-menu" role="listbox" aria-label={label}>{options.map(option=><button type="button" role="option" aria-selected={option.value===value} className="ew-select-option" key={option.value} onClick={()=>{onChange(option.value);setOpen(false)}}><span>{option.label}</span>{option.value===value&&<span className="ew-select-check"><Check size={10}/></span>}</button>)}</div>}
  </div>;
}

type FundingAssetOption = { value: string; label: string; decimals: number };
type FundWalletRequest = { address: string; asset: string; amount: string; decimals: number };

function AssetMark({ asset, size = 16 }: { asset: string; size?: number }) {
  return asset === "native"
    ? <img className="ew-asset-logo" src="/stellar-logo.jpg" alt="" width={size} height={size} style={{ width: size, height: size, objectFit: "cover", mixBlendMode: "screen", filter: "invert(1)" }} />
    : <EntityIdenticon className="ew-asset-logo" value={asset} kind="asset" size={size} />;
}

function WorkspaceToast({ message, onDone }: { message: string | null; onDone: () => void }) {
  if (!message || typeof document === "undefined") return null;
  return createPortal(
    <div className="pw-toast-container" role="status" aria-live="polite">
      <div className="pw-toast pw-toast-success" key={message}>
        <div className="pw-toast-fill" onAnimationEnd={onDone} />
        <div className="pw-toast-content"><Check size={16} /><span>{message}</span></div>
      </div>
    </div>,
    document.body,
  );
}

function FundWalletDialogLegacy({ wallets, resource, error, busy, onClose, onFund }: {
  wallets: WalletLink[];
  resource: string;
  error: string | null;
  busy: boolean;
  onClose: () => void;
  onFund: (request: FundWalletRequest) => Promise<boolean>;
}) {
  const nativeAsset: FundingAssetOption = { value: "native", label: "XLM", decimals: 7 };
  const knownAssets = wallets.flatMap(wallet => wallet.balances ?? [])
    .filter(balance => balance.asset !== "native")
    .map(balance => ({ value: balance.asset, label: `SAC ${balance.asset.slice(0, 8)}...`, decimals: balance.decimals }));
  const [fetchedAssets, setFetchedAssets] = useState<FundingAssetOption[]>([]);
  const assetOptions = [nativeAsset, ...Array.from(new Map([...knownAssets, ...fetchedAssets].map(asset => [asset.value, asset])).values())];
  const [assetMenuOpen, setAssetMenuOpen] = useState(false);
  const [assetSearch, setAssetSearch] = useState("");
  const [selectedAsset, setSelectedAsset] = useState(nativeAsset.value);
  const [contractId, setContractId] = useState("");
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState(wallets[0]?.address ?? "");
  const [amount, setAmount] = useState("");
  const selected = assetOptions.find(asset => asset.value === selectedAsset) ?? nativeAsset;
  const visibleAssets = assetOptions.filter(asset => `${asset.label} ${asset.value}`.toLowerCase().includes(assetSearch.trim().toLowerCase()));

  const fetchAsset = async () => {
    const asset = contractId.trim();
    if (!asset) return;
    setMetadataLoading(true);
    setMetadataError(null);
    try {
      const metadata = await api.post<{ asset: string; label: string; decimals: number }>(`${resource}/fund/assets`, { asset });
      const option = { value: metadata.asset, label: metadata.label, decimals: metadata.decimals };
      setFetchedAssets(assets => [...assets.filter(existing => existing.value !== option.value), option]);
      setSelectedAsset(option.value);
      setContractId(option.value);
    } catch (cause) {
      setMetadataError(cause instanceof Error ? cause.message : "Could not read this SAC contract.");
    } finally {
      setMetadataLoading(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const succeeded = await onFund({ address: walletAddress, asset: selected.value, amount: amount.trim(), decimals: selected.decimals });
    if (succeeded) onClose();
  };

  return <form className="ew-wallet-dialog" role="dialog" aria-modal="true" aria-labelledby="fund-wallet-title" onSubmit={submit}>
    <div className="ew-wallet-dialog-head"><h2 id="fund-wallet-title">Fund wallet</h2><button type="button" className="ew-icon-btn" aria-label="Close fund wallet dialog" onClick={onClose}><X size={14}/></button></div>
    <div className="ew-wallet-dialog-body">
      <label className="ew-field">Asset
        <div className="ew-select" onClick={event => event.stopPropagation()}>
          <button type="button" className="ew-select-trigger" aria-haspopup="listbox" aria-expanded={assetMenuOpen} onClick={() => setAssetMenuOpen(open => !open)}><span>{selected.label}</span><ChevronDown size={14}/></button>
          {assetMenuOpen && <div className="ew-select-menu ew-asset-menu" role="listbox" aria-label="Funding asset">
            <label className="ew-asset-search"><Search size={13}/><input autoFocus value={assetSearch} onChange={event => setAssetSearch(event.target.value)} placeholder="Search assets" onClick={event => event.stopPropagation()} /></label>
            {visibleAssets.length ? visibleAssets.map(asset => <button type="button" role="option" aria-selected={asset.value === selected.value} className="ew-select-option" key={asset.value} onClick={() => { setSelectedAsset(asset.value); setContractId(asset.value === "native" ? "" : asset.value); setAssetMenuOpen(false); }}><span>{asset.label}</span>{asset.value === selected.value && <span className="ew-select-check"><Check/></span>}</button>) : <span className="ew-asset-empty">No matching assets</span>}
          </div>}
        </div>
      </label>
      <label className="ew-field">SAC contract ID
        <span className="ew-inline-field"><input className="ew-input ew-mono" value={contractId} onChange={event => setContractId(event.target.value)} placeholder="C..."/><button type="button" className="ew-btn" disabled={metadataLoading || !contractId.trim()} onClick={() => void fetchAsset()}>{metadataLoading ? <LoaderCircle className="pw-spin" size={13}/> : "Fetch"}</button></span>
      </label>
      {metadataError && <span className="ew-wallet-dialog-error">{metadataError}</span>}
      {selected.value !== "native" && <span className="ew-field ew-readonly-field"><span>Token decimals</span><strong>{selected.decimals}</strong></span>}
      <label className="ew-field">Wallet<WorkspaceSelect label="Wallet" value={walletAddress} onChange={setWalletAddress} options={wallets.map(wallet => ({ value: wallet.address, label: wallet.label ? `${wallet.label} · ${wallet.address.slice(0, 6)}...` : wallet.address }))}/></label>
      <label className="ew-field">Amount<input className="ew-input" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder={selected.decimals === 7 ? "1000.0000000" : "1000"} required /></label>
      {error && <span className="ew-wallet-dialog-error">{error}</span>}
    </div>
    <div className="ew-wallet-dialog-actions"><button type="button" className="ew-btn" onClick={onClose}>Cancel</button><button type="submit" className="ew-btn pw-button pw-catalog-create-button" disabled={busy || !walletAddress || !amount.trim() || (selected.value !== "native" && selected.value.length === 0)}><CircleDollarSign size={14}/>Fund</button></div>
  </form>;
}

void FundWalletDialogLegacy;

function FundWalletModal({ wallets, resource, error, busy, onClose, onFund }: {
  wallets: WalletLink[];
  resource: string;
  error: string | null;
  busy: boolean;
  onClose: () => void;
  onFund: (request: FundWalletRequest) => Promise<boolean>;
}) {
  const nativeAsset: FundingAssetOption = { value: "native", label: "XLM", decimals: 7 };
  const knownAssets = wallets.flatMap(wallet => wallet.balances ?? [])
    .filter(balance => balance.asset !== "native")
    .map(balance => ({ value: balance.asset, label: `SAC ${balance.asset.slice(0, 8)}...`, decimals: balance.decimals }));
  const [fetchedAssets, setFetchedAssets] = useState<FundingAssetOption[]>([]);
  const [assetMenuOpen, setAssetMenuOpen] = useState(false);
  const [assetSearch, setAssetSearch] = useState("");
  const [selectedAsset, setSelectedAsset] = useState("");
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState("");
  const [amount, setAmount] = useState("");
  const assetOptions = [nativeAsset, ...Array.from(new Map([...knownAssets, ...fetchedAssets].map(asset => [asset.value, asset])).values())];
  const selected = assetOptions.find(asset => asset.value === selectedAsset);
  const visibleAssets = assetOptions.filter(asset => `${asset.label} ${asset.value}`.toLowerCase().includes(assetSearch.trim().toLowerCase()));

  useEffect(() => {
    const query = assetSearch.trim().toUpperCase();
    if (!assetMenuOpen || !/^C[A-Z2-7]{10,}$/.test(query)) return;
    const knownAssetValues = wallets.flatMap(wallet => wallet.balances ?? []).map(balance => balance.asset);
    if ([...knownAssetValues, ...fetchedAssets.map(asset => asset.value)].includes(query)) return;
    const timer = window.setTimeout(() => {
      setMetadataLoading(true);
      setMetadataError(null);
      void api.post<{ asset: string; label: string; decimals: number }>(`${resource}/fund/assets`, { asset: query })
        .then(metadata => {
          const option = { value: metadata.asset, label: metadata.label, decimals: metadata.decimals };
          setFetchedAssets(assets => [...assets.filter(existing => existing.value !== option.value), option]);
        })
        .catch(cause => setMetadataError(cause instanceof Error ? cause.message : "Could not read this SAC contract."))
        .finally(() => setMetadataLoading(false));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [assetMenuOpen, assetSearch, fetchedAssets, resource, wallets]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !walletAddress) return;
    const succeeded = await onFund({ address: walletAddress, asset: selected.value, amount: amount.trim(), decimals: selected.decimals });
    if (succeeded) onClose();
  };

  return <form className="pw-modal" role="dialog" aria-modal="true" aria-labelledby="fund-wallet-title" onSubmit={submit}>
    <div className="pw-modal-head"><strong id="fund-wallet-title">Fund wallet</strong><button type="button" className="pw-icon-button" aria-label="Close fund wallet dialog" onClick={onClose}><X size={16}/></button></div>
    <div className="pw-modal-body">
      <label className="pw-label">Asset
        <div className="ew-select" onClick={event => event.stopPropagation()}>
          <button type="button" className="ew-select-trigger" aria-label="Asset" aria-haspopup="listbox" aria-expanded={assetMenuOpen} onClick={() => setAssetMenuOpen(open => !open)}><span className="ew-asset-selected">{selected && <AssetMark asset={selected.value} size={16}/>}<span>{selected?.label ?? "Select Asset"}</span></span><ChevronDown size={14}/></button>
          {assetMenuOpen && <div className="ew-select-menu ew-asset-menu" role="listbox" aria-label="Funding asset">
            <label className="ew-asset-search"><Search size={13}/><input autoFocus value={assetSearch} onChange={event => setAssetSearch(event.target.value.toUpperCase())} placeholder="Search assets or paste SAC contract" onClick={event => event.stopPropagation()} />{metadataLoading && <LoaderCircle className="pw-spin" size={13}/>}</label>
            {visibleAssets.length ? visibleAssets.map(asset => <button type="button" role="option" aria-selected={asset.value === selectedAsset} className="ew-select-option" key={asset.value} onClick={() => { setSelectedAsset(asset.value); setAssetMenuOpen(false); setAssetSearch(""); setMetadataError(null); }}><span className="ew-asset-option-label"><AssetMark asset={asset.value} size={16}/><span>{asset.label}</span></span>{asset.value === selectedAsset && <span className="ew-select-check"><Check size={10}/></span>}</button>) : <span className="ew-asset-empty">{metadataLoading ? "Looking up SAC..." : "No matching assets"}</span>}
          </div>}
        </div>
      </label>
      {metadataError && <div className="pw-message pw-message-error">{metadataError}</div>}
      {selected && selected.value !== "native" && <label className="pw-label">Token decimals<input className="pw-field" value={selected.decimals} readOnly /></label>}
      <label className="pw-label">Wallet<WorkspaceSelect label="Wallet" value={walletAddress} placeholder="Select Wallet" onChange={setWalletAddress} options={wallets.map(wallet => ({ value: wallet.address, label: wallet.label ? `${wallet.label} - ${wallet.address.slice(0, 6)}...` : wallet.address }))}/></label>
      <label className="pw-label">Amount<input className="pw-field" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder={selected?.decimals === 7 ? "1000.0000000" : "1000"} required /></label>
      {error && <div className="pw-message pw-message-error">{error}</div>}
    </div>
    <div className="pw-modal-foot"><button type="button" className="pw-button" onClick={onClose}>Cancel</button><button type="submit" className="pw-button pw-catalog-create-button" disabled={busy || !selected || !walletAddress || !amount.trim()}><CircleDollarSign size={14}/>Fund</button></div>
  </form>;
}

export function EnvironmentWorkspace({ environment, basePath, scope, onBack, onDeleted, onRefresh }: {
  environment: EnvironmentRecord;
  basePath: string;
  scope: { organization: string | null; project: string | null; network: "mainnet" | "testnet" | "futurenet" };
  onBack: () => void;
  onDeleted: () => void;
  onRefresh: () => Promise<void> | void;
}) {
  const [tab, setTab] = useState<(typeof tabs)[number][0]>("overview");
  const [data, setData] = useState<WorkspaceData>({ wallets: [], deployments: [], activity: [], logs: [], revisions: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState("");
  const [walletLabel, setWalletLabel] = useState("");
  const [walletDialogOpen, setWalletDialogOpen] = useState(false);
  const [linkWalletStep, setLinkWalletStep] = useState<"form" | "virtual">("form");
  const [virtualWalletMessage, setVirtualWalletMessage] = useState("");
  const [fundModalOpen, setFundModalOpen] = useState(false);
  const [walletSearch, setWalletSearch] = useState("");
  const [fundSearch, setFundSearch] = useState("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [walletMenuId, setWalletMenuId] = useState<string | null>(null);
  const [selectedWallet, setSelectedWallet] = useState<WalletLink | null>(null);
  const [renameTarget, setRenameTarget] = useState<WalletLink | null>(null);
  const [renameLabel, setRenameLabel] = useState("");
  const [wasm, setWasm] = useState<File | null>(null);
  const [deploySource, setDeploySource] = useState("");
  const [forkName, setForkName] = useState("");
  const [revisionId, setRevisionId] = useState("");
  const [rpcMethod, setRpcMethod] = useState("getLatestLedger");
  const [rpcParams, setRpcParams] = useState("{}");
  const [rpcResult, setRpcResult] = useState("");
  const [rpcSearch, setRpcSearch] = useState("");
  const [rpcSubtab, setRpcSubtab] = useState<"builder" | "calls">("builder");
  const [name, setName] = useState(environment.name);
  const [rpcSlug, setRpcSlug] = useState(environment.rpc_slug ?? "");
  const [publicExplorer, setPublicExplorer] = useState(Boolean(environment.public_explorer_enabled));
  const [oneTimeSecret, setOneTimeSecret] = useState(environment.admin_secret ?? "");
  const tabList = useRef<HTMLDivElement>(null);
  const activeTab = useRef<HTMLButtonElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const resource = `${basePath}/environments/${encodeURIComponent(environment.id)}`;

  const load = useCallback(async (force = false) => {
    const saved = cache.get(resource);
    if (!force && saved && Date.now() - saved.at < CACHE_MS) {
      setData(saved.data); setLoading(false); return;
    }
    setLoading(true);
    try {
      const [wallets, deployments, activity, logs, revisions] = await Promise.all([
        api.get<{ wallets: WalletLink[] }>(`${resource}/wallets`),
        api.get<{ deployments: Deployment[] }>(`${resource}/deployments`),
        api.get<{ activity: ActivityItem[] }>(`${resource}/activity?limit=100`),
        api.get<{ logs: RpcLog[] }>(`${resource}/rpc-logs?limit=200`),
        api.get<{ revisions: Revision[] }>(`${resource}/revisions`),
      ]);
      const next = { wallets: wallets.wallets ?? [], deployments: deployments.deployments ?? [], activity: activity.activity ?? [], logs: logs.logs ?? [], revisions: revisions.revisions ?? [] };
      cache.set(resource, { at: Date.now(), data: next }); setData(next);
      if (!revisionId && next.revisions[0]) setRevisionId(next.revisions[0].id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load this environment.");
    } finally { setLoading(false); }
  }, [resource, revisionId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!activeTab.current) return;
    const sync = () => setIndicator({ left: activeTab.current?.offsetLeft ?? 0, width: activeTab.current?.offsetWidth ?? 0 });
    sync(); window.addEventListener("resize", sync); return () => window.removeEventListener("resize", sync);
  }, [tab]);
  useEffect(() => {
    if (!(["preparing", "syncing"] as string[]).includes(environment.initialization_status ?? environment.sync_status)) return;
    const timer = window.setInterval(() => void onRefresh(), 2_000); return () => window.clearInterval(timer);
  }, [environment.initialization_status, environment.sync_status, onRefresh]);

  const mutate = async (work: () => Promise<void>, success: string | null) => {
    setBusy(true); setError(null);
    try { await work(); cache.delete(resource); await load(true); if (success) setToastMessage(success); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The operation failed."); return false; }
    finally { setBusy(false); }
  };

  const closeWalletDialog = () => {
    setWalletDialogOpen(false);
    setLinkWalletStep("form");
    setVirtualWalletMessage("");
    setError(null);
  };

  const linkWallet = async (confirmVirtual = false) => {
    const address = walletAddress.trim();
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ requires_virtual_confirmation?: boolean; message?: string; virtual_only?: boolean }>(`${resource}/wallets`, {
        address,
        label: walletLabel.trim() || undefined,
        confirm_virtual: confirmVirtual,
      });
      if (result.requires_virtual_confirmation) {
        setVirtualWalletMessage(result.message ?? "This address is not present on the selected network and can only exist virtually in this environment.");
        setLinkWalletStep("virtual");
        return;
      }
      cache.delete(resource);
      await load(true);
      setWalletAddress("");
      setWalletLabel("");
      closeWalletDialog();
      setToastMessage(result.virtual_only ? "Virtual account created." : "Wallet linked.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The wallet could not be linked.");
    } finally {
      setBusy(false);
    }
  };

  const openRenameWallet = (wallet: WalletLink) => {
    setWalletMenuId(null);
    setError(null);
    setRenameTarget(wallet);
    setRenameLabel(wallet.label ?? "");
  };

  const openWallet = (wallet: WalletLink) => {
    setWalletMenuId(null);
    setWalletDialogOpen(false);
    setTab("wallets");
    setSelectedWallet(wallet);
  };

  const selectTab = (nextTab: (typeof tabs)[number][0]) => {
    setTab(nextTab);
    setSelectedWallet(null);
    setWalletMenuId(null);
    setWalletDialogOpen(false);
    setRenameTarget(null);
  };

  const renameWallet = async () => {
    if (!renameTarget) return;
    const succeeded = await mutate(async () => {
      await api.patch(`${resource}/wallets/${renameTarget.id}`, { label: renameLabel.trim() || null });
      setRenameTarget(null);
      setRenameLabel("");
    }, null);
    if (succeeded) {
      setToastMessage("Wallet label updated.");
    }
  };

  const fundWallet = async (request: FundWalletRequest) => {
    const succeeded = await mutate(async () => {
      await api.post(`${resource}/fund`, request, { headers: { "Idempotency-Key": crypto.randomUUID() } });
    }, "Virtual balance updated.");
    if (succeeded) {
      const assetLabel = request.asset === "native" ? "XLM" : `SAC ${request.asset.slice(0, 8)}...`;
      setToastMessage(`Wallet funded: ${request.amount} ${assetLabel} to ${request.address.slice(0, 8)}...`);
    }
    return succeeded;
  };

  const copy = async (value: string) => { await navigator.clipboard.writeText(value); setToastMessage("Copied to clipboard."); };
  const copyAddress = (value: string) => { void navigator.clipboard.writeText(value).catch(() => undefined); };
  const browserOrigin = typeof window === "undefined" ? "http://localhost:8080" : window.location.origin.replace(/:\d+$/, ":8080");
  const projectPath = basePath.replace(/^\/api\/v1/, "");
  const endpointSegment = environment.rpc_slug || environment.id;
  const rpcUrl = environment.rpc_url ?? `${browserOrigin}/v${projectPath}/${endpointSegment}`;
  const explorerUrl = `/virtual-explorer${projectPath}/${endpointSegment}`;
  const status = environment.initialization_status ?? (environment.sync_status === "error" ? "failed" : "ready");
  const failedCalls = data.logs.filter(log => log.status !== "success" && log.status !== "ok" && !String(log.status).startsWith("2")).length;
  const visibleLogs = data.logs.filter(log => `${log.method} ${log.status} ${log.caller_class}`.toLowerCase().includes(rpcSearch.trim().toLowerCase()));
  const normalizedWalletSearch = walletSearch.trim().toLowerCase();
  const visibleWallets = data.wallets.filter(wallet => `${wallet.label ?? ""} ${wallet.address} ${environment.network} ${(wallet.balances ?? []).map(balance => `${decimalAmount(balance.amount, balance.decimals)} ${balance.asset === "native" ? "XLM" : balance.asset}`).join(" ")}`.toLowerCase().includes(normalizedWalletSearch));
  const nativeBalance = selectedWallet?.balances?.find(balance => balance.asset === "native");
  const selectedWalletAccount: ExplorerAccountDetail | null = selectedWallet ? {
    address: selectedWallet.address,
    network: environment.network,
    tracked: true,
    xlm_balance: nativeBalance
      ? `${decimalAmount(nativeBalance.amount, nativeBalance.decimals)} XLM`
      : "0 XLM",
    usd_value: null,
    token_holdings: (selectedWallet.balances ?? [])
      .filter(balance => balance.asset !== "native")
      .map(balance => ({
        asset: balance.asset,
        balance: decimalAmount(balance.amount, balance.decimals),
        usd_value: null,
      })),
  } : null;

  const fundingRecords: FundingRecord[] = data.activity
    .filter(item => item.kind === "wallet.funded")
    .map(item => {
      const metadata = item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
        ? item.metadata as Record<string, unknown>
        : {};
      const address = typeof metadata.address === "string" ? metadata.address : "";
      const asset = typeof metadata.asset === "string" ? metadata.asset : "";
      const amount = typeof metadata.amount === "string" ? metadata.amount : "";
      const decimals = typeof metadata.decimals === "number" ? metadata.decimals : 7;
      return address && asset && amount ? { id: item.id, address, asset, amount, decimals, created_at: item.created_at ?? "" } : null;
    })
    .filter((record): record is FundingRecord => record !== null);
  const walletLabelFor = (address: string) => data.wallets.find(wallet => wallet.address === address)?.label?.trim() || "Unlabelled wallet";
  const normalizedFundSearch = fundSearch.trim().toLowerCase();
  const visibleFundingRecords = fundingRecords.filter(record => `${walletLabelFor(record.address)} ${record.address} ${record.asset === "native" ? "XLM" : record.asset} ${record.amount} ${record.decimals} ${formatTime(record.created_at)}`.toLowerCase().includes(normalizedFundSearch));

  const walletDialogs = <>
    <WorkspaceToast message={toastMessage} onDone={() => setToastMessage(null)} />
    {tab === "fund" && fundModalOpen && typeof document !== "undefined" && createPortal(
      <div className="pw-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setFundModalOpen(false); }}>
        <FundWalletModal wallets={data.wallets} resource={resource} error={error} busy={busy} onClose={() => setFundModalOpen(false)} onFund={fundWallet} />
      </div>, document.body
    )}
    {tab === "wallets" && walletDialogOpen && typeof document !== "undefined" && createPortal(
      <div className="ew-wallet-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeWalletDialog(); }}>
        <form className="ew-wallet-dialog" role="dialog" aria-modal="true" aria-labelledby="link-wallet-title" onSubmit={event => { event.preventDefault(); if (linkWalletStep === "form") void linkWallet(); }}>
          <div className="ew-wallet-dialog-head"><h2 id="link-wallet-title">{linkWalletStep === "virtual" ? "Create account" : "Link wallet"}</h2><button type="button" className="ew-icon-btn" aria-label="Close link wallet dialog" onClick={closeWalletDialog}><X size={14}/></button></div>
          <div className="ew-wallet-dialog-viewport"><div className={`ew-wallet-dialog-track${linkWalletStep === "virtual" ? " is-virtual" : ""}`}>
            <section className="ew-wallet-dialog-panel" aria-hidden={linkWalletStep !== "form"}>
              <div className="ew-wallet-dialog-body"><label className="ew-field">Address<input className="ew-input ew-mono" value={walletAddress} onChange={event => setWalletAddress(event.target.value)} placeholder="G..." autoFocus required /></label><label className="ew-field">Name<input className="ew-input" value={walletLabel} onChange={event => setWalletLabel(event.target.value)} placeholder="Treasury wallet" /></label>{error && <span className="ew-wallet-dialog-error">{error}</span>}</div>
              <div className="ew-wallet-dialog-actions"><button type="button" className="ew-btn" onClick={closeWalletDialog}>Cancel</button><button type="submit" className="ew-btn pw-button pw-catalog-create-button" disabled={busy || !walletAddress.trim()}><Plus size={14}/>Link wallet</button></div>
            </section>
            <section className="ew-wallet-dialog-panel" aria-hidden={linkWalletStep !== "virtual"}>
              <div className="ew-wallet-dialog-body ew-wallet-dialog-warning"><h3>This address is not on the selected network</h3><p>{virtualWalletMessage}</p></div>
              <div className="ew-wallet-dialog-actions"><button type="button" className="ew-btn" onClick={() => { setLinkWalletStep("form"); setVirtualWalletMessage(""); }}>Back</button><button type="button" className="ew-btn pw-button pw-catalog-create-button" disabled={busy} onClick={() => void linkWallet(true)}><Plus size={14}/>Create account</button></div>
            </section>
          </div></div>
        </form>
      </div>, document.body
    )}
    {tab === "wallets" && renameTarget && typeof document !== "undefined" && createPortal(
      <div className="ew-wallet-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setRenameTarget(null); }}>
        <form className="ew-wallet-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-wallet-title" onSubmit={event => { event.preventDefault(); void renameWallet(); }}>
          <div className="ew-wallet-dialog-head"><h2 id="rename-wallet-title">Rename wallet label</h2><button type="button" className="ew-icon-btn" aria-label="Close rename wallet dialog" onClick={() => setRenameTarget(null)}><X size={14}/></button></div>
          <div className="ew-wallet-dialog-body"><div className="ew-field"><span>Address</span><span className="ew-wallet-address ew-mono">{renameTarget.address}</span></div><label className="ew-field">Name<input className="ew-input" value={renameLabel} onChange={event => setRenameLabel(event.target.value)} placeholder="Treasury wallet" autoFocus maxLength={80} /></label>{error && <span className="ew-wallet-dialog-error">{error}</span>}</div>
          <div className="ew-wallet-dialog-actions"><button type="button" className="ew-btn" onClick={() => setRenameTarget(null)}>Cancel</button><button type="submit" className="ew-btn primary" disabled={busy}><Check size={14}/>Save label</button></div>
        </form>
      </div>, document.body
    )}
  </>;

  return <div className="ew"><style>{styles}</style>
    <div className="ew-top">
      <div className="ew-title"><button className="ew-icon-btn ew-back-btn" onClick={onBack} aria-label="Back"><ChevronLeft size={18} /></button><div><h1>{environment.name}</h1><span className="ew-status" data-state={status}><span className="ew-dot"/>{status === "preparing" ? `Preparing environment ${environment.initialization_progress ?? 0}%` : status === "failed" ? "Preparation failed" : `${environment.network} / ${environment.mode === "follow_latest" ? "Network sync" : "Frozen"}`}</span></div></div>
      <div className="ew-actions"><button className="ew-icon-btn" title="Refresh" onClick={()=>void load(true)}><RotateCcw size={14}/></button><button className="ew-icon-btn" title="Open RPC endpoint" onClick={()=>window.open(rpcUrl,"_blank","noopener,noreferrer")}><ArrowUpRight size={14}/></button><button className="ew-icon-btn" title={environment.sync_enabled?"Freeze environment":"Resume network sync"} onClick={()=>void mutate(async()=>{await api.post(`${resource}/sync/${environment.sync_enabled?"stop":"start"}`,undefined,environment.sync_enabled?undefined:{headers:{"Idempotency-Key":crypto.randomUUID()}});await onRefresh()},environment.sync_enabled?"Environment frozen at its current ledger.":"Network sync started.")}>{environment.sync_enabled?<Pause size={14}/>:<RefreshCw size={14}/>}</button></div>
    </div>
    {status === "preparing" && <div className="ew-progress"><span style={{width:`${environment.initialization_progress ?? 0}%`}}/></div>}
    {status === "failed" && <div className="ew-message error">{environment.initialization_error?.message ?? "This environment could not prove its anchored state. No newer network state was substituted."}</div>}
    <div ref={tabList} className="ew-tabs">{tabs.map(([id,label,Icon]) => <button ref={tab===id?activeTab:undefined} key={id} className="ew-tab" data-active={tab===id} onClick={()=>selectTab(id)}><Icon/>{label}</button>)}<span className="ew-indicator" style={{width:indicator.width,transform:`translateX(${indicator.left}px)`}}/></div>
    <div className="ew-content">{selectedWallet && selectedWalletAccount && <WalletExplorerDesign account={selectedWalletAccount} network={environment.network} address={selectedWallet.address} embedded environmentScoped onBack={() => setSelectedWallet(null)} />}{!selectedWallet && <div className="ew-wallet-content">{error&&<div className="ew-message error">{error}</div>}{loading?<div className="ew-empty"><LoaderCircle className="pw-spin"/></div>:<>
      {tab==="overview"&&<><div className="ew-stats" aria-label="Environment usage"><div className="ew-stat"><small>RPC calls</small><strong>{data.logs.length}</strong></div><div className="ew-stat"><small>Errors</small><strong>{failedCalls}</strong></div><button type="button" className="ew-stat" aria-label={`Open ${data.wallets.length} linked wallets`} onClick={()=>setTab("wallets")}><small>Wallets</small><strong>{data.wallets.length}</strong></button><div className="ew-stat"><small>Deployments</small><strong>{data.deployments.length}</strong></div></div><div className="ew-grid"><section className="ew-band"><h2>Environment details</h2><div className="ew-kv"><span>Network</span><span>{environment.network}</span><span>Mode</span><span>{environment.mode === "follow_latest"?"Network sync":"Frozen"}</span><span>Pinned state ledger</span><span>{(environment.state_ledger??environment.base_ledger_sequence).toLocaleString()}</span><span>Execution ledger</span><span>{environment.execution_ledger?.toLocaleString()??"Preparing"}</span><span>Protocol</span><span>{environment.protocol}</span><span>Verification</span><VerificationBadge status={environment.verification_status}/><span>State hash</span><span className="ew-mono">{environment.state_hash??"Preparing"}</span></div></section><section className="ew-band"><h2>Recent activity</h2>{data.activity.length?<div className="ew-list">{data.activity.slice(0,6).map(item=><div className="ew-row" key={item.id}><strong>{item.summary}</strong><small>{item.kind}</small><small>{formatTime(item.created_at)}</small><span/></div>)}</div>:<div className="ew-empty">No activity yet.</div>}</section></div></>}
      {tab==="wallets"&&<section className="ew-band"><div className="ew-section-head ew-action-head"><h2>Linked wallets</h2><div className="ew-section-tools"><label className="ew-inline-search"><Search/><span className="sr-only">Search linked wallets</span><input className="ew-input" value={walletSearch} onChange={event=>setWalletSearch(event.target.value)} placeholder="Search wallets"/></label><button type="button" className="ew-btn pw-button pw-catalog-create-button" disabled={busy} onClick={()=>{setError(null);setWalletDialogOpen(true)}}><Plus size={14}/>Link wallet</button></div></div>{data.wallets.length?<div className="ew-wallet-table"><div className="ew-wallet-table-head"><span>Wallet</span><span>Network</span><span>Balance</span><span>Added</span><span /></div>{visibleWallets.map(wallet=><div className="ew-wallet-row" role="button" tabIndex={0} key={wallet.id} aria-label={`Open wallet ${wallet.label||wallet.address}`} onClick={()=>openWallet(wallet)} onKeyDown={event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();openWallet(wallet)}}}><span className="ew-wallet-identity"><EntityIdenticon value={wallet.address} kind="account" size={28}/><span className="ew-wallet-identity-copy"><strong>{wallet.label||"Unlabelled wallet"}</strong><span className="ew-wallet-address"><span className="ew-address-text">{truncateEntity(wallet.address,15,11)}</span><button type="button" className="ew-copy-inline" aria-label={`Copy ${wallet.address}`} title="Copy wallet address" onClick={event=>{event.stopPropagation();copyAddress(wallet.address)}}><Copy size={12}/></button></span></span></span><span>{environment.network}</span><small className="ew-wallet-balance">{wallet.balances?.length?wallet.balances.map(balance=>`${decimalAmount(balance.amount,balance.decimals)} ${balance.asset==="native"?"XLM":balance.asset.slice(0,6)+"..."}`).join(" / "):"0"}</small><small className="ew-wallet-added">{formatTime(wallet.created_at)}</small><div className="ew-wallet-actions" onClick={event=>event.stopPropagation()}><button type="button" className="ew-icon-btn" title="Wallet actions" aria-label={`Wallet actions for ${wallet.label||wallet.address}`} aria-expanded={walletMenuId===wallet.id} onClick={()=>setWalletMenuId(current=>current===wallet.id?null:wallet.id)}><MoreVertical size={14}/></button>{walletMenuId===wallet.id&&<div className="ew-wallet-menu" role="menu"><button type="button" role="menuitem" onClick={()=>openRenameWallet(wallet)}>Rename label</button></div>}</div></div>)}{!visibleWallets.length&&<div className="ew-link-empty"><strong>No wallets match this search</strong><span>Try a different wallet label or address.</span></div>}</div>:<div className="ew-link-empty"><strong>No wallets linked yet</strong><span>Link any Stellar wallet to inspect its virtual balances.</span></div>}</section>}
      {tab==="contracts"&&<section className="ew-band"><div className="ew-section-head"><h2>Deploy contract</h2><button className="ew-btn primary" disabled={busy||!wasm||!deploySource} onClick={()=>void mutate(async()=>{if(!wasm)return;await api.post(`${resource}/deploy`,{source_account:deploySource,wasm:await blobToBase64(wasm)},{headers:{"Idempotency-Key":crypto.randomUUID()}});setWasm(null)},"Contract deployed.")}><Upload size={14}/>Deploy WASM</button></div><div className="ew-form"><label className="ew-field">Source account<input className="ew-input ew-mono" value={deploySource} onChange={e=>setDeploySource(e.target.value)} placeholder="G..."/></label><label className="ew-field">WASM<input className="ew-input" type="file" accept=".wasm,application/wasm" onChange={e=>setWasm(e.target.files?.[0]??null)}/></label></div><div className="ew-list" style={{marginTop:16}}>{data.deployments.map(item=><div className="ew-row" key={item.id}><div><strong className="ew-mono">{item.contract_id}</strong><br/><small className="ew-mono">{item.wasm_hash}</small></div><small>{item.source_account||"Virtual deploy"}</small><small>{formatTime(item.created_at)}</small><button className="ew-icon-btn" onClick={()=>void copy(item.contract_id)}><Copy size={13}/></button></div>)}</div></section>}
      {tab==="fund"&&<section className="ew-band"><div className="ew-section-head ew-action-head"><h2>Fund Wallet</h2><div className="ew-section-tools"><label className="ew-inline-search"><Search/><span className="sr-only">Search funding history</span><input className="ew-input" value={fundSearch} onChange={event=>setFundSearch(event.target.value)} placeholder="Search funding history"/></label><button type="button" className="ew-btn pw-button pw-catalog-create-button" disabled={!data.wallets.length||busy} onClick={()=>{setError(null);setFundModalOpen(true)}}><CircleDollarSign size={14}/>Fund</button></div></div><div className="ew-wallet-table ew-funding-table"><div className="ew-wallet-table-head ew-funding-table-head"><span>Wallet</span><span>Asset</span><span>Amount</span><span>Decimals</span><span>Funded</span></div>{visibleFundingRecords.length?visibleFundingRecords.map(record=><div className="ew-wallet-row ew-funding-row" key={record.id}><span className="ew-wallet-identity"><EntityIdenticon value={record.address} kind="account" size={28}/><span className="ew-wallet-identity-copy"><strong>{walletLabelFor(record.address)}</strong><span className="ew-wallet-address"><span className="ew-address-text">{truncateEntity(record.address,15,11)}</span><button type="button" className="ew-copy-inline" aria-label={`Copy ${record.address}`} title="Copy wallet address" onClick={event=>{event.stopPropagation();copyAddress(record.address)}}><Copy size={12}/></button></span></span></span><span className="ew-asset-cell"><AssetMark asset={record.asset} size={16}/><span>{record.asset==="native"?"XLM":`SAC ${record.asset.slice(0,8)}...`}</span></span><span>{record.amount}</span><small>{record.decimals}</small><small>{formatTime(record.created_at)}</small></div>):<div className="ew-link-empty"><strong>{fundingRecords.length?"No funding records match this search":"No funding history yet"}</strong><span>{fundingRecords.length?"Try a different wallet, asset, or amount.":"Fund a linked wallet to see each virtual balance change here."}</span></div>}</div></section>}
      {tab==="fork"&&<section className="ew-band"><h2>Fork an immutable revision</h2><div className="ew-form"><label className="ew-field">Revision<WorkspaceSelect label="Revision" value={revisionId} onChange={setRevisionId} options={data.revisions.map(r=>({value:r.id,label:`Revision ${r.revision_number} / ledger ${r.state_ledger.toLocaleString()}`}))}/></label><label className="ew-field">New environment name<input className="ew-input" value={forkName} onChange={e=>setForkName(e.target.value)} placeholder="Incident branch"/></label><button className="ew-btn primary" disabled={busy||!revisionId||!forkName} onClick={()=>void mutate(async()=>{await api.post(`${resource}/revisions/${revisionId}/branch`,{name:forkName},{headers:{"Idempotency-Key":crypto.randomUUID()}});setForkName("");await onRefresh()},"Environment fork created.")}><GitFork size={14}/>Create fork</button></div><div className="ew-list" style={{marginTop:16}}>{data.revisions.map(r=><div className="ew-row" key={r.id}><strong>Revision {r.revision_number}</strong><small>Ledger {r.state_ledger.toLocaleString()}</small><small>{formatTime(r.created_at)}</small><span/></div>)}</div></section>}
      {tab==="simulations"&&<section className="ew-band ew-simulation-band"><SimulatorPage scope={scope} embeddedEnvironmentId={environment.id}/></section>}
      {tab==="builder"&&<section className="ew-band ew-rpc-band"><div className="ew-subtabs" role="tablist" aria-label="RPC workspace"><button type="button" role="tab" aria-selected={rpcSubtab==="builder"} className="ew-subtab" data-active={rpcSubtab==="builder"} onClick={()=>setRpcSubtab("builder")}><Code2 size={14}/>RPC Builder</button><button type="button" role="tab" aria-selected={rpcSubtab==="calls"} className="ew-subtab" data-active={rpcSubtab==="calls"} onClick={()=>setRpcSubtab("calls")}><Braces size={14}/>JSON RPC Calls</button></div>{rpcSubtab==="builder"&&<div><h2>RPC Builder</h2><div className="ew-form"><label className="ew-field">Method<WorkspaceSelect label="RPC method" value={rpcMethod} onChange={setRpcMethod} options={["getLatestLedger","getLedgerEntries","getTransaction","simulateTransaction"].map(method=>({value:method,label:method}))}/></label><label className="ew-field full">Params JSON<textarea className="ew-textarea" value={rpcParams} onChange={e=>setRpcParams(e.target.value)}/></label><button className="ew-btn primary" disabled={busy} onClick={()=>void mutate(async()=>{const result=await api.post(`${resource}/rpc`,{jsonrpc:"2.0",id:crypto.randomUUID(),method:rpcMethod,params:JSON.parse(rpcParams)});setRpcResult(JSON.stringify(result,null,2))},"RPC request completed.")}><Play size={14}/>Send request</button></div>{rpcResult&&<pre className="ew-code" style={{marginTop:16}}>{rpcResult}</pre>}</div>}{rpcSubtab==="calls"&&<div><h2>JSON RPC Calls</h2><label className="ew-search"><Search/><span className="sr-only">Search RPC calls</span><input className="ew-input" value={rpcSearch} onChange={event=>setRpcSearch(event.target.value)} placeholder="Search method, status, or caller"/></label><div className="ew-list">{visibleLogs.map(log=><div className="ew-row" key={log.id}><strong className="ew-mono">{log.method}</strong><small>{log.status} / {log.latency_ms} ms</small><small>{log.caller_class} / {formatTime(log.created_at)}</small><span/></div>)}</div>{!visibleLogs.length&&<div className="ew-empty">{data.logs.length?"No calls match this search.":"No JSON-RPC calls recorded."}</div>}</div>}</section>}
      {tab==="integrate"&&<section className="ew-band"><h2>Integrate</h2>{[["curl",`curl -X POST '${rpcUrl}' -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger","params":{}}'`],["JavaScript",`const response = await fetch('${rpcUrl}', {\n  method: 'POST',\n  headers: { 'content-type': 'application/json' },\n  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestLedger', params: {} })\n});`],["Stellar CLI",`stellar contract invoke --rpc-url '${rpcUrl}' --network-passphrase '${environment.network === "mainnet" ? "Public Global Stellar Network ; September 2015" : "Test SDF Network ; September 2015"}' --id C... -- function_name`],["GitHub Actions",`- name: Verify virtual environment\n  run: curl --fail -X POST '${rpcUrl}' -H 'content-type: application/json' --data @rpc-request.json`],["GitLab CI",`verify-environment:\n  script:\n    - curl --fail -X POST '${rpcUrl}' -H 'content-type: application/json' --data @rpc-request.json`],["Generic CI",`set -eu\ncurl --fail --silent --show-error -X POST '${rpcUrl}' \\\n  -H 'content-type: application/json' \\\n  --data '{"jsonrpc":"2.0","id":"health","method":"getLatestLedger","params":{}}'`]].map(([label,code])=><div className="ew-band" key={label}><h2>{label}</h2><pre className="ew-code">{code}</pre><button className="ew-btn" style={{marginTop:8}} onClick={()=>void copy(code)}><Copy size={13}/>Copy</button></div>)}</section>}
      {tab==="activity"&&<section className="ew-band"><h2>Environment activity</h2><div className="ew-list">{data.activity.map(item=><div className="ew-row" key={item.id}><strong>{item.summary}</strong><small>{item.kind}</small><small>{formatTime(item.created_at)}</small><span/></div>)}</div></section>}
      {tab==="configure"&&<section className="ew-band"><h2>Configure environment</h2>{oneTimeSecret&&<div className="ew-message"><strong>Admin secret, shown once:</strong> <span className="ew-mono">{oneTimeSecret}</span> <button className="ew-btn" onClick={()=>void copy(oneTimeSecret)}><Copy size={13}/>Copy</button></div>}<div className="ew-form"><label className="ew-field">Name<input className="ew-input" value={name} onChange={e=>setName(e.target.value)}/></label><label className="ew-field">Named RPC slug<input className="ew-input" value={rpcSlug} onChange={e=>setRpcSlug(e.target.value.toLowerCase())} placeholder="incident-investigation"/></label><label className="ew-field full"><span>Public Explorer</span><span style={{display:"flex",gap:8}}><button className={`ew-btn${publicExplorer?" primary":""}`} onClick={()=>setPublicExplorer(v=>!v)}>{publicExplorer?<Check size={14}/>:<Globe size={14}/>} {publicExplorer?"Enabled":"Disabled"}</button>{publicExplorer&&<button className="ew-btn" onClick={()=>window.open(explorerUrl,"_blank","noopener,noreferrer")}><ArrowUpRight size={14}/>Open Explorer</button>}</span></label><button className="ew-btn primary" disabled={busy||!name.trim()} onClick={()=>void mutate(async()=>{await api.patch(resource,{name:name.trim(),public_explorer_enabled:publicExplorer});await api.put(`${resource}/rpc-slug`,{rpc_slug:rpcSlug.trim()||null});await onRefresh()},"Configuration saved.")}><Settings size={14}/>Save configuration</button><button className="ew-btn" onClick={()=>void mutate(async()=>{const rotated=await api.post<{admin_secret:string}>(`${resource}/rpc-secret/rotate`);setOneTimeSecret(rotated.admin_secret)},"RPC credential rotated.")}><KeyRound size={14}/>Rotate credential</button><button className="ew-btn danger" onClick={()=>{if(confirm(`Delete ${environment.name}?`))void mutate(async()=>{await api.delete(resource,{headers:{"Idempotency-Key":crypto.randomUUID()}});onDeleted()},"Environment deleted.")}}><Trash2 size={14}/>Delete environment</button></div></section>}
    </>}</div>}</div>{walletDialogs}
  </div>;
}
