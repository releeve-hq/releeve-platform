import type { Metadata } from "next";
import { DocTabPage } from "@/components/marketing/doc-tab-page";
import { getDocTab } from "@/components/marketing/docs-data";

export const metadata: Metadata = {
  title: "Networks | Releeve Docs",
  description: "The Stellar networks Releeve can fork, replay, and write to.",
  alternates: { canonical: "/docs/networks" },
};

export default function NetworksPage() {
  const tab = getDocTab("networks");
  if (!tab) return null;
  return <DocTabPage tab={tab} />;
}