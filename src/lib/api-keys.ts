/**
 * api-keys.ts — Model 1 metered Identity Verification API (Week 1)
 * ================================================================================
 * The product of docs/what-we-can-do-now.md's "easiest start" plan:
 * a metered, key-authenticated endpoint that runs the real identity-anchor
 * verification (anchor-verify.ts) and meters every executed call.
 *
 * Key discipline (same philosophy as the vault):
 *   · raw key = "saos_live_" + 32 random bytes base64url — shown ONCE
 *   · only SHA-256(key) is stored; lookup is by hash (no plaintext anywhere)
 *   · quota is enforced per UTC day; every EXECUTED call consumes quota,
 *     including FAILED — the service does real chain work in every execution
 *   · fail-closed: missing/unknown/inactive key ⇒ 401, quota exhausted ⇒ 429
 */

import { createHash, randomBytes } from "node:crypto";

import { db } from "@/lib/db";

/** Free tier — documented in docs/what-we-can-do-now.md (Week 1: metered API). */
export const FREE_DAILY_QUOTA = 1_000;

export const PRODUCT_ENDPOINT = "/api/v1/identity/verify";

export interface GeneratedKey {
  /** Full plaintext key — returned once by POST /api/developer/keys, never stored. */
  key: string;
  /** First 16 chars, safe to display. */
  prefix: string;
  keyHash: string;
}

export function generateApiKey(): GeneratedKey {
  const secret = randomBytes(32).toString("base64url"); // 43 chars, URL-safe
  const key = `saos_live_${secret}`;
  return { key, prefix: key.slice(0, 16), keyHash: hashApiKey(key) };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** Extract the Bearer token from an Authorization header (or null). */
export function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

export type KeyResolution =
  | { ok: true; keyId: string; prefix: string; name: string }
  | { ok: false; reason: "missing" | "invalid" | "revoked" };

/** Fail-closed key resolution: hash-lookup, must exist and be active. */
export async function resolveApiKey(req: Request): Promise<KeyResolution> {
  const token = bearerToken(req);
  if (!token) return { ok: false, reason: "missing" };
  const rec = await db.apiKey.findUnique({ where: { keyHash: hashApiKey(token) } });
  if (!rec) return { ok: false, reason: "invalid" };
  if (!rec.active) return { ok: false, reason: "revoked" };
  return { ok: true, keyId: rec.id, prefix: rec.prefix, name: rec.name };
}

export interface QuotaState {
  used: number;
  limit: number;
  remaining: number;
  /** Epoch seconds of the next UTC midnight (quota window reset). */
  resetAt: number;
}

function startOfUtcDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function nextUtcMidnight(d = new Date()): Date {
  const start = startOfUtcDay(d);
  return new Date(start.getTime() + 24 * 3600 * 1000);
}

export async function quotaFor(keyId: string): Promise<QuotaState> {
  const used = await db.usageRecord.count({
    where: { keyId, createdAt: { gte: startOfUtcDay() } },
  });
  return {
    used,
    limit: FREE_DAILY_QUOTA,
    remaining: Math.max(0, FREE_DAILY_QUOTA - used),
    resetAt: Math.floor(nextUtcMidnight().getTime() / 1000),
  };
}

export type VerifyOutcome = "PROVEN" | "FAILED" | "ERROR";

export interface MeteredCallResult {
  quota: QuotaState;
  latencyMs: number;
}

/**
 * Record one executed product call in the usage ledger and refresh lastUsedAt.
 * Called AFTER the real verification ran — metering follows work, not promises.
 */
export async function meterCall(
  keyId: string,
  outcome: VerifyOutcome,
  username: string | null,
  latencyMs: number,
): Promise<QuotaState> {
  await Promise.all([
    db.usageRecord.create({
      data: { keyId, endpoint: PRODUCT_ENDPOINT, outcome, username, latencyMs },
    }),
    db.apiKey.update({ where: { id: keyId }, data: { lastUsedAt: new Date() } }),
  ]);
  return quotaFor(keyId);
}

export const QUOTA_HEADERS = (q: QuotaState): Record<string, string> => ({
  "X-RateLimit-Limit": String(q.limit),
  "X-RateLimit-Remaining": String(q.remaining),
  "X-RateLimit-Reset": String(q.resetAt),
});
