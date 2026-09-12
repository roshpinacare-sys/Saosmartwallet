"use client";

/**
 * SAOS SOVEREIGN VAULT — דף-הכניסה (r29 · פיצול-עומס).
 *
 * היסטוריית-עומק (מוכח-חי): דף-הקונסולה בן-2600+ השורות מתקמפל כמודול-אחד
 * ומפעיל את מהדר-ה-dev עד 2.2GB+ — ה-OOM-killer של הקרנל הורג את
 * next-server שוב ושוב (dmesg: "Out of memory: Killed process next-server").
 *
 * הפתרון: הדף-הראשי קליל (הקובץ הזה), והקונסולה כולה עברה ל-
 * src/components/console/console-shell.tsx שנטען בעצלה (dynamic import,
 * בלי-SSR — הקונסולה קליינטית-טהורה בכל-מקרה). התוצאה:
 *   · קומפילציית-הבכורה של `/` קטנה ומהירה.
 *   · צ'אנק-הקונסולה מתקמפל פעם-אחת, על-פי-דרישה, בנפרד.
 *   · עריכת-סעיף אחד לא מפילה את כל-העמוד ב-HMR.
 */

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

const ConsoleShell = dynamic(() => import("@/components/console/console-shell"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-black flex items-center justify-center gap-3">
      <Loader2 className="h-5 w-5 animate-spin text-emerald-500" aria-hidden />
      <span className="font-mono text-xs text-zinc-500" dir="rtl">טוען קונסולה…</span>
    </div>
  ),
});

export default function Page() {
  return <ConsoleShell />;
}
