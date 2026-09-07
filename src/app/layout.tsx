import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";

import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "SAOS GRID — Ecosystem Command Center",
  description:
    "Professional grid dashboard for the SAOS ecosystem: five live-probed chains (STEEM, HIVE, BLURT, TRON, SAOS-NET), trading pairs matrix, cross-chain bridge monitor, sovereign chain explorer, and the STEEM/SBD internal-market DEX. Zero mock data.",
  keywords: [
    "SAOS",
    "Steem",
    "Hive",
    "TRON",
    "SAOS-NET",
    "DEX",
    "grid dashboard",
    "trading terminal",
    "blockchain wallet",
  ],
  authors: [{ name: "Saosmartwallet" }],
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${jetbrains.variable} min-h-screen flex flex-col bg-background font-sans text-foreground antialiased`}
      >
        {children}
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: "rgba(23, 23, 23, 0.92)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              color: "#fafafa",
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "12px",
              backdropFilter: "blur(12px)",
            },
          }}
        />
      </body>
    </html>
  );
}
