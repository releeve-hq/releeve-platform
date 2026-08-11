import type { ReactNode } from "react";
import { DocsFrame } from "@/components/marketing/docs-frame";

export default function DocumentationLayout({ children }: { children: ReactNode }) {
  return <DocsFrame>{children}</DocsFrame>;
}
