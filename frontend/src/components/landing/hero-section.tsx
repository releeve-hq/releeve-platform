"use client";

import { useEffect, useState } from "react";
import { AnimatedSphere } from "./animated-sphere";

export function HeroSection() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  /* ── Trusted-by logos (text-based, matching the reference) ── */
  const logos = [
    { name: "Hugging Face", emoji: "🤗" },
    { name: "AIRBUS", mono: true },
    { name: "MARSH", mono: true },
    { name: "NVIDIA", mono: true },
    { name: "UPS", mono: true },
  ];

  return (
    <section className="relative flex flex-col overflow-hidden">
      {/* AnimatedSphere — kept in DOM, fully invisible */}
      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-[600px] h-[600px] lg:w-[800px] lg:h-[800px] opacity-0 pointer-events-none" aria-hidden="true">
        <AnimatedSphere />
      </div>

      {/* ── Hero copy ── */}
      <div
        className="relative z-10 px-6 lg:px-16 pt-28 pb-10 max-w-[1400px]"
        style={{
          transition: "opacity 0.9s ease, transform 0.9s ease",
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? "translateY(0)" : "translateY(24px)",
        }}
      >
        {/* Headline */}
        <h1
          className="font-display"
          style={{
            fontSize: "clamp(2.6rem, 7.5vw, 5.6rem)",
            fontWeight: 400,
            lineHeight: 1.08,
            letterSpacing: "-0.02em",
            color: "var(--foreground)",
            marginBottom: "1.6rem",
            maxWidth: "18ch",
          }}
        >
          Security Infrastructure
          <br />
          for{" "}
          <span
            style={{
              background: "#d4f000",
              color: "#0a0a00",
              padding: "0 6px 2px",
              display: "inline",
            }}
          >
            Developers
          </span>{" "}
          and{" "}
          <span
            style={{
              background: "#d4f000",
              color: "#0a0a00",
              padding: "0 6px 2px",
              display: "inline",
            }}
          >
            Agents
          </span>
        </h1>

        {/* Description + CTAs side by side (matches reference layout) */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-start",
            gap: "2.5rem",
            transition: "opacity 0.7s ease 0.2s, transform 0.7s ease 0.2s",
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? "translateY(0)" : "translateY(12px)",
          }}
        >
          {/* Description */}
          <p
            style={{
              fontSize: "clamp(0.9rem, 1.5vw, 1.05rem)",
              color: "var(--muted-foreground)",
              lineHeight: 1.6,
              maxWidth: "38ch",
              margin: 0,
            }}
          >
            All-in-one platform to securely manage application secrets, certificates,
            and privileged access across cloud, on-prem, and AI infrastructure.
          </p>

          {/* CTA buttons */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexShrink: 0 }}>
            <a
              href="/signup"
              style={{
                display: "inline-flex",
                alignItems: "center",
                height: 44,
                padding: "0 22px",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 600,
                fontFamily: "inherit",
                background: "var(--foreground)",
                color: "var(--background)",
                textDecoration: "none",
                transition: "opacity .15s",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")}
              onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
            >
              Get started for free
            </a>
            <a
              href="#demo"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                height: 44,
                padding: "0 20px",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 500,
                fontFamily: "inherit",
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--foreground)",
                textDecoration: "none",
                transition: "background .15s",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--muted)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor" aria-hidden="true">
                <path d="M0 0l10 6-10 6V0z" />
              </svg>
              Request a demo
            </a>
          </div>
        </div>
      </div>

      {/* ── Dark screenshot / product preview band ── */}
      <div
        className="relative z-10 mx-6 lg:mx-16"
        style={{
          transition: "opacity 0.8s ease 0.35s, transform 0.8s ease 0.35s",
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? "translateY(0)" : "translateY(16px)",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 880,
            height: "clamp(90px, 12vw, 150px)",
            borderRadius: 8,
            background: "linear-gradient(135deg, #111 0%, #1c1c1c 40%, #0a0a0a 100%)",
            overflow: "hidden",
            position: "relative",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          {/* subtle noise/texture inside */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)",
              backgroundSize: "4px 4px",
            }}
          />
          {/* faint vertical lines like dashboard lines */}
          {[0.18, 0.36, 0.54, 0.72].map((x, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: `${x * 100}%`,
                width: 1,
                background: "rgba(255,255,255,0.07)",
              }}
            />
          ))}
          {/* diagonal light sweep */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "35%",
              height: "100%",
              background: "linear-gradient(100deg, rgba(255,255,255,0.04) 0%, transparent 100%)",
            }}
          />
        </div>
      </div>

      {/* ── Trusted-by strip ── */}
      <div
        className="relative z-10 px-6 lg:px-16 pb-16 pt-10"
        style={{
          transition: "opacity 0.7s ease 0.5s",
          opacity: isVisible ? 1 : 0,
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 11,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--muted-foreground)",
            marginBottom: "1.25rem",
          }}
        >
          Trusted by the best teams in the world
        </p>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "clamp(1.5rem, 4vw, 3.5rem)",
            flexWrap: "wrap",
          }}
        >
          {logos.map(logo => (
            <span
              key={logo.name}
              style={{
                fontSize: logo.emoji ? 14 : "clamp(14px, 1.5vw, 20px)",
                fontWeight: 700,
                letterSpacing: logo.mono ? "0.04em" : 0,
                color: "var(--foreground)",
                opacity: 0.55,
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontFamily: logo.mono ? "var(--font-mono, monospace)" : "inherit",
              }}
            >
              {logo.emoji && <span style={{ fontSize: 22 }}>{logo.emoji}</span>}
              {logo.name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}