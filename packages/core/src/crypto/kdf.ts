/**
 * Saosmartwallet — Argon2id password KDF (M2, layer 2)
 * ====================================================
 * The single gate between a human password and key material.
 *
 * Security properties:
 *   • Argon2id (memory-hard, side-channel-resistant hybrid) per the M2 spec
 *     brute-force budget: DEFAULT_KDF_PARAMS = 64 MiB × 3 passes ≈ 1 s per
 *     derivation — an offline attacker pays ~1 GPU-second per guess.
 *   • Verifiers store ONLY the hash output + params + salt. The password
 *     itself never persists anywhere.
 *   • Comparisons are constant-time (node:crypto timingSafeEqual with
 *     length-safe padding) and NEVER throw on mismatch — verifyPassword
 *     degrades to `false`.
 */

import { argon2id } from "hash-wasm";
import { timingSafeEqual, randomBytes as nodeRandomBytes } from "node:crypto";

import { b64ToBytes, bytesToB64 } from "../encoding";
import { VaultError, type KdfParams, type PasswordVerifier } from "../types";

/**
 * M2-spec default cost model: 64 MiB of memory, 3 passes, 1 lane, 32-byte
 * output (~1 s on server hardware). Pinned here so every verifier records
 * exactly which budget produced its hash.
 */
export const DEFAULT_KDF_PARAMS: KdfParams = {
  algorithm: "argon2id",
  memoryKiB: 65536,
  iterations: 3,
  parallelism: 1,
  hashLength: 32,
};

/** CSPRNG bytes from node:crypto — the only randomness source in core. */
export function randomBytes(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 1 << 20) {
    throw new VaultError("VALIDATION", "randomBytes: length must be an integer in [0, 1 MiB]");
  }
  return new Uint8Array(nodeRandomBytes(n));
}

/**
 * Derives the 32-byte master key from a password + salt under the given
 * Argon2id parameters.
 *
 * The SAME (password, salt, params) triple always yields the same key, which
 * is what makes stored verifiers re-checkable and backups re-derivable.
 *
 * @throws VaultError("VALIDATION") on empty password, short salt (< 8 bytes,
 *   the Argon2 minimum) or nonsensical parameters — fail closed before any
 *   expensive work happens.
 */
export async function deriveMasterKey(
  password: string,
  salt: Uint8Array,
  params: KdfParams = DEFAULT_KDF_PARAMS,
): Promise<Uint8Array> {
  if (password.length === 0) throw new VaultError("VALIDATION", "password must not be empty");
  if (salt.length < 8) throw new VaultError("VALIDATION", "kdf salt must be at least 8 bytes");
  if (params.algorithm !== "argon2id") {
    throw new VaultError("VALIDATION", "unsupported kdf algorithm — only argon2id is allowed");
  }
  if (!Number.isInteger(params.iterations) || params.iterations < 1 || params.iterations > 64) {
    throw new VaultError("VALIDATION", "kdf iterations out of range");
  }
  if (!Number.isInteger(params.parallelism) || params.parallelism < 1 || params.parallelism > 8) {
    throw new VaultError("VALIDATION", "kdf parallelism out of range");
  }
  if (!Number.isInteger(params.memoryKiB) || params.memoryKiB < 8 * params.parallelism) {
    throw new VaultError("VALIDATION", "kdf memory below argon2 minimum (8 KiB per lane)");
  }
  if (!Number.isInteger(params.hashLength) || params.hashLength < 16 || params.hashLength > 128) {
    throw new VaultError("VALIDATION", "kdf hashLength out of range (16..128)");
  }
  return argon2id({
    password,
    salt,
    iterations: params.iterations,
    parallelism: params.parallelism,
    memorySize: params.memoryKiB,
    hashLength: params.hashLength,
    outputType: "binary",
  });
}

/**
 * Builds a storable password verifier: fresh 16-byte random salt + Argon2id
 * hash + the exact params used. Persisting this object is what enables
 * unlock-time verification WITHOUT ever storing (or re-deriving keys from)
 * the password itself.
 */
export async function deriveVerifier(
  password: string,
  params: KdfParams = DEFAULT_KDF_PARAMS,
): Promise<PasswordVerifier> {
  const salt = randomBytes(16);
  const hash = await deriveMasterKey(password, salt, params);
  return {
    params,
    salt: bytesToB64(salt),
    hash: bytesToB64(hash),
    createdAt: Date.now(),
  };
}

/**
 * Re-derives the Argon2id output from the candidate password using the
 * STORED params + salt and compares it to the stored hash in constant time.
 *
 * Never throws on a wrong password (or on any verifier corruption) — the
 * boolean result is the only observable, so error paths cannot act as an
 * oracle for which part of the verification failed.
 */
export async function verifyPassword(password: string, verifier: PasswordVerifier): Promise<boolean> {
  try {
    const expected = b64ToBytes(verifier.hash);
    const actual = await deriveMasterKey(password, b64ToBytes(verifier.salt), verifier.params);
    return constantTimeEquals(actual, expected);
  } catch {
    return false;
  }
}

/**
 * Length-safe constant-time comparison: both inputs are padded to the same
 * size first so timingSafeEqual's same-length precondition can never throw,
 * and length inequality is decided without leaking which prefix matched.
 */
function constantTimeEquals(a: Uint8Array, b: Uint8Array): boolean {
  const max = Math.max(a.length, b.length, 1);
  const pa = new Uint8Array(max);
  const pb = new Uint8Array(max);
  pa.set(a);
  pb.set(b);
  const same = timingSafeEqual(pa, pb);
  return same && a.length === b.length;
}
