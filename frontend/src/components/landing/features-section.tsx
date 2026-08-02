"use client";

import { useEffect, useRef, useState } from "react";

const featureGroups = [
  {
    id: "simulate",
    number: "01",
    heading: "Test with production-level confidence",
    sub: "Model every scenario against live Stellar state before it reaches production.",
    dashboard: "simulate",
    items: [
      {
        title: "Production state mirroring",
        desc: "Test transactions against a continuously synchronized view of the Stellar network for results that closely match production.",
      },
      {
        title: "Ready in seconds",
        desc: "Create production-like environments instantly\u2014no local nodes, custom setups, or outdated test networks.",
      },
      {
        title: "Complete control over state",
        desc: "Modify accounts, contract storage, balances, ledger data, and time to recreate any scenario you need to test.",
      },
      {
        title: "Private simulation environments",
        desc: "Keep unreleased features, deployment plans, and testing workflows isolated from public networks.",
      },
      {
        title: "Multi-step transaction flows",
        desc: "Chain multiple transactions together to validate complete user journeys, integrations, and deployment sequences.",
      },
    ],
  },
  {
    id: "operate",
    number: "02",
    heading: "Operate with complete visibility",
    sub: "Understand your systems, detect issues early, and keep production running smoothly.",
    dashboard: "operate",
    items: [
      {
        title: "Protocol insights",
        desc: "Track the health and activity of the Stellar protocols and services your applications depend on.",
      },
      {
        title: "Transaction flow analysis",
        desc: "Follow the movement of assets and interactions across accounts, contracts, and applications with clear execution paths.",
      },
      {
        title: "Resource usage insights",
        desc: "See how contract execution consumes resources to identify bottlenecks and optimize performance.",
      },
      {
        title: "Validate before acting",
        desc: "Test fixes and operational changes in a simulation before applying them to production.",
      },
      {
        title: "Proactive monitoring",
        desc: "Detect failed transactions, unexpected state changes, abnormal balances, and other critical events as they happen.",
      },
    ],
  },
  {
    id: "collaborate",
    number: "03",
    heading: "Keep every team on the same page",
    sub: "Provide engineering, operations, and security teams with a shared workspace for building and running Stellar applications.",
    dashboard: "collaborate",
    items: [
      {
        title: "Shared operational context",
        desc: "Give every team access to the same transaction data, simulations, and production insights for faster collaboration.",
      },
      {
        title: "Secure shared environments",
        desc: "Work together in private environments where issues can be reproduced, tested, and resolved without affecting production.",
      },
      {
        title: "Shared labels and organization",
        desc: "Label important accounts, contracts, and assets so everyone across your organization speaks the same language.",
      },
      {
        title: "Real-time team notifications",
        desc: "Automatically notify the right people when important events occur, helping your team respond faster.",
      },
    ],
  },
];

function SimulateDashboard() {
  return (
    <svg viewBox="0 0 800 340" fill="none" className="w-full h-full">
      <rect width="800" height="340" rx="12" fill="currentColor" fillOpacity="0.03" />
      <rect x="0.5" y="0.5" width="799" height="339" rx="12" stroke="currentColor" strokeOpacity="0.08" />
      {/* Top bar */}
      <rect x="16" y="16" width="768" height="36" rx="6" fill="currentColor" fillOpacity="0.05" />
      <rect x="24" y="28" width="100" height="12" rx="2" fill="currentColor" fillOpacity="0.15" />
      <rect x="620" y="24" width="48" height="20" rx="4" fill="currentColor" fillOpacity="0.08" />
      <rect x="680" y="24" width="48" height="20" rx="4" fill="rgb(115, 220, 140)" fillOpacity="0.2" />
      {/* Left - request builder */}
      <rect x="16" y="64" width="340" height="260" rx="8" fill="currentColor" fillOpacity="0.03" />
      <rect x="16.5" y="64.5" width="339" height="259" rx="8" stroke="currentColor" strokeOpacity="0.06" />
      <rect x="28" y="80" width="160" height="8" rx="2" fill="currentColor" fillOpacity="0.2" />
      <rect x="28" y="100" width="200" height="10" rx="2" fill="currentColor" fillOpacity="0.08" />
      <rect x="28" y="120" width="312" height="36" rx="4" fill="currentColor" fillOpacity="0.06" />
      <rect x="28" y="170" width="312" height="36" rx="4" fill="currentColor" fillOpacity="0.06" />
      <rect x="28" y="220" width="312" height="36" rx="4" fill="currentColor" fillOpacity="0.06" />
      <rect x="28" y="280" width="100" height="28" rx="6" fill="rgb(115, 220, 140)" fillOpacity="0.25" />
      {/* Right - results panel */}
      <rect x="368" y="64" width="416" height="126" rx="8" fill="currentColor" fillOpacity="0.03" />
      <rect x="368.5" y="64.5" width="415" height="125" rx="8" stroke="currentColor" strokeOpacity="0.06" />
      <rect x="380" y="80" width="140" height="8" rx="2" fill="currentColor" fillOpacity="0.2" />
      <rect x="380" y="100" width="388" height="6" rx="2" fill="rgb(115, 220, 140)" fillOpacity="0.2" />
      <rect x="380" y="114" width="350" height="6" rx="2" fill="rgb(115, 220, 140)" fillOpacity="0.15" />
      <rect x="380" y="128" width="300" height="6" rx="2" fill="rgb(115, 220, 140)" fillOpacity="0.1" />
      <rect x="380" y="152" width="90" height="22" rx="4" fill="rgb(115, 220, 140)" fillOpacity="0.2" />
      {/* Right bottom - state diff */}
      <rect x="368" y="202" width="416" height="122" rx="8" fill="currentColor" fillOpacity="0.03" />
      <rect x="368.5" y="202.5" width="415" height="121" rx="8" stroke="currentColor" strokeOpacity="0.06" />
      <rect x="380" y="216" width="160" height="8" rx="2" fill="currentColor" fillOpacity="0.2" />
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect x="380" y={240 + i * 20} width="380" height="14" rx="3" fill="currentColor" fillOpacity="0.03" />
          <rect x="388" y={244 + i * 20} width="80" height="6" rx="2" fill="currentColor" fillOpacity="0.12" />
          <rect x="484" y={244 + i * 20} width="120" height="6" rx="2" fill="rgb(115, 220, 140)" fillOpacity={i === 0 ? 0.3 : i === 1 ? 0.2 : 0.1} />
        </g>
      ))}
    </svg>
  );
}

function OperateDashboard() {
  return (
    <svg viewBox="0 0 800 340" fill="none" className="w-full h-full">
      <rect width="800" height="340" rx="12" fill="currentColor" fillOpacity="0.03" />
      <rect x="0.5" y="0.5" width="799" height="339" rx="12" stroke="currentColor" strokeOpacity="0.08" />
      {/* Top bar */}
      <rect x="16" y="16" width="768" height="36" rx="6" fill="currentColor" fillOpacity="0.05" />
      <rect x="24" y="28" width="80" height="12" rx="2" fill="currentColor" fillOpacity="0.15" />
      <rect x="620" y="24" width="60" height="20" rx="4" fill="rgb(115, 220, 140)" fillOpacity="0.15" />
      <rect x="692" y="24" width="48" height="20" rx="4" fill="currentColor" fillOpacity="0.08" />
      <rect x="748" y="24" width="28" height="20" rx="4" fill="currentColor" fillOpacity="0.08" />
      {/* Main chart */}
      <rect x="16" y="64" width="500" height="130" rx="8" fill="currentColor" fillOpacity="0.03" />
      <rect x="16.5" y="64.5" width="499" height="129" rx="8" stroke="currentColor" strokeOpacity="0.06" />
      <rect x="28" y="80" width="120" height="8" rx="2" fill="currentColor" fillOpacity="0.2" />
      {/* Bar chart */}
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => (
        <rect key={i} x={40 + i * 38} y={110 + (Math.sin(i * 0.7) * 25 + 20)} width="22" height={50 - (Math.sin(i * 0.7) * 25 + 20)} rx="3" fill="rgb(115, 220, 140)" fillOpacity={0.12 + (1 - i / 12) * 0.2} />
      ))}
      <rect x="40" y="166" width="456" height="1" fill="currentColor" fillOpacity="0.06" />
      {/* Side metrics */}
      <rect x="528" y="64" width="256" height="62" rx="8" fill="currentColor" fillOpacity="0.03" />
      <rect x="528.5" y="64.5" width="255" height="61" rx="8" stroke="currentColor" strokeOpacity="0.06" />
      <rect x="540" y="76" width="40" height="6" rx="2" fill="currentColor" fillOpacity="0.12" />
      <rect x="540" y="88" width="60" height="14" rx="3" fill="rgb(115, 220, 140)" fillOpacity="0.25" />
      <rect x="635" y="76" width="40" height="6" rx="2" fill="currentColor" fillOpacity="0.12" />
      <rect x="635" y="88" width="60" height="14" rx="3" fill="currentColor" fillOpacity="0.12" />
      <rect x="730" y="76" width="40" height="6" rx="2" fill="currentColor" fillOpacity="0.12" />
      <rect x="730" y="88" width="60" height="14" rx="3" fill="currentColor" fillOpacity="0.12" />
      <rect x="528" y="134" width="256" height="60" rx="8" fill="currentColor" fillOpacity="0.03" />
      <rect x="528.5" y="134.5" width="255" height="59" rx="8" stroke="currentColor" strokeOpacity="0.06" />
      <rect x="540" y="146" width="80" height="6" rx="2" fill="currentColor" fillOpacity="0.12" />
      <rect x="540" y="158" width="40" height="14" rx="3" fill="rgb(115, 220, 140)" fillOpacity="0.25" />
      <rect x="595" y="158" width="40" height="14" rx="3" fill="currentColor" fillOpacity="0.08" />
      <rect x="650" y="158" width="40" height="14" rx="3" fill="currentColor" fillOpacity="0.08" />
      {/* Bottom - transaction feed */}
      <rect x="16" y="206" width="768" height="120" rx="8" fill="currentColor" fillOpacity="0.03" />
      <rect x="16.5" y="206.5" width="767" height="119" rx="8" stroke="currentColor" strokeOpacity="0.06" />
      <rect x="28" y="218" width="160" height="8" rx="2" fill="currentColor" fillOpacity="0.2" />
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect x="28" y={238 + i * 22} width="740" height="16" rx="4" fill="currentColor" fillOpacity="0.02" />
          <rect x="38" y={242 + i * 22} width="8" height="8" rx="4" fill={i < 2 ? "rgb(115, 220, 140)" : "currentColor"} fillOpacity={i < 2 ? 0.5 : 0.15} />
          <rect x="56" y={242 + i * 22} width="120" height="6" rx="2" fill="currentColor" fillOpacity="0.1" />
          <rect x="200" y={242 + i * 22} width="100" height="6" rx="2" fill="currentColor" fillOpacity="0.08" />
          <rect x="340" y={242 + i * 22} width="60" height="6" rx="2" fill="currentColor" fillOpacity="0.08" />
          <rect x="440" y={242 + i * 22} width="160" height="6" rx="2" fill="currentColor" fillOpacity="0.06" />
          <rect x="660" y={242 + i * 22} width="60" height="6" rx="2" fill="currentColor" fillOpacity="0.06" />
        </g>
      ))}
    </svg>
  );
}

function CollaborateDashboard() {
  return (
    <svg viewBox="0 0 800 340" fill="none" className="w-full h-full">
      <rect width="800" height="340" rx="12" fill="currentColor" fillOpacity="0.03" />
      <rect x="0.5" y="0.5" width="799" height="339" rx="12" stroke="currentColor" strokeOpacity="0.08" />
      {/* Top bar */}
      <rect x="16" y="16" width="768" height="36" rx="6" fill="currentColor" fillOpacity="0.05" />
      <rect x="24" y="28" width="140" height="12" rx="2" fill="currentColor" fillOpacity="0.15" />
      <rect x="640" y="24" width="48" height="20" rx="20" fill="currentColor" fillOpacity="0.08" />
      <rect x="700" y="24" width="48" height="20" rx="20" fill="currentColor" fillOpacity="0.08" />
      <rect x="750" y="28" width="26" height="12" rx="2" fill="rgb(115, 220, 140)" fillOpacity="0.25" />
      {/* Left - team panel */}
      <rect x="16" y="64" width="220" height="260" rx="8" fill="currentColor" fillOpacity="0.03" />
      <rect x="16.5" y="64.5" width="219" height="259" rx="8" stroke="currentColor" strokeOpacity="0.06" />
      <rect x="28" y="80" width="100" height="8" rx="2" fill="currentColor" fillOpacity="0.2" />
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <circle cx="44" cy={124 + i * 40} r="10" fill="currentColor" fillOpacity="0.08" />
          <circle cx="44" cy={124 + i * 40} r="10" fill={i === 1 ? "rgb(115, 220, 140)" : "none"} fillOpacity={i === 1 ? 0.2 : 0} />
          <rect x="64" y={120 + i * 40} width="90" height="7" rx="2" fill="currentColor" fillOpacity="0.15" />
          <rect x="64" y={132 + i * 40} width="60" height="5" rx="2" fill="currentColor" fillOpacity="0.08" />
        </g>
      ))}
      {/* Right - activity feed */}
      <rect x="248" y="64" width="536" height="260" rx="8" fill="currentColor" fillOpacity="0.03" />
      <rect x="248.5" y="64.5" width="535" height="259" rx="8" stroke="currentColor" strokeOpacity="0.06" />
      <rect x="260" y="80" width="160" height="8" rx="2" fill="currentColor" fillOpacity="0.2" />
      <rect x="700" y="78" width="60" height="12" rx="4" fill="rgb(115, 220, 140)" fillOpacity="0.15" />
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect x="260" y={104 + i * 56} width="508" height="44" rx="6" fill="currentColor" fillOpacity="0.02" />
          <circle cx="280" cy={126 + i * 56} r="10" fill="currentColor" fillOpacity="0.08" />
          <circle cx="280" cy={126 + i * 56} r="10" fill={i === 0 ? "rgb(115, 220, 140)" : "none"} fillOpacity={i === 0 ? 0.2 : 0} />
          <rect x="300" y={118 + i * 56} width="180" height="7" rx="2" fill="currentColor" fillOpacity="0.15" />
          <rect x="300" y={130 + i * 56} width="120" height="5" rx="2" fill="currentColor" fillOpacity="0.08" />
          <rect x={540 + (i % 2) * 60} y={120 + i * 56} width="100" height="7" rx="2" fill="currentColor" fillOpacity="0.06" />
          <rect x={540 + (i % 2) * 60} y={132 + i * 56} width="60" height="5" rx="2" fill="currentColor" fillOpacity="0.04" />
        </g>
      ))}
    </svg>
  );
}

function DashboardVisual({ type }: { type: string }) {
  switch (type) {
    case "simulate":
      return <SimulateDashboard />;
    case "operate":
      return <OperateDashboard />;
    case "collaborate":
      return <CollaborateDashboard />;
    default:
      return null;
  }
}

function FeatureGroup({
  group,
  index,
}: {
  group: (typeof featureGroups)[number];
  index: number;
}) {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { threshold: 0.15 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ${
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-12"
      }`}
    >
      {/* Heading */}
      <div className="mb-8">
        <h3 className="text-2xl lg:text-3xl font-display tracking-tight mb-3">
          {group.heading}
        </h3>
        <p className="text-base lg:text-lg text-muted-foreground leading-relaxed max-w-2xl">
          {group.sub}
        </p>
      </div>

      {/* Dashboard - full width */}
      <div
        className={`w-full mb-10 transition-all duration-700 delay-150 ${
          isVisible
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-8"
        }`}
      >
        <div className="w-full aspect-[2.4/1] max-h-[420px]">
          <DashboardVisual type={group.dashboard} />
        </div>
      </div>

      {/* Feature items */}
      <div className="grid md:grid-cols-2 gap-x-8 gap-y-6 ml-0 md:ml-12 mb-20 lg:mb-28">
        {group.items.map((item, i) => (
          <div
            key={item.title}
            className={`group transition-all duration-500 ${
              isVisible
                ? "opacity-100 translate-y-0"
                : "opacity-0 translate-y-6"
            }`}
            style={{ transitionDelay: isVisible ? `${i * 80}ms` : "0ms" }}
          >
            <div className="p-5 rounded-xl bg-foreground/[0.02] border border-foreground/5 hover:border-foreground/10 hover:bg-foreground/[0.04] transition-all duration-300">
              <div className="flex items-start gap-3">
                <span
                  className="size-1.5 rounded-full mt-2 shrink-0"
                  style={{ backgroundColor: "rgb(115, 220, 140)" }}
                />
                <div>
                  <h4 className="text-sm font-medium text-foreground mb-1.5">
                    {item.title}
                  </h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FeaturesSection() {
  const sectionRef = useRef<HTMLDivElement>(null);

  return (
    <section id="features" className="relative py-24 lg:py-32">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        {/* Section header */}
        <div className="max-w-3xl mb-20 lg:mb-28">
          <h2 className="text-[clamp(2rem,5vw,4rem)] font-display leading-[1.05] tracking-tight mb-5">
            Simulate. Operate.{" "}
            <span style={{ color: "rgb(115, 220, 140)" }}>Collaborate.</span>
          </h2>
          <p className="text-base lg:text-lg text-muted-foreground leading-relaxed max-w-2xl">
            Everything your team needs to build, deploy, and operate
            production-ready Stellar applications from a single platform.
          </p>
        </div>

        {/* Feature groups */}
        {featureGroups.map((group, i) => (
          <FeatureGroup key={group.id} group={group} index={i} />
        ))}
      </div>
    </section>
  );
}
