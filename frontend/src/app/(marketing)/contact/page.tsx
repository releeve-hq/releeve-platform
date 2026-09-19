import type { Metadata } from "next";
import { ContactForm } from "@/components/marketing/contact-form";

export const metadata: Metadata = {
  title: "Talk to us | Releeve",
  description: "Tell the Releeve team what you are building on Stellar and how we can help.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <section className="contact-page marketing-frame">
      <div className="contact-intro">
        <p className="marketing-eyebrow"><span /> Talk to Releeve</p>
        <h1>Let’s talk about what your team is shipping.</h1>
        <p>Tell us what you are building on Stellar, where your operations workflow gets difficult, and what you want to make safer or easier.</p>
        <div className="contact-expectation">
          <span>What happens next</span>
          <p>We’ll read your note, understand the context, and follow up directly with the right next conversation.</p>
        </div>
      </div>
      <div className="contact-form-shell">
        <ContactForm />
      </div>
    </section>
  );
}
