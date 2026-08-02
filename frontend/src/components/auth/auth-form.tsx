'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ReleeveLogo } from '@/components/ui/releeve-logo';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8080';

interface AuthFormProps {
  mode: 'login' | 'signup';
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const { login, signup, error, isVerificationSent, isLoading: authLoading, clearError } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isLogin = mode === 'login';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    clearError();

    if (!isLogin && password !== confirmPassword) {
      // We handle this client-side; the server also validates
      return;
    }

    setSubmitting(true);
    try {
      if (isLogin) {
        await login(email, password);
        router.push('/dashboard');
      } else {
        await signup(email, password);
      }
    } catch {
      // Error is set by the auth context
    } finally {
      setSubmitting(false);
    }
  };

  if (!isLogin && isVerificationSent) {
    return (
      <div className="auth-card">
        <div className="logo-container">
          <ReleeveLogo size={32} />
        </div>
        <div className="alert-success">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
            <path d="M10 0C4.48 0 0 4.48 0 10s4.48 10 10 10 10-4.48 10-10S15.52 0 10 0zm-1 15l-5-5 1.41-1.41L9 12.17l6.59-6.59L17 7l-8 8z" fill="#22c55e" />
          </svg>
          <div>
            <strong>Verification email sent</strong>
            <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.8 }}>
              Check your inbox for the verification link. You need to verify your email before logging in.
            </p>
          </div>
        </div>
        <Link href="/signin" className="submit-btn" style={{ display: 'block', textAlign: 'center', textDecoration: 'none', lineHeight: '44px' }}>
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form className="auth-card" onSubmit={handleSubmit}>
      <div className="logo-container">
        <ReleeveLogo size={32} />
      </div>

      <p className="subtitle">
        {isLogin ? 'Sign in to your account' : 'Create your governance identity'}
      </p>
      <p className="login-prompt">
        {isLogin ? (
          <>Don&apos;t have an account? <Link href="/signup" className="auth-switch-btn" onClick={clearError}>Sign up</Link></>
        ) : (
          <>Already have an account? <Link href="/signin" className="auth-switch-btn" onClick={clearError}>Sign in</Link></>
        )}
      </p>

      {error && <div className="alert-error">{error}</div>}

      <div className="oauth-btn-wrap">
        <a className="oauth-btn" href={`${BACKEND_URL}/api/v1/auth/oauth/github`}>
          <svg className="oauth-icon" viewBox="0 0 24 24" fill="none">
            <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.577.688.479C19.138 20.161 22 16.418 22 12c0-5.523-4.477-10-10-10z" fill="currentColor" />
          </svg>
          {isLogin ? 'Sign in with GitHub' : 'Sign up with GitHub'}
        </a>
      </div>

      <div className="oauth-btn-wrap">
        <a className="oauth-btn" href={`${BACKEND_URL}/api/v1/auth/oauth/google`}>
          <svg className="oauth-icon" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.36-8.16 2.36-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
          {isLogin ? 'Sign in with Google' : 'Sign up with Google'}
        </a>
      </div>

      <div className="divider">Or continue with</div>

      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" type="email" placeholder="m@example.com" value={email} onChange={e => setEmail(e.target.value)} required />
      </div>

      <div className="field">
        <label htmlFor="password">
          Password
          {isLogin && <a href="#">Forgot your password?</a>}
        </label>
        <input id="password" type="password" placeholder={isLogin ? '' : 'Min. 8 characters'} value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
      </div>

      {!isLogin && (
        <div className="field">
          <label htmlFor="confirm-password">Confirm password</label>
          <input id="confirm-password" type="password" placeholder="Re-enter password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required minLength={8} />
        </div>
      )}

      {!isLogin && confirmPassword && password !== confirmPassword && (
        <div className="alert-error" style={{ marginBottom: 12 }}>Passwords do not match</div>
      )}

      <button className="submit-btn" type="submit" disabled={submitting || authLoading} style={{ opacity: submitting || authLoading ? 0.6 : 1 }}>
        {submitting ? 'Please wait...' : isLogin ? 'Continue' : 'Create account'}
      </button>

      <p className="footer-text">
        By clicking continue, you agree to our{' '}
        <a href="#">Terms of Service</a> and <a href="#">Privacy Policy</a>.
      </p>
    </form>
  );
}
