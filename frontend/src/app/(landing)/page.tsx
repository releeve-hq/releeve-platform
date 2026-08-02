import { Navigation } from "@/components/landing/navigation";
import { HeroSection } from "@/components/landing/hero-section";
import { OverviewSection } from "@/components/landing/overview-section";
import { FeaturesSection } from "@/components/landing/features-section";
import { HowItWorksSection } from "@/components/landing/how-it-works-section";
import { TestimonialsSection } from "@/components/landing/testimonials-section";
import { CtaSection } from "@/components/landing/cta-section";
import { FooterSection } from "@/components/landing/footer-section";

export default function Home() {
  return (
    <>
      <Navigation />
      <main className="relative min-h-screen noise-overlay">
        {/* Dotted grid overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.55) 0.5px, transparent 0.5px)',
            backgroundSize: '3px 3px',
            opacity: 0.06,
            zIndex: 1,
          }}
        />
        <HeroSection />
        <OverviewSection />
        <FeaturesSection />
        <HowItWorksSection />
        <TestimonialsSection />
        <CtaSection />
        <FooterSection />
      </main>
    </>
  );
}
