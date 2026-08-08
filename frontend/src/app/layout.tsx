import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from 'next/font/google';
import "./globals.css";
import "./landing-theme.css";
import { AppProvider } from "@/lib/app-context";
import { AuthProvider } from "@/lib/auth-context";
import ConditionalShell from "@/components/layout/conditional-shell";
import CookieConsent from "@/components/layout/cookie-consent";

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: "Releeve — Developer Bounties & Hiring on Stellar",
  description: "Releeve connects Stellar projects with developers two ways: funded bounties to get work done, and direct hiring based on real GitHub activity.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="antialiased">
        <AppProvider>
          <AuthProvider>
            <ConditionalShell>
              {children}
            </ConditionalShell>
            <CookieConsent />
          </AuthProvider>
        </AppProvider>
      </body>
    </html>
  );
}
