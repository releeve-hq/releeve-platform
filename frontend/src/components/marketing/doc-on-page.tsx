"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { sectionId, type DocSection } from "./docs-data";

export function DocOnPage({ sections }: { sections: DocSection[] }) {
  const ids = useMemo(() => sections.map((section) => sectionId(section.heading)), [sections]);
  const [active, setActive] = useState(ids[0] ?? "");

  useEffect(() => {
    const nodes = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    if (!nodes.length) return;

    let frame = 0;
    let current = nodes[0].id;

    const update = () => {
      frame = 0;
      const line = window.scrollY + window.innerHeight * 0.25;
      let next = nodes[0].id;
      for (const node of nodes) {
        if (node.getBoundingClientRect().top + window.scrollY <= line) next = node.id;
        else break;
      }
      if (next !== current) {
        current = next;
        setActive(next);
      }
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ids]);

  const goTo = useCallback((id: string) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.history.replaceState(null, "", `${window.location.pathname}#${id}`);
  }, []);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash && ids.includes(hash)) requestAnimationFrame(() => goTo(hash));
  }, [goTo, ids]);

  return (
    <nav className="doc-index" aria-label="On this page">
      <span>On this page</span>
      {sections.map((section) => {
        const id = sectionId(section.heading);
        return (
          <button key={id} type="button" className={active === id ? "active" : ""} onClick={() => goTo(id)} aria-current={active === id ? "location" : undefined}>
            {section.heading}
          </button>
        );
      })}
    </nav>
  );
}