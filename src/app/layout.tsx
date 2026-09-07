import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SAOSMART TERMINAL — STEEM/SBD Internal DEX",
  description:
    "Live trading terminal for the Steem internal market (STEEM/SBD): order book, recent fills, limit-order builder and wallet dashboard. Built on the M0 chain adapter and oracle-verified binary serializer.",
  keywords: ["Steem", "SBD", "DEX", "order book", "trading terminal", "blockchain wallet"],
  authors: [{ name: "Saosmartwallet" }],
};

export const viewport: Viewport = {
  themeColor: "#0b100e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground min-h-screen flex flex-col`}
      >
        {children}
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: "oklch(0.17 0.014 175)",
              border: "1px solid oklch(0.85 0.02 165 / 12%)",
              color: "oklch(0.94 0.008 165)",
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: "12px",
            },
          }}
        />
      </body>
    </html>
  );
}
