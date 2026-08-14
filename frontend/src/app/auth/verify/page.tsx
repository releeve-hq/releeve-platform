'use client';

import { Suspense } from 'react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { AuthStatusFrame } from '@/components/auth/auth-status-frame';
import '../../auth.css';

function VerifyContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setStatus('Missing verification token. Please check your email link.');
      setError(true);
      return;
    }

    const verify = async () => {
      try {
        await api.post('/api/v1/auth/verify', { token }, { skipAuth: true });
        window.location.replace('/signin?verified=1');
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'Verification failed.';
        setStatus(message);
        setError(true);
      }
    };
    verify();
  }, [searchParams]);

  if (!status && !error) {
    return (
      <AuthStatusFrame title="Verifying your email." description="A moment while we confirm your account.">
        <div className="auth-spinner" aria-label="Verifying your email" />
      </AuthStatusFrame>
    );
  }

  return (
    <AuthStatusFrame title="We could not verify that link." description={status || 'Please request a new verification email and try again.'}>
      <Link href="/signin" className="auth-email-button">Return to sign in</Link>
    </AuthStatusFrame>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<AuthStatusFrame title="Verifying your email." description="A moment while we confirm your account."><div className="auth-spinner" aria-label="Verifying your email" /></AuthStatusFrame>}>
      <VerifyContent />
    </Suspense>
  );
}
