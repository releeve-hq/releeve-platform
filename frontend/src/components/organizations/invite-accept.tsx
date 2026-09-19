"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Check, LoaderCircle, LogIn, UserPlus } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { ReleeveLogo } from "@/components/ui/releeve-logo";

type Preview = {
  id: string;
  organization_slug: string;
  organization_name: string | null;
  role: string;
  status: string;
  email_hint: string;
};

function roleLabel(role: string) {
  return role ? role[0].toUpperCase() + role.slice(1) : "Member";
}

export function InviteAcceptPage({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Preview>(`/api/v1/invitations/${encodeURIComponent(invitationId)}`)
      .then((value) => {
        if (!cancelled) setPreview(value);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(
            cause instanceof ApiError && cause.status === 404
              ? "This invitation no longer exists."
              : "Could not load this invitation.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [invitationId]);

  const enter = useCallback(async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(
        `/api/v1/${encodeURIComponent(preview.organization_slug)}/invitations/${encodeURIComponent(preview.id)}/accept`,
        {},
      );
      setAccepted(true);
      window.setTimeout(() => {
        router.push(`/organizations/${encodeURIComponent(preview.organization_slug)}`);
      }, 900);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        // Already a member (e.g. auto-claimed at signup) — just go in.
        router.push(`/organizations/${encodeURIComponent(preview.organization_slug)}`);
        return;
      }
      setError(
        cause instanceof ApiError && cause.status === 403
          ? `You're signed in as ${user?.email ?? "another account"}. This invitation is for ${preview.email_hint}.`
          : "Could not accept this invitation.",
      );
    } finally {
      setBusy(false);
    }
  }, [preview, router, user]);

  const orgName = preview?.organization_name || preview?.organization_slug || "this organization";

  return (
    <main className="invite-page">
      <div className="invite-card" role={preview ? undefined : "status"}>
        <ReleeveLogo size={30} tone="auto" />
        {!preview && !error && (
          <p className="invite-muted"><LoaderCircle className="invite-spin" size={16} />Loading invitation…</p>
        )}
        {error && !preview && (
          <>
            <h1>Invitation unavailable</h1>
            <p className="invite-muted">{error}</p>
            <Link className="invite-btn invite-btn-primary" href="/organizations">Go to organizations</Link>
          </>
        )}
        {preview && (
          <>
            {preview.status !== "pending" && !accepted && (
              <p className="invite-flag">This invitation is {preview.status}.</p>
            )}
            <p className="invite-eyebrow">You&apos;ve been invited to</p>
            <h1>{orgName}</h1>
            <div className="invite-meta">
              <span className="invite-role">{roleLabel(preview.role)}</span>
              <span className="invite-email">{preview.email_hint}</span>
            </div>
            {accepted ? (
              <p className="invite-done"><Check size={15} /> You&apos;re in — taking you to the organization…</p>
            ) : authLoading ? (
              <p className="invite-muted"><LoaderCircle className="invite-spin" size={16} />Checking your session…</p>
            ) : isAuthenticated ? (
              <button type="button" className="invite-btn invite-btn-primary" disabled={busy || preview.status !== "pending"} onClick={enter}>
                {busy ? "Entering…" : "Enter organization"}
              </button>
            ) : (
              <>
                <p className="invite-muted">Create an account with the invited email, or sign in to accept.</p>
                <div className="invite-actions">
                  <Link className="invite-btn invite-btn-primary" href="/signup"><UserPlus size={14} />Create account</Link>
                  <Link className="invite-btn" href={`/signin?next=${encodeURIComponent(`/invite/${invitationId}`)}`}><LogIn size={14} />Sign in</Link>
                </div>
              </>
            )}
            {error && preview && <p className="invite-error">{error}</p>}
          </>
        )}
      </div>
      <style>{`
        .invite-page{min-height:100dvh;display:grid;place-items:center;padding:24px;background:#121212;color:#f5f5f5;font-family:var(--font-inter),system-ui,sans-serif}
        .invite-card{width:min(100%,440px);display:grid;gap:10px;justify-items:center;padding:36px 32px;border:1px solid #2b2b2b;border-radius:4px;background:#181818;box-shadow:0 24px 80px rgba(0,0,0,.5);text-align:center;animation:invite-in 220ms cubic-bezier(.2,.8,.3,1) forwards}
        @keyframes invite-in{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}
        .invite-eyebrow{margin:14px 0 0;color:#a1a1a1;font-size:12.5px}
        .invite-card h1{margin:0;font-size:22px;font-weight:650;overflow-wrap:anywhere}
        .invite-meta{display:flex;align-items:center;gap:8px;margin-top:2px}
        .invite-role{padding:3px 9px;border:1px solid #2b2b2b;border-radius:999px;font-size:11px;font-weight:700;text-transform:capitalize}
        .invite-email{color:#a1a1a1;font-size:12.5px;font-family:ui-monospace,monospace}
        .invite-muted{display:inline-flex;align-items:center;gap:8px;margin:8px 0 0;color:#a1a1a1;font-size:13px;line-height:1.55}
        .invite-spin{animation:invite-spin .8s linear infinite}
        @keyframes invite-spin{to{transform:rotate(360deg)}}
        .invite-flag{margin:0;padding:8px 12px;border:1px solid rgba(251,113,133,.4);border-radius:6px;background:rgba(251,113,133,.08);color:#fda4af;font-size:12.5px}
        .invite-error{margin:4px 0 0;color:#fb7185;font-size:12.5px;line-height:1.5}
        .invite-done{display:inline-flex;align-items:center;gap:8px;margin:10px 0 0;color:#a3ff5f;font-size:13.5px;font-weight:650}
        .invite-actions{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;justify-content:center}
        .invite-btn{min-height:36px;display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:0 18px;border:1px solid #2b2b2b;border-radius:4px;background:transparent;color:#f5f5f5;font:inherit;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none}
        .invite-btn svg{width:14px;height:14px}
        .invite-btn-primary{background:#078a4f;border-color:#0f8a4d;color:#fff}
        .invite-btn-primary:hover:not(:disabled){background:#079d59;border-color:#079d59}
        .invite-btn:disabled{opacity:.5;cursor:default}
      `}</style>
    </main>
  );
}
