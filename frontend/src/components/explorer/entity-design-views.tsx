"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  Bell,
  Box,
  Check,
  ChevronDown,
  Copy,
  Database,
  FileCode2,
  Globe2,
  Play,
  Share2,
  X,
} from "lucide-react";
import { EntityIdenticon } from "@/components/explorer/entity-identicon";
import {
  AddressLink,
  ContractLink,
  LedgerLink,
  TxHashLink,
} from "@/components/explorer/entity-links";
import { EntityCopyButton } from "@/components/explorer/entity-copy-button";
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
  isContractAddress,
  stellarExpertRoute,
  storedProjectAlerts,
  storedProjectContract,
  storedProjectHome,
  truncateEntity,
} from "@/lib/explorer-routes";

function formatTime(value?: string | null) {
  if (!value) return "Not indexed";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatStroopsAsXlm(value?: string | null) {
  if (!value) return "Not reported";
  try {
    const stroops = BigInt(value);
    const stroopsPerXlm = BigInt(10000000);
    const whole = stroops / stroopsPerXlm;
    const fraction = (stroops % stroopsPerXlm).toString().padStart(7, "0").replace(/0+$/, "");
    return `${whole}${fraction ? `.${fraction}` : ""} XLM`;
  } catch {
    return "Not reported";
  }
}

export function useExplorerScrollTop(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const scroller = document.querySelector(".db-content");
    if (scroller) scroller.scrollTop = 0;
    window.scrollTo(0, 0);
  }, [enabled]);
}

function TransactionAddress({
  address,
  network,
}: {
  address: string;
  network: string;
}) {
  const kind = isContractAddress(address) ? "contract" : "account";
  return (
    <span className="entity-address-cell">
      <EntityIdenticon value={address} kind={kind} size={16} />
      <AddressLink
        address={address}
        network={network}
        className="contract-table-entity-link"
      />
    </span>
  );
}

function TransactionStatus({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  if (normalized === "success") {
    return (
      <span className="tx-status tx-status-success">
        <Check aria-hidden="true" />
        Success
      </span>
    );
  }
  if (normalized === "failed") {
    return (
      <span className="tx-status tx-status-failed">
        <X aria-hidden="true" />
        Failure
      </span>
    );
  }
  return <span className="tx-status">{status}</span>;
}

export function ExplorerEntityShell({
  network,
  kind,
  value,
  embedded = false,
  children,
}: {
  network: string;
  kind: "ledger" | "contract" | "account";
  value: string | number;
  embedded?: boolean;
  children: React.ReactNode;
}) {
  const share = async () =>
    navigator.share
      ? navigator.share({ title: `Releeve ${kind}`, url: window.location.href })
      : navigator.clipboard.writeText(window.location.href);
  const [homeHref, setHomeHref] = useState("/organizations");
  useEffect(() => {
    setHomeHref(storedProjectHome());
  }, []);
  return (
    <main className={`entity-root ${embedded ? "entity-root-embedded" : ""}`}>
      {!embedded && <header className="entity-top">
        <Link href={homeHref}>
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
      </header>}
      {children}
      <EntityStyles />
    </main>
  );
}

export function EntityStyles() {
  return (
    <>
    <style>{`
    .entity-root{--bg:#1d1918;--panel:#262221;--border:#4a423c;--text:#f2efec;--dim:#9b9490;--faint:#716a66;--green:#2fa84f;--signal:#a3ff5f;min-height:100dvh;background:var(--bg);color:var(--text);font-family:var(--font-inter),system-ui,sans-serif;font-size:13px}.entity-root *{box-sizing:border-box}.entity-root a{color:inherit;text-decoration:none}.entity-top{height:65px;display:flex;align-items:center;gap:18px;padding:0 28px;border-bottom:1px solid var(--border)}.entity-top>a{display:flex;align-items:center;gap:8px;font-weight:600;white-space:nowrap}.entity-top svg{width:14px;height:14px}.entity-search{width:min(520px,100%);margin:auto}.entity-actions{display:flex;align-items:center;gap:13px}.entity-actions button,.entity-actions a{display:flex;align-items:center;gap:6px;border:0;background:transparent;color:var(--dim);font:inherit;font-size:12px;cursor:pointer}.entity-subhead{min-height:65px;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:12px 28px;border-bottom:1px solid var(--border)}.entity-title{display:flex;align-items:center;gap:9px;min-width:0}.entity-title>span:first-child{color:var(--dim);font-size:15px}.entity-title h1{margin:0;font:600 13px var(--font-mono),monospace;overflow:hidden;text-overflow:ellipsis}.entity-identity{display:flex;flex-direction:column;gap:4px;min-width:0}.entity-identity>span{color:var(--dim);font-size:15px}.entity-address-line{display:flex;align-items:center;gap:7px;min-width:0}.entity-address-line h1{min-width:0;white-space:nowrap}.entity-copy-inline{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex:0 0 16px;padding:0;border:0;background:transparent;color:var(--dim);cursor:pointer}.entity-copy-inline:hover{color:var(--text)}.entity-copy-inline svg{width:14px;height:14px}.entity-buttons{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.entity-button{height:34px;display:inline-flex;align-items:center;gap:6px;padding:0 11px;border:1px solid var(--border);border-radius:6px;background:var(--panel);color:var(--text);font:600 11px inherit;cursor:pointer}.entity-button.primary{background:#2fa84f;border-color:#2fa84f;color:#fff}.entity-button svg{width:13px}.entity-page{max-width:1400px;margin:auto;padding:25px 28px 60px}.entity-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 58px}.entity-field{display:grid;grid-template-columns:145px minmax(0,1fr);gap:15px;align-items:baseline;padding:7px 0}.entity-field dt{color:var(--faint);font-size:12px}.entity-field dd{min-width:0;margin:0;overflow-wrap:anywhere}.entity-field code{font:11px var(--font-mono),monospace}.entity-field a{text-decoration:underline;text-decoration-color:var(--border);text-underline-offset:3px}.entity-tabs{display:flex;gap:5px;margin-top:25px;padding-top:18px;border-bottom:1px solid var(--border)}.entity-tabs button{height:38px;padding:0 14px;border:1px solid transparent;border-bottom:0;border-radius:6px 6px 0 0;background:transparent;color:var(--dim);font:inherit;font-size:11.5px;cursor:pointer}.entity-tabs button.active{border-color:var(--border);background:var(--bg);color:var(--text);font-weight:700;margin-bottom:-1px}.entity-table-wrap{margin-top:18px;border:1px solid var(--border);border-radius:7px;overflow:auto}.entity-table-head{min-height:47px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 12px;background:var(--panel);border-bottom:1px solid var(--border)}.entity-table-head h2{margin:0;font-size:12.5px}.entity-table-head input,.entity-table-head select{height:30px;border:1px solid var(--border);border-radius:5px;background:var(--bg);color:var(--text);padding:0 8px;font:inherit;font-size:10.5px}.entity-table{width:100%;min-width:850px;border-collapse:collapse}.entity-table th,.entity-table td{text-align:left;padding:11px 13px;border-bottom:1px solid var(--border);font-size:11px}.entity-table th{color:var(--faint);font-size:9.5px}.entity-table td{color:var(--dim)}.entity-table tr:last-child td{border-bottom:0}.entity-table code{font:10.5px var(--font-mono),monospace}.entity-table a{text-decoration:underline;text-decoration-color:var(--border)}.status-ok{color:var(--green)}.entity-empty{padding:28px 14px;color:var(--faint);font-size:11.5px}.entity-pagination{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:12px}.entity-pagination button,.entity-pagination select{height:30px;border:1px solid var(--border);border-radius:5px;background:var(--panel);color:var(--text);font:inherit;font-size:10px;padding:0 8px}.entity-pagination button:disabled{opacity:.4}.json-cell{max-width:460px;max-height:170px;overflow:auto;white-space:pre-wrap;font:10px/1.5 var(--font-mono),monospace}@media(max-width:760px){.entity-top{height:auto;min-height:65px;align-items:flex-start;flex-wrap:wrap;padding:14px}.entity-search{order:3;flex-basis:100%}.entity-actions{margin-left:auto}.entity-subhead{align-items:flex-start;flex-direction:column;padding:14px}.entity-page{padding:20px 14px 45px}.entity-grid{grid-template-columns:1fr}.entity-field{grid-template-columns:112px minmax(0,1fr)}.entity-tabs{overflow-x:auto}.entity-address-line h1{max-width:calc(100vw - 110px);overflow:hidden;text-overflow:ellipsis}}
    .entity-identity{gap:3px}.entity-identity>span{font-size:14px}.entity-address-line h1{font:600 13px var(--font-mono),monospace;overflow:hidden;text-overflow:ellipsis}.entity-address-cell{display:inline-flex;align-items:center;gap:6px}.entity-address-cell svg{flex:0 0 auto}.contract-transactions-table thead th,.contract-events-table thead th{background:var(--panel);font-size:12.5px;color:var(--text);font-weight:700}.contract-transactions-table tbody td{font-size:12.5px;color:var(--dim)}.contract-transactions-table tbody td code{font-size:12px;color:var(--text)}.contract-transactions-table .contract-table-entity-link{color:var(--text)!important}.contract-transactions-table .contract-table-entity-link:hover{color:#fff!important}.contract-transactions-table .tx-status{display:inline-flex;align-items:center;gap:6px;font-weight:650;white-space:nowrap}.contract-transactions-table .tx-status svg{width:14px;height:14px;stroke-width:3}.contract-transactions-table .tx-status-success{color:var(--green)}.contract-transactions-table .tx-status-failed{color:#f06a73}.entity-root-embedded{position:relative;top:-12px;min-height:0;margin:0 -36px;background:transparent}.entity-root-embedded .entity-page{max-width:none;padding:0 36px 32px}.entity-root-embedded .entity-subhead{padding:0 36px 16px;min-height:48px;border-bottom:1px solid var(--border)}.entity-root-embedded .entity-embedded-back{width:44px;height:30px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 44px;border:1px solid var(--border);border-radius:6px;background:var(--panel);color:var(--text);cursor:pointer}.entity-root-embedded .entity-embedded-back svg{width:14px;height:14px}.entity-root-embedded .entity-embedded-back span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.entity-root-embedded .entity-subhead{gap:14px}.entity-root-embedded .entity-title{flex:1}.entity-root-embedded .entity-buttons{justify-content:flex-end}.entity-root-embedded .entity-button{height:34px}
  `}</style>
    <style>{`.entity-root-embedded{top:-14px}`}</style>
    <style>{`@media(max-width:899px){.entity-root-embedded{top:-3px;margin:0 -3px}.entity-root-embedded .entity-page{padding-inline:3px}.entity-root-embedded .entity-subhead{padding-inline:3px}}`}</style>
    <style>{`.entity-root{--bg:#121212;--panel:#181818;--border:#2b2b2b;--text:#f5f5f5;--dim:#a1a1a1;--faint:#707070;--green:#a3ff5f;--signal:#a3ff5f}.entity-button.primary{background:#a3ff5f;border-color:#a3ff5f;color:#121212}`}</style>
    <style>{`.entity-pagination button{cursor:pointer}.entity-pagination button:disabled{cursor:not-allowed}.entity-page-number{display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:30px;padding:0 8px;border:1px solid var(--border);border-radius:5px;background:var(--panel);color:var(--text);font-size:10px;font-weight:600}.entity-select{position:relative}.entity-select-trigger{display:inline-flex;min-width:108px;height:30px;align-items:center;justify-content:space-between;gap:10px;border:1px solid var(--border);border-radius:5px;padding:0 10px 0 12px;background:var(--panel);color:var(--text);font:inherit;font-size:10px;cursor:pointer}.entity-select-trigger:hover,.entity-select-trigger[aria-expanded=true]{border-color:var(--faint);background:var(--bg)}.entity-select-trigger:focus-visible{outline:0;box-shadow:0 0 0 3px color-mix(in srgb,var(--text) 10%,transparent)}.entity-select-trigger svg{width:13px;height:13px;color:var(--dim);transition:transform .2s ease}.entity-select-trigger[aria-expanded=true] svg{transform:rotate(180deg)}.entity-select-menu{position:absolute;z-index:20;top:calc(100% + 5px);right:0;display:grid;min-width:100%;padding:4px;border:1px solid var(--border);border-radius:6px;background:var(--panel);box-shadow:0 14px 32px rgba(0,0,0,.4)}.entity-select-option{display:flex;min-height:30px;align-items:center;border:0;border-radius:4px;padding:0 8px;background:transparent;color:var(--dim);font:inherit;font-size:10px;cursor:pointer;white-space:nowrap;text-align:left}.entity-select-option:hover,.entity-select-option[data-active=true]{background:var(--bg);color:var(--text)}.entity-root-embedded .entity-embedded-back{width:26px;height:28px;min-width:26px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 26px;padding:0;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dim);cursor:pointer;transition:border-color .15s,background .15s,color .15s}.entity-root-embedded .entity-embedded-back:hover{border-color:var(--faint);background:transparent;color:var(--text)}.entity-root-embedded .entity-embedded-back svg{width:18px;height:18px}`}</style>
    <style>{`.entity-root-embedded .entity-grid-environment{grid-template-columns:1fr;gap:0}.entity-root-embedded .entity-grid-environment .entity-field{display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:10px 0}.entity-root-embedded .entity-grid-environment .entity-field dt{font-size:11px;font-weight:650;color:var(--dim)}.entity-root-embedded .entity-grid-environment .entity-field dd{font-size:14px;font-weight:600;color:var(--text)}.entity-root-embedded .entity-tabs-environment{gap:18px;margin-top:25px;padding-top:18px;border-bottom:2px solid var(--border)}.entity-root-embedded .entity-tabs-environment button{height:44px;padding:0 4px;border:0;border-bottom:3px solid transparent;border-radius:0;color:var(--dim);font-size:14px;font-weight:650}.entity-root-embedded .entity-tabs-environment button.active{border-color:var(--signal);background:transparent;color:var(--text);font-weight:800;margin-bottom:-2px}`}</style>
    <style>{`@media(min-width:761px){.entity-root-embedded .entity-grid-environment{grid-template-columns:repeat(5,minmax(0,1fr));gap:0 24px}}@media(max-width:760px){.entity-root-embedded .entity-grid-environment{grid-template-columns:repeat(2,minmax(0,1fr));gap:0 18px}}@media(max-width:480px){.entity-root-embedded .entity-grid-environment{grid-template-columns:1fr}}`}</style>
    <style>{`@media(min-width:761px){.entity-root-embedded .entity-grid-environment{grid-template-columns:repeat(5,max-content);column-gap:32px}}.entity-root-embedded .entity-grid-environment .entity-field{padding-block:8px}.entity-root-embedded .entity-wallet-subhead .entity-address-line h1{font-size:12px}.entity-root-embedded .wallet-embedded-back{width:18px;height:22px;min-width:18px;min-height:22px;flex:0 0 18px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:1px solid transparent;border-radius:4px;background:var(--bg);color:var(--dim);cursor:pointer;transition:border-color .15s,background .15s,color .15s}.entity-root-embedded .wallet-embedded-back:hover{border-color:var(--faint);background:var(--bg);color:var(--text)}.entity-root-embedded .wallet-embedded-back svg{width:18px;height:18px}.entity-root-embedded .entity-table-wrap-environment{overflow-x:auto;overflow-y:hidden;scrollbar-width:thin;scrollbar-color:var(--faint) transparent}.entity-root-embedded .entity-table-wrap-environment::-webkit-scrollbar{width:6px;height:6px}.entity-root-embedded .entity-table-wrap-environment::-webkit-scrollbar-track{background:transparent}.entity-root-embedded .entity-table-wrap-environment::-webkit-scrollbar-thumb{background:var(--faint);border-radius:999px}.entity-root-embedded .entity-transactions-table-environment{min-width:1180px}.entity-root-embedded .entity-assets-table-environment{min-width:620px}`}</style>
    <style>{`.entity-card-identity .entity-card-entity-name{display:block;color:var(--text);font-size:13px;font-weight:650;line-height:1.2}.entity-card-identity .entity-card-entity-address{color:var(--faint);font-size:10.5px;font-weight:500;line-height:1.2;transition:color .15s ease,text-decoration-color .15s ease}.entity-card-identity .entity-address-line:hover .entity-card-entity-address{color:var(--text);text-decoration:underline;text-decoration-color:color-mix(in srgb,var(--text) 42%,transparent);text-underline-offset:3px}`}</style>
    <style>{`.contract-metadata-grid{column-gap:34px}.contract-metadata-grid .entity-field{gap:10px;padding-block:5px}.contract-metadata-grid .entity-field dt{color:var(--dim);font-size:13px;font-weight:400}.contract-metadata-grid .entity-field dd,.contract-metadata-grid .entity-field dd code,.contract-metadata-grid .entity-field dd a{color:var(--text)!important;font-size:14px;font-weight:400}.contract-metadata-grid .entity-field dd code{font-size:13px}.entity-root-embedded .contract-metadata-grid{margin-top:10px}`}</style>
    <style>{`.entity-ledger-page .entity-ledger-grid{grid-template-columns:minmax(0,350px) minmax(0,720px);column-gap:34px;justify-content:start}.entity-ledger-page .entity-ledger-column{min-width:0}.entity-ledger-page .entity-ledger-column .entity-field{grid-template-columns:145px minmax(0,1fr);gap:10px;padding-block:5px}.entity-ledger-page .entity-field dt{color:var(--dim);font-size:13px;font-weight:400}.entity-ledger-page .entity-field dd{font-size:14px;font-weight:400;white-space:nowrap}.entity-ledger-page .entity-field code{font-size:13px;line-height:1.5;white-space:nowrap;overflow-wrap:normal;word-break:normal}.entity-ledger-page .entity-field .explorer-entity-link{align-items:center;gap:8px;white-space:nowrap}.entity-root-embedded .entity-ledger-grid{margin-top:10px}.entity-ledger-page .entity-title-label{display:flex!important;flex-direction:row;align-items:center;gap:7px;white-space:nowrap}.entity-ledger-page .entity-title-label svg{display:block;width:15px;height:15px;flex:0 0 15px}.entity-ledger-page .entity-transaction-row{cursor:pointer;transition:background .14s ease}.entity-ledger-page .entity-transaction-row:hover{background:#202020}.entity-ledger-page .entity-transaction-row:focus-visible{outline:2px solid var(--signal);outline-offset:-2px}@media(min-width:761px) and (max-width:1100px){.entity-ledger-page .entity-ledger-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}@media(max-width:760px){.entity-ledger-page .entity-ledger-grid{grid-template-columns:1fr}.entity-ledger-page .entity-ledger-column .entity-field{grid-template-columns:112px minmax(0,1fr);gap:12px}}`}</style>
    <style>{`.entity-root-embedded .wallet-metadata-grid{margin-top:10px}.wallet-metadata-grid{grid-template-columns:1fr;gap:0}.wallet-metadata-grid .entity-field{display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding-block:8px}.wallet-metadata-grid .entity-field dt,.entity-root-embedded .wallet-metadata-grid .entity-field dt{color:var(--dim);font-size:13px;font-weight:400}.wallet-metadata-grid .entity-field dd,.entity-root-embedded .wallet-metadata-grid .entity-field dd{color:var(--text);font-size:14px;font-weight:400}`}</style>
    <style>{`@media(min-width:761px){.wallet-metadata-grid{grid-template-columns:repeat(5,max-content);column-gap:32px}}@media(max-width:760px){.wallet-metadata-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:0 18px}}@media(max-width:480px){.wallet-metadata-grid{grid-template-columns:1fr}}`}</style>
    <style>{`.wallet-tabs button{font-size:13px;font-weight:650}.wallet-tabs button.active{font-weight:800}.wallet-tx-status{display:inline-flex;align-items:center;gap:6px;font-weight:650;white-space:nowrap}.wallet-tx-status svg{width:14px;height:14px;stroke-width:3}.wallet-tx-status-success{color:var(--green)}.wallet-tx-status-failed{color:#f06a73}.wallet-transaction-entity{display:inline-flex!important;align-items:center;gap:6px;white-space:nowrap}`}</style>
    <style>{`.contract-transactions-table .explorer-entity-link>a{color:var(--text)!important}.contract-transactions-table .explorer-entity-copy{color:var(--text)!important}.contract-transactions-table .wallet-transaction-hash,.contract-transactions-table .transaction-hash-link{color:var(--text)!important;text-decoration:none!important;text-underline-offset:3px}.contract-transactions-table .wallet-transaction-hash:hover,.contract-transactions-table .transaction-hash-link:hover{text-decoration:underline!important;text-decoration-color:color-mix(in srgb,var(--text) 42%,transparent)!important}`}</style>
    <style>{`.wallet-tabs-row{display:flex;align-items:flex-end;gap:16px;margin-top:25px;border-bottom:1px solid var(--border)}.wallet-tabs-row .entity-tabs{flex:1;min-width:0;margin-top:0;padding-top:0;border-bottom:0}.wallet-tabs-tools{display:flex;align-items:center;gap:7px;flex-shrink:0;padding-bottom:8px}.wallet-tool-button{height:30px;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:0 9px;border:1px solid var(--border);border-radius:5px;background:var(--panel);color:var(--dim);font:600 10px inherit;cursor:pointer;white-space:nowrap}.wallet-tool-button:hover,.wallet-tool-button[aria-expanded=true]{border-color:var(--faint);color:var(--text);background:var(--bg)}.wallet-tool-button svg{width:13px;height:13px}.wallet-tool-button svg:last-child{width:11px;height:11px}.wallet-refresh-control{position:relative}.wallet-refresh-menu{position:absolute;z-index:30;right:0;top:calc(100% + 5px);min-width:86px;padding:4px;border:1px solid var(--border);border-radius:6px;background:var(--panel);box-shadow:0 14px 32px rgba(0,0,0,.4)}.wallet-refresh-menu button{display:flex;width:100%;height:29px;align-items:center;justify-content:space-between;gap:12px;padding:0 8px;border:0;border-radius:4px;background:transparent;color:var(--dim);font:inherit;font-size:10px;cursor:pointer}.wallet-refresh-menu button:hover,.wallet-refresh-menu button[aria-selected=true]{background:var(--bg);color:var(--text)}.wallet-refresh-menu button svg{width:12px;height:12px;color:var(--text)}.wallet-columns-backdrop{position:fixed;z-index:100;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.58)}.wallet-columns-modal{width:min(360px,100%);border:1px solid var(--border);border-radius:4px;background:var(--panel);box-shadow:0 24px 70px rgba(0,0,0,.5)}.wallet-columns-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:16px;border-bottom:1px solid var(--border)}.wallet-columns-header h2{margin:0;color:var(--text);font-size:14px}.wallet-columns-header p{margin:4px 0 0;color:var(--faint);font-size:10.5px}.wallet-columns-header>button{display:inline-flex;width:26px;height:26px;align-items:center;justify-content:center;padding:0;border:1px solid transparent;border-radius:5px;background:transparent;color:var(--dim);cursor:pointer}.wallet-columns-header>button:hover{border-color:var(--border);color:var(--text);background:var(--bg)}.wallet-columns-header>button svg{width:15px;height:15px}.wallet-columns-list{display:grid;padding:7px}.wallet-columns-list>button{display:flex;min-height:38px;align-items:center;justify-content:space-between;gap:16px;padding:0 9px;border:0;border-radius:5px;background:transparent;color:var(--text);font:inherit;font-size:11px;text-align:left;cursor:pointer}.wallet-columns-list>button:hover{background:var(--bg)}.wallet-column-toggle{position:relative;width:30px;height:18px;flex:0 0 30px;border-radius:999px;background:var(--border);transition:background .15s ease}.wallet-column-toggle>span{position:absolute;top:3px;left:3px;width:12px;height:12px;border-radius:50%;background:var(--faint);transition:transform .15s ease,background .15s ease}.wallet-column-toggle[data-on=true]{background:var(--green)}.wallet-column-toggle[data-on=true]>span{transform:translateX(12px);background:#fff}@media(max-width:760px){.wallet-tabs-row{align-items:stretch;flex-wrap:wrap;gap:0}.wallet-tabs-row .entity-tabs{flex-basis:100%;overflow-x:auto}.wallet-tabs-tools{width:100%;justify-content:flex-end;padding:8px 0}.wallet-tool-button{height:29px}}`}</style>
    </>
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
  const router = useRouter();

  const openTransaction = (hash: string) => router.push(explorerRoutes.tx(network, hash));

  return (
    <table className="entity-table contract-transactions-table">
      <thead>
        <tr>
          <th>Transaction hash</th>
          <th>Source</th>
          <th>Target</th>
          <th>Operation</th>
          <th>Ledger</th>
          <th>Fee charged</th>
          <th>Max fee</th>
          <th>Status</th>
          <th>Closed</th>
        </tr>
      </thead>
      <tbody>
        {loading && !rows.length ? (
          <tr>
            <td colSpan={9}>Loading transactions...</td>
          </tr>
        ) : rows.length ? (
          rows.map((tx) => (
            <tr
              key={tx.hash}
              className="entity-transaction-row"
              role="link"
              tabIndex={0}
              aria-label={`Open transaction ${tx.hash}`}
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("a,button")) return;
                openTransaction(tx.hash);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openTransaction(tx.hash);
                }
              }}
            >
              <td>
                <TxHashLink className="transaction-hash-link" hash={tx.hash} network={network} />
              </td>
      <td>
        <TransactionAddress address={tx.source_account} network={network} />
      </td>
      <td>
        {tx.destination_account ? (
          <TransactionAddress address={tx.destination_account} network={network} />
        ) : (
          "No transfer"
        )}
      </td>
      <td>{tx.call_trace?.root_function ?? tx.operation_type}</td>
      <td>{tx.ledger_sequence != null || tx.ledger != null ? <LedgerLink className="contract-table-entity-link" sequence={tx.ledger_sequence ?? tx.ledger ?? ""} network={network} /> : "Not indexed"}</td>
      <td>{formatStroopsAsXlm(tx.fee_charged)}</td>
      <td>{formatStroopsAsXlm(tx.max_fee)}</td>
      <td><TransactionStatus status={tx.status} /></td>
              <td>{formatTime(tx.timestamp)}</td>
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={9}>No transactions are indexed for this entity.</td>
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
  const [limit, setLimit] = useState(10);
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
  embedded = false,
}: {
  ledger: ExplorerLedgerDetail;
  network: string;
  embedded?: boolean;
}) {
  const loader = useState(
    () => (limit: number, cursor: string | null) =>
      getLedgerTransactions(network, ledger.sequence, limit, cursor),
  )[0];
  const paging = usePagedTransactions(loader);
  useExplorerScrollTop();
  const router = useRouter();
  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(`/explorer/${encodeURIComponent(network)}`);
  };
  return (
    <ExplorerEntityShell
      network={network}
      kind="ledger"
      value={ledger.sequence}
      embedded={embedded}
    >
      <section className="entity-subhead">
        {embedded && <button className="wallet-embedded-back" type="button" aria-label="Back to explorer" onClick={handleBack}><ChevronLeft /></button>}
        <div className="entity-title">
          <div
            className="entity-title-label"
            style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}
          >
            <Database size={15} aria-hidden="true" style={{ display: "block", flex: "0 0 15px" }} />
            <span style={{ display: "inline-block" }}>Ledger</span>
          </div>
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
              href={`/simulation/new?ledger=${ledger.sequence}&network=${encodeURIComponent(network)}`}
          >
            <Play /> Simulate from ledger
          </Link>
        </div>
      </section>
      <div className="entity-page entity-ledger-page">
        <dl className="entity-grid entity-ledger-grid">
          <div className="entity-ledger-column">
            <EntityField label="Transactions">
              {ledger.transaction_count != null ? `${ledger.transaction_count.toLocaleString()} tnxs` : "Not indexed"}
            </EntityField>
            <EntityField label="Operations">
              {ledger.operation_count ?? "Not reported"}
            </EntityField>
            <EntityField label="Protocol version">
              {ledger.protocol_version ?? "Not reported"}
            </EntityField>
            <EntityField label="Max Tx Set">
              {ledger.max_tx_set_size ?? "Not reported"}
            </EntityField>
            <EntityField label="Tx Set Ops">
              {ledger.tx_set_operation_count ?? "Not reported"}
            </EntityField>
          </div>
          <div className="entity-ledger-column">
            <EntityField label="Ledger hash">
              <span className="explorer-entity-link"><code>{ledger.hash}</code><EntityCopyButton value={ledger.hash} label="ledger hash" /></span>
            </EntityField>
            <EntityField label="Previous hash">
              {ledger.parent_hash ? (
                <span className="explorer-entity-link"><code>{ledger.parent_hash}</code><EntityCopyButton value={ledger.parent_hash} label="previous ledger hash" /></span>
              ) : (
                "Not reported"
              )}
            </EntityField>
            <EntityField label="Base fee">
              {formatStroopsAsXlm(ledger.base_operation_fee)}
            </EntityField>
            <EntityField label="Reserve">
              {formatStroopsAsXlm(ledger.base_reserve)}
            </EntityField>
            <EntityField label="Closed at">
              {formatTime(ledger.timestamp)}
            </EntityField>
          </div>
        </dl>
        <div className="entity-tabs">
          <button className="active" type="button">
            Transactions
          </button>
        </div>
        <div className="entity-table-wrap">
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
      </div>
    </ExplorerEntityShell>
  );
}

export function EntityField({
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

function EntityPageSizeSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const options = [10, 20, 50, 100];

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="entity-select" ref={menuRef}>
      <button
        className="entity-select-trigger"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{value} per page</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open && (
        <div className="entity-select-menu" role="listbox" aria-label="Rows per page">
          {options.map((option) => (
            <button
              className="entity-select-option"
              key={option}
              type="button"
              role="option"
              aria-selected={value === option}
              data-active={value === option}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
            >
              {option} per page
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function EntityPagination({
  limit,
  onLimitChange,
  canBack,
  canNext,
  loading,
  pageNumber,
  onBack,
  onNext,
}: {
  limit: number;
  onLimitChange: (value: number) => void;
  canBack: boolean;
  canNext: boolean;
  loading: boolean;
  pageNumber: number;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="entity-pagination">
      <EntityPageSizeSelect value={limit} onChange={onLimitChange} />
      <button
        type="button"
        disabled={!canBack || loading}
        onClick={onBack}
      >
        Back
      </button>
      <span className="entity-page-number">{pageNumber}</span>
      <button
        type="button"
        disabled={!canNext || loading}
        onClick={onNext}
      >
        Next
      </button>
    </div>
  );
}

function Paging({ paging }: { paging: Paging }) {
  return (
    <EntityPagination
      limit={paging.limit}
      onLimitChange={paging.changeLimit}
      canBack={paging.canBack}
      canNext={Boolean(paging.page?.pagination.next_cursor)}
      loading={paging.loading}
      pageNumber={paging.pageNumber}
      onBack={paging.back}
      onNext={paging.next}
    />
  );
}

export function ContractExplorerDesign({
  contract,
  network,
  address,
  embedded = false,
  onBack,
}: {
  contract: ExplorerContractDetail;
  network: string;
  address: string;
  embedded?: boolean;
  onBack?: () => void;
}) {
  const [tab, setTab] = useState<"transactions" | "events" | "overview">(
    "transactions",
  );
  const [copied, setCopied] = useState(false);
  const txLoader = useState(
    () => async (limit: number, cursor: string | null) => {
      const startedAt = performance.now();
      const result = await getContractTransactions(network, address, limit, cursor);
      if (process.env.NODE_ENV !== "production") {
        console.debug("[contract-load] transactions", {
          address,
          elapsedMs: Math.round(performance.now() - startedAt),
          rows: result.data?.data.length ?? 0,
          error: result.error,
        });
      }
      return result;
    },
  )[0];
  const paging = usePagedTransactions(txLoader);
  const [events, setEvents] = useState<ExplorerContractEvent[]>([]);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const router = useRouter();
  useExplorerScrollTop();
  const handleBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(`/explorer/${encodeURIComponent(network)}`);
  };
  useEffect(() => {
    if (tab !== "events") return;
    let active = true;
    const startedAt = performance.now();
    void getContractEvents(network, address, 20).then((result) => {
      if (!active) return;
      setEvents(result.data?.data ?? []);
      setEventsError(result.error);
      if (process.env.NODE_ENV !== "production") {
        console.debug("[contract-load] events", {
          address,
          elapsedMs: Math.round(performance.now() - startedAt),
          rows: result.data?.data.length ?? 0,
          error: result.error,
        });
      }
    });
    return () => {
      active = false;
    };
  }, [address, network, tab]);
  const copyAddress = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  const [verifyHref, setVerifyHref] = useState("/organizations");
  const [alertsHref, setAlertsHref] = useState("/organizations");
  useEffect(() => {
    setVerifyHref(storedProjectContract(address));
    setAlertsHref(storedProjectAlerts(address));
  }, [address]);
  return (
    <ExplorerEntityShell network={network} kind="contract" value={address} embedded={embedded}>
      <section className="entity-subhead">
        {embedded && <button className="wallet-embedded-back" type="button" aria-label="Back to contracts" onClick={handleBack}><ChevronLeft /></button>}
        <div className="entity-title">
          <EntityIdenticon value={address} kind="contract" size={26} />
          <div className="entity-identity entity-card-identity">
            <span className="entity-card-entity-name">{contract.name || "Contract"}</span>
            <div className="entity-address-line">
              <h1 className="entity-card-entity-address" title={address}>{truncateEntity(address, 8, 6)}</h1>
              <button
                className="entity-copy-inline"
                data-copied={copied ? "true" : "false"}
                type="button"
                aria-label="Copy contract address"
                title={copied ? "Copied" : "Copy contract address"}
                onClick={() => void copyAddress()}
              >
                {copied ? <Check /> : <Copy />}
              </button>
            </div>
          </div>
        </div>
        <div className="entity-buttons">
          {embedded && <button className="entity-button" type="button" onClick={() => void navigator.clipboard.writeText(window.location.href)}><Share2 /> Share</button>}
          {embedded && <a className="entity-button" href={stellarExpertRoute(network, "contract", address)} target="_blank" rel="noreferrer"><Globe2 /> Explorer</a>}
          <Link
            className="entity-button"
            href={verifyHref}
          >
            <FileCode2 /> Verify
          </Link>
          <Link
            className="entity-button"
            href={alertsHref}
          >
            <Bell /> Create alert
          </Link>
          <Link
            className="entity-button primary"
            href={`/simulation/new?contract=${encodeURIComponent(address)}`}
          >
            <Play /> Simulate
          </Link>
        </div>
      </section>
      <div className="entity-page">
        <dl className="entity-grid contract-metadata-grid">
          <EntityField label="Contract address">
            <ContractLink address={address} network={network} />
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
            {eventsError ? (
              <div className="entity-empty">{eventsError}</div>
            ) : (
              <table className="entity-table contract-events-table">
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
                        <td><LedgerLink sequence={event.ledger} network={network} /></td>
                        <td>
                          <TxHashLink hash={event.tx_hash} network={network} />
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
