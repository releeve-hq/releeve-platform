'use client';

import { useLayoutEffect } from 'react';
import { Navigation } from './navigation';

export function LandingPageShell({ children }: { children: React.ReactNode }) {
  useLayoutEffect(() => {
    document.documentElement.classList.add('dark');
    return () => {
      document.documentElement.classList.remove('dark');
    };
  }, []);

  return (
    <>
      <Navigation />
      <main
        className="relative min-h-screen [overflow-x:clip] bg-background text-foreground"
        style={{ background: 'oklch(0.12 0.01 60)' }}
      >
        {/* Dotted grid overlay — matches hero section noise-overlay dots */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.55) 0.5px, transparent 0.5px)',
            backgroundSize: '3px 3px',
            opacity: 0.06,
            zIndex: 1,
          }}
        />

        {/* Grid lines — exact match to hero section */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ opacity: 0.30, zIndex: 2 }}>
          {[...Array(8)].map((_, i) => (
            <div
              key={`h-${i}`}
              className="absolute h-px"
              style={{
                top: `${12.5 * (i + 1)}%`,
                left: 0,
                right: 0,
                background: 'rgba(255,255,255,0.10)',
              }}
            />
          ))}
          {[...Array(12)].map((_, i) => (
            <div
              key={`v-${i}`}
              className="absolute w-px"
              style={{
                left: `${8.33 * (i + 1)}%`,
                top: 0,
                bottom: 0,
                background: 'rgba(255,255,255,0.10)',
              }}
            />
          ))}
        </div>



        {/* Page content */}
        <div className="relative pt-24" style={{ zIndex: 10 }}>
          {children}
        </div>
      </main>
    </>
  );
}
