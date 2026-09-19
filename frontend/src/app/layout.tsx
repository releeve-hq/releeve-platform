import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./marketing.css";
import "./cookie-consent.css";
import { AuthProvider } from "@/lib/auth-context";
import ConditionalShell from "@/components/layout/conditional-shell";
import CookieConsent from "@/components/layout/cookie-consent";

const alliance = localFont({ src: "./fonts/alliance.otf", variable: "--font-alliance", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  title: {
    default: "Releeve | Stellar Operations Platform",
    template: "%s",
  },
  description: "Model and observe onchain activity against real Stellar network conditions before real money is on the line.",
  applicationName: "Releeve",
  openGraph: {
    type: "website",
    siteName: "Releeve",
    title: "Releeve | Stellar Operations Platform",
    description: "Virtual networks, observability, and operational investigation for Stellar and Soroban teams.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Releeve Stellar Operations Platform" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Releeve | Stellar Operations Platform",
    description: "Virtual networks, observability, and operational investigation for Stellar and Soroban teams.",
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
    <html lang="en" suppressHydrationWarning className={alliance.variable}>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body className="antialiased">
        <AuthProvider>
          <ConditionalShell>{children}</ConditionalShell>
          <CookieConsent />
        </AuthProvider>
      </body>
    </html>
  );
}
