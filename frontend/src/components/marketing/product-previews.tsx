"use client";

import {
  Activity,
  Bell,
  Blocks,
  Check,
  ChevronRight,
  Clock3,
  Database,
  GitBranch,
  Layers3,
  Play,
  Radar,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  TerminalSquare,
  UserRound,
  Webhook,
  Zap,
} from "lucide-react";
import { useState } from "react";

type ResultTab = "calls" | "state" | "events" | "resources";

const resultTabs: ResultTab[] = ["calls", "state", "events", "resources"];

export function HeroSimulationPreview() {
  const [forked, setForked] = useState(true);
  const [tab, setTab] = useState<ResultTab>("calls");

  return (
    <div className="product-window hero-product-window" aria-label="Example simulation preview">
      <div className="product-window-bar">
        <div className="product-window-title"><TerminalSquare size={15} /> Whale deposit stress test</div>
        <span className="product-example-label">Example simulation</span>
      </div>
      <div className="simulation-toolbar">
        <div className="marketing-segmented" aria-label="Simulation state">
          <button type="button" data-active={!forked} onClick={() => setForked(false)}>Original</button>
          <button type="button" data-active={forked} onClick={() => setForked(true)}>Forked</button>
        </div>
        <div className="simulation-ledger"><Database size={14} /> Mainnet ledger 58,743,921</div>
        <button className="simulation-run" type="button" onClick={() => setForked(true)}><Play size={13} fill="currentColor" /> Run</button>
      </div>

      <div className="simulation-layout">
        <div className="simulation-overrides">
          <div className="product-pane-heading"><SlidersHorizontal size={14} /> Scenario overrides</div>
          <Override icon={<UserRound size={14} />} label="Impersonate" value="GDX4...WHALE" active={forked} />
          <Override icon={<Layers3 size={14} />} label="USDC balance" value={forked ? "25,000,000" : "12,420"} active={forked} />
          <Override icon={<Clock3 size={14} />} label="Ledger time" value={forked ? "+30 days" : "Unchanged"} active={forked} />
          <div className="simulation-note"><ShieldCheck size={14} /> No keys or funds are used.</div>
        </div>

        <div className="simulation-results">
          <div className="simulation-result-head">
            <div><span className="status-dot status-success" /> Success</div>
            <span>186 ms</span>
          </div>
          <div className="product-tabs" role="tablist" aria-label="Simulation output">
            {resultTabs.map((item) => (
              <button
                role="tab"
                aria-selected={tab === item}
                type="button"
                key={item}
                data-active={tab === item}
                onClick={() => setTab(item)}
              >
                {item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>
          <div className="simulation-output" role="tabpanel">
            {tab === "calls" && <CallTree />}
            {tab === "state" && <StateDiff forked={forked} />}
            {tab === "events" && <EventList />}
            {tab === "resources" && <ResourceList forked={forked} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Override({ icon, label, value, active }: { icon: React.ReactNode; label: string; value: string; active: boolean }) {
  return (
    <div className="override-row" data-active={active}>
      <span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div>
      {active && <Check size={13} />}
    </div>
  );
}

function CallTree() {
  return (
    <div className="call-tree">
      <Call depth={0} name="blend_pool.deposit" contract="CBZV...POOL" resource="42%" />
      <Call depth={1} name="token.transfer" contract="CCW6...USDC" resource="18%" />
      <Call depth={1} name="b_token.mint" contract="CDL4...BTKN" resource="12%" />
      <Call depth={2} name="positions.update" contract="CBZV...POOL" resource="8%" />
    </div>
  );
}

function Call({ depth, name, contract, resource }: { depth: number; name: string; contract: string; resource: string }) {
  return (
    <div className="call-row" data-depth={depth}>
      <span className="call-branch"><GitBranch size={13} /></span>
      <div><strong>{name}</strong><small>{contract}</small></div><span>{resource}</span>
    </div>
  );
}

function StateDiff({ forked }: { forked: boolean }) {
  return (
    <div className="state-diff">
      <div><small>ledger key</small><code>Positions[GDX4...WHALE]</code></div>
      <div className="diff-values"><span>- collateral: 12,420</span><span>+ collateral: {forked ? "25,000,000" : "12,420"}</span></div>
      <div><small>ledger key</small><code>TotalSupply[USDC]</code></div>
      <div className="diff-values"><span>- 91,204,110</span><span>+ {forked ? "116,191,690" : "91,204,110"}</span></div>
    </div>
  );
}

function EventList() {
  return (
    <div className="event-list">
      <Event name="transfer" contract="CCW6...USDC" value="25,000,000 USDC" />
      <Event name="deposit" contract="CBZV...POOL" value="shares: 24,987,580" />
      <Event name="mint" contract="CDL4...BTKN" value="to: GDX4...WHALE" />
    </div>
  );
}

function Event({ name, contract, value }: { name: string; contract: string; value: string }) {
  return <div className="event-row"><span><Zap size={13} /></span><div><strong>{name}</strong><small>{contract}</small></div><code>{value}</code></div>;
}

function ResourceList({ forked }: { forked: boolean }) {
  const rows = [
    ["CPU instructions", forked ? "68%" : "34%"],
    ["Memory bytes", forked ? "41%" : "29%"],
    ["Ledger reads", forked ? "56%" : "38%"],
    ["Write bytes", forked ? "72%" : "31%"],
  ];
  return <div className="resource-list">{rows.map(([label, value]) => <div key={label}><span>{label}</span><i><b style={{ width: value }} /></i><strong>{value}</strong></div>)}</div>;
}

export function EnvironmentPreview() {
  return (
    <div className="product-window environment-window">
      <div className="product-window-bar"><div className="product-window-title"><Blocks size={15} /> Checkout regression</div><span className="product-status"><i /> Synced</span></div>
      <div className="environment-stats">
        <Metric label="Base ledger" value="58,743,921" />
        <Metric label="Overrides" value="4" />
        <Metric label="Simulations" value="18" />
        <Metric label="Protocol" value="23" />
      </div>
      <div className="environment-body">
        <div className="environment-timeline">
          <EnvironmentEvent icon={<Database size={14} />} title="Snapshot created" detail="Mainnet ledger 58,743,921" />
          <EnvironmentEvent icon={<SlidersHorizontal size={14} />} title="Balance override" detail="GDX4...WHALE / USDC" />
          <EnvironmentEvent icon={<Clock3 size={14} />} title="Time advanced" detail="30 days after snapshot" />
          <EnvironmentEvent icon={<RotateCcw size={14} />} title="Rollback point" detail="State preserved at run 12" />
        </div>
        <div className="environment-runs">
          <div className="product-pane-heading">Recent runs</div>
          <Run label="deposit" status="Success" ledger="58,743,921" />
          <Run label="withdraw" status="Success" ledger="58,743,925" />
          <Run label="liquidate" status="Resource limit" ledger="58,743,928" failed />
          <Run label="set_reserve" status="Success" ledger="58,743,932" />
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="product-metric"><small>{label}</small><strong>{value}</strong></div>;
}

function EnvironmentEvent({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return <div className="environment-event"><span>{icon}</span><div><strong>{title}</strong><small>{detail}</small></div></div>;
}

function Run({ label, status, ledger, failed = false }: { label: string; status: string; ledger: string; failed?: boolean }) {
  return <div className="run-row"><code>{label}</code><span data-failed={failed}>{status}</span><small>{ledger}</small><ChevronRight size={14} /></div>;
}

export function ExplorerPreview() {
  return (
    <div className="product-window explorer-preview-window">
      <div className="product-window-bar"><div className="product-window-title"><Activity size={15} /> Transaction</div><span className="product-status"><i /> Successful</span></div>
      <div className="explorer-summary">
        <div><small>Hash</small><code>14d92f...a8c1</code></div><div><small>Ledger</small><strong>58,743,921</strong></div><div><small>Operation</small><strong>Invoke host function</strong></div>
      </div>
      <div className="explorer-preview-body">
        <div className="fund-flow">
          <div className="fund-node"><span>GDX4</span><small>Whale account</small></div>
          <div className="fund-edge"><b>25M USDC</b><i /></div>
          <div className="fund-node"><span>CBZV</span><small>Blend pool</small></div>
        </div>
        <div className="resource-card">
          <div className="product-pane-heading">Resource budget</div>
          <ResourceList forked />
        </div>
      </div>
    </div>
  );
}

export function MonitoringPreview() {
  return (
    <div className="product-window monitoring-window">
      <div className="product-window-bar"><div className="product-window-title"><Bell size={15} /> Failed checkout invocation</div><span className="product-status"><i /> Enabled</span></div>
      <div className="monitor-flow">
        <MonitorBlock icon={<Radar size={16} />} eyebrow="Target" title="Checkout contract" detail="CDT6...SHOP" />
        <ChevronRight size={17} />
        <MonitorBlock icon={<GitBranch size={16} />} eyebrow="Conditions" title="Failure + function call" detail="Match all" />
        <ChevronRight size={17} />
        <MonitorBlock icon={<Webhook size={16} />} eyebrow="Destinations" title="Slack + webhook" detail="Signed delivery" />
      </div>
      <div className="firing-list">
        <div className="product-pane-heading">Recent firings</div>
        <Firing time="14:32:18" name="checkout" result="tx_error: HostError" />
        <Firing time="12:08:04" name="checkout" result="resource limit exceeded" />
        <Firing time="09:41:52" name="set_price" result="no action for 15m" warning />
      </div>
    </div>
  );
}

function MonitorBlock({ icon, eyebrow, title, detail }: { icon: React.ReactNode; eyebrow: string; title: string; detail: string }) {
  return <div className="monitor-block"><span>{icon}</span><small>{eyebrow}</small><strong>{title}</strong><code>{detail}</code></div>;
}

function Firing({ time, name, result, warning = false }: { time: string; name: string; result: string; warning?: boolean }) {
  return <div className="firing-row"><code>{time}</code><strong>{name}</strong><span data-warning={warning}>{result}</span><ChevronRight size={14} /></div>;
}
