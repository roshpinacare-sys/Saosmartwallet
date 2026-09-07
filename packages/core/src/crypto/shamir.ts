/**
 * Saosmartwallet — Shamir's Secret Sharing over GF(256) (M2, layer 2)
 * ===================================================================
 * Pure TypeScript, zero dependencies (arithmetic on RFC 8439-style tables).
 *
 * A secret of L bytes is split byte-wise: for each byte position an
 * independent random polynomial p(x) of degree (threshold-1) over GF(2^8)
 * is generated with p(0) = secret byte. Share i (x = i, 1-based) records the
 * vector of p_i(x) values — one per byte position.
 *
 * Information-theoretic security: fewer than `threshold` shares reveal
 * NOTHING about the secret (every candidate value is equally likely), so a
 * reconstruction from too few shares silently produces a WRONG secret —
 * callers must treat share count as a hard precondition, not a guess.
 *
 * Field: GF(2^8) modulo x^8 + x^4 + x^3 + x^2 + 1 (0x11B), generator 3 —
 * the AES field, chosen because its tables are small, fast and battle-tested.
 */

import { b64ToBytes, bytesToB64 } from "../encoding";
import { VaultError, type Share } from "../types";
import { randomBytes } from "./kdf";

// ---------------------------------------------------------------------------
// GF(256) arithmetic — log/exp tables for generator 3
// ---------------------------------------------------------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(function buildTables(): void {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    // advance x <- x · 3 in GF(2^8) mod 0x11B (multiply by 2, then xor x)
    const doubled = ((x << 1) ^ (x & 0x80 ? 0x1b : 0)) & 0xff;
    x = doubled ^ x;
  }
  // duplicate the cycle so EXP[a+b] needs no modulo (a,b ≤ 254 → a+b ≤ 508)
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

/** GF(256) multiplication via log tables; 0 annihilates. */
function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** GF(256) division; throws on division by zero (internal invariant only). */
function gfDiv(a: number, b: number): number {
  if (b === 0) throw new VaultError("SHAMIR_INVALID", "internal error: GF(256) division by zero");
  if (a === 0) return 0;
  return EXP[(LOG[a] + 255 - LOG[b]) % 255];
}

/** GF(256) multiplicative inverse; 0 has none (internal invariant only). */
function gfInv(a: number): number {
  if (a === 0) throw new VaultError("SHAMIR_INVALID", "internal error: GF(256) inverse of zero");
  return EXP[255 - LOG[a]];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Splits `secret` into `totalShares` shares, any `threshold` of which
 * reconstruct the original bytes.
 *
 * Share x-values are 1..totalShares; each share's `data` is the base64 of
 * the per-byte evaluations at that x (same byte length as the secret).
 *
 * @throws VaultError("SHAMIR_INVALID") when 1 ≤ threshold ≤ totalShares ≤ 254
 *   is violated or the secret is empty. Secrets up to 128 bytes are the
 *   recommended use (vault root keys); any length works.
 */
export async function shardSecret(secret: Uint8Array, threshold: number, totalShares: number): Promise<Share[]> {
  if (!Number.isInteger(threshold) || !Number.isInteger(totalShares)) {
    throw new VaultError("SHAMIR_INVALID", "threshold and totalShares must be integers");
  }
  if (threshold < 1 || totalShares < 1) {
    throw new VaultError("SHAMIR_INVALID", "threshold and totalShares must be ≥ 1");
  }
  if (threshold > totalShares) {
    throw new VaultError("SHAMIR_INVALID", "threshold cannot exceed totalShares");
  }
  if (totalShares > 254) {
    throw new VaultError("SHAMIR_INVALID", "totalShares must be ≤ 254 (x is a nonzero byte)");
  }
  if (secret.length === 0) {
    throw new VaultError("SHAMIR_INVALID", "cannot shard an empty secret");
  }

  const shares: Array<{ data: number[] }> = [];
  for (let i = 0; i < totalShares; i++) shares.push({ data: [] });

  for (let bytePos = 0; bytePos < secret.length; bytePos++) {
    const a0 = secret[bytePos];
    // Random coefficients c1..c(threshold-1); threshold = 1 → constant polynomial.
    const coeffs = randomBytes(threshold - 1);
    for (let i = 0; i < totalShares; i++) {
      const x = i + 1;
      shares[i].data.push(polyEval(a0, coeffs, x));
    }
  }

  return shares.map((s, i) => ({ index: i + 1, data: bytesToB64(new Uint8Array(s.data)) }));
}

/**
 * Reconstructs the secret from ≥ threshold shares (a larger subset is also
 * valid — Lagrange interpolation at x = 0 over all provided points still
 * lands on the original polynomial's constant term).
 *
 * The secret length is inferred from the LONGEST share data; shares with
 * shorter data contribute only to byte positions they carry.
 *
 * @throws VaultError("SHAMIR_INVALID") on empty input, duplicate x-values,
 *   out-of-range x, or undecodable share data. NOTE: a too-small-but-valid
 *   share set does NOT throw — it silently yields a wrong secret (that is
 *   the information-theoretic design of Shamir SSS).
 */
export async function reconstructSecret(shares: Share[]): Promise<Uint8Array> {
  if (!Array.isArray(shares) || shares.length === 0) {
    throw new VaultError("SHAMIR_INVALID", "no shares provided");
  }

  const seen = new Set<number>();
  const parsed: Array<{ x: number; data: Uint8Array }> = [];
  for (const s of shares) {
    if (s === null || typeof s !== "object") {
      throw new VaultError("SHAMIR_INVALID", "share is not an object");
    }
    if (!Number.isInteger(s.index) || s.index < 1 || s.index > 255) {
      throw new VaultError("SHAMIR_INVALID", "share index must be an integer in [1, 255]");
    }
    if (typeof s.data !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(s.data)) {
      throw new VaultError("SHAMIR_INVALID", "share data is not valid base64");
    }
    const data = b64ToBytes(s.data);
    if (data.length === 0) {
      throw new VaultError("SHAMIR_INVALID", "share data is empty");
    }
    if (seen.has(s.index)) {
      throw new VaultError("SHAMIR_INVALID", `duplicate share index ${s.index}`);
    }
    seen.add(s.index);
    parsed.push({ x: s.index, data });
  }

  const secretLength = Math.max(...parsed.map((p) => p.data.length));

  const secret = new Uint8Array(secretLength);
  for (let bytePos = 0; bytePos < secretLength; bytePos++) {
    const points = parsed.filter((p) => p.data.length > bytePos);
    secret[bytePos] = lagrangeAtZero(points, bytePos);
  }
  return secret;
}

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------

/**
 * Lagrange interpolation at x = 0 over GF(256):
 *   f(0) = Σ_i  y_i · Π_{k≠i} x_k / (x_k − x_i)      (subtraction = XOR)
 * Called once per byte position; the basis work is O(m²) in the share count
 * and independent of the secret length in practice.
 */
function lagrangeAtZero(points: Array<{ x: number; data: Uint8Array }>, bytePos: number): number {
  let result = 0;
  for (let i = 0; i < points.length; i++) {
    let basis = 1;
    for (let k = 0; k < points.length; k++) {
      if (k === i) continue;
      const denom = points[i].x ^ points[k].x; // x_i − x_k in GF(2^8)
      basis = gfMul(basis, gfDiv(points[k].x, denom));
    }
    result ^= gfMul(points[i].data[bytePos], basis);
  }
  return result;
}

/**
 * Evaluates p(x) = a0 + c1·x + c2·x² + … + c(t-1)·x^(t-1) via Horner's rule.
 */
function polyEval(a0: number, coeffs: Uint8Array, x: number): number {
  let y = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) {
    y = gfMul(y, x) ^ coeffs[i]!;
  }
  // Final multiply folds the a0 degree — y currently holds the c1..c(t-1) part.
  return gfMul(y, x) ^ a0;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
