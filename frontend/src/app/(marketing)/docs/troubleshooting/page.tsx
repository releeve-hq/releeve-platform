import type { Metadata } from "next";
import { DocTabPage } from "@/components/marketing/doc-tab-page";
import { getDocTab } from "@/components/marketing/docs-data";

export const metadata: Metadata = {
  title: "Troubleshooting | Releeve Docs",
  description: "Outcome semantics, fair-use limits, and common failure modes.",
  alternates: { canonical: "/docs/troubleshooting" },
};

export default function TroubleshootingPage() {
  const tab = getDocTab("troubleshooting");
  if (!tab) return null;
  return <DocTabPage tab={tab} />;
}