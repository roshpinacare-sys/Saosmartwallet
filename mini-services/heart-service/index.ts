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
// r31 fix: fs.flockSync does not exist in this Bun version (live-audit catch —
// the guard silently never guarded). Portable PID-lockfile instead: O_EXCL
// create + PID liveness; a stale lock (dead PID) is taken over honestly.
const LOCK = path.join(ROOT, "db", "heart-service.lock");
(function acquireSingletonLock(): void {
  const alive = (pid: number): boolean => {
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
    try { process.kill(pid, 0); return true; } catch (e) {
      const c = e as NodeJS.ErrnoException;
      if (c?.code === "EPERM") return true; // exists, not ours
      return false; // ESRCH — dead
    }
  };
  // r31: bun's writeFileSync(fd, …) silently wrote NOTHING (live-proven — the
  // lock stayed 0 bytes) — write by PATH with the atomic "wx" flag instead.
  const take = (): boolean => {
    try {
      fs.writeFileSync(LOCK, String(process.pid), { flag: "wx" });
      return true;
    } catch (e) {
      const c = e as NodeJS.ErrnoException;
      if (c?.code !== "EEXIST") {
        console.log("[heart-service] lock error:", e instanceof Error ? e.message : e);
        return true; // can't even check — better to run than to silently die
      }
      return false; // lock exists — liveness checked by caller
    }
  };
  try {
    if (take()) return; // fresh lock acquired
    const raw = fs.readFileSync(LOCK, "utf8").trim();
    const pid = Number(raw);
    if (pid === process.pid) return; // hot-reload re-entry — the lock is already ours
    if (alive(pid)) {
      console.log(`[heart-service] another heart holds the lock (pid ${pid}) — exiting`);
      process.exit(0);
    }
    // stale lock from a dead process — take over
    console.log(`[heart-service] stale lock (pid ${raw || "?"} dead) — taking over`);
    fs.rmSync(LOCK);
    if (!take()) {
      console.log("[heart-service] lost the takeover race — exiting");
      process.exit(0);
    }
  } catch (e) {
    console.log("[heart-service] lock error:", e instanceof Error ? e.message : e);
  }
})();

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

  // ── r32: inverted supervision — the heart now guards the PORTAL ────────────
  // The truth-audit proved the ONLY process family that survives reboots AND
  // tool-shell reaping in this sandbox is the heart (detached child of boot).
  // The portal died once more in practice (dev wrapper reaped mid-life) and
  // nothing brought it back. Fix: the heart health-pings :3000 every 15s and,
  // when the portal is truly down (connection-refused/timeout — any HTTP
  // response counts as alive), respawns `next dev` as ITS OWN detached child,
  // with honest backoff so a crash-loop can never storm the machine.
  const PORTAL = "http://127.0.0.1:3000/";
  // r34 bug-hunt: the flat 45s backoff turned every memory-threshold restart
  // (next dev self-exits with code 77) into 45-90s of dead portal, and the
  // first spawn after a crash always lost to EADDRINUSE because the old socket
  // lingers. Now: wait for the port to actually release before spawning, and
  // escalate backoff (5s → 15s → 45s) so the common case recovers in seconds.
  const RESPAWN_BACKOFF_MS = [5_000, 15_000, 45_000];
  const QUIET_AFTER_FAILED = 6; // 6 failed spawns → rest 10 min before retry
  const PORT_RELEASE_TIMEOUT_MS = 20_000;
  let lastSpawn = 0;
  let failedSpawns = 0;
  let spawnCycle = false; // r34: one recovery cycle at a time — ticks must not stack
  const portalAlive = async (): Promise<boolean> => {
    // r34: a busy dev server mid-compile can take >2.5s to answer — that is
    // ALIVE, not down. One slow-patience recheck (8s) before declaring death,
    // so heavy compiles never trigger a rival spawn (EADDRINUSE noise).
    try {
      await fetch(PORTAL, { signal: AbortSignal.timeout(2_500) });
      return true;
    } catch { /* fall through to the patient recheck */ }
    try {
      await fetch(PORTAL, { signal: AbortSignal.timeout(8_000) });
      return true; // any HTTP response means the server is serving
    } catch {
      return false; // refused / timeout = down
    }
  };
  const portFree = async (): Promise<boolean> => {
    try {
      await Bun.connect({ hostname: "127.0.0.1", port: 3000 });
      return false; // something still LISTENS → not free
    } catch {
      return true; // refused → free
    }
  };
  const waitPortRelease = async (): Promise<boolean> => {
    const deadline = Date.now() + PORT_RELEASE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await portFree()) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false; // try anyway — the spawn's own error surfaces honestly
  };
  setInterval(() => {
    void (async () => {
      if (spawnCycle) return;
      if (await portalAlive()) {
        failedSpawns = 0;
        return;
      }
      const now = Date.now();
      const rest = failedSpawns >= QUIET_AFTER_FAILED
        ? 10 * 60_000
        : RESPAWN_BACKOFF_MS[Math.min(failedSpawns, RESPAWN_BACKOFF_MS.length - 1)];
      if (now - lastSpawn < rest) return;
      lastSpawn = now;
      spawnCycle = true;
      try {
        if (!(await waitPortRelease())) {
          console.log("eart-service] port 3000 still busy 20s after down — spawning anyway");
        }
        const out = fs.openSync(path.join(ROOT, "dev.log"), "a");
        const proc = Bun.spawn({
          cmd: ["bun", "./node_modules/next/dist/bin/next", "dev", "-p", "3000", "--webpack"],
          cwd: ROOT,
          env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=2048" },
          stdio: ["ignore", out, out],
        });
        proc.unref();
        failedSpawns += 1;
        console.log(
          `[heart-service] portal was DOWN — respawned next dev (pid ${proc.pid}, ` +
            `attempt ${failedSpawns}, ts ${new Date().toISOString()})`,
        );
      } catch (e) {
        failedSpawns += 1;
        console.log("[heart-service] portal respawn failed:", e instanceof Error ? e.message : e);
      } finally {
        spawnCycle = false;
      }
    })();
  }, 15_000);
  console.log("[heart-service] portal supervision armed (ping 15s, backoff 5s/15s/45s, port-release aware, quiet 10min after 6 fails)");
}

main().catch((e) => {
  console.error("[heart-service] boot failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
