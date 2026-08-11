import React from 'react';
import { MarketingShell } from '@/components/marketing/site-shell';

export type LegalSection = {
  heading: string;
  paragraphs: React.ReactNode[];
};

type LegalPageProps = {
  title: string;
  lastUpdated: string;
  intro: string;
  sections: LegalSection[];
};

function LegalContent({ title, lastUpdated, intro, sections }: LegalPageProps) {
  return (
    <article className="legal-content marketing-frame">
      <p className="marketing-section-index">Legal</p>
      <h1>{title}</h1>
      <p className="legal-updated">Last updated: {lastUpdated}</p>
      <p className="legal-intro">{intro}</p>

      <div className="legal-sections">
        {sections.map(section => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            {section.paragraphs.map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </section>
        ))}
      </div>
    </article>
  );
}

export default function LegalPage(props: LegalPageProps) {
  return (
    <MarketingShell>
      <LegalContent {...props} />
    </MarketingShell>
  );
}
