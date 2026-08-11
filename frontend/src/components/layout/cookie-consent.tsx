"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, ChevronLeft, Cookie } from "lucide-react";
import { useEffect, useState } from "react";

const CONSENT_KEY = "releeve-cookie-consent";

type OptionalCategory = "preferences" | "analytics" | "marketing";
type StoredPrefs = Record<OptionalCategory, boolean>;

const ALL_ON: StoredPrefs = { preferences: true, analytics: true, marketing: true };
const ALL_OFF: StoredPrefs = { preferences: false, analytics: false, marketing: false };

const categories: Array<{ key: OptionalCategory | "essential"; label: string; description: string; required?: boolean }> = [
  { key: "essential", label: "Essential", description: "Authentication and security cookies required for Releeve to work.", required: true },
  { key: "preferences", label: "Preferences", description: "Remember choices such as your marketing theme." },
  { key: "analytics", label: "Analytics", description: "Help us understand product and documentation usage." },
  { key: "marketing", label: "Marketing", description: "Measure campaign performance when marketing tools are enabled." },
];

function loadPrefs(): StoredPrefs | null {
  const raw = localStorage.getItem(CONSENT_KEY);
  if (!raw) return null;
  if (raw === "accepted") return ALL_ON;
  if (raw === "declined") return ALL_OFF;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredPrefs>;
    return { preferences: !!parsed.preferences, analytics: !!parsed.analytics, marketing: !!parsed.marketing };
  } catch {
    return null;
  }
}

export default function CookieConsent() {
  const pathname = usePathname();
  const [prefs, setPrefs] = useState<StoredPrefs | null | undefined>(undefined);
  const [view, setView] = useState<"summary" | "manage">("summary");
  const [draft, setDraft] = useState<StoredPrefs>(ALL_OFF);

  useEffect(() => setPrefs(loadPrefs()), []);
  if (prefs !== null) return null;

  const save = (value: StoredPrefs) => {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(value));
    setPrefs(value);
  };
  const authRoute = pathname.startsWith("/signin") || pathname.startsWith("/signup") || pathname.startsWith("/auth");

  return (
    <aside className={`cookie-dialog${authRoute ? " cookie-dialog-dark" : ""}`} role="dialog" aria-modal="false" aria-label="Cookie preferences">
      {view === "summary" ? (
        <>
          <div className="cookie-heading"><span><Cookie size={16} /></span><div><strong>Cookie preferences</strong><small>Your choices stay in this browser.</small></div></div>
          <p>Essential cookies keep you signed in and secure. Optional cookies help remember preferences and improve Releeve. Read our <Link href="/privacy">Privacy Policy</Link>.</p>
          <div className="cookie-actions">
            <button type="button" className="cookie-primary" onClick={() => save(ALL_ON)}>Accept all</button>
            <button type="button" onClick={() => { setDraft(ALL_OFF); setView("manage"); }}>Manage</button>
            <button type="button" onClick={() => save(ALL_OFF)}>Reject optional</button>
          </div>
        </>
      ) : (
        <>
          <button type="button" className="cookie-back" onClick={() => setView("summary")}><ChevronLeft size={14} /> Back</button>
          <div className="cookie-heading"><span><Cookie size={16} /></span><div><strong>Manage cookies</strong><small>Essential cookies are always active.</small></div></div>
          <div className="cookie-categories">
            {categories.map((category) => {
              const checked = category.required || draft[category.key as OptionalCategory];
              return (
                <div className="cookie-category" key={category.key}>
                  <div><strong>{category.label}</strong><small>{category.description}</small></div>
                  {category.required ? <span className="cookie-required"><Check size={12} /> Required</span> : (
                    <button
                      type="button"
                      role="switch"
                      aria-label={category.label}
                      aria-checked={checked}
                      data-checked={checked}
                      onClick={() => setDraft((current) => ({ ...current, [category.key]: !checked }))}
                    ><i /></button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="cookie-actions cookie-manage-actions"><button type="button" className="cookie-primary" onClick={() => save(draft)}>Save preferences</button><button type="button" onClick={() => save(ALL_ON)}>Accept all</button></div>
        </>
      )}
    </aside>
  );
}
