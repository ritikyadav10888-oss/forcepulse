import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Manrope } from "next/font/google";
import { Header } from "@/components/header";
import { AuthProvider } from "@/lib/auth";
import "./globals.css";

// Self-hosted at build time: no font request from the ground on match day.
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });
const barlow = Barlow_Condensed({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-barlow", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Force Pulse", template: "%s · Force Pulse" },
  description: "Tournaments, live scores and player auctions across 16 sports.",
};

export const viewport: Viewport = { themeColor: "#0b1f3a", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${manrope.variable} ${barlow.variable}`}>
      <body className="antialiased">
        <AuthProvider>
          <Header />
          <main className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6">{children}</main>
          <footer className="border-t border-line">
            <nav aria-label="Site" className="mx-auto flex max-w-5xl flex-wrap gap-x-5 gap-y-2 px-4 py-6 text-sm text-muted sm:px-6">
              {[
                ["about", "About"],
                ["sports", "Sports and services"],
                ["partners", "Partners"],
                ["faq", "FAQs"],
                ["terms", "Terms"],
                ["privacy", "Privacy"],
                ["refunds", "Payments and refunds"],
              ].map(([slug, label]) => (
                <a key={slug} href={`/pages/${slug}`} className="hover:text-ink">
                  {label}
                </a>
              ))}
              <a href="/contact" className="hover:text-ink">
                Contact
              </a>
            </nav>
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
