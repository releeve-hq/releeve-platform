"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { docTabs } from "./docs-data";

export function DocsTabs() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);

  const rest = pathname.replace(/^\/docs\/?/, "").split("/")[0];
  const onDocs = pathname.startsWith("/docs");
  const active = onDocs && docTabs.some((tab) => tab.slug === rest) ? rest : "";

  useLayoutEffect(() => {
    const nav = navRef.current;
    const indicator = indicatorRef.current;
    if (!nav || !indicator) return;
    const el = nav.querySelector<HTMLAnchorElement>(`a[data-active="true"]`);
    if (el) {
      indicator.style.width = `${el.offsetWidth}px`;
      indicator.style.transform = `translateX(${el.offsetLeft}px)`;
    }
  }, [active]);

  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const tabs = [{ slug: "", label: "Documentation" }, ...docTabs];

  return (
    <nav className="docs-tabs" ref={navRef} aria-label="Documentation sections" data-ready={ready}>
      {tabs.map((tab) => (
        <Link
          className="docs-tab"
          href={tab.slug ? `/docs/${tab.slug}` : "/docs"}
          key={tab.slug}
          data-active={active === tab.slug}
        >
          {tab.label}
        </Link>
      ))}
      <span className="docs-tabs-indicator" ref={indicatorRef} aria-hidden="true" />
    </nav>
  );
}