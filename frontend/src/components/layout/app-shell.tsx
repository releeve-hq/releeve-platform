'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  LayoutDashboard, Target, FolderKanban, Users, Briefcase,
  Bell, Wallet as WalletIcon, User, Settings as SettingsIcon, Search, ChevronDown,
  ChevronLeft, Plus, X, Award, CheckCircle2, GitBranch,
  PanelLeft, Command, Shield, Check,
  ExternalLink, LogOut
} from 'lucide-react';
import {
  BRAND, cx, CURRENT_USER
} from '@/lib/data';
import { useApp } from '@/lib/app-context';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { Avatar } from '@/components/ui/avatar';
import { DifficultyBadge, Tag, StatusPill } from '@/components/ui/badge';
import { PrimaryButton, SecondaryButton, IconButton } from '@/components/ui/button';
import { ReleeveLogo } from '@/components/ui/releeve-logo';
import { Card } from '@/components/ui/card';

/* ============================================================================
   FONT / GLOBAL STYLE INJECTION
============================================================================ */
const FontStyle = () => (
  <style>{`
    .seidar-root { font-family: var(--font-inter), ui-sans-serif, system-ui, -apple-system, sans-serif; }
    .seidar-mono { font-family: var(--font-mono), ui-monospace, SFMono-Regular, monospace; }
    .seidar-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
    .seidar-scrollbar::-webkit-scrollbar-track { background: transparent; }
    .seidar-scrollbar::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 8px; }
    .seidar-scrollbar::-webkit-scrollbar-thumb:hover { background: #52525b; }
    @keyframes seidar-fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    .seidar-animate-in { animation: seidar-fade-in 0.25s ease-out; }
  `}</style>
);

/* ============================================================================
   CONTEXT SWITCHER
============================================================================ */
function ContextSwitcher({ collapsed }: { collapsed: boolean }) {
  const { activeContext, switchTo, allProjects, userOrgs, openCreateOrg, fetchUserOrgs } = useApp();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const displayUser = user ? { name: user.name, color: user.color || 'bg-violet-600' } : CURRENT_USER;
  const activeProject = activeContext.type === 'project' ? allProjects.find((p: any) => p.id === activeContext.id) : null;

  useEffect(() => { if (user) fetchUserOrgs(); }, [user, fetchUserOrgs]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative px-3 pb-3">
      <button onClick={() => setOpen(!open)} className={cx('w-full flex items-center gap-2.5 rounded-xl border border-white/10 hover:bg-white/5 transition-colors', collapsed ? 'justify-center py-2 px-0' : 'px-2.5 py-2')}>
        <Avatar name={activeContext.type === 'project' && activeProject ? activeProject.name : displayUser.name} color={activeContext.type === 'project' && activeProject ? activeProject.color : displayUser.color} size={8} />
        {!collapsed && (
          <>
            <div className="flex-1 min-w-0 text-left">
              <div className="text-sm font-semibold text-gray-900 truncate">{activeContext.type === 'project' && activeProject ? activeProject.name : displayUser.name}</div>
              <div className="text-[11px] text-gray-400">{activeContext.type === 'project' ? 'Project' : 'Organization'}</div>
            </div>
            <ChevronDown size={14} className="text-gray-400 shrink-0" />
          </>
        )}
      </button>

      {open && (
        <div className={cx('absolute top-full mt-1 bg-[#111113] border border-white/10 rounded-xl shadow-xl z-50 py-1.5 seidar-animate-in overflow-hidden w-64', collapsed ? 'left-3' : 'left-3 right-3 w-auto')}>
            <button onClick={() => { switchTo('user'); setOpen(false); }} className={cx('w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/5', activeContext.type === 'user' && 'bg-violet-600/15')}>
              <Avatar name={displayUser.name} color={displayUser.color} size={7} />
              <div className="flex-1 min-w-0"><div className="text-sm font-medium text-gray-900 truncate">{displayUser.name}</div><div className="text-[11px] text-gray-400">Organization</div></div>
              {activeContext.type === 'user' && <Check size={14} className="text-violet-600" />}
            </button>

            <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Organizations</div>
            {userOrgs.length === 0 && <div className="px-3 py-2 text-xs text-gray-400">You don't have any organizations yet</div>}
            {userOrgs.map((org: any) => (
              <button key={org.id} onClick={() => { switchTo('project', org.id); setOpen(false); }} className={cx('w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/5', activeContext.type === 'project' && activeContext.id === org.id && 'bg-violet-600/15')}>
                <Avatar name={org.name} color="bg-violet-600" size={7} />
                <div className="flex-1 min-w-0"><div className="text-sm font-medium text-gray-100 truncate">{org.name}</div><div className="text-[11px] text-zinc-500">owner</div></div>
                {activeContext.type === 'project' && activeContext.id === org.id && <Check size={14} className="text-violet-600" />}
              </button>
            ))}

            <div className="border-t border-white/10 mt-1.5 pt-1.5">
              <button onClick={() => { setOpen(false); openCreateOrg(); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/5 text-violet-400">
                <div className="w-7 h-7 rounded-full border border-dashed border-violet-500/50 flex items-center justify-center shrink-0"><Plus size={13} /></div>
                <span className="text-sm font-medium">Create an organization</span>
              </button>
            </div>
          </div>
      )}
    </div>
  );
}

/* ============================================================================
   SIDEBAR
============================================================================ */
interface SidebarProps {
  collapsed: boolean;
  setCollapsed: (c: boolean) => void;
  mobileOpen: boolean;
  setMobileOpen: (o: boolean) => void;
}

function Sidebar({ collapsed, setCollapsed, mobileOpen, setMobileOpen }: SidebarProps) {
  const { route, activeContext, navigate } = useApp();
  const isProject = activeContext.type === 'project';
  const [unreadNotifs, setUnreadNotifs] = useState(0);

  useEffect(() => {
    api.get<any[]>('/api/v1/users/notifications')
      .then(data => setUnreadNotifs((Array.isArray(data) ? data : []).filter((n: any) => !n.read).length))
      .catch(() => setUnreadNotifs(0));
  }, []);

  const navItems = isProject ? [
    { key: 'project-overview', label: 'Overview', icon: LayoutDashboard },
    { key: 'project-repos', label: 'Repositories', icon: GitBranch },
    { key: 'project-contributors', label: 'Contributors', icon: Award },
    { key: 'notifications', label: 'Notifications', icon: Bell },
    { key: 'wallet', label: 'Treasury', icon: WalletIcon },
  ] : [
    { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { key: 'projects', label: 'Projects', icon: FolderKanban },
    { key: 'notifications', label: 'Notifications', icon: Bell },
    { key: 'wallet', label: 'Wallet', icon: WalletIcon },
  ];

  const bottomItems = isProject ? [
    { key: 'project-public', label: 'Public page', icon: ExternalLink, onClick: () => navigate('project', { id: activeContext.id }) },
    { key: 'project-team', label: 'Team', icon: Shield, onClick: () => navigate('project-team') },
    { key: 'settings', label: 'Settings', icon: SettingsIcon, onClick: () => navigate('settings') },
  ] : [
    { key: 'profile', label: 'Profile', icon: User, onClick: () => navigate('profile') },
    { key: 'settings', label: 'Settings', icon: SettingsIcon, onClick: () => navigate('settings') },
  ];

  function isActive(key: string) {
    if (key === 'project-public') return route.page === 'project';
    return route.page === key;
  }

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 bg-black/40 z-40 md:hidden animate-[fadeIn_0.3s_ease-out]" onClick={() => setMobileOpen(false)} />}
      <div className={cx(
        'h-screen bg-[#111113] border-r border-white/[0.07] flex flex-col shrink-0 z-50',
        'fixed md:static top-0 left-0 w-[240px]',
        'transition-all duration-300 ease-in-out will-change-transform',
        collapsed ? 'md:w-[72px]' : 'md:w-[240px]',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
        'md:translate-x-0'
      )}>
        <div className={cx('flex items-center h-14 shrink-0', collapsed ? 'justify-center px-0' : 'px-4 gap-2')}>
          <ReleeveLogo size={28} />
          {!collapsed && <span className="font-semibold text-[13px] tracking-tight text-zinc-100">Releeve</span>}
          <button onClick={() => setMobileOpen(false)} className="md:hidden ml-auto text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>

        <ContextSwitcher collapsed={collapsed} />

        <div className="flex-1 overflow-y-auto seidar-scrollbar py-2 border-t border-gray-100">
          <nav className="flex flex-col gap-0.5 px-3">
            {navItems.map(item => {
              const active = isActive(item.key);
              const Icon = item.icon;
              return (
                <button key={item.key} onClick={() => navigate(item.key)} title={collapsed ? item.label : undefined}
                  className={cx('relative flex items-center gap-3 rounded-xl text-sm font-medium transition-colors duration-150', collapsed ? 'justify-center py-2.5' : 'px-3 py-2.5', active ? 'bg-violet-600/20 text-violet-400' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100')}>
                  <Icon size={17} className={active ? 'text-violet-400' : 'text-zinc-500'} />
                  {!collapsed && <span className="flex-1 text-left">{item.label}</span>}
                  {!collapsed && item.key === 'notifications' && unreadNotifs > 0 && <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-600 text-white">{unreadNotifs}</span>}
                  {collapsed && item.key === 'notifications' && unreadNotifs > 0 && <span className="absolute top-1.5 right-3.5 w-1.5 h-1.5 rounded-full bg-violet-600" />}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="px-3 py-3 border-t border-gray-100 flex flex-col gap-0.5">
          {bottomItems.map(item => {
            const active = isActive(item.key);
            const Icon = item.icon;
            return (
              <button key={item.key} onClick={item.onClick} title={collapsed ? item.label : undefined}
                className={cx('flex items-center gap-3 rounded-xl text-sm font-medium transition-colors duration-150', collapsed ? 'justify-center py-2.5' : 'px-3 py-2.5', active ? 'bg-violet-600/20 text-violet-400' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100')}>
                <Icon size={17} className={active ? 'text-violet-600' : 'text-gray-400'} />
                {!collapsed && <span>{item.label}</span>}
              </button>
            );
          })}
          <button onClick={() => setCollapsed(!collapsed)} className={cx('flex items-center gap-3 rounded-xl text-sm font-medium text-zinc-500 hover:bg-white/5 hover:text-zinc-300 transition-colors duration-150 mt-1', collapsed ? 'justify-center py-2.5' : 'px-3 py-2.5')}>
            <PanelLeft size={17} className={cx('transition-transform duration-300 ease-in-out', collapsed && 'rotate-180')} />
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </div>
    </>
  );
}

/* ============================================================================
   TOP BAR
============================================================================ */
interface TopBarProps {
  setCommandOpen: (o: boolean) => void;
  setMobileNavOpen: (o: boolean) => void;
  collapsed: boolean;
  setCollapsed: (c: boolean) => void;
}

function TopBar({ setCommandOpen, setMobileNavOpen, collapsed, setCollapsed }: TopBarProps) {
  const { route, activeContext, allProjects, navigate, switchTo, userOrgs } = useApp();
  const { user, logout } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const [orgFlyoutOpen, setOrgFlyoutOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
        setOrgFlyoutOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const [unreadNotifs, setUnreadNotifs] = useState(0);

  useEffect(() => {
    api.get<any[]>('/api/v1/users/notifications')
      .then(data => setUnreadNotifs((Array.isArray(data) ? data : []).filter((n: any) => !n.read).length))
      .catch(() => setUnreadNotifs(0));
  }, []);
  const titles: Record<string, string> = {
    dashboard: 'Dashboard',
    'project-overview': 'Overview', 'project-repos': 'Repositories', 'project-contributors': 'Contributors', 'project-team': 'Team',
    notifications: 'Notifications', wallet: activeContext.type === 'project' ? 'Treasury' : 'Wallet',
    profile: 'Profile', settings: 'Settings',
  };
  const activeProject = activeContext.type === 'project' ? allProjects.find((p: any) => p.id === activeContext.id) : null;

  return (
    <div className="h-16 shrink-0 border-b border-white/[0.07] bg-[#111113]/90 backdrop-blur flex items-center justify-between px-3 sm:px-6 sticky top-0 z-10 gap-2">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <button onClick={() => setCollapsed(!collapsed)} className="hidden md:flex w-9 h-9 rounded-xl items-center justify-center text-gray-500 hover:bg-white/5 shrink-0" title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <PanelLeft size={18} className={cx('transition-transform duration-300 ease-in-out', collapsed && 'rotate-180')} />
        </button>
        <button onClick={() => setMobileNavOpen(true)} className="md:hidden w-9 h-9 rounded-xl flex items-center justify-center text-gray-500 hover:bg-gray-100 shrink-0">
          <PanelLeft size={18} />
        </button>
        <span className="text-sm text-gray-400 hidden sm:inline shrink-0">{titles[route.page] || ''}</span>
        {activeProject && (
          <span className="flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md bg-violet-50 text-violet-700 border border-violet-200 min-w-0">
            <div className={cx('w-1.5 h-1.5 rounded-full shrink-0', activeProject.color)} />
            <span className="truncate">Managing {activeProject.name}</span>
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <button onClick={() => setCommandOpen(true)} className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-zinc-400 text-sm hover:bg-white/10 transition-colors duration-150 w-64">
          <Search size={14} /><span className="flex-1 text-left">Search Releeve…</span>
          <span className="flex items-center gap-0.5 text-[11px] font-medium text-zinc-500 bg-white/5 border border-white/10 rounded px-1.5 py-0.5"><Command size={10} />K</span>
        </button>
        <button onClick={() => setCommandOpen(true)} className="sm:hidden w-9 h-9 rounded-xl flex items-center justify-center text-gray-500 hover:bg-gray-100"><Search size={17} /></button>
        <div className="relative">
          <IconButton icon={Bell} onClick={() => navigate('notifications')} />
          {unreadNotifs > 0 && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-[#111113]" />}
        </div>
        <div className="relative shrink-0" ref={profileRef}>
          <button onClick={() => { setProfileOpen(!profileOpen); setOrgFlyoutOpen(false); }} title="Your account" className="shrink-0">
            <Avatar name={user?.name || CURRENT_USER.name} color={user?.color || CURRENT_USER.color} size={9} />
          </button>
          {profileOpen && (
            <div className="absolute right-0 top-full mt-2 w-56 bg-[#111113] border border-white/10 rounded-xl shadow-xl z-50 py-1.5 seidar-animate-in">
              <button onClick={() => { navigate('profile'); setProfileOpen(false); }} className="w-full flex items-center justify-center gap-2.5 px-3 py-2.5 hover:bg-white/5 text-sm text-zinc-200">
                <span>Profile</span>
                <User size={15} className="text-zinc-400" />
              </button>
              <div className="border-t border-white/10 my-1" />
              <div className="relative" onMouseEnter={() => setOrgFlyoutOpen(true)} onMouseLeave={() => setOrgFlyoutOpen(false)}>
                <button className="w-full flex items-center justify-center gap-2.5 px-3 py-2.5 hover:bg-white/5 text-sm text-zinc-200">
                  <span>Organizations</span>
                  <FolderKanban size={15} className="text-zinc-400" />
                </button>
                {orgFlyoutOpen && (
                  <div className="absolute right-full top-0 mr-1.5 w-64 bg-[#111113] border border-white/10 rounded-xl shadow-xl z-50 py-1.5 seidar-animate-in overflow-hidden">
                    <button onClick={() => { switchTo('user', null); setProfileOpen(false); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/5">
                      <Avatar name={user?.name || CURRENT_USER.name} color={user?.color || CURRENT_USER.color} size={7} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-zinc-200 truncate">{user?.name || CURRENT_USER.name}</div>
                        <div className="text-[11px] text-zinc-500">Organization</div>
                      </div>
                      {activeContext.type === 'user' && <Check size={14} className="text-violet-600 shrink-0" />}
                    </button>

                    <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">Organizations</div>
                    {userOrgs.length === 0 && <div className="px-3 py-2 text-xs text-zinc-500">No organizations created</div>}
                    {userOrgs.map((org: any) => (
                      <button key={org.id} onClick={() => { switchTo('project', org.id); setProfileOpen(false); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/5">
                        <Avatar name={org.name} color="bg-violet-600" size={7} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-zinc-200 truncate">{org.name}</div>
                          <div className="text-[11px] text-zinc-500">owner</div>
                        </div>
                        {activeContext.type === 'project' && activeContext.id === org.id && <Check size={14} className="text-violet-600 shrink-0" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="border-t border-white/10 my-1" />
              <div className="px-2 pb-1.5">
                <button onClick={async () => { await logout(); setProfileOpen(false); }} className="w-full flex items-center justify-center gap-2.5 px-3 py-2.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-sm text-white transition-colors">
                  <span>Log out</span>
                  <LogOut size={15} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   COMMAND PALETTE
============================================================================ */
interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const { navigate, allProjects } = useApp();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setQuery(''); setTimeout(() => inputRef.current && inputRef.current.focus(), 10); } }, [open]);
  useEffect(() => {
    function handler(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!open) return null;
  const q = query.toLowerCase();
  const results: any[] = [];
  if (q.length > 0) {
    allProjects.filter((p: any) => p.name.toLowerCase().includes(q)).slice(0, 3).forEach((p: any) => results.push({ type: 'Project', label: p.name, sub: p.category, action: () => navigate('project', { id: p.id }) }));
    const raw = query.trim();
    const network = 'mainnet';
    if (/^[a-fA-F0-9]{64}$/.test(raw)) {
      results.push({
        type: 'Transaction',
        label: `${raw.slice(0, 10)}...${raw.slice(-8)}`,
        sub: `Open ${network} transaction`,
        action: () => { window.location.href = `/explorer/${network}/tx/${encodeURIComponent(raw)}`; },
      });
    }
    if (/^[GC][A-Z2-7]{55}$/.test(raw)) {
      const kind = raw.toUpperCase().startsWith('C') ? 'Contract' : 'Wallet';
      results.push({
        type: kind,
        label: `${raw.slice(0, 8)}...${raw.slice(-6)}`,
        sub: `Open ${network} ${kind.toLowerCase()}`,
        action: () => { window.location.href = `/explorer/${network}/${kind === 'Contract' ? 'contract' : 'account'}/${encodeURIComponent(raw)}`; },
      });
    }
    if (/^\d+$/.test(raw)) {
      results.push({
        type: 'Ledger',
        label: `Ledger #${raw}`,
        sub: `Open ${network} ledger`,
        action: () => { window.location.href = `/explorer/${network}/ledger/${encodeURIComponent(raw)}`; },
      });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-28 px-4" style={{ backgroundColor: 'rgba(21,20,26,0.4)' }} onClick={onClose}>
      <div className="w-full max-w-xl bg-[#111113] rounded-2xl border border-white/10 shadow-2xl seidar-animate-in overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-100">
          <Search size={16} className="text-gray-400" />
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search projects, bounties, developers, jobs…" className="flex-1 text-sm outline-none bg-transparent text-zinc-100 placeholder:text-zinc-500" />
          <kbd className="text-[11px] text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">Esc</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto seidar-scrollbar">
          {query.length === 0 && <div className="px-4 py-8 text-center text-sm text-gray-400">Start typing to search across Releeve</div>}
          {query.length > 0 && results.length === 0 && <div className="px-4 py-8 text-center text-sm text-gray-400">No results for “{query}”</div>}
          {results.map((r, i) => (
            <button key={i} onClick={() => { r.action(); onClose(); }} className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors duration-100 text-left">
              <div><div className="text-sm font-medium text-zinc-100">{r.label}</div><div className="text-xs text-gray-400">{r.sub}</div></div>
              <Tag>{r.type}</Tag>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   CREATE BOUNTY WIZARD
============================================================================ */
interface CreateBountyModalProps {
  open: boolean;
  defaultProjectId: string | null;
  onClose: () => void;
}

function CreateBountyModal({ open, onClose, defaultProjectId }: CreateBountyModalProps) {
  const { allProjects } = useApp();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ project: defaultProjectId || '', issue: '', issueNumber: 0, issueBody: '', repoFullName: '', githubRepoId: 0, githubIssueId: 0, orgIssueId: '', reward: '', requirements: '' });
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [repos, setRepos] = useState<any[]>([]);
  const [issues, setIssues] = useState<any[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [loadingIssues, setLoadingIssues] = useState(false);
  const steps = ['Project', 'Issue', 'Reward', 'Requirements', 'Review', 'Publish'];

  useEffect(() => {
    if (open) { setStep(defaultProjectId ? 2 : 1); setForm({ project: defaultProjectId || '', issue: '', issueNumber: 0, issueBody: '', repoFullName: '', githubRepoId: 0, githubIssueId: 0, orgIssueId: '', reward: '', requirements: '' }); setRepos([]); setIssues([]); setPublishing(false); setPublishError(''); }
  }, [open, defaultProjectId]);

  useEffect(() => {
    if (open && (step === 2 || (step === 1 && !defaultProjectId))) {
      const pid = form.project || defaultProjectId;
      if (!pid || repos.length > 0) return;
      setLoadingRepos(true);
      api.get(`/api/v1/orgs/${pid}/repos`).then((data: any) => { setRepos(data.repos || []); }).catch(() => {}).finally(() => setLoadingRepos(false));
    }
  }, [open, step, form.project]);

  async function fetchIssues(repoId: number) {
    const pid = form.project || defaultProjectId;
    if (!pid) return;
    setLoadingIssues(true);
    try {
      const data = await api.get(`/api/v1/orgs/${pid}/repos/${repoId}/issues`);
      setIssues(data.issues || []);
    } catch { setIssues([]); }
    setLoadingIssues(false);
  }

  if (!open) return null;
  function reset() { onClose(); }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ backgroundColor: 'rgba(21,20,26,0.4)' }} onClick={reset}>
      <div className="w-full max-w-3xl bg-[#111113] rounded-2xl border border-white/10 shadow-2xl seidar-animate-in overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="text-sm font-semibold text-zinc-100">New bounty</div>
          <button onClick={reset} className="text-zinc-400 hover:text-zinc-200"><X size={18} /></button>
        </div>
        <div className="px-6 pt-5">
          <div className="flex items-center gap-1.5 mb-6">
              {steps.map((s, i) => (
                  <div key={s} className="flex-1 flex flex-col gap-1.5">
                    <div className={cx('h-1 rounded-full', i + 1 <= step ? 'bg-violet-600' : 'bg-white/10')} />
                    <span className={cx('text-[10px] font-medium', i + 1 === step ? 'text-violet-400' : 'text-zinc-500')}>{s}</span>
                  </div>
                ))}
          </div>
        </div>
        <div className="px-6 pb-6 min-h-[180px]">
          {step === 1 && (
            <div>
              <label className="text-xs font-medium text-zinc-500 mb-2 block">Select project</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {allProjects.map((p: any) => (
                  <button key={p.id} onClick={() => setForm({ ...form, project: p.id })} className={cx('flex items-center gap-2 p-3 rounded-xl border text-left transition-colors', form.project === p.id ? 'border-violet-500/50 bg-violet-600/15' : 'border-white/10 hover:bg-white/5')}>
                    <Avatar name={p.name} color={p.color} size={7} /><span className="text-sm text-zinc-200">{p.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {step === 2 && (
            <div>
              <label className="text-xs font-medium text-zinc-500 mb-2 block">Select a repository</label>
              {loadingRepos ? (
                <div className="text-sm text-zinc-500 py-4">Loading repositories...</div>
              ) : repos.length === 0 ? (
                <div className="text-sm text-zinc-500 py-4">No repositories connected. Go to Repositories to connect your GitHub.</div>
              ) : (
                <div className="grid grid-cols-1 gap-1.5 mb-4">
                  {repos.map((r: any) => (
                    <button
                      key={r.id}
                      onClick={() => { setForm({ ...form, repoFullName: r.github_full_name, githubRepoId: r.github_repo_id }); fetchIssues(r.github_repo_id); }}
                      className={cx('flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-colors', form.repoFullName === r.github_full_name ? 'border-violet-500/50 bg-violet-600/15' : 'border-white/10 hover:bg-white/5')}
                    >
                      <GitBranch size={15} className="text-zinc-400" />
                      <span className="text-sm text-zinc-200">{r.github_full_name}</span>
                      {r.private && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">Private</span>}
                    </button>
                  ))}
                </div>
              )}
              {form.repoFullName && (
                <>
                  <label className="text-xs font-medium text-zinc-500 mb-2 block mt-3">Select an issue</label>
                  {loadingIssues ? (
                    <div className="text-sm text-zinc-500 py-2">Loading issues...</div>
                  ) : issues.length === 0 ? (
                    <div className="text-sm text-zinc-500 py-2">No open issues found in this repository.</div>
                  ) : (
                    <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto seidar-scrollbar">
                          {issues.map((issue: any) => (
                            <button
                              key={issue.github_issue_id}
                              onClick={() => setForm({ ...form, issue: issue.title, issueNumber: issue.number, issueBody: issue.body || '', orgIssueId: issue.org_issue_id || '', githubIssueId: issue.github_issue_id })}
                              className={cx('flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-colors', form.issueNumber === issue.number && form.repoFullName === issue.repo_full_name ? 'border-violet-500/50 bg-violet-600/15' : 'border-white/10 hover:bg-white/5')}
                            >
                              <span className="text-xs font-medium text-zinc-500 seidar-mono shrink-0">#{issue.number}</span>
                              <span className="text-sm text-zinc-200 truncate">{issue.title}</span>
                            </button>
                          ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {step === 3 && (
            <div>
              <label className="text-xs font-medium text-zinc-500 mb-2 block">Reward amount (USD)</label>
              <div className="flex items-center gap-2"><span className="text-zinc-400 seidar-mono">$</span><input value={form.reward} onChange={e => setForm({ ...form, reward: e.target.value })} placeholder="450" className="w-full px-3 py-2.5 rounded-xl border border-white/10 bg-white/5 text-zinc-100 text-sm outline-none focus:border-violet-500/50 seidar-mono placeholder:text-zinc-600" /></div>
              <p className="text-xs text-zinc-500 mt-2">Funds are held in escrow and released automatically once a contribution is merged.</p>
            </div>
          )}
          {step === 4 && (
            <div>
              <label className="text-xs font-medium text-zinc-500 mb-2 block">Requirements & acceptance criteria</label>
              <textarea value={form.requirements} onChange={e => setForm({ ...form, requirements: e.target.value })} rows={4} placeholder="What does a contributor need to know before starting?" className="w-full px-3 py-2.5 rounded-xl border border-white/10 bg-white/5 text-zinc-100 text-sm outline-none focus:border-violet-500/50 placeholder:text-zinc-600" />
            </div>
          )}
          {step === 5 && (
            <div className="flex flex-col gap-3">
              <div className="text-xs font-medium text-zinc-500">Review your bounty</div>
              <div className="p-4 rounded-xl border border-white/10 bg-white/5 text-sm">
                <div className="font-medium text-zinc-100">{form.issue || 'Untitled issue'}</div>
                <div className="text-xs text-zinc-500 mt-1">{allProjects.find((p: any) => p.id === form.project)?.name || 'No project selected'} · ${form.reward || '0'}</div>
                {form.repoFullName && <div className="text-xs text-zinc-400 mt-1">{form.repoFullName} #{form.issueNumber}</div>}
              </div>
              {publishError && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{publishError}</div>}
            </div>
          )}
          {step === 6 && (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center mb-3"><CheckCircle2 size={22} className="text-emerald-400" /></div>
              <div className="text-sm font-semibold text-zinc-100">Bounty published</div>
              <div className="text-xs text-zinc-500 mt-1">Contributors can now discover and start working on it.</div>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10">
          <SecondaryButton onClick={() => (step > 1 && step > (defaultProjectId ? 2 : 1)) ? setStep(step - 1) : reset()}>{(step > 1 && step > (defaultProjectId ? 2 : 1)) ? 'Back' : 'Cancel'}</SecondaryButton>
          {step < 6 ? (
            step === 5 ? (
              <PrimaryButton onClick={async () => {
                setPublishError('');
                if (!form.project) { setPublishError('Select a project first.'); return; }
                if (!form.githubRepoId && !form.orgIssueId) { setPublishError('Select a repository and issue first.'); return; }
                setPublishing(true);
                try {
                  const body: any = { org_id: form.project, title: form.issue, description: form.requirements, amount: parseFloat(form.reward) || 0 };
                  if (form.orgIssueId) {
                    body.org_issue_id = form.orgIssueId;
                  } else {
                    body.github_issue_id = form.githubIssueId;
                    body.github_repo_id = form.githubRepoId;
                  }
                  await api.post('/api/v1/bounties/create', body);
                  setStep(6);
                } catch (e: any) {
                  setPublishError(e.message || 'Failed to create bounty');
                }
                setPublishing(false);
              }} disabled={publishing}>{publishing ? 'Publishing...' : 'Publish'}</PrimaryButton>
            ) : (
              <PrimaryButton onClick={() => setStep(step + 1)}>Continue</PrimaryButton>
            )
          ) : (
            <PrimaryButton onClick={reset}>Done</PrimaryButton>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   EDIT PROFILE MODAL
=========================================================================== */
interface EditProfileModalProps {
  open: boolean;
  onClose: () => void;
}

function EditProfileModal({ open, onClose }: EditProfileModalProps) {
  const { loadUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    bio: '',
    skills: [] as string[],
    goals: [] as string[],
    country: '',
    availability: 'available',
    years_of_experience: '',
    linkedin_url: '',
    portfolio_url: '',
    ideal_salary_min_usdc: '',
    ideal_salary_max_usdc: '',
  });
  const [skillInput, setSkillInput] = useState('');
  const [goalInput, setGoalInput] = useState('');

  useEffect(() => {
    if (open) {
      setLoading(true);
      setError('');
      api.get<any>('/api/v1/users/me')
        .then(data => {
          setForm({
            name: data.name || '',
            bio: data.bio || '',
            skills: data.skills || [],
            goals: data.goals || [],
            country: data.country || '',
            availability: data.availability || 'available',
            years_of_experience: data.years_of_experience != null ? String(data.years_of_experience) : '',
            linkedin_url: data.linkedin_url || '',
            portfolio_url: data.portfolio_url || '',
            ideal_salary_min_usdc: data.ideal_salary_min_usdc != null ? String(data.ideal_salary_min_usdc) : '',
            ideal_salary_max_usdc: data.ideal_salary_max_usdc != null ? String(data.ideal_salary_max_usdc) : '',
          });
          setSkillInput('');
          setGoalInput('');
        })
        .catch(() => setError('Failed to load profile'))
        .finally(() => setLoading(false));
    }
  }, [open]);

  function addSkill() {
    const s = skillInput.trim();
    if (s && !form.skills.includes(s)) {
      setForm({ ...form, skills: [...form.skills, s] });
    }
    setSkillInput('');
  }

  function removeSkill(s: string) {
    setForm({ ...form, skills: form.skills.filter(x => x !== s) });
  }

  function addGoal() {
    const g = goalInput.trim();
    if (g && !form.goals.includes(g)) {
      setForm({ ...form, goals: [...form.goals, g] });
    }
    setGoalInput('');
  }

  function removeGoal(g: string) {
    setForm({ ...form, goals: form.goals.filter(x => x !== g) });
  }

  async function submit() {
    setSaving(true);
    setError('');
    try {
      const body: any = {};
      if (form.name) body.name = form.name;
      if (form.bio) body.bio = form.bio;
      body.skills = form.skills;
      body.goals = form.goals;
      if (form.country) body.country = form.country;
      if (form.availability) body.availability = form.availability;
      if (form.years_of_experience) body.years_of_experience = parseInt(form.years_of_experience);
      if (form.linkedin_url) body.linkedin_url = form.linkedin_url;
      if (form.portfolio_url) body.portfolio_url = form.portfolio_url;
      if (form.ideal_salary_min_usdc) body.ideal_salary_min_usdc = parseFloat(form.ideal_salary_min_usdc);
      if (form.ideal_salary_max_usdc) body.ideal_salary_max_usdc = parseFloat(form.ideal_salary_max_usdc);
      await api.patch('/api/v1/users/me', body);
      await loadUser();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update profile');
    }
    setSaving(false);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ backgroundColor: 'rgba(21,20,26,0.4)' }} onClick={onClose}>
      <div className="w-full max-w-2xl bg-[#111113] rounded-2xl border border-white/10 shadow-2xl seidar-animate-in overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-8 py-5 border-b border-white/10">
          <div className="text-sm font-semibold text-gray-100">Edit profile</div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200"><X size={18} /></button>
        </div>
        {loading ? (
          <div className="px-8 py-12 text-center text-sm text-zinc-500">Loading...</div>
        ) : (
          <>
            <div className="px-8 py-5 flex flex-col gap-4 max-h-[60vh] overflow-y-auto seidar-scrollbar">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-zinc-500 mb-1.5 block">Name</label>
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Your name" className="w-full px-3 py-2.5 rounded-xl border border-white/10 bg-white/5 text-zinc-100 text-sm outline-none focus:border-violet-500/50 placeholder:text-zinc-600" />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500 mb-1.5 block">Country</label>
                  <input value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} placeholder="e.g. United States" className="w-full px-3 py-2.5 rounded-xl border border-white/10 bg-white/5 text-zinc-100 text-sm outline-none focus:border-violet-500/50 placeholder:text-zinc-600" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500 mb-1.5 block">Bio</label>
                <textarea value={form.bio} onChange={e => setForm({ ...form, bio: e.target.value })} rows={3} placeholder="Tell us about yourself..." className="w-full px-3 py-2.5 rounded-xl border border-white/10 bg-white/5 text-zinc-100 text-sm outline-none focus:border-violet-500/50 placeholder:text-zinc-600" />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500 mb-1.5 block">Skills</label>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  {form.skills.map(s => (
                    <span key={s} className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-violet-500/15 text-violet-400 border border-violet-500/20">
                      {s}
                      <button onClick={() => removeSkill(s)} className="hover:text-violet-200"><X size={11} /></button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input value={skillInput} onChange={e => setSkillInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } }} placeholder="Add a skill..." className="flex-1 px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-zinc-100 text-sm outline-none focus:border-violet-500/50 placeholder:text-zinc-600" />
                  <SecondaryButton onClick={addSkill} disabled={!skillInput.trim()}>Add</SecondaryButton>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-500 mb-1.5 block">Goals</label>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  {form.goals.map(g => (
                    <span key={g} className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                      {g}
                      <button onClick={() => removeGoal(g)} className="hover:text-emerald-200"><X size={11} /></button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input value={goalInput} onChange={e => setGoalInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addGoal(); } }} placeholder="Add a goal..." className="flex-1 px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-zinc-100 text-sm outline-none focus:border-violet-500/50 placeholder:text-zinc-600" />
                  <SecondaryButton onClick={addGoal} disabled={!goalInput.trim()}>Add</SecondaryButton>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-zinc-500 mb-1.5 block">Availability</label>
                  <select value={form.availability} onChange={e => setForm({ ...form, availability: e.target.value })} className="w-full px-3 py-2.5 rounded-xl border border-white/10 bg-white/5 text-zinc-100 text-sm outline-none focus:border-violet-500/50">
                    <option value="available" className="bg-[#111113]">Available</option>
                    <option value="open_to_offers" className="bg-[#111113]">Open to offers</option>
                    <option value="not_looking" className="bg-[#111113]">Not looking</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500 mb-1.5 block">Years of experience</label>
                  <input type="number" min="0" value={form.years_of_experience} onChange={e => setForm({ ...form, years_of_experience: e.target.value })} placeholder="e.g. 5" className="w-full px-3 py-2.5 rounded-xl border border-white/10 bg-white/5 text-zinc-100 text-sm outline-none focus:border-violet-500/50 placeholder:text-zinc-600" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-zinc-500 mb-1.5 block">LinkedIn URL</label>
                  <input value={form.linkedin_url} onChange={e => setForm({ ...form, linkedin_url: e.target.value })} placeholder="https://linkedin.com/in/..." className="w-full px-3 py-2.5 rounded-xl border border-white/10 bg-white/5 text-zinc-100 text-sm outline-none focus:border-violet-500/50 placeholder:text-zinc-600" />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500 mb-1.5 block">Portfolio URL</label>
                  <input value={form.portfolio_url} onChange={e => setForm({ ...form, portfolio_url: e.target.value })} placeholder="https://..." className="w-full px-3 py-2.5 rounded-xl border border-white/10 bg-white/5 text-zinc-100 text-sm outline-none focus:border-violet-500/50 placeholder:text-zinc-600" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-zinc-500 mb-1.5 block">Ideal salary min (USDC)</label>
                  <input type="number" min="0" value={form.ideal_salary_min_usdc} onChange={e => setForm({ ...form, ideal_salary_min_usdc: e.target.value })} placeholder="e.g. 50000" className="w-full px-3 py-2.5 rounded-xl border border-white/10 bg-white/5 text-zinc-100 text-sm outline-none focus:border-violet-500/50 placeholder:text-zinc-600 seidar-mono" />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500 mb-1.5 block">Ideal salary max (USDC)</label>
                  <input type="number" min="0" value={form.ideal_salary_max_usdc} onChange={e => setForm({ ...form, ideal_salary_max_usdc: e.target.value })} placeholder="e.g. 150000" className="w-full px-3 py-2.5 rounded-xl border border-white/10 bg-white/5 text-zinc-100 text-sm outline-none focus:border-violet-500/50 placeholder:text-zinc-600 seidar-mono" />
                </div>
              </div>
              {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>}
            </div>
            <div className="flex items-center justify-between px-8 py-4 border-t border-white/10">
              <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
              <PrimaryButton onClick={submit} disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</PrimaryButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
   CREATE ORGANIZATION MODAL
=========================================================================== */
interface CreateOrgModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (form: {
    name: string; slug: string; contact_name: string; contact_email: string;
    website_url?: string; description?: string;
  }) => Promise<any>;
}

function CreateOrgModal({ open, onClose, onCreate }: CreateOrgModalProps) {
  const { user } = useAuth();
  const [form, setForm] = useState({ name: '', slug: '', contact_name: '', contact_email: '', website_url: '', description: '' });
  const [slugEdited, setSlugEdited] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setForm({
        name: '', slug: '',
        contact_name: user?.name || '',
        contact_email: user?.email || '',
        website_url: '', description: '',
      });
      setSlugEdited(false);
      setLoading(false);
      setError('');
    }
  }, [open, user]);

  function handleNameChange(value: string) {
    setForm(prev => ({
      ...prev,
      name: value,
      slug: slugEdited ? prev.slug : value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
    }));
  }

  async function submit() {
    if (!form.name.trim() || !form.slug.trim() || !form.contact_name.trim() || !form.contact_email.trim()) {
      setError('Please fill in all required fields.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await onCreate({
        name: form.name.trim(),
        slug: form.slug.trim(),
        contact_name: form.contact_name.trim(),
        contact_email: form.contact_email.trim(),
        website_url: form.website_url.trim() || undefined,
        description: form.description.trim() || undefined,
      });
    } catch (err: any) {
      setError(err.message || 'Failed to create organization.');
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ backgroundColor: 'rgba(21,20,26,0.4)' }} onClick={onClose}>
      <div className="w-full max-w-4xl bg-[#111113] rounded-2xl border border-white/10 shadow-2xl seidar-animate-in overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-8 py-5 border-b border-white/10">
          <div className="text-sm font-semibold text-gray-100">Create an organization</div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200"><X size={18} /></button>
        </div>
        <div className="px-8 py-5 flex flex-col gap-4 max-h-[65vh] overflow-y-auto seidar-scrollbar">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-zinc-500 mb-1.5 block">Organization name *</label>
              <input value={form.name} onChange={e => handleNameChange(e.target.value)} placeholder="e.g. Horizon Bridge" className="w-full px-3 py-2.5 rounded-xl border border-white/10 bg-white/5 text-zinc-100 text-sm outline-none focus:border-violet-500/50 placeholder:text-zinc-600" />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-500 mb-1.5 block">Slug *</label>
              <input value={form.slug} onChange={e => { setSlugEdited(true); setForm({ ...form, slug: e.target.value }); }} placeholder="horizon-bridge" className="w-full px-3 py-2.5 rounded-xl border border-white/10 bg-white/5 text-zinc-100 text-sm outline-none focus:border-violet-500/50 seidar-mono placeholder:text-zinc-600" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-zinc-500 mb-1.5 block">Contact name *</label>
              <input value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })} placeholder="Your name" className="w-full px-3 py-2.5 rounded-xl border border-white/10 bg-white/5 text-zinc-100 text-sm outline-none focus:border-violet-500/50 placeholder:text-zinc-600" />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-500 mb-1.5 block">Contact email *</label>
              <input type="email" value={form.contact_email} onChange={e => setForm({ ...form, contact_email: e.target.value })} placeholder="you@example.com" className="w-full px-3 py-2.5 rounded-xl border border-white/10 bg-white/5 text-zinc-100 text-sm outline-none focus:border-violet-500/50 placeholder:text-zinc-600" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-zinc-500 mb-1.5 block">Website (optional)</label>
            <input value={form.website_url} onChange={e => setForm({ ...form, website_url: e.target.value })} placeholder="https://example.com" className="w-full px-3 py-2.5 rounded-xl border border-white/10 bg-white/5 text-zinc-100 text-sm outline-none focus:border-violet-500/50 placeholder:text-zinc-600" />
          </div>
          <div>
            <label className="text-xs font-medium text-zinc-500 mb-1.5 block">Description (optional)</label>
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3} placeholder="Tell us about your organization and what you're building on Stellar." className="w-full px-3 py-2.5 rounded-xl border border-white/10 bg-white/5 text-zinc-100 text-sm outline-none focus:border-violet-500/50 placeholder:text-zinc-600" />
          </div>
          {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>}
          <p className="text-xs text-zinc-500">You'll be the owner. You can invite teammates from the Team page after creation.</p>
        </div>
        <div className="flex items-center justify-between px-8 py-4 border-t border-white/10">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton onClick={submit} disabled={loading || !form.name.trim() || !form.slug.trim()}>
            {loading ? 'Creating...' : 'Create organization'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   APP SHELL MAIN LAYOUT COMPONENT
============================================================================ */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const {
    collapsed, setCollapsed,
    mobileNavOpen, setMobileNavOpen,
    commandOpen, setCommandOpen,
    createBountyState, closeCreateBounty,
    createOrgOpen, setCreateOrgOpen, createOrg
  } = useApp();
  const { user } = useAuth();
  const [editProfileOpen, setEditProfileOpen] = useState(false);

  useEffect(() => {
    function handler() { setEditProfileOpen(true); }
    window.addEventListener('seidar:edit-profile', handler);
    return () => window.removeEventListener('seidar:edit-profile', handler);
  }, []);

  const displayUser = user ? {
    name: user.name,
    color: user.color || 'bg-violet-600',
  } : CURRENT_USER;

  return (
    <div className="seidar-root flex h-screen w-full bg-[#09090b] overflow-hidden" style={{ color: '#E8E8EA' }}>
      <FontStyle />
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} mobileOpen={mobileNavOpen} setMobileOpen={setMobileNavOpen} />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar setCommandOpen={setCommandOpen} setMobileNavOpen={setMobileNavOpen} collapsed={collapsed} setCollapsed={setCollapsed} />
        <div className="flex-1 overflow-y-auto overflow-x-hidden seidar-scrollbar">{children}</div>
      </div>
      <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} />
      <CreateBountyModal open={createBountyState.open} defaultProjectId={createBountyState.defaultProjectId} onClose={closeCreateBounty} />
      <CreateOrgModal open={createOrgOpen} onClose={() => setCreateOrgOpen(false)} onCreate={createOrg} />
      <EditProfileModal open={editProfileOpen} onClose={() => setEditProfileOpen(false)} />
    </div>
  );
}
