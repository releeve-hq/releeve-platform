import type { Metadata } from "next";
import { LandingPage } from "@/components/marketing/landing-page";

export const metadata: Metadata = {
  title: "Releeve | Simulation infrastructure for Stellar",
  description: "Fork real Stellar ledger state, simulate Soroban transactions, inspect execution evidence, and monitor what ships.",
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return <LandingPage />;
}
