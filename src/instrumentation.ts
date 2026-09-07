/**
 * instrumentation.ts — הדמונים הנלווים:
 *  · גשר saos-dex: משגר את דמון הבורסה הריבונית (saos-dex, פורט 3010) כילד-תהליך
 *    של שרת האם — כך הוא שורד את מחזור-החיים של קריאות-המעטפת (מורשת guardian_boot).
 *  · הפעלה חד-פעמית לכל תהליך-שרת; בדיקת-תפוסה לפני שיגור (אפס כפילויות).
 *  · יבוא-דינמי בלבד (edge-safe) — net/child_process בענף-nodejs בלבד.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const [{ spawn }, net] = await Promise.all([import("child_process"), import("net")]);
    const portBusy = (port: number): Promise<boolean> =>
      new Promise((resolve) => {
        const s = net.createConnection({ port });
        const done = (v: boolean) => { s.destroy(); resolve(v); };
        s.once("connect", () => done(true));
        s.once("error", () => done(false));
        setTimeout(() => done(false), 900).unref?.();
      });
    try {
      if (!(await portBusy(3010))) {
        // סודות-הדמון: ה-.env של saos-dex (gitignored) נקרא בזמן-ריצה ומוזרק
        // ישירות לסביבת-הילד — next/bun לא תמיד טוענים .env לתהליך-ילד
        // שנוצר עם אובייקט-env מפורש (באג תשתיתי שחשף שחזור-המפתחות).
        // אפס סודות בקוד/בגיט: הקריאה היא מקובץ-ריצה בלבד.
        const childEnv: NodeJS.ProcessEnv = { ...process.env };
        try {
          const [{ readFileSync }] = await Promise.all([import("fs")]);
          const envPath = "/home/z/my-project/saos-dex/.env";
          const raw = readFileSync(envPath, "utf8");
          for (const line of raw.split("\n")) {
            const t = line.trim();
            if (!t || t.startsWith("#")) continue;
            const eq = t.indexOf("=");
            if (eq <= 0) continue;
            const k = t.slice(0, eq).trim();
            const v = t.slice(eq + 1).trim();
            if (k) childEnv[k] = v;
          }
        } catch {
          console.log("[saos-bridge] no saos-dex/.env found — relay will wait (honest pending)");
        }
        const child = spawn("bun", ["run", "dev"], {
          cwd: "/home/z/my-project/saos-dex",
          stdio: "ignore",
          // הפרדת-מסדי-נתונים מחייבת: הדמון מקבל את ה-DB שלו-עצמו (saos-dex/db/dex.db) —
          // לעולם לא את ה-DATABASE_URL של הפלטפורמה-האם (custom.db), שמתנגש איתה.
          env: { ...childEnv, DATABASE_URL: "file:/home/z/my-project/saos-dex/db/dex.db" },
        });
        child.unref();
        child.on("error", (e: Error) => console.log("[saos-bridge] dex spawn error:", e.message));
        console.log("[saos-bridge] saos-dex daemon spawning on :3010 (pid", child.pid + ")");
      } else {
        console.log("[saos-bridge] saos-dex already listening on :3010");
      }
    } catch (e) {
      console.log("[saos-bridge] spawn skipped:", e instanceof Error ? e.message : e);
    }
  }
}
