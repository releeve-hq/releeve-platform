import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { ReleeveLogo } from "@/components/ui/releeve-logo";
import { MarketingThemeToggle } from "./theme-toggle";

const columns = [
  {
    title: "Platform",
    links: [
      ["Simulator", "/#simulation"],
      ["Virtual environments", "/#environments"],
      ["Monitoring", "/#monitoring"],
      ["Public explorer", "/explorer/testnet"],
    ],
  },
  {
    title: "Resources",
    links: [
      ["Documentation", "/docs"],
      ["Quickstart", "/docs/quickstart"],
      ["API reference", "/docs/api-reference"],
      ["Explorer guide", "/docs/explorer"],
    ],
  },
  {
    title: "Company",
    links: [
      ["About", "/about"],
      ["Pricing", "/pricing"],
      ["Privacy", "/privacy"],
      ["Terms", "/terms"],
    ],
  },
] as const;

export function MarketingFooter() {
  return (
    <footer className="marketing-footer">
      <div className="marketing-frame marketing-footer-grid">
        <div className="marketing-footer-brand">
          <Link className="marketing-brand" href="/">
            <span className="marketing-logo-mark"><ReleeveLogo size={23} tone="auto" /></span>
            <span>Releeve</span>
          </Link>
          <p>Simulation, observability, and embedded investigation tools built for Stellar and Soroban teams.</p>
          <Link className="marketing-footer-cta" href="/signup">Start building <ArrowUpRight size={14} /></Link>
        </div>
        {columns.map((column) => (
          <div className="marketing-footer-column" key={column.title}>
            <h2>{column.title}</h2>
            {column.links.map(([label, href]) => <Link href={href} key={label}>{label}</Link>)}
          </div>
        ))}
      </div>
      <div className="marketing-frame marketing-footer-bottom">
        <span>Releeve</span>
        <div className="marketing-footer-bottom-actions">
          <MarketingThemeToggle />
          <span className="marketing-operational"><i /> Platform services operational</span>
        </div>
      </div>
    </footer>
  );
}
