/**
 * Saosmartwallet — HTLC secrets (task 4-c, directive §3)
 * ======================================================
 * The hash-preimage of an atomic swap. SAOS-HTLC/1 fixes the secret at
 * exactly 32 bytes (256-bit preimage — brute force is out of reach for any
 * realistic adversary) and the hash at SHA-256.
 *
 * Verification is CONSTANT-TIME: the claimed hash is decoded and compared
 * against the computed digest with crypto.timingSafeEqual, so verification
 * latency does not leak how many leading hex nibbles matched. Malformed
 * hash strings never throw — they simply verify false (the caller decides
 * what a failed verification means); malformed SECRETS throw fail-closed
 * (a wrong-length secret is a programming error, not a failed claim).
 *
 * Secret material NEVER appears in error messages — only lengths and shapes.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { HtlcError } from "./errors";

/** The protocol-fixed secret length in bytes (SAOS-HTLC/1). */
export const SECRET_BYTES = 32;

const HEX64 = /^[0-9a-fA-F]{64}$/;

/**
 * Generates a fresh 32-byte cryptographically-random secret (the HTLC
 * preimage). The caller owns the bytes and MUST keep them secret until the
 * claim is broadcast — revealing the preimage is what moves the funds.
 */
export function generateSecret(): Uint8Array {
  return new Uint8Array(randomBytes(SECRET_BYTES));
}

/**
 * SHA-256 of the secret, hex-encoded (64 chars, lowercase) — the hash that
 * is embedded in every Offer/HTLC. Accepts raw bytes or a 64-hex-char
 * string encoding of the secret.
 */
export function hashSecret(secret: Uint8Array | string): string {
  return createHash("sha256").update(requireSecretBytes(secret)).digest("hex");
}

/**
 * Constant-time verification: sha256(secret) === hash.
 * Returns true/false; NEVER throws for a malformed hash (returns false).
 * Malformed secrets (wrong length) throw HTLC_E_BAD_INPUT — fail-closed.
 */
export function verifySecret(secret: Uint8Array | string, hash: string): boolean {
  const actual = createHash("sha256").update(requireSecretBytes(secret)).digest();
  if (typeof hash !== "string" || !HEX64.test(hash)) return false;
  const expected = Buffer.from(hash.toLowerCase(), "hex");
  return timingSafeEqual(actual, expected);
}

// ---------------------------------------------------------------------------
// internal
// ---------------------------------------------------------------------------

/** Validates + normalizes the secret into exactly 32 bytes (fail-closed). */
function requireSecretBytes(secret: Uint8Array | string): Buffer {
  if (typeof secret === "string") {
    if (!HEX64.test(secret)) {
      throw new HtlcError(
        "HTLC_E_BAD_INPUT",
        `secret string must be exactly 64 hex chars (${SECRET_BYTES} bytes)`,
      );
    }
    return Buffer.from(secret.toLowerCase(), "hex");
  }
  if (!(secret instanceof Uint8Array)) {
    throw new HtlcError("HTLC_E_BAD_INPUT", "secret must be a Uint8Array or a 64-hex-char string");
  }
  if (secret.length !== SECRET_BYTES) {
    throw new HtlcError(
      "HTLC_E_BAD_INPUT",
      `secret must be exactly ${SECRET_BYTES} bytes, got ${secret.length}`,
    );
  }
  return Buffer.from(secret);
}
