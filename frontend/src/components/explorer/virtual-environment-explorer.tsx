"use client";

import { useCallback, useEffect, useState } from "react";
import { Box, CheckCircle2, Clock3, ExternalLink, RefreshCw, XCircle } from "lucide-react";
import { api } from "@/lib/api";

type PublicEnvironment = {
  id: string;
  name: string;
  network: string;
  state_ledger: number;
  protocol: number;
  status: string;
};

type Deployment = { contract_id: string; wasm_hash?: string | null; created_at: string };
type Receipt = {
  tx_hash?: string;
  hash?: string;
  status?: string;
  close_ledger?: number;
  created_at?: string;
};

type PublicExplorerData = {
  environment: PublicEnvironment;
  deployments: Deployment[];
  transactions: Receipt[];
};

const styles = `
.vex{min-height:100vh;background:#121212;color:#f4f4f4;font-family:var(--font-inter),sans-serif;letter-spacing:0}.vex *{box-sizing:border-box}.vex-shell{width:min(1120px,calc(100% - 32px));margin:0 auto}.vex-head{display:flex;height:58px;align-items:center;justify-content:space-between;border-bottom:1px solid #292929}.vex-brand,.vex-status{display:flex;align-items:center;gap:9px}.vex-brand strong{font-size:13px;font-weight:550}.vex-mark{display:grid;width:27px;height:27px;place-items:center;border:1px solid #303030;border-radius:6px}.vex-status{color:#9a9a9a;font:11px var(--font-mono),monospace}.vex-dot{width:7px;height:7px;border-radius:50%;background:#70df38}.vex-main{padding:34px 0 80px}.vex-title{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding-bottom:28px}.vex-title h1{margin:0 0 7px;font-size:25px;font-weight:500}.vex-title p{margin:0;color:#929292;font:11px var(--font-mono),monospace}.vex-refresh{display:grid;width:34px;height:34px;place-items:center;border:1px solid #303030;border-radius:6px;background:#181818;color:#d7d7d7;cursor:pointer}.vex-refresh:hover{border-color:#515151}.vex-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-top:1px solid #292929;border-bottom:1px solid #292929}.vex-metric{min-height:84px;padding:18px 20px;border-right:1px solid #292929}.vex-metric:last-child{border-right:0}.vex-metric span{display:block;margin-bottom:10px;color:#858585;font-size:10px;text-transform:uppercase}.vex-metric strong{font:13px var(--font-mono),monospace;font-weight:500}.vex-section{padding:28px 0;border-bottom:1px solid #292929}.vex-section h2{margin:0 0 14px;font-size:14px;font-weight:500}.vex-table{width:100%;border-collapse:collapse}.vex-table th,.vex-table td{height:48px;padding:0 12px;border-bottom:1px solid #252525;text-align:left;font-size:11px}.vex-table th{height:36px;color:#7f7f7f;font-size:9px;font-weight:500;text-transform:uppercase}.vex-table td{font-family:var(--font-mono),monospace}.vex-result{display:inline-flex;align-items:center;gap:6px;font-family:var(--font-inter),sans-serif}.vex-result.ok{color:#91e868}.vex-result.error{color:#ff8989}.vex-empty{display:grid;min-height:132px;place-items:center;border:1px dashed #303030;border-radius:6px;color:#777;font-size:11px}.vex-loading{display:grid;min-height:100vh;place-items:center;background:#121212;color:#919191;font-size:12px}.vex-spin{animation:vex-spin .8s linear infinite}@keyframes vex-spin{to{transform:rotate(360deg)}}
@media(max-width:700px){.vex-shell{width:min(100% - 22px,1120px)}.vex-main{padding-top:24px}.vex-title h1{font-size:20px}.vex-metrics{grid-template-columns:repeat(2,1fr)}.vex-metric:nth-child(2){border-right:0}.vex-metric:nth-child(-n+2){border-bottom:1px solid #292929}.vex-table{display:block;overflow-x:auto}.vex-table th,.vex-table td{white-space:nowrap}}
@media(prefers-reduced-motion:reduce){.vex *{animation:none!important;transition:none!important}}
`;

function time(value?: string) {
  if (!value) return "Pending";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Pending" : date.toLocaleString();
}

export function VirtualEnvironmentExplorer({ org, project, environment }: { org: string; project: string; environment: string }) {
  const [data, setData] = useState<PublicExplorerData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const path = `/api/v1/public/virtual-explorer/${encodeURIComponent(org)}/${encodeURIComponent(project)}/${encodeURIComponent(environment)}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await api.get<PublicExplorerData>(path, { skipAuth: true }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This environment explorer is unavailable.");
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => { void load(); }, [load]);

  if (loading && !data) return <div className="vex-loading"><style>{styles}</style><RefreshCw className="vex-spin" size={18}/></div>;
  if (!data) return <div className="vex-loading"><style>{styles}</style>{error || "This environment explorer is unavailable."}</div>;

  return <main className="vex"><style>{styles}</style><div className="vex-shell">
    <header className="vex-head"><div className="vex-brand"><span className="vex-mark"><Box size={14}/></span><strong>Releeve Virtual Explorer</strong></div><span className="vex-status"><span className="vex-dot"/>{data.environment.status}</span></header>
    <div className="vex-main">
      <div className="vex-title"><div><h1>{data.environment.name}</h1><p>{data.environment.network} / isolated virtual chain</p></div><button className="vex-refresh" aria-label="Refresh explorer" title="Refresh" onClick={()=>void load()}><RefreshCw className={loading?"vex-spin":""} size={14}/></button></div>
      <section className="vex-metrics"><div className="vex-metric"><span>State ledger</span><strong>{data.environment.state_ledger.toLocaleString()}</strong></div><div className="vex-metric"><span>Protocol</span><strong>{data.environment.protocol}</strong></div><div className="vex-metric"><span>Transactions</span><strong>{data.transactions.length}</strong></div><div className="vex-metric"><span>Deployments</span><strong>{data.deployments.length}</strong></div></section>
      <section className="vex-section"><h2>Virtual transactions</h2>{data.transactions.length?<table className="vex-table"><thead><tr><th>Transaction</th><th>Result</th><th>Ledger</th><th>Time</th></tr></thead><tbody>{data.transactions.map((receipt,index)=>{const status=receipt.status??"unknown";const ok=status==="success";return <tr key={receipt.tx_hash??receipt.hash??index}><td>{receipt.tx_hash??receipt.hash??"Unavailable"}</td><td><span className={`vex-result ${ok?"ok":"error"}`}>{ok?<CheckCircle2 size={13}/>:<XCircle size={13}/>} {status}</span></td><td>{receipt.close_ledger?.toLocaleString()??"Pending"}</td><td>{time(receipt.created_at)}</td></tr>})}</tbody></table>:<div className="vex-empty"><Clock3 size={16}/>No virtual transactions yet.</div>}</section>
      <section className="vex-section"><h2>Contract deployments</h2>{data.deployments.length?<table className="vex-table"><thead><tr><th>Contract</th><th>WASM hash</th><th>Deployed</th></tr></thead><tbody>{data.deployments.map(item=><tr key={item.contract_id}><td>{item.contract_id}</td><td>{item.wasm_hash??"Unavailable"}</td><td>{time(item.created_at)}</td></tr>)}</tbody></table>:<div className="vex-empty"><ExternalLink size={16}/>No contracts deployed.</div>}</section>
    </div>
  </div></main>;
}
