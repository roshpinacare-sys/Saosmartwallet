/**
 * Per-IP in-memory rate limiter (token bucket per key, fixed window refill).
 * =============================================================
 * Zero-dependency, per-process (single Next.js server) — the honest scope:
 * it protects the upstream RPC + the build/sign CPU from a bursty client,
 * NOT a distributed quota (that would need shared state; the metered
 * /api/v1 identity API already has DB-backed per-key quotas).
 *
 * Semantics: `limit` events per `windowMs` sliding window via timestamp
 * queue. Expired entries are pruned lazily; the map is swept on a soft
 * interval to keep memory bounded under churn.
 */

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

function sweep(now: number, windowMs: number): void {
  // At most one sweep per window — O(n) over distinct keys is fine at this scale.
  if (now - lastSweep < windowMs) return;
  lastSweep = now;
  for (const [k, b] of buckets) {
    if (b.hits.length === 0 || now - b.hits[b.hits.length - 1] > windowMs * 2) {
      buckets.delete(k);
    }
  }
}

export interface RateLimitResult {
  ok: boolean;
  /** Calls remaining in the current window (0 when denied). */
  remaining: number;
  /** Seconds until the oldest in-window hit expires (0 when allowed). */
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now, windowMs);
  const bucket = buckets.get(key) ?? { hits: [] };
  // Drop hits older than the window.
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
  if (bucket.hits.length >= limit) {
    buckets.set(key, bucket);
    const oldest = bucket.hits[0];
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
    };
  }
  bucket.hits.push(now);
  buckets.set(key, bucket);
  return { ok: true, remaining: limit - bucket.hits.length, retryAfterSeconds: 0 };
}

/**
 * Best-effort client IP for per-IP limiting behind the local gateway.
 * The gateway forwards x-forwarded-for; fall back to "local" when absent
 * (single-user sandbox) so limits still apply per-process.
 */
export function clientIpOf(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "local";
}
