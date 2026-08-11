import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BellRing,
  Blocks,
  Braces,
  Check,
  CircleGauge,
  Clock3,
  Code2,
  Database,
  GitCompareArrows,
  KeyRound,
  Network,
  Play,
  Radar,
  ScanSearch,
  ShieldCheck,
  SlidersHorizontal,
  TerminalSquare,
  UserRound,
  Webhook,
} from "lucide-react";
import { EnvironmentPreview, ExplorerPreview, HeroSimulationPreview, MonitoringPreview } from "./product-previews";

const foundation = [
  { icon: Network, label: "Stellar native" },
  { icon: Code2, label: "Soroban aware" },
  { icon: Database, label: "Real ledger state" },
  { icon: CircleGauge, label: "Deterministic metering" },
];

const scenarios = [
  { icon: GitCompareArrows, title: "Protocol upgrades", body: "Replay calls against the new WASM and inspect every changed ledger entry before switching production code." },
  { icon: Database, title: "Whale-scale balances", body: "Replace toy fixtures with production-shaped positions and expose resource limits before real capital finds them." },
  { icon: UserRound, title: "Authorization paths", body: "Exercise signer-specific branches without collecting keys or moving funds." },
  { icon: CircleGauge, title: "Resource ceilings", body: "See CPU, memory, reads, and writes as a percentage of the actual Soroban budget." },
  { icon: BellRing, title: "Incident monitoring", body: "Turn failed calls, missing oracle updates, and state changes into routed team notifications." },
];

export function LandingPage() {
  return (
    <>
      <section className="marketing-hero marketing-frame">
        <div className="marketing-hero-copy">
          <p className="marketing-eyebrow"><span /> State-fork execution for Soroban</p>
          <h1>Simulation infrastructure for <mark>Stellar developers.</mark></h1>
          <div className="marketing-hero-support">
            <p>Fork real ledger state, override balances, storage, signers, and time, then replay Soroban transactions with exact calls, events, state diffs, and resource usage before you ship.</p>
            <div className="marketing-hero-actions">
              <Link className="marketing-button marketing-button-primary" href="/signup">Create account <ArrowRight size={15} /></Link>
              <Link className="marketing-button marketing-button-secondary" href="/explorer/testnet">Explore testnet</Link>
            </div>
          </div>
        </div>
        <HeroSimulationPreview />
      </section>

      <section className="foundation-rail" aria-label="Technical foundations">
        <div className="foundation-strip marketing-frame">
          {foundation.map((item) => <div key={item.label}><item.icon size={17} /><span>{item.label}</span></div>)}
        </div>
      </section>

      <section className="marketing-statement marketing-frame">
        <p className="marketing-section-index">01 / THE PROBLEM</p>
        <div>
          <h2>Synthetic fixtures hide the failures that production state creates.</h2>
          <p>Soroban teams should not have to rebuild complex protocol state by hand, borrow private keys, or discover resource ceilings after deployment. Releeve turns a real ledger snapshot into a controlled test surface.</p>
        </div>
      </section>

      <section className="marketing-suite marketing-section-band">
        <div className="marketing-frame">
          <div className="marketing-section-heading centered">
            <p className="marketing-eyebrow"><span /> One operating surface</p>
            <h2>Simulate the change. Inspect the effect. Monitor what ships.</h2>
            <p>Releeve connects hypothetical execution to the same decoded evidence teams use to investigate real network activity.</p>
          </div>
          <div className="suite-grid">
            <SuiteItem number="01" icon={<Play size={18} />} title="Simulate" body="Replay a Soroban invocation on forked state with controlled overrides and signer impersonation." href="#simulation" />
            <SuiteItem number="02" icon={<ScanSearch size={18} />} title="Coordinate" body="Give engineers, reviewers, and operators one shared context for accounts, contracts, simulations, and alerts." href="#explorer" />
            <SuiteItem number="03" icon={<BellRing size={18} />} title="Monitor" body="Match real calls and state transitions, then deliver signed notifications to the tools your team uses." href="#monitoring" />
          </div>
        </div>
      </section>

      <section id="simulation" className="marketing-feature marketing-frame">
        <FeatureCopy
          index="02 / SIMULATION"
          icon={<TerminalSquare size={17} />}
          title="Change the state, not your test suite."
          body="Begin at a specific mainnet or testnet ledger. Apply only the hypothetical conditions you need, then execute through the real Soroban host and preserve the evidence."
          points={["Balance, contract storage, TTL, ledger, and timestamp overrides", "Scoped account impersonation without secret keys", "Calls, events, state changes, return values, and structured failures"]}
          link="/docs/simulations"
          linkLabel="Read simulation guide"
        />
        <HeroSimulationPreview />
      </section>

      <section id="environments" className="marketing-feature marketing-feature-reverse marketing-section-band">
        <div className="marketing-frame marketing-feature-inner">
          <EnvironmentPreview />
          <FeatureCopy
            index="03 / VIRTUAL ENVIRONMENTS"
            icon={<Blocks size={17} />}
            title="Keep a controlled version of the network."
            body="Create a named environment from a real ledger, preserve manual overrides, synchronize untouched state, and return to known rollback points as your protocol evolves."
            points={["Named mainnet, testnet, and futurenet snapshots", "Persisted overrides and simulation history", "Continuous sync controls and explicit rollback points"]}
            link="/docs/virtual-environments"
            linkLabel="Explore environments"
          />
        </div>
      </section>

      <section id="explorer" className="marketing-feature marketing-frame">
        <FeatureCopy
          index="04 / TEAM CONTEXT"
          icon={<Radar size={17} />}
          title="Keep every team on the same page."
          body="Work in secure shared environments where issues can be reproduced, tested, discussed, and resolved without touching production state."
          points={["Private investigation spaces for simulations, tracked contracts, accounts, and assets", "Shared labels so every organization speaks the same language across important entities", "Real-time notifications that connect alerts, decoded evidence, and follow-up work"]}
          link="/explorer/testnet"
          linkLabel="Explore shared context"
        />
        <ExplorerPreview />
      </section>

      <section id="monitoring" className="marketing-feature marketing-feature-reverse marketing-section-band">
        <div className="marketing-frame marketing-feature-inner">
          <MonitoringPreview />
          <FeatureCopy
            index="05 / MONITORING"
            icon={<BellRing size={17} />}
            title="Define the condition once. Know when it happens."
            body="Compose monitoring rules around the entities and behavior that matter, from failed invocations to missing oracle activity and specific contract storage changes."
            points={["Targets: address, network, project, or tag", "Composable expressions with all/any match logic", "Email, Slack, Telegram, Discord, Sentry, PagerDuty, and signed webhooks"]}
            link="/docs/monitoring"
            linkLabel="Read monitoring guide"
          />
        </div>
      </section>

      <section className="workflow-section marketing-frame">
        <div className="marketing-section-heading">
          <p className="marketing-section-index">06 / DEVELOPER WORKFLOW</p>
          <h2>Use the interface in review. Use the API in CI.</h2>
          <p>Everything important is project-scoped, permission-aware, and available through the same API surface used by the Releeve application.</p>
        </div>
        <div className="workflow-grid">
          <div className="code-window">
            <div className="product-window-bar"><div className="product-window-title"><Braces size={15} /> simulate.sh</div><span>curl</span></div>
            <pre><code>{`curl -X POST "$RELEEVE_API/api/v1/acme/checkout/simulations" \\
  -H "Authorization: Bearer $RELEEVE_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "contract_id": "CBZV...POOL",
    "function_name": "deposit",
    "args": ["GDX4...WHALE", "25000000"],
    "impersonate": ["GDX4...WHALE"]
  }'`}</code></pre>
          </div>
          <div className="workflow-capabilities">
            <WorkflowItem icon={<KeyRound size={17} />} title="Scoped access tokens" body="Issue API credentials per organization and use them in local tools or CI." />
            <WorkflowItem icon={<Webhook size={17} />} title="Verifiable webhooks" body="Validate HMAC-signed payloads and inspect each delivery attempt." />
            <WorkflowItem icon={<ShieldCheck size={17} />} title="Project permissions" body="Gate simulation, member, token, project, and billing operations independently." />
            <WorkflowItem icon={<Activity size={17} />} title="Shared evidence shape" body="Render real transactions and simulated runs through the same investigation model." />
          </div>
        </div>
      </section>

      <section className="scenario-section marketing-section-band">
        <div className="marketing-frame">
          <div className="marketing-section-heading">
            <p className="marketing-section-index">07 / PRODUCT EVIDENCE</p>
            <h2>Make the risky scenario testable.</h2>
          </div>
          <div className="scenario-grid">
            {scenarios.map((scenario) => <div className="scenario-item" key={scenario.title}><scenario.icon size={18} /><h3>{scenario.title}</h3><p>{scenario.body}</p></div>)}
          </div>
        </div>
      </section>

      <section className="pricing-teaser marketing-frame">
        <div><p className="marketing-eyebrow"><span /> Free during preview</p><h2>Start with the full workflow, then grow into the plan your team needs.</h2></div>
        <div><p>Preview access gives teams room to evaluate simulations, explorer workflows, monitoring, and environments before final plan packaging is published.</p><Link href="/pricing">Compare planned tiers <ArrowRight size={14} /></Link></div>
      </section>

      <section className="marketing-final-cta marketing-frame">
        <div>
          <p>Build against the state that actually exists.</p>
          <h2>Test the transaction before mainnet does.</h2>
        </div>
        <div className="marketing-final-actions">
          <Link className="marketing-button marketing-button-ink" href="/signup">Create account <ArrowRight size={15} /></Link>
          <Link className="marketing-button marketing-button-signal-outline" href="/docs/quickstart">Read the quickstart</Link>
        </div>
      </section>
    </>
  );
}

function SuiteItem({ number, icon, title, body, href }: { number: string; icon: React.ReactNode; title: string; body: string; href: string }) {
  return <Link className="suite-item" href={href}><span className="suite-number">{number}</span><span className="suite-icon">{icon}</span><h3>{title}</h3><p>{body}</p><ArrowRight className="suite-arrow" size={16} /></Link>;
}

function FeatureCopy({ index, icon, title, body, points, link, linkLabel }: { index: string; icon: React.ReactNode; title: string; body: string; points: string[]; link: string; linkLabel: string }) {
  return (
    <div className="feature-copy">
      <p className="marketing-section-index">{index}</p>
      <span className="feature-icon">{icon}</span>
      <h2>{title}</h2>
      <p>{body}</p>
      <ul>{points.map((point) => <li key={point}><Check size={14} />{point}</li>)}</ul>
      <Link href={link}>{linkLabel} <ArrowRight size={14} /></Link>
    </div>
  );
}

function WorkflowItem({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return <div className="workflow-item"><span>{icon}</span><div><h3>{title}</h3><p>{body}</p></div></div>;
}
