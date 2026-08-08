import { ExplorerHome } from '@/components/explorer/explorer-home';

export default async function ExplorerPage({ params }: { params: Promise<{ network: string }> }) {
  const { network } = await params;
  return <ExplorerHome network={decodeURIComponent(network)} />;
}
