/**
 * SOVEREIGN GATE — run leases (חוזי-חכירה).
 *
 * Crash-safety for the goal loop, distilled from the studied sources:
 *  · TITAI durable engine — lease claim (worker + expiry) with heartbeat
 *    renewal between steps; the persisted trace IS the checkpoint.
 *  · workspace Trust-Control-Plane — reapExpiredClaims returns crashed
 *    work to the queue.
 *
 * A claim is an atomic compare-and-set on status="queued" (SQLite-safe:
 * updateMany count > 0 ⇒ won). A live run renews its lease after EVERY
 * persisted step; a dead one stops renewing and the heart's reaper takes
 * it back — attempt++ and the maker resumes from the evidence trace.
 */
import { db } from "@/lib/db";

export const LEASE_MS = 180_000; // > brain(90s timeout) + tool time; renewed after every persisted step

/** Stable worker identity for this node process (survives HMR via globalThis). */
export function workerId(): string {
  const g = globalThis as typeof globalThis & { __gateWorkerId?: string };
  if (!g.__gateWorkerId) g.__gateWorkerId = "w-" + Math.random().toString(36).slice(2, 10);
  return g.__gateWorkerId;
}

/** Atomic compare-and-set claim. Won ⇒ we own the run (attempt incremented). */
export async function claimRun(runId: string): Promise<boolean> {
  const now = new Date();
  const won = await db.gateRun.updateMany({
    where: { id: runId, status: "queued" },
    data: {
      status: "running",
      leaseOwner: workerId(),
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      heartbeatAt: now,
      attempt: { increment: 1 },
    },
  });
  return won.count > 0;
}

/** Do I still own this run? (A reaper or another worker may have taken it.) */
export async function stillMine(runId: string): Promise<boolean> {
  const r = await db.gateRun.findUnique({ where: { id: runId }, select: { leaseOwner: true, status: true } });
  return r?.leaseOwner === workerId() && r?.status === "running";
}

/** Heartbeat — renew the lease (called after every persisted step). */
export async function renewLease(runId: string): Promise<void> {
  const now = new Date();
  await db.gateRun.update({
    where: { id: runId },
    data: { heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) },
  }).catch(() => { /* renewal must never break the loop; the reaper is the safety net */ });
}

/** Clear the lease on a terminal write. */
export const LEASE_CLEAR = { leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null } as const;
