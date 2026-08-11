import Link from "next/link";
import { ArrowLeft, ArrowRight, ExternalLink, Info } from "lucide-react";
import type { DocGuide } from "./docs-data";

export function DocGuidePage({ guide, apiDocsUrl }: { guide: DocGuide; apiDocsUrl?: string }) {
  return (
    <article className="doc-article">
      <p className="marketing-section-index">Releeve documentation</p>
      <h1>{guide.label}</h1>
      <p className="doc-lead">{guide.description}</p>
      {guide.slug === "api-reference" && apiDocsUrl && (
        <a className="doc-api-link" href={apiDocsUrl} target="_blank" rel="noreferrer">Open interactive API reference <ExternalLink size={14} /></a>
      )}
      <div className="doc-on-page">
        <span>On this page</span>
        {guide.sections.map((section) => <a href={`#${toId(section.heading)}`} key={section.heading}>{section.heading}</a>)}
      </div>
      {guide.sections.map((section) => (
        <section id={toId(section.heading)} className="doc-section" key={section.heading}>
          <h2>{section.heading}</h2>
          {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          {section.bullets && <ul>{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}
          {section.code && <pre><code>{section.code}</code></pre>}
          {section.note && <div className="doc-note"><Info size={15} /><p>{section.note}</p></div>}
        </section>
      ))}
      <div className="doc-bottom-nav">
        <Link href="/docs"><ArrowLeft size={14} /> Documentation home</Link>
        <Link href="/signup">Create account <ArrowRight size={14} /></Link>
      </div>
    </article>
  );
}

function toId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
