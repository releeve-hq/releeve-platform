import { TransactionDetailView } from "@/components/explorer/detail-views";

export default async function TransactionPage({
  params,
}: {
  params: Promise<{ network: string; hash: string }>;
}) {
  const { network, hash } = await params;
  return <TransactionDetailView network={network} hash={decodeURIComponent(hash)} />;
}
