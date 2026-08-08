import { redirect } from 'next/navigation';

export default async function TransactionPage({
  params,
}: {
  params: Promise<{ network: string; hash: string }>;
}) {
  const { network, hash } = await params;
  redirect(`/explorer/${encodeURIComponent(network)}/tx/${encodeURIComponent(hash)}`);
}
