/**
 * Saosmartwallet packages/fixedfloat — request signing (pure)
 * ===========================================================
 * FixedFloat API v1 wire law (documented contract):
 *
 *   signature = HMAC_SHA256(apiSecret, CONCAT(values of every request
 *                            parameter, in the exact order they are sent))
 *   → 64 lowercase hex chars, sent as X-API-SIGN together with X-API-KEY and
 *     a strictly-increasing integer X-API-NONCE.
 *
 * Everything here is pure and offline: no fetch, no wall-clock (the nonce
 * source is the injected clock), no I/O.
 */

import { createHmac } from "node:crypto";

/** Documented v1 auth headers. */
export const FF_HEADER_KEY = "X-API-KEY";
export const FF_HEADER_SIGN = "X-API-SIGN";
export const FF_HEADER_NONCE = "X-API-NONCE";

/** Documented v1 base endpoint. */
export const FF_API_BASE = "https://ff.io/api/v1";

type Bytes = Uint8Array | number[];

function toBytes(v: string | Bytes): Uint8Array {
  if (typeof v === "string") return new TextEncoder().encode(v);
  if (typeof v === "number") {
    // A bare number is NEVER a legal value element (a string or a byte array
    // is) — failing loudly here prevents silent zero-buffer signatures.
    throw new TypeError("ffSign: bare number is not a legal value element");
  }
  return new Uint8Array(v);
}

/**
 * HMAC-SHA256 over the concatenation of `values` (each string → UTF-8 bytes),
 * keyed by `key`. Returns 64 lowercase hex chars.
 *
 * Verified against RFC 4231 Test Case 2 in test/sign.test.ts — the digest is
 * pinned to an external standard, not to the implementation.
 */
export function ffSign(key: Bytes, values: (string | Bytes)[]): string {
  const keyBytes = toBytes(key);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (const v of values) {
    const b = toBytes(v);
    chunks.push(b);
    total += b.length;
  }
  const payload = new Uint8Array(total);
  let off = 0;
  for (const b of chunks) {
    payload.set(b, off);
    off += b.length;
  }
  return createHmac("sha256", keyBytes).update(payload).digest("hex");
}

/**
 * Monotonic nonce source. base = clock_ms * 4096 + a process-local sequence
 * that advances even when the clock stands still; if the clock ever moves
 * backward the previous nonce is simply incremented (absolute monotonicity
 * per process). Decimal digits only — wire-safe as an integer header.
 */
let __lastNonce = 0n;
let __seq = 0n;

export function nextNonce(now: () => number): string {
  let candidate = BigInt(Math.floor(now())) * 4096n + (__seq++ % 4096n);
  if (candidate <= __lastNonce) candidate = __lastNonce + 1n;
  __lastNonce = candidate;
  return candidate.toString(10);
}
