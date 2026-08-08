'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ReleeveLogo } from '@/components/ui/releeve-logo';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

type Organization = {
  id: string;
  slug: string;
  name: string | null;
  is_personal: boolean;
};

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export default function OnboardingPage() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrg, setSelectedOrg] = useState('');
  const [newOrg, setNewOrg] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectSlug, setProjectSlug] = useState('');
  const [network, setNetwork] = useState('testnet');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<Organization[]>('/api/v1/me/organizations')
      .then((items) => {
        if (cancelled) return;
        setOrganizations(items);
        setSelectedOrg(items[0]?.slug ?? '');
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof ApiError ? reason.message : 'Unable to load your workspaces.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const selected = useMemo(() => organizations.find((org) => org.slug === selectedOrg), [organizations, selectedOrg]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    if (!projectName.trim()) {
      setError('Give your first project a name.');
      return;
    }
    if (newOrg && !orgName.trim()) {
      setError('Give the organization a name.');
      return;
    }
    if (!newOrg && !selected) {
      setError('Select an organization or create a new one.');
      return;
    }

    setSubmitting(true);
    try {
      const organization = newOrg
        ? await api.post<Organization>('/api/v1/organizations', { name: orgName.trim(), slug: orgSlug || undefined })
        : selected!;
      const project = await api.post<{ slug: string }>('/api/v1/' + encodeURIComponent(organization.slug) + '/projects', {
        name: projectName.trim(),
        slug: projectSlug || undefined,
        network,
      });
      localStorage.setItem('releeve-active-workspace', JSON.stringify({ organization: organization.slug, project: project.slug, network }));
      router.replace('/dashboard');
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Unable to create your workspace.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="onboarding-page">
      <section className="onboarding-panel">
        <header className="onboarding-topbar">
          <div className="onboarding-brand"><ReleeveLogo size={28} /><span>Releeve</span></div>
          <button type="button" onClick={() => logout()} className="onboarding-link">Sign out</button>
        </header>
        <div className="onboarding-content">
          <p className="onboarding-kicker">Welcome{user?.name ? `, ${user.name}` : ''}</p>
          <h1>Set up your first project.</h1>
          <p className="onboarding-copy">Your project is the private home for simulations, tracked contracts, investigations, and team work.</p>

          {loading ? <p className="onboarding-muted">Loading your workspaces...</p> : (
            <form onSubmit={submit}>
              <fieldset className="onboarding-fieldset">
                <legend>Organization</legend>
                {organizations.length > 0 && !newOrg && <div className="onboarding-org-list">
                  {organizations.map((organization) => <label key={organization.id} className="onboarding-org-option">
                    <input type="radio" name="organization" checked={selectedOrg === organization.slug} onChange={() => setSelectedOrg(organization.slug)} />
                    <span><strong>{organization.name || organization.slug}</strong><small>{organization.is_personal ? 'Personal workspace' : organization.slug}</small></span>
                  </label>)}
                </div>}
                <button className="onboarding-link onboarding-create-link" type="button" onClick={() => setNewOrg((value) => !value)}>
                  {newOrg ? 'Use an existing organization' : 'Create a new organization'}
                </button>
                {newOrg && <div className="onboarding-grid">
                  <label>Name<input value={orgName} onChange={(event) => { setOrgName(event.target.value); if (!orgSlug) setOrgSlug(slugify(event.target.value)); }} placeholder="Organization name" /></label>
                  <label>Slug<input value={orgSlug} onChange={(event) => setOrgSlug(slugify(event.target.value))} placeholder="organization-name" /></label>
                </div>}
              </fieldset>

              <fieldset className="onboarding-fieldset">
                <legend>First project</legend>
                <div className="onboarding-grid">
                  <label>Project name<input value={projectName} onChange={(event) => { setProjectName(event.target.value); if (!projectSlug) setProjectSlug(slugify(event.target.value)); }} placeholder="Protocol workspace" /></label>
                  <label>Project slug<input value={projectSlug} onChange={(event) => setProjectSlug(slugify(event.target.value))} placeholder="protocol-workspace" /></label>
                  <label>Network<select value={network} onChange={(event) => setNetwork(event.target.value)}><option value="testnet">Testnet</option><option value="mainnet">Mainnet</option><option value="futurenet">Futurenet</option></select></label>
                </div>
              </fieldset>

              {error && <p className="onboarding-error" role="alert">{error}</p>}
              <button className="onboarding-submit" type="submit" disabled={submitting}>{submitting ? 'Creating workspace...' : 'Create project'}</button>
            </form>
          )}
        </div>
      </section>
      <style>{`
        .onboarding-page{min-height:100dvh;background:#0a0a0a;color:#fafafa;font-family:var(--font-inter),system-ui,sans-serif;padding:0 24px}.onboarding-panel{width:min(100%,680px);margin:0 auto}.onboarding-topbar{height:96px;display:flex;align-items:center;justify-content:space-between}.onboarding-brand{display:flex;align-items:center;gap:9px;font-weight:650}.onboarding-link{border:0;background:transparent;color:#a1a1aa;font:inherit;font-size:13px;cursor:pointer}.onboarding-content{padding:clamp(44px,12vh,128px) 0 64px}.onboarding-kicker{margin:0 0 10px;color:#22c55e;font-size:13px;font-weight:650}.onboarding-content h1{margin:0;font-size:32px;line-height:1.15;letter-spacing:0}.onboarding-copy{max-width:510px;margin:14px 0 32px;color:#a1a1aa;line-height:1.65;font-size:14px}.onboarding-muted{color:#71717a}.onboarding-fieldset{margin:0 0 22px;padding:0;border:0}.onboarding-fieldset legend{margin-bottom:11px;color:#d4d4d8;font-size:13px;font-weight:650}.onboarding-org-list{display:grid;gap:8px}.onboarding-org-option{display:flex;gap:10px;align-items:center;padding:12px;border:1px solid #27272a;border-radius:8px;background:#111113;cursor:pointer}.onboarding-org-option input{accent-color:#22c55e}.onboarding-org-option strong,.onboarding-org-option small{display:block}.onboarding-org-option strong{font-size:14px}.onboarding-org-option small{margin-top:3px;color:#71717a;font-size:12px}.onboarding-create-link{margin-top:12px;color:#d4d4d8;text-decoration:underline}.onboarding-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.onboarding-grid label{display:grid;gap:7px;color:#a1a1aa;font-size:12px}.onboarding-grid input,.onboarding-grid select{height:42px;border:1px solid #27272a;border-radius:8px;background:#111113;color:#fafafa;padding:0 11px;font:inherit;font-size:14px;outline:none}.onboarding-grid input:focus,.onboarding-grid select:focus{border-color:#52525b;box-shadow:0 0 0 3px rgba(113,113,122,.18)}.onboarding-error{margin:0 0 14px;color:#fca5a5;font-size:13px}.onboarding-submit{height:44px;padding:0 18px;border:0;border-radius:8px;background:#fff;color:#0a0a0a;font:inherit;font-size:14px;font-weight:650;cursor:pointer}.onboarding-submit:disabled{opacity:.6;cursor:wait}@media(max-width:540px){.onboarding-page{padding:0 20px}.onboarding-grid{grid-template-columns:1fr}.onboarding-content{padding-top:60px}.onboarding-content h1{font-size:28px}}
      `}</style>
    </main>
  );
}
