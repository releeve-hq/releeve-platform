'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import AppShell from '@/components/layout/app-shell';

const AUTH_ROUTES = ['/signin', '/signup', '/forgot-password', '/reset-password'];
const AUTH_PREFIX_ROUTES = ['/auth', '/temp'];
const PUBLIC_ROUTES: string[] = ['/'];
const LANDING_ROUTES = ['/bounties', '/jobs', '/about', '/terms', '/privacy'];
const EXPLORER_ENTITY_ROUTES = new Set(['ledger', 'tx', 'account', 'contract']);

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
  return PUBLIC_ROUTES.includes(pathname) || LANDING_ROUTES.some(route => pathname === route || pathname.startsWith(route + '/'));
}

function isExplorerRoute(pathname: string): boolean {
  if (pathname === '/explorer' || pathname.startsWith('/explorer/')) return true;
  const [, , entity, id] = pathname.split('/');
  return Boolean(entity && id && EXPLORER_ENTITY_ROUTES.has(entity));
}

export default function ConditionalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (isLoading) return;
    if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) {
      if (!isAuthenticated) router.replace('/signin?next=/dashboard');
      return;
    }
    if (!isAuthRoute(pathname) && !isPublicRoute(pathname) && !isExplorerRoute(pathname) && !isAuthenticated) {
      router.push('/signin');
    }
  }, [isLoading, isAuthenticated, pathname, router]);

  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) {
    if (isLoading || !isAuthenticated) return null;
    return <>{children}</>;
  }

  if (pathname === '/onboarding') {
    if (isLoading || !isAuthenticated) return null;
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
    if (isAuthenticated) {
      return <AppShell>{children}</AppShell>;
    }
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
