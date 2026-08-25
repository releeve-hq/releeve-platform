import { OrganizationBillingPage } from '@/components/organizations/organization-settings-pages';

export default async function OrganizationBillingRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <OrganizationBillingPage slug={decodeURIComponent(slug)} />;
}