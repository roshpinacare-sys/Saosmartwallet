/**
 * heart-service — הלב כתהליך-עצמאי (r29)
 * ================================================================================
 * למה: instrumentation.ts העלה את גרף-הלב (loop/brain/orders/steem/z-ai-sdk)
 * בתוך תהליך-next עצמו — וקומפילציית-האתחול שלו היתה פצצת-ה-OOM שהרגה את
 * next-server שוב-ושוב (dmesg: ~1.7GB anon בכל-אתחול, cgroup=4GB).
 *
 * העברה-מלאה לתהליך-נפרד:
 *   · הלב חי עכשיו כאן, 24/7, ושורד מחזורי-OOM/החייאה של הפורטל.
 *   · "זמינות מיידית כגוף אחד" — הלב אינו תלוי-עוד בחיים של מהדר-ה-dev.
 *   · SQLite משותף עם הפורטל (db/custom.db) — כל-הכתיבות דרך Prisma,
 *     fail-closed בכל-פעימה, בדיוק כמו-קודם.
 *
 * הפעלה: bun run dev (מ-__dirname) — ברירת-מחדל: לב-יחיד, פעימה כל-20שנ'.
 * נעילה-הדדית: אם HEART_SINGLETON_LOCK נעול (תהליך-שני), יוצא בשקט.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ── .env loading (project root) — before any @/lib import ────────────────────
const ROOT = path.resolve(import.meta.dir, "..", "..");
(function loadRootEnv() {
  const envPath = path.join(ROOT, ".env");
  try {
    const raw = fs.readFileSync(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const key = m[1];
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    // no .env — DATABASE_URL must come from the environment
  }
})();

// ── singleton lock (two hearts would double-sign orders) ─────────────────────
const LOCK = path.join(ROOT, "db", "heart-service.lock");
try {
  const fd = fs.openSync(LOCK, "w");
  // Bun extends node:fs with flockSync; EXNB = exclusive, non-blocking.
  if (!fs.flockSync(fd, "EXNB")) {
    console.log("[heart-service] another heart holds the lock — exiting");
    process.exit(0);
  }
} catch (e) {
  console.log("[heart-service] lock error:", e instanceof Error ? e.message : e);
}

// ── boot the heart (same beat loop that used to live inside Next) ────────────
async function main(): Promise<void> {
  const { startHeart } = await import("../../src/lib/gate/harness/heart");
  startHeart();
  console.log("[heart-service] heart started (independent process, cwd=", process.cwd() + ")");

  // tiny health surface — not required by the portal, useful for ops checks
  const port = Number(process.env.HEART_PORT ?? 3004);
  Bun.serve({
    port,
    fetch: () =>
      new Response(
        JSON.stringify({ ok: true, service: "heart-service", ts: new Date().toISOString() }),
        { headers: { "content-type": "application/json" } },
      ),
  });
  console.log(`[heart-service] health on http://127.0.0.1:${port}/`);
}

main().catch((e) => {
  console.error("[heart-service] boot failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
