/**
 * Saosmartwallet — CryptoEngine facade (M2, layer 2)
 * ===================================================
 * One import surface for every other layer (vault, signing, backup, audit).
 * The module-level functions below are the primitives; CryptoEngine wraps
 * them with the M2 spec's session interface (an engine instance can carry
 * the derived master key of an unlocked vault in memory and encrypt under
 * it without the caller touching raw key bytes).
 *
 * Nothing here invents cryptography — see kdf.ts (Argon2id), cipher.ts
 * (AEAD envelopes), shamir.ts (SSS over GF(256)) and zk.ts (Fiat–Shamir
 * Schnorr) for the security contracts.
 */

import type { CipherAlgorithm, EncryptedPayload, KdfParams, ZKProof } from "../types";
import { DEFAULT_KDF_PARAMS } from "./kdf";
import {
  deriveMasterKey as kdfDeriveMasterKey,
  deriveVerifier as kdfDeriveVerifier,
  randomBytes,
  verifyPassword as kdfVerifyPassword,
} from "./kdf";
import { open as cipherOpen, openJson as cipherOpenJson, seal as cipherSeal, sealJson as cipherSealJson } from "./cipher";
import { reconstructSecret as shamirReconstruct, shardSecret as shamirShard } from "./shamir";
import { deriveCommitment as zkDeriveCommitment, generateZKProof as zkGenerate, verifyZKProof as zkVerify } from "./zk";
import type { PasswordVerifier, Share } from "../types";
import { VaultError } from "../types";

export { DEFAULT_KDF_PARAMS, randomBytes, deriveMasterKey, deriveVerifier, verifyPassword } from "./kdf";
export { ENVELOPE_VERSION, seal, open, sealJson, openJson, type SealOptions, type OpenOptions } from "./cipher";
export { shardSecret, reconstructSecret } from "./shamir";
export { deriveCommitment, generateZKProof, verifyZKProof } from "./zk";

/** Options for CryptoEngine.encrypt — the spec's named knobs plus an optional explicit KEK. */
export interface EngineEncryptOptions {
  algorithm?: CipherAlgorithm;
  keyId?: string;
  /** Bound into the content AEAD (roundtrips through decrypt's `aad`). */
  additionalData?: Uint8Array;
  /**
   * Explicit key-encryption key. When omitted, the session key installed via
   * setSessionKey() is used; encrypt() fails closed if neither exists.
   */
  masterKey?: Uint8Array;
}

/**
 * Session-scoped facade over the crypto primitives. Holding the derived
 * master key of an unlocked vault lets higher layers seal data without ever
 * handling key bytes themselves; clearSessionKey() zero-fills the material
 * (the same discipline lock() applies to SovereignVault).
 */
export class CryptoEngine {
  private sessionKey: Uint8Array | null = null;

  /**
   * Installs (a copy of) the derived master key for this session, zero-filling
   * any previous key first. Call after a successful vault unlock.
   */
  setSessionKey(key: Uint8Array): void {
    this.clearSessionKey();
    this.sessionKey = new Uint8Array(key);
  }

  /** Erases the session key from memory — the engine fails closed afterwards. */
  clearSessionKey(): void {
    if (this.sessionKey !== null) {
      this.sessionKey.fill(0);
      this.sessionKey = null;
    }
  }

  /** Whether a session key is installed (no information about the key leaks). */
  hasSessionKey(): boolean {
    return this.sessionKey !== null;
  }

  /**
   * Argon2id master-key derivation. `iterationsOrParams` accepts either a
   * plain iteration count (overriding the default params) or a full KdfParams
   * object — both end at the same pinned code path.
   */
  async deriveMasterKey(
    password: string,
    salt: Uint8Array,
    iterationsOrParams?: number | KdfParams,
  ): Promise<Uint8Array> {
    const params: KdfParams =
      typeof iterationsOrParams === "number"
        ? { ...DEFAULT_KDF_PARAMS, iterations: iterationsOrParams }
        : (iterationsOrParams ?? DEFAULT_KDF_PARAMS);
    return kdfDeriveMasterKey(password, salt, params);
  }

  /** Builds a storable password verifier (fresh salt, pinned params). */
  async deriveVerifier(password: string, params: KdfParams = DEFAULT_KDF_PARAMS): Promise<PasswordVerifier> {
    return kdfDeriveVerifier(password, params);
  }

  /** Constant-time password verification against a stored verifier; never throws. */
  async verifyPassword(password: string, verifier: PasswordVerifier): Promise<boolean> {
    return kdfVerifyPassword(password, verifier);
  }

  /**
   * Envelope-seals plaintext under the session key (or an explicit KEK).
   * Fails closed with VaultError("VAULT_LOCKED") when no key is available —
   * an unkeyed encrypt() must never silently produce a weak payload.
   */
  encrypt(plaintext: Uint8Array, opts: EngineEncryptOptions = {}): EncryptedPayload {
    return cipherSeal(plaintext, this.resolveKey(opts.masterKey), {
      algorithm: opts.algorithm,
      keyId: opts.keyId,
      aad: opts.additionalData,
    });
  }

  /**
   * Opens a payload with an explicit master key, or the session key when the
   * argument is omitted. Throws VaultError("DECRYPTION_FAILED") on any
   * authentication failure (see cipher.open).
   */
  decrypt(payload: EncryptedPayload, masterKey?: Uint8Array, opts?: { aad?: Uint8Array }): Uint8Array {
    return cipherOpen(payload, this.resolveKey(masterKey), opts);
  }

  /** Seal arbitrary bytes (delegates to the module primitive). */
  seal(plaintext: Uint8Array, masterKey: Uint8Array, opts?: Parameters<typeof cipherSeal>[2]): EncryptedPayload {
    return cipherSeal(plaintext, masterKey, opts);
  }

  /** Open arbitrary bytes (delegates to the module primitive). */
  open(payload: EncryptedPayload, masterKey: Uint8Array, opts?: Parameters<typeof cipherOpen>[2]): Uint8Array {
    return cipherOpen(payload, masterKey, opts);
  }

  /** JSON envelope seal (plain JSON.stringify — canonical form is for hashing only). */
  sealJson(value: unknown, masterKey: Uint8Array, opts?: Parameters<typeof cipherSealJson>[2]): EncryptedPayload {
    return cipherSealJson(value, masterKey, opts);
  }

  /** JSON envelope open. */
  openJson<T>(payload: EncryptedPayload, masterKey: Uint8Array, opts?: Parameters<typeof cipherOpenJson>[2]): T {
    return cipherOpenJson<T>(payload, masterKey, opts);
  }

  /** Shamir split — see shamir.shardSecret for the threshold contract. */
  async shardSecret(secret: Uint8Array, threshold: number, totalShares: number): Promise<Share[]> {
    return shamirShard(secret, threshold, totalShares);
  }

  /** Shamir join — see shamir.reconstructSecret for the threshold contract. */
  async reconstructSecret(shares: Share[]): Promise<Uint8Array> {
    return shamirReconstruct(shares);
  }

  /** Fiat–Shamir Schnorr proof of password knowledge (see zk.ts). */
  async generateZKProof(password: string, saltB64: string, context: string): Promise<ZKProof> {
    return zkGenerate(password, saltB64, context);
  }

  /**
   * Non-throwing ZK verification — anchored to the enrollment commitment the
   * verifier stored at setup time (zk.deriveCommitment). Never accept a
   * commitment declared by the proof itself: that proves nothing.
   */
  async verifyZKProof(proof: ZKProof, expectedCommitmentB64: string): Promise<boolean> {
    return zkVerify(proof, expectedCommitmentB64);
  }

  /** Enrollment commitment X = x·G — persist this and verify against it later. */
  deriveCommitment(password: string, saltB64: string, context: string): string {
    return zkDeriveCommitment(password, saltB64, context);
  }

  private resolveKey(explicit?: Uint8Array): Uint8Array {
    if (explicit !== undefined) {
      if (explicit.length !== 32) throw new VaultError("VALIDATION", "master key must be 32 bytes");
      return explicit;
    }
    if (this.sessionKey === null) {
      throw new VaultError("VAULT_LOCKED", "no session key — call setSessionKey() after unlock");
    }
    return this.sessionKey;
  }
}
