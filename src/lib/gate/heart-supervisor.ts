/**
 * heart-supervisor — r31 (truth-audit outcome).
 *
 * The r31 audit caught the hard truth: the heart-service kept dying and
 * NOTHING brought it back — container reboots left it dead (no boot hook),
 * and ad-hoc background starts from tool shells were reaped when the shell's
 * process group got cleaned up (nohup/setsid notwithstanding — measured live,
 * twice). Meanwhile the ONLY process family proven to survive everything in
 * this sandbox is the Next dev server itself (PID from the container's boot
 * script) and anything it detaches.
 *
 * The fix is supervision from the survivor:
 *   · instrumentation.ts calls ensureHeartAlive() on boot → the heart is a
 *     detached child of the long-lived Next process (survives tool shells).
 *   · the heart route calls it on every poll → a mid-life crash is healed by
 *     the very next console poll (≤60s downtime, self-healing, no cron).
 *
 * Deliberately TINY: no harness/brain/z-ai imports may ever reach this module —
 * its whole point is a negligible module graph (child_process + fetch).
 */
import { spawn } from "child_process";
import * as path from "path";

const HEART_HEALTH = "http://127.0.0.1:3004/";
const HEART_DIR = path.resolve(process.cwd(), "mini-services", "heart-service");

let lastEnsure = 0;

async function healthOk(timeoutMs = 400): Promise<boolean> {
  try {
    const res = await fetch(HEART_HEALTH, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Returns "alive" | "spawned" | "spawn-failed". Cheap when healthy (one
 * 400ms-capped local fetch, debounced to once per 10s across callers).
 */
export async function ensureHeartAlive(): Promise<"alive" | "spawned" | "spawn-failed"> {
  if (await healthOk()) return "alive";
  const now = Date.now();
  if (now - lastEnsure < 10_000) return "spawn-failed"; // a spawn is already in flight
  lastEnsure = now;
  try {
    const child = spawn("bun", ["run", "dev"], {
      cwd: HEART_DIR,
      detached: true, // own process group — survives this request, this shell, and portal restarts
      stdio: "ignore",
      env: process.env,
    });
    child.unref();
    // give the boot a beat, then confirm — the singleton lock makes double-spawn harmless
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await healthOk()) return "spawned";
    }
    return "spawn-failed";
  } catch {
    return "spawn-failed";
  }
}
