"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Check, Copy, KeyRound, Plus, Save, Trash2, Upload, UserPlus } from "lucide-react";
import { api, ApiError } from "@/lib/api";

type Organization = {
  id: string;
  slug: string;
  name: string | null;
  avatar_url?: string | null;
  is_personal: boolean;
  plan_tier: string;
  owner_user_id: string;
};

type Project = {
  id: string;
  slug: string;
  name: string;
  network: "mainnet" | "testnet" | "futurenet";
  created_at?: string;
};

type Member = {
  id: string;
  user_id: string;
  email: string;
  username: string | null;
  permissions: string[];
  is_owner: boolean;
};

type AccessToken = {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

type CreatedToken = { id: string; name: string; token: string };
type Paged<T> = { data: T[] };
type PermissionName = "create_projects" | "update_projects" | "delete_projects" | "manage_members" | "manage_access_tokens" | "manage_billing" | "manage_fork_sessions" | "manage_alerts";
type InviteResponse = { kind: "member"; id: string; user_id: string; email: string; username: string | null; permissions: PermissionName[]; is_owner: boolean } | { kind: "invitation"; id: string; email: string; permissions: PermissionName[]; status: string; created_at: string };
type InviteDraft = { email: string; role: string; permissions: PermissionName[] };

type SettingsSection = {
  id: string;
  label: string;
  content: React.ReactNode;
  danger?: boolean;
};

const styles = `
  .settings-page { width: 100%; max-width: 1240px; margin: 0 auto; padding: 0 0 60px; }
  .settings-heading { margin: 0 0 30px; font-size: 28px; line-height: 1.2; font-weight: 720; letter-spacing: 0; }
  .settings-layout { display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: 48px; align-items: start; }
  .settings-content { min-width: 0; border: 1px solid var(--border); }
  .settings-section { scroll-margin-top: 24px; padding: 38px 46px; border-bottom: 1px solid var(--border); }
  .settings-section:last-child { border-bottom: 0; }
  .settings-section-title { margin: 0 0 28px; font-size: 20px; line-height: 1.25; font-weight: 720; letter-spacing: 0; }
  .settings-section-title.danger { color: var(--red); }
  .settings-row { display: grid; grid-template-columns: minmax(170px, .72fr) minmax(260px, 1.28fr); gap: 34px; align-items: start; padding: 22px 0; border-top: 1px solid var(--border); }
  .settings-row:first-of-type { border-top: 0; padding-top: 0; }
  .settings-row:last-child { padding-bottom: 0; }
  .settings-label { font-size: 13px; line-height: 1.45; font-weight: 680; color: var(--text); }
  .settings-help { margin-top: 5px; max-width: 280px; color: var(--text-dim); font-size: 12.5px; line-height: 1.55; }
  .settings-control { min-width: 0; }
  .settings-input { width: 100%; height: 40px; padding: 0 12px; border: 1px solid var(--border); border-radius: 5px; background: var(--panel); color: var(--text); font: inherit; font-size: 13px; outline: none; }
  .settings-input:focus { border-color: var(--text-faint); box-shadow: 0 0 0 2px color-mix(in srgb, var(--text) 10%, transparent); }
  .settings-input[readonly] { color: var(--text-dim); cursor: default; }
  .settings-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 10px; }
  .settings-button { min-height: 34px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; border: 1px solid var(--border); border-radius: 5px; padding: 7px 11px; background: var(--panel); color: var(--text); font: inherit; font-size: 12px; font-weight: 660; cursor: pointer; }
  .settings-button:hover:not(:disabled) { border-color: var(--text-faint); }
  .settings-button:focus-visible, .settings-index-link:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
  .settings-button:disabled { opacity: .48; cursor: default; }
  .settings-button.primary { background: var(--text); border-color: var(--text); color: var(--bg); }
  .settings-button.danger { color: var(--red); border-color: color-mix(in srgb, var(--red) 45%, var(--border)); background: color-mix(in srgb, var(--red) 7%, var(--panel)); }
  .settings-button.icon { width: 32px; min-height: 32px; padding: 0; }
  .settings-button svg { width: 14px; height: 14px; }
  .settings-index { position: sticky; top: 24px; border-left: 1px solid var(--border); padding: 4px 0 4px 24px; }
  .settings-index-link { width: 100%; display: block; border: 0; padding: 9px 0; background: transparent; color: var(--text-dim); font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
  .settings-index-link:hover, .settings-index-link.active { color: var(--text); }
  .settings-index-link.active { font-weight: 680; }
  .settings-list { border: 1px solid var(--border); border-radius: 5px; overflow: hidden; }
  .settings-list-item { display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
  .settings-list-item:last-child { border-bottom: 0; }
  .settings-list-main { min-width: 0; flex: 1; }
  .settings-list-title { overflow: hidden; color: var(--text); font-size: 12.5px; font-weight: 660; text-overflow: ellipsis; white-space: nowrap; }
  .settings-list-meta { margin-top: 3px; overflow: hidden; color: var(--text-faint); font-size: 11.5px; text-overflow: ellipsis; white-space: nowrap; }
  .settings-badge { display: inline-flex; align-items: center; border: 1px solid var(--border); border-radius: 999px; padding: 3px 8px; color: var(--text-dim); font-size: 10.5px; font-weight: 680; text-transform: capitalize; }
  .settings-empty { border: 1px dashed var(--border); border-radius: 5px; padding: 18px; color: var(--text-dim); font-size: 12.5px; line-height: 1.55; }
  .settings-inline-form { display: flex; gap: 8px; }
  .settings-inline-form .settings-input { flex: 1; }
  .settings-notice { margin-bottom: 14px; border: 1px solid var(--border); border-radius: 5px; padding: 11px 12px; color: var(--text-dim); background: var(--panel); font-size: 12px; line-height: 1.5; }
  .settings-notice.error { color: var(--red); border-color: color-mix(in srgb, var(--red) 40%, var(--border)); }
  .settings-secret { display: flex; align-items: center; gap: 8px; margin-top: 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 5px; background: var(--panel); }
  .settings-secret code { min-width: 0; flex: 1; overflow-wrap: anywhere; color: var(--text); font-size: 11.5px; }
  .settings-avatar-row { display: flex; align-items: center; justify-content: flex-start; gap: 14px; margin-bottom: 18px; }
  .settings-avatar { width: 58px; height: 58px; display: grid; place-items: center; overflow: hidden; border: 1px solid var(--border); border-radius: 50%; background: var(--panel); color: var(--text); font-weight: 760; }
  .settings-avatar img { width: 100%; height: 100%; object-fit: cover; }
  .settings-file { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; opacity: 0; pointer-events: none; }
  .settings-permission-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; margin-top: 12px; }
  .settings-permission { display: flex; gap: 8px; align-items: flex-start; border: 1px solid var(--border); border-radius: 5px; padding: 10px; color: var(--text-dim); font-size: 12px; line-height: 1.4; }
  .settings-permission strong { display: block; color: var(--text); font-size: 12.5px; }
  .settings-subhead { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
  .settings-subhead h3 { margin: 0; color: var(--text); font-size: 18px; }
  .pw-toast-container { position: fixed; top: 20px; left: 50%; z-index: 9999; display: flex; width: min(400px, 92vw); flex-direction: column; gap: 8px; pointer-events: none; transform: translateX(-50%); }
  .pw-toast { position: relative; height: 52px; overflow: hidden; border: 1px solid color-mix(in srgb, var(--text) 14%, transparent); border-radius: 8px; background: color-mix(in srgb, var(--panel) 84%, var(--bg) 16%); box-shadow: 0 8px 20px rgb(0 0 0 / 48%); animation: pwToastIn 260ms ease forwards; pointer-events: auto; }
  .pw-toast-fill { position: absolute; inset: 0; width: 0%; background: color-mix(in srgb, var(--text) 10%, var(--panel)); animation: pwToastFill 4s linear forwards; }
  .pw-toast-content { position: relative; display: flex; height: 100%; align-items: center; gap: 10px; padding: 0 14px; color: var(--text); font-size: 13px; font-weight: 560; white-space: nowrap; }
  .pw-toast-content span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .pw-toast-success svg { color: var(--green); }
  @keyframes pwToastIn { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes pwToastFill { from { width: 0%; } to { width: 100%; } }
  .settings-mobile-index { display: none; width: 100%; height: 40px; margin-bottom: 14px; border: 1px solid var(--border); border-radius: 5px; padding: 0 10px; background: var(--panel); color: var(--text); font: inherit; }
  @media (max-width: 900px) {
    .settings-page { padding-bottom: 36px; }
    .settings-heading { margin-bottom: 18px; font-size: 23px; }
    .settings-layout { display: block; }
    .settings-index { display: none; }
    .settings-mobile-index { display: block; position: sticky; top: 0; z-index: 4; }
    .settings-section { padding: 26px 20px; scroll-margin-top: 52px; }
    .settings-section-title { margin-bottom: 22px; font-size: 18px; }
    .settings-row { grid-template-columns: 1fr; gap: 12px; padding: 20px 0; }
    .settings-help { max-width: none; }
  }
  @media (max-width: 520px) {
    .settings-content { margin: 0 -1px; }
    .settings-section { padding: 24px 15px; }
    .settings-inline-form { align-items: stretch; flex-direction: column; }
    .settings-inline-form .settings-button { align-self: flex-start; }
    .settings-list-item { align-items: flex-start; flex-wrap: wrap; }
    .settings-permission-grid { grid-template-columns: 1fr; }
  }
`;

const permissionOptions: Array<{ id: PermissionName; label: string; help: string }> = [
  { id: "create_projects", label: "Create projects", help: "Create new project workspaces." },
  { id: "update_projects", label: "Update projects", help: "Rename and edit project configuration." },
  { id: "delete_projects", label: "Delete projects", help: "Remove project data." },
  { id: "manage_members", label: "Manage members", help: "Invite, remove, and edit members." },
  { id: "manage_access_tokens", label: "Manage tokens", help: "Create and revoke API tokens." },
  { id: "manage_billing", label: "Manage billing", help: "View and update billing ownership." },
  { id: "manage_fork_sessions", label: "Manage simulations", help: "Run controlled fork/session operations." },
  { id: "manage_alerts", label: "Manage alerts", help: "Create monitoring rules and destinations." },
];

const rolePermissions: Record<string, PermissionName[]> = {
  viewer: [],
  developer: ["create_projects", "update_projects", "manage_fork_sessions", "manage_alerts"],
  admin: permissionOptions.map((permission) => permission.id).filter((permission) => permission !== "manage_billing"),
  billing: ["manage_billing"],
};

function formatDate(value?: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function errorMessage(error: unknown) {
  return error instanceof ApiError || error instanceof Error ? error.message : "Something went wrong.";
}

function roleFor(member: Member) {
  const permissions = member.permissions;
  if (member.is_owner) return "Owner";
  if (permissions.includes("manage_members") && permissions.includes("manage_billing")) return "Admin";
  if (permissions.includes("manage_billing") && permissions.length === 1) return "Billing";
  if (permissions.length === 0) return "Viewer";
  return "Developer";
}

function SettingRow({ label, help, children }: { label: string; help: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div><div className="settings-label">{label}</div><div className="settings-help">{help}</div></div>
      <div className="settings-control">{children}</div>
    </div>
  );
}

function ToastPopup({ message, onDone }: { message: string | null; onDone: () => void }) {
  if (!message) return null;
  if (typeof document === "undefined") return null;
  return createPortal((
    <div className="pw-toast-container" role="status" aria-live="polite">
      <div className="pw-toast pw-toast-success" key={message}>
        <div className="pw-toast-fill" onAnimationEnd={onDone} />
        <div className="pw-toast-content"><Check size={16} /><span>{message}</span></div>
      </div>
    </div>
  ), document.body);
}

function IndexedSettings({ title, sections }: { title: string; sections: SettingsSection[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    const nodes = sections.map((section) => document.getElementById(section.id)).filter(Boolean) as HTMLElement[];
    if (!nodes.length) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id);
    }, { rootMargin: "-10% 0px -72% 0px", threshold: [0, .1, .5] });
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [sections]);

  const goTo = useCallback((id: string) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.history.replaceState(null, "", `${window.location.pathname}#${id}`);
  }, []);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash && sections.some((section) => section.id === hash)) requestAnimationFrame(() => goTo(hash));
  }, [goTo, sections]);

  return (
    <div className="settings-page">
      <style>{styles}</style>
      <h1 className="settings-heading">{title}</h1>
      <select className="settings-mobile-index" aria-label="Settings section" value={active} onChange={(event) => goTo(event.target.value)}>
        {sections.map((section) => <option key={section.id} value={section.id}>{section.label}</option>)}
      </select>
      <div className="settings-layout">
        <main className="settings-content">
          {sections.map((section) => (
            <section className="settings-section" id={section.id} key={section.id} aria-labelledby={`${section.id}-title`}>
              <h2 className={`settings-section-title${section.danger ? " danger" : ""}`} id={`${section.id}-title`}>{section.label}</h2>
              {section.content}
            </section>
          ))}
        </main>
        <nav className="settings-index" aria-label={`${title} sections`}>
          {sections.map((section) => (
            <button key={section.id} type="button" className={`settings-index-link${active === section.id ? " active" : ""}`} onClick={() => goTo(section.id)} aria-current={active === section.id ? "location" : undefined}>
              {section.label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}

export function OrganizationSettingsPage({ organizationSlug, canManageOwnership = false, onOrganizationUpdated, onOrganizationDeleted }: { organizationSlug: string | null; canManageOwnership?: boolean; onOrganizationUpdated?: (organization: Organization) => void; onOrganizationDeleted?: () => void }) {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [tokens, setTokens] = useState<AccessToken[]>([]);
  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteDraft, setInviteDraft] = useState<InviteDraft | null>(null);
  const [tokenName, setTokenName] = useState("");
  const [createdToken, setCreatedToken] = useState<CreatedToken | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationSlug) return;
    setNotice(null);
    try {
      const encoded = encodeURIComponent(organizationSlug);
      const [org, memberPage, tokenPage] = await Promise.all([
        api.get<Organization>(`/api/v1/${encoded}`),
        api.get<Paged<Member>>(`/api/v1/${encoded}/members?limit=100`),
        api.get<Paged<AccessToken>>(`/api/v1/${encoded}/access-tokens?limit=100`),
      ]);
      setOrganization(org);
      setName(org.name || org.slug);
      setAvatarUrl(org.avatar_url ?? null);
      setMembers(memberPage.data ?? []);
      setTokens(tokenPage.data ?? []);
    } catch (error) {
      setNotice({ kind: "error", text: errorMessage(error) });
    }
  }, [organizationSlug]);

  useEffect(() => { void load(); }, [load]);

  async function saveOrganization() {
    if (!organizationSlug || !name.trim()) return;
    setBusy("general");
    setNotice(null);
    try {
      const updated = await api.patch<Organization>(`/api/v1/${encodeURIComponent(organizationSlug)}`, { name: name.trim(), avatar_url: avatarUrl });
      setOrganization(updated);
      setAvatarUrl(updated.avatar_url ?? null);
      onOrganizationUpdated?.(updated);
      setToast("Organization details saved.");
    } catch (error) { setNotice({ kind: "error", text: errorMessage(error) }); }
    finally { setBusy(null); }
  }

  async function uploadAvatar(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setNotice({ kind: "error", text: "Choose an image file for the organization profile." });
      return;
    }
    if (file.size > 600_000) {
      setNotice({ kind: "error", text: "Use an image under 600 KB for now." });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAvatarUrl(typeof reader.result === "string" ? reader.result : null);
      setToast("Photo uploaded. Save to apply changes.");
    };
    reader.onerror = () => setNotice({ kind: "error", text: "Could not read that image." });
    reader.readAsDataURL(file);
  }

  async function inviteMember() {
    if (!organizationSlug || !inviteEmail.trim()) return;
    setInviteDraft({ email: inviteEmail.trim().toLowerCase(), role: "developer", permissions: rolePermissions.developer });
  }

  async function submitInvite() {
    if (!organizationSlug || !inviteDraft) return;
    setBusy("invite");
    setNotice(null);
    try {
      const response = await api.post<InviteResponse>(`/api/v1/${encodeURIComponent(organizationSlug)}/members`, { email: inviteDraft.email, permissions: inviteDraft.permissions });
      if (response.kind === "member") {
        const { kind, ...member } = response;
        setMembers((current) => [member, ...current]);
        setNotice({ kind: "ok", text: `${member.email} was added to the organization.` });
      } else {
        setNotice({ kind: "ok", text: `Invitation prepared for ${response.email}. They will appear as a member after accepting.` });
      }
      setInviteEmail("");
      setInviteDraft(null);
    } catch (error) { setNotice({ kind: "error", text: errorMessage(error) }); }
    finally { setBusy(null); }
  }

  function setInviteRole(role: string) {
    setInviteDraft((current) => current ? { ...current, role, permissions: rolePermissions[role] ?? current.permissions } : current);
  }

  function toggleInvitePermission(permission: PermissionName) {
    setInviteDraft((current) => {
      if (!current) return current;
      const exists = current.permissions.includes(permission);
      return { ...current, role: "custom", permissions: exists ? current.permissions.filter((item) => item !== permission) : [...current.permissions, permission] };
    });
  }

  async function removeMember(member: Member) {
    if (!organizationSlug || !window.confirm(`Remove ${member.email} from this organization?`)) return;
    setBusy(member.id);
    try {
      await api.delete(`/api/v1/${encodeURIComponent(organizationSlug)}/members/${encodeURIComponent(member.id)}`);
      setMembers((current) => current.filter((item) => item.id !== member.id));
    } catch (error) { setNotice({ kind: "error", text: errorMessage(error) }); }
    finally { setBusy(null); }
  }

  async function transferOwnership(member: Member) {
    if (!organizationSlug || !window.confirm(`Transfer ownership of this organization to ${member.email}?`)) return;
    setBusy(`owner-${member.id}`);
    setNotice(null);
    try {
      const updated = await api.post<Organization>(`/api/v1/${encodeURIComponent(organizationSlug)}/owner`, { member_id: member.id });
      setOrganization(updated);
      setMembers((current) => current.map((item) => ({ ...item, is_owner: item.id === member.id })));
      onOrganizationUpdated?.(updated);
      setNotice({ kind: "ok", text: `Ownership transferred to ${member.email}.` });
    } catch (error) { setNotice({ kind: "error", text: errorMessage(error) }); }
    finally { setBusy(null); }
  }

  async function deleteOrganization() {
    if (!organizationSlug || !organization || !window.confirm(`Delete ${organization.name || organization.slug}? Every project and all organization data will be permanently removed.`)) return;
    setBusy("delete-organization");
    setNotice(null);
    try {
      await api.delete(`/api/v1/${encodeURIComponent(organizationSlug)}`);
      onOrganizationDeleted?.();
    } catch (error) { setNotice({ kind: "error", text: errorMessage(error) }); setBusy(null); }
  }

  async function createToken() {
    if (!organizationSlug || !tokenName.trim()) return;
    setBusy("token");
    setNotice(null);
    try {
      const created = await api.post<CreatedToken>(`/api/v1/${encodeURIComponent(organizationSlug)}/access-tokens`, { name: tokenName.trim() });
      setCreatedToken(created);
      setTokenName("");
      await load();
    } catch (error) { setNotice({ kind: "error", text: errorMessage(error) }); }
    finally { setBusy(null); }
  }

  async function revokeToken(token: AccessToken) {
    if (!organizationSlug || !window.confirm(`Revoke ${token.name}? This cannot be undone.`)) return;
    setBusy(token.id);
    try {
      await api.delete(`/api/v1/${encodeURIComponent(organizationSlug)}/access-tokens/${encodeURIComponent(token.id)}`);
      setTokens((current) => current.map((item) => item.id === token.id ? { ...item, revoked_at: new Date().toISOString() } : item));
    } catch (error) { setNotice({ kind: "error", text: errorMessage(error) }); }
    finally { setBusy(null); }
  }

  if (!organizationSlug) return <IndexedSettings title="Organization settings" sections={[{ id: "general", label: "General", content: <div className="settings-empty">Select an organization to manage its settings.</div> }]} />;

  const sections: SettingsSection[] = [
    {
      id: "general", label: "General", content: <>
        {notice && <div className={`settings-notice${notice.kind === "error" ? " error" : ""}`}>{notice.text}</div>}
        <div className="settings-avatar-row">
          <div className="settings-avatar">{avatarUrl ? <img src={avatarUrl} alt="" /> : (organization?.name || organization?.slug || "O").slice(0, 1).toUpperCase()}</div>
          <div>
            <label className="settings-button"><Upload />Upload image<input className="settings-file" type="file" accept="image/*" onChange={(event) => void uploadAvatar(event.target.files?.[0] ?? null)} /></label>
          </div>
        </div>
        <SettingRow label="Name" help="The name shown to everyone in this organization.">
          <input className="settings-input" value={name} onChange={(event) => setName(event.target.value)} aria-label="Organization name" />
          <div className="settings-actions"><button className="settings-button primary" type="button" disabled={busy === "general" || !name.trim()} onClick={saveOrganization}><Save />Save</button></div>
        </SettingRow>
        <SettingRow label="Slug" help="Used in API paths and project URLs."><input className="settings-input" value={organization?.slug || organizationSlug} readOnly aria-label="Organization slug" /></SettingRow>
        <SettingRow label="Organization ID" help="A stable identifier for support and API integrations."><input className="settings-input" value={organization?.id || "Loading..."} readOnly aria-label="Organization ID" /></SettingRow>
      </>
    },
    {
      id: "members", label: "Members and roles", content: <>
        {inviteDraft ? <>
          <div className="settings-subhead"><button className="settings-button" type="button" onClick={() => setInviteDraft(null)}><ArrowLeft />Back</button><h3>{inviteDraft.email}</h3></div>
          <SettingRow label="Role" help="Choose a starting role, then fine tune individual permissions below.">
            <select className="settings-input" value={inviteDraft.role} onChange={(event) => setInviteRole(event.target.value)} aria-label="Invite role">
              <option value="viewer">Viewer</option>
              <option value="developer">Developer</option>
              <option value="admin">Admin</option>
              <option value="billing">Billing</option>
              <option value="custom">Custom</option>
            </select>
          </SettingRow>
          <SettingRow label="Permissions" help="These permissions are stored with the membership or pending invitation.">
            <div className="settings-permission-grid">{permissionOptions.map((permission) => <label className="settings-permission" key={permission.id}><input type="checkbox" checked={inviteDraft.permissions.includes(permission.id)} onChange={() => toggleInvitePermission(permission.id)} /><span><strong>{permission.label}</strong>{permission.help}</span></label>)}</div>
            <div className="settings-actions"><button className="settings-button primary" type="button" disabled={busy === "invite"} onClick={submitInvite}><UserPlus />Send invite</button></div>
          </SettingRow>
        </> : <>
          <SettingRow label="Invite member" help="Enter an email, then choose roles and permissions before adding them.">
            <div className="settings-inline-form"><input className="settings-input" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="developer@company.com" aria-label="Member email" /><button className="settings-button" type="button" disabled={busy === "invite" || !inviteEmail.trim()} onClick={inviteMember}><UserPlus />Add member</button></div>
          </SettingRow>
          <SettingRow label={`Members (${members.length})`} help="Organization roles apply across all projects.">
            {members.length ? <div className="settings-list">{members.map((member) => <div className="settings-list-item" key={member.id}><div className="settings-list-main"><div className="settings-list-title">{member.username || member.email}</div><div className="settings-list-meta">{member.email}</div></div><span className="settings-badge">{roleFor(member)}</span>{canManageOwnership && !member.is_owner && <button className="settings-button icon" type="button" title={`Transfer ownership to ${member.email}`} aria-label={`Transfer ownership to ${member.email}`} disabled={busy === `owner-${member.id}`} onClick={() => transferOwnership(member)}><KeyRound /></button>}<button className="settings-button icon" type="button" title={`Remove ${member.email}`} aria-label={`Remove ${member.email}`} disabled={busy === member.id || member.is_owner} onClick={() => removeMember(member)}><Trash2 /></button></div>)}</div> : <div className="settings-empty">No members were returned for this organization.</div>}
          </SettingRow>
        </>}
      </>
    },
    {
      id: "access-tokens", label: "Access tokens", content: <>
        <SettingRow label="Create token" help="Organization tokens authenticate API and CI workflows. The secret is shown once.">
          <div className="settings-inline-form"><input className="settings-input" value={tokenName} onChange={(event) => setTokenName(event.target.value)} placeholder="CI simulation runner" aria-label="Token name" /><button className="settings-button" type="button" disabled={busy === "token" || !tokenName.trim()} onClick={createToken}><Plus />Create</button></div>
          {createdToken && <div className="settings-secret"><KeyRound aria-hidden="true" size={15} /><code>{createdToken.token}</code><button type="button" className="settings-button icon" title="Copy token" aria-label="Copy token" onClick={async () => { await navigator.clipboard.writeText(createdToken.token); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? <Check /> : <Copy />}</button></div>}
        </SettingRow>
        <SettingRow label={`Tokens (${tokens.filter((token) => !token.revoked_at).length})`} help="Revoke credentials that are no longer in use.">
          {tokens.length ? <div className="settings-list">{tokens.map((token) => <div className="settings-list-item" key={token.id}><div className="settings-list-main"><div className="settings-list-title">{token.name}</div><div className="settings-list-meta">Created {formatDate(token.created_at)} · Last used {formatDate(token.last_used_at)}</div></div><span className="settings-badge">{token.revoked_at ? "Revoked" : "Active"}</span>{!token.revoked_at && <button className="settings-button icon" type="button" title={`Revoke ${token.name}`} aria-label={`Revoke ${token.name}`} disabled={busy === token.id} onClick={() => revokeToken(token)}><Trash2 /></button>}</div>)}</div> : <div className="settings-empty">No organization access tokens have been created.</div>}
        </SettingRow>
      </>
    },
    { id: "billing", label: "Billing", content: <><SettingRow label="Current plan" help="Subscription and payment ownership belongs to the organization."><div className="settings-list"><div className="settings-list-item"><div className="settings-list-main"><div className="settings-list-title">{organization?.plan_tier || "Loading"}</div><div className="settings-list-meta">Organization subscription</div></div><span className="settings-badge">Active</span></div></div></SettingRow><SettingRow label="Invoices and payment" help="Billing details are managed through the configured billing provider."><div className="settings-empty">No invoice or payment-method records were returned by the current billing API.</div></SettingRow></> },
    { id: "usage", label: "Usage and budgets", content: <SettingRow label="Organization usage" help="Usage will aggregate simulations, API traffic, stored snapshots, environments, monitoring, and verification by project."><div className="settings-empty">Usage metering has not reported a billing-period aggregate for this organization yet.</div></SettingRow> },
    { id: "audit-log", label: "Audit log", content: <SettingRow label="Security activity" help="Member, token, integration, billing, and destructive actions will be recorded here."><div className="settings-empty">The organization audit stream is not available from the current API.</div></SettingRow> },
    { id: "danger-zone", label: "Danger zone", danger: true, content: <SettingRow label="Delete organization" help="Permanently removes the organization and every project it owns. Only the formal owner can perform this action."><button type="button" className="settings-button danger" disabled={!canManageOwnership || busy === "delete-organization"} onClick={deleteOrganization}><Trash2 />{busy === "delete-organization" ? "Deleting..." : "Delete organization"}</button>{!canManageOwnership && <div className="settings-help">Only the organization owner can delete this organization.</div>}</SettingRow> },
  ];

  return <><ToastPopup message={toast} onDone={() => setToast(null)} /><IndexedSettings title="Organization settings" sections={sections} /></>;
}

export function ProjectSettingsPage({ organizationSlug, projectSlug, fallbackProject, onProjectUpdated, onProjectDeleted }: { organizationSlug: string | null; projectSlug: string | null; fallbackProject?: Project | null; onProjectUpdated?: (project: Project) => void; onProjectDeleted?: () => void }) {
  const [project, setProject] = useState<Project | null>(fallbackProject ?? null);
  const [name, setName] = useState(fallbackProject?.name ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const path = useMemo(() => organizationSlug && projectSlug ? `/api/v1/${encodeURIComponent(organizationSlug)}/projects/${encodeURIComponent(projectSlug)}` : null, [organizationSlug, projectSlug]);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    api.get<Project>(path).then((value) => { if (!cancelled) { setProject(value); setName(value.name); } }).catch((error) => { if (!cancelled) setNotice({ kind: "error", text: errorMessage(error) }); });
    return () => { cancelled = true; };
  }, [path]);

  async function saveProject() {
    if (!path || !name.trim()) return;
    setBusy("general");
    setNotice(null);
    try {
      const updated = await api.patch<Project>(path, { name: name.trim() });
      setProject(updated);
      onProjectUpdated?.(updated);
      setToast("Project details saved.");
    } catch (error) { setNotice({ kind: "error", text: errorMessage(error) }); }
    finally { setBusy(null); }
  }

  async function deleteProject() {
    if (!path || !project || !window.confirm(`Delete ${project.name}? All project data will be permanently removed.`)) return;
    setBusy("delete");
    setNotice(null);
    try { await api.delete(path); onProjectDeleted?.(); }
    catch (error) { setNotice({ kind: "error", text: errorMessage(error) }); setBusy(null); }
  }

  if (!organizationSlug || !projectSlug) return <IndexedSettings title="Project settings" sections={[{ id: "general", label: "General", content: <div className="settings-empty">Select a project to manage its settings.</div> }]} />;

  const sections: SettingsSection[] = [
    { id: "general", label: "General", content: <>
      {notice && <div className={`settings-notice${notice.kind === "error" ? " error" : ""}`}>{notice.text}</div>}
      <SettingRow label="Name" help="The project name shown throughout Releeve."><input className="settings-input" value={name} onChange={(event) => setName(event.target.value)} aria-label="Project name" /><div className="settings-actions"><button className="settings-button primary" type="button" disabled={busy === "general" || !name.trim() || name.trim() === project?.name} onClick={saveProject}><Save />Save</button></div></SettingRow>
      <SettingRow label="Slug" help="Used in API paths and project URLs."><input className="settings-input" value={project?.slug || projectSlug} readOnly aria-label="Project slug" /></SettingRow>
      <SettingRow label="Project ID" help="A stable project identifier for support and integrations."><input className="settings-input" value={project?.id || "Loading..."} readOnly aria-label="Project ID" /></SettingRow>
      <SettingRow label="Network" help="Network operations remain in their own product section. This is the project’s current network context."><div className="settings-list"><div className="settings-list-item"><div className="settings-list-main"><div className="settings-list-title" style={{ textTransform: "capitalize" }}>{project?.network || fallbackProject?.network || "Loading"}</div><div className="settings-list-meta">Read-only project context</div></div></div></div></SettingRow>
    </> },
    { id: "webhooks", label: "Webhooks", content: <SettingRow label="Project webhooks" help="Deliver project events to your own systems with signed requests and retry policies."><div className="settings-empty">Webhook endpoints remain managed by the project monitoring delivery API. This settings view will expose them when endpoint secrets can be rotated safely.</div></SettingRow> },
    { id: "notifications", label: "Notifications", content: <SettingRow label="Routing defaults" help="Choose which organization destinations receive this project’s alert deliveries."><div className="settings-empty">Alert rules continue to manage their own destinations. Project-wide routing defaults are not configured.</div></SettingRow> },
    { id: "data-retention", label: "Data and retention", content: <SettingRow label="Retention policy" help="Controls how long indexed transactions, traces, diagnostic events, and derived results are retained."><div className="settings-empty">This project currently follows the organization plan’s default retention policy.</div></SettingRow> },
    { id: "usage", label: "Project usage", content: <SettingRow label="Usage attribution" help="Project usage is reported here while subscriptions and payment remain organization-owned."><div className="settings-empty">No project usage aggregate has been reported for the current billing period.</div></SettingRow> },
    { id: "danger-zone", label: "Danger zone", danger: true, content: <SettingRow label="Delete project" help="Permanently removes this project and its indexed and derived data."><button type="button" className="settings-button danger" disabled={busy === "delete"} onClick={deleteProject}><Trash2 />{busy === "delete" ? "Deleting..." : "Delete project"}</button></SettingRow> },
  ];

  return <><ToastPopup message={toast} onDone={() => setToast(null)} /><IndexedSettings title="Project settings" sections={sections} /></>;
}
