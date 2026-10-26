/**
 * Saosmartwallet packages/fixedfloat — request signing (pure)
 * ===========================================================
 * MEASURED wire law (FixedFloat API v2, ff.io/api/v2/ — measured live
 * 2026-10-26 by the fx-fixedfloat lane, giant :3055, trace
 * 1a178850450f2e55; reconciled here so the wallet package and the bridge
 * head share ONE contract):
 *
 *   signature = HMAC_SHA1(apiSecret, canonical(body))
 *   canonical(body) = CONCAT over keys sorted alphabetically of
 *                     key + (object ? JSON.stringify(deepSort(v)) : String(v))
 *   headers: X-Api-Key + X-Signature (hex) — JSON body, no nonce header.
 *
 * The HMAC primitive is pinned to RFC 2202 Test Case 3 (an external
 * standard); the canonical law is pinned by explicit fixtures. Everything
 * here is pure and offline: no fetch, no wall-clock, no I/O.
 */

import { createHmac } from "node:crypto";

/** Measured v2 endpoint (trailing slash included — URL is base + method). */
export const FF_API_BASE = "https://ff.io/api/v2/";

/** Measured v2 auth headers. */
export const FF_HEADER_KEY = "X-Api-Key";
export const FF_HEADER_SIGN = "X-Signature";

/** The measured v2 method set — anything else refuses locally. */
export const FF_METHODS = ["price", "ccies", "create", "order", "emergency", "qr"] as const;
export type FfMethod = (typeof FF_METHODS)[number];

/** Deep-sort an object's keys alphabetically (recursively, arrays included). */
export function deepSort(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(deepSort);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = deepSort((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

/**
 * Canonical signing form (measured law): keys sorted alphabetically at the
 * top level, each rendered as key + (nested objects → deep-sorted compact
 * JSON, primitives → String(v)), concatenated with no separator.
 */
export function canonical(body: Record<string, unknown>): string {
  const keys = Object.keys(body).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = body[k];
    parts.push(k + (typeof v === "object" && v !== null ? JSON.stringify(deepSort(v)) : String(v)));
  }
  return parts.join("");
}

/** The HMAC-SHA1 primitive (RFC 2104) — pinned to RFC 2202 TC3 in tests. */
export function hmacSha1Hex(key: string, data: string): string {
  return createHmac("sha1", key).update(data, "utf8").digest("hex");
}

/**
 * The wire signature: HMAC-SHA1(apiSecret, canonical(body)) — 40 lowercase
 * hex chars. Deterministic: same body ⇒ same signature.
 */
export function ffSign(body: Record<string, unknown>, apiSecret: string): string {
  return hmacSha1Hex(apiSecret, canonical(body));
}
