import { OrgShell } from '@/components/organizations/org-shell';

export default async function OrganizationLayout({
  params,
  children,
}: {
  params: Promise<{ slug: string }>;
  children: React.ReactNode;
}) {
  const { slug } = await params;
  return <OrgShell slug={decodeURIComponent(slug)}>{children}</OrgShell>;
}