import type { Metadata } from "next";
import { DocTabPage } from "@/components/marketing/doc-tab-page";
import { getDocTab } from "@/components/marketing/docs-data";

export const metadata: Metadata = {
  title: "Changelog | Releeve Docs",
  description: "What changed in the Releeve platform, month by month.",
  alternates: { canonical: "/docs/changelog" },
};

export default function ChangelogPage() {
  const tab = getDocTab("changelog");
  if (!tab) return null;
  return <DocTabPage tab={tab} />;
}