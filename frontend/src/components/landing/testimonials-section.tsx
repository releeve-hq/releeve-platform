"use client";

import { useEffect, useState } from "react";

const whoItsFor = [
  {
    tag: "Projects \u2014 Bounties",
    statement:
      "You've got more open issues than hands to close them. Post a bounty, and Stellar's developer community goes to work.",
    highlight: "Get work done, without a full-time hire",
  },
  {
    tag: "Projects \u2014 Hiring",
    statement:
      "Stop guessing from a resume. Browse developers by their real GitHub activity and reach out to the ones who've already proven they can do the work.",
    highlight: "Hire on proof, not a resume",
  },
  {
    tag: "Developers \u2014 Bounties",
    statement:
      "Your GitHub activity already proves what you can do. Claim a bounty, ship the fix, and get paid the moment it merges.",
    highlight: "Get paid for merged code",
  },
  {
    tag: "Developers \u2014 Hiring",
    statement:
      "Every contribution becomes part of a track record projects can actually see. You don't have to apply \u2014 the right team can find you first.",
    highlight: "Get discovered, get hired",
  },
];

const categories = [
  "DeFi",
  "Payments",
  "Wallets & Custody",
  "Infrastructure",
  "Developer Tools",
  "NFTs & Gaming",
  "Public Goods",
  "Cross-Border Finance",
];

export function TestimonialsSection() {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % whoItsFor.length);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const active = whoItsFor[activeIndex];

  return (
    <section className="relative py-32 lg:py-40 border-t border-foreground/10 lg:pb-14">
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        {/* Section Label */}
        <div className="flex items-center gap-4 mb-16">
          <span className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
            Who It&rsquo;s For
          </span>
          <div className="flex-1 h-px bg-foreground/10" />
          <span className="font-mono text-xs text-muted-foreground">
            {String(activeIndex + 1).padStart(2, "0")} / {String(whoItsFor.length).padStart(2, "0")}
          </span>
        </div>

        {/* Main Statement + 2x2 Grid */}
        <div className="grid lg:grid-cols-12 gap-12 lg:gap-20">
          {/* Rotating Statement */}
          <div className="lg:col-span-7">
            <div key={activeIndex} className="animate-fade-in">
              <span className="font-mono text-xs tracking-widest text-muted-foreground uppercase block mb-4">
                {active.tag}
              </span>
              <blockquote>
                <p className="font-display text-3xl md:text-4xl lg:text-5xl leading-[1.1] tracking-tight text-foreground">
                  {active.statement}
                </p>
              </blockquote>
            </div>
          </div>

          {/* 2x2 Grid */}
          <div className="lg:col-span-5 flex flex-col justify-center">
            <div className="grid grid-cols-2 gap-3">
              {whoItsFor.map((item, idx) => (
                <button
                  key={idx}
                  onClick={() => setActiveIndex(idx)}
                  className={`p-4 border text-left transition-all duration-300 ${
                    idx === activeIndex
                      ? "border-foreground bg-foreground/5"
                      : "border-foreground/10 hover:border-foreground/30"
                  }`}
                >
                  <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase block mb-1.5">
                    {item.tag}
                  </span>
                  <p className="text-xs md:text-sm text-foreground/80 leading-snug">
                    {item.highlight}
                  </p>
                </button>
              ))}
            </div>

            {/* Navigation Dots */}
            <div className="flex gap-2 mt-6">
              {whoItsFor.map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setActiveIndex(idx)}
                  className={`h-2 transition-all duration-300 ${
                    idx === activeIndex
                      ? "w-8 bg-foreground"
                      : "w-2 bg-foreground/20 hover:bg-foreground/40"
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Marquee */}
        <div className="mt-24 pt-12 border-t border-foreground/10">
          <p className="font-mono text-xs tracking-widest text-muted-foreground uppercase mb-8 text-center">
            Built for every kind of Stellar project
          </p>
        </div>
      </div>

      <div className="w-full overflow-hidden">
        <div className="flex gap-16 items-center marquee" style={{ willChange: 'transform' }}>
          {[...Array(2)].map((_, setIdx) => (
            <div key={setIdx} className="flex gap-16 items-center shrink-0">
              {categories.map((category) => (
                <span
                  key={`${setIdx}-${category}`}
                  className="font-display text-xl md:text-2xl text-foreground/30 whitespace-nowrap hover:text-foreground transition-colors duration-300"
                >
                  {category}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
