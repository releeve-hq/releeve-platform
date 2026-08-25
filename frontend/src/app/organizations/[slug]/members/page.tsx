import { OrganizationMembersPage } from '@/components/organizations/organization-settings-pages';

export default async function OrganizationMembersRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <OrganizationMembersPage slug={decodeURIComponent(slug)} />;
}