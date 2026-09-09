/**
 * Next.js instrumentation — boots the Gate Heart exactly once per server
 * process (no extra port, no separate daemon). The heart is fail-closed:
 * every beat catches its own errors and writes them into its pulse record.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { startHeart } = await import("@/lib/gate/harness/heart");
    startHeart();
  } catch (e) {
    console.error("[gate-heart] boot failed:", e instanceof Error ? e.message : e);
  }
}
