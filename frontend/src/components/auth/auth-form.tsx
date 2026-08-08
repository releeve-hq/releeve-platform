'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ReleeveLogo } from '@/components/ui/releeve-logo';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

type AuthMode = 'login' | 'signup';
type OAuthProvider = 'github' | 'google';

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const { login, signup, error, isVerificationSent, isLoading, clearError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [oauthProvider, setOauthProvider] = useState<OAuthProvider | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const isLogin = mode === 'login';

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    clearError();
    setValidationError(null);
    if (!isLogin && password !== confirmPassword) {
      setValidationError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      if (isLogin) {
        await login(email, password);
        router.replace('/home');
      } else {
        await signup(email, password);
      }
    } catch {
      // The auth context exposes the user-safe API error.
    } finally {
      setSubmitting(false);
    }
  }

  async function startOAuth(provider: OAuthProvider) {
    if (oauthProvider) return;
    clearError();
    setValidationError(null);
    setOauthProvider(provider);
    try {
      const response = await api.post<{ auth_url: string }>(
        `/api/v1/auth/oauth/${provider}/start`,
        { redirect_uri: `${window.location.origin}/auth/callback` },
        { skipAuth: true },
      );
      window.location.assign(response.auth_url);
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : 'Could not start OAuth.');
      setOauthProvider(null);
    }
  }

  if (!isLogin && isVerificationSent) {
    return (
      <div className="auth-form-wrapper">
        <AuthTopbar href="/signin" label="Sign in" />
        <section className="auth-card auth-confirmation" aria-live="polite">
          <h1 className="auth-headline">Check your inbox.</h1>
          <p className="auth-description">
            We sent a verification link to {email || 'your email address'}. Confirm it before signing in.
          </p>
          <Link href="/signin" className="auth-email-button">Back to sign in</Link>
        </section>
      </div>
    );
  }

  return (
    <div className="auth-form-wrapper">
      <AuthTopbar href={isLogin ? '/signup' : '/signin'} label={isLogin ? 'Create account' : 'Sign in'} />
      <form className="auth-card" onSubmit={submit}>
        <h1 className="auth-headline">
          {isLogin ? <>Welcome back.<br />Sign in to build.</> : <>Start building.<br />Create your account.</>}
        </h1>
        <p className="auth-description">
          {isLogin
            ? 'Access your workspace, simulations, and investigations.'
            : 'Build, simulate, and investigate on Stellar with one developer workspace.'}
        </p>

        {(error || validationError) && <div className="auth-alert" role="alert">{validationError || error}</div>}

        <button className="auth-oauth-button" type="button" onClick={() => startOAuth('github')} disabled={oauthProvider !== null}>
          <GithubIcon />
          {oauthProvider === 'github' ? 'Connecting GitHub...' : 'Continue with GitHub'}
        </button>
        <button className="auth-oauth-button" type="button" onClick={() => startOAuth('google')} disabled={oauthProvider !== null}>
          <GoogleIcon />
          {oauthProvider === 'google' ? 'Connecting Google...' : 'Continue with Google'}
        </button>

        <div className="auth-divider">or</div>

        <label className="auth-field">
          <span className="sr-only">Email</span>
          <input type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label className="auth-field">
          <span className="sr-only">Password</span>
          <input type="password" autoComplete={isLogin ? 'current-password' : 'new-password'} placeholder={isLogin ? 'Password' : 'Create a password'} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} />
        </label>
        {!isLogin && (
          <label className="auth-field">
            <span className="sr-only">Confirm password</span>
            <input type="password" autoComplete="new-password" placeholder="Confirm your password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={8} />
          </label>
        )}

        <button className="auth-email-button" type="submit" disabled={submitting || isLoading}>
          {submitting ? 'Please wait...' : isLogin ? 'Sign in with email' : 'Continue with email'}
        </button>
        <p className="auth-legal">
          By {isLogin ? 'signing in' : 'signing up'}, you agree to our <Link href="/terms">Terms of Service</Link> and <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </form>
    </div>
  );
}

function AuthTopbar({ href, label }: { href: string; label: string }) {
  return (
    <div className="auth-topbar">
      <Link className="auth-brand" href="/" aria-label="Releeve home">
        <ReleeveLogo size={28} />
        <span>Releeve</span>
      </Link>
      <Link className="auth-switch" href={href}>{label}</Link>
    </div>
  );
}

function GithubIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.577.688.479C19.138 20.161 22 16.418 22 12c0-5.523-4.477-10-10-10z" fill="currentColor" /></svg>;
}

function GoogleIcon() {
  return <svg aria-hidden="true" viewBox="0 0 48 48" width="18" height="18"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" /><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" /><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" /><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.36-8.16 2.36-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48.62 24 48z" /></svg>;
}
