"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bell, Check, Copy, Globe2, MoreHorizontal, Play, Search, Share2 } from "lucide-react";
import type {
  ExplorerAccountDetail,
  ExplorerAccountTransaction,
  ExplorerPagedEnvelope,
  ExplorerTxDetail,
  JsonValue,
  ResourceUsage,
} from "@/lib/explorer-api";
import { getAccountTransactions } from "@/lib/explorer-api";
import { addressRoute, explorerRoutes, isContractAddress, stellarExpertRoute, truncateEntity } from "@/lib/explorer-routes";
import { GlobalExplorerSearch } from "@/components/explorer/global-explorer-search";
import { AssetTransfers } from "@/components/explorer/asset-transfers";
import { TransactionTrace } from "@/components/explorer/transaction-trace";
import { FundFlowGraph } from "@/components/explorer/fund-flow-graph";
import { ResourceUsagePanel } from "@/components/explorer/resource-usage";

type Tab = "summary" | "contracts" | "events" | "state" | "fundflow" | "resources";

function formatTimestamp(value?: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatJson(value: JsonValue | undefined) {
  if (value === undefined || value === null) return "null";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function feeLabel(value?: string | null) {
  if (!value) return "Not indexed";
  if (!/^\d+$/.test(value)) return value;
  return `${value} stroops (${(Number(value) / 10_000_000).toFixed(7)} XLM)`;
}

function amountLabel(tx: ExplorerTxDetail) {
  const first = tx.fund_flow[0];
  if (first?.asset === "CALL") return "Contract call";
  if (!first && tx.operation_type === "invoke_host_function") return "No asset transfer";
  return first ? `${first.amount} ${first.asset}` : "No asset transfer";
}

function flowAmountLabel(edge: { amount: string; asset: string }) {
  return edge.asset === "CALL" ? "Contract call" : `${edge.amount} ${edge.asset}`;
}

function isAccountScopedOperation(operationType?: string | null) {
  return [
    "manage_data",
    "set_options",
    "manage_sell_offer",
    "manage_buy_offer",
    "change_trust",
    "allow_trust",
    "bump_sequence",
    "begin_sponsoring_future_reserves",
    "end_sponsoring_future_reserves",
    "revoke_sponsorship",
    "clawback",
    "clawback_claimable_balance",
    "set_trust_line_flags",
    "multi_operation",
  ].includes(operationType ?? "");
}

function destinationFallback(operationType?: string | null) {
  if (operationType === "invoke_host_function") return "Invocation target unavailable";
  if (operationType === "create_account") return "Account creation";
  if (isAccountScopedOperation(operationType)) return "Source account";
  if (operationType && operationType !== "transaction") return "Source account";
  return "Source account";
}

function operationImpactLabel(operationType?: string | null) {
  switch (operationType) {
    case "manage_data":
      return "Data entry updated";
    case "set_options":
      return "Account options updated";
    case "manage_sell_offer":
    case "manage_buy_offer":
      return "Offer book updated";
    case "change_trust":
    case "allow_trust":
    case "set_trust_line_flags":
      return "Trustline updated";
    case "begin_sponsoring_future_reserves":
    case "end_sponsoring_future_reserves":
    case "revoke_sponsorship":
      return "Sponsorship updated";
    case "multi_operation":
      return "Multiple operations applied";
    default:
      return "Source account updated";
  }
}

function txTargetAddress(tx: ExplorerTxDetail) {
  return tx.fund_flow[0]?.to
    ?? tx.call_tree.find((node) => isContractAddress(node.contract_id))?.contract_id
    ?? tx.events.find((event) => isContractAddress(event.contract_id))?.contract_id
    ?? tx.operation_target_address
    ?? null;
}

function txTargetEdge(tx: ExplorerTxDetail) {
  if (tx.operation_type !== "invoke_host_function") return null;
  const target = txTargetAddress(tx);
  if (!target) return null;
  return tx.fund_flow.find((edge) => edge.to === target)
    ?? {
      id: "derived-contract-target",
      from: tx.source_account,
      to: target,
      asset: "CALL",
      amount: "0",
    };
}

function usageTotal(usage: ResourceUsage) {
  return [
    usage.cpu_instructions,
    usage.memory_bytes,
    usage.invoke_time_nsecs,
    usage.disk_read_bytes,
    usage.write_bytes,
    usage.max_rw_key_byte,
    usage.max_rw_data_byte,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value)).reduce((sum, value) => sum + value, 0);
}

function resourceRows(usage: ResourceUsage) {
  const rows = [
    ["CPU instructions", usage.cpu_instructions, ""],
    ["Memory", usage.memory_bytes, "bytes"],
    ["Invoke time", usage.invoke_time_nsecs, "ns"],
    ["Disk read", usage.disk_read_bytes, "bytes"],
    ["Write", usage.write_bytes, "bytes"],
    ["Max read/write key", usage.max_rw_key_byte, "bytes"],
    ["Max read/write data", usage.max_rw_data_byte, "bytes"],
  ] as const;
  const max = Math.max(1, ...rows.map(([, value]) => typeof value === "number" ? value : 0));
  return rows.map(([label, value, unit], index) => ({
    label,
    value: typeof value === "number" ? `${value.toLocaleString()}${unit ? ` ${unit}` : ""}` : "Not indexed",
    width: typeof value === "number" ? Math.max(6, Math.round((value / max) * 100)) : 2,
    color: ["var(--green)", "var(--orange)", "var(--purple)", "var(--blue)", "var(--red)", "var(--orange)", "var(--purple)"][index],
  }));
}

function uniqueContracts(tx: ExplorerTxDetail) {
  return Array.from(new Set([
    ...tx.call_tree.map((node) => node.contract_id).filter(Boolean),
    ...tx.events.map((event) => event.contract_id).filter(Boolean),
    ...tx.fund_flow.flatMap((edge) => [edge.from, edge.to]).filter(isContractAddress),
    txTargetAddress(tx),
  ].filter((value): value is string => Boolean(value))));
}

function topicText(value: JsonValue) {
  if (!Array.isArray(value)) return formatJson(value);
  return value.map((topic) => typeof topic === "string" ? topic : formatJson(topic)).join(" / ");
}

function EntityAnchor({ network, value, type, className }: { network: string; value: string | number; type: "tx" | "ledger" | "address"; className?: string }) {
  const href = type === "tx"
    ? explorerRoutes.tx(network, String(value))
    : type === "ledger"
      ? explorerRoutes.ledger(network, value)
      : addressRoute(network, String(value));
  return <Link className={className ?? "addr-link mono"} href={href} title={String(value)}>{type === "ledger" ? `#${value}` : truncateEntity(value, 8, 6)}</Link>;
}

function TopBar({ network, kind, value }: { network: string; kind: "tx" | "account" | "contract" | "ledger"; value: string | number }) {
  const share = async () => {
    const url = window.location.href;
    if (navigator.share) await navigator.share({ title: `Releeve ${kind}`, url });
    else await navigator.clipboard.writeText(url);
  };
  return (
    <div className="rx-topbar">
      <Link className="rx-back-btn" href="/home">
        <ArrowLeft /> Back to project
      </Link>
      <div className="rx-tb-search"><GlobalExplorerSearch network={network} compact /></div>
      <div className="rx-topbar-actions"><button type="button" className="rx-share-item" onClick={() => void share()}><Share2 /> Share</button><a className="rx-icon-only-btn" href={stellarExpertRoute(network, kind, value)} target="_blank" rel="noreferrer" title="View in explorer" aria-label="View in explorer"><Globe2 /></a></div>
      <style jsx>{`.rx-tb-search{border:0!important;background:transparent!important;padding:0!important}.rx-share-item{border:0;background:transparent;font:inherit}.rx-icon-only-btn{padding:5px}`}</style>
    </div>
  );
}

function ExplorerDesignStyles() {
  return <><style>{`
    .rx-root{--bg:#1D1918;--panel:#262221;--border:#4a423c;--text:#f2efec;--text-dim:#9b9490;--text-faint:#6f6a67;--blue:#2f6fed;--green:#2fa84f;--orange:#e8823c;--red:#e5484d;--purple:#6e56cf;--purple-hover:#7c63d8;min-height:100dvh;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:13px;-webkit-font-smoothing:antialiased}.rx-root *{box-sizing:border-box}.rx-root a{color:inherit;text-decoration:none}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.rx-page{max-width:1400px;margin:0 auto;padding:0 28px 60px}.rx-topbar{display:flex;align-items:center;gap:16px;padding:14px 28px;border-bottom:1px solid var(--border)}.rx-back-btn{display:flex;align-items:center;gap:8px;background:transparent;border:none;color:var(--text);font-size:13px;font-weight:600;cursor:pointer;padding:0;flex-shrink:0}.rx-back-btn svg{width:13px;height:13px;color:var(--text-faint)}.rx-tb-search{display:flex;align-items:center;gap:9px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:9px 12px;flex:1;max-width:520px;margin:0 auto}.rx-tb-search svg{width:15px;height:15px;color:var(--text-faint);flex-shrink:0}.rx-tb-search span{color:var(--text-faint);font-size:12.5px;flex:1}.rx-tb-kbd{font-size:10.5px!important;font-weight:600;border:1px solid var(--border);border-radius:5px;padding:2px 6px;flex:0 0 auto!important}.rx-topbar-actions,.rx-subheader-right{display:flex;gap:10px;flex-shrink:0;align-items:center;flex-wrap:wrap}.rx-share-item{display:flex;align-items:center;gap:6px;color:var(--text-dim);font-size:12.5px;cursor:pointer}.rx-share-item svg,.rx-icon-only-btn svg{width:14px;height:14px}.rx-icon-only-btn{display:flex;color:var(--text-dim);cursor:pointer}.rx-subheader{display:flex;align-items:center;justify-content:space-between;padding:16px 28px;border-bottom:1px solid var(--border);flex-wrap:wrap;gap:14px}.rx-subheader-left{display:flex;align-items:center;gap:14px;min-width:0}.rx-crumb-light{font-size:15px;color:var(--text-dim);white-space:nowrap}.rx-btn{display:inline-flex;align-items:center;gap:7px;font:inherit;font-size:12.5px;font-weight:600;padding:9px 14px;border-radius:7px;cursor:pointer;white-space:nowrap}.rx-btn svg{width:14px;height:14px}.rx-btn-outline{background:var(--panel);border:1px solid var(--border);color:var(--text)}.rx-btn-purple{background:var(--purple);border:1px solid var(--purple);color:#fff}.rx-btn-green{background:var(--green);border:1px solid var(--green);color:#fff}.rx-dev-toggle{display:flex;align-items:center;gap:8px;margin-right:6px}.rx-switch{position:relative;width:34px;height:19px;flex-shrink:0}.rx-switch input{opacity:0;width:0;height:0}.rx-slider{position:absolute;inset:0;background:var(--border);border-radius:999px;transition:.2s;cursor:pointer}.rx-slider:before{content:"";position:absolute;width:15px;height:15px;left:2px;top:2px;background:#fff;border-radius:50%;transition:.2s}.rx-switch input:checked+.rx-slider{background:var(--green)}.rx-switch input:checked+.rx-slider:before{transform:translateX(15px)}.rx-dev-label{font-size:12.5px;color:var(--text-dim)}.rx-detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 60px;padding:26px 28px 10px}.rx-detail-col{display:flex;flex-direction:column}.rx-detail-row{display:flex;align-items:baseline;gap:20px;padding:7px 0;font-size:13px}.rx-dl{width:130px;flex-shrink:0;color:var(--text-faint)}.rx-dv{color:var(--text);min-width:0;overflow-wrap:anywhere}.rx-dv.link,.addr-link{color:var(--text);text-decoration:underline;text-decoration-color:var(--border);text-underline-offset:3px;cursor:pointer}.rx-dim{color:var(--text-faint)}.rx-success{color:var(--green);display:flex;align-items:center;gap:6px}.rx-success svg{width:13px;height:13px}.rx-net-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--blue);margin-right:7px}.rx-tabs-row{position:relative;display:flex;gap:6px;padding:20px 28px 0;border-bottom:1px solid var(--border)}.rx-tab-glide{position:absolute;z-index:0;background:var(--bg);border:1px solid var(--border);border-bottom-color:var(--bg);border-radius:7px 7px 0 0;transition:left .35s cubic-bezier(.4,0,.2,1),width .35s cubic-bezier(.4,0,.2,1)}.rx-tab{padding:10px 16px;font-size:12.5px;color:var(--text-dim);cursor:pointer;border:0;background:transparent;border-radius:7px 7px 0 0;margin-bottom:-1px;position:relative;z-index:1;transition:color .2s ease}.rx-tab.active{color:var(--text);font-weight:700}.rx-tab-panel{display:block}.rx-card{background:var(--bg);border:1px solid var(--border);border-radius:8px;margin:24px 28px 0;overflow:hidden}.rx-card-header-row{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:var(--panel);border-bottom:1px solid var(--border);font-size:13px;font-weight:700}.rx-card-header-row .rx-dim{font-weight:500}.rx-group-by{display:flex;align-items:center;gap:8px;font-weight:500}.rx-gb-label{color:var(--text-faint);font-size:11.5px}.rx-gb-btn{background:transparent;border:1px solid var(--border);color:var(--text-dim);font-size:11.5px;font-family:inherit;padding:5px 10px;border-radius:6px}.rx-gb-btn.active{background:var(--panel);color:var(--text);border-color:var(--text-faint)}table.rx-explorer-table{width:100%;border-collapse:collapse}.rx-explorer-table th{text-align:left;font-size:11px;color:var(--text-faint);font-weight:600;padding:11px 16px;border-bottom:1px solid var(--border)}.rx-explorer-table td{padding:13px 16px;font-size:12.5px;border-bottom:1px solid var(--border);color:var(--text-dim);vertical-align:top}.rx-explorer-table tr:last-child td{border-bottom:none}.rx-neg{color:var(--red)!important}.rx-pos{color:var(--green)!important}.rx-addr-icon{display:inline-block;width:16px;height:16px;border-radius:4px;vertical-align:middle;margin-right:8px;background:linear-gradient(135deg,var(--blue),var(--red))}.rx-tag{font-size:10px;font-weight:700;padding:2px 6px;border-radius:5px;margin-left:8px}.rx-tag.sender{background:rgba(229,72,77,.15);color:var(--red)}.rx-tag.receiver{background:rgba(47,168,79,.15);color:var(--green)}.rx-token-ic{display:inline-flex;width:14px;height:14px;border-radius:4px;background:linear-gradient(135deg,#6b8aff,#2f6fed);vertical-align:middle;margin-right:6px}.rx-trace-bar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:16px 28px 0;padding:10px 14px;background:var(--panel);border:1px solid var(--border);border-radius:8px;flex-wrap:wrap}.rx-trace-search{display:flex;align-items:center;gap:8px;flex:1;min-width:160px}.rx-trace-search svg{width:14px;height:14px;color:var(--text-faint)}.rx-trace-search input{background:transparent;border:none;outline:none;color:var(--text);font-size:12.5px;font-family:inherit;flex:1}.rx-trace-select{background:var(--bg);border:1px solid var(--border);color:var(--text-dim);font-size:11.5px;padding:5px 8px;border-radius:6px}.rx-trace-toggles{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.rx-trace-toggles label{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--text-dim)}.rx-trace-toggles input{accent-color:var(--purple);width:13px;height:13px}.rx-trace-ic-btn{width:22px;height:22px;border-radius:5px;border:1px solid var(--border);background:var(--bg);color:var(--text-dim);display:flex;align-items:center;justify-content:center}.rx-trace-row{display:flex;align-items:center;gap:12px;margin:10px 28px 0;padding:12px 14px;border:1px solid var(--border);border-radius:8px;font-size:12px;overflow-x:auto;white-space:nowrap}.rx-call-pill{background:var(--panel);border:1px solid var(--border);color:var(--text-dim);font-weight:700;font-size:11px;padding:4px 10px;border-radius:6px;flex-shrink:0}.rx-call-idx{color:var(--text-faint);flex-shrink:0}.rx-call-line{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--text-dim)}.rx-sender-tag{color:var(--red)}.rx-receiver-tag{color:var(--green)}.rx-contract-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:16px}.rx-contract-card{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:14px 16px}.rx-cc-head{display:flex;align-items:center;gap:10px;margin-bottom:12px}.rx-cc-icon{width:30px;height:30px;border-radius:7px;flex-shrink:0;background:linear-gradient(135deg,var(--blue),var(--purple))}.rx-cc-name{font-weight:700;font-size:12.5px;color:var(--text)}.rx-cc-type{font-size:11px;color:var(--text-faint);margin-top:3px}.rx-cc-meta{display:flex;gap:20px;border-top:1px solid var(--border);padding-top:10px}.rx-cc-meta>div{display:flex;flex-direction:column;gap:3px;font-size:10.5px;color:var(--text-faint);text-transform:uppercase;letter-spacing:.04em}.rx-cc-meta b{font-size:12.5px;color:var(--text);text-transform:none;letter-spacing:0;font-weight:600}.rx-event-item{display:flex;align-items:flex-start;gap:14px;padding:14px 16px;border-bottom:1px solid var(--border)}.rx-event-item:last-child{border-bottom:none}.rx-event-idx{font-size:10px;color:var(--text-faint);margin-top:2px;min-width:12px}.rx-event-body{flex:1;min-width:0}.rx-event-name{font-weight:700;font-size:12.5px;color:var(--text)}.rx-sub-name{color:var(--text-faint);font-weight:500;margin-left:6px}.rx-event-data{font-size:11.5px;color:var(--text-faint);margin-top:5px;word-break:break-all}.rx-flow-wrap{display:flex;align-items:center;gap:18px;padding:26px 24px 30px}.rx-flow-node{flex:1;text-align:center;background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:16px 12px}.rx-flow-tag{display:block;font-size:10.5px;color:var(--text-faint);text-transform:uppercase;letter-spacing:.05em;margin-bottom:7px}.rx-flow-node .rx-addr{font-size:12.5px;color:var(--text)}.rx-flow-node.src .rx-addr{color:var(--orange)}.rx-flow-node.dst .rx-addr{color:var(--green)}.rx-flow-node .rx-bal{margin-top:7px;font-size:11.5px;color:var(--text-dim)}.rx-flow-edge{flex:1.3;display:flex;flex-direction:column;align-items:center;gap:10px}.rx-flow-amount{font-size:12px;font-weight:700;color:var(--text);background:rgba(47,168,79,.12);border:1px solid var(--border);border-radius:999px;padding:5px 14px;white-space:nowrap}.rx-flow-line{position:relative;width:100%;height:2px;background:var(--border);border-radius:2px}.rx-flow-line:after{content:"";position:absolute;right:-2px;top:-4px;border:5px solid transparent;border-left:7px solid var(--green)}.rx-resource-list{display:flex;flex-direction:column;gap:16px;padding:18px 20px 20px}.rx-resource-top{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--text-dim);margin-bottom:7px}.rx-resource-top b{color:var(--text);font-weight:600}.rx-resource-track{height:7px;border-radius:999px;background:var(--panel);overflow:hidden}.rx-resource-fill{height:100%;border-radius:999px}.rx-chat-fab{position:fixed;right:28px;bottom:28px;width:52px;height:52px;border-radius:50%;background:var(--purple);display:flex;align-items:center;justify-content:center;box-shadow:0 10px 26px rgba(0,0,0,.4);color:#fff}.rx-chat-fab svg{width:22px;height:22px}.rx-wallet-crumb{display:flex;align-items:center;gap:8px}.rx-wtag{display:flex;align-items:center;gap:6px;font-weight:600;color:var(--text);font-size:14px}.rx-wtag svg{width:14px;height:14px;color:var(--text-faint)}.rx-waddr{color:var(--text-dim);font-size:13px}.rx-icon-btn-round{width:32px;height:32px;border-radius:7px;border:1px solid var(--border);background:var(--panel);color:var(--text-dim);display:flex;align-items:center;justify-content:center}.rx-stat-row-wallet{display:flex;gap:48px;flex-wrap:wrap;padding:22px 0 20px}.rx-sw-item{display:flex;flex-direction:column;gap:8px}.rx-sw-label{font-size:11.5px;color:var(--text-faint)}.rx-sw-value{font-size:16px;font-weight:700;color:var(--text);display:flex;align-items:center;gap:8px}.rx-sw-value .rx-sub{font-weight:500;color:var(--text-dim);font-size:13px}.rx-sw-net-dot{width:16px;height:16px;border-radius:5px;background:linear-gradient(135deg,#6b8aff,#2f6fed);flex-shrink:0}.rx-tabs-row2{display:flex;gap:22px;padding:4px 0 14px;border-bottom:1px solid var(--border)}.rx-tab2{font-size:13px;color:var(--text-dim);padding-bottom:10px}.rx-tab2.active{color:var(--text);font-weight:700;border-bottom:2px solid var(--text)}.rx-filter-row{display:flex;gap:8px;padding:16px 0;flex-wrap:wrap}.rx-filter-chip{font-size:12px;color:var(--text-dim);padding:7px 13px;border-radius:7px;border:1px solid transparent}.rx-filter-chip.active{background:var(--panel);border-color:var(--border);color:var(--text);font-weight:600}.rx-wallet-table-wrap{border:1px solid var(--border);border-radius:8px;overflow-x:auto}table.rx-wtable{width:100%;border-collapse:collapse;min-width:900px}.rx-wtable th{text-align:left;font-size:11px;color:var(--text-faint);font-weight:600;padding:11px 16px;border-bottom:1px solid var(--border);background:var(--panel);white-space:nowrap}.rx-wtable td{padding:12px 16px;font-size:12.5px;border-bottom:1px solid var(--border);color:var(--text-dim);white-space:nowrap}.rx-status-ok{display:flex;align-items:center;gap:6px;color:var(--green)}.rx-status-ok svg{width:13px;height:13px}.rx-empty{padding:28px 16px;color:var(--text-faint);font-size:13px}.rx-pagination-row{display:flex;align-items:center;justify-content:space-between;padding:16px 2px 0}.rx-page-num{width:28px;height:28px;border-radius:6px;background:var(--panel);border:1px solid var(--border);color:var(--text);display:flex;align-items:center;justify-content:center;font-size:12.5px;font-weight:600}@media(max-width:760px){.rx-topbar,.rx-subheader{align-items:flex-start;flex-direction:column}.rx-tb-search{margin:0;max-width:none;width:100%}.rx-detail-grid{grid-template-columns:1fr;gap:0;padding-inline:18px}.rx-tabs-row{padding-inline:18px;overflow-x:auto}.rx-card,.rx-trace-bar,.rx-trace-row{margin-inline:18px}.rx-contract-grid{grid-template-columns:1fr}.rx-flow-wrap{flex-direction:column}.rx-flow-edge{width:100%}.rx-page{padding-inline:18px}.rx-stat-row-wallet{gap:22px}.rx-chat-fab{display:none}}
  `}</style><style>{`.rx-json-block{max-width:460px;max-height:240px;margin:8px 0 0;padding:10px;border:1px solid var(--border);border-radius:5px;background:#171413;color:var(--text-dim);font:10.5px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow:auto;overflow-wrap:anywhere}.rx-explorer-table .rx-json-block{min-width:220px;margin:0}.rx-share-item{border:0;background:transparent;font:inherit}`}</style></>;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="rx-detail-row"><span className="rx-dl">{label}</span><span className="rx-dv">{children}</span></div>;
}

export function TransactionExplorerDesign({ tx, network }: { tx: ExplorerTxDetail; network: string }) {
  const [tab, setTab] = useState<Tab>("summary");
  const [devMode, setDevMode] = useState(true);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [glide, setGlide] = useState({ left: 28, width: 104 });
  const contracts = useMemo(() => uniqueContracts(tx), [tx]);
  const counterparty = txTargetAddress(tx);
  const accountScoped = isAccountScopedOperation(tx.operation_type);
  const displayTarget = counterparty ?? (accountScoped ? tx.source_account : null);
  const targetLabel = accountScoped && !counterparty ? "Affected account" : "Destination account";
  const firstCall = tx.call_tree[0];
  const simulatorParams = new URLSearchParams({
    tx: tx.hash,
    impersonate: tx.source_account,
    ledger: String(tx.ledger),
    ...(firstCall ? { contract: firstCall.contract_id, function: firstCall.function_name, args: JSON.stringify(firstCall.args) } : {}),
  });
  const tabs: Array<[Tab, string]> = [["summary", "Summary"], ["contracts", "Contracts"], ["events", "Events"], ["state", "State"], ["fundflow", "Fund Flow"], ["resources", "Resource Usage"]];

  useEffect(() => {
    const button = tabRefs.current[tab];
    if (!button) return;
    setGlide({ left: button.offsetLeft, width: button.offsetWidth });
  }, [tab, devMode]);

  useEffect(() => {
    const jump = (event: Event) => {
      const callId = (event as CustomEvent<string>).detail;
      setDevMode(true);
      setTab("summary");
      window.setTimeout(() => document.getElementById(`trace-${callId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    };
    window.addEventListener("releeve:jump-trace", jump);
    return () => window.removeEventListener("releeve:jump-trace", jump);
  }, []);

  return (
    <div className="rx-root">
      <ExplorerDesignStyles />
      <TopBar network={network} kind="tx" value={tx.hash} />
      <div className="rx-subheader">
        <div className="rx-subheader-left"><span className="rx-crumb-light">Transaction</span></div>
        <div className="rx-subheader-right">
          <div className="rx-dev-toggle"><label className="rx-switch"><input type="checkbox" checked={devMode} onChange={(event) => { const enabled = event.target.checked; setDevMode(enabled); if (!enabled) setTab("summary"); }} /><span className="rx-slider" /></label><span className="rx-dev-label">Dev mode</span></div>
          <Link className="rx-btn rx-btn-outline" href={`/simulator?${simulatorParams.toString()}&environment=new`}>Run on Environment</Link>
          <Link className="rx-btn rx-btn-outline" href={`/simulator?${simulatorParams.toString()}`}>Re-Simulate</Link>
          <Link className="rx-btn rx-btn-green" href={`/debugger?tx=${encodeURIComponent(tx.hash)}`}>Debug</Link>
        </div>
      </div>
      <div className="rx-page">
        <div className="rx-detail-grid">
          <div className="rx-detail-col">
            <DetailRow label="Hash"><span className="mono">{tx.hash}</span></DetailRow>
            <DetailRow label="Network"><span className="rx-net-dot" />{tx.network}</DetailRow>
            <DetailRow label="Status"><span className="rx-success"><Check />{tx.status}</span></DetailRow>
            <DetailRow label="Ledger"><EntityAnchor network={network} value={tx.ledger} type="ledger" /></DetailRow>
            <DetailRow label="Timestamp">{formatTimestamp(tx.timestamp)}</DetailRow>
            <DetailRow label="Source account"><EntityAnchor network={network} value={tx.source_account} type="address" /></DetailRow>
            <DetailRow label={targetLabel}>{displayTarget ? <EntityAnchor network={network} value={displayTarget} type="address" /> : <span className="rx-dim">This operation has no address target.</span>}</DetailRow>
          </div>
          <div className="rx-detail-col">
            <DetailRow label="Amount">{amountLabel(tx)}</DetailRow>
            <DetailRow label="Fee charged">{feeLabel(tx.fee_charged)}</DetailRow>
            <DetailRow label="Operation Type">{tx.operation_type}</DetailRow>
            <DetailRow label="Resource usage">{usageTotal(tx.resource_usage).toLocaleString()} measured units</DetailRow>
            <DetailRow label="Calls">{tx.call_tree.length.toLocaleString()}</DetailRow>
            <DetailRow label="Index">{tx.application_order ?? "Not indexed"}</DetailRow>
            <DetailRow label="Sequence Number">{tx.sequence_number ?? "Not indexed"}</DetailRow>
          </div>
        </div>

        {devMode && <div className="rx-tabs-row">
          <div className="rx-tab-glide" style={{ left: glide.left, width: glide.width, height: 38, top: 20 }} />
          {tabs.map(([key, label]) => <button key={key} ref={(node) => { tabRefs.current[key] = node; }} type="button" className={`rx-tab ${tab === key ? "active" : ""}`} onClick={() => setTab(key)}>{label}</button>)}
        </div>}

        {(!devMode || tab === "summary") && <SummaryPanel tx={tx} network={network} devMode={devMode} />}
        {devMode && tab === "contracts" && <ContractsPanel contracts={contracts} network={network} />}
        {devMode && tab === "events" && <EventsPanel tx={tx} network={network} />}
        {devMode && tab === "state" && <StatePanel tx={tx} />}
        {devMode && tab === "fundflow" && <FundFlowPanel tx={tx} network={network} />}
        {devMode && tab === "resources" && <ResourcePanel tx={tx} />}
      </div>
      <div className="rx-chat-fab"><Search /></div>
    </div>
  );
}

function SummaryPanel({ tx, network, devMode }: { tx: ExplorerTxDetail; network: string; devMode: boolean }) {
  const accountScoped = isAccountScopedOperation(tx.operation_type);
  return <>
    {accountScoped && tx.fund_flow.length === 0 && <div className="rx-card"><div className="rx-card-header-row">Operation impact</div><div className="rx-event-item"><div className="rx-event-body"><div className="rx-event-name">{operationImpactLabel(tx.operation_type)}</div><div className="rx-event-data">The source account is the affected entity. No asset transfer occurred, so it is not presented as a destination.</div></div></div></div>}
    <AssetTransfers tx={tx} network={network} />
    {devMode && <TransactionTrace tx={tx} />}
  </>;
}

function ContractsPanel({ contracts, network }: { contracts: string[]; network: string }) {
  return <div className="rx-card"><div className="rx-card-header-row"><span>Contracts involved <span className="rx-dim">({contracts.length})</span></span></div><div className="rx-contract-grid">
    {contracts.length ? contracts.map((contract, index) => <div className="rx-contract-card" key={contract}><div className="rx-cc-head"><span className="rx-cc-icon" style={{ background: index % 2 ? "linear-gradient(135deg,var(--orange),var(--red))" : undefined }} /><div><div className="rx-cc-name">Soroban contract</div><div className="rx-cc-type mono"><EntityAnchor network={network} value={contract} type="address" /></div></div></div><div className="rx-cc-meta"><div>Type<b>Contract</b></div><div>Trace refs<b>{index + 1}</b></div><div>Network<b>{network}</b></div></div></div>) : <div className="rx-empty">No contracts decoded.</div>}
  </div></div>;
}

function EventsPanel({ tx, network }: { tx: ExplorerTxDetail; network: string }) {
  const calls = new Map(tx.call_tree.map((node, index) => [node.id, { node, index }]));
  return <div className="rx-card"><div className="rx-card-header-row"><span>Operation events <span className="rx-dim">({tx.events.length})</span></span></div>{tx.events.length ? tx.events.map((event, index) => { const cause = event.caused_by_call ? calls.get(event.caused_by_call) : null; return <div className="rx-event-item" key={event.id}><span className="rx-event-idx">{index}</span><div className="rx-event-body"><div className="rx-event-name">{event.event_type} event <span className="rx-sub-name"><EntityAnchor network={network} value={event.contract_id} type="address" /></span></div><div className="rx-event-data">{event.stage ?? "transaction"} · {event.successful === false ? "failed path" : "successful path"} · {cause ? `call #${cause.index} ${cause.node.function_name}` : "transaction-level attribution"}</div><pre className="rx-json-block"><code>{JSON.stringify({ topics: event.topics, data: event.data }, null, 2)}</code></pre></div></div>; }) : <div className="rx-empty">No events decoded.</div>}</div>;
}

function StatePanel({ tx }: { tx: ExplorerTxDetail }) {
  const callById = new Map(tx.call_tree.map((node, index) => [node.id, { node, index }]));
  return <div className="rx-card"><div className="rx-card-header-row"><span>Post-transaction state <span className="rx-dim">({tx.state_changes.length})</span></span></div><table className="rx-explorer-table"><thead><tr><th>Key</th><th>Caused by</th><th>Before</th><th>After</th></tr></thead><tbody>{tx.state_changes.length ? tx.state_changes.map((change) => {
    const cause = change.caused_by_call ? callById.get(change.caused_by_call) : null;
    return <tr key={change.id}><td className="mono">{change.key}<div className="rx-dim">{change.entry_type}</div></td><td>{cause ? <span className="mono">#{cause.index} {cause.node.function_name}<small className="rx-dim"> ({change.cause_confidence})</small></span> : <span className="rx-dim">Transaction-level</span>}</td><td><pre className="rx-json-block rx-neg"><code>{formatJson(change.before)}</code></pre></td><td><pre className="rx-json-block rx-pos"><code>{formatJson(change.after)}</code></pre></td></tr>;
  }) : <tr><td colSpan={4} className="rx-empty">No state changes decoded.</td></tr>}</tbody></table></div>;
}

function FundFlowPanel({ tx, network }: { tx: ExplorerTxDetail; network: string }) {
  const count = tx.fund_flow.length || tx.call_tree.length;
  const kind = tx.fund_flow.length ? "transfer" : "invocation";
  return <div className="rx-card"><div className="rx-card-header-row"><span>Fund flow <span className="rx-dim">({count} {kind}{count === 1 ? "" : "s"})</span></span></div><FundFlowGraph tx={tx} network={network} /></div>;
}

function ResourcePanel({ tx }: { tx: ExplorerTxDetail }) {
  return <div className="rx-card"><div className="rx-card-header-row"><span>Resource usage <span className="rx-dim">(measured against declared Soroban limits)</span></span></div><ResourceUsagePanel usage={tx.resource_usage} /></div>;
}

export function WalletExplorerDesign({ account, network, address }: { account: ExplorerAccountDetail; network: string; address: string }) {
  const [tab, setTab] = useState("transactions");
  const [limit, setLimit] = useState(20);
  const [cursor, setCursor] = useState<string | null>(null);
  const [page, setPage] = useState<ExplorerPagedEnvelope<ExplorerAccountTransaction> | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getAccountTransactions(network, address, limit, cursor).then((result) => {
      if (!alive) return;
      setPage(result.data);
      setError(result.error);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [network, address, limit, cursor]);

  const rows = page?.data ?? [];
  const nextCursor = page?.pagination.next_cursor ?? null;
  const canGoBack = history.length > 0 && !loading;
  const canGoNext = Boolean(nextCursor) && !loading;

  const goNext = () => {
    if (!nextCursor) return;
    setHistory((items) => [...items, cursor ?? ""]);
    setCursor(nextCursor);
  };
  const goBack = () => {
    setHistory((items) => {
      const previous = items[items.length - 1];
      setCursor(previous || null);
      return items.slice(0, -1);
    });
  };
  const changeLimit = (value: number) => {
    setLimit(value);
    setCursor(null);
    setHistory([]);
  };

  return (
    <div className="rx-root">
      <ExplorerDesignStyles />
      <TopBar network={network} kind="account" value={address} />
      <div className="rx-subheader">
        <div className="rx-subheader-left">
          <div className="rx-wallet-crumb">
            <span className="rx-wtag">Wallet</span>
            <span className="rx-waddr mono">{truncateEntity(address, 8, 6)}</span>
            <button className="rx-icon-only-btn" type="button" aria-label="Copy wallet address" onClick={() => navigator.clipboard.writeText(address)}><Copy /></button>
          </div>
        </div>
        <div className="rx-subheader-right">
          <span className="rx-icon-btn-round"><MoreHorizontal size={15} /></span>
          <button className="rx-btn rx-btn-outline" type="button" onClick={() => void navigator.clipboard.writeText(window.location.href)}><Share2 /> Share</button>
          <button className="rx-btn rx-btn-outline" type="button"><Bell /> Create Alert</button>
          <button className="rx-btn rx-btn-outline" type="button">Add to Project</button>
          <Link className="rx-btn rx-btn-outline" href={`/simulator?impersonate=${encodeURIComponent(address)}`}>Impersonate</Link>
          <Link className="rx-btn rx-btn-purple" href={`/simulator?impersonate=${encodeURIComponent(address)}`}><Play /> Simulate</Link>
        </div>
      </div>
      <div className="rx-page">
        <div className="rx-stat-row-wallet">
          <div className="rx-sw-item"><span className="rx-sw-label">Network</span><span className="rx-sw-value"><span className="rx-sw-net-dot" />{network}</span></div>
          <div className="rx-sw-item"><span className="rx-sw-label">XLM balance</span><span className="rx-sw-value">{account.xlm_balance ?? "Not indexed"}</span></div>
          <div className="rx-sw-item"><span className="rx-sw-label">USD value</span><span className="rx-sw-value">{account.usd_value ?? "Not available"}</span></div>
          <div className="rx-sw-item"><span className="rx-sw-label">Token holdings</span><span className="rx-sw-value">{account.token_holdings.length}<span className="rx-sub">assets</span></span></div>
          <div className="rx-sw-item"><span className="rx-sw-label">Project tracking</span><span className="rx-sw-value">{account.tracked ? "Tracked" : "Public lookup"}</span></div>
        </div>
        <div className="rx-tabs-row2">
          <button className={`rx-tab2 ${tab === "transactions" ? "active" : ""}`} onClick={() => setTab("transactions")}>Transactions</button>
          <button className={`rx-tab2 ${tab === "simulations" ? "active" : ""}`} onClick={() => setTab("simulations")}>Simulations</button>
          <button className={`rx-tab2 ${tab === "assets" ? "active" : ""}`} onClick={() => setTab("assets")}>Assets</button>
        </div>
        <div className="rx-filter-row"><span className="rx-filter-chip active">All</span><span className="rx-filter-chip">Direct</span><span className="rx-filter-chip">Internal</span><span className="rx-filter-chip">Token asset transfers</span><span className="rx-filter-chip">Authorizations</span></div>
        {tab === "assets" ? (
          <div className="rx-wallet-table-wrap">
            <table className="rx-wtable">
              <thead><tr><th>Asset</th><th>Balance</th><th>USD value</th><th>Network</th></tr></thead>
              <tbody>{account.token_holdings.length ? account.token_holdings.map((holding) => <tr key={holding.asset}><td>{holding.asset}</td><td className="mono">{holding.balance ?? "Not indexed"}</td><td>{holding.usd_value ?? "Not available"}</td><td>{network}</td></tr>) : <tr><td colSpan={4} className="rx-empty">No token holdings indexed for this wallet yet.</td></tr>}</tbody>
            </table>
          </div>
        ) : (
          <div className="rx-wallet-table-wrap">
            <table className="rx-wtable">
              <thead><tr><th>Tx Hash</th><th>Status</th><th>From</th><th>To</th><th>Function</th><th>Value</th></tr></thead>
              <tbody>
                {tab === "simulations" ? <tr><td colSpan={6} className="rx-empty">No simulations are linked to this public wallet view yet.</td></tr> : loading ? <tr><td colSpan={6} className="rx-empty">Loading transactions...</td></tr> : error ? <tr><td colSpan={6} className="rx-empty">{error}</td></tr> : rows.length ? rows.map((tx) => (
                  <tr key={tx.hash}>
                    <td className="mono"><Link href={explorerRoutes.tx(network, tx.hash)}>{truncateEntity(tx.hash, 8, 6)}</Link><div className="rx-dim">Ledger {tx.ledger_sequence ?? tx.ledger ?? "Not indexed"}</div></td>
                    <td><span className={`rx-status-pill ${tx.status === "success" ? "ok" : "bad"}`}>{tx.status}</span></td>
                    <td className="mono">{tx.source_account ? <EntityAnchor network={network} value={tx.source_account} type="address" /> : "Not indexed"}</td>
                    <td className="mono">{tx.destination_account ? <EntityAnchor network={network} value={tx.destination_account} type="address" /> : tx.affected_account ? <span>Affected: <EntityAnchor network={network} value={tx.affected_account} type="address" /></span> : <span className="rx-dim">No address target</span>}</td>
                    <td>{tx.call_trace?.root_function ? <span>{tx.call_trace.root_function}<span className="rx-dim"> ({tx.call_trace.count} call{tx.call_trace.count === 1 ? "" : "s"})</span></span> : tx.operation_type}</td>
                    <td>{tx.asset === "CALL" ? "Contract call" : tx.amount ? `${tx.amount} ${tx.asset ?? ""}` : "No asset transfer"}</td>
                  </tr>
                )) : <tr><td colSpan={6} className="rx-empty">No transactions indexed for this wallet yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <div className="rx-pagination-row">
          <div className="rx-dim"><select aria-label="Transactions per page" value={limit} onChange={(event) => changeLimit(Number(event.target.value))}>{[20, 50, 100].map((size) => <option key={size} value={size}>{size} per page</option>)}</select></div>
          <button className="rx-btn rx-btn-outline" type="button" disabled={!canGoBack} onClick={goBack}>Back</button>
          <span className="rx-page-num">{history.length + 1}</span>
          <button className="rx-btn rx-btn-outline" type="button" disabled={!canGoNext} onClick={goNext}>Next</button>
        </div>
      </div>
      <div className="rx-chat-fab"><Search /></div>
    </div>
  );
}
