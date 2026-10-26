/**
 * Saosmartwallet packages/hsm-runtime — bearer token law (constant-time)
 * =======================================================================
 * The runtime's auth plane. The token arrives via HSM_RUNTIME_TOKEN (0600
 * runtime.env outside the tree). Comparison is constant-time: both sides
 * are hashed to a fixed 32-byte digest first, so comparison cost does not
 * depend on input lengths or the position of the first differing byte —
 * an attacker cannot time-tokenize the secret.
 */

import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time equality for secret strings (length-independent, never throws). */
export function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length === 0 || b.length === 0) return false; // empty never authenticates
  const da = createHash("sha256").update(a, "utf8").digest();
  const db = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(da, db);
}

/** Strict "Bearer <token>" extraction — no sloppy whitespace, case-exact scheme. */
export function extractBearerToken(authorization: string | undefined | null): string | null {
  if (typeof authorization !== "string") return null;
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  if (token.length === 0) return null;
  if (token !== token.trim()) return null; // embedded whitespace = malformed
  return token;
}
