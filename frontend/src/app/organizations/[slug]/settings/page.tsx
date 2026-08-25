import { OrganizationSettingsPage } from '@/components/organizations/organization-settings-pages';

export default async function OrganizationSettingsRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <OrganizationSettingsPage slug={decodeURIComponent(slug)} />;
}