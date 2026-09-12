/**
 * Next.js instrumentation — r29: the Gate Heart MOVED OUT.
 *
 * The heart used to boot here (inside the Next node process). Its module
 * graph (loop/brain/orders/steem/z-ai-sdk) made every dev-server boot a
 * ~1.7GB compile — the OOM-killer's favourite target (proven in dmesg,
 * kills at 13:xx cycle). It now lives as an independent process:
 *
 *     mini-services/heart-service  (bun run dev, health on :3004)
 *
 * Same beat loop, same SQLite, same fail-closed discipline — but it now
 * survives portal restarts, OOM cycles and dev-server revives. The portal
 * talks to the heart only through the DB (pulses/leases/orders rows), so
 * nothing else changes.
 */
export async function register(): Promise<void> {
  // intentional no-op since r29 — see mini-services/heart-service/index.ts
}
