"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Database,
  Radio,
  RotateCcw,
} from "lucide-react";
import type {
  ExplorerTxDetail,
  JsonValue,
  TxCallTreeNode,
} from "@/lib/explorer-api";
import { EntityIdenticon } from "@/components/explorer/entity-identicon";
import { truncateEntity } from "@/lib/explorer-routes";

type DetailTab = "input" | "output" | "state" | "events";

function pretty(value: JsonValue | undefined) {
  if (value === undefined) return "Not emitted";
  return JSON.stringify(value, null, 2) ?? String(value);
}

function TraceNode({
  node,
  index,
  tx,
  expanded,
  onToggle,
  showStorage,
  showEvents,
}: {
  node: TxCallTreeNode;
  index: number;
  tx: ExplorerTxDetail;
  expanded: boolean;
  onToggle: () => void;
  showStorage: boolean;
  showEvents: boolean;
}) {
  const state = tx.state_changes.filter(
    (change) => change.caused_by_call === node.id,
  );
  const events = tx.events.filter((event) => event.caused_by_call === node.id);
  const [detailTab, setDetailTab] = useState<DetailTab>("input");
  const availableTabs: DetailTab[] = [
    "input",
    "output",
    ...(showStorage ? ["state" as const] : []),
    ...(showEvents ? ["events" as const] : []),
  ];
  const value =
    detailTab === "input"
      ? node.args
      : detailTab === "output"
        ? node.return_value
        : detailTab === "state"
          ? (state as unknown as JsonValue)
          : (events as unknown as JsonValue);
  return (
    <article
      id={`trace-${node.id}`}
      className="trace-node"
      style={{ "--depth": node.depth } as React.CSSProperties}
    >
      <div className="trace-guides" aria-hidden="true">
        {Array.from({ length: node.depth }).map((_, depth) => (
          <i key={depth} style={{ left: depth * 20 + 10 }} />
        ))}
      </div>
      <button
        type="button"
        className="trace-main"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className="trace-chevron">
          {expanded ? <ChevronDown /> : <ChevronRight />}
        </span>
        <span className="trace-kind">CALL</span>
        <span className="trace-sequence">{String(index).padStart(2, "0")}</span>
        <EntityIdenticon className="trace-identicon" value={node.contract_id} kind="contract" size={16} />
        <span className="trace-code">
          <b>{truncateEntity(node.contract_id, 9, 6)}</b>
          <span>.{node.function_name}</span>
          <em>
            ({Array.isArray(node.args) ? `${node.args.length} args` : "input"})
          </em>
        </span>
        <span className="trace-evidence">
          {state.length ? (
            <span>
              <Database />
              {state.length}
            </span>
          ) : null}
          {events.length ? (
            <span>
              <Radio />
              {events.length}
            </span>
          ) : null}
        </span>
      </button>
      {expanded && (
        <div className="trace-detail">
          <div className="trace-detail-tabs" role="tablist">
            {availableTabs.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={detailTab === tab}
                className={detailTab === tab ? "active" : ""}
                onClick={() => setDetailTab(tab)}
              >
                {tab}
                {tab === "state"
                  ? ` ${state.length}`
                  : tab === "events"
                    ? ` ${events.length}`
                    : ""}
              </button>
            ))}
          </div>
          <pre>
            <code>{pretty(value)}</code>
          </pre>
        </div>
      )}
    </article>
  );
}

export function TransactionTrace({ tx }: { tx: ExplorerTxDetail }) {
  const [fullTrace, setFullTrace] = useState(true);
  const [showStorage, setShowStorage] = useState(true);
  const [showEvents, setShowEvents] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const visible = useMemo(
    () =>
      fullTrace ? tx.call_tree : tx.call_tree.filter((node) => !node.parent_id),
    [fullTrace, tx.call_tree],
  );
  const setAll = (open: boolean) =>
    setExpanded(open ? new Set(visible.map((node) => node.id)) : new Set());
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section
      className="transaction-trace"
      id="transaction-trace"
      aria-labelledby="trace-title"
    >
      <div className="trace-toolbar">
        <div>
          <h2 id="trace-title">Soroban call trace</h2>
          <span>
            {visible.length} call{visible.length === 1 ? "" : "s"} in execution
            order
          </span>
        </div>
        <div className="trace-controls">
          <label>
            <input
              type="checkbox"
              checked={fullTrace}
              onChange={(event) => setFullTrace(event.target.checked)}
            />{" "}
            Full Trace
          </label>
          <label>
            <input
              type="checkbox"
              checked={showStorage}
              onChange={(event) => setShowStorage(event.target.checked)}
            />{" "}
            Storage
          </label>
          <label>
            <input
              type="checkbox"
              checked={showEvents}
              onChange={(event) => setShowEvents(event.target.checked)}
            />{" "}
            Events
          </label>
          <button
            type="button"
            title="Expand all trace rows"
            aria-label="Expand all trace rows"
            onClick={() => setAll(true)}
          >
            <ChevronsUpDown />
          </button>
          <button
            type="button"
            title="Collapse all trace rows"
            aria-label="Collapse all trace rows"
            onClick={() => setAll(false)}
          >
            <ChevronsDownUp />
          </button>
        </div>
      </div>
      <div className="trace-list">
        {visible.length ? (
          visible.map((node, index) => (
            <TraceNode
              key={node.id}
              node={node}
              index={index}
              tx={tx}
              expanded={expanded.has(node.id)}
              onToggle={() => toggle(node.id)}
              showStorage={showStorage}
              showEvents={showEvents}
            />
          ))
        ) : (
          <div className="trace-empty">
            <RotateCcw />
            No Soroban invocation trace was emitted for this transaction.
          </div>
        )}
      </div>
      <style jsx>{`
        .transaction-trace {
          margin: 16px 28px 0;
          border: 1px solid var(--border);
          border-radius: 7px;
          overflow: hidden;
          background: var(--bg);
        }
        .trace-toolbar {
          min-height: 52px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 10px 14px;
          background: var(--panel);
          border-bottom: 1px solid var(--border);
        }
        .trace-toolbar h2 {
          margin: 0;
          font-size: 13px;
        }
        .trace-toolbar > div:first-child span {
          display: block;
          margin-top: 3px;
          color: var(--text-faint);
          font-size: 10.5px;
        }
        .trace-controls {
          display: flex;
          align-items: center;
          gap: 13px;
        }
        .trace-controls label {
          display: flex;
          align-items: center;
          gap: 5px;
          color: var(--text-dim);
          font-size: 11px;
          white-space: nowrap;
        }
        .trace-controls input {
          accent-color: var(--green);
        }
        .trace-controls button {
          display: grid;
          place-items: center;
          width: 27px;
          height: 27px;
          border: 1px solid var(--border);
          border-radius: 5px;
          background: var(--bg);
          color: var(--text-dim);
          cursor: pointer;
        }
        .trace-controls button :global(svg) {
          width: 13px;
          height: 13px;
        }
        .trace-list {
          overflow: hidden;
        }
        .trace-list :global(.trace-node) {
          position: relative;
          border-bottom: 1px solid var(--border);
          padding-left: calc(var(--depth) * 20px);
        }
        .trace-list :global(.trace-node:last-child) {
          border-bottom: 0;
        }
        .trace-list :global(.trace-guides) {
          position: absolute;
          inset: 0 auto 0 0;
          width: calc(var(--depth) * 20px);
          pointer-events: none;
        }
        .trace-list :global(.trace-guides i) {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 1px;
          background: #413936;
        }
        .trace-list :global(.trace-main) {
          position: relative;
          display: grid;
          grid-template-columns: 20px 58px 28px 16px minmax(0, 1fr) auto;
          align-items: center;
          gap: 8px;
          width: 100%;
          min-height: 45px;
          padding: 5px 13px;
          border: 0;
          background: transparent;
          color: var(--text);
          text-align: left;
          cursor: pointer;
        }
        .trace-list :global(.trace-main:hover) {
          background: #24201e;
        }
        .trace-list :global(.trace-chevron svg) {
          width: 14px;
          height: 14px;
          color: var(--text-faint);
        }
        .trace-list :global(.trace-kind) {
          display: inline-flex;
          justify-content: center;
          border: 1px solid #47613e;
          border-radius: 4px;
          padding: 3px 5px;
          color: #a3ff5f;
          font:
            700 9px ui-monospace,
            monospace;
        }
        .trace-list :global(.trace-sequence) {
          color: var(--text-faint);
          font:
            10px ui-monospace,
            monospace;
        }
        .trace-list :global(.trace-identicon) {
          width: 16px;
          height: 16px;
          flex-shrink: 0;
        }
        .trace-list :global(.trace-code) {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font:
            11.5px ui-monospace,
            monospace;
        }
        .trace-list :global(.trace-code b) {
          color: #e8823c;
          font-weight: 500;
        }
        .trace-list :global(.trace-code span) {
          color: #f2efec;
        }
        .trace-list :global(.trace-code em) {
          color: var(--text-faint);
          font-style: normal;
        }
        .trace-list :global(.trace-evidence) {
          display: flex;
          gap: 8px;
        }
        .trace-list :global(.trace-evidence span) {
          display: flex;
          align-items: center;
          gap: 3px;
          color: var(--text-faint);
          font-size: 9px;
        }
        .trace-list :global(.trace-evidence svg) {
          width: 11px;
          height: 11px;
        }
        .trace-list :global(.trace-detail) {
          margin: 0 13px 12px 94px;
          border: 1px solid var(--border);
          border-radius: 5px;
          overflow: hidden;
          background: #171413;
        }
        .trace-list :global(.trace-detail-tabs) {
          display: flex;
          gap: 2px;
          padding: 6px 7px;
          border-bottom: 1px solid var(--border);
        }
        .trace-list :global(.trace-detail-tabs button) {
          border: 0;
          border-radius: 4px;
          background: transparent;
          color: var(--text-faint);
          padding: 5px 8px;
          font: 600 9px inherit;
          text-transform: uppercase;
          cursor: pointer;
        }
        .trace-list :global(.trace-detail-tabs button.active) {
          background: var(--panel);
          color: var(--text);
        }
        .trace-list :global(pre) {
          max-height: 280px;
          margin: 0;
          padding: 12px;
          overflow: auto;
          color: #c9c2bd;
          font:
            11px/1.55 ui-monospace,
            monospace;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }
        .trace-empty {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 22px 14px;
          color: var(--text-faint);
          font-size: 12px;
        }
        .trace-empty :global(svg) {
          width: 14px;
          height: 14px;
        }
        @media (max-width: 740px) {
          .transaction-trace {
            margin-left: 14px;
            margin-right: 14px;
          }
          .trace-toolbar {
            align-items: flex-start;
            flex-direction: column;
          }
          .trace-controls {
            width: 100%;
            overflow-x: auto;
            padding-bottom: 2px;
          }
          .trace-list :global(.trace-main) {
            grid-template-columns: 18px 48px 22px 16px minmax(140px, 1fr) auto;
          }
          .trace-list :global(.trace-detail) {
            margin-left: 12px;
          }
        }
      `}</style>
    </section>
  );
}
