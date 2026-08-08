'use client';

import React from 'react';
import { useAuth } from '@/lib/auth-context';
import { LandingPageShell } from '@/components/landing/landing-page-shell';

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
    <div className="max-w-3xl mx-auto px-6 lg:px-12 py-16 lg:py-24">
      <h1 className="text-3xl lg:text-4xl font-display tracking-tight mb-4">{title}</h1>
      <p className="text-sm text-muted-foreground mb-8">Last updated: {lastUpdated}</p>
      <p className="text-muted-foreground leading-relaxed mb-12">{intro}</p>

      <div className="space-y-10">
        {sections.map(section => (
          <section key={section.heading}>
            <h2 className="text-xl font-display mb-3">{section.heading}</h2>
            {section.paragraphs.map((paragraph, i) => (
              <p key={i} className="text-sm text-muted-foreground leading-relaxed mb-3">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

export default function LegalPage(props: LegalPageProps) {
  const { accessToken } = useAuth();

  if (accessToken) {
    return <LegalContent {...props} />;
  }

  return (
    <LandingPageShell>
      <LegalContent {...props} />
    </LandingPageShell>
  );
}
