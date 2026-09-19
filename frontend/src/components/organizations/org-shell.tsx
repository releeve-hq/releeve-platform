"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { api } from "@/lib/api";
import { OrgContext, OrganizationFrame, type OrgTab, type Organization } from "./organization-workspace";

const TAB_TITLES: Record<OrgTab, string> = {
  projects: "Projects",
  members: "Members",
  usage: "Usage",
  billing: "Billing",
  settings: "Settings",
};

function activeTab(pathname: string): OrgTab {
  if (pathname.endsWith("/members")) return "members";
  if (pathname.endsWith("/usage")) return "usage";
  if (pathname.endsWith("/billing")) return "billing";
  if (pathname.endsWith("/settings")) return "settings";
  return "projects";
}

export function OrgShell({ slug, children }: { slug: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const tab = activeTab(pathname);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get<Organization>(`/api/v1/${encodeURIComponent(slug)}`)
      .then((org) => { if (!cancelled) setOrganization(org); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load this organization."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug]);

  useEffect(() => {
    const onOrganizationUpdated = (event: Event) => {
      const updated = (event as CustomEvent<Organization>).detail;
      if (updated?.slug === slug) setOrganization(updated);
      // Mirror the update into the dashboard's cached org list so the new
      // name renders instantly on the next dashboard mount (before refetch).
      if (updated?.slug) {
        try {
          const stored = localStorage.getItem('releeve-organizations-cache');
          const cached = stored ? JSON.parse(stored) as Organization[] : [];
          if (Array.isArray(cached) && cached.some((item) => item?.slug === updated.slug)) {
            localStorage.setItem('releeve-organizations-cache', JSON.stringify(
              cached.map((item) => item?.slug === updated.slug
                ? { ...item, name: updated.name ?? item.name, avatar_url: updated.avatar_url ?? item.avatar_url }
                : item),
            ));
          }
        } catch { /* ignore corrupt local state */ }
      }
    };
    window.addEventListener('releeve:organization-updated', onOrganizationUpdated);
    return () => window.removeEventListener('releeve:organization-updated', onOrganizationUpdated);
  }, [slug]);

  if (loading) return <OrganizationFrame title="Organization"><div className="org-page-loading"><LoaderCircle className="org-spin" size={22} />Loading organization...</div></OrganizationFrame>;
  if (!organization) return <OrganizationFrame title="Organization"><div className="org-page-loading"><p>{error || "Organization not found."}</p></div></OrganizationFrame>;

  return (
    <OrganizationFrame title={TAB_TITLES[tab]} organization={organization} active={tab}>
      <OrgContext.Provider value={organization}>{children}</OrgContext.Provider>
    </OrganizationFrame>
  );
}
