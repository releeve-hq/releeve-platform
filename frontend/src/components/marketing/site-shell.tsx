import type { ReactNode } from "react";
import { MarketingFooter } from "./footer";
import { MarketingNavigation } from "./navigation";

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="marketing-site">
      <a className="marketing-skip-link" href="#main-content">
        Skip to content
      </a>
      <MarketingNavigation />
      <main id="main-content">{children}</main>
      <MarketingFooter />
    </div>
  );
}
