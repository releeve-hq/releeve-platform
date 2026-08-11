"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Search } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { docsNav } from "./docs-data";

export function DocsFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return docsNav;
    return docsNav.filter((item) => `${item.label} ${item.description}`.toLowerCase().includes(normalized));
  }, [query]);

  return (
    <div className="docs-shell marketing-frame">
      <aside className="docs-sidebar">
        <Link className="docs-sidebar-title" href="/docs"><BookOpen size={16} /> Documentation</Link>
        <label className="docs-search"><Search size={14} /><span className="sr-only">Search documentation</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter guides" /></label>
        <nav aria-label="Documentation">
          <Link href="/docs" data-active={pathname === "/docs"}>Overview</Link>
          {visible.map((item) => <Link key={item.slug} href={`/docs/${item.slug}`} data-active={pathname === `/docs/${item.slug}`}>{item.label}</Link>)}
          {!visible.length && <span className="docs-no-results">No matching guides</span>}
        </nav>
      </aside>
      <div className="docs-mobile-nav">
        <details>
          <summary>Documentation sections</summary>
          <Link href="/docs">Overview</Link>
          {docsNav.map((item) => <Link key={item.slug} href={`/docs/${item.slug}`}>{item.label}</Link>)}
        </details>
      </div>
      <div className="docs-content">{children}</div>
    </div>
  );
}
