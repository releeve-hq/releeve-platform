import { AccountDetailView } from "@/components/explorer/detail-views";

export default async function AccountPage({
  params,
}: {
  params: Promise<{ network: string; address: string }>;
}) {
  const { network, address } = await params;
  return <AccountDetailView network={network} address={decodeURIComponent(address)} />;
}
