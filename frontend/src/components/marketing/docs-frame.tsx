"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { docsNav, docsTree, getDocGuide, getDocTab, getTreePages } from "./docs-data";
import { getDocsQuery, subscribeDocsQuery } from "./docs-search-store";
import { DocOnPage } from "./doc-on-page";
import { DocsTabs } from "./docs-tabs";
import { DocsSidebarTree } from "./docs-sidebar-tree";

export function DocsFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [query, setQuery] = useState(getDocsQuery());

  useEffect(() => subscribeDocsQuery(setQuery), []);

  const rest = pathname.replace(/^\/docs\/?/, "");
  const guide = getDocGuide(rest);
  const tab = guide ? undefined : getDocTab(rest);

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return docsNav;
    return docsNav.filter((item) => `${item.label} ${item.description}`.toLowerCase().includes(normalized));
  }, [query]);

  const sidebar = tab
    ? <nav aria-label={tab.label}>{tab.nav.map((item) => <Link key={item.slug} href={`#${item.slug}`}>{item.label}</Link>)}</nav>
    : (
      <nav aria-label="Documentation">
        <Link href="/docs" data-active={pathname === "/docs"}>Overview</Link>
        {query.trim()
          ? (
            <>
              {visible.map((item) => <Link key={item.slug} href={`/docs/${item.slug}`} data-active={pathname === `/docs/${item.slug}`}>{item.label}</Link>)}
              {!visible.length && <span className="docs-no-results">No matching guides</span>}
            </>
          )
          : (
            <DocsSidebarTree items={docsTree} activeSlug={guide ? guide.slug : ""} />
          )}
      </nav>
    );

  const mobile = tab
    ? <Link href="/docs">Documentation</Link>
    : <Link href="/docs">Overview</Link>;

  return (
    <div className="docs-frame-wrap">
      <DocsTabs />
      <div className="docs-shell marketing-frame">
        <aside className="docs-sidebar">{sidebar}</aside>
        <div className="docs-mobile-nav">
          <details>
            <summary>{tab ? tab.label : "Documentation sections"}</summary>
            {tab
              ? tab.nav.map((item) => <Link key={item.slug} href={`#${item.slug}`}>{item.label}</Link>)
              : (
                <>
                  {mobile}
                  {getTreePages(docsTree).map((item) => <Link key={item.slug} href={`/docs/${item.slug}`}>{item.label}</Link>)}
                </>
              )}
          </details>
        </div>
        <div className="docs-content">{children}</div>
        {guide && <DocOnPage sections={guide.sections} />}
        {tab && <DocOnPage sections={tab.sections} />}
      </div>
    </div>
  );
}