import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocGuidePage } from "@/components/marketing/doc-guide";
import { docGuides, getDocGuide } from "@/components/marketing/docs-data";

export function generateStaticParams() {
  return docGuides.map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const guide = getDocGuide(slug);
  if (!guide) return {};
  return { title: `${guide.label} | Releeve Docs`, description: guide.description, alternates: { canonical: `/docs/${guide.slug}` } };
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = getDocGuide(slug);
  if (!guide) notFound();
  const apiBase = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8080";
  return <DocGuidePage guide={guide} apiDocsUrl={slug === "api-reference" ? `${apiBase.replace(/\/$/, "")}/docs` : undefined} />;
}
