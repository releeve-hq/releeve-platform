import type { CSSProperties } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Blocks,
  Braces,
  Check,
  CircleGauge,
  Clock3,
  Code2,
  Database,
  Network,
  SlidersHorizontal,
  UserRound,
  Wallet,
} from "lucide-react";
import { EnvironmentPreview, ExplorerPreview, HeroVirtualNetworkPreview, MonitoringPreview } from "./product-previews";

const foundation = [
  { icon: Network, label: "Stellar native" },
  { icon: Code2, label: "Soroban aware" },
  { icon: Database, label: "Real ledger state" },
  { icon: CircleGauge, label: "Deterministic metering" },
];

const scenarios = [
  { title: "AMMs", body: "Rehearse swaps and liquidity changes against real pool reserves before upgrading the WASM or routing user funds.", accent: "var(--m-signal)", scene: <ProtocolScene /> },
  { title: "Lending protocols", body: "Replay whale-scale deposits and liquidation paths against real collateral before production scale finds your limits.", accent: "var(--m-blue)", scene: <WhaleScene /> },
  { title: "Payments & stablecoins", body: "Verify authorization paths and compliance checks with impersonated signers — no keys collected, no funds moved.", accent: "var(--m-amber)", scene: <AuthScene /> },
  { title: "Oracles & data feeds", body: "Confirm a new feed WASM fits the Soroban resource budget before it goes live, then watch it in production.", accent: "var(--m-red)", scene: <MeterScene /> },
  { title: "Bridges & settlement", body: "Reproduce a failure on forked state and route the surrounding evidence to your team the moment a real one surfaces.", accent: "color-mix(in srgb, var(--m-blue) 45%, var(--m-signal))", scene: <AlertScene /> },
];

const suiteOverrides = [
  { icon: Wallet, label: "Balance", tint: "var(--m-signal)" },
  { icon: Database, label: "Storage", tint: "var(--m-blue)" },
  { icon: Clock3, label: "TTL", tint: "var(--m-amber)" },
  { icon: Blocks, label: "Ledger", tint: "var(--m-red)" },
  { icon: SlidersHorizontal, label: "Timestamp", tint: "var(--m-signal)" },
  { icon: UserRound, label: "Impersonate", tint: "var(--m-blue)" },
];

const suiteContextLines = [
  { n: 1, parts: [<span key="1">{"{"}</span>] },
  { n: 2, parts: [<span key="0">{"  "}<span className="suite-key">{"\"contract\""}</span>{": "}<span className="suite-str">{"\"C7KQ…POOL\""}</span>{","}</span>] },
  { n: 3, parts: [<span key="0">{"  "}<span className="suite-key">{"\"tags\""}</span>{": [ "}<span className="suite-str">{"\"treasury\""}</span>{", "}<span className="suite-str">{"\"amm\""}</span>{" ],"}</span>] },
  { n: 4, parts: [<span key="0">{"  "}<span className="suite-key">{"\"watchers\""}</span>{": [ "}<span className="suite-str">{"\"eng\""}</span>{", "}<span className="suite-str">{"\"review\""}</span>{" ],"}</span>] },
  { n: 5, parts: [<span key="0">{"  "}<span className="suite-key">{"\"alert\""}</span>{": "}<span className="suite-str">{"\"failed_call\""}</span></span>] },
  { n: 6, parts: [<span key="0">{"}"}</span>] },
];

const suiteAlertRows = [
  { name: "failed-call", status: "Armed", tone: "var(--m-signal)" },
  { name: "oracle-stale", status: "Firing", tone: "var(--m-amber)" },
  { name: "storage-diff", status: "Armed", tone: "var(--m-signal)" },
  { name: "whale-move", status: "Armed", tone: "var(--m-blue)" },
];

const platformWords = ["networks", "contracts", "alerts", "releases", "teams", "operations"];

export function LandingPage() {
  return (
    <>
      <section className="marketing-hero marketing-frame">
        <div className="marketing-hero-copy">
          <h1>Stellar Operations Platform</h1>
          <div className="marketing-hero-support">
            <p>Releeve gives teams the ability to model and observe every onchain scenario and action against the conditions they will actually face in a live network, before real money is on the line.</p>
            <div className="marketing-hero-actions">
              <Link className="marketing-button marketing-button-contrast" href="/signup">Talk to us <ArrowRight size={15} /></Link>
            </div>
          </div>
        </div>
        <HeroVirtualNetworkPreview />
      </section>

      <section className="foundation-rail" aria-label="Technical foundations">
        <div className="foundation-strip marketing-frame">
          {foundation.map((item) => <div key={item.label}><item.icon size={17} /><span>{item.label}</span></div>)}
        </div>
      </section>

      <section className="marketing-suite marketing-section-band">
        <div className="marketing-frame">
          <div className="marketing-section-heading centered">
            <h2>Fork the network. Shape the conditions. Monitor what ships.</h2>
            <p>Build persistent virtual networks from real Stellar state, then use the same evidence to understand every replay and production event.</p>
          </div>
          <div className="suite-grid">
            <article className="suite-card">
              <div className="suite-copy">
                <span className="suite-badge">1</span>
                <h3>Create the conditions</h3>
                <p>Create a virtual network from real ledger state, then control balances, storage, TTL, ledger time, and account identity.</p>
              </div>
              <div className="suite-illustration">
                <div className="suite-chips">
                  {suiteOverrides.map((override) => (
                    <div className="suite-chip" key={override.label}>
                      <span className="suite-chip-icon" style={{ background: `color-mix(in srgb, ${override.tint} 14%, transparent)`, color: override.tint }}>
                        <override.icon size={14} />
                      </span>
                      <span className="suite-chip-label">{override.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </article>

            <article className="suite-card">
              <div className="suite-copy">
                <span className="suite-badge">2</span>
                <h3>Coordinate</h3>
                <p>Give engineers, reviewers, and operators one shared context for accounts, contracts, virtual networks, and alerts.</p>
              </div>
              <div className="suite-illustration suite-stack">
                <div className="suite-entity">
                  <Braces size={18} />
                  <div>
                    <small>Tracked contract</small>
                    <strong>amm-pool</strong>
                  </div>
                  <span className="suite-entity-badge">✓ Tracked</span>
                </div>
                <div className="suite-window">
                  <div className="suite-window-bar">
                    <i className="suite-dot suite-dot-red" />
                    <i className="suite-dot suite-dot-amber" />
                    <i className="suite-dot suite-dot-green" />
                    <span>context.json</span>
                  </div>
                  <div className="suite-code">
                    {suiteContextLines.map((line) => (
                      <div className="suite-code-line" key={line.n}>
                        <span className="suite-code-num">{line.n}</span>
                        {line.parts}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </article>

            <article className="suite-card">
              <div className="suite-copy">
                <span className="suite-badge">3</span>
                <h3>Monitor</h3>
                <p>Match real calls and state transitions, then deliver signed notifications to the tools your team uses.</p>
              </div>
              <div className="suite-illustration">
                <div className="suite-board">
                  <div className="suite-board-head">
                    <span className="suite-board-title">Alert rules</span>
                    <span className="suite-board-dots"><i /><i /><i /></span>
                  </div>
                  {suiteAlertRows.map((row) => (
                    <div className="suite-row" key={row.name}>
                      <span className="suite-row-dot" style={{ background: row.tone }} />
                      <span className="suite-row-name">{row.name}</span>
                      <span className="suite-graph" />
                      <span className="suite-row-status" data-live={row.status === "Firing"}>{row.status}</span>
                    </div>
                  ))}
                </div>
                <svg className="suite-wave" width="100%" height="36" viewBox="0 0 260 36" aria-hidden="true">
                  <defs>
                    <linearGradient id="suite-wave-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="var(--m-signal)" stopOpacity="0.3" />
                      <stop offset="50%" stopColor="var(--m-signal)" stopOpacity="0.8" />
                      <stop offset="100%" stopColor="var(--m-signal)" stopOpacity="0.3" />
                    </linearGradient>
                  </defs>
                  <path d="M 35 18 Q 65 6, 95 18 T 165 18 T 235 18" fill="none" stroke="url(#suite-wave-grad)" strokeWidth="2" />
                  <circle cx="35" cy="18" r="3.5" fill="var(--m-signal)" />
                  <circle cx="95" cy="18" r="3.5" fill="var(--m-signal)" />
                  <circle cx="165" cy="18" r="3.5" fill="var(--m-signal)" />
                  <circle cx="235" cy="18" r="3.5" fill="var(--m-signal)" />
                </svg>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section id="environments" className="marketing-feature marketing-feature-reverse marketing-section-band">
        <div className="marketing-frame marketing-feature-inner">
          <EnvironmentPreview />
          <FeatureCopy
            index="VIRTUAL NETWORKS"
            title="Create the network conditions you need."
            body="Fork real Stellar state into a persistent Virtual Network, create the conditions you care about, and replay Soroban invocations without moving production funds."
            points={["Balance, contract storage, TTL, ledger, and timestamp overrides", "Scoped account impersonation without secret keys", "Branch, reset, roll back, or follow live untouched state while preserving intentional changes"]}
            link="/docs/virtual-environments"
            linkLabel="Explore virtual networks"
          />
        </div>
      </section>

      <section id="explorer" className="marketing-feature marketing-frame">
        <FeatureCopy
          index="TEAM CONTEXT"
          title="Keep every team on the same page."
          body="Releeve gives engineers, reviewers, and operators a shared workspace around the accounts, contracts, virtual networks, replays, and alerts that matter to your system."
          points={["Keep sensitive network forks, tracked entities, and operational evidence inside your organization", "Shared labels so every organization speaks the same language across important entities", "Real-time notifications that connect alerts, decoded evidence, and follow-up work"]}
          link="/explorer/testnet"
          linkLabel="Explore shared context"
        />
        <ExplorerPreview />
      </section>

      <section id="monitoring" className="marketing-feature marketing-feature-reverse marketing-section-band">
        <div className="marketing-frame marketing-feature-inner">
          <MonitoringPreview />
          <FeatureCopy
            index="MONITORING"
            title="Define the condition once. Know when it happens."
            body="Define the behavior that matters. Releeve watches Stellar continuously and delivers the execution context when it happens."
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
            <p>Every virtual network, contract, replay, and alert — scoped to your project, governed by permissions, and programmable through one API.</p>
            <div className="platform-actions">
              <Link className="platform-button platform-button-primary" href="/signup">Talk to us <ArrowRight size={15} /></Link>
              <Link className="platform-button platform-button-secondary" href="/docs">View docs</Link>
            </div>
          </div>
          <div className="platform-cards">
            <PlatformCard kicker="State" title="Virtual network API" desc="Fork real ledger state, apply controlled overrides, and replay Soroban invocations through one programmable surface." href="/docs/virtual-environments">
              <div className="platform-visual"><VirtualNetworkApiScene /></div>
            </PlatformCard>
            <PlatformCard kicker="Delivery" title="Webhooks" desc="Route signed operational events to your team and inspect every delivery attempt." href="/docs/monitoring">
              <div className="platform-visual"><WebhookScene /></div>
            </PlatformCard>
            <PlatformCard kicker="Lifecycle" title="Network controls" desc="Branch, follow live state, reset safely, and return to named rollback points without losing the original fork." href="/docs/virtual-environments">
              <div className="platform-visual"><EnvironmentsScene /></div>
            </PlatformCard>
            <PlatformCard kicker="Access" title="Project tokens" desc="Issue scoped API credentials per organization for local tools, automation, and CI." href="/docs/api-reference">
              <div className="platform-visual"><AccessTokensScene /></div>
            </PlatformCard>
          </div>
        </div>
      </section>

      <section className="scenario-section marketing-section-band">
        <div className="marketing-frame">
          <div className="marketing-section-heading">
            <h2>Built for everyone shipping onchain</h2>
          </div>
          <ul className="scenario-rail">
            {scenarios.map((scenario) => (
              <li className="scenario-card" key={scenario.title} style={{ "--acc": scenario.accent } as CSSProperties}>
                <p className="scenario-copy"><span className="scenario-title">{scenario.title}.</span> {scenario.body}</p>
                <span className="scenario-media">{scenario.scene}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="marketing-final-cta marketing-frame">
        <div>
          <p>Build against the state that actually exists.</p>
          <h2>Production state should be a test input, not a surprise.</h2>
        </div>
        <div className="marketing-final-actions">
          <Link className="marketing-button marketing-button-ink" href="/signup">Talk to us <ArrowRight size={15} /></Link>
          <Link className="marketing-button marketing-button-signal-outline" href="/docs/quickstart">Read the quickstart</Link>
        </div>
      </section>
    </>
  );
}

function ProtocolScene() {
  return (
    <svg className="scenario-scene" viewBox="0 0 256 256" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id="sc-p1" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1" fill="color-mix(in srgb, var(--m-ink) 6%, transparent)" />
        </pattern>
      </defs>
      <rect width="256" height="256" fill="url(#sc-p1)" />
      <path className="sc-stroke" d="M84 22 V234" />
      <path className="sc-branch" d="M84 102 C124 102 124 62 178 62" pathLength="100" />
      <path className="sc-branch sc-b2" d="M84 150 C128 150 126 196 186 196" pathLength="100" />
      <circle className="sc-node" cx="84" cy="54" r="3.5" />
      <circle cx="84" cy="102" r="4" fill="var(--acc)" />
      <circle className="sc-node" cx="84" cy="150" r="3.5" />
      <circle className="sc-node" cx="84" cy="198" r="3.5" />
      <circle cx="178" cy="62" r="5" fill="var(--acc)" />
      <circle className="sc-ping" cx="178" cy="62" r="9" />
      <circle className="sc-node" cx="186" cy="196" r="4" />
      <circle className="sc-mote" r="3" style={{ "--d": "3.4s", offsetPath: "path('M84 22 V234')" } as CSSProperties} />
      <circle className="sc-mote" r="2.5" style={{ "--d": "2.6s", "--dl": "1.2s", offsetPath: "path('M84 102 C124 102 124 62 178 62')" } as CSSProperties} />
      <circle className="sc-mote" r="2.5" style={{ "--d": "2.8s", "--dl": "3.4s", offsetPath: "path('M84 150 C128 150 126 196 186 196')" } as CSSProperties} />
      <text className="sc-lbl" x="92" y="26">MAIN</text>
      <text className="sc-lbl sc-acc" x="134" y="50">POOL UPGRADE</text>
      <text className="sc-lbl" x="166" y="214">FORK</text>
      <rect x="14" y="224" width="132" height="18" fill="none" stroke="color-mix(in srgb, var(--m-ink) 22%, transparent)" />
      <text className="sc-lbl" x="22" y="236">AMM · REHEARSED SWAP</text>
    </svg>
  );
}

function WhaleScene() {
  return (
    <svg className="scenario-scene" viewBox="0 0 256 195" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id="sc-p2" width="18" height="18" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r=".9" fill="color-mix(in srgb, var(--m-ink) 6%, transparent)" />
        </pattern>
      </defs>
      <rect width="256" height="195" fill="url(#sc-p2)" />
      <rect x="16" y="22" width="224" height="150" fill="color-mix(in srgb, var(--m-ink) 2%, transparent)" stroke="color-mix(in srgb, var(--m-ink) 30%, transparent)" />
      <text className="sc-lbl" x="26" y="40">BALANCES · LEDGER ENTRIES</text>
      <line x1="16" y1="48" x2="240" y2="48" stroke="color-mix(in srgb, var(--m-ink) 14%, transparent)" />
      <rect x="26" y="60" width="8" height="8" fill="color-mix(in srgb, var(--m-ink) 32%, transparent)" />
      <rect x="42" y="61" width="46" height="6" fill="color-mix(in srgb, var(--m-ink) 22%, transparent)" />
      <text className="sc-lbl" x="232" y="68" textAnchor="end">1,204</text>
      <rect x="26" y="84" width="8" height="8" fill="color-mix(in srgb, var(--m-ink) 32%, transparent)" />
      <rect x="42" y="85" width="70" height="6" fill="color-mix(in srgb, var(--m-ink) 22%, transparent)" />
      <text className="sc-lbl" x="232" y="92" textAnchor="end">8,410</text>
      <rect x="24" y="106" width="12" height="12" fill="none" stroke="var(--acc)" />
      <rect className="sc-meter-x" x="42" y="109" width="150" height="6" fill="var(--acc)" />
      <circle className="sc-ping" cx="192" cy="112" r="8" />
      <text className="sc-lbl sc-acc" x="232" y="116" textAnchor="end">25,000,000</text>
      <rect x="26" y="132" width="8" height="8" fill="color-mix(in srgb, var(--m-ink) 32%, transparent)" />
      <rect x="42" y="133" width="38" height="6" fill="color-mix(in srgb, var(--m-ink) 22%, transparent)" />
      <text className="sc-lbl" x="232" y="140" textAnchor="end">640</text>
      <text className="sc-lbl sc-acc sc-blink" x="26" y="160">LENDING · WHALE-SCALE DEPOSIT</text>
    </svg>
  );
}

function AuthScene() {
  return (
    <svg className="scenario-scene" viewBox="0 0 256 154" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id="sc-p3" width="18" height="18" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r=".9" fill="color-mix(in srgb, var(--m-ink) 6%, transparent)" />
        </pattern>
      </defs>
      <rect width="256" height="154" fill="url(#sc-p3)" />
      <rect x="16" y="20" width="92" height="100" fill="color-mix(in srgb, var(--m-ink) 2%, transparent)" stroke="color-mix(in srgb, var(--m-ink) 30%, transparent)" />
      <circle cx="42" cy="50" r="11" fill="none" stroke="var(--acc)" strokeWidth="1.4" />
      <circle cx="42" cy="50" r="3" fill="var(--acc)" />
      <rect x="60" y="42" width="36" height="5" fill="color-mix(in srgb, var(--m-ink) 32%, transparent)" />
      <rect x="60" y="52" width="26" height="5" fill="color-mix(in srgb, var(--m-ink) 20%, transparent)" />
      <line x1="28" y1="72" x2="96" y2="72" stroke="color-mix(in srgb, var(--m-ink) 14%, transparent)" />
      <text className="sc-lbl" x="28" y="90">SIGNER_9F2K</text>
      <text className="sc-lbl sc-acc" x="28" y="106">THRESHOLD · HIGH</text>
      <path className="sc-stroke-soft sc-flow" d="M108 68 H126" stroke="color-mix(in srgb, var(--m-ink) 40%, transparent)" />
      <g className="sc-tok">
        <rect x="128" y="18" width="112" height="22" fill="var(--m-bg)" stroke="color-mix(in srgb, var(--m-ink) 28%, transparent)" />
        <circle cx="139" cy="29" r="3.5" fill="var(--acc)" />
        <rect x="148" y="26" width="50" height="5" fill="color-mix(in srgb, var(--m-ink) 30%, transparent)" />
        <text className="sc-lbl" x="232" y="33" textAnchor="end">PATH_01</text>
      </g>
      <g className="sc-tok sc-t2">
        <rect x="128" y="52" width="112" height="22" fill="var(--m-bg)" stroke="color-mix(in srgb, var(--m-ink) 28%, transparent)" />
        <circle cx="139" cy="63" r="3.5" fill="var(--acc)" />
        <rect x="148" y="60" width="50" height="5" fill="color-mix(in srgb, var(--m-ink) 30%, transparent)" />
        <text className="sc-lbl" x="232" y="67" textAnchor="end">PATH_02</text>
      </g>
      <g className="sc-tok sc-t3">
        <rect x="128" y="86" width="112" height="22" fill="var(--m-bg)" stroke="color-mix(in srgb, var(--m-ink) 28%, transparent)" />
        <circle cx="139" cy="97" r="3.5" fill="var(--acc)" />
        <rect x="148" y="94" width="50" height="5" fill="color-mix(in srgb, var(--m-ink) 30%, transparent)" />
        <text className="sc-lbl" x="232" y="101" textAnchor="end">PATH_03</text>
      </g>
      <g className="sc-key" stroke="var(--acc)" strokeWidth="1.4" fill="none">
        <circle cx="200" cy="126" r="6" />
        <path d="M206 126 H228 M220 126 v5 M228 126 v5" />
      </g>
      <text className="sc-lbl sc-acc sc-blink" x="16" y="146">✓ SIGNER VERIFIED — NO KEYS REQUIRED</text>
    </svg>
  );
}

function MeterScene() {
  const meters = [
    { label: "CPU INSTRUCTIONS", value: "24.5M / 25M", delay: "0s", duration: "4s" },
    { label: "MEMORY BYTES", value: "31.2K / 40K", delay: ".6s", duration: "5s" },
    { label: "DISK READ BYTES", value: "2.1M / 2.5M", delay: "1.1s", duration: "4.4s" },
    { label: "WRITE BYTES", value: "860K / 1M", delay: "1.6s", duration: "5.4s" },
  ];
  return (
    <svg className="scenario-scene" viewBox="0 0 256 348" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id="sc-p4" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1" fill="color-mix(in srgb, var(--m-ink) 6%, transparent)" />
        </pattern>
      </defs>
      <rect width="256" height="348" fill="url(#sc-p4)" />
      <text className="sc-lbl" x="24" y="30">RESOURCE BUDGET · SOROBAN</text>
      <line x1="24" y1="46" x2="232" y2="46" stroke="var(--acc)" strokeDasharray="4 4" opacity="0.55" />
      <text className="sc-lbl sc-acc" x="232" y="40" textAnchor="end">CEILING</text>
      {meters.map((meter, index) => {
        const y = 78 + index * 62;
        return (
          <g key={meter.label}>
            <text className="sc-lbl" x="24" y={y}>{meter.label}</text>
            <rect x="24" y={y + 10} width="208" height="4" fill="color-mix(in srgb, var(--m-ink) 12%, transparent)" />
            <rect className="sc-meter-x" x="24" y={y + 10} width="208" height="4" fill="var(--acc)" style={{ animationDelay: meter.delay, animationDuration: meter.duration }} />
            <text className="sc-lbl" x="232" y={y} textAnchor="end">{meter.value}</text>
          </g>
        );
      })}
      <circle className="sc-ping" cx="222" cy="90" r="9" />
      <text className="sc-lbl sc-acc sc-blink" x="24" y="330">FEED WASM · 96% OF BUDGET</text>
    </svg>
  );
}

function AlertScene() {
  return (
    <svg className="scenario-scene" viewBox="0 0 256 113" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id="sc-p5" width="18" height="18" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r=".9" fill="color-mix(in srgb, var(--m-ink) 6%, transparent)" />
        </pattern>
      </defs>
      <rect width="256" height="113" fill="url(#sc-p5)" />
      <g stroke="color-mix(in srgb, var(--m-ink) 35%, transparent)" fill="color-mix(in srgb, var(--m-ink) 3%, transparent)">
        <rect x="14" y="10" width="14" height="14" />
        <rect x="14" y="36" width="14" height="14" />
        <rect x="14" y="62" width="14" height="14" />
        <rect x="14" y="88" width="14" height="14" />
      </g>
      <path className="sc-stroke-soft sc-flow" d="M28 17 C72 17 94 43 116 55" />
      <path className="sc-stroke-soft sc-flow" d="M28 43 C70 43 96 51 116 56" style={{ animationDelay: ".3s" }} />
      <path className="sc-stroke-soft sc-flow" d="M28 69 C70 69 96 63 116 58" style={{ animationDelay: ".6s" }} />
      <path className="sc-stroke-soft sc-flow" d="M28 95 C72 95 94 71 116 59" style={{ animationDelay: ".9s" }} />
      <rect x="120" y="49" width="16" height="16" transform="rotate(45 128 57)" fill="var(--m-panel)" stroke="var(--acc)" strokeWidth="1.2" />
      <circle className="sc-ping" cx="128" cy="57" r="12" />
      <path className="sc-stroke sc-flow" d="M139 57 H198" stroke="color-mix(in srgb, var(--m-ink) 55%, transparent)" />
      <rect x="198" y="45" width="44" height="24" fill="var(--m-panel)" stroke="var(--acc)" strokeWidth="1.2" />
      <text className="sc-lbl sc-acc" x="204" y="59">SLACK</text>
      <circle className="sc-mote" r="2.5" style={{ "--d": "2.2s", offsetPath: "path('M128 57 H198')" } as CSSProperties} />
    </svg>
  );
}

function FeatureCopy({ index, title, body, points, link, linkLabel }: { index: string; title: string; body: string; points: string[]; link: string; linkLabel: string }) {
  return (
    <div className="feature-copy">
      <p className="marketing-section-index">{index}</p>
      <h2>{title}</h2>
      <p>{body}</p>
      <ul>{points.map((point) => <li key={point}><Check size={14} />{point}</li>)}</ul>
      <Link href={link}>{linkLabel} <ArrowRight size={14} /></Link>
    </div>
  );
}

function PlatformCard({ kicker, title, desc, href, children }: { kicker: string; title: string; desc: string; href: string; children: React.ReactNode }) {
  return (
    <Link className="platform-card" href={href}>
      <div className="platform-card-head">
        <span className="platform-card-kicker">{kicker}</span>
        <div className="platform-card-title"><h3>{title}</h3><ArrowRight className="platform-card-arrow" size={16} /></div>
        <p>{desc}</p>
      </div>
      {children}
    </Link>
  );
}

type CodeLine = { text: string; fill: string } | { segs: [string, string][] };

const networkCodeLines: CodeLine[] = [
  { text: "curl --request POST \\", fill: "#9aa2ae" },
  { text: "  --url $RELEEVE_API/environments/$ENV_ID/transactions \\", fill: "#9aa2ae" },
  { text: "  --header \"Content-Type: application/json\" \\", fill: "#9aa2ae" },
  { text: "  --data '{", fill: "#9aa2ae" },
  { segs: [["    ", "#9aa2ae"], ["\"contract_id\"", "var(--m-blue)"], [": ", "#9aa2ae"], ["\"CBZV...POOL\"", "var(--m-signal)"], [",", "#9aa2ae"]] },
  { segs: [["    ", "#9aa2ae"], ["\"function_name\"", "var(--m-blue)"], [": ", "#9aa2ae"], ["\"deposit\"", "var(--m-signal)"], [",", "#9aa2ae"]] },
  { segs: [["    ", "#9aa2ae"], ["\"args\"", "var(--m-blue)"], [": [", "#9aa2ae"], ["\"GDX4...WHALE\"", "var(--m-signal)"], [", ", "#9aa2ae"], ["\"25000000\"", "var(--m-signal)"], ["],", "#9aa2ae"]] },
  { segs: [["    ", "#9aa2ae"], ["\"impersonate\"", "var(--m-blue)"], [": [", "#9aa2ae"], ["\"GDX4...WHALE\"", "var(--m-signal)"], ["]", "#9aa2ae"]] },
  { text: "  }'", fill: "#9aa2ae" },
];

function VirtualNetworkApiScene() {
  return (
    <svg className="platform-scene" viewBox="0 0 760 330" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style={{ "--acc": "var(--m-signal)" } as CSSProperties}>
      <defs>
        <pattern id="spiral-p" width="31" height="33" patternUnits="userSpaceOnUse">
          <path d="M15.5 16.5a1.5 1.5 0 0 1 3 0a3 3 0 0 1-6 0a4.5 4.5 0 0 1 9 0a6 6 0 0 1-12 0" fill="none" stroke="color-mix(in srgb, var(--m-ink) 16%, transparent)" strokeWidth="1.6" strokeLinecap="round" />
        </pattern>
        <linearGradient id="spiral-mask" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#000" />
          <stop offset="55%" stopColor="#000" />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>
      <rect x="24" y="16" width="356" height="298" fill="url(#spiral-p)" mask="url(#spiral-mask)" />
      <rect x="396" y="16" width="348" height="298" rx="16" fill="var(--m-panel)" stroke="color-mix(in srgb, var(--m-ink) 22%, transparent)" />
      <rect x="412" y="32" width="316" height="266" rx="12" fill="var(--m-panel-2)" stroke="color-mix(in srgb, var(--m-ink) 14%, transparent)" />
      {networkCodeLines.map((line, index) => {
        const y = 62 + index * 22;
        if ("segs" in line) {
          return (
            <text key={index} x="428" y={y} className="sc-code" fontSize="11">
              {line.segs.map(([segment, fill], segIndex) => <tspan key={segIndex} fill={fill}>{segment}</tspan>)}
            </text>
          );
        }
        return <text key={index} x="428" y={y} className="sc-code" fontSize="11" fill={line.fill}>{line.text}</text>;
      })}
    </svg>
  );
}

function WebhookScene() {
  return (
    <svg className="platform-scene" viewBox="0 0 360 330" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style={{ "--acc": "var(--m-blue)" } as CSSProperties}>
      <text x="20" y="24" className="sc-label">EVENT SOURCES</text>
      <rect className="sc-chip" x="20" y="34" width="118" height="20" rx="6" />
      <circle cx="34" cy="44" r="3" fill="var(--m-blue)" />
      <text x="44" y="48" className="sc-label">order.deposit</text>
      <rect className="sc-chip" x="20" y="66" width="118" height="20" rx="6" />
      <circle cx="34" cy="76" r="3" fill="var(--m-signal)" />
      <text x="44" y="80" className="sc-label">oracle.update</text>
      <rect className="sc-chip" x="20" y="98" width="118" height="20" rx="6" />
      <circle cx="34" cy="108" r="3" fill="var(--m-amber)" />
      <text x="44" y="112" className="sc-label">tx.failed</text>
      <path className="sc-stroke-soft sc-flow" d="M138 44 C168 44 172 138 194 144" />
      <path className="sc-stroke-soft sc-flow" d="M138 76 C166 76 172 140 194 145" style={{ animationDelay: ".3s" }} />
      <path className="sc-stroke-soft sc-flow" d="M138 108 C168 108 172 142 194 146" style={{ animationDelay: ".6s" }} />
      <g transform="translate(200 150)">
        <rect x="-13" y="-13" width="26" height="26" transform="rotate(45)" fill="var(--m-bg)" stroke="var(--acc)" strokeWidth="1.2" />
        <circle cx="0" cy="0" r="4" fill="none" stroke="var(--acc)" strokeWidth="1.2" />
        <path d="M0 -8 V8 M-8 0 H8" stroke="var(--acc)" strokeWidth="1.2" strokeLinecap="round" />
      </g>
      <circle className="sc-ping" cx="200" cy="150" r="14" />
      <text className="sc-lbl sc-acc" x="200" y="186" textAnchor="middle">releeve hook</text>
      <rect className="sc-panel" x="20" y="206" width="320" height="96" rx="10" />
      <text x="36" y="228" className="sc-panel-head">Deliveries</text>
      <circle className="sc-blink" cx="318" cy="222" r="3" fill="var(--m-signal)" />
      <text className="sc-label sc-acc" x="310" y="227" textAnchor="end">live</text>
      <line x1="20" y1="238" x2="340" y2="238" stroke="color-mix(in srgb, var(--m-ink) 12%, transparent)" />
      {[
        { name: "Slack", status: "200 OK", ok: true, time: "12:04:01" },
        { name: "Webhook", status: "200 OK", ok: true, time: "12:04:01" },
        { name: "Sentry", status: "retry · 3/5", ok: false, time: "12:04:02" },
      ].map((row, index) => {
        const y = 262 + index * 16;
        return (
          <g key={row.name}>
            <circle cx="32" cy={y - 4} r="3" fill={row.ok ? "var(--m-signal)" : "var(--m-amber)"} />
            <text className="sc-label" x="44" y={y}>{row.name}</text>
            <text className="sc-label" x="250" y={y} textAnchor="end">{row.time}</text>
            <text className="sc-label" x="334" y={y} textAnchor="end" fill={row.ok ? "var(--m-signal)" : "var(--m-amber)"}>{row.status}</text>
          </g>
        );
      })}
      <circle className="sc-mote" r="3" style={{ "--d": "2.4s", offsetPath: "path('M138 76 C166 76 172 140 194 145')" } as CSSProperties} />
    </svg>
  );
}

function EnvironmentsScene() {
  return (
    <svg className="platform-scene" viewBox="0 0 360 356" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style={{ "--acc": "var(--m-blue)" } as CSSProperties}>
      <text x="24" y="26" className="sc-label">VIRTUAL NETWORKS</text>
      <rect className="sc-panel" x="24" y="38" width="312" height="92" rx="10" />
      <rect x="42" y="56" width="12" height="12" rx="3" fill="var(--m-signal)" />
      <text x="62" y="66" className="sc-panel-head">acme-mainnet</text>
      <text x="42" y="90" className="sc-label">base mainnet @ 2,390,011</text>
      <rect className="sc-badge-signal" x="286" y="50" width="38" height="16" rx="4" />
      <text className="sc-label sc-acc" x="305" y="61" textAnchor="middle">Frozen</text>
      <polyline points="42,108 70,104 98,110 126,98 154,106 182,100 210,108 238,96 266,104 294,100 322,106" fill="none" stroke="var(--m-signal)" strokeWidth="1.5" />
      <rect className="sc-panel" x="24" y="144" width="312" height="92" rx="10" />
      <rect x="42" y="162" width="12" height="12" rx="3" fill="var(--m-blue)" />
      <text x="62" y="172" className="sc-panel-head">acme-testnet</text>
      <text x="42" y="196" className="sc-label">base testnet @ 2,401,330</text>
      <rect className="sc-badge-signal" x="280" y="156" width="44" height="16" rx="4" />
      <text className="sc-label" x="302" y="167" textAnchor="middle" fill="var(--m-blue)">Syncing</text>
      <circle className="sc-blink" cx="288" cy="158" r="2.5" fill="var(--m-blue)" />
      <polyline points="42,214 70,210 98,214 126,206 154,212 182,208 210,214 238,204 266,212 294,208 322,212" fill="none" stroke="var(--m-blue)" strokeWidth="1.5" />
      <path className="sc-stroke-soft sc-flow" d="M180 130 V258" />
      <circle className="sc-mote" r="3" style={{ "--d": "2.2s", offsetPath: "path('M180 130 V258')" } as CSSProperties} />
      <rect className="sc-panel" x="24" y="262" width="312" height="66" rx="10" strokeDasharray="4 4" />
      <text x="42" y="288" className="sc-panel-head">sim-deposit</text>
      <text x="42" y="306" className="sc-label">snapshot @ 2,390,021 · branched</text>
      <rect className="sc-badge-signal" x="270" y="276" width="54" height="16" rx="4" />
      <text className="sc-label" x="297" y="287" textAnchor="middle" fill="var(--m-blue)">+ Branch</text>
      <circle className="sc-ping" cx="180" cy="262" r="8" />
    </svg>
  );
}

function AccessTokensScene() {
  const rows = [
    { name: "ci-release", token: "rleeve_8f2a••••••••••9c1d", scopes: ["sims", "envs", "alerts"], created: "12 Jan 2026" },
    { name: "explorer-readonly", token: "rleeve_71c0••••••••••4ab2", scopes: ["explorer", "sims"], created: "03 Jan 2026" },
    { name: "billing-worker", token: "rleeve_e5a9••••••••••07d4", scopes: ["webhooks", "alerts"], created: "21 Dec 2025" },
  ];
  return (
    <svg className="platform-scene" viewBox="0 0 760 356" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style={{ "--acc": "var(--m-amber)" } as CSSProperties}>
      <text x="24" y="26" className="sc-label">ACCESS TOKENS</text>
      {rows.map((row, index) => {
        const y = 40 + index * 56;
        return (
          <g key={row.name}>
            <rect className="sc-panel" x="24" y={y} width="712" height="48" rx="10" />
            <circle cx="55" cy={y + 24} r="5" fill="none" stroke="var(--m-amber)" strokeWidth="1.4" />
            <path d={`M60 ${y + 24} H72 M65 ${y + 24} v6 M72 ${y + 24} v6`} stroke="var(--m-amber)" strokeWidth="1.4" fill="none" />
            <text className="sc-panel-head" x="84" y={y + 22}>{row.name}</text>
            <text className="sc-label" x="84" y={y + 40}>{row.token}</text>
            {row.scopes.map((scope, scopeIndex) => {
              const sx = 438 + scopeIndex * 70;
              return (
                <g key={scope}>
                  <rect className="sc-chip" x={sx} y={y + 17} width="62" height="16" rx="999" />
                  <text className="sc-label" x={sx + 31} y={y + 28} textAnchor="middle">{scope}</text>
                </g>
              );
            })}
            <circle cx="722" cy={y + 18} r="3" fill="var(--m-signal)" />
            <text className="sc-label" x="744" y={y + 22} textAnchor="end">Active</text>
            <text className="sc-label" x="744" y={y + 40} textAnchor="end">{row.created}</text>
          </g>
        );
      })}
      <rect className="sc-panel" x="24" y="212" width="712" height="44" rx="10" strokeDasharray="4 4" />
      <text className="sc-label sc-acc" x="380" y="239" textAnchor="middle" fontSize="10">+ Create token</text>
      <text className="sc-label" x="24" y="290">Tokens inherit organization permissions.</text>
      <text className="sc-label" x="24" y="306">Use them in local tooling, CI, and scheduled jobs — revoke at any time.</text>
      <rect className="sc-chip" x="24" y="318" width="130" height="20" rx="6" />
      <text className="sc-label" x="89" y="332" textAnchor="middle">rotate & revoke</text>
    </svg>
  );
}
