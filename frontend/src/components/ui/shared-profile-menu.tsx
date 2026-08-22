'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, Settings2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

type ProfileOrganization = {
  slug: string;
  name: string | null;
  avatar_url?: string | null;
};

const ACTIVE_WORKSPACE_KEY = 'releeve-active-workspace';

function rememberOrganization(slug: string) {
  let previous: { organization?: string; project?: string; network?: string } = {};
  try {
    previous = JSON.parse(localStorage.getItem(ACTIVE_WORKSPACE_KEY) || '{}');
  } catch {
    previous = {};
  }
  const network = previous.network === 'mainnet' || previous.network === 'testnet' || previous.network === 'futurenet' ? previous.network : 'mainnet';
  localStorage.setItem(ACTIVE_WORKSPACE_KEY, JSON.stringify({
    organization: slug,
    project: previous.organization === slug ? previous.project || '' : '',
    network,
  }));
}

export function SharedProfileMenu({
  organization,
  onOpenSettings,
}: {
  organization?: ProfileOrganization | null;
  onOpenSettings?: () => void;
}) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const label = organization?.name || organization?.slug || user?.email || 'Profile';
  const avatarUrl = organization?.avatar_url || user?.avatar_url;

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  async function signOut() {
    setOpen(false);
    await logout();
    router.replace('/signin');
  }

  function openSettings() {
    setOpen(false);
    if (onOpenSettings) {
      onOpenSettings();
      return;
    }
    if (organization?.slug) rememberOrganization(organization.slug);
    router.push('/settings/organization');
  }

  return (
    <div className="shared-profile-menu" ref={rootRef}>
      <button
        type="button"
        className="shared-profile-trigger"
        aria-label="Open profile menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {avatarUrl ? <img src={avatarUrl} alt="" /> : <span className="shared-profile-fallback" aria-hidden="true">{label.slice(0, 1).toUpperCase()}</span>}
      </button>
      {open && (
        <div className="shared-profile-panel" role="menu">
          <div className="shared-profile-summary">
            {avatarUrl ? <img src={avatarUrl} alt="" /> : <span className="shared-profile-fallback" aria-hidden="true">{label.slice(0, 1).toUpperCase()}</span>}
            <div><strong>{label}</strong><small>{organization ? 'Organization profile' : user?.email || 'Account profile'}</small></div>
          </div>
          {organization && <button type="button" role="menuitem" onClick={openSettings}><Settings2 size={15} />Organization settings</button>}
          <button type="button" role="menuitem" onClick={() => void signOut()}><LogOut size={15} />Sign out</button>
        </div>
      )}
      <style jsx>{`
        .shared-profile-menu { position: relative; display: inline-flex; flex-shrink: 0; }
        .shared-profile-trigger { display: inline-grid; width: 32px; height: 32px; place-items: center; padding: 0; overflow: hidden; border: 1px solid var(--border, #2b2b2b); border-radius: 50%; background: var(--panel, #181818); color: var(--text, #f5f5f5); cursor: pointer; }
        .shared-profile-trigger:hover { border-color: var(--text-faint, #707070); }
        .shared-profile-trigger img, .shared-profile-summary img { width: 100%; height: 100%; object-fit: cover; }
        .shared-profile-fallback { display: inline-grid; width: 100%; height: 100%; place-items: center; border-radius: 50%; color: currentColor; font-size: 12px; font-weight: 700; }
        .shared-profile-panel { position: absolute; top: calc(100% - 1px); right: 0; z-index: 1200; width: 248px; overflow: hidden; border: 1px solid var(--border, #2b2b2b); border-radius: 8px; background: var(--panel, #181818); box-shadow: 0 18px 42px rgb(0 0 0 / 48%); }
        .shared-profile-summary { display: flex; align-items: center; gap: 10px; padding: 12px; border-bottom: 1px solid var(--border, #2b2b2b); }
        .shared-profile-summary > img, .shared-profile-summary > .shared-profile-fallback { width: 30px; height: 30px; flex: 0 0 30px; border: 1px solid var(--border, #2b2b2b); }
        .shared-profile-summary > div { min-width: 0; }
        .shared-profile-summary strong, .shared-profile-summary small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .shared-profile-summary strong { color: var(--text, #f5f5f5); font-size: 12.5px; }
        .shared-profile-summary small { margin-top: 3px; color: var(--text-dim, #a1a1a1); font-size: 11px; }
        .shared-profile-panel > button { display: flex; width: 100%; align-items: center; gap: 9px; padding: 10px 12px; border: 0; background: transparent; color: var(--text-dim, #a1a1a1); font: inherit; font-size: 12.5px; text-align: left; cursor: pointer; }
        .shared-profile-panel > button:hover { background: var(--bg, #121212); color: var(--text, #f5f5f5); }
      `}</style>
    </div>
  );
}
