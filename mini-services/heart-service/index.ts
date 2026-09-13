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
// ── r49: hot-reload hygiene — ONE supervisor per process, forever ────────────
// bun --hot re-evaluates this entry whenever ANY file in its import graph
// changes, and the graph reaches deep into the app (heart → harness/heart →
// modules → eco-server …). Live-proven (r49): one edit to src/lib/eco-server.ts
// hot-reloaded the heart 13 times over its lifetime — every re-run of main()
// armed a FRESH supervision setInterval with fresh backoff state while the old
// interval kept firing. Several independent supervisors then spawned rival
// `next dev` servers into the same port within seconds: the EADDRINUSE farm,
// resurrected through the reload door (r48 closed the crash door only).
// Fix: globalThis survives module re-evaluation inside the same process, so a
// process-wide sentinel makes every reload a no-op. The singleton lock above
// already detects reload re-entry for the LOCK; the timers were the gap.
type HotGlobal = typeof globalThis & { __heartServiceBooted?: boolean };
const G = globalThis as HotGlobal;

async function main(): Promise<void> {
  if (G.__heartServiceBooted) {
    console.log("[heart-service] hot-reload re-entry — boot/supervision already armed in this process; skipping re-arm (r49)");
    return;
  }
  G.__heartServiceBooted = true;
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
  // r41 BUG-HUNT (user: "קפיצות כל שנייה"): the ping used to hit `/` — the
  // HEAVY console page. Mid-compile it answered in 5-12s, the 2.5s+8s patience
  // window expired, the heart declared the portal dead and spawned FOUR rival
  // `next dev` instances (all EADDRINUSE — logged). Worse: the spawned server
  // inherited NODE_OPTIONS --max-old-space-size=2048 (the OLD, easy threshold
  // = self-restart at 1638MB heap), so compile storms kept self-killing the
  // server and the browser kept full-reloading (measured: 3x CLS=1.0 in 75s).
  // Now: ping the LIGHT health endpoint, and spawn with the same heap ceiling
  // the supervisor uses — one threshold (r48: 2048 kept after a live trial of
  // 1792; see the spawn comment below for the measured tradeoff).
  const PORTAL = "http://127.0.0.1:3000/api/system/health";
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
      // r48: cold builds answered health in >25s — the patient recheck goes to
      // 12s. With the busy-port no-spawn rule, a false death here only skips a
      // tick (harmless), but fewer false deaths = calmer logs.
      await fetch(PORTAL, { signal: AbortSignal.timeout(12_000) });
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
      // r48 bug (live-proven): during the 14:18 crash-recovery window every
      // EADDRINUSE attempt counted toward QUIET_AFTER_FAILED, so the heart
      // entered the 10-minute rest — and then IGNORED a clean crash (portal
      // dead + port free) for the whole window. Quiet exists to stop storms
      // against a BUSY port (lingering socket), not to abandon a dead one.
      // A free port is the exact crash we exist to heal: reset the ladder.
      if (await portFree()) failedSpawns = 0;
      const now = Date.now();
      const rest = failedSpawns >= QUIET_AFTER_FAILED
        ? 10 * 60_000
        : RESPAWN_BACKOFF_MS[Math.min(failedSpawns, RESPAWN_BACKOFF_MS.length - 1)];
      if (now - lastSpawn < rest) return;
      spawnCycle = true;
      try {
        // r48 (live-proven twice): a busy port with no HTTP answer is a server
        // MID-COMPILE (health answered >25s during cold builds) or truly
        // wedged — spawning into it only farms EADDRINUSE noise, burns the
        // backoff ladder, and arms the 10-minute quiet. Never spawn into a
        // busy port: re-evaluate on the next tick instead.
        if (!(await waitPortRelease())) {
          console.log("eart-service] port 3000 busy without HTTP answer — NOT spawning (mid-compile or wedged); re-evaluating next tick");
          return;
        }
        const out = fs.openSync(path.join(ROOT, "dev.log"), "a");
        lastSpawn = Date.now(); // only a REAL spawn arms the backoff clock
        const proc = Bun.spawn({
          cmd: ["bun", "./node_modules/next/dist/bin/next", "dev", "-p", "3000", "--webpack"],
          cwd: ROOT,
          env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=2048" }, // r48: kept at 2048 after live trial of 1792 — a lower ceiling risks a restart-loop that never finishes the big cold compile; a kernel kill at ~2.14GB RSS costs only the server (the heart survives and respawns), while an unfinishable compile costs everything
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
