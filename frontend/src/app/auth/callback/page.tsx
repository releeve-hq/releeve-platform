'use client';

import { Suspense } from 'react';
import { useEffect } from 'react';
import { AuthStatusFrame } from '@/components/auth/auth-status-frame';
import '../../auth.css';

function CallbackContent() {
  useEffect(() => {
    window.location.replace('/home');
  }, []);

  return (
    <AuthStatusFrame title="Signing you in." description="Completing your secure sign-in and opening your organization.">
      <div className="auth-spinner" aria-label="Signing you in" />
    </AuthStatusFrame>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<AuthStatusFrame title="Signing you in." description="Completing your secure sign-in and opening your organization."><div className="auth-spinner" aria-label="Signing you in" /></AuthStatusFrame>}>
      <CallbackContent />
    </Suspense>
  );
}
