export default async function ExplorerPage({ params }: { params: Promise<{ network: string }> }) {
  await params;
  return null;
}
