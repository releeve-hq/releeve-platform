import { OrganizationUsagePage } from '@/components/organizations/organization-settings-pages';

export default async function OrganizationUsageRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <OrganizationUsagePage slug={decodeURIComponent(slug)} />;
}