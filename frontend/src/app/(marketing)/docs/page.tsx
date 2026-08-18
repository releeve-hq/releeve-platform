import type { Metadata } from "next";
import Link from "next/link";
import { BellRing, Blocks, Bug, Fingerprint, Landmark, Layers, Play, Radar, Rocket, Server, ShieldCheck, Users, WalletCards } from "lucide-react";
import { docsNav } from "@/components/marketing/docs-data";

export const metadata: Metadata = {
  title: "Documentation | Releeve",
  description: "Guides for Releeve simulations, virtual environments, monitoring, explorer workflows, debugging, protocol support, and API access.",
  alternates: { canonical: "/docs" },
};

const icons = {
  quickstart: Rocket,
  simulations: Play,
  "virtual-environments": Blocks,
  monitoring: BellRing,
  explorer: Radar,
  debugger: Bug,
  "source-verification": ShieldCheck,
  "protocol-support": Layers,
  "correctness-and-trust": Fingerprint,
  "node-rpc": Server,
  "write-path": WalletCards,
  "accounts-projects": Users,
  pricing: Landmark,
};

export default function DocumentationPage() {
  return (
    <div className="docs-home">
      <p className="marketing-section-index">Documentation</p>
      <h1>Build with real Stellar state.</h1>
      <p>Start with a first simulation, then move into persistent environments, monitoring rules, debugging, embedded investigation, and programmatic access.</p>
      <div className="docs-home-grid">
        {docsNav.map((item) => {
          const Icon = icons[item.slug as keyof typeof icons];
          return (
            <Link href={`/docs/${item.slug}`} key={item.slug}>
              <span className="docs-home-card-icon"><Icon size={18} /></span>
              <div>
                <h2>{item.label}</h2>
                <p>{item.description}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}