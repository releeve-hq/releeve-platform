"use client";

import { useCallback, useEffect, useState } from "react";
import { sectionId, type DocSection } from "./docs-data";

export function DocOnPage({ sections }: { sections: DocSection[] }) {
  const [active, setActive] = useState(sections[0] ? sectionId(sections[0].heading) : "");

  useEffect(() => {
    const nodes = sections.map((section) => document.getElementById(sectionId(section.heading))).filter(Boolean) as HTMLElement[];
    if (!nodes.length) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id);
    }, { rootMargin: "-10% 0px -72% 0px", threshold: [0, .1, .5] });
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [sections]);

  const goTo = useCallback((id: string) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.history.replaceState(null, "", `${window.location.pathname}#${id}`);
  }, []);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash && sections.some((section) => sectionId(section.heading) === hash)) requestAnimationFrame(() => goTo(hash));
  }, [goTo, sections]);

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