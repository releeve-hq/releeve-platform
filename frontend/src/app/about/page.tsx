'use client';

import { useAuth } from '@/lib/auth-context';
import { LandingPageShell } from '@/components/landing/landing-page-shell';

const stats = [
  { value: '50+', label: 'Active projects' },
  { value: '$2.5M', label: 'Bounties awarded' },
  { value: '1000+', label: 'Contributors' },
  { value: '10x', label: 'Faster development' },
];

const principles = [
  {
    title: 'Decentralized Contributions',
    description: 'Releeve connects Stellar projects with developers through a transparent, on-chain bounty system. Anyone can contribute and earn USDC rewards for solving real problems.',
  },
  {
    title: 'Reputation that Travels',
    description: 'Your GitHub activity on Releeve-powered projects builds a portable reputation. Use it to land direct-hire roles and freelance contracts across the ecosystem.',
  },
  {
    title: 'Built for Stellar',
    description: 'Every bounty is funded in USDC on the Stellar network. Fast settlement, low fees, and global accessibility — no bank account required.',
  },
];

function AboutContent() {
  return (
    <div className="max-w-[1200px] mx-auto px-6 lg:px-12 py-16 lg:py-24">
      <div className="max-w-3xl mb-20">
        <h1 className="text-[clamp(2rem,5vw,3.5rem)] font-display leading-[0.9] tracking-tight mb-6">
          <span className="block">Connecting Stellar</span>
          <span className="block">
            <span className="relative inline-block">
              builders
              <span className="absolute -bottom-3 left-0 right-0 h-4" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 16'%3E%3Cpath d='M0,8 Q12.5,1 25,8 T50,8 T75,8 T100,8' fill='none' stroke='%2386efac' stroke-width='3' stroke-linecap='round'/%3E%3C/svg%3E")`, backgroundRepeat: 'repeat-x', backgroundSize: '100px 16px', opacity: 0.5 }} />
            </span>
            {' '}with opportunities
          </span>
        </h1>
        <p className="text-lg text-muted-foreground leading-relaxed max-w-xl">
          Releeve is a dual-sided marketplace for Stellar development: funded bounties for getting work done,
          and direct hiring based on real GitHub activity. We believe the best way to evaluate a developer
          is by what they&apos;ve already built.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 mb-20">
        {stats.map(s => (
          <div key={s.label}>
            <div className="text-4xl lg:text-5xl font-display mb-2">{s.value}</div>
            <div className="text-sm text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-20">
        {principles.map(p => (
          <div key={p.title}>
            <h2 className="text-xl font-display mb-3">{p.title}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">{p.description}</p>
          </div>
        ))}
      </div>

      <div className="border-t border-border pt-12">
        <p className="text-sm text-muted-foreground">
          Ready to start building?{' '}
          <a href="/projects" className="text-foreground underline underline-offset-4 hover:opacity-70 transition-opacity">
            Browse projects
          </a>
          .
        </p>
      </div>
    </div>
  );
}

export default function AboutPage() {
  const { accessToken } = useAuth();

  if (accessToken) {
    return <AboutContent />;
  }

  return (
    <LandingPageShell>
      <AboutContent />
    </LandingPageShell>
  );
}
