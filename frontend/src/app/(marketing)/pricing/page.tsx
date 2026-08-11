import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, Minus } from "lucide-react";

export const metadata: Metadata = {
  title: "Pricing | Releeve",
  description: "Compare the direction of Releeve Free, Pro, and Team plans without invented prices or checkout controls.",
  alternates: { canonical: "/pricing" },
};

const rows = [
  ["Public explorer", true, true, true],
  ["Projects and tracked entities", true, true, true],
  ["One-shot simulations", true, true, true],
  ["Monitoring and destinations", true, true, true],
  ["Persistent virtual environments", false, true, true],
  ["Continuous state sync", false, true, true],
  ["Higher API and history quotas", false, true, true],
  ["Multiple organizations", false, false, true],
  ["Advanced team controls", false, false, true],
] as const;

const plans = [
  { name: "Free", state: "Preview access", description: "Evaluate the complete current workflow while Releeve is in preview.", current: true },
  { name: "Pro", state: "Planned", description: "For individual developers and protocols running persistent, higher-volume workflows.", current: false },
  { name: "Team", state: "Planned", description: "For organizations coordinating environments, permissions, monitoring, and delivery.", current: false },
];

export default function PricingPage() {
  return (
    <>
      <section className="subpage-hero pricing-hero marketing-frame">
        <p className="marketing-eyebrow"><span /> Pricing direction</p>
        <h1>Clear plans for simulation, monitoring, and shared environments.</h1>
        <p>This comparison shows how Releeve capabilities are expected to group while final packaging and prices are still being shaped.</p>
      </section>

      <section className="pricing-plans marketing-frame">
        {plans.map((plan) => (
          <article key={plan.name} data-current={plan.current}>
            <div className="pricing-plan-head"><span>{plan.state}</span><h2>{plan.name}</h2><p>{plan.description}</p></div>
            <div className="pricing-plan-price">{plan.current ? "Free preview" : "Price not set"}<small>{plan.current ? "available now" : "planned tier"}</small></div>
            {plan.current ? <Link className="marketing-button marketing-button-primary" href="/signup">Create account <ArrowRight size={14} /></Link> : <span className="pricing-planned-button">Planned tier</span>}
          </article>
        ))}
      </section>

      <section className="pricing-comparison marketing-frame">
        <div className="pricing-comparison-head"><div>Capability</div>{plans.map((plan) => <div key={plan.name}>{plan.name}</div>)}</div>
        {rows.map(([label, free, pro, team]) => <div className="pricing-comparison-row" key={label}><div>{label}</div>{[free, pro, team].map((included, index) => <div key={`${label}-${plans[index].name}`}>{included ? <Check aria-label="Included" size={15} /> : <Minus aria-label="Not included" size={15} />}</div>)}</div>)}
      </section>

      <section className="pricing-notice marketing-frame">
        <div><span /> Preview policy</div>
        <p>Preview availability is not a promise that every planned capability is production-ready. Releeve will publish concrete limits, prices, plan terms, and migration details before moving teams onto paid tiers.</p>
      </section>

      <section className="marketing-final-cta marketing-frame">
        <div><p>No card. No checkout.</p><h2>Use the preview to test the workflow properly.</h2></div>
        <div className="marketing-final-actions"><Link className="marketing-button marketing-button-ink" href="/signup">Create account <ArrowRight size={15} /></Link><Link className="marketing-button marketing-button-signal-outline" href="/docs/quickstart">Quickstart</Link></div>
      </section>
    </>
  );
}
