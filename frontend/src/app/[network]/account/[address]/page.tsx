import { redirect } from 'next/navigation';

export default async function AccountPage({
  params,
}: {
  params: Promise<{ network: string; address: string }>;
}) {
  const { network, address } = await params;
  redirect(`/explorer/${encodeURIComponent(network)}/account/${encodeURIComponent(address)}`);
}
