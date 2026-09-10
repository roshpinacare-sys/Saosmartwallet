import type { Metadata, Viewport } from "next";
import { Heebo, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// FIX(Roast-63 · M10): היה-<link>-גוגל-פונטס-בתוך-<body> (אזהרת-no-page-custom-font,
// טעינה-לא-אידיאלית). next/font = אותם-פונטים, self-hosted-בזמן-בנייה, אפס-בקשות-חוץ.
const heebo = Heebo({
  subsets: ["hebrew", "latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-heebo",
  display: "swap",
});
const jbMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jbmono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SAOS DEX — הבורסה הריבונית",
  description:
    "בורסה ריבונית: מסחר ספר-עומק ובריכות AMM עם קונצנזוס חתום-מרקל, עיגון-חי על Steem/Hive/TRON וכספת מפתחות מוצפנת. Steem · Hive · Blurt.",
};

export const viewport: Viewport = {
  themeColor: "#131313",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={`${heebo.variable} ${jbMono.variable}`}>
      <body className="min-h-screen flex flex-col antialiased">
        {children}
      </body>
    </html>
  );
}
