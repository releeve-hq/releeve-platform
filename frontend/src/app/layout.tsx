import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import "./marketing.css";
import "./cookie-consent.css";
import { AppProvider } from "@/lib/app-context";
import { AuthProvider } from "@/lib/auth-context";
import ConditionalShell from "@/components/layout/conditional-shell";
import CookieConsent from "@/components/layout/cookie-consent";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });
const alliance = localFont({ src: "./fonts/alliance.otf", variable: "--font-alliance", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  title: {
    default: "Releeve | Simulation infrastructure for Stellar",
    template: "%s",
  },
  description: "Fork real Stellar ledger state, simulate Soroban transactions, inspect execution evidence, and monitor what ships.",
  applicationName: "Releeve",
  openGraph: {
    type: "website",
    siteName: "Releeve",
    title: "Releeve | Simulation infrastructure for Stellar",
    description: "State-fork simulation, monitoring, and investigation infrastructure for Stellar and Soroban teams.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Releeve simulation infrastructure for Stellar" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Releeve | Simulation infrastructure for Stellar",
    description: "State-fork simulation, monitoring, and investigation infrastructure for Stellar and Soroban teams.",
    images: ["/opengraph-image"],
  },
};

const themeScript = `
  try {
    var stored = localStorage.getItem('releeve-marketing-theme');
    var theme = stored === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.marketingTheme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch (_) {
    document.documentElement.dataset.marketingTheme = 'dark';
  }
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${jetbrainsMono.variable} ${alliance.variable}`}>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body className="antialiased">
        <AppProvider>
          <AuthProvider>
            <ConditionalShell>{children}</ConditionalShell>
            <CookieConsent />
          </AuthProvider>
        </AppProvider>
      </body>
    </html>
  );
}
