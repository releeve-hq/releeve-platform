"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import ELK from "elkjs/lib/elk.bundled.js";
import { Crosshair, Expand, Search, X } from "lucide-react";
import type { ExplorerTxDetail, TxFundFlowEdge } from "@/lib/explorer-api";
import { isContractAddress, truncateEntity } from "@/lib/explorer-routes";

const elk = new ELK();

function entityKind(address: string) {
  if (["Mint", "Burn", "Network fee"].includes(address)) return "System";
  return isContractAddress(address) ? "Contract" : "Account";
}

function nodeFor(address: string): Node {
  return {
    id: address,
    position: { x: 0, y: 0 },
    data: {
      label: (
        <div className="flow-node-label">
          <span>{entityKind(address)}</span>
          <strong>{truncateEntity(address, 10, 7)}</strong>
        </div>
      ),
    },
    style: {
      width: 260,
      height: 58,
      background: "#262221",
      color: "#f2efec",
      border: `1px solid ${isContractAddress(address) ? "#557149" : "#4a423c"}`,
      borderRadius: 6,
      fontSize: 11,
    },
  };
}

async function layout(nodes: Node[], edges: Edge[]) {
  const graph = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": "45",
      "elk.layered.spacing.nodeNodeBetweenLayers": "145",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    },
    children: nodes.map((node) => ({ id: node.id, width: 260, height: 58 })),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  });
  const positions = new Map(
    graph.children?.map((node) => [
      node.id,
      { x: node.x ?? 0, y: node.y ?? 0 },
    ]),
  );
  return nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? node.position,
  }));
}

function GraphCanvas({
  tx,
  network,
}: {
  tx: ExplorerTxDetail;
  network: string;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const { fitView } = useReactFlow();
  const [query, setQuery] = useState("");
  const [asset, setAsset] = useState("all");
  const [nodes, setNodes] = useState<Node[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const flow = useMemo<TxFundFlowEdge[]>(() => {
    if (tx.fund_flow.length) return tx.fund_flow;
    const calls = new Map(tx.call_tree.map((node) => [node.id, node]));
    return tx.call_tree.map((node, index) => ({
      id: `invocation-${node.id}`,
      from: node.parent_id
        ? (calls.get(node.parent_id)?.contract_id ?? tx.source_account)
        : tx.source_account,
      to: node.contract_id,
      amount: node.function_name,
      asset: "Invocation",
      asset_type: "contract_call",
      caused_by_call: node.id,
      sequence: index,
      usd_value: null,
    }));
  }, [tx]);
  const assets = useMemo(
    () => Array.from(new Set(flow.map((edge) => edge.asset))),
    [flow],
  );
  const visibleTransfers = useMemo(
    () => flow.filter((edge) => asset === "all" || edge.asset === asset),
    [asset, flow],
  );
  const edges = useMemo<Edge[]>(
    () =>
      visibleTransfers.map((edge, index) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        label: `${index + 1}. ${edge.amount} ${edge.asset}`,
        type: "smoothstep",
        animated: false,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "#a3ff5f",
          width: 15,
          height: 15,
        },
        style: {
          stroke: selectedEdge === edge.id ? "#e8823c" : "#7aa95c",
          strokeWidth: selectedEdge === edge.id ? 2.4 : 1.4,
        },
        labelStyle: { fill: "#d9d2cd", fontSize: 10, fontWeight: 600 },
        labelBgStyle: { fill: "#1d1918", fillOpacity: 0.95 },
        data: edge,
      })),
    [selectedEdge, visibleTransfers],
  );

  useEffect(() => {
    const addresses = Array.from(
      new Set(visibleTransfers.flatMap((edge) => [edge.from, edge.to])),
    );
    let alive = true;
    void layout(addresses.map(nodeFor), edges).then((next) => {
      if (!alive) return;
      setNodes(next);
      window.setTimeout(() => fitView({ padding: 0.22, duration: 350 }), 20);
    });
    return () => {
      alive = false;
    };
  }, [edges, fitView, visibleTransfers]);

  useEffect(() => {
    const value = query.trim().toLowerCase();
    if (!value) return;
    const match = nodes.find((node) => node.id.toLowerCase().includes(value));
    if (match) {
      setSelectedNode(match.id);
      void fitView({ nodes: [match], padding: 1.2, duration: 300 });
    }
  }, [fitView, nodes, query]);

  const selectedTransfer =
    flow.find((edge) => edge.id === selectedEdge) ?? null;
  const selectedNodeTransfers = selectedNode
    ? flow.filter(
        (edge) => edge.from === selectedNode || edge.to === selectedNode,
      )
    : [];
  const selectedCall = selectedTransfer?.caused_by_call ?? null;

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      setSelectedNode(null);
      setSelectedEdge(null);
      return;
    }
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
        event.key,
      ) ||
      nodes.length === 0
    )
      return;
    event.preventDefault();
    const current = Math.max(
      0,
      nodes.findIndex((node) => node.id === selectedNode),
    );
    const direction =
      event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const next = nodes[(current + direction + nodes.length) % nodes.length];
    setSelectedNode(next.id);
    void fitView({ nodes: [next], padding: 1.2, duration: 250 });
  };

  const fullscreen = async () => {
    if (!document.fullscreenElement) await wrapper.current?.requestFullscreen();
    else await document.exitFullscreen();
  };

  const jumpToTrace = () => {
    if (!selectedCall) return;
    window.dispatchEvent(
      new CustomEvent("releeve:jump-trace", { detail: selectedCall }),
    );
  };

  return (
    <div
      className="fund-flow-experience"
      ref={wrapper}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div className="flow-toolbar">
        <div className="flow-search">
          <Search />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find an address"
            aria-label="Find an address in fund flow"
          />
        </div>
        <select
          value={asset}
          onChange={(event) => setAsset(event.target.value)}
          aria-label="Filter fund flow by asset"
        >
          <option value="all">All assets</option>
          {assets.map((value) => (
            <option value={value} key={value}>
              {value}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => fitView({ padding: 0.22, duration: 300 })}
        >
          <Crosshair /> Fit
        </button>
        <button
          type="button"
          onClick={() => void fullscreen()}
          title="Toggle fullscreen"
        >
          <Expand /> Fullscreen
        </button>
      </div>
      <div className="flow-body">
        <div className="flow-canvas">
          <ReactFlow
            nodes={nodes.map((node) => ({
              ...node,
              selected: node.id === selectedNode,
            }))}
            edges={edges}
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable
            fitView
            onNodeClick={(_, node) => {
              setSelectedNode(node.id);
              setSelectedEdge(null);
            }}
            onEdgeClick={(_, edge) => {
              setSelectedEdge(edge.id);
              setSelectedNode(null);
            }}
            onPaneClick={() => {
              setSelectedNode(null);
              setSelectedEdge(null);
            }}
          >
            <Background color="#3c3531" gap={24} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <aside
          className={selectedNode || selectedTransfer ? "open" : ""}
          aria-label="Fund flow selection details"
        >
          <button
            className="close"
            type="button"
            aria-label="Close selection details"
            onClick={() => {
              setSelectedNode(null);
              setSelectedEdge(null);
            }}
          >
            <X />
          </button>
          {selectedTransfer ? (
            <TransferDetail edge={selectedTransfer} network={network} />
          ) : selectedNode ? (
            <>
              <span className="aside-kind">{entityKind(selectedNode)}</span>
              <h3>{truncateEntity(selectedNode, 12, 9)}</h3>
              <code>{selectedNode}</code>
              <h4>Transfer steps</h4>
              {selectedNodeTransfers.map((edge) => (
                <button
                  type="button"
                  className="aside-step"
                  key={edge.id}
                  onClick={() => {
                    setSelectedEdge(edge.id);
                    setSelectedNode(null);
                  }}
                >
                  <span>#{edge.sequence + 1}</span>
                  <strong>
                    {edge.amount} {edge.asset}
                  </strong>
                  <small>
                    {truncateEntity(edge.from, 6, 4)} to{" "}
                    {truncateEntity(edge.to, 6, 4)}
                  </small>
                </button>
              ))}
            </>
          ) : null}
        </aside>
      </div>
      {(selectedNode || selectedTransfer) && (
        <div className="flow-selection">
          <span>
            {selectedTransfer
              ? `Transfer #${selectedTransfer.sequence + 1}: ${selectedTransfer.amount} ${selectedTransfer.asset}`
              : `${entityKind(selectedNode!)} selected`}
          </span>
          <div>
            {selectedCall ? (
              <button type="button" onClick={jumpToTrace}>
                Jump to trace
              </button>
            ) : (
              <span>No exact call attribution</span>
            )}
            <button
              type="button"
              onClick={() => {
                setSelectedNode(null);
                setSelectedEdge(null);
              }}
            >
              Clear
            </button>
          </div>
        </div>
      )}
      <style jsx>{`
        .fund-flow-experience {
          height: 590px;
          display: flex;
          flex-direction: column;
          outline: none;
          background: #181514;
        }
        .fund-flow-experience:fullscreen {
          height: 100vh;
        }
        .flow-toolbar {
          height: 48px;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 7px 10px;
          border-bottom: 1px solid var(--border);
          background: var(--panel);
        }
        .flow-search {
          display: flex;
          align-items: center;
          gap: 7px;
          min-width: 180px;
          max-width: 340px;
          flex: 1;
          height: 32px;
          padding: 0 9px;
          border: 1px solid var(--border);
          border-radius: 5px;
          background: var(--bg);
        }
        .flow-search :global(svg) {
          width: 13px;
          height: 13px;
          color: var(--text-faint);
        }
        .flow-search input {
          width: 100%;
          border: 0;
          outline: 0;
          background: transparent;
          color: var(--text);
          font: inherit;
          font-size: 11px;
        }
        .flow-toolbar select,
        .flow-toolbar > button {
          height: 32px;
          border: 1px solid var(--border);
          border-radius: 5px;
          background: var(--bg);
          color: var(--text-dim);
          font: inherit;
          font-size: 10.5px;
          padding: 0 9px;
        }
        .flow-toolbar > button {
          display: flex;
          align-items: center;
          gap: 5px;
          cursor: pointer;
        }
        .flow-toolbar > button :global(svg) {
          width: 12px;
          height: 12px;
        }
        .flow-body {
          min-height: 0;
          display: flex;
          flex: 1;
        }
        .flow-canvas {
          min-width: 0;
          flex: 1;
        }
        .flow-body aside {
          position: relative;
          width: 0;
          overflow: hidden;
          border-left: 0 solid var(--border);
          background: var(--panel);
          transition:
            width 0.22s ease,
            border-width 0.22s ease;
        }
        .flow-body aside.open {
          width: 285px;
          border-left-width: 1px;
          padding: 18px;
        }
        .close {
          position: absolute;
          right: 10px;
          top: 10px;
          display: grid;
          place-items: center;
          border: 0;
          background: transparent;
          color: var(--text-faint);
          cursor: pointer;
        }
        .close :global(svg) {
          width: 14px;
        }
        .aside-kind {
          color: var(--green);
          font-size: 9px;
          font-weight: 700;
          text-transform: uppercase;
        }
        .flow-body aside h3 {
          margin: 6px 22px 7px 0;
          font-size: 14px;
        }
        .flow-body aside > code {
          display: block;
          color: var(--text-faint);
          font-size: 9px;
          line-height: 1.45;
          overflow-wrap: anywhere;
        }
        .flow-body aside h4 {
          margin: 20px 0 8px;
          font-size: 11px;
        }
        .aside-step {
          display: grid;
          grid-template-columns: 25px 1fr;
          gap: 2px 7px;
          width: 100%;
          padding: 9px 0;
          border: 0;
          border-top: 1px solid var(--border);
          background: transparent;
          color: var(--text);
          text-align: left;
          cursor: pointer;
        }
        .aside-step > span {
          grid-row: 1/3;
          color: var(--text-faint);
          font-size: 9px;
        }
        .aside-step strong {
          font-size: 10.5px;
        }
        .aside-step small {
          color: var(--text-faint);
          font-size: 9px;
        }
        .flow-selection {
          min-height: 42px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 6px 12px;
          border-top: 1px solid var(--border);
          background: var(--panel);
          font-size: 10.5px;
        }
        .flow-selection > div {
          display: flex;
          align-items: center;
          gap: 7px;
          color: var(--text-faint);
        }
        .flow-selection button {
          height: 27px;
          border: 1px solid var(--border);
          border-radius: 4px;
          background: var(--bg);
          color: var(--text);
          font: inherit;
          font-size: 9px;
          padding: 0 8px;
          cursor: pointer;
        }
        .fund-flow-experience :global(.react-flow__controls) {
          background: #262221;
          border: 1px solid #4a423c;
          box-shadow: none;
        }
        .fund-flow-experience :global(.react-flow__controls-button) {
          background: #262221;
          border-color: #4a423c;
          fill: #d1cac5;
        }
        .fund-flow-experience :global(.flow-node-label) {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          padding: 4px 7px;
        }
        .fund-flow-experience :global(.flow-node-label span) {
          color: #918985;
          font-size: 9px;
          text-transform: uppercase;
        }
        .fund-flow-experience :global(.flow-node-label strong) {
          margin-top: 4px;
          font:
            600 11px ui-monospace,
            monospace;
        }
        @media (max-width: 720px) {
          .flow-toolbar {
            height: auto;
            flex-wrap: wrap;
          }
          .flow-search {
            max-width: none;
            flex-basis: 100%;
          }
          .flow-toolbar > button span {
            display: none;
          }
          .flow-body aside.open {
            position: absolute;
            right: 0;
            top: 49px;
            bottom: 42px;
            z-index: 10;
            width: min(285px, 88vw);
          }
          .fund-flow-experience {
            height: 540px;
          }
        }
      `}</style>
    </div>
  );
}

function TransferDetail({ edge }: { edge: TxFundFlowEdge; network: string }) {
  return (
    <>
      <span className="aside-kind">Transfer #{edge.sequence + 1}</span>
      <h3>
        {edge.amount} {edge.asset}
      </h3>
      <code>{edge.from}</code>
      <div style={{ color: "#817a76", margin: "9px 0", fontSize: 10 }}>to</div>
      <code>{edge.to}</code>
      <h4>Decoded data</h4>
      <pre>
        {JSON.stringify(
          {
            asset_type: edge.asset_type,
            usd_value: edge.usd_value,
            caused_by_call: edge.caused_by_call,
          },
          null,
          2,
        )}
      </pre>
    </>
  );
}

export function FundFlowGraph({
  tx,
  network,
}: {
  tx: ExplorerTxDetail;
  network: string;
}) {
  if (!tx.fund_flow.length && !tx.call_tree.length)
    return (
      <div className="rx-empty">
        No asset transfer or contract invocation was decoded for this transaction.
      </div>
    );
  return (
    <ReactFlowProvider>
      <GraphCanvas tx={tx} network={network} />
    </ReactFlowProvider>
  );
}
