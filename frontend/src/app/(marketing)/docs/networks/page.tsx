import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocGuidePage } from "@/components/marketing/doc-guide";
import { getDocGuide } from "@/components/marketing/docs-data";

export const metadata: Metadata = {
  title: "Networks | Releeve Docs",
  description: "The Stellar networks Releeve can fork, replay, and write to.",
  alternates: { canonical: "/docs/networks" },
};

export default function NetworksPage() {
  const guide = getDocGuide("networks");
  if (!guide) notFound();
  return <DocGuidePage guide={guide} />;
}