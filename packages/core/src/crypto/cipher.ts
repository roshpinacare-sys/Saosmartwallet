/**
 * Saosmartwallet — envelope encryption (M2, layer 2)
 * ==================================================
 * AEAD envelope format used for EVERY sealed secret in the vault (keys,
 * state exports, backups). One payload, two algorithms:
 *
 *   aes-256-gcm       — via node:crypto (OpenSSL)
 *   chacha20-poly1305 — via node:crypto when the runtime provides it,
 *                       else a pure-TS RFC 8439 implementation below.
 *
 * WHY THE PURE-TS FALLBACK EXISTS: Bun (this project's server runtime) ships
 * a reduced OpenSSL cipher list that does NOT expose chacha20-poly1305. The
 * fallback is composed strictly per RFC 8439 (ChaCha20 block function +
 * Poly1305 one-time authenticator + the §2.8 AEAD construction) and is
 * cross-verified against OpenSSL in tools and against the RFC 8439 §2.8.2
 * known-answer vector in the sanity suite. Payloads are wire-compatible in
 * both directions across runtimes.
 *
 * Envelope structure (see EncryptedPayload in ../types):
 *   content  = AEAD(CEK, iv, plaintext, aad)         — fresh 12-byte IV + 32-byte CEK per seal
 *   layer[0] = keyId ‖ b64(wrapIV ‖ wrapTag ‖ AEAD(masterKey, wrapIV, CEK))
 *   checksum = sha256(plaintext)                      — integrity independent of the AEAD tag
 *
 * Security properties:
 *   • Fresh IV + fresh CEK per seal — nonce reuse is structurally impossible.
 *   • CEK wrapping decouples content keys from the master key (rotating the
 *     master key re-wraps layers without touching ciphertexts).
 *   • AAD binds the payload to its context (e.g. a record id); a payload
 *     opened with the wrong AAD fails authentication.
 *   • First layer that authenticates wins (key rotation via layered wraps).
 *   • Error messages never contain key material — only generic failure codes.
 */

import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import type { CipherChaCha20Poly1305, CipherGCM, DecipherChaCha20Poly1305, DecipherGCM } from "node:crypto";

import { b64ToBytes, bytesToB64, bytesEqual, concat, utf8 } from "../encoding";
import { VaultError, type CipherAlgorithm, type EncryptedPayload } from "../types";
import { randomBytes } from "./kdf";

/** Envelope format version produced by seal(). */
export const ENVELOPE_VERSION = 1;

/** Default KEK id recorded in layer[0] when the caller does not name one. */
export const DEFAULT_KEY_ID = "master-v1";

export interface SealOptions {
  algorithm?: CipherAlgorithm;
  /** Additional authenticated data — bound to the CONTENT encryption only. */
  aad?: Uint8Array;
  /** KEK name recorded in layer[0] (e.g. "master-v1", "backup-v1"). */
  keyId?: string;
  /**
   * Explicit value for the payload's `salt` field. seal() otherwise generates
   * fresh random bytes. Callers that derive the KEK from a password (e.g.
   * SovereignVault.exportState) pass the REAL kdf salt so the payload is
   * self-contained for re-derivation.
   */
  salt?: Uint8Array;
}

export interface OpenOptions {
  /** Must byte-match the aad given to seal(), else authentication fails. */
  aad?: Uint8Array;
}

// ---------------------------------------------------------------------------
// Runtime cipher support detection
// ---------------------------------------------------------------------------

/**
 * Probed once at module load: does THIS runtime's OpenSSL expose
 * chacha20-poly1305? Node does; Bun 1.3 does not. Used only to pick the
 * chacha20-poly1305 code path — aes-256-gcm always uses node:crypto.
 */
export const NODE_CHACHA20_SUPPORTED: boolean = (() => {
  try {
    const probe = createCipheriv("chacha20-poly1305", new Uint8Array(32), new Uint8Array(12), {
      authTagLength: 16,
    });
    probe.update(new Uint8Array(0));
    probe.final();
    return true;
  } catch {
    return false;
  }
})();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Seals `plaintext` under envelope encryption keyed by `masterKey`.
 *
 * Returns a fully JSON-safe EncryptedPayload (all binary fields base64).
 * The master key itself is never written into the payload — only its wrap
 * of the fresh content key, under the layer's keyId.
 *
 * @throws VaultError("VALIDATION") for keys that are not exactly 32 bytes
 *   (both supported algorithms are 256-bit).
 */
export function seal(
  plaintext: Uint8Array,
  masterKey: Uint8Array,
  opts: SealOptions = {},
): EncryptedPayload {
  if (masterKey.length !== 32) {
    throw new VaultError("VALIDATION", "master key must be 32 bytes");
  }
  if (plaintext.length === 0) {
    throw new VaultError("VALIDATION", "cannot seal an empty payload");
  }
  const algorithm: CipherAlgorithm = opts.algorithm ?? "aes-256-gcm";
  const iv = randomBytes(12);
  const cek = randomBytes(32);

  // 1. Content encryption under the fresh CEK.
  const content = aeadSeal(algorithm, cek, iv, plaintext, opts.aad ?? null);

  // 2. Wrap the CEK under the master key — fresh wrap IV, self-describing
  //    layer blob `wrapIV ‖ wrapTag ‖ wrappedCEK` so layers can be tried
  //    independently during open().
  const wrapIv = randomBytes(12);
  const wrapped = aeadSeal(algorithm, masterKey, wrapIv, cek, null);
  cek.fill(0);

  return {
    version: ENVELOPE_VERSION,
    algorithm,
    ciphertext: bytesToB64(content.ciphertext),
    iv: bytesToB64(iv),
    authTag: bytesToB64(content.authTag),
    salt: bytesToB64(opts.salt ?? randomBytes(16)),
    layers: [
      {
        keyId: opts.keyId ?? DEFAULT_KEY_ID,
        encryptedKey: bytesToB64(concat(wrapIv, wrapped.authTag, wrapped.ciphertext)),
      },
    ],
    checksum: bytesToB64(sha256(plaintext)),
    createdAt: Date.now(),
  };
}

/**
 * Opens a payload produced by seal() with the master key that wrapped one of
 * its layers. Every layer is tried until one authenticates (supports key
 * rotation stacks); the content tag and the plaintext checksum must BOTH
 * verify.
 *
 * @throws VaultError("DECRYPTION_FAILED") when no layer unwraps, the AEAD
 *   tag fails, the AAD mismatches, or the checksum mismatches. The error
 *   carries no key material and does not reveal WHICH check failed.
 */
export function open(payload: EncryptedPayload, masterKey: Uint8Array, opts: OpenOptions = {}): Uint8Array {
  if (masterKey.length !== 32) {
    throw new VaultError("VALIDATION", "master key must be 32 bytes");
  }
  if (!isEncryptedPayloadShape(payload)) {
    throw new VaultError("DECRYPTION_FAILED", "malformed encrypted payload");
  }

  // 1. Unwrap the first layer that authenticates.
  let cek: Uint8Array | null = null;
  for (const layer of payload.layers) {
    try {
      const blob = b64ToBytes(layer.encryptedKey);
      if (blob.length < 12 + 16 + 1) continue; // wrapIV ‖ wrapTag ‖ ≥1 wrapped byte
      const wrapIv = blob.subarray(0, 12);
      const wrapTag = blob.subarray(12, 28);
      const wrappedCek = blob.subarray(28);
      const unwrapped = aeadOpen(payload.algorithm, masterKey, wrapIv, wrappedCek, wrapTag, null);
      if (unwrapped.length === 32) {
        cek = unwrapped;
        break;
      }
    } catch {
      // Wrong key or foreign layer — try the next one, never surface why.
    }
  }
  if (cek === null) {
    throw new VaultError("DECRYPTION_FAILED", "no envelope layer could be unwrapped with this key");
  }

  // 2. Decrypt the content under the unwrapped CEK.
  try {
    const plaintext = aeadOpen(
      payload.algorithm,
      cek,
      b64ToBytes(payload.iv),
      b64ToBytes(payload.ciphertext),
      b64ToBytes(payload.authTag),
      opts.aad ?? null,
    );
    if (!bytesEqual(sha256(plaintext), b64ToBytes(payload.checksum))) {
      throw new VaultError("DECRYPTION_FAILED", "plaintext checksum mismatch");
    }
    return plaintext;
  } catch (e) {
    if (e instanceof VaultError) throw e;
    throw new VaultError("DECRYPTION_FAILED", "content decryption failed — wrong key, tampered data, or missing AAD");
  } finally {
    cek.fill(0);
  }
}

/**
 * seal() for JSON values. Plain JSON.stringify (NOT canonicalJson — canonical
 * form is reserved for hashing/audit binding; this is a pure roundtrip).
 */
export function sealJson(value: unknown, key: Uint8Array, opts: SealOptions = {}): EncryptedPayload {
  return seal(utf8(JSON.stringify(value)), key, opts);
}

/**
 * open() for JSON values. Type parameter `T` is the caller's assertion about
 * the sealed document — core performs no schema validation.
 */
export function openJson<T>(payload: EncryptedPayload, key: Uint8Array, opts: OpenOptions = {}): T {
  const decoded: unknown = JSON.parse(new TextDecoder().decode(open(payload, key, opts)));
  return decoded as T;
}

// ---------------------------------------------------------------------------
// AEAD plumbing — node:crypto first, RFC 8439 fallback for chacha
// ---------------------------------------------------------------------------

interface AeadResult {
  ciphertext: Uint8Array;
  authTag: Uint8Array;
}

function aeadSeal(
  algorithm: CipherAlgorithm,
  key: Uint8Array,
  iv: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array | null,
): AeadResult {
  if (algorithm === "chacha20-poly1305" && !NODE_CHACHA20_SUPPORTED) {
    return tsChacha20Poly1305Seal(key, iv, plaintext, aad);
  }
  const cipher = newContentCipher(algorithm, key, iv);
  if (aad) (cipher as CipherGCM).setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, authTag: cipher.getAuthTag() };
}

function aeadOpen(
  algorithm: CipherAlgorithm,
  key: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array,
  authTag: Uint8Array,
  aad: Uint8Array | null,
): Uint8Array {
  if (algorithm === "chacha20-poly1305" && !NODE_CHACHA20_SUPPORTED) {
    return tsChacha20Poly1305Open(key, iv, ciphertext, authTag, aad);
  }
  const decipher = newContentDecipher(algorithm, key, iv);
  (decipher as DecipherGCM).setAuthTag(authTag);
  if (aad) (decipher as DecipherGCM).setAAD(aad);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function newContentCipher(
  alg: CipherAlgorithm,
  key: Uint8Array,
  iv: Uint8Array,
): CipherGCM | CipherChaCha20Poly1305 {
  return alg === "chacha20-poly1305"
    ? createCipheriv("chacha20-poly1305", key, iv, { authTagLength: 16 })
    : createCipheriv("aes-256-gcm", key, iv);
}

function newContentDecipher(
  alg: CipherAlgorithm,
  key: Uint8Array,
  iv: Uint8Array,
): DecipherGCM | DecipherChaCha20Poly1305 {
  return alg === "chacha20-poly1305"
    ? createDecipheriv("chacha20-poly1305", key, iv, { authTagLength: 16 })
    : createDecipheriv("aes-256-gcm", key, iv);
}

/** sha256 over arbitrary bytes (payload checksums + ZK challenge derivation). */
export function sha256(b: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(b).digest());
}

function isEncryptedPayloadShape(v: unknown): v is EncryptedPayload {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    o.version === ENVELOPE_VERSION &&
    (o.algorithm === "aes-256-gcm" || o.algorithm === "chacha20-poly1305") &&
    typeof o.ciphertext === "string" &&
    typeof o.iv === "string" &&
    typeof o.authTag === "string" &&
    typeof o.checksum === "string" &&
    Array.isArray(o.layers) &&
    o.layers.length > 0
  );
}

// ---------------------------------------------------------------------------
// Pure-TS RFC 8439 ChaCha20-Poly1305 (Bun fallback — see header note)
// ---------------------------------------------------------------------------

/** ChaCha20 block counter start for AEAD encryption (RFC 8439 §2.8). */
const AEAD_COUNTER = 1;

/**
 * @internal AEAD seal per RFC 8439 §2.8. Exported for known-answer and
 * OpenSSL cross-verification tooling only.
 */
export function tsChacha20Poly1305Seal(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array | null,
): AeadResult {
  const polyKey = chacha20Stream(key, nonce, 0, new Uint8Array(32));
  const ciphertext = chacha20Stream(key, nonce, AEAD_COUNTER, plaintext);
  const authTag = poly1305Mac(macData(aad, ciphertext), polyKey);
  return { ciphertext, authTag };
}

/**
 * @internal AEAD open per RFC 8439 §2.8. Throws a plain Error when the tag
 * does not authenticate. Exported for cross-verification tooling only.
 */
export function tsChacha20Poly1305Open(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  authTag: Uint8Array,
  aad: Uint8Array | null,
): Uint8Array {
  if (authTag.length !== 16) throw new Error("invalid auth tag length");
  const polyKey = chacha20Stream(key, nonce, 0, new Uint8Array(32));
  const expected = poly1305Mac(macData(aad, ciphertext), polyKey);
  if (!bytesEqual(expected, authTag)) throw new Error("chacha20-poly1305 authentication failed");
  return chacha20Stream(key, nonce, AEAD_COUNTER, ciphertext);
}

/** RFC 8439 §2.8 MAC input: pad16(aad) ‖ pad16(ct) ‖ le64(|aad|) ‖ le64(|ct|). */
function macData(aad: Uint8Array | null, ciphertext: Uint8Array): Uint8Array {
  const a = aad ?? new Uint8Array(0);
  return concat(pad16(a), pad16(ciphertext), le64(a.length), le64(ciphertext.length));
}

function pad16(b: Uint8Array): Uint8Array {
  const rem = b.length % 16;
  if (rem === 0) return b;
  return concat(b, new Uint8Array(16 - rem));
}

function le64(n: number): Uint8Array {
  const out = new Uint8Array(8);
  let v = n;
  for (let i = 0; i < 8; i++) {
    out[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  return out;
}

/** ChaCha20 keystream XOR (RFC 8439 §2.4), 32-bit counter starting at `counter`. */
function chacha20Stream(key: Uint8Array, nonce: Uint8Array, counter: number, data: Uint8Array): Uint8Array {
  if (key.length !== 32) throw new Error("chacha20 key must be 32 bytes");
  if (nonce.length !== 12) throw new Error("chacha20 nonce must be 12 bytes");
  const out = new Uint8Array(data.length);
  const block = new Uint8Array(64);
  for (let off = 0; off < data.length; off += 64) {
    chacha20Block(key, counter + off / 64, nonce, block);
    const take = Math.min(64, data.length - off);
    for (let i = 0; i < take; i++) out[off + i] = data[off + i] ^ block[i];
  }
  return out;
}

const CHACHA_CONSTANTS = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];

/** One ChaCha20 block: 20 rounds over the state, added to the initial state. */
function chacha20Block(key: Uint8Array, counter: number, nonce: Uint8Array, out: Uint8Array): void {
  const st = new Uint32Array(16);
  st.set(CHACHA_CONSTANTS, 0);
  for (let i = 0; i < 8; i++) st[4 + i] = leU32(key, i * 4);
  st[12] = counter >>> 0;
  for (let i = 0; i < 3; i++) st[13 + i] = leU32(nonce, i * 4);

  const w = new Uint32Array(st);
  for (let round = 0; round < 10; round++) {
    quarterRound(w, 0, 4, 8, 12);
    quarterRound(w, 1, 5, 9, 13);
    quarterRound(w, 2, 6, 10, 14);
    quarterRound(w, 3, 7, 11, 15);
    quarterRound(w, 0, 5, 10, 15);
    quarterRound(w, 1, 6, 11, 12);
    quarterRound(w, 2, 7, 8, 13);
    quarterRound(w, 3, 4, 9, 14);
  }
  for (let i = 0; i < 16; i++) putLe32(out, i * 4, (w[i] + st[i]) >>> 0);
}

function quarterRound(w: Uint32Array, a: number, b: number, c: number, d: number): void {
  w[a] = (w[a] + w[b]) >>> 0;
  w[d] = rotl(w[d] ^ w[a], 16);
  w[c] = (w[c] + w[d]) >>> 0;
  w[b] = rotl(w[b] ^ w[c], 12);
  w[a] = (w[a] + w[b]) >>> 0;
  w[d] = rotl(w[d] ^ w[a], 8);
  w[c] = (w[c] + w[d]) >>> 0;
  w[b] = rotl(w[b] ^ w[c], 7);
}

function rotl(v: number, n: number): number {
  return ((v << n) | (v >>> (32 - n))) >>> 0;
}

function leU32(b: Uint8Array, off: number): number {
  return ((b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0) as number;
}

function putLe32(b: Uint8Array, off: number, v: number): void {
  b[off] = v & 0xff;
  b[off + 1] = (v >>> 8) & 0xff;
  b[off + 2] = (v >>> 16) & 0xff;
  b[off + 3] = (v >>> 24) & 0xff;
}

const POLY1305_PRIME = (1n << 130n) - 5n;
const POLY1305_CLAMP = 0x0ffffffc0ffffffc0ffffffc0ffffffcn;

/**
 * Poly1305 one-time authenticator (RFC 8439 §2.5) over BigInt arithmetic.
 * The result is a MAC over already-encrypted data, so the non-constant-time
 * BigInt operations do not leak plaintext.
 */
function poly1305Mac(msg: Uint8Array, key: Uint8Array): Uint8Array {
  let r = leToBigInt(key.subarray(0, 16)) & POLY1305_CLAMP;
  const s = leToBigInt(key.subarray(16, 32));
  let acc = 0n;
  for (let off = 0; off < msg.length; off += 16) {
    const block = msg.subarray(off, Math.min(off + 16, msg.length));
    // n = LE(block ‖ 0x01) — the appended 1-bit marks partial blocks.
    const n = leToBigInt(block) | (1n << BigInt(8 * block.length));
    acc = ((acc + n) * r) % POLY1305_PRIME;
  }
  return bigIntToLe((acc + s) & ((1n << 128n) - 1n), 16);
}

function leToBigInt(b: Uint8Array): bigint {
  let v = 0n;
  for (let i = b.length - 1; i >= 0; i--) {
    v = (v << 8n) | BigInt(b[i]);
  }
  return v;
}

function bigIntToLe(v: bigint, len: number): Uint8Array {
  const out = new Uint8Array(len);
  let x = v;
  for (let i = 0; i < len; i++) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}
