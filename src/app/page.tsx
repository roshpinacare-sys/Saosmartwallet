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
import ConsoleGate from "@/components/console/console-gate";

const ConsoleShell = dynamic(() => import("@/components/console/console-shell"), {
  ssr: false,
  // r48: an honest loading machine (hint at 8s, refresh escape at 40s)
  // instead of a dead-end spinner — see console-gate.tsx for the live proof.
  loading: () => <ConsoleGate />,
});

export default function Page() {
  return <ConsoleShell />;
}
