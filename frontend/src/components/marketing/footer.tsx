import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { ReleeveLogo } from "@/components/ui/releeve-logo";
import { MarketingThemeToggle } from "./theme-toggle";

const columns = [
  {
    title: "Platform",
    links: [
      ["Virtual networks", "/#environments"],
      ["Monitoring", "/#monitoring"],
      ["Team context", "/#explorer"],
    ],
  },
  {
    title: "Company",
    links: [
      ["About us", "/#about"],
      ["Talk to us", "/contact"],
    ],
  },
  {
    title: "Legal",
    links: [
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
          <p>Virtual networks, observability, and operational investigation tools built for Stellar and Soroban teams.</p>
          <Link className="marketing-footer-cta" href="/contact">Talk to us <ArrowUpRight size={14} /></Link>
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
