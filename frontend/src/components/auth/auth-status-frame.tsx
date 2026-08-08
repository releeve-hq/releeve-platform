import Link from 'next/link';
import type { ReactNode } from 'react';
import { ReleeveLogo } from '@/components/ui/releeve-logo';

export function AuthStatusFrame({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="auth-page">
      <div className="auth-form-wrapper">
        <header className="auth-topbar">
          <Link className="auth-brand" href="/" aria-label="Releeve home">
            <ReleeveLogo size={28} />
            <span>Releeve</span>
          </Link>
        </header>
        <section className="auth-card auth-status-card" aria-live="polite">
          <h1 className="auth-headline">{title}</h1>
          <p className="auth-description">{description}</p>
          {children}
        </section>
      </div>
    </main>
  );
}
