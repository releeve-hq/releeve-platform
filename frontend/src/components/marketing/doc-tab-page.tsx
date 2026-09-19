import Link from "next/link";
import { ArrowLeft, ArrowRight, Info } from "lucide-react";
import { sectionId, type DocTab } from "./docs-data";

export function DocTabPage({ tab }: { tab: DocTab }) {
  return (
    <article className="doc-article">
      <p className="marketing-section-index">{tab.label}</p>
      <h1>{tab.label}</h1>
      <p className="doc-lead">{tab.description}</p>
      {tab.sections.map((section) => (
        <section id={sectionId(section.heading)} className="doc-section" key={section.heading}>
          <h2>{section.heading}</h2>
          {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          {section.bullets && <ul>{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}
          {section.code && <pre><code>{section.code}</code></pre>}
          {section.note && <div className="doc-note"><Info size={15} /><p>{section.note}</p></div>}
        </section>
      ))}
      <div className="doc-bottom-nav">
        <Link href="/docs"><ArrowLeft size={14} /> Documentation home</Link>
        <Link href="/signup">Talk to us <ArrowRight size={14} /></Link>
      </div>
    </article>
  );
}
