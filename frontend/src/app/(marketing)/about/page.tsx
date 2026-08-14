import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Braces, Database, Eye, ShieldCheck } from "lucide-react";

export const metadata: Metadata = {
  title: "About | Releeve",
  description: "Why Releeve is building state-fork simulation and investigation infrastructure for Stellar and Soroban teams.",
  alternates: { canonical: "/about" },
};

const principles = [
  { icon: Database, title: "Real state before realism theater", body: "A useful test begins with the ledger entries, balances, authorizations, and protocol conditions that production code will actually encounter." },
  { icon: Eye, title: "Evidence over a green check", body: "Success is only the first result. Calls, events, state changes, return values, and resource consumption explain whether the outcome is safe." },
  { icon: ShieldCheck, title: "Control without custody", body: "State overrides and account impersonation belong inside isolated simulations. They should never require a user's private key or touch network funds." },
  { icon: Braces, title: "Stellar-native by construction", body: "Releeve uses Soroban's typed calls, ledger entries, authorization model, and resource metering instead of importing EVM assumptions that do not fit." },
];

export default function AboutPage() {
  return (
    <>
      <section className="subpage-hero marketing-frame">
        <p className="marketing-eyebrow"><span /> About Releeve</p>
        <h1>Production state should be a test input, not a surprise.</h1>
        <p>Releeve exists to give Stellar teams the missing layer between local fixtures and mainnet consequences: controlled execution against the state that already exists.</p>
      </section>

      <section className="about-thesis marketing-frame">
        <p className="marketing-section-index">THE PRODUCT THESIS</p>
        <div>
          <h2>Stellar has explorers and transaction simulators. It does not have a complete state-fork workflow.</h2>
          <p>Teams can inspect historical activity or simulate a transaction against current RPC state, but they cannot easily take a real ledger snapshot, change a whale balance, advance time, impersonate a signer, replace contract storage, and replay through the actual Soroban host.</p>
          <p>Fork Core is that execution layer. Releeve surrounds it with persistent projects, environments, decoded investigation, monitoring, destinations, and an API that can live in CI.</p>
        </div>
      </section>

      <section className="about-principles marketing-section-band">
        <div className="marketing-frame">
          <div className="marketing-section-heading">
            <p className="marketing-section-index">ENGINEERING PRINCIPLES</p>
            <h2>Built around what the chain can prove.</h2>
          </div>
          <div className="about-principles-grid">
            {principles.map((principle) => <article key={principle.title}><principle.icon size={19} /><h3>{principle.title}</h3><p>{principle.body}</p></article>)}
          </div>
        </div>
      </section>

      <section className="about-boundary marketing-frame">
        <div><p className="marketing-section-index">THE BOUNDARY</p><h2>Releeve is not trying to be everything around Stellar.</h2></div>
        <div>
          <p>The embedded explorer exists so an alert or simulation can be investigated without breaking context. Monitoring exists so teams know when production behavior diverges from what they tested. The differentiated work remains state forking and hypothetical execution.</p>
          <p>That focus also means no invented NFT layer, no EVM opcode theater, no L1/L2 panels, and no congestion-driven gas charts where Stellar&apos;s resource model calls for something different.</p>
          <Link href="/docs/simulations">Understand simulations <ArrowRight size={14} /></Link>
        </div>
      </section>

      <section className="marketing-final-cta marketing-frame">
        <div><p>From snapshot to evidence</p><h2>Start with the scenario your fixtures cannot represent.</h2></div>
        <div className="marketing-final-actions"><Link className="marketing-button marketing-button-ink" href="/signup">Create account <ArrowRight size={15} /></Link><Link className="marketing-button marketing-button-signal-outline" href="/docs">Read the docs</Link></div>
      </section>
    </>
  );
}
