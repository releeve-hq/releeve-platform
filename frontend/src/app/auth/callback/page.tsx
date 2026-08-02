'use client';

import { Suspense } from 'react';
import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

function CallbackContent() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const accessToken = searchParams.get('accessToken');
    if (accessToken) {
      localStorage.setItem('access_token', accessToken);
      // Full page reload so AuthProvider re-initializes with the token
      window.location.href = '/dashboard';
    } else {
      setTimeout(() => { window.location.href = '/signin'; }, 2000);
    }
  }, [searchParams]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      <div className="spinner" />
      <p style={{ color: '#71717a', fontSize: 14 }}>Signing you in...</p>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <div className="auth-container">
      <div className="form-panel" style={{ gridColumn: '1 / -1' }}>
        <div className="auth-card" style={{ textAlign: 'center', paddingTop: 80 }}>
          <Suspense fallback={<div className="spinner" />}>
            <CallbackContent />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
