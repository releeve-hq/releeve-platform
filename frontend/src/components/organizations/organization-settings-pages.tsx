"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Copy, KeyRound, Plus, Save, Trash2, Upload, UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { useOrg, type Organization } from "@/components/organizations/organization-workspace";
import {
  SettingRow,
  ToastPopup,
  formatDate,
  roleFor,
  errorMessage,
  permissionOptions,
  rolePermissions,
  styles as settingsStyles,
} from "@/components/app/settings-pages";
import type { AccessToken, CreatedToken, InviteDraft, InviteResponse, Member, Paged, PermissionName } from "@/components/app/settings-pages";

type Notice = { kind: "ok" | "error"; text: string };

function OrgSettingsContent({ children }: { children: React.ReactNode }) {
  return <div className="org-settings-content"><style>{settingsStyles}</style>{children}</div>;
}

export function OrganizationSettingsPage({ slug }: { slug: string }) {
  const router = useRouter();
  const organization = useOrg();
  const [tokens, setTokens] = useState<AccessToken[]>([]);
  const [name, setName] = useState(organization?.name || organization?.slug || "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(organization?.avatar_url ?? null);
  const [tokenName, setTokenName] = useState("");
  const [createdToken, setCreatedToken] = useState<CreatedToken | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const loadTokens = useCallback(async () => {
    setNotice(null);
    try {
      const tokenPage = await api.get<Paged<AccessToken>>(`/api/v1/${encodeURIComponent(slug)}/access-tokens?limit=100`);
      setTokens(tokenPage.data ?? []);
    } catch (error) { setNotice({ kind: "error", text: errorMessage(error) }); }
  }, [slug]);

  useEffect(() => { void loadTokens(); }, [loadTokens]);

  async function saveOrganization() {
    if (!name.trim()) return;
    setBusy("general");
    setNotice(null);
    try {
      const updated = await api.patch<Organization>(`/api/v1/${encodeURIComponent(slug)}`, { name: name.trim(), avatar_url: avatarUrl });
      window.dispatchEvent(new CustomEvent<Organization>('releeve:organization-updated', { detail: updated }));
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

  async function createToken() {
    if (!tokenName.trim()) return;
    setBusy("token");
    setNotice(null);
    try {
      const created = await api.post<CreatedToken>(`/api/v1/${encodeURIComponent(slug)}/access-tokens`, { name: tokenName.trim() });
      setCreatedToken(created);
      setTokenName("");
      await loadTokens();
    } catch (error) { setNotice({ kind: "error", text: errorMessage(error) }); }
    finally { setBusy(null); }
  }

  async function revokeToken(token: AccessToken) {
    if (!window.confirm(`Revoke ${token.name}? This cannot be undone.`)) return;
    setBusy(token.id);
    try {
      await api.delete(`/api/v1/${encodeURIComponent(slug)}/access-tokens/${encodeURIComponent(token.id)}`);
      setTokens((current) => current.map((item) => item.id === token.id ? { ...item, revoked_at: new Date().toISOString() } : item));
    } catch (error) { setNotice({ kind: "error", text: errorMessage(error) }); }
    finally { setBusy(null); }
  }

  async function deleteOrganization() {
    if (!organization || !window.confirm(`Delete ${organization.name || organization.slug}? Every project and all organization data will be permanently removed.`)) return;
    setBusy("delete-organization");
    setNotice(null);
    try {
      await api.delete(`/api/v1/${encodeURIComponent(slug)}`);
      router.replace("/organizations");
    } catch (error) { setNotice({ kind: "error", text: errorMessage(error) }); setBusy(null); }
  }

  if (!organization) return null;

  return (
    <OrgSettingsContent>
      <ToastPopup message={toast} onDone={() => setToast(null)} />
      <div className="settings-page">
        <h1 className="settings-heading">Settings</h1>
        <main className="settings-content">
          <section className="settings-section" id="general">
            <h2 className="settings-section-title">General</h2>
            {notice && <div className={`settings-notice${notice.kind === "error" ? " error" : ""}`}>{notice.text}</div>}
            <div className="settings-avatar-row">
              <div className="settings-avatar">{avatarUrl ? <img src={avatarUrl} alt="" /> : (organization.name || organization.slug || "O").slice(0, 1).toUpperCase()}</div>
              <div><label className="settings-button"><Upload />Upload image<input className="settings-file" type="file" accept="image/*" onChange={(event) => void uploadAvatar(event.target.files?.[0] ?? null)} /></label></div>
            </div>
            <SettingRow label="Name" help="The name shown to everyone in this organization.">
              <input className="settings-input" value={name} onChange={(event) => setName(event.target.value)} aria-label="Organization name" />
              <div className="settings-actions"><button className="settings-button primary" type="button" disabled={busy === "general" || !name.trim()} onClick={saveOrganization}><Save />Save</button></div>
            </SettingRow>
            <SettingRow label="Slug" help="Used in API paths and project URLs."><input className="settings-input" value={organization.slug || slug} readOnly aria-label="Organization slug" /></SettingRow>
            <SettingRow label="Organization ID" help="A stable identifier for support and API integrations."><input className="settings-input" value={organization.id || "Loading..."} readOnly aria-label="Organization ID" /></SettingRow>
          </section>
          <section className="settings-section" id="access-tokens">
            <h2 className="settings-section-title">Access tokens</h2>
            <SettingRow label="Create token" help="Organization tokens authenticate API and CI workflows. The secret is shown once.">
              <div className="settings-inline-form"><input className="settings-input" value={tokenName} onChange={(event) => setTokenName(event.target.value)} placeholder="CI simulation runner" aria-label="Token name" /><button className="settings-button" type="button" disabled={busy === "token" || !tokenName.trim()} onClick={createToken}><Plus />Create</button></div>
              {createdToken && <div className="settings-secret"><KeyRound aria-hidden="true" size={15} /><code>{createdToken.token}</code><button type="button" className="settings-button icon" title="Copy token" aria-label="Copy token" onClick={async () => { await navigator.clipboard.writeText(createdToken.token); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? <Check /> : <Copy />}</button></div>}
            </SettingRow>
            <SettingRow label={`Tokens (${tokens.filter((token) => !token.revoked_at).length})`} help="Revoke credentials that are no longer in use.">
              {tokens.length ? <div className="settings-list">{tokens.map((token) => <div className="settings-list-item" key={token.id}><div className="settings-list-main"><div className="settings-list-title">{token.name}</div><div className="settings-list-meta">Created {formatDate(token.created_at)} · Last used {formatDate(token.last_used_at)}</div></div><span className="settings-badge">{token.revoked_at ? "Revoked" : "Active"}</span>{!token.revoked_at && <button className="settings-button icon" type="button" title={`Revoke ${token.name}`} aria-label={`Revoke ${token.name}`} disabled={busy === token.id} onClick={() => revokeToken(token)}><Trash2 /></button>}</div>)}</div> : <div className="settings-empty">No organization access tokens have been created.</div>}
            </SettingRow>
          </section>
          <section className="settings-section" id="danger-zone">
            <h2 className="settings-section-title danger">Danger zone</h2>
            <SettingRow label="Delete organization" help="Permanently removes the organization and every project it owns. Only the formal owner can perform this action.">
              <button type="button" className="settings-button danger" disabled={organization.is_owner !== true || busy === "delete-organization"} onClick={deleteOrganization}><Trash2 />{busy === "delete-organization" ? "Deleting..." : "Delete organization"}</button>
              {organization.is_owner !== true && <div className="settings-help">Only the organization owner can delete this organization.</div>}
            </SettingRow>
          </section>
        </main>
      </div>
    </OrgSettingsContent>
  );
}

export function OrganizationMembersPage({ slug }: { slug: string }) {
  const organization = useOrg();
  const [members, setMembers] = useState<Member[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteDraft, setInviteDraft] = useState<InviteDraft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const loadMembers = useCallback(async () => {
    setNotice(null);
    try {
      const memberPage = await api.get<Paged<Member>>(`/api/v1/${encodeURIComponent(slug)}/members?limit=100`);
      setMembers(memberPage.data ?? []);
    } catch (error) { setNotice({ kind: "error", text: errorMessage(error) }); }
  }, [slug]);

  useEffect(() => { void loadMembers(); }, [loadMembers]);

  async function inviteMember() {
    if (!inviteEmail.trim()) return;
    setInviteDraft({ email: inviteEmail.trim().toLowerCase(), role: "developer", permissions: rolePermissions.developer });
  }

  async function submitInvite() {
    if (!inviteDraft) return;
    setBusy("invite");
    setNotice(null);
    try {
      const response = await api.post<InviteResponse>(`/api/v1/${encodeURIComponent(slug)}/members`, { email: inviteDraft.email, permissions: inviteDraft.permissions });
      if (response.kind === "member") {
        const member: Member = { id: response.id, user_id: response.user_id, email: response.email, username: response.username, permissions: response.permissions, is_owner: response.is_owner };
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
    if (!window.confirm(`Remove ${member.email} from this organization?`)) return;
    setBusy(member.id);
    try {
      await api.delete(`/api/v1/${encodeURIComponent(slug)}/members/${encodeURIComponent(member.id)}`);
      setMembers((current) => current.filter((item) => item.id !== member.id));
    } catch (error) { setNotice({ kind: "error", text: errorMessage(error) }); }
    finally { setBusy(null); }
  }

  async function transferOwnership(member: Member) {
    if (!window.confirm(`Transfer ownership of this organization to ${member.email}?`)) return;
    setBusy(`owner-${member.id}`);
    setNotice(null);
    try {
      await api.post<Organization>(`/api/v1/${encodeURIComponent(slug)}/owner`, { member_id: member.id });
      setMembers((current) => current.map((item) => ({ ...item, is_owner: item.id === member.id })));
      setNotice({ kind: "ok", text: `Ownership transferred to ${member.email}.` });
    } catch (error) { setNotice({ kind: "error", text: errorMessage(error) }); }
    finally { setBusy(null); }
  }

  if (!organization) return null;

  return (
    <OrgSettingsContent>
      <div className="settings-page">
        <h1 className="settings-heading">Members</h1>
        <main className="settings-content">
          <section className="settings-section" id="members">
            {notice && <div className={`settings-notice${notice.kind === "error" ? " error" : ""}`}>{notice.text}</div>}
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
                {members.length ? <div className="settings-list">{members.map((member) => <div className="settings-list-item" key={member.id}><div className="settings-list-main"><div className="settings-list-title">{member.username || member.email}</div><div className="settings-list-meta">{member.email}</div></div><span className="settings-badge">{roleFor(member)}</span>{organization.is_owner === true && !member.is_owner && <button className="settings-button icon" type="button" title={`Transfer ownership to ${member.email}`} aria-label={`Transfer ownership to ${member.email}`} disabled={busy === `owner-${member.id}`} onClick={() => transferOwnership(member)}><KeyRound /></button>}<button className="settings-button icon" type="button" title={`Remove ${member.email}`} aria-label={`Remove ${member.email}`} disabled={busy === member.id || member.is_owner} onClick={() => removeMember(member)}><Trash2 /></button></div>)}</div> : <div className="settings-empty">No members were returned for this organization.</div>}
              </SettingRow>
            </>}
          </section>
        </main>
      </div>
    </OrgSettingsContent>
  );
}

export function OrganizationBillingPage({ slug }: { slug: string }) {
  const organization = useOrg();
  if (!organization) return null;
  return (
    <OrgSettingsContent>
      <div className="settings-page">
        <h1 className="settings-heading">Billing</h1>
        <main className="settings-content">
          <section className="settings-section" id="billing">
            <SettingRow label="Current plan" help="Subscription and payment ownership belongs to the organization.">
              <div className="settings-list"><div className="settings-list-item"><div className="settings-list-main"><div className="settings-list-title">{organization.plan_tier || "Loading"}</div><div className="settings-list-meta">Organization subscription</div></div><span className="settings-badge">Active</span></div></div>
            </SettingRow>
            <SettingRow label="Invoices and payment" help="Billing details are managed through the configured billing provider.">
              <div className="settings-empty">No invoice or payment-method records were returned by the current billing API.</div>
            </SettingRow>
          </section>
        </main>
      </div>
    </OrgSettingsContent>
  );
}

export function OrganizationUsagePage({ slug }: { slug: string }) {
  const organization = useOrg();
  if (!organization) return null;
  return (
    <OrgSettingsContent>
      <div className="settings-page">
        <h1 className="settings-heading">Usage</h1>
        <main className="settings-content">
          <section className="settings-section" id="usage">
            <SettingRow label="Organization usage" help="Usage will aggregate simulations, API traffic, stored snapshots, environments, monitoring, and verification by project.">
              <div className="settings-empty">Usage metering has not reported a billing-period aggregate for this organization yet.</div>
            </SettingRow>
          </section>
        </main>
      </div>
    </OrgSettingsContent>
  );
}
