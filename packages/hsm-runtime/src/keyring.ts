/**
 * Saosmartwallet packages/hsm-runtime — the HSM keyring (first-boot keys, sealed, sign-only)
 * ==========================================================================================
 * Owner directive §3: keys are GENERATED at first boot, sealed IMMEDIATELY with
 * AES-256-GCM, and their plaintext exists in memory ONLY inside the sign call
 * (packages/vault's withKey zero-fills the material after every callback — the
 * W49 envelope law, reused verbatim, not reinvented).
 *
 *   • secp256k1: 32-byte scalar (node:crypto randomBytes, range-validated against
 *     the SEC2 order by packages/vault on seal), RFC6979 deterministic ECDSA over
 *     sha256(payload) via the in-tree audited primitive (@noble/curves, the same
 *     engine packages/crypto uses — zero new third-party deps).
 *   • ed25519: 32-byte seed (node:crypto), one-shot crypto.sign semantics via
 *     packages/vault (RFC 8410 PKCS#8 wrapping, message hashed inside the algorithm).
 *
 * BOOT-TIME INTEGRITY: after opening the store the keyring unseals every envelope
 * once and zero-fills — a tampered/wrong-key store refuses to boot (fail-closed)
 * before it can serve a single request.
 *
 * What ever leaves this class: ids, curve names, PUBLIC keys, sha256 fingerprints.
 * What never leaves: scalars, seeds, envelopes, ciphertexts.
 */

import { createHash, randomBytes } from "node:crypto";

import { openVault, type Vault, type VaultError } from "../../vault/src/index";
import { ed25519PublicKey, ed25519Verify } from "../../vault/src/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";

export const SECP256K1_KEY_ID = "hsm/secp256k1/primary";
export const ED25519_KEY_ID = "hsm/ed25519/primary";

export type HsmCurve = "secp256k1" | "ed25519";

export interface HsmKeyInfo {
  id: string;
  curve: HsmCurve;
  /** Compressed (33B) or raw (32B) public key, hex — public data. */
  publicKey: string;
  /** "sha256:<12 hex>…" over the public key — the printable identity. */
  fingerprint: string;
  createdAt: string;
}

export interface HsmSignature {
  keyId: string;
  algorithm: "ecdsa-secp256k1-sha256" | "ed25519";
  signature: string;
  fingerprint: string;
  signedAt: string;
}

export class HsmKeyringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HsmKeyringError";
  }
}

const SECP256K1_N = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");

function fingerprintOfPublicKey(pubHex: string): string {
  return `sha256:${createHash("sha256").update(pubHex, "utf8").digest("hex").slice(0, 12)}…`;
}

export interface HsmKeyringOptions {
  /** Directory holding keys.enc (the vault store). Never inside git. */
  storeDir: string;
  /** Injectable clock (tests); defaults to wall time. */
  now?: () => Date;
}

export class HsmKeyring {
  private constructor(
    private readonly vault: Vault,
    private readonly now: () => Date,
  ) {}

  /** Opens (or establishes) the sealed store; generates + seals keys at first boot. */
  static async open(options: HsmKeyringOptions): Promise<HsmKeyring> {
    const vault = await openVault({ dir: options.storeDir });
    const ring = new HsmKeyring(vault, options.now ?? (() => new Date()));
    await ring.ensureGeneratedKeys();
    await ring.bootIntegrityCheck();
    return ring;
  }

  /** Metadata ONLY — ids, curves, public keys, fingerprints. Never secrets. */
  listKeys(): HsmKeyInfo[] {
    return this.vault
      .listKeys()
      .map((k) => {
        const meta = (k.meta ?? {}) as { curve?: string; publicKey?: string; fingerprint?: string };
        if (typeof meta.publicKey !== "string" || typeof meta.fingerprint !== "string") {
          throw new HsmKeyringError(`HSM_E_META_CORRUPT — key "${k.id}" carries no public identity metadata`);
        }
        return {
          id: k.id,
          curve: (k.id === SECP256K1_KEY_ID ? "secp256k1" : "ed25519") as HsmCurve,
          publicKey: meta.publicKey,
          fingerprint: meta.fingerprint,
          createdAt: k.createdAt,
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  fingerprint(keyId: string): string {
    const k = this.listKeys().find((x) => x.id === keyId);
    if (!k) throw new HsmKeyringError(`HSM_E_UNKNOWN_KEY — no key "${keyId}" is sealed in this runtime`);
    return k.fingerprint;
  }

  /**
   * Signs payload with the named key. The key material is unsealed inside
   * withKey and zero-filled on return — no plaintext beyond the sign call.
   * secp256k1 signs sha256(payload) (64-byte r||s, RFC6979 deterministic);
   * ed25519 signs the payload itself (64-byte one-shot signature).
   */
  async sign(keyId: string, payload: Buffer): Promise<HsmSignature> {
    if (!Buffer.isBuffer(payload) || payload.length === 0) {
      throw new HsmKeyringError("HSM_E_BAD_PAYLOAD — payload must be a non-empty Buffer");
    }
    const signedAt = this.now().toISOString();
    if (keyId === SECP256K1_KEY_ID) {
      const digest = Buffer.from(sha256(new Uint8Array(payload)));
      const signatureHex = await this.vault.withKey(keyId, (key) => {
        if (key.type !== "secp256k1-wif") {
          throw new HsmKeyringError(`HSM_E_WRONG_CURVE — key "${keyId}" is not a secp256k1 scalar`);
        }
        // @noble/curves v2: sign() returns the 64-byte compact (r||s) directly —
        // the same call shape packages/crypto uses for the Steem wire form.
        const sig64 = secp256k1.sign(new Uint8Array(digest), new Uint8Array(key.material), { prehash: false });
        return Buffer.from(sig64).toString("hex");
      });
      return {
        keyId,
        algorithm: "ecdsa-secp256k1-sha256",
        signature: signatureHex,
        fingerprint: this.fingerprint(keyId),
        signedAt,
      };
    }
    if (keyId === ED25519_KEY_ID) {
      const signature = await this.vault.signEd25519(keyId, payload);
      return {
        keyId,
        algorithm: "ed25519",
        signature: signature.toString("hex"),
        fingerprint: this.fingerprint(keyId),
        signedAt,
      };
    }
    throw new HsmKeyringError(`HSM_E_UNKNOWN_KEY — no key "${keyId}" is sealed in this runtime`);
  }

  /** Pure verification (public math only — never touches private material). */
  verify(keyId: string, payload: Buffer, signature: Buffer): boolean {
    const info = this.listKeys().find((x) => x.id === keyId);
    if (!info) return false;
    try {
      if (keyId === SECP256K1_KEY_ID) {
        const digest = sha256(new Uint8Array(payload));
        return secp256k1.verify(
          new Uint8Array(signature),
          digest,
          new Uint8Array(Buffer.from(info.publicKey, "hex")),
          { prehash: false }, // the digest IS the 32-byte input; noble must not hash again
        );
      }
      if (keyId === ED25519_KEY_ID) {
        return ed25519Verify(Buffer.from(info.publicKey, "hex"), payload, signature);
      }
      return false;
    } catch {
      return false; // malformed signature bytes are a boolean false, not a throw
    }
  }

  // ------------------------------------------------------------- internals

  /** First boot: generate both curves and seal them immediately. */
  private async ensureGeneratedKeys(): Promise<void> {
    const have = new Set(this.vault.listKeys().map((k) => k.id));
    if (!have.has(SECP256K1_KEY_ID)) await this.generateAndSeal("secp256k1");
    if (!have.has(ED25519_KEY_ID)) await this.generateAndSeal("ed25519");
  }

  private async generateAndSeal(curve: HsmCurve): Promise<void> {
    if (curve === "secp256k1") {
      // node:crypto entropy; the scalar range law (0 < s < N) is enforced by
      // packages/vault on seal (fail-closed) — regenerate on the astronomically
      // unlikely out-of-range draw instead of ever storing an invalid scalar.
      let scalar = randomBytes(32);
      for (let attempts = 0; attempts < 8; attempts++) {
        const ok =
          scalar.some((b) => b !== 0) &&
          BigInt(`0x${scalar.toString("hex")}`) < SECP256K1_N;
        if (ok) break;
        scalar = randomBytes(32);
      }
      const pubHex = Buffer.from(secp256k1.getPublicKey(new Uint8Array(scalar), true)).toString("hex");
      try {
        await this.vault.sealKey({
          id: SECP256K1_KEY_ID,
          type: "secp256k1-wif",
          material: scalar,
          meta: {
            curve,
            publicKey: pubHex,
            fingerprint: fingerprintOfPublicKey(pubHex),
            generatedAt: this.now().toISOString(),
          },
        });
      } finally {
        scalar.fill(0);
      }
      return;
    }
    // ed25519: the 32-byte seed IS the private key (RFC 8032); derived via node:crypto.
    const seed = randomBytes(32);
    const pubHex = ed25519PublicKey(seed).toString("hex");
    try {
      await this.vault.sealKey({
        id: ED25519_KEY_ID,
        type: "ed25519",
        material: seed,
        meta: {
          curve,
          publicKey: pubHex,
          fingerprint: fingerprintOfPublicKey(pubHex),
          generatedAt: this.now().toISOString(),
        },
      });
    } finally {
      seed.fill(0);
    }
  }

  /**
   * Boot-time integrity proof: unseal every envelope once and zero-fill.
   * A tampered store, a wrong master key, or any GCM failure refuses the boot.
   */
  private async bootIntegrityCheck(): Promise<void> {
    for (const k of this.vault.listKeys()) {
      try {
        const unsealed = await this.vault.unsealKey(k.id);
        unsealed.material.fill(0);
      } catch (err) {
        const code = (err as VaultError)?.code ?? "unknown";
        throw new HsmKeyringError(
          `HSM_E_BOOT_INTEGRITY — sealed key "${k.id}" failed unseal verification (${code}); refusing to boot (fail-closed)`,
        );
      }
    }
  }
}
