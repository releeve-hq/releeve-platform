import Link from "next/link";
import {
  ArrowRight,
  BellRing,
  Blocks,
  Braces,
  Check,
  CircleGauge,
  Code2,
  Database,
  GitBranch,
  GitCompareArrows,
  KeyRound,
  Network,
  Play,
  Radar,
  ScanSearch,
  ShieldCheck,
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

const platformWords = ["simulations", "environments", "contracts", "alerts", "releases", "teams"];

export function LandingPage() {
  return (
    <>
      <section className="marketing-hero marketing-frame">
        <div className="marketing-hero-copy">
          <p className="marketing-eyebrow"><span /> State-fork execution for Soroban</p>
          <h1>Simulation and Observability <mark>infrastructure</mark> on <mark>Stellar.</mark></h1>
          <div className="marketing-hero-support">
            <p>Releeve give teams the ability to model and observe every onchain scenario and action against the conditions they will actually face, before real money is on the line.</p>
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
            <p>Releeve lets teams simulate onchain actions using the same evidence they use to investigate real activity.</p>
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
          title="Know the outcome before execution."
          body="Fork real state, create the conditions you care about, impersonate accounts safely, and replay Soroban invocations without any hassle. See the result before users, funds, or production systems have to."
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
            body="A Virtual Environment gives your team a controlled version of Stellar where you can keep building, testing, breaking, resetting, and testing again."
            points={["Named environments from mainnet, testnet, or futurenet state."
, "Persisted overrides and simulation history", "Synchronize untouched state while keeping the state your scenario intentionally changed."]}
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
          body="Releeve gives engineers, reviewers, and operators a shared workspace around the accounts, contracts, environments, simulations, and alerts that matter to your system."
          points={["Keep sensitive simulations, environments, tracked entities, and operational evidence inside your organization.", "Shared labels so every organization speaks the same language across important entities", "Real-time notifications that connect alerts, decoded evidence, and follow-up work"]}
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
            body="Compose monitoring rules around the entities and behaviors that matter, from failed invocations and missing oracle updates to contract storage changes and broken invariants.  Releeve watches Stellar for it continuously and delivers the surrounding execution context when the condition is met."
            points={["Targets: address, network, project, or tag", "Composable expressions with all/any match logic", "Email, Slack, Telegram, Discord, Sentry, PagerDuty, and signed webhooks"]}
            link="/docs/monitoring"
            linkLabel="Read monitoring guide"
          />
        </div>
      </section>

      <section className="platform-section">
        <div className="platform-shell">
          <div className="platform-header">
            <h2>One platform to power your <span className="platform-rotator">
              {platformWords.map((word) => <span aria-hidden="true" className="platform-rotator-reserve" key={`${word}-reserve`}>{word}</span>)}
              <span aria-hidden="true" className="platform-rotator-list">
                {platformWords.map((word) => <span key={word}>{word}</span>)}
                <span>{platformWords[0]}</span>
              </span>
            </span></h2>
            <p>Project-scoped, permission-aware, and available through the same API Releeve uses.</p>
            <div className="platform-actions">
              <Link className="platform-button platform-button-primary" href="/signup">Create account <ArrowRight size={15} /></Link>
              <Link className="platform-button platform-button-secondary" href="/docs">View docs</Link>
            </div>
          </div>
          <div className="platform-cards">
            <div className="platform-row platform-row-a">
              <PlatformCard title="Simulation API" desc="Replay a Soroban invocation against a real ledger snapshot with overrides and impersonation — the same evidence in review and in CI." href="/docs/simulations">
                <div className="platform-visual platform-visual-code">
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
                </div>
              </PlatformCard>
              <PlatformCard title="Webhooks" desc="Validate HMAC-signed payloads and inspect every delivery attempt." href="/docs/monitoring">
                <div className="platform-visual"><div className="platform-viz">
                  <span className="viz-dot" />
                  <i className="viz-line" />
                  <span className="viz-icon"><Webhook size={22} /></span>
                  <i className="viz-line" />
                  <span className="viz-dot viz-dot-signal" />
                </div></div>
              </PlatformCard>
            </div>
            <div className="platform-row platform-row-b">
              <PlatformCard title="Virtual environments" desc="Frozen snapshots, follow-latest sync, branching, and non-destructive rollback." href="/docs/virtual-environments">
                <div className="platform-visual"><div className="platform-viz platform-viz-stack">
                  <span className="viz-icon"><GitBranch size={22} /></span>
                  <div className="viz-layers"><span className="viz-layer" /><span className="viz-layer" /><span className="viz-layer" /></div>
                </div></div>
              </PlatformCard>
              <PlatformCard title="Access tokens" desc="Issue API credentials per organization and use them in local tools or CI." href="/docs/api-reference">
                <div className="platform-visual"><div className="platform-viz">
                  <span className="viz-icon"><KeyRound size={22} /></span>
                  <span className="viz-pill" />
                  <span className="viz-pill viz-pill-short" />
                </div></div>
              </PlatformCard>
            </div>
            <div className="platform-row platform-row-c">
              <PlatformCard title="Project permissions" desc="Gate simulation, member, token, project, and billing operations independently." href="/docs">
                <div className="platform-visual"><div className="platform-viz">
                  <span className="viz-icon"><ShieldCheck size={22} /></span>
                  <div className="viz-grid">
                    <span className="viz-check"><Check size={14} /></span>
                    <span className="viz-check"><Check size={14} /></span>
                    <span className="viz-check"><Check size={14} /></span>
                    <span className="viz-check"><Check size={14} /></span>
                  </div>
                </div></div>
              </PlatformCard>
              <PlatformCard title="Shared evidence" desc="Render real transactions and simulated runs through the same investigation model." href="/explorer/testnet">
                <div className="platform-visual"><div className="platform-viz platform-viz-traces">
                  <span className="viz-trace"><b /><i /></span>
                  <span className="viz-trace"><b /><i /></span>
                  <span className="viz-trace"><b /><i /></span>
                </div></div>
              </PlatformCard>
              <PlatformCard title="Alerts" desc="Compose monitoring rules and deliver signed notifications to your tools." href="/docs/monitoring">
                <div className="platform-visual"><div className="platform-viz">
                  <span className="viz-icon"><BellRing size={22} /></span>
                  <div className="viz-pulse"><i /><i /><i /></div>
                </div></div>
              </PlatformCard>
            </div>
          </div>
        </div>
      </section>

      <section className="scenario-section marketing-section-band">
        <div className="marketing-frame">
          <div className="marketing-section-heading">
            <h2>Make the risky scenario testable.</h2>
          </div>
          <div className="scenario-grid">
            {scenarios.map((scenario) => <div className="scenario-item" key={scenario.title}><scenario.icon size={18} /><h3>{scenario.title}</h3><p>{scenario.body}</p></div>)}
          </div>
        </div>
      </section>

      <section className="pricing-teaser marketing-frame">
        <div><h2>Start with the full workflow, then grow into the plan your team needs.</h2></div>
        <div><p>Preview access gives teams room to evaluate simulations, explorer workflows, monitoring, and environments before final plan packaging is published.</p><Link href="/pricing">Compare planned tiers <ArrowRight size={14} /></Link></div>
      </section>

      <section className="marketing-final-cta marketing-frame">
        <div>
          <p>Build against the state that actually exists.</p>
          <h2>Production state should be a test input, not a surprise.</h2>
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

function PlatformCard({ title, desc, href, children }: { title: string; desc: string; href: string; children: React.ReactNode }) {
  return (
    <Link className="platform-card" href={href}>
      <div className="platform-card-head">
        <div className="platform-card-title"><h3>{title}</h3><ArrowRight className="platform-card-arrow" size={16} /></div>
        <p>{desc}</p>
      </div>
      {children}
    </Link>
  );
}
