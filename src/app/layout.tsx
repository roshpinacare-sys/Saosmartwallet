import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SAOS-DEX — Sovereign Trading Terminal",
  description:
    "בורסה ריבונית אוטונומית: ספר-הזמנות דטרמיניסטי, בריכות 30bps, עיגון-חי Steem/Hive/TRON עם אימות-עצמי, fail-fast invariants. מהדורה מוסדית.",
  other: {
    // Zero-Tolerance: אפס-הסתמכות על cache ישן — הדפדפן תמיד מבקש גרסה-חיה
    "Cache-Control": "no-store, must-revalidate",
    Pragma: "no-cache",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}
