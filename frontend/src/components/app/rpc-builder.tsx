"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode, type UIEvent } from "react";
import {
  Braces,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Copy,
  FileJson2,
  History,
  LoaderCircle,
  Play,
  Plus,
  Search,
  Server,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";

export type RpcBuilderLog = {
  id: string;
  method: string;
  status: string;
  latency_ms: number;
  caller_class: string;
  created_at: string;
};

type RpcExample = {
  method: string;
  description: string;
  access: "Read" | "Write";
  params: (ledger: number) => Record<string, unknown>;
};

type RpcRequestDocument = {
  id: string;
  title: string;
  body: string;
  response: string;
  status: number | null;
  elapsedMs: number | null;
  responseBytes: number | null;
};

type JsonDiagnostic = {
  message: string;
  offset: number;
};

const RPC_EXAMPLES: RpcExample[] = [
  { method: "getHealth", description: "Check whether this virtual network RPC is healthy.", access: "Read", params: () => ({}) },
  { method: "getNetwork", description: "Return the network passphrase, protocol version, and Friendbot URL when available.", access: "Read", params: () => ({}) },
  { method: "getVersionInfo", description: "Inspect the version and build information of the RPC service.", access: "Read", params: () => ({}) },
  { method: "getFeeStats", description: "Read fee distributions calculated from transactions in this environment.", access: "Read", params: () => ({}) },
  { method: "getLatestLedger", description: "Return the latest ledger available in this virtual network.", access: "Read", params: () => ({}) },
  { method: "getLedgers", description: "List virtual ledger headers from a starting ledger with pagination.", access: "Read", params: ledger => ({ startLedger: ledger, pagination: { limit: 10 } }) },
  { method: "getLedgerEntries", description: "Fetch ledger entries by their base64-encoded LedgerKey XDR values.", access: "Read", params: () => ({ keys: ["<base64-encoded-ledger-key-xdr>"] }) },
  { method: "getTransaction", description: "Look up one virtual transaction by its hash.", access: "Read", params: () => ({ hash: "<transaction-hash>" }) },
  { method: "getTransactions", description: "List transactions recorded by this environment from a starting ledger.", access: "Read", params: ledger => ({ startLedger: ledger, pagination: { limit: 10 } }) },
  { method: "getEvents", description: "Query contract events emitted inside this virtual network.", access: "Read", params: ledger => ({ startLedger: ledger, filters: [], pagination: { limit: 10 } }) },
  { method: "sendTransaction", description: "Submit a signed transaction envelope and auto-mine it into the virtual chain.", access: "Write", params: () => ({ transaction: "<base64-encoded-transaction-envelope-xdr>" }) },
  { method: "simulateTransaction", description: "Simulate a transaction envelope against the environment's current state.", access: "Read", params: () => ({ transaction: "<base64-encoded-transaction-envelope-xdr>" }) },
];

const rpcBuilderStyles = `
  .rb{--rb-accent:var(--green);min-width:0;background:transparent}
  .rb *{scrollbar-width:thin;scrollbar-color:#3b433e transparent}.rb *::-webkit-scrollbar{width:7px;height:7px}.rb *::-webkit-scrollbar-track{background:transparent}.rb *::-webkit-scrollbar-thumb{border:2px solid transparent;border-radius:999px;background-clip:padding-box;background-color:#3b433e}.rb *::-webkit-scrollbar-thumb:hover{background-color:#59645d}.rb *::-webkit-scrollbar-corner{background:transparent}
  .rb-head{display:flex;min-height:43px;align-items:flex-end;border-bottom:1px solid var(--border);background:transparent}
  .rb-tabs{display:flex;align-items:flex-end;gap:4px}.rb-tab{position:relative;display:inline-flex;min-height:42px;align-items:center;gap:7px;border:0;padding:0 11px;background:transparent;color:var(--text-dim);font:inherit;font-size:13px;cursor:pointer}.rb-tab:hover,.rb-tab[data-active=true]{color:var(--text)}.rb-tab[data-active=true]::after{content:"";position:absolute;right:0;bottom:-1px;left:0;height:2px;background:var(--rb-accent)}.rb-tab svg{width:14px}
  .rb-shell{display:grid;height:clamp(560px,calc(100vh - 205px),760px);min-height:0;grid-template-columns:236px minmax(0,1fr);overflow:hidden;border:1px solid var(--border);border-top:0;border-radius:0 0 8px 8px}
  .rb-sidebar{display:flex;min-width:0;flex-direction:column;border-right:1px solid var(--border);background:color-mix(in srgb,var(--panel) 56%,var(--bg));padding:14px 12px}
  .rb-new{display:flex;min-height:38px;align-items:center;gap:9px;border:1px solid var(--border);border-radius:6px;padding:0 12px;background:var(--panel-2);color:var(--text);font:inherit;font-size:13px;cursor:pointer}.rb-new:hover{border-color:var(--text-faint);background:color-mix(in srgb,var(--panel-2) 78%,white)}.rb-new svg{width:15px}
  .rb-nav{display:grid;gap:3px;margin-top:12px}.rb-nav-button,.rb-recent-button{display:flex;width:100%;min-width:0;align-items:center;gap:8px;border:0;border-radius:5px;background:transparent;color:var(--text-dim);font:inherit;font-size:12px;text-align:left;cursor:pointer}.rb-nav-button{min-height:36px;padding:0 9px}.rb-nav-button:hover,.rb-nav-button[data-active=true],.rb-recent-button:hover,.rb-recent-button[data-active=true]{background:var(--panel-2);color:var(--text)}.rb-nav-button svg{width:14px;flex:0 0 auto}.rb-nav-button .rb-nav-count{margin-left:auto;color:var(--text-faint);font-size:10px}
  .rb-sidebar-section{display:flex;min-height:0;flex:1;flex-direction:column;margin-top:17px;overflow:hidden}.rb-sidebar-label{display:flex;align-items:center;gap:6px;padding:0 8px 7px;color:var(--text-faint);font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.rb-sidebar-label svg{width:12px}.rb-recent-list{display:grid;min-height:0;gap:3px;overflow:auto}.rb-recent-button{min-height:32px;padding:0 8px}.rb-recent-button svg{width:13px;flex:0 0 auto}.rb-recent-button span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .rb-main{min-width:0;min-height:0;overflow:hidden;background:var(--bg)}
  .rb-examples{height:100%;overflow:auto;padding:24px}.rb-examples-top{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:18px}.rb-examples-top h3{margin:0 0 6px;font-size:15px;font-weight:550}.rb-examples-top p{max-width:700px;margin:0;color:var(--text-dim);font-size:12px;line-height:1.6}.rb-supported{flex:0 0 auto;border:1px solid var(--border);border-radius:999px;padding:5px 9px;color:var(--text-dim);font-size:10px}
  .rb-example-list{display:grid;gap:8px;overflow:visible}.rb-example{display:grid;width:100%;grid-template-columns:minmax(190px,.65fr) minmax(260px,1.35fr) 52px 18px;align-items:center;gap:18px;min-height:52px;border:1px solid var(--border);border-radius:6px;padding:0 16px;background:var(--panel);color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background .15s,border-color .15s}.rb-example:hover{border-color:var(--text-faint);background:var(--panel-2)}.rb-example strong{min-width:0;overflow:hidden;color:#ffffff;font:600 13px ui-monospace,SFMono-Regular,Consolas,monospace;text-overflow:ellipsis;white-space:nowrap}.rb-example>span{min-width:0;overflow:hidden;color:var(--text-dim);font-size:11px;text-overflow:ellipsis;white-space:nowrap}.rb-example .rb-access{justify-self:end;color:var(--text-faint);font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}.rb-example svg{width:14px;color:var(--text-faint)}
  .rb-request{display:grid;height:100%;min-height:0;overflow:hidden;grid-template-rows:auto minmax(0,1fr) auto minmax(0,1fr)}
  .rb-toolbar,.rb-response-head{display:flex;min-width:0;align-items:center;justify-content:space-between;gap:12px;padding:9px 12px;border-bottom:1px solid var(--border);background:var(--panel)}.rb-toolbar-left,.rb-toolbar-actions,.rb-response-meta{display:flex;min-width:0;align-items:center;gap:8px}.rb-toolbar-label,.rb-response-title{color:var(--text);font-size:12px;font-weight:550}.rb-endpoint{display:flex;min-width:0;align-items:center;gap:7px;border-left:1px solid var(--border);padding-left:10px;color:var(--text-dim);font:11px ui-monospace,SFMono-Regular,Consolas,monospace}.rb-endpoint svg{width:13px;flex:0 0 auto;color:var(--text-faint)}.rb-endpoint span{min-width:0;max-width:40vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .rb-network{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border);border-radius:5px;padding:5px 8px;color:var(--text-dim);font-size:10px;text-transform:capitalize}.rb-network-dot{width:6px;height:6px;border-radius:50%;background:var(--rb-accent)}
  .rb-button{display:inline-flex;min-height:30px;align-items:center;justify-content:center;gap:6px;border:1px solid var(--border);border-radius:5px;padding:0 9px;background:var(--panel-2);color:var(--text);font:inherit;font-size:11px;cursor:pointer}.rb-button:hover:not(:disabled){border-color:var(--text-faint);background:color-mix(in srgb,var(--panel-2) 80%,white)}.rb-button:disabled{cursor:not-allowed;opacity:.45}.rb-button svg{width:13px}.rb-button.run{border-color:#0f8a4d;background:#078a4f;color:#fff;font-weight:650}.rb-button.run:hover:not(:disabled){border-color:#079d59;background:#079d59}
  .rb-code-area{display:grid;min-width:0;min-height:0;grid-template-columns:44px minmax(0,1fr);overflow:hidden;background:#0d0f0e}.rb-request .rb-code-area{height:100%}.rb-lines{overflow:hidden;border-right:1px solid #292d2a;padding:13px 0;color:#65706a;font:11px/21px ui-monospace,SFMono-Regular,Consolas,monospace;text-align:right;user-select:none}.rb-lines-inner{padding-right:10px}.rb-editor-stack{position:relative;min-width:0;min-height:0;overflow:hidden}.rb-highlight,.rb-editor{position:absolute;inset:0;margin:0;overflow:auto;border:0;padding:13px 15px;background:transparent;font:12px/21px ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:0;tab-size:2;white-space:pre}.rb-highlight{pointer-events:none;scrollbar-width:none;color:#d1d7d3}.rb-highlight::-webkit-scrollbar{display:none}.rb-editor{width:100%;height:100%;resize:none;outline:0;color:transparent;caret-color:#f4f7f5;-webkit-text-fill-color:transparent}.rb-editor::selection{background:rgba(113,166,255,.34)}.rb-json-key{color:#7dcfff}.rb-json-string{color:#e9a56a}.rb-json-number{color:#9ece6a}.rb-json-literal{color:#bb9af7}.rb-json-punctuation{color:#c4cbc7}.rb-json-error{position:relative;text-decoration-line:underline;text-decoration-style:wavy;text-decoration-color:#ff5f67;text-decoration-thickness:1.5px;text-underline-offset:3px}
  .rb-response-head{border-top:1px solid var(--border)}.rb-response-meta{display:flex;align-items:center;gap:12px;margin-left:auto;color:var(--text-dim);font-size:12px}.rb-response-meta span{white-space:nowrap}.rb-response-meta strong{color:var(--text);font-size:12px;font-weight:600}.rb-response-meta .is-success{color:#66d58a}.rb-response-meta .is-error{color:#ff8585}.rb-response-code{position:relative;min-height:0}.rb-response-code .rb-highlight{overflow:auto;pointer-events:auto}.rb-response-empty{display:grid;height:100%;min-height:0;place-items:center;align-content:center;gap:8px;background:#0d0f0e;color:var(--text-dim);font-size:12px;text-align:center}.rb-response-empty svg{width:20px;color:var(--text-faint)}
  .rb-problem{position:absolute;z-index:4;right:10px;bottom:8px;display:inline-flex;align-items:center;gap:5px;border:1px solid #9d3238;border-radius:4px;padding:4px 7px;background:#251416;color:#ff7b82;font:10px ui-monospace,SFMono-Regular,Consolas,monospace;cursor:help}.rb-problem svg{width:12px}.rb-problem-tip{position:absolute;right:0;bottom:calc(100% + 7px);width:max-content;max-width:min(430px,calc(100vw - 80px));border:1px solid #9d3238;border-radius:5px;padding:8px 10px;opacity:0;background:#20191a;color:#ffb0b4;box-shadow:0 10px 28px rgba(0,0,0,.45);line-height:1.45;pointer-events:none;transform:translateY(3px);transition:opacity .14s,transform .14s}.rb-problem:hover .rb-problem-tip,.rb-problem:focus-visible .rb-problem-tip{opacity:1;transform:translateY(0)}
  .rb-logs-panel{height:clamp(560px,calc(100vh - 205px),760px);min-height:0;overflow:auto;border:1px solid var(--border);border-top:0;border-radius:0 0 8px 8px;background:var(--bg)}.rb-logs{padding:24px}.rb-logs-top{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:14px}.rb-logs-top h3{margin:0;font-size:15px;font-weight:550}.rb-search{position:relative;width:min(320px,50%)}.rb-search svg{position:absolute;top:50%;left:10px;width:13px;transform:translateY(-50%);color:var(--text-faint)}.rb-search input{width:100%;height:34px;border:1px solid var(--border);border-radius:5px;padding:0 10px 0 31px;background:var(--panel);color:var(--text);font:inherit;font-size:11px;outline:0}.rb-log-table{display:grid;gap:8px;overflow:visible}.rb-log-row{display:grid;grid-template-columns:minmax(180px,1fr) 100px 100px 130px;align-items:center;gap:14px;min-height:48px;border:1px solid var(--border);border-radius:6px;padding:0 14px;background:var(--panel);font-size:11px}.rb-log-row strong{font:500 11px ui-monospace,SFMono-Regular,Consolas,monospace}.rb-log-row span{color:var(--text-dim)}.rb-log-empty{display:grid;min-height:220px;place-items:center;border:1px dashed var(--border);border-radius:7px;color:var(--text-dim);font-size:12px}
  @media(max-width:900px){.rb-shell{grid-template-columns:190px minmax(0,1fr)}.rb-example{grid-template-columns:minmax(170px,.7fr) minmax(220px,1.3fr) 18px}.rb-example .rb-access{display:none}.rb-endpoint span{max-width:28vw}}
  .rb-shell,.rb-logs-panel,.rb-example,.rb-log-row,.rb-log-empty{border-radius:var(--card-radius,4px)!important}
  @media(max-width:680px){.rb-shell{display:block;height:720px;min-height:0}.rb-sidebar{height:auto;border-right:0;border-bottom:1px solid var(--border)}.rb-sidebar-section{display:none}.rb-nav{grid-template-columns:1fr}.rb-main{height:calc(100% - 105px);min-width:0}.rb-examples{padding:16px 12px}.rb-examples-top{display:block}.rb-supported{display:inline-block;margin-top:10px}.rb-example{grid-template-columns:minmax(150px,.8fr) minmax(0,1.2fr) 14px;gap:10px;padding:0 11px}.rb-request{grid-template-rows:auto minmax(0,1fr) auto minmax(0,1fr)}.rb-toolbar{align-items:flex-start;flex-direction:column}.rb-toolbar-left{width:100%;flex-wrap:wrap}.rb-toolbar-actions{align-self:flex-end}.rb-endpoint{width:100%;border-left:0;padding-left:0}.rb-endpoint span{max-width:calc(100vw - 95px)}.rb-response-head{flex-wrap:wrap}.rb-response-meta{order:3;width:100%;margin-left:0}.rb-logs-panel{height:720px}.rb-logs{padding:16px 12px}.rb-logs-top{align-items:flex-start;flex-direction:column}.rb-search{width:100%}.rb-log-row{grid-template-columns:minmax(0,1fr) 80px}.rb-log-row span:nth-child(n+3){display:none}}
  @media(prefers-reduced-motion:reduce){.rb *{transition:none!important;animation:none!important}}
`;

function createRequestBody(example: RpcExample, ledger: number) {
  return JSON.stringify({ jsonrpc: "2.0", id: 1, method: example.method, params: example.params(ledger) }, null, 2);
}

function tokenClass(token: string) {
  if (token.startsWith('"')) return token.trimEnd().endsWith(":") ? "rb-json-key" : "rb-json-string";
  if (/^-?\d/.test(token)) return "rb-json-number";
  if (/^(?:true|false|null)$/.test(token)) return "rb-json-literal";
  return "rb-json-punctuation";
}

function diagnosticFor(source: string, message: string): JsonDiagnostic {
  const positionMatch = message.match(/position\s+(\d+)/i);
  const lineColumnMatch = message.match(/line\s+(\d+)\s+column\s+(\d+)/i);
  let offset = positionMatch ? Number(positionMatch[1]) : source.length - 1;
  if (!positionMatch && lineColumnMatch) {
    const line = Math.max(1, Number(lineColumnMatch[1]));
    const column = Math.max(1, Number(lineColumnMatch[2]));
    offset = source.split("\n").slice(0, line - 1).reduce((total, part) => total + part.length + 1, 0) + column - 1;
  }
  offset = Math.max(0, Math.min(offset, Math.max(0, source.length - 1)));
  let previous = offset - 1;
  while (previous >= 0 && /\s/.test(source[previous])) previous -= 1;
  if ((/[}\]]/.test(source[offset] ?? "") || /\s/.test(source[offset] ?? "")) && source[previous] === ",") offset = previous;
  return { message, offset };
}

function appendHighlighted(output: ReactNode[], value: string, start: number, className: string | undefined, diagnostic?: JsonDiagnostic | null) {
  const end = start + value.length;
  const marker = diagnostic?.offset;
  if (marker === undefined || marker < start || marker >= end) {
    output.push(className ? <span className={className} key={`${start}-${value}`}>{value}</span> : value);
    return;
  }
  const relative = marker - start;
  if (relative > 0) output.push(className ? <span className={className} key={`${start}-before`}>{value.slice(0, relative)}</span> : value.slice(0, relative));
  output.push(<span className={`${className ? `${className} ` : ""}rb-json-error`} key={`${start}-error`}>{value.slice(relative, relative + 1) || " "}</span>);
  if (relative + 1 < value.length) output.push(className ? <span className={className} key={`${start}-after`}>{value.slice(relative + 1)}</span> : value.slice(relative + 1));
}

function highlightJson(source: string, diagnostic?: JsonDiagnostic | null): ReactNode[] {
  const pattern = /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"\s*:)|("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])/g;
  const output: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    if (match.index > cursor) appendHighlighted(output, source.slice(cursor, match.index), cursor, undefined, diagnostic);
    appendHighlighted(output, match[0], match.index, tokenClass(match[0]), diagnostic);
    cursor = pattern.lastIndex;
  }
  if (cursor < source.length) appendHighlighted(output, source.slice(cursor), cursor, undefined, diagnostic);
  return output;
}

function JsonCode({ value, editable = false, diagnostic, onChange, onRun }: {
  value: string;
  editable?: boolean;
  diagnostic?: JsonDiagnostic | null;
  onChange?: (value: string) => void;
  onRun?: () => void;
}) {
  const highlightRef = useRef<HTMLPreElement>(null);
  const linesRef = useRef<HTMLDivElement>(null);
  const lineCount = Math.max(1, value.split("\n").length);
  const syncScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    if (highlightRef.current) {
      highlightRef.current.scrollTop = event.currentTarget.scrollTop;
      highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
    }
    if (linesRef.current) linesRef.current.scrollTop = event.currentTarget.scrollTop;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      onRun?.();
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const target = event.currentTarget;
      const next = `${value.slice(0, target.selectionStart)}  ${value.slice(target.selectionEnd)}`;
      const caret = target.selectionStart + 2;
      onChange?.(next);
      requestAnimationFrame(() => target.setSelectionRange(caret, caret));
    }
  };
  return <div className="rb-code-area">
    <div className="rb-lines" ref={linesRef} aria-hidden="true"><div className="rb-lines-inner">{Array.from({ length: lineCount }, (_, index) => <div key={index}>{index + 1}</div>)}</div></div>
    <div className="rb-editor-stack">
      <pre ref={highlightRef} className="rb-highlight" aria-hidden="true">{highlightJson(value, diagnostic)}{value.endsWith("\n") ? " " : "\n "}</pre>
      {editable && <textarea className="rb-editor" aria-label="JSON-RPC request" value={value} onChange={event => onChange?.(event.target.value)} onScroll={syncScroll} onKeyDown={onKeyDown} spellCheck={false} autoCapitalize="off" autoCorrect="off" />}
    </div>
  </div>;
}

function JsonResponse({ value }: { value: string }) {
  const linesRef = useRef<HTMLDivElement>(null);
  const lineCount = Math.max(1, value.split("\n").length);
  return <div className="rb-code-area rb-response-code">
    <div className="rb-lines" ref={linesRef} aria-hidden="true"><div className="rb-lines-inner">{Array.from({ length: lineCount }, (_, index) => <div key={index}>{index + 1}</div>)}</div></div>
    <div className="rb-editor-stack"><pre className="rb-highlight" aria-label="JSON-RPC response" onScroll={event => { if (linesRef.current) linesRef.current.scrollTop = event.currentTarget.scrollTop; }}>{highlightJson(value)}{"\n "}</pre></div>
  </div>;
}

function responseSize(bytes: number | null) {
  if (bytes === null) return "—";
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
}

function formatLogTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Unknown" : date.toLocaleString();
}

export function RpcBuilder({ resource, rpcUrl, network, stateLedger, logs, onRequestComplete }: {
  resource: string;
  rpcUrl: string;
  network: string;
  stateLedger: number;
  logs: RpcBuilderLog[];
  onRequestComplete?: () => void;
}) {
  const [workspace, setWorkspace] = useState<"builder" | "logs">("builder");
  const [view, setView] = useState<"examples" | "request">("examples");
  const [documents, setDocuments] = useState<RpcRequestDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState<"request" | "response" | null>(null);
  const [logSearch, setLogSearch] = useState("");
  const active = documents.find(document => document.id === selectedId) ?? null;
  const diagnostic: JsonDiagnostic | null = (() => {
    if (!active?.body.trim()) return null;
    try {
      const request: unknown = JSON.parse(active.body);
      if (!request || Array.isArray(request) || typeof request !== "object") return { message: "The request must be a JSON object.", offset: 0 };
      if (!("method" in request) || typeof request.method !== "string" || !request.method.trim()) return { message: "Add a JSON-RPC method before running.", offset: 0 };
      return null;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The request is not valid JSON.";
      return diagnosticFor(active.body, message);
    }
  })();
  const visibleLogs = logs.filter(log => `${log.method} ${log.status} ${log.caller_class}`.toLowerCase().includes(logSearch.trim().toLowerCase()));

  const addDocument = (title: string, body: string) => {
    const document: RpcRequestDocument = { id: crypto.randomUUID(), title, body, response: "", status: null, elapsedMs: null, responseBytes: null };
    setDocuments(current => [document, ...current].slice(0, 14));
    setSelectedId(document.id);
    setWorkspace("builder");
    setView("request");
  };

  const updateActive = (patch: Partial<RpcRequestDocument>) => {
    if (!selectedId) return;
    setDocuments(current => current.map(document => document.id === selectedId ? { ...document, ...patch } : document));
  };

  const copyValue = async (kind: "request" | "response", value: string) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(current => current === kind ? null : current), 1_500);
  };

  const runRequest = async () => {
    if (!active?.body.trim() || diagnostic || running) return;
    let request: Record<string, unknown>;
    try {
      request = JSON.parse(active.body) as Record<string, unknown>;
    } catch {
      return;
    }
    setRunning(true);
    const started = performance.now();
    try {
      const response = await api.post<unknown>(`${resource}/rpc`, request);
      const formatted = JSON.stringify(response, null, 2);
      updateActive({
        title: typeof request.method === "string" ? request.method : active.title,
        response: formatted,
        status: 200,
        elapsedMs: Math.max(1, Math.round(performance.now() - started)),
        responseBytes: new TextEncoder().encode(formatted).byteLength,
      });
    } catch (cause) {
      const error = cause instanceof ApiError ? cause : new ApiError(cause instanceof Error ? cause.message : "RPC request failed.", 0);
      const formatted = JSON.stringify({ jsonrpc: "2.0", id: request.id ?? null, error: { code: error.code, message: error.message } }, null, 2);
      updateActive({
        title: typeof request.method === "string" ? request.method : active.title,
        response: formatted,
        status: error.status || 500,
        elapsedMs: Math.max(1, Math.round(performance.now() - started)),
        responseBytes: new TextEncoder().encode(formatted).byteLength,
      });
    } finally {
      setRunning(false);
      onRequestComplete?.();
    }
  };

  return <section className="rb" aria-label="RPC Builder workspace">
    <style>{rpcBuilderStyles}</style>
    <header className="rb-head"><div className="rb-tabs" role="tablist" aria-label="RPC workspace"><button type="button" className="rb-tab" role="tab" aria-selected={workspace === "builder"} data-active={workspace === "builder"} onClick={() => setWorkspace("builder")}><Braces/>RPC Builder</button><button type="button" className="rb-tab" role="tab" aria-selected={workspace === "logs"} data-active={workspace === "logs"} onClick={() => setWorkspace("logs")}><History/>JSON-RPC Calls</button></div></header>
    {workspace === "builder" && <div className="rb-shell">
      <aside className="rb-sidebar">
        <button type="button" className="rb-new" onClick={() => addDocument("Untitled Request", "")}><Plus/>New Request</button>
        <nav className="rb-nav" aria-label="RPC Builder views">
          <button type="button" className="rb-nav-button" data-active={view === "examples"} onClick={() => setView("examples")}><Braces/><span>All examples</span><span className="rb-nav-count">{RPC_EXAMPLES.length}</span></button>
        </nav>
        <div className="rb-sidebar-section">
          <div className="rb-sidebar-label"><Clock3/>Recent requests</div>
          <div className="rb-recent-list">
            {documents.length ? documents.map(document => <button type="button" key={document.id} className="rb-recent-button" data-active={view === "request" && document.id === selectedId} title={document.title} onClick={() => { setSelectedId(document.id); setWorkspace("builder"); setView("request"); }}><FileJson2/><span>{document.title}</span></button>) : <span className="rb-sidebar-label" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>No requests yet</span>}
          </div>
        </div>
      </aside>

      <main className="rb-main">
        {view === "examples" && <div className="rb-examples">
          <div className="rb-examples-top"><div><h3>Explore supported RPC methods</h3></div><span className="rb-supported">{RPC_EXAMPLES.length} methods</span></div>
          <div className="rb-example-list">
            {RPC_EXAMPLES.map(example => <button type="button" className="rb-example" key={example.method} onClick={() => addDocument(example.method, createRequestBody(example, stateLedger))}><strong>{example.method}</strong><span>{example.description}</span><span className="rb-access">{example.access}</span><ChevronRight/></button>)}
          </div>
        </div>}

        {view === "request" && active && <div className="rb-request">
          <div className="rb-toolbar">
            <div className="rb-toolbar-left"><span className="rb-toolbar-label">Request</span><span className="rb-network"><span className="rb-network-dot"/>{network}</span><span className="rb-endpoint" title={rpcUrl}><Server/><span>{rpcUrl}</span></span></div>
            <div className="rb-toolbar-actions"><button type="button" className="rb-button" disabled={!active.body} onClick={() => void copyValue("request", active.body)}>{copied === "request" ? <Check/> : <Copy/>}{copied === "request" ? "Copied" : "Copy JSON"}</button><button type="button" className="rb-button run" disabled={!active.body.trim() || Boolean(diagnostic) || running} onClick={() => void runRequest()}>{running ? <LoaderCircle className="pw-spin"/> : <Play/>}{running ? "Running" : "Run"}<span aria-hidden="true">⌘↵</span></button></div>
          </div>
          <div style={{ position: "relative", minHeight: 0, overflow: "hidden" }}><JsonCode value={active.body} editable diagnostic={diagnostic} onChange={body => updateActive({ body, response: "", status: null, elapsedMs: null, responseBytes: null })} onRun={() => void runRequest()} />{diagnostic && <button type="button" className="rb-problem" aria-label={`View problem: ${diagnostic.message}`}><CircleAlert/>1 problem<span className="rb-problem-tip" role="tooltip">{diagnostic.message}</span></button>}</div>
          <div className="rb-response-head"><span className="rb-response-title">Response</span>{active.response && <div className="rb-response-meta"><span>Status <strong className={active.status && active.status >= 200 && active.status < 300 ? "is-success" : "is-error"}>{active.status}</strong></span><span>Time <strong>{active.elapsedMs} ms</strong></span><span title="UTF-8 encoded JSON response body">Size <strong>{responseSize(active.responseBytes)}</strong></span></div>}<button type="button" className="rb-button" disabled={!active.response} onClick={() => void copyValue("response", active.response)}>{copied === "response" ? <Check/> : <Copy/>}{copied === "response" ? "Copied" : "Copy JSON"}</button></div>
          {active.response ? <JsonResponse value={active.response}/> : <div className="rb-response-empty"><FileJson2/><span>{active.body ? "Run this request to see its response." : "Start with a JSON-RPC request, then run it to see the response."}</span></div>}
        </div>}
      </main>
    </div>}
    {workspace === "logs" && <div className="rb-logs-panel"><div className="rb-logs">
      <div className="rb-logs-top"><div><h3>JSON-RPC Calls</h3></div><label className="rb-search"><Search/><span className="sr-only">Search RPC calls</span><input value={logSearch} onChange={event => setLogSearch(event.target.value)} placeholder="Search method, status, or caller"/></label></div>
      {visibleLogs.length ? <div className="rb-log-table">{visibleLogs.map(log => <div className="rb-log-row" key={log.id}><strong>{log.method}</strong><span>{log.status}</span><span>{log.latency_ms} ms</span><span>{formatLogTime(log.created_at)}</span></div>)}</div> : <div className="rb-log-empty">{logs.length ? "No calls match this search." : "No JSON-RPC calls recorded."}</div>}
    </div></div>}
  </section>;
}
