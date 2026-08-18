"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { type DocsTreeItem } from "./docs-data";

function openKeysFor(slug: string, items: DocsTreeItem[], base: string[]): string[] {
  const keys: string[] = [];
  for (const item of items) {
    if (item.type === "group") {
      const next = [...base, item.label];
      const childKeys = openKeysFor(slug, item.children, next);
      if (childKeys.length) keys.push(next.join("/"), ...childKeys);
    } else if (item.type === "page" && item.slug === slug) {
      keys.push(...base);
    }
  }
  return keys;
}

export function DocsSidebarTree({ items, activeSlug }: { items: DocsTreeItem[]; activeSlug: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const key of openKeysFor(activeSlug, items, [])) initial[key] = true;
    return initial;
  });

  const active = activeSlug || (pathname.startsWith("/docs") ? "" : "");

  const toggle = (key: string) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  const renderItems = (nodes: DocsTreeItem[], depth: number, base: string[]) => nodes.map((item) => {
    if (item.type === "label") {
      return <span className="docs-tree-label" key={`label:${item.label}`}>{item.label}</span>;
    }
    if (item.type === "page") {
      return (
        <Link
          className="docs-tree-link"
          key={`page:${item.slug}`}
          href={`/docs/${item.slug}`}
          data-active={active === item.slug}
          style={{ "--docs-tree-depth": depth } as React.CSSProperties}
        >
          {item.label}
        </Link>
      );
    }
    const key = [...base, item.label].join("/");
    const expanded = !!open[key];
    return (
      <div className="docs-tree-group" key={`group:${key}`} style={{ "--docs-tree-depth": depth } as React.CSSProperties}>
        <button type="button" className="docs-tree-toggle" onClick={() => toggle(key)} aria-expanded={expanded}>
          <ChevronRight size={14} className={`docs-tree-chevron${expanded ? " expanded" : ""}`} />
          <span>{item.label}</span>
        </button>
        {expanded && (
          <div className="docs-tree-children">
            {renderItems(item.children, depth + 1, [...base, item.label])}
          </div>
        )}
      </div>
    );
  });

  return <>{renderItems(items, 0, [])}</>;
}