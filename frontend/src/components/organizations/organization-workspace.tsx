'use client';

import { createContext, FormEvent, Fragment, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Boxes,
  ArrowDownUp,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  Grid2X2,
  List,
  LoaderCircle,
  Moon,
  MoreVertical,
  Network,
  Plus,
  Search,
  Settings,
  SquareStack,
  Sun,
  UsersRound,
  X,
} from 'lucide-react';
import { ReleeveLogo } from '@/components/ui/releeve-logo';
import { SharedProfileMenu } from '@/components/ui/shared-profile-menu';
import { api, ApiError } from '@/lib/api';

export type Organization = {
  id: string;
  slug: string;
  name: string | null;
  avatar_url?: string | null;
  is_personal: boolean;
  plan_tier?: string;
  is_owner?: boolean;
};

export type OrgTab = 'projects' | 'members' | 'usage' | 'billing' | 'settings';

export const OrgContext = createContext<Organization | null>(null);

export function useOrg() {
  return useContext(OrgContext);
}

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

function shortProjectId(value: string) {
  return value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof ApiError || reason instanceof Error ? reason.message : fallback;
}

function IconButton({ label, children, onClick, active }: { label: string; children: React.ReactNode; onClick?: () => void; active?: boolean }) {
  return <button className={`org-icon-button${active ? ' active' : ''}`} type="button" aria-label={label} aria-pressed={active} title={label} onClick={onClick}>{children}</button>;
}

function CompactSelect({
  value,
  options,
  onChange,
  ariaLabel,
  leading,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  ariaLabel: string;
  leading?: React.ReactNode;
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
        {leading}
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

function ProjectSortSelect({
  sortBy,
  direction,
  onSortByChange,
  onDirectionChange,
}: {
  sortBy: 'name' | 'date';
  direction: 'asc' | 'desc';
  onSortByChange: (value: 'name' | 'date') => void;
  onDirectionChange: (value: 'asc' | 'desc') => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const options = [
    { value: 'name' as const, label: 'Name', group: 'field' as const },
    { value: 'date' as const, label: 'Date Created', group: 'field' as const },
    { value: 'asc' as const, label: 'Ascending', group: 'direction' as const },
    { value: 'desc' as const, label: 'Descending', group: 'direction' as const },
  ];

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="org-compact-select org-project-sort" ref={rootRef}>
      <button className="org-select-trigger" type="button" aria-label="Sort projects" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <ArrowDownUp size={15} />
        <span>Sort</span>
        <ChevronDown className={`org-select-chevron${open ? ' open' : ''}`} size={15} />
      </button>
      {open && <div className="org-select-menu" role="listbox" aria-label="Sort projects">
        {options.map((option, index) => {
          const selected = option.group === 'field' ? option.value === sortBy : option.value === direction;
          return (
            <Fragment key={option.value}>
              {index === 2 && <div className="org-select-divider" aria-hidden="true" />}
              <button className={`org-select-option${selected ? ' selected' : ''}`} type="button" role="option" aria-selected={selected} onClick={() => {
                if (option.group === 'field') onSortByChange(option.value);
                else onDirectionChange(option.value);
                setOpen(false);
              }}>
                <span>{option.label}</span>{selected && <span className="org-select-check" aria-hidden="true"><Check size={10} strokeWidth={3} /></span>}
              </button>
            </Fragment>
          );
        })}
      </div>}
    </div>
  );
}

function OrganizationSwitcher({ organization }: { organization?: Organization | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api.get<Organization[]>('/api/v1/me/organizations')
      .then((items) => { if (!cancelled) setOrganizations(items); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const label = organization?.name || organization?.slug || 'Organization';

  return (
    <div className="org-crumb-switcher" ref={rootRef}>
      <button className="org-crumb-org" type="button" aria-label="Switch organization" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span className="org-header-avatar" aria-hidden="true"><Network size={17} strokeWidth={1.8} /></span>
        <span className="org-crumb-org-name">{label}</span>
        <span className="org-plan-pill">{organization?.plan_tier || 'Free'}</span>
        <ChevronDown className={`org-crumb-chevron${open ? ' open' : ''}`} size={14} />
      </button>
      {open && (
        <div className="org-crumb-menu" role="menu" aria-label="Organizations">
          <div className="org-crumb-menu-label">Organizations</div>
          <div className="org-crumb-menu-list">
            {organizations.length === 0 && <div className="org-crumb-menu-empty">Loading organizations...</div>}
            {organizations.map((item) => (
              <button className={`org-crumb-menu-item${item.slug === organization?.slug ? ' selected' : ''}`} type="button" role="menuitem" key={item.id} onClick={() => { setOpen(false); router.push(`/organizations/${encodeURIComponent(item.slug)}`); }}>
                <span className="org-menu-avatar" aria-hidden="true"><Network size={16} strokeWidth={1.8} /></span>
                <span className="org-menu-copy"><strong>{item.name || item.slug}</strong><small>{item.plan_tier ? `${item.plan_tier[0].toUpperCase()}${item.plan_tier.slice(1)} Plan` : 'Free Plan'}{item.is_personal ? ' - Personal' : ''}</small></span>
                {item.slug === organization?.slug && <Check size={14} strokeWidth={2.5} />}
              </button>
            ))}
          </div>
          <button className="org-crumb-menu-footer" type="button" onClick={() => { setOpen(false); router.push('/organizations'); }}>
            <Grid2X2 size={15} />All organizations
          </button>
        </div>
      )}
    </div>
  );
}

function OrganizationHeader({ title, organization, light, onToggleTheme, singleBar = false }: { title: string; organization?: Organization | null; light: boolean; onToggleTheme: () => void; singleBar?: boolean }) {
  const router = useRouter();
  return (
    <>
      <header className="org-commandbar">
        <div className="org-commandbar-title">
          <ReleeveLogo size={24} />
          {singleBar ? (
            <>
              <span className="org-commandbar-slash">/</span>
              <span className="org-commandbar-name">{title}</span>
            </>
          ) : (
            <button className="org-commandbar-search" type="button" aria-label="Search organization or project">
              <Search size={15} />
              <span>Search organization or project</span>
              <kbd>⌘K</kbd>
            </button>
          )}
        </div>
        <div className="org-commandbar-actions">
          <button className="org-feedback" type="button">Feedback</button>
          <button className="org-theme-toggle" type="button" aria-label={light ? 'Switch to dark theme' : 'Switch to light theme'} onClick={onToggleTheme}>{light ? <Moon size={16} strokeWidth={1.8} /> : <Sun size={16} strokeWidth={1.8} />}</button>
          <SharedProfileMenu organization={organization} onOpenSettings={organization ? () => router.push(`/organizations/${encodeURIComponent(organization.slug)}/settings`) : undefined} />
        </div>
      </header>
      {!singleBar && (
        <div className="org-crumbbar">
          {organization ? (
            <OrganizationSwitcher organization={organization} />
          ) : (
            <span className="org-commandbar-name">{title}</span>
          )}
        </div>
      )}
    </>
  );
}

function OrganizationSidebar({ active = 'projects', slug }: { active?: OrgTab; slug: string }) {
  const router = useRouter();
  const base = `/organizations/${encodeURIComponent(slug)}`;
  return (
    <aside className="org-sidebar" aria-label="Organization navigation">
      <button className={`org-sidebar-item${active === 'projects' ? ' active' : ''}`} type="button" title="Projects" aria-label="Projects" onClick={() => router.push(base)}><Boxes size={17} strokeWidth={1.6} /><span className="org-sidebar-label">Projects</span></button>
      <button className={`org-sidebar-item${active === 'members' ? ' active' : ''}`} type="button" title="Members" aria-label="Members" onClick={() => router.push(`${base}/members`)}><UsersRound size={17} strokeWidth={1.6} /><span className="org-sidebar-label">Members</span></button>
      <button className={`org-sidebar-item${active === 'usage' ? ' active' : ''}`} type="button" title="Usage" aria-label="Usage" onClick={() => router.push(`${base}/usage`)}><ChartNoAxesCombined size={17} strokeWidth={1.6} /><span className="org-sidebar-label">Usage</span></button>
      <button className={`org-sidebar-item${active === 'billing' ? ' active' : ''}`} type="button" title="Billing" aria-label="Billing" onClick={() => router.push(`${base}/billing`)}><SquareStack size={17} strokeWidth={1.6} /><span className="org-sidebar-label">Billing</span></button>
      <button className={`org-sidebar-item org-sidebar-bottom${active === 'settings' ? ' active' : ''}`} type="button" title="Organization settings" aria-label="Organization settings" onClick={() => router.push(`${base}/settings`)}><Settings size={17} strokeWidth={1.6} /><span className="org-sidebar-label">Settings</span></button>
    </aside>
  );
}

export function OrganizationFrame({ children, title, organization, active, singleBar = false }: { children: React.ReactNode; title: string; organization?: Organization | null; active?: OrgTab; singleBar?: boolean }) {
  const [light, setLight] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('releeve-marketing-theme') === 'light';
  });

  useEffect(() => {
    const theme = light ? 'light' : 'dark';
    localStorage.setItem('releeve-marketing-theme', theme);
    document.documentElement.dataset.marketingTheme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [light]);

  return <div className={`org-product-shell${light ? ' org-light' : ''}`}><style jsx global>{organizationStyles}</style><OrganizationHeader title={title} organization={organization} light={light} onToggleTheme={() => setLight((current) => !current)} singleBar={singleBar} />{organization && <OrganizationSidebar active={active} slug={organization.slug} />}{children}</div>;
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
    <OrganizationFrame title="New organization" singleBar>
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
    <OrganizationFrame title="Organizations" singleBar>
      <main className="org-list-page">
        <div className="org-list-heading"><h1>Your Organizations</h1><button className="org-primary-button" type="button" onClick={() => router.push('/organizations/new')}><Plus size={17} />New organization</button></div>
        <div className="org-list-toolbar"><label className="org-list-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search for an organization" aria-label="Search for an organization" /></label></div>
        {error && <div className="org-form-error" role="alert">{error}</div>}
        {loading ? <div className="org-list-loading"><LoaderCircle className="org-spin" size={20} />Loading organizations...</div> : <div className="org-card-grid">{filtered.map((organization) => <button className="org-card" type="button" key={organization.id} onClick={() => router.push(`/organizations/${encodeURIComponent(organization.slug)}`)}><span className="org-card-avatar" aria-hidden="true"><Network size={20} strokeWidth={1.8} /></span><span className="org-card-copy"><strong>{organization.name || organization.slug}</strong><small>{organization.plan_tier ? `${organization.plan_tier[0].toUpperCase()}${organization.plan_tier.slice(1)} Plan` : 'Free Plan'}{organization.is_personal ? ' - Personal' : ''}</small></span></button>)}</div>}
        {!loading && !filtered.length && <div className="org-empty-list">No organizations match your search.</div>}
      </main>
    </OrganizationFrame>
  );
}

function CreateProjectModal({ organization, onCreated, onClose }: { organization: Organization; onCreated: (project: Project) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const project = await api.post<Project>(`/api/v1/${encodeURIComponent(organization.slug)}/projects`, { name: name.trim() });
      onCreated(project);
    } catch (reason) {
      setError(errorMessage(reason, 'Unable to create this project.'));
      setBusy(false);
    }
  }
  return <div className="org-modal-backdrop" role="presentation"><div className="org-modal" role="dialog" aria-modal="true" aria-labelledby="new-project-title"><button className="org-modal-close" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button><h2 id="new-project-title">Create a project</h2><p>Projects keep simulations, contracts, and investigations organized.</p><form onSubmit={submit}><label>Project name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Project name" /></label>{error && <div className="org-form-error">{error}</div>}<button className="org-primary-button org-modal-submit" type="submit" disabled={!name.trim() || busy}>{busy ? 'Creating...' : 'Create project'}</button></form></div></div>;
}

export function OrganizationProjectPage({ slug }: { slug: string }) {
  const router = useRouter();
  const organization = useOrg();
  const [projects, setProjects] = useState<Project[]>([]);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'date'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [view, setView] = useState<'grid' | 'list'>('list');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [openProjectMenu, setOpenProjectMenu] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<Paged<Project>>(`/api/v1/${encodeURIComponent(slug)}/projects?limit=100`)
      .then((page) => {
        if (cancelled) return;
        setProjects(page.data ?? []);
        if (page.data?.[0]) rememberWorkspace(slug, page.data[0]);
      }).catch((reason) => { if (!cancelled) setError(errorMessage(reason, 'Unable to load projects.')); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug]);

  useEffect(() => {
    if (!openProjectMenu) return;
    const close = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest('[data-project-menu]')) setOpenProjectMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenProjectMenu(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openProjectMenu]);

  const filtered = useMemo(() => {
    const matchingProjects = projects.filter((project) => {
    const matchesQuery = `${project.name} ${project.slug}`.toLowerCase().includes(query.toLowerCase().trim());
    return matchesQuery;
    });

    return matchingProjects.sort((left, right) => {
      let comparison = 0;
      if (sortBy === 'name') {
        comparison = left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
      } else {
        const leftCreated = left.created_at ? new Date(left.created_at).getTime() : Number.NEGATIVE_INFINITY;
        const rightCreated = right.created_at ? new Date(right.created_at).getTime() : Number.NEGATIVE_INFINITY;
        comparison = leftCreated - rightCreated;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [projects, query, sortBy, sortDirection]);

  if (!organization) return null;
  if (loading) return <main className="org-project-page"><div className="org-page-loading"><LoaderCircle className="org-spin" size={22} />Loading projects...</div></main>;

  return (
    <>
      <main className="org-project-page">
      <div className="org-project-heading"><h1>Projects</h1></div>
      <div className="org-project-layout">
        <section className="org-project-main">
          <div className="org-project-toolbar">
            <label className="org-project-search">
              <Search size={18} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search for a project" aria-label="Search for a project" />
            </label>
            <ProjectSortSelect
              sortBy={sortBy}
              direction={sortDirection}
              onSortByChange={setSortBy}
              onDirectionChange={setSortDirection}
            />
            <div className="org-view-toggle" aria-label="Project view">
              <IconButton label="Grid view" active={view === 'grid'} onClick={() => setView('grid')}><Grid2X2 size={17} /></IconButton>
              <IconButton label="List view" active={view === 'list'} onClick={() => setView('list')}><List size={18} /></IconButton>
            </div>
            <button className="org-primary-button" type="button" onClick={() => setModalOpen(true)}><Plus size={17} />New project</button>
          </div>
          {error && <div className="org-form-error">{error}</div>}
          {filtered.length ? (
            <div className={`org-project-table${view === 'grid' ? ' org-project-grid' : ''}`}>
              <div className="org-project-table-head"><span>PROJECT</span><span>CREATED</span><span>PROJECT ID</span><span /></div>
              {filtered.map((project) => {
                const menuOpen = openProjectMenu === project.id;
                const openProject = () => { rememberWorkspace(slug, project); router.push('/home'); };
                return (
                  <div
                    className="org-project-row"
                    role="button"
                    tabIndex={0}
                    key={project.id}
                    onClick={openProject}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openProject();
                      }
                    }}
                  >
                    <span className="org-project-name"><strong>{project.name}</strong><small>{project.slug}</small></span>
                    <span>{formatCreated(project.created_at)}</span>
                    <span className="org-project-id">{shortProjectId(project.id)}</span>
                    <span className="org-project-row-actions" data-project-menu onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                      <button className="org-project-menu-trigger" type="button" aria-label={`Project actions for ${project.name}`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setOpenProjectMenu((current) => current === project.id ? null : project.id)}><MoreVertical size={17} /></button>
                      {menuOpen && <div className="org-project-menu" role="menu"><button type="button" role="menuitem" onClick={() => { rememberWorkspace(slug, project); setOpenProjectMenu(null); router.push('/settings'); }}><Settings size={14} />Settings</button></div>}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : <div className="org-project-empty"><SquareStack size={34} /><h2>Create a project</h2><p>Launch a complete backend built on Stellar.</p></div>}
        </section>
      </div>
    </main>
    {modalOpen && organization && <CreateProjectModal organization={organization} onClose={() => setModalOpen(false)} onCreated={(project) => { setProjects((current) => [project, ...current]); setModalOpen(false); rememberWorkspace(slug, project); router.push('/home'); }} />}
    </>
  );
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
    --bg: var(--org-bg);
    --panel: var(--org-panel);
    --panel-2: var(--org-panel-2);
    --border: var(--org-line);
    --text: var(--org-text);
    --text-dim: var(--org-muted);
    --text-faint: var(--org-faint);
    --blue: #60a5fa;
    --green: var(--org-green);
    --red: #fb7185;
    min-height: 100dvh;
    background: var(--org-bg);
    color: var(--org-text);
    font-family: var(--font-inter), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 13px;
  }
  .org-product-shell.org-light {
    --org-bg: #f7f8f5;
    --org-panel: #ffffff;
    --org-panel-2: #eef1ec;
    --org-line: #cfd4ce;
    --org-text: #101310;
    --org-muted: #5e655e;
    --org-faint: #7e857e;
    --org-green: #22c55e;
  }
  .org-product-shell *, .org-product-shell *::before, .org-product-shell *::after { box-sizing: border-box; }
  .org-product-shell button, .org-product-shell input, .org-product-shell select { font: inherit; }
  .org-product-shell button { color: inherit; }
  .org-commandbar { position: sticky; top: 0; z-index: 10; display: flex; height: 55px; min-height: 55px; align-items: center; justify-content: space-between; gap: 18px; padding: 0 16px; border-bottom: 1px solid var(--org-line); background: var(--org-bg); }
  .org-commandbar-title, .org-commandbar-actions, .org-commandbar-search, .org-crumb-org, .org-feedback { display: flex; align-items: center; }
  .org-commandbar-title { flex: 1; min-width: 0; gap: 8px; }
  .org-commandbar-slash { color: var(--org-faint); font-size: 16px; font-weight: 300; }
  .org-commandbar-name { color: var(--org-text); font-size: 14px; font-weight: 600; white-space: nowrap; }
  .org-commandbar-search { flex: 1; max-width: 460px; min-height: 36px; height: 36px; gap: 9px; padding: 0 11px; border: 1px solid var(--org-line); border-radius: 6px; background: var(--org-panel-2); color: var(--org-faint); font: inherit; text-align: left; cursor: pointer; transition: border-color .15s ease, box-shadow .15s ease; }
  .org-commandbar-search:hover, .org-commandbar-search:focus-visible { border-color: var(--org-faint); }
  .org-commandbar-search:focus-visible { outline: 0; box-shadow: 0 0 0 3px color-mix(in srgb, var(--org-text) 10%, transparent); }
  .org-commandbar-search span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
  .org-commandbar-search kbd { flex: 0 0 auto; color: var(--org-faint); font-size: 10.5px; font-weight: 600; border: 1px solid var(--org-line); border-radius: 5px; padding: 2px 6px; }
  .org-crumb-org { gap: 8px; border: 0; background: transparent; padding: 0; color: var(--org-text); font-size: 14px; font-weight: 650; cursor: pointer; white-space: nowrap; }
  .org-crumb-switcher { position: relative; display: inline-flex; }
  .org-crumb-org-name { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .org-crumb-chevron { flex: 0 0 auto; color: var(--org-faint); transition: transform 180ms ease; }
  .org-crumb-chevron.open { transform: rotate(180deg); }
  .org-crumb-menu { position: absolute; top: calc(100% + 8px); left: 0; z-index: 600; width: 300px; max-width: 85vw; overflow: hidden; border: 1px solid var(--org-line); border-radius: 10px; background: var(--org-panel); box-shadow: 0 18px 42px rgb(0 0 0 / 48%); }
  .org-crumb-menu-label { padding: 12px 14px 6px; color: var(--org-faint); font-size: 10.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
  .org-crumb-menu-list { max-height: 320px; overflow-y: auto; padding: 4px 6px; }
  .org-crumb-menu-item { display: flex; width: 100%; align-items: center; gap: 10px; padding: 9px 8px; border: 0; border-radius: 8px; background: transparent; color: var(--org-text); text-align: left; cursor: pointer; }
  .org-crumb-menu-item:hover { background: var(--org-panel-2); }
  .org-crumb-menu-item.selected { background: var(--org-panel-2); }
  .org-crumb-menu-item.selected > svg { margin-left: auto; flex: 0 0 auto; color: var(--org-green); }
  .org-crumb-menu-empty { padding: 16px 8px; color: var(--org-muted); font-size: 12.5px; text-align: center; }
  .org-menu-avatar { display: inline-flex; width: 26px; height: 26px; flex: 0 0 26px; align-items: center; justify-content: center; color: var(--org-muted); }
  .org-menu-copy { min-width: 0; flex: 1; }
  .org-menu-copy strong, .org-menu-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .org-menu-copy strong { font-size: 13px; }
  .org-menu-copy small { margin-top: 2px; color: var(--org-muted); font-size: 11.5px; }
  .org-crumb-menu-footer { display: flex; width: 100%; align-items: center; gap: 8px; padding: 10px 14px; border: 0; border-top: 1px solid var(--org-line); background: transparent; color: var(--org-muted); font: inherit; font-size: 12.5px; font-weight: 600; text-align: left; cursor: pointer; }
  .org-crumb-menu-footer:hover { background: var(--org-panel-2); color: var(--org-text); }
  .org-crumbbar { position: sticky; top: 55px; z-index: 9; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 16px; border-bottom: 1px solid var(--org-line); background: var(--org-bg); }
  .org-header-avatar, .org-card-avatar { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; color: var(--org-muted); }
  .org-header-avatar { width: 30px; height: 30px; }
  .org-plan-pill { display: inline-flex; align-items: center; padding: 2px 8px; border: 1px solid var(--org-line); border-radius: 999px; color: var(--org-muted); font-size: 10.5px; font-weight: 650; text-transform: uppercase; }
  .org-commandbar-actions { gap: 8px; color: var(--org-muted); font-size: 12.5px; }
  .org-feedback { border: 0; background: transparent; padding: 6px; color: var(--org-muted); cursor: pointer; transition: background .15s ease, color .15s ease; }
  .org-feedback:hover { background: var(--org-panel); border-radius: 6px; color: var(--org-text); }
  .org-theme-toggle { display: inline-flex; align-items: center; justify-content: center; padding: 6px; border: 0; background: transparent; color: var(--org-muted); cursor: pointer; transition: color .15s ease; }
  .org-theme-toggle:hover { color: var(--org-text); }
  .org-icon-button { display: inline-grid; width: 32px; height: 32px; place-items: center; padding: 0; border: 1px solid var(--org-line); border-radius: 50%; background: transparent; color: var(--org-muted); cursor: pointer; }
  .org-icon-button:hover, .org-icon-button.active { border-color: var(--org-faint); color: var(--org-text); background: var(--org-panel); }
  .org-sidebar-item:hover { color: var(--org-text); background: var(--org-panel); }
  .org-account-dot { width: 20px; height: 20px; border: 2px solid currentColor; border-radius: 50%; position: relative; }
  .org-account-dot::after { content: ""; position: absolute; left: 3px; right: 3px; bottom: 2px; height: 6px; border: 1.5px solid currentColor; border-radius: 8px 8px 5px 5px; }
  .org-sidebar { position: fixed; top: 107px; bottom: 0; left: 0; z-index: 5; display: flex; width: 64px; flex-direction: column; align-items: stretch; gap: 0; padding: 10px 8px 0; border-right: 1px solid var(--org-line); background: var(--org-bg); transition: width 0.28s cubic-bezier(0.4, 0, 0.2, 1); }
  .org-sidebar:hover { width: 180px; }
  .org-sidebar-item { display: flex; width: 100%; align-items: center; justify-content: center; gap: 0; margin: 1px 0; padding: 10px 0; border: 0; border-radius: 8px; background: transparent; color: var(--org-muted); cursor: pointer; transition: justify-content 0.28s cubic-bezier(0.4, 0, 0.2, 1), gap 0.28s cubic-bezier(0.4, 0, 0.2, 1), padding 0.28s cubic-bezier(0.4, 0, 0.2, 1); }
  .org-sidebar:hover .org-sidebar-item { justify-content: flex-start; gap: 12px; padding: 10px 14px; }
  .org-sidebar-item svg { flex: 0 0 auto; }
  .org-sidebar-label { flex: 0 0 0; width: 0; overflow: hidden; white-space: nowrap; opacity: 0; font-size: 13px; font-weight: 700; transition: width 0.28s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.18s ease; }
  .org-sidebar:hover .org-sidebar-label { flex: 0 1 auto; width: auto; opacity: 1; }
  .org-sidebar-item.active { border: 0; background: var(--org-panel); color: var(--org-text); }
  .org-sidebar-bottom { margin-top: auto; }
  .org-create-page { display: flex; justify-content: center; padding: 28px 20px 48px; isolation: isolate; }
  .org-create-card { width: min(100%, 700px); overflow: hidden; border: 1px solid var(--org-line); border-radius: 7px; background: var(--org-panel); }
  .org-create-intro { padding: 16px 18px 14px; border-bottom: 1px solid var(--org-line); }
  .org-create-intro h1 { margin: 0 0 2px; font-size: 16px; letter-spacing: 0; }
  .org-create-intro p { max-width: 600px; margin: 0; color: var(--org-muted); font-size: 12.5px; line-height: 1.4; }
  .org-create-row { display: grid; grid-template-columns: 190px minmax(0, 1fr); gap: 18px; padding: 14px 18px; border-bottom: 1px solid var(--org-line); }
  .org-create-row strong { font-size: 13px; }
  .org-create-row input, .org-create-row select, .org-modal input, .org-modal select { width: 100%; height: 36px; padding: 0 11px; border: 1px solid var(--org-line); border-radius: 6px; outline: 0; background: var(--org-panel-2); color: var(--org-text); transition: border-color .15s ease, box-shadow .15s ease; }
  .org-create-row input::placeholder, .org-modal input::placeholder { color: var(--org-faint); }
  .org-create-row input:focus, .org-create-row select:focus, .org-modal input:focus, .org-modal select:focus { border-color: var(--org-faint); box-shadow: 0 0 0 3px color-mix(in srgb, var(--org-text) 10%, transparent); }
  .org-compact-select { position: relative; width: 100%; }
  .org-select-trigger { display: flex; width: 100%; height: 36px; align-items: center; justify-content: space-between; gap: 10px; padding: 0 11px; border: 1px solid var(--org-line); border-radius: 6px; background: var(--org-panel-2); color: var(--org-text); font-size: 13px; text-align: left; cursor: pointer; }
  .org-select-trigger > span { flex: 1; min-width: 0; }
  .org-select-trigger:hover, .org-select-trigger[aria-expanded="true"] { border-color: var(--org-faint); background: var(--org-panel); }
  .org-select-chevron { flex: 0 0 auto; color: var(--org-muted); transition: transform 180ms ease; }
  .org-select-chevron.open { transform: rotate(180deg); }
  .org-select-menu { position: absolute; top: calc(100% + 6px); right: 0; left: 0; z-index: 500; overflow: hidden; padding: 4px; border: 1px solid var(--org-line); border-radius: 7px; background: var(--org-panel); box-shadow: 0 16px 34px rgb(0 0 0 / 42%); }
  .org-select-option { display: flex; width: 100%; min-height: 32px; align-items: center; justify-content: space-between; gap: 8px; padding: 0 9px; border: 0; border-radius: 5px; background: transparent; color: var(--org-muted); font-size: 12.5px; text-align: left; cursor: pointer; }
  .org-select-option:hover { background: var(--org-panel-2); color: var(--org-text); }
  .org-select-option.selected { background: transparent; color: var(--org-text); }
  .org-select-option.selected:hover { background: var(--org-panel-2); color: var(--org-text); }
  .org-select-divider { height: 1px; margin: 4px 5px; background: var(--org-line); }
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
  .org-list-page { padding: 40px clamp(24px, 6vw, 88px) 56px; isolation: isolate; }
  .org-list-heading, .org-project-heading { display: flex; align-items: center; justify-content: space-between; gap: 24px; }
  .org-list-heading h1, .org-project-heading h1 { margin: 0; font-size: 20px; letter-spacing: -.02em; }
  .org-list-toolbar { margin-top: 24px; }
  .org-list-search, .org-project-search { display: flex; height: 36px; align-items: center; gap: 10px; padding: 0 11px; border: 1px solid var(--org-line); border-radius: 6px; background: var(--org-panel-2); color: var(--org-muted); transition: border-color .15s ease, box-shadow .15s ease; }
  .org-list-search:focus-within, .org-project-search:focus-within { border-color: var(--org-faint); box-shadow: 0 0 0 3px color-mix(in srgb, var(--org-text) 10%, transparent); }
  .org-list-search { width: 360px; max-width: 100%; }
  .org-list-search input, .org-project-search input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: var(--org-text); }
  .org-list-search input::placeholder, .org-project-search input::placeholder { color: var(--org-muted); }
  .org-card-grid { display: grid; grid-template-columns: repeat(2, minmax(280px, 1fr)); gap: 14px; margin-top: 20px; max-width: 920px; }
  .org-card { display: flex; min-height: 66px; align-items: center; gap: 14px; padding: 14px 16px; border: 1px solid var(--org-line); border-radius: 8px; background: var(--org-panel); color: var(--org-text); text-align: left; cursor: pointer; }
  .org-card:hover { border-color: var(--org-faint); background: var(--org-panel-2); }
  .org-card-avatar { width: 36px; height: 36px; }
  .org-card-copy { min-width: 0; }
  .org-card-copy strong, .org-card-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .org-card-copy strong { font-size: 14px; }
  .org-card-copy small { margin-top: 3px; color: var(--org-muted); font-size: 12px; }
  .org-list-loading, .org-empty-list, .org-page-loading { display: flex; min-height: 180px; align-items: center; justify-content: center; gap: 10px; color: var(--org-muted); }
  .org-project-page { margin-left: 64px; padding: 40px 32px 56px; isolation: isolate; }
  .org-settings-content { margin-left: 64px; padding: 40px 32px 56px; isolation: isolate; }
  .org-project-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; margin-top: 20px; }
  .org-project-main { min-width: 0; }
  .org-project-toolbar { display: flex; align-items: center; gap: 10px; }
  .org-project-search { width: 360px; }
  .org-project-toolbar > .org-compact-select { width: 122px; flex: 0 0 122px; }
  .org-project-sort .org-select-menu { min-width: 148px; }
  .org-filter-button { height: 32px; border: 1px solid var(--org-line); background: transparent; color: var(--org-text); font-weight: 550; }
  .org-view-toggle { display: flex; margin-left: auto; gap: 2px; }
  .org-view-toggle .org-icon-button { width: 32px; height: 32px; border-radius: 7px; }
  .org-project-toolbar > .org-primary-button { height: 32px; }
  .org-project-table { margin-top: 20px; overflow: visible; border: 1px solid var(--org-line); border-radius: 8px; background: var(--org-panel); }
  .org-project-table-head, .org-project-row { display: grid; grid-template-columns: minmax(220px, 1.7fr) 1.2fr 1.3fr 36px; align-items: center; column-gap: 20px; }
  .org-project-table-head { min-height: 40px; padding: 0 16px; border-bottom: 1px solid var(--org-line); color: var(--org-muted); font-size: 10.5px; font-weight: 700; letter-spacing: .08em; }
  .org-project-row { position: relative; width: 100%; min-height: 56px; padding: 0 16px; border: 0; border-bottom: 1px solid var(--org-line); background: transparent; color: var(--org-text); text-align: left; cursor: pointer; }
  .org-project-row:last-child { border-bottom: 0; }
  .org-project-row:hover { background: var(--org-panel-2); }
  .org-project-name strong, .org-project-name small { display: block; }
  .org-project-name strong { font-size: 13px; }
  .org-project-name small { margin-top: 3px; color: var(--org-muted); font-family: var(--font-mono), monospace; font-size: 11.5px; }
  .org-project-row > span:not(.org-project-name) { color: var(--org-muted); font-size: 12px; }
  .org-project-id { font-family: var(--font-mono), monospace; font-size: 11px !important; }
  .org-project-row-actions { position: relative; display: flex; justify-content: flex-end; }
  .org-project-menu-trigger { display: inline-grid; width: 28px; height: 30px; place-items: center; border: 0; border-radius: 6px; background: transparent; color: var(--org-muted); cursor: pointer; }
  .org-project-menu-trigger:hover, .org-project-menu-trigger:focus-visible { background: var(--org-panel-2); color: var(--org-text); outline: 0; }
  .org-project-menu { position: absolute; top: calc(100% + 4px); right: 0; z-index: 30; display: grid; min-width: 132px; overflow: hidden; padding: 4px; border: 1px solid var(--org-line); border-radius: 7px; background: var(--org-panel); box-shadow: 0 16px 34px rgb(0 0 0 / 42%); }
  .org-project-menu button { display: flex; width: 100%; align-items: center; gap: 8px; min-height: 32px; padding: 0 9px; border: 0; border-radius: 5px; background: transparent; color: var(--org-text); font-size: 12.5px; text-align: left; cursor: pointer; }
  .org-project-menu button:hover, .org-project-menu button:focus-visible { background: var(--org-panel-2); outline: 0; }
  .org-project-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 12px; }
  .org-project-grid .org-project-table-head { display: none; }
  .org-project-grid .org-project-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-rows: auto auto auto; min-height: 148px; padding: 16px; border: 1px solid var(--org-line); border-radius: 7px; background: var(--org-bg); }
  .org-project-grid .org-project-row:hover { border-color: var(--org-faint); background: var(--org-panel-2); }
  .org-project-grid .org-project-name { grid-column: 1 / -1; grid-row: 1; align-self: start; padding-right: 30px; }
  .org-project-grid .org-project-row > span:nth-child(2) { grid-column: 1; grid-row: 2; align-self: end; }
  .org-project-grid .org-project-id { grid-column: 1; grid-row: 3; align-self: end; }
  .org-project-grid .org-project-row-actions { grid-column: 2; grid-row: 1; align-self: start; }
  .org-project-empty { display: flex; min-height: 220px; margin-top: 20px; flex-direction: column; align-items: center; justify-content: center; gap: 8px; border: 1px dashed var(--org-line); border-radius: 8px; background: var(--org-panel); color: var(--org-muted); text-align: center; }
  .org-project-empty svg { color: var(--org-muted); }
  .org-project-empty h2 { margin: 3px 0 0; color: var(--org-text); font-size: 16px; }
  .org-project-empty p { margin: 0 0 8px; font-size: 13px; }
  .org-modal-backdrop { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 20px; background: rgba(0,0,0,.66); }
  .org-modal { position: relative; width: min(100%, 470px); padding: 28px; border: 1px solid var(--org-line); border-radius: 10px; background: var(--org-panel); box-shadow: 0 24px 80px rgba(0,0,0,.5); }
  .org-modal-close { position: absolute; top: 18px; right: 18px; display: grid; width: 32px; height: 32px; place-items: center; border: 0; border-radius: 7px; background: transparent; color: var(--org-muted); cursor: pointer; }
  .org-modal h2 { margin: 0; font-size: 18px; }
  .org-modal > p { margin: 8px 0 22px; color: var(--org-muted); line-height: 1.5; }
  .org-modal form { display: grid; gap: 16px; }
  .org-modal label { display: grid; gap: 7px; color: var(--org-muted); font-size: 13px; }
  .org-modal-submit { width: 100%; margin-top: 2px; }
  .org-spin { animation: org-spin .8s linear infinite; }
  @keyframes org-spin { to { transform: rotate(360deg); } }
  @media (max-width: 1180px) { .org-project-layout { grid-template-columns: minmax(0, 1fr); } .org-project-toolbar { flex-wrap: wrap; } .org-project-search { flex: 1 1 300px; } .org-view-toggle { margin-left: 0; } }
  @media (max-width: 850px) { .org-commandbar { height: 55px; min-height: 55px; padding: 0 16px; } .org-commandbar-actions { gap: 4px; } .org-feedback, .org-commandbar-search span, .org-commandbar-search kbd { display: none; } .org-commandbar-search { flex: 0 0 32px; width: 32px; max-width: 32px; justify-content: center; padding: 0; } .org-commandbar-search svg { margin: 0; } .org-sidebar { top: 107px; width: 56px; padding: 10px 6px 0; } .org-sidebar:hover { width: 170px; } .org-project-page { margin-left: 56px; padding: 32px 20px 48px; } .org-settings-content { margin-left: 56px; padding: 32px 20px 48px; } .org-project-layout { grid-template-columns: 1fr; margin-top: 20px; } .org-project-table-head, .org-project-row { grid-template-columns: minmax(160px, 1fr) .7fr 32px; column-gap: 12px; padding-inline: 14px; } .org-project-table-head span:nth-child(3), .org-project-table-head span:nth-child(4), .org-project-row > span:nth-child(3), .org-project-row > span:nth-child(4) { display: none; } }
  @media (max-width: 620px) { .org-create-page { padding: 24px 14px 50px; } .org-create-intro { padding: 22px 18px; } .org-create-intro h1 { font-size: 21px; } .org-create-intro p { font-size: 14px; } .org-create-row { grid-template-columns: 1fr; gap: 12px; padding: 20px 18px; } .org-create-row strong { font-size: 15px; } .org-create-row p { font-size: 14px; } .org-create-footer { padding: 14px 18px; } .org-list-page { padding: 40px 18px 48px; } .org-list-heading { align-items: flex-start; flex-direction: column; } .org-list-heading h1, .org-project-heading h1 { font-size: 18px; } .org-list-toolbar { margin-top: 20px; } .org-card-grid { grid-template-columns: 1fr; } .org-project-toolbar { align-items: stretch; flex-direction: column; } .org-project-search { flex: auto; width: 100%; } .org-filter-button, .org-project-toolbar > .org-primary-button { width: 100%; } .org-view-toggle { display: none; } }
  @media (max-width: 850px) {
    .org-project-table-head, .org-project-row { grid-template-columns: minmax(160px, 1fr) 1.2fr 1.3fr 32px; column-gap: 12px; padding-inline: 14px; }
    .org-project-table-head span:nth-child(3), .org-project-row > span:nth-child(3) { display: none; }
    .org-project-table-head span:nth-child(4), .org-project-row > span:nth-child(4) { display: flex; }
    .org-project-grid { grid-template-columns: 1fr; }
  }
  @media (max-width: 620px) {
    .org-project-toolbar > .org-compact-select { width: 100%; flex: auto; }
    .org-view-toggle { display: flex; margin-left: 0; }
  }
`;
