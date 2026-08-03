import { ContractDetailView } from "@/components/explorer/detail-views";

export default async function ContractPage({
  params,
}: {
  params: Promise<{ network: string; address: string }>;
}) {
  const { network, address } = await params;
  return <ContractDetailView network={network} address={decodeURIComponent(address)} />;
}
