import type { Metadata } from "next";
import { DocGuidePage } from "@/components/marketing/doc-guide";
import { getDocGuide } from "@/components/marketing/docs-data";

export const metadata: Metadata = {
  title: "Documentation | Releeve",
  description: "Guides for Releeve simulations, virtual networks, monitoring, explorer workflows, debugging, protocol support, and API access.",
  alternates: { canonical: "/docs" },
};

export default function DocumentationPage() {
  const guide = getDocGuide("overview");
  if (!guide) return null;
  return <DocGuidePage guide={guide} />;
}
