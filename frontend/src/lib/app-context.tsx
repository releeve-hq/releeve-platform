'use client';

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { PROJECTS, CURRENT_USER, PROJECT_MEMBERSHIPS } from './data';
import { api } from './api';

export const AppContext = createContext<any>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp must be used within AppContext.Provider');
  }
  return ctx;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [activeContext, setActiveContext] = useState({ type: 'user', id: null as string | null });
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [createBountyState, setCreateBountyState] = useState({ open: false, defaultProjectId: null as string | null });
  const [createOrgOpen, setCreateOrgOpen] = useState(false);
  const [allProjects, setAllProjects] = useState<any[]>(PROJECTS);
  const [memberships, setMemberships] = useState(PROJECT_MEMBERSHIPS);
  const [userOrgs, setUserOrgs] = useState<any[]>([]);
  const pendingFetches = useRef<Set<string>>(new Set());

  // Compute "route" dynamic state from the pathname to prevent breaking existing code
  const route = useMemo(() => {
    let page = 'home';
    let params: any = {};
    if (pathname === '/home' || pathname === '/dashboard') {
      page = 'home';
    } else if (pathname === '/projects') {
      page = 'projects';
    } else if (pathname.startsWith('/projects/')) {
      const parts = pathname.split('/');
      const id = parts[2];
      const sub = parts[3];
      params.id = id;
      if (!sub) {
        page = 'project';
      } else if (sub === 'overview') {
        page = 'project-overview';
      } else if (sub === 'contributors') {
        page = 'project-contributors';
      } else if (sub === 'team') {
        page = 'project-team';
      } else if (sub === 'repos') {
        page = 'project-repos';
      }
    } else if (pathname === '/notifications') {
      page = 'notifications';
    } else if (pathname === '/wallet') {
      page = 'wallet';
    } else if (pathname === '/profile') {
      page = 'profile';
    } else if (pathname === '/settings') {
      page = 'settings';
    }
    return { page, params };
  }, [pathname]);

  useEffect(() => {
    if (route.page.startsWith('project-') || route.page === 'project') {
      if (route.params.id && activeContext.id !== route.params.id) {
        if (route.page !== 'project') {
          setActiveContext({ type: 'project', id: route.params.id });
        }
      }
    }
      }, [route.page, route.params.id]);

  const fetchUserOrgs = useCallback(async () => {
    try {
      const token = localStorage.getItem('access_token');
      if (!token) return;
      const orgs = await api.get('/api/v1/me/organizations');
      setUserOrgs(Array.isArray(orgs) ? orgs : []);
    } catch { /* not authenticated or no orgs */ }
  }, []);

  function navigate(page: string, params: any = {}) {
    let path = '';
    switch (page) {
      case 'dashboard':
      case 'home': path = '/home'; break;
      case 'projects': path = '/projects'; break;
      case 'project': path = `/projects/${params.id}`; break;
      case 'project-overview': path = `/projects/${activeContext.id || params.id}/overview`; break;
      case 'project-contributors': path = `/projects/${activeContext.id || params.id}/contributors`; break;
      case 'project-team': path = `/projects/${activeContext.id || params.id}/team`; break;
      case 'project-repos': path = `/projects/${activeContext.id || params.id}/repos`; break;
      case 'notifications': path = '/notifications'; break;
      case 'wallet': path = '/wallet'; break;
      case 'profile': path = '/profile'; break;
      case 'settings': path = '/settings'; break;
      default: path = '/home';
    }
    router.push(path);
    setMobileNavOpen(false);
  }

  function switchTo(type: string, id: string | null = null) {
    setActiveContext({ type, id });
    if (type === 'project') {
      navigate('project-overview', { id });
    } else {
      navigate('dashboard');
    }
  }

  function openCreateBounty(defaultProjectId: string | null = null) {
    setCreateBountyState({ open: true, defaultProjectId });
  }
  function closeCreateBounty() {
    setCreateBountyState({ open: false, defaultProjectId: null });
  }

  async function createOrg(form: {
    name: string; slug: string; contact_name: string; contact_email: string;
    website_url?: string; description?: string;
  }) {
    const res = await api.post('/api/v1/organizations', {
      name: form.name,
      slug: form.slug || undefined,
    });
    const palette = ['bg-violet-600', 'bg-blue-600', 'bg-emerald-600', 'bg-amber-500', 'bg-rose-500', 'bg-indigo-600', 'bg-teal-600', 'bg-fuchsia-600'];
    const newProject = {
      id: res.id, name: res.name, initial: (res.name[0] || 'O').toUpperCase(),
      color: palette[allProjects.length % palette.length], category: 'Organization',
      tagline: res.description || 'A new organization on Releeve.',
      description: res.description || 'A new organization building on Stellar.',
      repo: '', stars: 0, openBounties: 0, closedBounties: 0, contributors: 1,
      totalPaid: 0, walletBalance: 0, activity: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    };
    setAllProjects(prev => [...prev, newProject]);
    setUserOrgs(prev => [...prev, res]);
    setCreateOrgOpen(false);
    switchTo('project', res.id);
    return res;
  }

  async function ensureProject(id: string) {
    const existing = allProjects.find((p: any) => p.id === id);
    if (existing) return existing;
    if (pendingFetches.current.has(id)) return null;
    pendingFetches.current.add(id);
    try {
      const data = await api.get(`/api/v1/orgs/${id}`);
      const palette = ['bg-violet-600', 'bg-blue-600', 'bg-emerald-600', 'bg-amber-500', 'bg-rose-500', 'bg-indigo-600', 'bg-teal-600', 'bg-fuchsia-600'];
      const proj = {
        id: data.id, name: data.name, initial: (data.name?.[0] || 'O').toUpperCase(),
        color: palette[allProjects.length % palette.length], category: 'Organization',
        tagline: data.description || 'A new organization on Releeve.',
        description: data.description || 'A new organization building on Stellar.',
        repo: '', stars: 0, openBounties: 0, closedBounties: 0, contributors: 1,
        totalPaid: 0, walletBalance: 0, activity: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      };
      setAllProjects(prev => prev.some((p: any) => p.id === id) ? prev : [...prev, proj]);
      pendingFetches.current.delete(id);
      return proj;
    } catch {
      pendingFetches.current.delete(id);
      return null;
    }
  }

  function updateMemberships(projectId: string, members: any[]) {
    setMemberships(prev => ({ ...prev, [projectId]: members }));
  }

  const ctxValue = useMemo(() => ({
    route, navigate, activeContext, switchTo,
    allProjects, memberships, updateMemberships,
    userOrgs, fetchUserOrgs,
    openCreateBounty, openCreateOrg: () => setCreateOrgOpen(true),
    collapsed, setCollapsed, mobileNavOpen, setMobileNavOpen,
    commandOpen, setCommandOpen, createBountyState, closeCreateBounty,
    createOrgOpen, setCreateOrgOpen, createOrg, ensureProject
  }), [
    route, activeContext, allProjects, memberships, userOrgs,
    collapsed, mobileNavOpen, commandOpen, createBountyState, createOrgOpen,
    navigate, switchTo, updateMemberships, openCreateBounty, closeCreateBounty, createOrg, fetchUserOrgs
  ]);

  return (
    <AppContext.Provider value={ctxValue}>
      {children}
    </AppContext.Provider>
  );
}
