'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import ReleeveApp from '@/components/app/releeve-app';

const AUTH_ROUTES = ['/signin', '/signup', '/forgot-password', '/reset-password'];
const AUTH_PREFIX_ROUTES = ['/auth', '/temp'];
const PUBLIC_ROUTES: string[] = ['/'];
const MARKETING_ROUTES = ['/pricing', '/docs', '/terms', '/privacy'];
const PUBLIC_APP_ROUTES = ['/virtual-explorer', '/invite'];
const APP_ROUTES = [
  '/explorer',
  '/simulation',
  '/projects',
  '/settings',
  '/onboarding',
  '/organizations',
];

const DASHBOARD_SHELL_ROUTES = APP_ROUTES.filter(route => route !== '/onboarding' && route !== '/organizations');

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
  return PUBLIC_ROUTES.includes(pathname)
    || MARKETING_ROUTES.some(route => pathname === route || pathname.startsWith(route + '/'))
    || PUBLIC_APP_ROUTES.some(route => pathname === route || pathname.startsWith(route + '/'));
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
      if (!isAuthenticated) {
        const next = pathname === "/home" || pathname === "/dashboard" ? "/organizations" : pathname;
        router.replace(`/signin?next=${encodeURIComponent(next)}`);
      }
      return;
    }
    if (!isAuthRoute(pathname) && !isPublicRoute(pathname) && !isAuthenticated) {
      router.push('/signin');
    }
  }, [isLoading, isAuthenticated, pathname, router]);

  if (isAppRoute(pathname)) {
    if (isLoading || !isAuthenticated) return null;
    if (isDashboardShellRoute(pathname)) return <ReleeveApp>{children}</ReleeveApp>;
    return <>{children}</>;
  }

  if (isAuthRoute(pathname)) {
    return <>{children}</>;
  }

  if (pathname === '/') {
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

  return <>{children}</>;
}
