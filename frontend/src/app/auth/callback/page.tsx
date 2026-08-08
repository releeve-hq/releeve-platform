'use client';

import { Suspense } from 'react';
import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuthStatusFrame } from '@/components/auth/auth-status-frame';
import { storeTokenPair } from '@/lib/api';
import '../../auth.css';

function CallbackContent() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = fragment.get('access_token') ?? searchParams.get('accessToken');
    const refreshToken = fragment.get('refresh_token');
    if (accessToken) {
      storeTokenPair(accessToken, refreshToken ?? undefined);
      window.location.replace('/onboarding');
    } else {
      setTimeout(() => { window.location.replace('/signin'); }, 2000);
    }
  }, [searchParams]);

  return (
    <AuthStatusFrame title="Signing you in." description="Completing your secure sign-in and opening your workspace.">
      <div className="auth-spinner" aria-label="Signing you in" />
    </AuthStatusFrame>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<AuthStatusFrame title="Signing you in." description="Completing your secure sign-in and opening your workspace."><div className="auth-spinner" aria-label="Signing you in" /></AuthStatusFrame>}>
      <CallbackContent />
    </Suspense>
  );
}
