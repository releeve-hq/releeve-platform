import { LedgerDetailView } from '@/components/explorer/detail-views';

export default async function LedgerPage({ params }: { params: Promise<{ network: string; sequence: string }> }) {
  const { network, sequence } = await params;
  return <LedgerDetailView network={decodeURIComponent(network)} sequence={decodeURIComponent(sequence)} />;
}
