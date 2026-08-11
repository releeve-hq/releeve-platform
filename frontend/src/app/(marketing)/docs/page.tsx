import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BellRing, Blocks, Braces, Play, Radar, Rocket } from "lucide-react";
import { docsNav } from "@/components/marketing/docs-data";

export const metadata: Metadata = {
  title: "Documentation | Releeve",
  description: "Guides for Releeve simulations, virtual environments, monitoring, explorer workflows, and API access.",
  alternates: { canonical: "/docs" },
};

const icons = { quickstart: Rocket, simulations: Play, "virtual-environments": Blocks, monitoring: BellRing, explorer: Radar, "api-reference": Braces };

export default function DocumentationPage() {
  return (
    <div className="docs-home">
      <p className="marketing-section-index">Documentation</p>
      <h1>Build with real Stellar state.</h1>
      <p>Start with a first simulation, then move into persistent environments, monitoring rules, embedded investigation, and programmatic access.</p>
      <div className="docs-home-grid">
        {docsNav.map((item) => {
          const Icon = icons[item.slug as keyof typeof icons];
          return <Link href={`/docs/${item.slug}`} key={item.slug}><Icon size={18} /><h2>{item.label}</h2><p>{item.description}</p><span>Read guide <ArrowRight size={13} /></span></Link>;
        })}
      </div>
    </div>
  );
}
