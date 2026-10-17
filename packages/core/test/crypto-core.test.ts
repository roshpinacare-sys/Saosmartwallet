/**
 * packages/core — first real unit tests for the crypto layer (task 4-c, agent-9)
 * ==============================================================================
 * Covers kdf.ts (Argon2id via hash-wasm), shamir.ts (SSS over GF(256)) and
 * cipher.ts (AEAD envelope: aes-256-gcm + chacha20-poly1305 w/ RFC 8439 fallback).
 *
 * ALL test material is generated in-test (randomBytes / obviously-fake strings).
 * ZERO network. ZERO reads of any .enc/vault/.env file.
 *
 * NOTE on KDF params: tests pin tiny Argon2id params (1 MiB × 1 pass) purely
 * for suite speed; production uses DEFAULT_KDF_PARAMS (64 MiB × 3 passes).
 */

import { describe, it, expect } from "bun:test";

import {
  DEFAULT_KDF_PARAMS,
  deriveMasterKey,
  deriveVerifier,
  randomBytes,
  verifyPassword,
  seal,
  open,
  sealJson,
  openJson,
  shardSecret,
  reconstructSecret,
} from "../src/crypto";
import { VaultError } from "../src/types";

const FAST_KDF = { algorithm: "argon2id" as const, memoryKiB: 1024, iterations: 1, parallelism: 1, hashLength: 32 };

const KEY_A = randomBytes(32); // in-test generated master key
const KEY_B = randomBytes(32); // different in-test key
const PLAINTEXT = new TextEncoder().encode("obviously-fake test vector for unit tests — not a real secret");

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function expectVaultError(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error(`expected VaultError(${code}) — nothing thrown`);
  } catch (e) {
    expect(e).toBeInstanceOf(VaultError);
    expect((e as VaultError).code).toBe(code);
  }
}

// ---------------------------------------------------------------------------
// KDF — Argon2id (hash-wasm)
// ---------------------------------------------------------------------------

describe("kdf (Argon2id)", () => {
  it("same passphrase + same salt → identical key (deterministic)", async () => {
    const salt = randomBytes(16);
    const k1 = await deriveMasterKey("correct horse battery staple", salt, FAST_KDF);
    const k2 = await deriveMasterKey("correct horse battery staple", salt, FAST_KDF);
    expect(k1.length).toBe(32);
    expect(bytesEqual(k1, k2)).toBe(true);
  });

  it("different salt → different key", async () => {
    const pw = "same-password-different-salt";
    const k1 = await deriveMasterKey(pw, randomBytes(16), FAST_KDF);
    const k2 = await deriveMasterKey(pw, randomBytes(16), FAST_KDF);
    expect(bytesEqual(k1, k2)).toBe(false);
  });

  it("verifyPassword: true for the right password, false for a wrong one", async () => {
    const verifier = await deriveVerifier("unit-test-passphrase", FAST_KDF);
    expect(verifier.salt.length).toBeGreaterThan(0);
    expect(await verifyPassword("unit-test-passphrase", verifier)).toBe(true);
    expect(await verifyPassword("totally-wrong-guess", verifier)).toBe(false);
    // verifier must NOT contain the raw password or raw key bytes
    expect(JSON.stringify(verifier)).not.toContain("unit-test-passphrase");
  });

  it("rejects empty password and short salt (fail-closed VALIDATION)", async () => {
    const okSalt = randomBytes(16);
    await expect(deriveMasterKey("", okSalt, FAST_KDF)).rejects.toThrow(VaultError);
    await expect(deriveMasterKey("pw", randomBytes(4), FAST_KDF)).rejects.toThrow(VaultError); // < 8 bytes
    expect(DEFAULT_KDF_PARAMS.algorithm).toBe("argon2id");
  });
});

// ---------------------------------------------------------------------------
// Shamir — SSS over GF(256)
// ---------------------------------------------------------------------------

describe("shamir (GF(256) secret sharing)", () => {
  const secret = new TextEncoder().encode("shamir-unit-test-secret-0123456789");

  it("split 3-of-5 → any 3 shares reconstruct the original secret", async () => {
    const shares = await shardSecret(secret, 3, 5);
    expect(shares.length).toBe(5);
    const recovered = await reconstructSecret([shares[0], shares[2], shares[4]]);
    expect(bytesEqual(recovered, secret)).toBe(true);
  });

  it("a different 3-subset and the full 5 also reconstruct", async () => {
    const shares = await shardSecret(secret, 3, 5);
    const viaSubset = await reconstructSecret([shares[1], shares[2], shares[3]]);
    const viaAll = await reconstructSecret(shares);
    expect(bytesEqual(viaSubset, secret)).toBe(true);
    expect(bytesEqual(viaAll, secret)).toBe(true);
  });

  it("fewer than threshold shares yield a WRONG secret (information-theoretic; no throw)", async () => {
    const shares = await shardSecret(secret, 3, 5);
    const tooFew = await reconstructSecret([shares[0], shares[1]]);
    expect(bytesEqual(tooFew, secret)).toBe(false);
  });

  it("shares are distinct (unique indices, differing data) and misuse fails closed", async () => {
    const shares = await shardSecret(secret, 2, 4);
    const indices = new Set(shares.map((s) => s.index));
    expect(indices.size).toBe(4);
    const datas = new Set(shares.map((s) => s.data));
    expect(datas.size).toBe(4);
    // threshold > totalShares
    await expect(shardSecret(secret, 5, 3)).rejects.toThrow(VaultError);
    // duplicate share index on reconstruct
    await expect(reconstructSecret([shares[0], shares[0]])).rejects.toThrow(VaultError);
  });
});

// ---------------------------------------------------------------------------
// Cipher — AEAD envelope (aes-256-gcm + chacha20-poly1305)
// ---------------------------------------------------------------------------

describe("cipher (AEAD envelope)", () => {
  it("seal → open roundtrip with aes-256-gcm", () => {
    const payload = seal(PLAINTEXT, KEY_A);
    expect(payload.algorithm).toBe("aes-256-gcm");
    expect(payload.ciphertext).not.toContain(new TextDecoder().decode(PLAINTEXT)); // no plaintext leakage
    const opened = open(payload, KEY_A);
    expect(bytesEqual(opened, PLAINTEXT)).toBe(true);
  });

  it("seal → open roundtrip with chacha20-poly1305 (pure-TS fallback in Bun)", () => {
    const payload = seal(PLAINTEXT, KEY_A, { algorithm: "chacha20-poly1305" });
    expect(payload.algorithm).toBe("chacha20-poly1305");
    expect(bytesEqual(open(payload, KEY_A), PLAINTEXT)).toBe(true);
  });

  it("wrong key is rejected with DECRYPTION_FAILED", () => {
    const payload = seal(PLAINTEXT, KEY_A);
    expectVaultError(() => open(payload, KEY_B), "DECRYPTION_FAILED");
  });

  it("tampered ciphertext is detected by the AEAD tag", () => {
    const payload = seal(PLAINTEXT, KEY_A);
    const raw = Buffer.from(payload.ciphertext, "base64");
    raw[0] ^= 0x01; // flip one bit of the content ciphertext
    const tampered = { ...payload, ciphertext: raw.toString("base64") };
    expectVaultError(() => open(tampered, KEY_A), "DECRYPTION_FAILED");
  });

  it("AAD binds the payload: wrong AAD rejected, matching AAD roundtrips", () => {
    const aad = new TextEncoder().encode("record:42");
    const payload = seal(PLAINTEXT, KEY_A, { aad });
    expect(bytesEqual(open(payload, KEY_A, { aad }), PLAINTEXT)).toBe(true);
    const wrongAad = new TextEncoder().encode("record:43");
    expectVaultError(() => open(payload, KEY_A, { aad: wrongAad }), "DECRYPTION_FAILED");
  });

  it("sealJson/openJson roundtrip and non-32-byte keys fail closed", () => {
    const doc = { hello: "world", n: 7, fake: true };
    const payload = sealJson(doc, KEY_A);
    expect(openJson<typeof doc>(payload, KEY_A)).toEqual(doc);
    expectVaultError(() => seal(PLAINTEXT, KEY_A.subarray(0, 16)), "VALIDATION");
  });
});
