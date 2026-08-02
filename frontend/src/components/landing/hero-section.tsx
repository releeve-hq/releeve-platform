"use client";

import { useEffect, useState } from "react";
import { Button } from "./_ui/button";
import { ArrowRight } from "lucide-react";
import { AnimatedSphere } from "./animated-sphere";

export function HeroSection() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  return (
    <section className="relative min-h-screen flex flex-col justify-center overflow-hidden">
      {/* Animated sphere background */}
      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-[600px] h-[600px] lg:w-[800px] lg:h-[800px] opacity-40 pointer-events-none">
        <AnimatedSphere />
      </div>

      {/* Subtle grid lines */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-30">
        {[...Array(8)].map((_, i) => (
          <div
            key={`h-${i}`}
            className="absolute h-px bg-foreground/10"
            style={{
              top: `${12.5 * (i + 1)}%`,
              left: 0,
              right: 0,
            }}
          />
        ))}
        {[...Array(12)].map((_, i) => (
          <div
            key={`v-${i}`}
            className="absolute w-px bg-foreground/10"
            style={{
              left: `${8.33 * (i + 1)}%`,
              top: 0,
              bottom: 0,
            }}
          />
        ))}
      </div>

      <div className="relative z-10 px-6 lg:px-12 py-32 lg:py-40 max-w-[1400px]">
        {/* Main headline */}
        <div className="mb-6">
          <h1
            className={`text-[clamp(2rem,7vw,5rem)] font-display leading-[1.15] tracking-tight transition-all duration-1000 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
            }`}
          >
            <span className="block">Model every</span>
            <span className="block">
              <span style={{ color: 'rgb(115, 220, 140)' }}>Onchain </span>
              <span className="relative inline-block">
                action
                <span className="absolute -bottom-3 left-0 right-0 h-4" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 16'%3E%3Cpath d='M0,8 Q12.5,1 25,8 T50,8 T75,8 T100,8' fill='none' stroke='%2373DC8C' stroke-width='3' stroke-linecap='round'/%3E%3C/svg%3E")`, backgroundRepeat: 'repeat-x', backgroundSize: '100px 16px', opacity: 0.6 }} />
              </span>
            </span>
            <span className="block">
              <span>on </span>
              <span style={{ color: 'rgb(115, 220, 140)' }}>Stellar</span>
            </span>
          </h1>
        </div>

        {/* Description + CTAs */}
        <div className="max-w-xl space-y-8">
          <p
            className={`text-lg lg:text-xl text-muted-foreground leading-relaxed transition-all duration-700 delay-200 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
          >
            Simulate every onchain activity before they go live, inspect every contract execution, monitor live systems, and deploy with confidence — all on stellar
          </p>

          <div
            className={`flex flex-col sm:flex-row items-start gap-4 transition-all duration-700 delay-300 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
          >
            <Button
              size="lg"
              className="bg-foreground hover:bg-foreground/90 text-background px-8 h-14 text-base rounded-full group"
            >
              Get Started
              <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-14 px-8 text-base rounded-full border-foreground/20 hover:bg-foreground/5"
            >
              Explore
            </Button>
          </div>
        </div>
      </div>

      {/* Stats marquee - full width outside container */}
      <div
        className={`absolute bottom-4 left-0 right-0 overflow-hidden transition-all duration-700 delay-500 ${
          isVisible ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="flex gap-16 marquee whitespace-nowrap" style={{ willChange: 'transform' }}>
          {[...Array(2)].map((_, i) => (
            <div key={i} className="flex gap-16">
              {[
                { value: "50+", label: "Active projects", company: "STELLAR" },
                { value: "$2.5M", label: "Bounties awarded", company: "ECOSYSTEM" },
                { value: "1000+", label: "Contributors", company: "COMMUNITY" },
                { value: "10x", label: "Faster development", company: "TEAMS" },
              ].map((stat) => (
                <div key={`${stat.company}-${i}`} className="flex items-baseline gap-4">
                  <span className="text-4xl lg:text-5xl font-display">{stat.value}</span>
                  <span className="text-sm text-muted-foreground">
                    {stat.label}
                    <span className="block font-mono text-xs mt-1">{stat.company}</span>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

    </section>
  );
}