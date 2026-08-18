import type { Metadata } from "next";
import { DocTabPage } from "@/components/marketing/doc-tab-page";
import { getDocTab } from "@/components/marketing/docs-data";

export const metadata: Metadata = {
  title: "API reference | Releeve Docs",
  description: "Programmatic access to Releeve simulations, environments, and monitoring.",
  alternates: { canonical: "/docs/api-reference" },
};

export default function ApiReferencePage() {
  const tab = getDocTab("api-reference");
  if (!tab) return null;
  return <DocTabPage tab={tab} />;
}