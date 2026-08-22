'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowDownUp,
  Boxes,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  CircleHelp,
  Grid2X2,
  Lightbulb,
  List,
  LoaderCircle,
  MoreVertical,
  Plus,
  Search,
  Settings,
  SquareStack,
  UsersRound,
  X,
} from 'lucide-react';
import { ReleeveLogo } from '@/components/ui/releeve-logo';
import { SharedProfileMenu } from '@/components/ui/shared-profile-menu';
import { api, ApiError } from '@/lib/api';

type Organization = {
  id: string;
  slug: string;
  name: string | null;
  avatar_url?: string | null;
  is_personal: boolean;
  plan_tier?: string;
  is_owner?: boolean;
};

type Project = {
  id: string;
  slug: string;
  name: string;
  network: 'mainnet' | 'testnet' | 'futurenet';
  created_at?: string;
};

type Paged<T> = { data: T[] };

const ACTIVE_WORKSPACE_KEY = 'releeve-active-workspace';

function rememberWorkspace(organization: string, project: Project) {
  localStorage.setItem(ACTIVE_WORKSPACE_KEY, JSON.stringify({
    organization,
    project: project.slug,
    network: project.network,
  }));
}

function formatCreated(value?: string) {
  if (!value) return 'Just now';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof ApiError || reason instanceof Error ? reason.message : fallback;
}

function IconButton({ label, children, onClick }: { label: string; children: React.ReactNode; onClick?: () => void }) {
  return <button className="org-icon-button" type="button" aria-label={label} title={label} onClick={onClick}>{children}</button>;
}

function CompactSelect({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="org-compact-select" ref={rootRef}>
      <button className="org-select-trigger" type="button" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span>{selected?.label ?? value}</span>
        <ChevronDown className={`org-select-chevron${open ? ' open' : ''}`} size={15} />
      </button>
      {open && <div className="org-select-menu" role="listbox" aria-label={ariaLabel}>
        {options.map((option) => <button className={`org-select-option${option.value === value ? ' selected' : ''}`} type="button" role="option" aria-selected={option.value === value} key={option.value} onClick={() => { onChange(option.value); setOpen(false); }}>
          <span>{option.label}</span>{option.value === value && <span className="org-select-check" aria-hidden="true"><Check size={10} strokeWidth={3} /></span>}
        </button>)}
      </div>}
    </div>
  );
}

function OrganizationHeader({ title, organization }: { title: string; organization?: Organization | null }) {
  const router = useRouter();
  return (
    <header className="org-commandbar">
      <div className="org-commandbar-title">
        <ReleeveLogo size={27} />
        <span className="org-commandbar-slash">/</span>
        {organization ? (
          <button className="org-header-org" type="button" onClick={() => router.push('/organizations')}>
            <span className="org-header-avatar">{(organization.name || organization.slug).slice(0, 1).toUpperCase()}</span>
            <span>{organization.name || organization.slug}</span>
            <span className="org-plan-pill">{organization.plan_tier || 'Free'}</span>
            <ChevronDown size={14} />
          </button>
        ) : <span className="org-commandbar-name">{title}</span>}
      </div>
      <div className="org-commandbar-actions">
        <button className="org-feedback" type="button">Feedback</button>
        <button className="org-search-command" type="button"><Search size={17} /> <span>Search...</span><kbd>Ctrl K</kbd></button>
        <IconButton label="Help"><CircleHelp size={18} /></IconButton>
        <IconButton label="Tips"><Lightbulb size={18} /></IconButton>
        <SharedProfileMenu organization={organization} />
      </div>
    </header>
  );
}

function OrganizationSidebar({ active = 'projects' }: { active?: 'projects' | 'members' | 'settings' }) {
  const router = useRouter();
  return (
    <aside className="org-sidebar" aria-label="Organization navigation">
      <button className={`org-sidebar-item${active === 'projects' ? ' active' : ''}`} type="button" title="Projects" aria-label="Projects" onClick={() => router.push(window.location.pathname)}><Boxes size={20} /></button>
      <button className={`org-sidebar-item${active === 'members' ? ' active' : ''}`} type="button" title="Members" aria-label="Members"><UsersRound size={20} /></button>
      <button className="org-sidebar-item" type="button" title="Usage" aria-label="Usage"><ChartNoAxesCombined size={20} /></button>
      <button className="org-sidebar-item" type="button" title="Billing" aria-label="Billing"><SquareStack size={20} /></button>
      <button className={`org-sidebar-item org-sidebar-bottom${active === 'settings' ? ' active' : ''}`} type="button" title="Organization settings" aria-label="Organization settings" onClick={() => router.push('/settings/organization')}><Settings size={20} /></button>
    </aside>
  );
}

function OrganizationFrame({ children, title, organization, active }: { children: React.ReactNode; title: string; organization?: Organization | null; active?: 'projects' | 'members' | 'settings' }) {
  return <div className="org-product-shell"><style jsx global>{organizationStyles}</style><OrganizationHeader title={title} organization={organization} />{organization && <OrganizationSidebar active={active} />}{children}</div>;
}

export function OrganizationCreatePage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [type, setType] = useState('Personal');
  const [plan, setPlan] = useState('free');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const organization = await api.post<Organization>('/api/v1/organizations', { name: name.trim() });
      router.replace(`/organizations/${encodeURIComponent(organization.slug)}`);
    } catch (reason) {
      setError(errorMessage(reason, 'Unable to create this organization.'));
      setSubmitting(false);
    }
  }

  return (
    <OrganizationFrame title="New organization">
      <main className="org-create-page">
        <form className="org-create-card" onSubmit={submit}>
          <div className="org-create-intro">
            <h1>Create a new organization</h1>
            <p>Organizations are a way to group your projects. Each organization<br />can be configured with different team members and billing settings.</p>
          </div>
          <div className="org-create-row">
            <div><strong>Name</strong></div>
            <div><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Organization name" aria-label="Organization name" /><p>What&apos;s the name of your company or team? You can change this later.</p></div>
          </div>
          <div className="org-create-row">
            <div><strong>Type</strong></div>
            <div><CompactSelect value={type} onChange={setType} ariaLabel="Organization type" options={[{ value: 'Personal', label: 'Personal' }, { value: 'Company', label: 'Company' }, { value: 'Community', label: 'Community' }]} /><p>What best describes your organization?</p></div>
          </div>
          <div className="org-create-row">
            <div><strong>Plan</strong></div>
            <div><CompactSelect value={plan} onChange={setPlan} ariaLabel="Organization plan" options={[{ value: 'free', label: 'Free - $0/month' }]} /><p>Which plan fits your organization&apos;s needs best? <Link href="/pricing">Learn more.</Link></p></div>
          </div>
          {error && <div className="org-form-error" role="alert">{error}</div>}
          <div className="org-create-footer"><button className="org-secondary-button" type="button" onClick={() => router.back()}>Cancel</button><button className="org-primary-button" type="submit" disabled={!name.trim() || submitting}>{submitting ? <><LoaderCircle className="org-spin" size={16} />Creating...</> : 'Create organization'}</button></div>
        </form>
      </main>
    </OrganizationFrame>
  );
}

export function OrganizationListPage() {
  const router = useRouter();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Organization[]>('/api/v1/me/organizations').then(setOrganizations).catch((reason) => setError(errorMessage(reason, 'Unable to load organizations.'))).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => organizations.filter((organization) => `${organization.name || ''} ${organization.slug}`.toLowerCase().includes(query.toLowerCase().trim())), [organizations, query]);

  return (
    <OrganizationFrame title="Organizations">
      <main className="org-list-page">
        <div className="org-list-heading"><h1>Your Organizations</h1><button className="org-primary-button" type="button" onClick={() => router.push('/organizations/new')}><Plus size={17} />New organization</button></div>
        <div className="org-list-toolbar"><label className="org-list-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search for an organization" aria-label="Search for an organization" /></label></div>
        {error && <div className="org-form-error" role="alert">{error}</div>}
        {loading ? <div className="org-list-loading"><LoaderCircle className="org-spin" size={20} />Loading organizations...</div> : <div className="org-card-grid">{filtered.map((organization) => <button className="org-card" type="button" key={organization.id} onClick={() => router.push(`/organizations/${encodeURIComponent(organization.slug)}`)}><span className="org-card-avatar">{(organization.name || organization.slug).slice(0, 1).toUpperCase()}</span><span className="org-card-copy"><strong>{organization.name || organization.slug}</strong><small>{organization.plan_tier ? `${organization.plan_tier[0].toUpperCase()}${organization.plan_tier.slice(1)} Plan` : 'Free Plan'}{organization.is_personal ? ' - Personal' : ''}</small></span></button>)}</div>}
        {!loading && !filtered.length && <div className="org-empty-list">No organizations match your search.</div>}
      </main>
    </OrganizationFrame>
  );
}

function UsagePanel() {
  const rows = [['EGRESS', '0 GB', '/ 5 GB'], ['DATABASE SIZE', '0 GB', '/ 500 MB'], ['MONTHLY ACTIVE USERS', '0', '/ 50,000'], ['FILE STORAGE', '0 GB', '/ 1 GB']];
  return <aside className="org-usage-panel"><div className="org-usage-heading"><div><h2>Free plan usage</h2><p>Current billing cycle</p></div><button className="org-upgrade-button" type="button">Upgrade to Pro</button></div><div className="org-usage-rows">{rows.map(([label, current, limit]) => <div className="org-usage-row" key={label}><span className="org-usage-ring" /><span className="org-usage-label">{label}</span><strong>{current}</strong><span className="org-usage-limit">{limit}</span></div>)}</div></aside>;
}

function CreateProjectModal({ organization, onCreated, onClose }: { organization: Organization; onCreated: (project: Project) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [network, setNetwork] = useState<Project['network']>('testnet');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const project = await api.post<Project>(`/api/v1/${encodeURIComponent(organization.slug)}/projects`, { name: name.trim(), network });
      onCreated(project);
    } catch (reason) {
      setError(errorMessage(reason, 'Unable to create this project.'));
      setBusy(false);
    }
  }
  return <div className="org-modal-backdrop" role="presentation"><div className="org-modal" role="dialog" aria-modal="true" aria-labelledby="new-project-title"><button className="org-modal-close" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button><h2 id="new-project-title">Create a project</h2><p>Projects keep simulations, contracts, and investigations organized.</p><form onSubmit={submit}><label>Project name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Project name" /></label><label>Network<CompactSelect value={network} onChange={(value) => setNetwork(value as Project['network'])} ariaLabel="Project network" options={[{ value: 'testnet', label: 'Testnet' }, { value: 'mainnet', label: 'Mainnet' }, { value: 'futurenet', label: 'Futurenet' }]} /></label>{error && <div className="org-form-error">{error}</div>}<button className="org-primary-button org-modal-submit" type="submit" disabled={!name.trim() || busy}>{busy ? 'Creating...' : 'Create project'}</button></form></div></div>;
}

export function OrganizationProjectPage({ slug }: { slug: string }) {
  const router = useRouter();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('status');
  const [view, setView] = useState<'grid' | 'list'>('list');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<Organization>(`/api/v1/${encodeURIComponent(slug)}`),
      api.get<Paged<Project>>(`/api/v1/${encodeURIComponent(slug)}/projects?limit=100`),
    ]).then(([org, page]) => {
      if (cancelled) return;
      setOrganization(org);
      setProjects(page.data ?? []);
      if (page.data?.[0]) rememberWorkspace(slug, page.data[0]);
    }).catch((reason) => { if (!cancelled) setError(errorMessage(reason, 'Unable to load this organization.')); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug]);

  const filtered = useMemo(() => projects.filter((project) => {
    const matchesQuery = `${project.name} ${project.slug} ${project.network}`.toLowerCase().includes(query.toLowerCase().trim());
    const matchesStatus = statusFilter === 'status' || statusFilter === 'paused';
    return matchesQuery && matchesStatus;
  }), [projects, query, statusFilter]);

  if (loading) return <OrganizationFrame title="Organization"><div className="org-page-loading"><LoaderCircle className="org-spin" size={22} />Loading organization...</div></OrganizationFrame>;
  if (!organization) return <OrganizationFrame title="Organization"><div className="org-page-loading"><p>{error || 'Organization not found.'}</p><button className="org-secondary-button" type="button" onClick={() => router.push('/organizations')}>Back to organizations</button></div></OrganizationFrame>;

  return <OrganizationFrame title="Projects" organization={organization}>
    <main className="org-project-page">
      <div className="org-project-heading"><h1>Projects</h1></div>
      <div className="org-project-layout"><section className="org-project-main"><div className="org-project-toolbar"><label className="org-project-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search for a project" aria-label="Search for a project" /></label><CompactSelect value={statusFilter} onChange={setStatusFilter} ariaLabel="Project status" options={[{ value: 'status', label: 'Status' }, { value: 'paused', label: 'Paused' }, { value: 'active', label: 'Active' }]} /><button className="org-filter-button" type="button"><ArrowDownUp size={15} />Sorted by name</button><div className="org-view-toggle"><IconButton label="Grid view" onClick={() => setView('grid')}><Grid2X2 size={17} /></IconButton><IconButton label="List view" onClick={() => setView('list')}><List size={18} /></IconButton></div><button className="org-primary-button" type="button" onClick={() => setModalOpen(true)}><Plus size={17} />New project</button></div>{error && <div className="org-form-error">{error}</div>}{filtered.length ? <div className={`org-project-table${view === 'grid' ? ' org-project-grid' : ''}`}><div className="org-project-table-head"><span>PROJECT</span><span>STATUS</span><span>COMPUTE</span><span>REGION</span><span>CREATED</span><span /></div>{filtered.map((project) => <button className="org-project-row" type="button" key={project.id} onClick={() => { rememberWorkspace(slug, project); router.push('/home'); }}><span className="org-project-name"><strong>{project.name}</strong><small>{project.slug}</small></span><span><em className="org-status-pill">PAUSED</em></span><span>-</span><span className="org-project-region">{project.network}</span><span>{formatCreated(project.created_at)}</span><span onClick={(event) => event.stopPropagation()}><MoreVertical size={18} /></span></button>)}</div> : <div className="org-project-empty"><SquareStack size={34} /><h2>Create a project</h2><p>Launch a complete backend built on Stellar.</p><button className="org-secondary-button" type="button" onClick={() => setModalOpen(true)}><Plus size={17} />New project</button></div>}</section><UsagePanel /></div>
    </main>
    {modalOpen && <CreateProjectModal organization={organization} onClose={() => setModalOpen(false)} onCreated={(project) => { setProjects((current) => [project, ...current]); setModalOpen(false); rememberWorkspace(slug, project); }} />}
  </OrganizationFrame>;
}

const organizationStyles = `
  .org-product-shell {
    --org-bg: #121212;
    --org-panel: #181818;
    --org-panel-2: #1e1e1e;
    --org-line: #2b2b2b;
    --org-text: #f5f5f5;
    --org-muted: #a1a1a1;
    --org-faint: #707070;
    --org-green: #22c55e;
    min-height: 100dvh;
    background: var(--org-bg);
    color: var(--org-text);
    font-family: var(--font-inter), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 14px;
  }
  .org-product-shell *, .org-product-shell *::before, .org-product-shell *::after { box-sizing: border-box; }
  .org-product-shell button, .org-product-shell input, .org-product-shell select { font: inherit; }
  .org-product-shell button { color: inherit; }
  .org-commandbar { position: relative; z-index: 10; display: flex; min-height: 52px; align-items: center; justify-content: space-between; gap: 18px; padding: 0 16px; border-bottom: 1px solid var(--org-line); background: var(--org-bg); }
  .org-commandbar-title, .org-commandbar-actions, .org-header-org, .org-search-command, .org-feedback { display: flex; align-items: center; }
  .org-commandbar-title { min-width: 0; gap: 8px; }
  .org-commandbar-slash { color: var(--org-faint); font-size: 16px; font-weight: 300; }
  .org-commandbar-name { color: var(--org-text); font-size: 14px; font-weight: 600; white-space: nowrap; }
  .org-header-org { gap: 6px; border: 0; background: transparent; padding: 0; color: var(--org-text); font-size: 14px; font-weight: 600; cursor: pointer; white-space: nowrap; }
  .org-header-avatar, .org-card-avatar { display: inline-grid; place-items: center; flex: 0 0 auto; border: 1px solid var(--org-line); border-radius: 50%; background: var(--org-panel-2); color: var(--org-text); font-weight: 650; }
  .org-header-avatar { width: 28px; height: 28px; font-size: 12px; }
  .org-plan-pill { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border: 1px solid var(--org-line); border-radius: 999px; color: var(--org-muted); font-size: 10px; font-weight: 650; text-transform: uppercase; }
  .org-commandbar-actions { gap: 8px; color: var(--org-muted); font-size: 12.5px; }
  .org-feedback { border: 0; background: transparent; padding: 6px; color: var(--org-muted); cursor: pointer; }
  .org-search-command { width: 184px; height: 32px; justify-content: flex-start; gap: 8px; padding: 0 10px; border: 1px solid var(--org-line); border-radius: 999px; background: var(--org-panel); color: var(--org-muted); cursor: pointer; }
  .org-search-command span { flex: 1; text-align: left; }
  .org-search-command kbd { color: var(--org-faint); font-size: 11px; }
  .org-icon-button { display: inline-grid; width: 32px; height: 32px; place-items: center; padding: 0; border: 1px solid var(--org-line); border-radius: 50%; background: transparent; color: var(--org-muted); cursor: pointer; }
  .org-icon-button:hover, .org-sidebar-item:hover { border-color: #444; color: var(--org-text); background: var(--org-panel); }
  .org-account-dot { width: 20px; height: 20px; border: 2px solid currentColor; border-radius: 50%; position: relative; }
  .org-account-dot::after { content: ""; position: absolute; left: 3px; right: 3px; bottom: 2px; height: 6px; border: 1.5px solid currentColor; border-radius: 8px 8px 5px 5px; }
  .org-sidebar { position: fixed; top: 52px; bottom: 0; left: 0; z-index: 5; display: flex; width: 72px; flex-direction: column; align-items: center; gap: 12px; padding: 14px 0; border-right: 1px solid var(--org-line); background: var(--org-bg); }
  .org-sidebar-item { display: inline-grid; width: 46px; height: 46px; place-items: center; padding: 0; border: 1px solid transparent; border-radius: 9px; background: transparent; color: var(--org-muted); cursor: pointer; }
  .org-sidebar-item.active { border-color: var(--org-line); background: var(--org-panel); color: var(--org-text); }
  .org-sidebar-bottom { margin-top: auto; }
  .org-create-page { display: flex; justify-content: center; padding: 36px 20px 54px; }
  .org-create-card { width: min(100%, 700px); overflow: hidden; border: 1px solid var(--org-line); border-radius: 7px; background: var(--org-panel); }
  .org-create-intro { padding: 16px 18px 14px; border-bottom: 1px solid var(--org-line); }
  .org-create-intro h1 { margin: 0 0 2px; font-size: 17px; letter-spacing: 0; }
  .org-create-intro p { max-width: 600px; margin: 0; color: var(--org-muted); font-size: 12.5px; line-height: 1.4; }
  .org-create-row { display: grid; grid-template-columns: 190px minmax(0, 1fr); gap: 18px; padding: 14px 18px; border-bottom: 1px solid var(--org-line); }
  .org-create-row strong { font-size: 13px; }
  .org-create-row input, .org-create-row select, .org-modal input, .org-modal select { width: 100%; height: 36px; padding: 0 11px; border: 1px solid #373737; border-radius: 6px; outline: 0; background: #1e1e1e; color: var(--org-text); }
  .org-create-row input::placeholder, .org-modal input::placeholder { color: #8c8c8c; }
  .org-create-row input:focus, .org-create-row select:focus, .org-modal input:focus, .org-modal select:focus { border-color: #606060; box-shadow: 0 0 0 3px rgba(255,255,255,.06); }
  .org-compact-select { position: relative; width: 100%; }
  .org-select-trigger { display: flex; width: 100%; height: 36px; align-items: center; justify-content: space-between; gap: 10px; padding: 0 11px; border: 1px solid #373737; border-radius: 6px; background: #1e1e1e; color: var(--org-text); font-size: 13px; text-align: left; cursor: pointer; }
  .org-select-trigger:hover, .org-select-trigger[aria-expanded="true"] { border-color: #606060; background: #222; }
  .org-select-chevron { flex: 0 0 auto; color: var(--org-muted); transition: transform 180ms ease; }
  .org-select-chevron.open { transform: rotate(180deg); }
  .org-select-menu { position: absolute; top: calc(100% + 6px); right: 0; left: 0; z-index: 500; overflow: hidden; padding: 4px; border: 1px solid var(--org-line); border-radius: 7px; background: #202020; box-shadow: 0 16px 34px rgb(0 0 0 / 42%); }
  .org-select-option { display: flex; width: 100%; min-height: 32px; align-items: center; justify-content: space-between; gap: 8px; padding: 0 9px; border: 0; border-radius: 5px; background: transparent; color: var(--org-muted); font-size: 12.5px; text-align: left; cursor: pointer; }
  .org-select-option:hover { background: #2a2a2a; color: var(--org-text); }
  .org-select-option.selected { background: transparent; color: var(--org-text); }
  .org-select-option.selected:hover { background: #2a2a2a; color: var(--org-text); }
  .org-select-check { display: inline-grid; width: 16px; height: 16px; flex: 0 0 16px; place-items: center; border-radius: 50%; background: var(--org-green); color: #fff; }
  .org-select-check svg { display: block; }
  .org-project-toolbar .org-compact-select { width: 112px; flex: 0 0 112px; }
  .org-create-row p { margin: 6px 0 0; color: var(--org-muted); font-size: 12px; line-height: 1.35; }
  .org-create-row a { color: var(--org-muted); text-decoration: underline; }
  .org-create-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 18px; }
  .org-primary-button, .org-secondary-button, .org-filter-button { display: inline-flex; height: 32px; align-items: center; justify-content: center; gap: 6px; padding: 0 10px; border-radius: 6px; font-size: 12.5px; font-weight: 650; cursor: pointer; white-space: nowrap; }
  .org-primary-button { border: 1px solid #0f8a4d; background: #078a4f; color: #fff; }
  .org-primary-button:hover { background: #079d59; }
  .org-primary-button:disabled { cursor: wait; opacity: .55; }
  .org-secondary-button { border: 1px solid var(--org-line); background: transparent; color: var(--org-text); }
  .org-secondary-button:hover, .org-filter-button:hover { background: var(--org-panel-2); }
  .org-form-error { margin: 16px 24px 0; padding: 10px 12px; border: 1px solid rgba(251,113,133,.35); border-radius: 6px; background: rgba(251,113,133,.08); color: #fda4af; font-size: 13px; }
  .org-list-page { padding: 74px clamp(24px, 6vw, 120px) 80px; }
  .org-list-heading, .org-project-heading { display: flex; align-items: center; justify-content: space-between; gap: 24px; }
  .org-list-heading h1, .org-project-heading h1 { margin: 0; font-size: 32px; letter-spacing: -.035em; }
  .org-list-toolbar { margin-top: 74px; }
  .org-list-search, .org-project-search { display: flex; height: 38px; align-items: center; gap: 10px; padding: 0 13px; border: 1px solid var(--org-line); border-radius: 8px; background: var(--org-bg); color: var(--org-muted); }
  .org-list-search { width: 420px; max-width: 100%; }
  .org-list-search input, .org-project-search input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: var(--org-text); }
  .org-list-search input::placeholder, .org-project-search input::placeholder { color: var(--org-muted); }
  .org-card-grid { display: grid; grid-template-columns: repeat(2, minmax(300px, 1fr)); gap: 22px; margin-top: 24px; max-width: 1115px; }
  .org-card { display: flex; min-height: 104px; align-items: center; gap: 16px; padding: 20px; border: 1px solid var(--org-line); border-radius: 8px; background: var(--org-panel); color: var(--org-text); text-align: left; cursor: pointer; }
  .org-card:hover { border-color: #454545; background: var(--org-panel-2); }
  .org-card-avatar { width: 48px; height: 48px; font-size: 16px; }
  .org-card-copy { min-width: 0; }
  .org-card-copy strong, .org-card-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .org-card-copy strong { font-size: 16px; }
  .org-card-copy small { margin-top: 5px; color: var(--org-muted); font-size: 13px; }
  .org-list-loading, .org-empty-list, .org-page-loading { display: flex; min-height: 180px; align-items: center; justify-content: center; gap: 10px; color: var(--org-muted); }
  .org-project-page { margin-left: 72px; padding: 76px 40px 80px 36px; }
  .org-project-layout { display: grid; grid-template-columns: minmax(0, 1fr) 480px; gap: 34px; margin-top: 76px; }
  .org-project-main { min-width: 0; }
  .org-project-toolbar { display: flex; align-items: center; gap: 12px; }
  .org-project-search { width: 425px; }
  .org-filter-button { height: 38px; border: 1px solid var(--org-line); background: transparent; color: var(--org-text); font-weight: 550; }
  .org-view-toggle { display: flex; margin-left: auto; gap: 2px; }
  .org-view-toggle .org-icon-button { width: 38px; height: 38px; border-radius: 8px; }
  .org-project-toolbar > .org-primary-button { height: 38px; }
  .org-project-table { margin-top: 24px; overflow: hidden; border: 1px solid var(--org-line); border-radius: 8px; background: var(--org-panel); }
  .org-project-table-head, .org-project-row { display: grid; grid-template-columns: minmax(220px, 1.7fr) .75fr .65fr 1fr 1.2fr 36px; align-items: center; column-gap: 24px; }
  .org-project-table-head { min-height: 58px; padding: 0 24px; border-bottom: 1px solid var(--org-line); color: var(--org-muted); font-size: 11px; font-weight: 700; letter-spacing: .08em; }
  .org-project-row { width: 100%; min-height: 92px; padding: 0 24px; border: 0; border-bottom: 1px solid var(--org-line); background: transparent; color: var(--org-text); text-align: left; cursor: pointer; }
  .org-project-row:last-child { border-bottom: 0; }
  .org-project-row:hover { background: var(--org-panel-2); }
  .org-project-name strong, .org-project-name small { display: block; }
  .org-project-name strong { font-size: 15px; }
  .org-project-name small { margin-top: 5px; color: var(--org-muted); font-family: var(--font-mono), monospace; font-size: 12px; }
  .org-project-row > span:not(.org-project-name) { color: var(--org-muted); font-size: 13px; }
  .org-status-pill { display: inline-flex; padding: 4px 8px; border: 1px solid #444; border-radius: 999px; color: var(--org-muted); font-size: 10px; font-style: normal; font-weight: 700; letter-spacing: .05em; }
  .org-project-region { text-transform: capitalize; }
  .org-project-empty { display: flex; min-height: 294px; margin-top: 24px; flex-direction: column; align-items: center; justify-content: center; gap: 10px; border: 1px dashed var(--org-line); border-radius: 8px; background: var(--org-panel); color: var(--org-muted); text-align: center; }
  .org-project-empty svg { color: #a1a1a1; }
  .org-project-empty h2 { margin: 3px 0 0; color: var(--org-text); font-size: 20px; }
  .org-project-empty p { margin: 0 0 8px; font-size: 16px; }
  .org-usage-panel { align-self: start; min-width: 0; padding: 26px 24px 20px; border: 1px solid var(--org-line); border-radius: 8px; background: var(--org-panel); }
  .org-usage-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .org-usage-heading h2 { margin: 0; font-size: 20px; }
  .org-usage-heading p { margin: 4px 0 0; color: var(--org-muted); font-size: 14px; }
  .org-upgrade-button { height: 38px; padding: 0 14px; border: 1px solid #0f8a4d; border-radius: 8px; background: #078a4f; color: #fff; font-weight: 650; cursor: pointer; }
  .org-usage-rows { margin-top: 32px; }
  .org-usage-row { display: grid; grid-template-columns: 22px minmax(0,1fr) auto auto; min-height: 49px; align-items: center; gap: 10px; border-bottom: 1px dashed var(--org-line); color: var(--org-muted); }
  .org-usage-row:last-child { border-bottom: 0; }
  .org-usage-ring { width: 21px; height: 21px; border: 3px solid #555; border-radius: 50%; }
  .org-usage-label { font-size: 13px; letter-spacing: .04em; }
  .org-usage-row strong { color: var(--org-text); font-size: 13px; }
  .org-usage-limit { color: var(--org-muted); font-size: 13px; }
  .org-modal-backdrop { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 20px; background: rgba(0,0,0,.66); }
  .org-modal { position: relative; width: min(100%, 470px); padding: 28px; border: 1px solid var(--org-line); border-radius: 10px; background: var(--org-panel); box-shadow: 0 24px 80px rgba(0,0,0,.5); }
  .org-modal-close { position: absolute; top: 18px; right: 18px; display: grid; width: 32px; height: 32px; place-items: center; border: 0; border-radius: 7px; background: transparent; color: var(--org-muted); cursor: pointer; }
  .org-modal h2 { margin: 0; font-size: 22px; }
  .org-modal > p { margin: 8px 0 22px; color: var(--org-muted); line-height: 1.5; }
  .org-modal form { display: grid; gap: 16px; }
  .org-modal label { display: grid; gap: 7px; color: var(--org-muted); font-size: 13px; }
  .org-modal-submit { width: 100%; margin-top: 2px; }
  .org-spin { animation: org-spin .8s linear infinite; }
  @keyframes org-spin { to { transform: rotate(360deg); } }
  @media (max-width: 1180px) { .org-project-layout { grid-template-columns: minmax(0, 1fr) 350px; } .org-project-toolbar { flex-wrap: wrap; } .org-project-search { flex: 1 1 300px; } .org-view-toggle { margin-left: 0; } }
  @media (max-width: 850px) { .org-commandbar { min-height: 50px; padding: 0 16px; } .org-commandbar-actions { gap: 4px; } .org-feedback, .org-search-command span, .org-search-command kbd, .org-commandbar-slash { display: none; } .org-search-command { width: 32px; justify-content: center; padding: 0; } .org-search-command svg { margin: 0; } .org-sidebar { top: 50px; width: 58px; } .org-sidebar-item { width: 42px; height: 42px; } .org-project-page { margin-left: 58px; padding: 44px 20px 60px; } .org-project-layout { grid-template-columns: 1fr; margin-top: 44px; } .org-usage-panel { order: -1; } .org-project-table-head, .org-project-row { grid-template-columns: minmax(160px, 1fr) .7fr 32px; column-gap: 12px; padding-inline: 14px; } .org-project-table-head span:nth-child(3), .org-project-table-head span:nth-child(4), .org-project-table-head span:nth-child(5), .org-project-row > span:nth-child(3), .org-project-row > span:nth-child(4), .org-project-row > span:nth-child(5) { display: none; } }
  @media (max-width: 620px) { .org-create-page { padding: 24px 14px 50px; } .org-create-intro { padding: 22px 18px; } .org-create-intro h1 { font-size: 21px; } .org-create-intro p { font-size: 14px; } .org-create-row { grid-template-columns: 1fr; gap: 12px; padding: 20px 18px; } .org-create-row strong { font-size: 15px; } .org-create-row p { font-size: 14px; } .org-create-footer { padding: 14px 18px; } .org-list-page { padding: 44px 18px 60px; } .org-list-heading { align-items: flex-start; flex-direction: column; } .org-list-heading h1, .org-project-heading h1 { font-size: 27px; } .org-list-toolbar { margin-top: 38px; } .org-card-grid { grid-template-columns: 1fr; } .org-project-toolbar { align-items: stretch; flex-direction: column; } .org-project-search { flex: auto; width: 100%; } .org-filter-button, .org-project-toolbar > .org-primary-button { width: 100%; } .org-view-toggle { display: none; } .org-usage-heading { flex-direction: column; } .org-upgrade-button { width: 100%; } }
`;
