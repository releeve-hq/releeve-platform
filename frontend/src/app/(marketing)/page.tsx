import type { Metadata } from "next";
import { LandingPage } from "@/components/marketing/landing-page";

export const metadata: Metadata = {
  title: "Releeve | Stellar Operations Platform",
  description: "Fork real Stellar ledger state into persistent virtual networks, shape conditions, replay Soroban activity, and monitor what ships.",
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return <LandingPage />;
}
