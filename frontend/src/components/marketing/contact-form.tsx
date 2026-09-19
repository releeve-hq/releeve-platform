"use client";

import { FormEvent, useRef, useState } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";

type FormState = "idle" | "submitting" | "success" | "error";

export function ContactForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<FormState>("idle");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("submitting");
    setError("");

    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "We could not send your message. Please try again.");
      formRef.current?.reset();
      setState("success");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We could not send your message. Please try again.");
      setState("error");
    }
  }

  return (
    <form className="contact-form" ref={formRef} onSubmit={submit}>
      <div className="contact-name-row">
        <ContactField label="First name" name="firstName" autoComplete="given-name" />
        <ContactField label="Last name" name="lastName" autoComplete="family-name" />
      </div>
      <ContactField label="Work email" name="email" type="email" autoComplete="email" />
      <ContactField label="Subject" name="subject" />
      <label className="contact-field">
        <span>Message</span>
        <textarea name="message" rows={7} maxLength={4000} placeholder="Tell us about your team and what you are building." required />
      </label>
      <label className="contact-honeypot" aria-hidden="true">
        Company website
        <input name="company" tabIndex={-1} autoComplete="off" />
      </label>
      <div className="contact-form-footer">
        <button className="marketing-button marketing-button-primary contact-submit" type="submit" disabled={state === "submitting"}>
          {state === "submitting" ? "Sending…" : "Send message"} <ArrowRight size={15} />
        </button>
        <p className={`contact-form-status${state === "error" ? " is-error" : ""}`} aria-live="polite">
          {state === "success" && <><CheckCircle2 size={15} /> Thanks — we’ll get back to you shortly.</>}
          {state === "error" && error}
        </p>
      </div>
    </form>
  );
}

function ContactField({ label, name, type = "text", autoComplete }: { label: string; name: string; type?: string; autoComplete?: string }) {
  return (
    <label className="contact-field">
      <span>{label}</span>
      <input name={name} type={type} autoComplete={autoComplete} maxLength={type === "email" ? 320 : 120} required />
    </label>
  );
}
