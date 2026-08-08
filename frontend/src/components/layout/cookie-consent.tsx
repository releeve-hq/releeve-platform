'use client';

import { useEffect, useState } from 'react';

const CONSENT_KEY = 'releeve-cookie-consent';

type Category = 'essential' | 'preferences' | 'analytics' | 'marketing';
type StoredPrefs = { preferences: boolean; analytics: boolean; marketing: boolean };

const ALL_ON: StoredPrefs = { preferences: true, analytics: true, marketing: true };
const ALL_OFF: StoredPrefs = { preferences: false, analytics: false, marketing: false };

function loadPrefs(): StoredPrefs | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(CONSENT_KEY);
  if (!raw) return null;
  if (raw === 'accepted') return ALL_ON;
  if (raw === 'declined') return ALL_OFF;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        preferences: !!parsed.preferences,
        analytics: !!parsed.analytics,
        marketing: !!parsed.marketing,
      };
    }
  } catch {
    /* ignore malformed value */
  }
  return null;
}

function store(prefs: StoredPrefs) {
  localStorage.setItem(CONSENT_KEY, JSON.stringify(prefs));
}

const CATEGORIES: Array<{
  key: Category;
  label: string;
  desc: string;
  mandatory: boolean;
}> = [
  {
    key: 'essential',
    label: 'Essential',
    desc: 'Keeps you signed in and makes the Service secure. Always on.',
    mandatory: true,
  },
  {
    key: 'preferences',
    label: 'Preferences',
    desc: 'Remember your settings, like theme and language, across visits.',
    mandatory: false,
  },
  {
    key: 'analytics',
    label: 'Analytics',
    desc: 'Help us understand how the Service is used so we can improve it.',
    mandatory: false,
  },
  {
    key: 'marketing',
    label: 'Marketing',
    desc: 'Used to personalize content and measure the impact of campaigns.',
    mandatory: false,
  },
];

export default function CookieConsent() {
  const [prefs, setPrefs] = useState<StoredPrefs | null>(null);
  const [view, setView] = useState<'main' | 'prefs'>('main');
  const [draft, setDraft] = useState<StoredPrefs>(ALL_OFF);

  useEffect(() => {
    setPrefs(loadPrefs());
  }, []);

  useEffect(() => {
    if (view === 'prefs') setDraft(prefs ?? ALL_OFF);
  }, [view, prefs]);

  if (prefs !== null) return null;

  const save = (next: StoredPrefs) => {
    store(next);
    setPrefs(next);
  };

  const toggle = (key: 'preferences' | 'analytics' | 'marketing') => {
    setDraft(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div
      role="dialog"
      aria-label="Cookie preferences"
      className="fixed bottom-6 left-6 z-[500] w-[min(380px,calc(100vw-3rem))] rounded-2xl"
      style={{
        background: '#1D1918',
        border: '1px solid #4a423c',
        color: '#f2efec',
        boxShadow: '0 20px 50px rgba(0,0,0,0.55)',
      }}
    >
      {view === 'main' ? (
        <div className="p-5">
          <div className="flex items-center gap-2.5 mb-3">
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'linear-gradient(135deg,#4a4440,#28231f)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CookieGlyph color="#e8823c" />
            </span>
            <span className="text-[15px] font-semibold" style={{ color: '#f2efec' }}>
              Manage your cookies
            </span>
          </div>

          <p className="text-[13px] leading-relaxed mb-4" style={{ color: '#9b9490' }}>
            We use cookies and similar technologies to keep you signed in, remember your
            preferences, and improve your experience. Essential cookies stay on for the
            Service to work — you choose the rest.{' '}
            <a
              href="/privacy"
              className="underline underline-offset-2 hover:opacity-80 transition-opacity"
              style={{ color: '#e8823c' }}
            >
              Privacy Policy
            </a>
          </p>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => save(ALL_ON)}
              className="w-full px-4 py-2.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
              style={{
                background: 'linear-gradient(135deg,#e8823c,#d96f2d)',
                color: '#1D1918',
              }}
            >
              Accept all
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setView('prefs')}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
                style={{
                  background: 'transparent',
                  border: '1px solid #4a423c',
                  color: '#f2efec',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#262221')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                Manage
              </button>
              <button
                type="button"
                onClick={() => save(ALL_OFF)}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
                style={{
                  background: 'transparent',
                  border: '1px solid #4a423c',
                  color: '#9b9490',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#262221')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                Reject non-essential
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <div className="px-5 pt-5 pb-1">
            <span className="text-[15px] font-semibold" style={{ color: '#f2efec' }}>
              Cookie preferences
            </span>
          </div>

          <div className="px-5 py-2 max-h-[260px] overflow-y-auto">
            {CATEGORIES.map(cat => {
              const enabled = cat.key === 'essential' || draft[cat.key];
              return <div
                key={cat.key}
                className="py-3 flex items-start justify-between gap-3"
                style={{ borderBottom: '1px solid #332e2a' }}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium" style={{ color: '#f2efec' }}>
                    {cat.label}
                    {cat.mandatory && (
                      <span
                        className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide"
                        style={{
                          background: '#3a2f1e',
                          color: '#d9a44a',
                        }}
                      >
                        Required
                      </span>
                    )}
                  </div>
                  <p className="text-xs leading-relaxed mt-0.5" style={{ color: '#9b9490' }}>
                    {cat.desc}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                   aria-checked={enabled}
                  aria-label={cat.label}
                  disabled={cat.mandatory}
                   onClick={() => { if (cat.key !== 'essential') toggle(cat.key); }}
                  className="shrink-0 mt-0.5"
                  style={{
                    width: 38,
                    height: 22,
                    borderRadius: 999,
                    border: '1px solid #4a423c',
                     background: enabled ? '#e8823c' : '#4a423c',
                    opacity: cat.mandatory ? 0.6 : 1,
                    position: 'relative',
                    cursor: cat.mandatory ? 'not-allowed' : 'pointer',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: 2,
                      left: 2,
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      background: '#f2efec',
                       transform: `translateX(${enabled ? 16 : 0}px)`,
                      transition: 'transform 0.2s ease',
                    }}
                  />
                </button>
              </div>;
            })}
          </div>

          <div className="px-5 py-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => save(draft)}
              className="w-full px-4 py-2.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(135deg,#e8823c,#d96f2d)', color: '#1D1918' }}
            >
              Save preferences
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setView('main')}
                className="flex-1 px-4 py-2 rounded-lg text-xs font-medium transition-colors"
                style={{ background: 'transparent', border: '1px solid #4a423c', color: '#9b9490' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#262221')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => save(ALL_ON)}
                className="flex-1 px-4 py-2 rounded-lg text-xs font-medium transition-colors"
                style={{ background: 'transparent', border: '1px solid #4a423c', color: '#f2efec' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#262221')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                Accept all
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CookieGlyph({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.8" />
      <circle cx="9" cy="9" r="1.4" fill={color} />
      <circle cx="15.5" cy="10.5" r="1.4" fill={color} />
      <circle cx="12.5" cy="14.5" r="1.2" fill={color} />
      <circle cx="8.5" cy="14" r="1" fill={color} />
    </svg>
  );
}
