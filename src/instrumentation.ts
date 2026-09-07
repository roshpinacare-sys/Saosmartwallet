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
        const child = spawn("bun", ["run", "dev"], {
          cwd: "/home/z/my-project/saos-dex",
          stdio: "ignore",
          // הפרדת-מסדי-נתונים מחייבת: הדמון מקבל את ה-DB שלו-עצמו (saos-dex/db/dex.db) —
          // לעולם לא את ה-DATABASE_URL של הפלטפורמה-האם (custom.db), שמתנגש איתה.
          env: { ...process.env, DATABASE_URL: "file:/home/z/my-project/saos-dex/db/dex.db" },
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
