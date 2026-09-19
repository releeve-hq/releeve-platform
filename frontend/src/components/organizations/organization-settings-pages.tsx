"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Check, ChevronRight, Copy, Eye, KeyRound, Link2, MoreVertical, Pencil, Plus, Save, Search, Trash2, Upload, UserCheck, UserPlus, UserX, X } from "lucide-react";
import { api } from "@/lib/api";
import { useOrg, CompactSelect, type Organization } from "@/components/organizations/organization-workspace";
import {
  ConfirmModal,
  SettingRow,
  ToastPopup,
  formatDate,
  errorMessage,
  rolePermissions,
  styles as settingsStyles,
} from "@/components/app/settings-pages";
import type { AccessToken, CreatedToken, InviteResponse, Member, OrgInvitation, Paged } from "@/components/app/settings-pages";

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
  const [confirmDelete, setConfirmDelete] = useState(false);
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
    if (!organization) return;
    setBusy("delete-organization");
    setNotice(null);
    setConfirmDelete(false);
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
              <button type="button" className="settings-button solid-danger" disabled={organization.is_owner !== true || busy === "delete-organization"} onClick={() => setConfirmDelete(true)}><Trash2 />{busy === "delete-organization" ? "Deleting..." : "Delete organization"}</button>
              {organization.is_owner !== true && <div className="settings-help">Only the organization owner can delete this organization.</div>}
            </SettingRow>
          </section>
        </main>
      </div>
      {confirmDelete && <ConfirmModal title={`Delete ${organization.name || organization.slug}?`} body="Every project and all organization data will be permanently removed. This cannot be undone." confirmLabel="Delete organization" busy={busy === "delete-organization"} busyLabel="Deleting..." onCancel={() => setConfirmDelete(false)} onConfirm={() => void deleteOrganization()} />}
    </OrgSettingsContent>
  );
}

const MEMBER_ROLES = ["owner", "viewer", "member", "admin"] as const;
const INVITE_ROLES = ["viewer", "member", "admin"] as const;
const EDIT_ROLES = ["viewer", "member", "admin"] as const;

type MemberRow =
  | { kind: "member"; member: Member }
  | { kind: "invitation"; invitation: OrgInvitation };

function roleLabel(role: string) {
  return role ? role[0].toUpperCase() + role.slice(1) : "Viewer";
}

function statusLabel(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "suspended") return "Suspended";
  if (normalized === "pending") return "Pending";
  return "Active";
}

/// Mirrors the backend invite validation: local part, @, dotted domain,
/// no spaces. Empty strings are neutral (the row is skipped, not an error).
function validInviteEmail(email: string) {
  const value = email.trim();
  if (!value) return true;
  if (value.length > 254 || value.includes(" ")) return false;
  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@")) return false;
  const domain = value.slice(at + 1);
  return (
    domain.length > 0 &&
    domain.includes(".") &&
    !domain.startsWith(".") &&
    !domain.endsWith(".")
  );
}

export function OrganizationMembersPage({ slug }: { slug: string }) {
  const organization = useOrg();
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<OrgInvitation[]>([]);
  const [projects, setProjects] = useState<Array<{ id: string; slug: string; name: string }>>([]);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteRows, setInviteRows] = useState<Array<{ email: string; role: string }>>([{ email: "", role: "member" }]);
  const [selected, setSelected] = useState<MemberRow | null>(null);
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [menuMember, setMenuMember] = useState<string | null>(null);
  const [editing, setEditing] = useState<Member | null>(null);
  const [editRole, setEditRole] = useState("member");
  const [editStatus, setEditStatus] = useState("active");

  const loadAll = useCallback(async () => {
    setNotice(null);
    try {
      const [memberPage, inviteList, projectPage] = await Promise.all([
        api.get<Paged<Member>>(`/api/v1/${encodeURIComponent(slug)}/members?limit=100`),
        api.get<OrgInvitation[]>(`/api/v1/${encodeURIComponent(slug)}/invitations`),
        api.get<Paged<{ id: string; slug: string; name: string }>>(`/api/v1/${encodeURIComponent(slug)}/projects?limit=100`),
      ]);
      setMembers(memberPage.data ?? []);
      setInvitations(inviteList ?? []);
      setProjects((projectPage.data ?? []).map((project) => ({ id: project.id, slug: project.slug, name: project.name })));
    } catch (error) { setNotice({ kind: "error", text: errorMessage(error) }); }
  }, [slug]);

  useEffect(() => { void loadAll(); }, [loadAll]);
  useEffect(() => { setConfirmAction(null); }, [selected]);
  useEffect(() => {
    if (!menuMember) return;
    const close = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest("[data-member-menu]")) setMenuMember(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuMember(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuMember]);

  const rows = useMemo<MemberRow[]>(() => {
    const needle = query.trim().toLowerCase();
    const out: MemberRow[] = [];
    const sortedMembers = [...members].sort((a, b) => {
      if (a.is_owner !== b.is_owner) return a.is_owner ? -1 : 1;
      return (a.username || a.email).localeCompare(b.username || b.email);
    });
    for (const member of sortedMembers) {
      if (roleFilter !== "all" && member.role !== roleFilter) continue;
      if (statusFilter !== "all" && member.status.toLowerCase() !== statusFilter) continue;
      if (needle && !`${member.username || ""} ${member.email}`.toLowerCase().includes(needle)) continue;
      out.push({ kind: "member", member });
    }
    for (const invitation of invitations) {
      if (roleFilter !== "all" && invitation.role !== roleFilter) continue;
      if (statusFilter !== "all" && statusFilter !== "pending") continue;
      if (needle && !invitation.email.toLowerCase().includes(needle)) continue;
      out.push({ kind: "invitation", invitation });
    }
    return out;
  }, [members, invitations, query, roleFilter, statusFilter]);

  const ownerMissing = members.length === 0 && invitations.length === 0;

  async function sendInvites() {
    const targets = inviteRows
      .map((row) => ({ email: row.email.trim().toLowerCase(), role: row.role }))
      .filter((row) => row.email.length > 0);
    if (!targets.length || busy === "invite") return;
    if (targets.some((target) => !validInviteEmail(target.email))) return;
    setBusy("invite");
    setNotice(null);
    try {
      for (const target of targets) {
        const response = await api.post<InviteResponse>(`/api/v1/${encodeURIComponent(slug)}/members`, target);
        if (response.kind === "member") {
          setMembers((current) => {
            const next = current.filter((item) => item.id !== response.id);
            return [response, ...next];
          });
        }
      }
      await loadAll();
      setInviteRows([{ email: "", role: "member" }]);
      setInviteOpen(false);
      setNotice({ kind: "ok", text: targets.length === 1 ? `Invitation sent to ${targets[0].email}.` : `Invitations sent to ${targets.length} addresses.` });
    } catch (error) { setNotice({ kind: "error", text: errorMessage(error) }); }
    finally { setBusy(null); }
  }

  function openEdit(member: Member) {
    setMenuMember(null);
    setEditing(member);
    setEditRole(member.role);
    setEditStatus(member.status.toLowerCase() === "suspended" ? "suspended" : "active");
  }

  async function saveEdit() {
    if (!editing) return;
    const body: Record<string, string> = {};
    if (editRole !== editing.role) body.role = editRole;
    if (editStatus !== editing.status.toLowerCase()) body.status = editStatus;
    if (Object.keys(body).length === 0) {
      setEditing(null);
      return;
    }
    setBusy(`edit-${editing.id}`);
    setNotice(null);
    try {
      const updated = await api.patch<Member>(`/api/v1/${encodeURIComponent(slug)}/members/${encodeURIComponent(editing.id)}`, body);
      setMembers((current) => current.map((item) => (item.id === editing.id ? updated : item)));
      setSelected((current) => (current?.kind === "member" && current.member.id === editing.id ? { kind: "member", member: updated } : current));
      setEditing(null);
      setNotice({ kind: "ok", text: `${updated.email} was updated.` });
    } catch (error) { setNotice({ kind: "error", text: errorMessage(error) }); }
    finally { setBusy(null); }
  }

  async function setMemberStatus(member: Member, status: "active" | "suspended") {
    setBusy(`status-${member.id}`);
    setNotice(null);
    try {
      const updated = await api.patch<Member>(`/api/v1/${encodeURIComponent(slug)}/members/${encodeURIComponent(member.id)}`, { status });
      setMembers((current) => current.map((item) => (item.id === member.id ? updated : item)));
      setSelected((current) => (current?.kind === "member" && current.member.id === member.id ? { kind: "member", member: updated } : current));
      setConfirmAction(null);
      setNotice({ kind: "ok", text: status === "suspended" ? `${member.email} was suspended.` : `${member.email} is active again.` });
    } catch (error) { setNotice({ kind: "error", text: errorMessage(error) }); }
    finally { setBusy(null); }
  }

  async function revokeInvitation(invitation: OrgInvitation) {
    setBusy(`revoke-${invitation.id}`);
    setNotice(null);
    try {
      await api.delete(`/api/v1/${encodeURIComponent(slug)}/invitations/${encodeURIComponent(invitation.id)}`);
      setInvitations((current) => current.filter((item) => item.id !== invitation.id));
      setSelected(null);
      setMenuMember(null);
      setNotice({ kind: "ok", text: `Invitation for ${invitation.email} was revoked.` });
    } catch (error) { setNotice({ kind: "error", text: errorMessage(error) }); }
    finally { setBusy(null); }
  }

  async function removeMember(member: Member) {
    setBusy(member.id);
    setNotice(null);
    try {
      await api.delete(`/api/v1/${encodeURIComponent(slug)}/members/${encodeURIComponent(member.id)}`);
      setMembers((current) => current.filter((item) => item.id !== member.id));
      setSelected(null);
      setConfirmAction(null);
    } catch (error) { setNotice({ kind: "error", text: errorMessage(error) }); }
    finally { setBusy(null); }
  }

  async function transferOwnership(member: Member) {
    setBusy(`owner-${member.id}`);
    setNotice(null);
    try {
      await api.post<Organization>(`/api/v1/${encodeURIComponent(slug)}/owner`, { member_id: member.id });
      setMembers((current) => current.map((item) => ({ ...item, is_owner: item.id === member.id })));
      setSelected(null);
      setConfirmAction(null);
      setNotice({ kind: "ok", text: `Ownership transferred to ${member.email}.` });
    } catch (error) { setNotice({ kind: "error", text: errorMessage(error) }); }
    finally { setBusy(null); }
  }

  if (!organization) return null;

  const selectedMember = selected?.kind === "member" ? selected.member : null;
  const viewerIsOwner = organization.is_owner === true;

  return (
    <>
      <div className="org-members-page">
        <ToastPopup message={notice?.kind === "ok" ? notice.text : null} onDone={() => setNotice(null)} />
        <div className="org-members-heading"><h1>Members</h1></div>
        <div className="org-members-toolbar">
          <label className="org-project-search org-members-search">
            <Search size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search members" aria-label="Search members" />
          </label>
          <CompactSelect value={roleFilter} ariaLabel="Filter by role" onChange={setRoleFilter} options={[{ value: "all", label: "All roles" }, ...MEMBER_ROLES.map((role) => ({ value: role, label: roleLabel(role) }))]} />
          <CompactSelect value={statusFilter} ariaLabel="Filter by status" onChange={setStatusFilter} options={[{ value: "all", label: "All statuses" }, { value: "active", label: "Active" }, { value: "pending", label: "Pending" }, { value: "suspended", label: "Suspended" }]} />
          <button className="org-primary-button org-members-invite" type="button" onClick={() => { setInviteRows([{ email: "", role: "member" }]); setInviteOpen(true); }}><UserPlus size={15} />Invite member</button>
        </div>
        {notice?.kind === "error" && <div className="org-form-error">{notice.text}</div>}
        <div className="org-members-table">
          <div className="org-members-table-head"><span>Member</span><span>Role</span><span>Status</span><span>Projects</span><span>Joined</span><span /></div>
          {rows.map((row) => {
            if (row.kind === "invitation") {
              const invitation = row.invitation;
              return (
                <div className="org-member-row" role="button" tabIndex={0} key={`inv-${invitation.id}`} onClick={() => setSelected(row)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(row); } }}>
                  <span className="org-member-identity"><span className="org-member-avatar" aria-hidden="true">{(invitation.email || "?").slice(0, 1).toUpperCase()}</span><span><strong>{invitation.email}</strong><small>Invitation pending</small></span></span>
                  <span><span className="org-role-badge">{roleLabel(invitation.role)}</span></span>
                  <span><span className="org-status-badge is-pending">Pending</span></span>
                  <span className="org-member-count">—</span>
                  <span className="org-member-joined">{formatDate(invitation.created_at)}</span>
                  <span className="org-member-menu-cell" data-member-menu onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                    <button className="org-project-menu-trigger" type="button" aria-label={`Actions for ${invitation.email}`} aria-expanded={menuMember === `inv-${invitation.id}`} onClick={(event) => { event.stopPropagation(); setMenuMember((current) => (current === `inv-${invitation.id}` ? null : `inv-${invitation.id}`)); }}><MoreVertical size={15} /></button>
                    {menuMember === `inv-${invitation.id}` && (
                      <div className="org-project-menu" role="menu">
                        <button type="button" role="menuitem" onClick={(event) => { event.stopPropagation(); setMenuMember(null); setSelected(row); }}><Eye size={13} />Details</button>
                        <button type="button" role="menuitem" onClick={(event) => { event.stopPropagation(); setMenuMember(null); void navigator.clipboard.writeText(`${window.location.origin}/invite/${invitation.id}`); }}><Link2 size={13} />Copy invite link</button>
                        <button type="button" role="menuitem" onClick={(event) => { event.stopPropagation(); revokeInvitation(invitation); }} disabled={busy === `revoke-${invitation.id}`}><X size={13} />Revoke invite</button>
                      </div>
                    )}
                  </span>
                </div>
              );
            }
            const member = row.member;
            const suspended = member.status.toLowerCase() === "suspended";
            return (
              <div className="org-member-row" role="button" tabIndex={0} key={member.id} onClick={() => setSelected(row)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(row); } }}>
                <span className="org-member-identity"><span className="org-member-avatar" aria-hidden="true">{(member.username || member.email || "?").slice(0, 1).toUpperCase()}</span><span><strong>{member.username || member.email}</strong><small>{member.email}</small></span></span>
                <span><span className="org-role-badge">{roleLabel(member.role)}</span></span>
                <span><span className={`org-status-badge${suspended ? " is-suspended" : ""}`}>{statusLabel(member.status)}</span></span>
                <span className="org-member-count">{projects.length} project{projects.length === 1 ? "" : "s"}</span>
                <span className="org-member-joined">{formatDate(member.created_at)}</span>
                <span className="org-member-menu-cell" data-member-menu onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                  <button className="org-project-menu-trigger" type="button" aria-label={`Actions for ${member.email}`} aria-expanded={menuMember === member.id} onClick={(event) => { event.stopPropagation(); setMenuMember((current) => (current === member.id ? null : member.id)); }}><MoreVertical size={15} /></button>
                  {menuMember === member.id && (
                    <div className="org-project-menu" role="menu">
                      <button type="button" role="menuitem" onClick={(event) => { event.stopPropagation(); openEdit(member); }}><Pencil size={13} />Edit</button>
                      {!member.is_owner && (suspended
                        ? <button type="button" role="menuitem" onClick={(event) => { event.stopPropagation(); setMenuMember(null); setMemberStatus(member, "active"); }}><UserCheck size={13} />Unsuspend</button>
                        : <button type="button" role="menuitem" onClick={(event) => { event.stopPropagation(); setMenuMember(null); setMemberStatus(member, "suspended"); }}><Ban size={13} />Suspend</button>)}
                    </div>
                  )}
                </span>
              </div>
            );
          })}
          {rows.length === 0 && (
            ownerMissing ? (
              <div className="org-member-row org-member-owner-fallback">
                <span className="org-member-identity"><span className="org-member-avatar" aria-hidden="true">{(organization.name || organization.slug || "O").slice(0, 1).toUpperCase()}</span><span><strong>{organization.name || organization.slug}</strong><small>Organization owner</small></span></span>
                <span><span className="org-role-badge">Owner</span></span>
                <span><span className="org-status-badge">Active</span></span>
                <span className="org-member-count">{projects.length} project{projects.length === 1 ? "" : "s"}</span>
                <span className="org-member-joined">—</span>
                <span />
              </div>
            ) : (
              <div className="org-members-empty">No members match these filters.</div>
            )
          )}
        </div>
      </div>

      {inviteOpen && (
        <div className="org-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setInviteOpen(false); }}>
          <div className="org-modal" role="dialog" aria-modal="true" aria-label="Invite members">
            <button className="org-modal-close" type="button" onClick={() => setInviteOpen(false)} aria-label="Close"><X size={18} /></button>
            <h2>Invite members</h2>
            <p>Everyone gets a fixed role — permissions come with it and can&apos;t be customized.</p>
            <div className="org-invite-rows">
              {inviteRows.map((row, index) => (
                <div className="org-invite-row" key={index}>
                  <input className={`org-invite-email${row.email && !validInviteEmail(row.email) ? " is-invalid" : ""}`} type="email" value={row.email} onChange={(event) => setInviteRows((current) => current.map((item, i) => (i === index ? { ...item, email: event.target.value } : item)))} placeholder="member@company.com" aria-label={`Invite email ${index + 1}`} />
                  <CompactSelect value={row.role} ariaLabel={`Invite role ${index + 1}`} onChange={(role) => setInviteRows((current) => current.map((item, i) => (i === index ? { ...item, role } : item)))} options={INVITE_ROLES.map((role) => ({ value: role, label: roleLabel(role) }))} />
                  {inviteRows.length > 1 && <button className="org-invite-remove" type="button" aria-label={`Remove invite ${index + 1}`} onClick={() => setInviteRows((current) => current.filter((_, i) => i !== index))}><X size={14} /></button>}
                </div>
              ))}
            </div>
            <button className="org-invite-add" type="button" onClick={() => setInviteRows((current) => [...current, { email: "", role: "member" }])}><Plus size={14} />Add another</button>
            <div className="org-modal-foot">
              <button className="org-secondary-button" type="button" onClick={() => setInviteOpen(false)}>Cancel</button>
              <button className="org-primary-button" type="button" disabled={busy === "invite" || !inviteRows.some((row) => row.email.trim()) || inviteRows.some((row) => row.email.trim() && !validInviteEmail(row.email))} onClick={sendInvites}><UserPlus size={14} />{busy === "invite" ? "Sending..." : inviteRows.filter((row) => row.email.trim()).length > 1 ? "Send invites" : "Send invite"}</button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="org-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}>
          <div className="org-modal" role="dialog" aria-modal="true" aria-label="Edit member">
            <button className="org-modal-close" type="button" onClick={() => setEditing(null)} aria-label="Close"><X size={18} /></button>
            <div className="org-member-detail-head"><span className="org-member-avatar org-member-avatar-lg" aria-hidden="true">{(editing.username || editing.email || "?").slice(0, 1).toUpperCase()}</span><div><h2>{editing.username || editing.email}</h2><p>{editing.email}</p></div></div>
            <div className="org-edit-rows">
              <div className="org-edit-row">
                <span>Role</span>
                {editing.is_owner ? (
                  <span className="org-role-badge">Owner</span>
                ) : (
                  <CompactSelect value={editRole} ariaLabel="Member role" onChange={setEditRole} options={EDIT_ROLES.map((role) => ({ value: role, label: roleLabel(role) }))} />
                )}
              </div>
              <div className="org-edit-row">
                <span>Status</span>
                {editing.is_owner ? (
                  <span className="org-status-badge">Active</span>
                ) : (
                  <CompactSelect value={editStatus} ariaLabel="Member status" onChange={setEditStatus} options={[{ value: "active", label: "Active" }, { value: "suspended", label: "Suspended" }]} />
                )}
              </div>
            </div>
            <p className="org-member-detail-note">Roles carry fixed permissions — owner has everything, admin everything except billing, member can build and monitor, viewer is read-only.</p>
            <div className="org-modal-foot">
              <button className="org-secondary-button" type="button" onClick={() => setEditing(null)}>Cancel</button>
              <button className="org-primary-button" type="button" disabled={busy === `edit-${editing.id}`} onClick={saveEdit}><Check size={14} />{busy === `edit-${editing.id}` ? "Saving..." : "Save changes"}</button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div className="org-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
          <div className="org-modal" role="dialog" aria-modal="true" aria-label="Member details">
            <button className="org-modal-close" type="button" onClick={() => setSelected(null)} aria-label="Close"><X size={18} /></button>
            {selected.kind === "invitation" ? (
              <>
                <div className="org-member-detail-head"><span className="org-member-avatar org-member-avatar-lg" aria-hidden="true">{(selected.invitation.email || "?").slice(0, 1).toUpperCase()}</span><div><h2>{selected.invitation.email}</h2><p>Invited {formatDate(selected.invitation.created_at)}</p></div></div>
                <div className="org-member-detail-badges"><span className="org-role-badge">{roleLabel(selected.invitation.role)}</span><span className="org-status-badge is-pending">Pending</span></div>
                <p className="org-member-detail-note">They will appear as a member after accepting the invitation.</p>
                <div className="org-modal-foot"><button className="org-secondary-button" type="button" onClick={() => setSelected(null)}>Close</button></div>
              </>
            ) : (
              <>
                <div className="org-member-detail-head"><span className="org-member-avatar org-member-avatar-lg" aria-hidden="true">{(selectedMember?.username || selectedMember?.email || "?").slice(0, 1).toUpperCase()}</span><div><h2>{selectedMember?.username || selectedMember?.email}</h2><p>{selectedMember?.email}</p></div></div>
                <div className="org-member-detail-badges"><span className="org-role-badge">{roleLabel(selectedMember?.role ?? "")}</span><span className={`org-status-badge${selectedMember && selectedMember.status.toLowerCase() === "suspended" ? " is-suspended" : ""}`}>{statusLabel(selectedMember?.status ?? "")}</span></div>
                <div className="org-member-detail-section"><h3>Permissions</h3><ul>{(rolePermissions[selectedMember?.role ?? ""] ?? []).length ? (rolePermissions[selectedMember?.role ?? ""] ?? []).map((permission) => <li key={permission}>{permission.replaceAll("_", " ")}</li>) : <li>Read-only access.</li>}</ul></div>
                <div className="org-member-detail-section"><h3>Projects with access ({projects.length})</h3>{projects.length ? <ul>{projects.map((project) => <li key={project.id}>{project.name}</li>)}</ul> : <p className="org-member-detail-note">No projects in this organization yet.</p>}</div>
                <div className="org-member-detail-section"><h3>Joined</h3><p>{formatDate(selectedMember?.created_at)}</p></div>
                {selectedMember && (
                  <div className="org-modal-foot org-member-detail-actions">
                    <button className="org-secondary-button" type="button" onClick={() => setSelected(null)}>Close</button>
                    {viewerIsOwner && !selectedMember.is_owner && (
                      selectedMember.status.toLowerCase() === "suspended"
                        ? <button className="org-secondary-button" type="button" disabled={busy === `status-${selectedMember.id}`} onClick={() => setMemberStatus(selectedMember, "active")}><UserCheck size={14} />Unsuspend</button>
                        : <button className="org-secondary-button" type="button" disabled={busy === `status-${selectedMember.id}`} onClick={() => confirmAction === "suspend" ? setMemberStatus(selectedMember, "suspended") : setConfirmAction("suspend")}>{confirmAction === "suspend" ? "Confirm suspend?" : <><Ban size={14} />Suspend</>}</button>
                    )}
                    {!selectedMember.is_owner && (
                      confirmAction === "remove"
                        ? <button className="org-primary-button org-danger-button" type="button" disabled={busy === selectedMember.id} onClick={() => removeMember(selectedMember)}>Confirm remove?</button>
                        : <button className="org-secondary-button" type="button" onClick={() => setConfirmAction("remove")}><Trash2 size={14} />Remove</button>
                    )}
                    {viewerIsOwner && !selectedMember.is_owner && (
                      confirmAction === "owner"
                        ? <button className="org-secondary-button" type="button" disabled={busy === `owner-${selectedMember.id}`} onClick={() => transferOwnership(selectedMember)}><KeyRound size={14} />Confirm transfer?</button>
                        : <button className="org-secondary-button" type="button" onClick={() => setConfirmAction("owner")}><KeyRound size={14} />Make owner</button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
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
