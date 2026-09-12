/**
 * Next.js instrumentation — r29 moved the heart OUT (OOM doctrine), r31 makes
 * it SURVIVE: the truth-audit caught the heart dead after container reboots
 * (nothing re-booted it) and after ad-hoc background starts (tool-shell
 * process-group reaping — measured live twice).
 *
 * The fix: the long-lived Next process adopts the heart as a DETACHED child
 * (own process group, unref'd — zero module-graph cost, no harness imports
 * here). The heart route repeats the same ensure on every console poll, so a
 * mid-life crash is healed by the next poll (≤60s). The PID-lockfile inside
 * heart-service makes double-spawn harmless.
 */
export async function register(): Promise<void> {
  // Next compiles instrumentation for BOTH runtimes; node builtins exist only
  // in the nodejs runtime. The docs-canonical branch form (=== 'nodejs') lets
  // the bundler drop this graph from the edge bundle entirely.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { ensureHeartAlive } = await import("@/lib/gate/heart-supervisor");
      const r = await ensureHeartAlive();
      console.log(`[instrumentation] heart-supervisor: ${r}`);
    } catch (e) {
      console.log(`[instrumentation] heart-supervisor skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
