'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ReleeveLogo } from '@/components/ui/releeve-logo';
import { api, ApiError } from '@/lib/api';

type Organization = {
  slug: string;
  name: string | null;
  is_personal: boolean;
};

export default function OnboardingPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function chooseWorkspace() {
      try {
        const organizations = await api.get<Organization[]>('/api/v1/me/organizations');
        if (cancelled) return;

        const namedOrganizations = organizations.filter((organization) => !organization.is_personal);
        const remembered = localStorage.getItem('releeve-active-workspace');
        let rememberedSlug: string | undefined;
        if (remembered) {
          try {
            rememberedSlug = JSON.parse(remembered).organization;
          } catch {
            rememberedSlug = undefined;
          }
        }

        const organization = namedOrganizations.find((item) => item.slug === rememberedSlug) ?? namedOrganizations[0];
        router.replace(organization ? `/organizations/${encodeURIComponent(organization.slug)}` : '/organizations/new');
      } catch (reason) {
        if (!cancelled) {
          setError(reason instanceof ApiError ? reason.message : 'Unable to load your workspace.');
        }
      }
    }

    void chooseWorkspace();
    return () => { cancelled = true; };
  }, [router]);

  return (
    <main className="onboarding-loading">
      <div className="onboarding-loading-brand"><ReleeveLogo size={28} /><span>Releeve</span></div>
      <div className="onboarding-loading-content">
        <div className="onboarding-spinner" aria-hidden="true" />
        <h1>{error ? 'Workspace unavailable' : 'Preparing your workspace'}</h1>
        <p>{error ?? 'Taking you to your organization.'}</p>
        {error && <button type="button" onClick={() => window.location.reload()}>Try again</button>}
      </div>
      <style jsx>{`
        .onboarding-loading { min-height: 100dvh; padding: 28px 32px; background: #121212; color: #f5f5f5; font-family: var(--font-inter), system-ui, sans-serif; }
        .onboarding-loading-brand { display: flex; align-items: center; gap: 9px; font-size: 16px; font-weight: 650; }
        .onboarding-loading-content { min-height: calc(100dvh - 100px); display: grid; place-content: center; justify-items: center; text-align: center; }
        .onboarding-spinner { width: 24px; height: 24px; margin-bottom: 20px; border: 2px solid #2b2b2b; border-top-color: #f5f5f5; border-radius: 50%; animation: onboarding-spin .7s linear infinite; }
        h1 { margin: 0; font-size: 20px; line-height: 1.3; }
        p { max-width: 360px; margin: 8px 0 0; color: #a1a1a1; font-size: 14px; }
        button { margin-top: 18px; min-height: 38px; padding: 0 14px; border: 1px solid #3a3a3a; border-radius: 7px; background: #1e1e1e; color: #f5f5f5; font: inherit; cursor: pointer; }
        @keyframes onboarding-spin { to { transform: rotate(360deg); } }
        @media (max-width: 540px) { .onboarding-loading { padding: 22px 20px; } }
      `}</style>
    </main>
  );
}
