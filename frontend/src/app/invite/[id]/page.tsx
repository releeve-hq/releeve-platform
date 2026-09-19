import { InviteAcceptPage } from "@/components/organizations/invite-accept";

export default async function InviteRoutePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <InviteAcceptPage invitationId={decodeURIComponent(id)} />;
}
