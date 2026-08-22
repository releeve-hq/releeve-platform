import { OrganizationProjectPage } from '@/components/organizations/organization-workspace';

export default async function OrganizationProjectRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <OrganizationProjectPage slug={decodeURIComponent(slug)} />;
}
