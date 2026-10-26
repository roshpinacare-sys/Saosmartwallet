/**
 * packages/hsm-runtime — token gate (deny-by-default)
 * ====================================================
 * The signing API arms ONLY when a token is explicitly configured via
 * HSM_SIGNING_TOKEN. Comparison is constant-time (sha256 both sides +
 * timingSafeEqual) so request timing leaks nothing about the token or how
 * much of a guess matched. The token value never enters an error message,
 * a log line, or a receipt — the fingerprint helper exposes a sha256 prefix
 * for provenance, never the value.
 */

import { createHash, timingSafeEqual } from "node:crypto";

import { HsmError } from "./errors";

/** Constant-time comparison of two secrets (length-independent). */
function safeEqual(a: string, b: string): boolean {
  const da = createHash("sha256").update(a, "utf8").digest();
  const db = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(da, db);
}

/**
 * Deny-by-default gate for every gated route.
 *   expected=null                  → HSM_E_TOKEN_UNSET  (service never armed)
 *   presented missing/empty        → HSM_E_AUTH_MISSING
 *   presented ≠ configured         → HSM_E_AUTH_INVALID (constant-time)
 * Accepts "Bearer <token>" (case-insensitive scheme) or the raw token.
 */
export function authorizeToken(presented: string | null | undefined, expected: string | null): void {
  if (expected === null || expected.length === 0) {
    throw new HsmError(
      "HSM_E_TOKEN_UNSET",
      "signing API is not armed: HSM_SIGNING_TOKEN is not configured — refusing all gated routes (fail-closed)",
    );
  }
  if (typeof presented !== "string" || presented.length === 0) {
    throw new HsmError("HSM_E_AUTH_MISSING", "missing Authorization credential");
  }
  let candidate = presented;
  const m = /^bearer\s+(.+)$/i.exec(presented);
  if (m) {
    candidate = m[1];
  } else if (/^bearer\s*$/i.test(presented) || presented.includes(" ")) {
    // A scheme we do not honor (e.g. "Basic …"), or a bare "Bearer" with no
    // credential — treated as missing, not as a wrong token.
    throw new HsmError("HSM_E_AUTH_MISSING", "unsupported Authorization scheme");
  }
  if (!safeEqual(candidate, expected)) {
    throw new HsmError("HSM_E_AUTH_INVALID", "authorization refused");
  }
}

/** Stable sha256[:16] fingerprint for provenance lines — never the value. */
export function tokenFingerprint(presented: string | null | undefined): string {
  if (typeof presented !== "string" || presented.length === 0) return "unset";
  const m = /^bearer\s+(.+)$/i.exec(presented);
  const value = m ? m[1] : presented;
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}
