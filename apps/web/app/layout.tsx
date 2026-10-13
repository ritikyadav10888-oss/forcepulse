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
        </AuthProvider>
      </body>
    </html>
  );
}
