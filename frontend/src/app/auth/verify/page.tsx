'use client';

import { Suspense } from 'react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';

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
        const data = await api.get<{ access_token: string; user_id: string }>(
          `/api/v1/auth/verify?token=${encodeURIComponent(token)}`,
          { skipAuth: true }
        );
        localStorage.setItem('access_token', data.access_token);
        window.location.href = '/dashboard';
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
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div className="spinner" />
        <p style={{ color: '#71717a', fontSize: 14 }}>Verifying your email...</p>
      </div>
    );
  }

  return (
    <>
      <p style={{ color: error ? '#f87171' : '#fafafa' }}>{status}</p>
      {error && (
        <p style={{ marginTop: 16 }}>
          <a href="/signin" style={{ color: '#a78bfa', textDecoration: 'underline' }}>Return to sign in</a>
        </p>
      )}
    </>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="auth-container">
      <div className="form-panel" style={{ gridColumn: '1 / -1' }}>
        <div className="auth-card" style={{ textAlign: 'center', paddingTop: 80 }}>
          <Suspense fallback={
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <div className="spinner" />
              <p style={{ color: '#71717a', fontSize: 14 }}>Verifying your email...</p>
            </div>
          }>
            <VerifyContent />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
