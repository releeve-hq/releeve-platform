'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import AppShell from '@/components/layout/app-shell';
import ReleeveApp from '@/components/app/releeve-app';

const AUTH_ROUTES = ['/signin', '/signup', '/forgot-password', '/reset-password'];
const AUTH_PREFIX_ROUTES = ['/auth', '/temp'];
const PUBLIC_ROUTES: string[] = ['/'];
const MARKETING_ROUTES = ['/about', '/pricing', '/docs', '/terms', '/privacy'];
const EXPLORER_ENTITY_ROUTES = new Set(['ledger', 'tx', 'account', 'contract']);
const APP_ROUTES = [
  '/home',
  '/dashboard',
  '/simulator',
  '/virtual-environments',
  '/activity',
  '/alerts',
  '/wallets',
  '/contracts',
  '/settings',
  '/debugger',
  '/onboarding',
];

const DASHBOARD_SHELL_ROUTES = APP_ROUTES.filter(route => route !== '/onboarding');

function isAuthRoute(pathname: string): boolean {
  if (AUTH_ROUTES.some(route => pathname === route || pathname.startsWith(route + '/'))) {
    return true;
  }
  if (AUTH_PREFIX_ROUTES.some(prefix => pathname.startsWith(prefix))) {
    return true;
  }
  return false;
}

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.includes(pathname) || MARKETING_ROUTES.some(route => pathname === route || pathname.startsWith(route + '/'));
}

function isExplorerRoute(pathname: string): boolean {
  if (pathname === '/explorer' || pathname.startsWith('/explorer/')) return true;
  const [, , entity, id] = pathname.split('/');
  return Boolean(entity && id && EXPLORER_ENTITY_ROUTES.has(entity));
}

function isAppRoute(pathname: string): boolean {
  return APP_ROUTES.some(route => pathname === route || pathname.startsWith(route + '/'));
}

function isDashboardShellRoute(pathname: string): boolean {
  return DASHBOARD_SHELL_ROUTES.some(route => pathname === route || pathname.startsWith(route + '/'));
}

export default function ConditionalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (isLoading) return;
    if (isAppRoute(pathname)) {
      if (!isAuthenticated) router.replace(`/signin?next=${encodeURIComponent(pathname === '/dashboard' ? '/home' : pathname)}`);
      return;
    }
    if (!isAuthRoute(pathname) && !isPublicRoute(pathname) && !isExplorerRoute(pathname) && !isAuthenticated) {
      router.push('/signin');
    }
  }, [isLoading, isAuthenticated, pathname, router]);

  if (isAppRoute(pathname)) {
    if (isLoading || !isAuthenticated) return null;
    if (isDashboardShellRoute(pathname)) return <ReleeveApp />;
    return <>{children}</>;
  }

  if (isAuthRoute(pathname)) {
    return <>{children}</>;
  }

  if (pathname === '/') {
    return <>{children}</>;
  }

  if (isExplorerRoute(pathname)) {
    return <>{children}</>;
  }

  if (isPublicRoute(pathname)) {
    return <>{children}</>;
  }

  if (isLoading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#09090b', color: '#71717a'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 24, height: 24, border: '2px solid #27272a', borderTopColor: '#a78bfa',
            borderRadius: '50%', animation: 'spin 0.6s linear infinite', margin: '0 auto 12px'
          }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          Loading...
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <AppShell>{children}</AppShell>;
}
