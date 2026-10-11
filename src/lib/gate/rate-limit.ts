// חוק-ארנק: ניחוש מקוון של סיסמת-המפעיל חייב להיות מסויג.
// חלון-הזזה בזיכרון (פר-אינסטנס), deterministic, ללא-תלויות.
// פריסה מרובת-אינסטנסים תדרוש מונה-משותף — זהו שכבת-בסיס, לא תחליף-הגנה.
import { GateError } from "./crypto";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const MAX_TRACKED = 10000;

type Bucket = { hits: number[] };
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string): { ok: boolean; retryAfterS: number; remaining: number } {
  const now = Date.now();
  const b = buckets.get(key) ?? { hits: [] };
  b.hits = b.hits.filter((t) => now - t < WINDOW_MS);
  if (b.hits.length >= MAX_ATTEMPTS) {
    buckets.set(key, b);
    const oldest = b.hits[0] ?? now;
    return {
      ok: false,
      retryAfterS: Math.max(1, Math.ceil((WINDOW_MS - (now - oldest)) / 1000)),
      remaining: 0,
    };
  }
  b.hits.push(now);
  buckets.set(key, b);
  if (buckets.size > MAX_TRACKED) {
    for (const [k, v] of buckets) {
      if (v.hits.length === 0) buckets.delete(k);
      if (buckets.size <= MAX_TRACKED) break;
    }
  }
  return { ok: true, retryAfterS: 0, remaining: MAX_ATTEMPTS - b.hits.length };
}

export function assertRateLimit(key: string): void {
  const rl = rateLimit(key);
  if (!rl.ok) {
    throw new GateError("rate-limited", `יותר מדי ניסיונות — נסה שוב בעוד ${rl.retryAfterS} שניות`);
  }
}
