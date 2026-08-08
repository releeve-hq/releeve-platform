import { redirect } from 'next/navigation';

export default async function LedgerPage({
  params,
}: {
  params: Promise<{ network: string; sequence: string }>;
}) {
  const { network, sequence } = await params;
  redirect(`/explorer/${encodeURIComponent(network)}/ledger/${encodeURIComponent(sequence)}`);
}
