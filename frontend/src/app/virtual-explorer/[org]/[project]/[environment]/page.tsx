import { VirtualEnvironmentExplorer } from "@/components/explorer/virtual-environment-explorer";

export default async function VirtualExplorerPage({ params }: {
  params: Promise<{ org: string; project: string; environment: string }>;
}) {
  const values = await params;
  return <VirtualEnvironmentExplorer
    org={decodeURIComponent(values.org)}
    project={decodeURIComponent(values.project)}
    environment={decodeURIComponent(values.environment)}
  />;
}
