/**
 * Saosmartwallet — Steem key hierarchy & signatures
 * =================================================
 * Implements the four-role Steem key model (owner / active / posting / memo)
 * on top of audited primitives only (@noble/curves secp256k1). This package
 * composes and encodes; it never invents cryptographic math.
 *
 * Password derivation (the canonical Steem/Hive account-key scheme):
 *   priv(role) = sha256(UTF8(account_name + role + password))
 * The master password is a "P"-prefixed WIF of a random key (steem's
 * suggest_password shape), so the seed entropy never depends on user-chosen
 * weak strings.
 *
 * Brain-key derivation (cli_wallet reference):
 *   priv = sha256(UTF8(normalize(brainKey) + " " + sequence))
 * normalize() lowercases and collapses whitespace per cli_wallet; steem-js's
 * JS variant skips lowercasing — both are exposed via an explicit flag
 * because brain-key UX must be pinned per target wallet at integration time.
 */

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";

import { EncodingError, steemPublicKeyDecode, steemPublicKeyEncode, wifDecode, wifEncode } from "./encoding.js";

export const STEEM_ROLES = ["owner", "active", "posting", "memo"] as const;
export type SteemRole = (typeof STEEM_ROLES)[number];

function hashToScalar(utf8: string): Uint8Array {
  return sha256(new TextEncoder().encode(utf8));
}

export class PrivateKey {
  private constructor(readonly bytes: Uint8Array) {}

  /** sha256 of an arbitrary seed string — the Steem fromSeed semantic. */
  static fromSeed(seed: string): PrivateKey {
    return PrivateKey.fromBytes(hashToScalar(seed));
  }

  static fromBytes(b: Uint8Array): PrivateKey {
    if (b.length !== 32) throw new EncodingError("private key must be 32 bytes");
    // Reject zero / out-of-range scalars early (getPublicKey validates the math).
    secp256k1.getPublicKey(b, true);
    return new PrivateKey(new Uint8Array(b));
  }

  static fromWif(wif: string): PrivateKey {
    return PrivateKey.fromBytes(wifDecode(wif));
  }

  static random(): PrivateKey {
    return PrivateKey.fromBytes(crypto.getRandomValues(new Uint8Array(32)));
  }

  get publicKey(): PublicKey {
    return PublicKey.fromBytes(secp256k1.getPublicKey(this.bytes, true));
  }

  toWif(): string {
    return wifEncode(this.bytes);
  }

  /**
   * Signs a 32-byte digest, returning the 65-byte Steem compact form:
   * [31 + recid, r(32), s(32)]. The header convention (0x1f/0x20 observed on
   * real chain signatures) marks compressed-key recovery, matching fc::ecc.
   * Deterministic RFC6979 nonces; canonical low-s enforced by the library.
   */
  signRecoverable(digest: Uint8Array): Uint8Array {
    if (digest.length !== 32) throw new EncodingError("digest must be 32 bytes");
    const sig64 = secp256k1.sign(digest, this.bytes, { prehash: false });
    const recid = findRecoveryBit(sig64, digest, this.publicKey.bytes);
    const out = new Uint8Array(65);
    out[0] = 31 + recid;
    out.set(sig64, 1);
    return out;
  }

  equals(other: PrivateKey): boolean {
    return Buffer.from(this.bytes).equals(Buffer.from(other.bytes));
  }
}

export class PublicKey {
  private constructor(readonly bytes: Uint8Array) {}

  static fromBytes(b: Uint8Array): PublicKey {
    if (b.length !== 33) throw new EncodingError("public key must be 33 bytes (compressed)");
    return new PublicKey(new Uint8Array(b));
  }

  static fromString(s: string, prefixes: readonly string[] = ["STM", "TST"]): PublicKey {
    return PublicKey.fromBytes(steemPublicKeyDecode(s, prefixes));
  }

  /** "STM…" identity string with the RIPEMD160(SHA256) checksum. */
  toString(prefix = "STM"): string {
    return steemPublicKeyEncode(this.bytes, prefix);
  }

  /**
   * Verification via recovery-and-compare — the same semantics the chain
   * itself uses when checking an authority: recover the signer's key from the
   * signature over the digest and compare public keys.
   */
  verify(digest: Uint8Array, sig65: Uint8Array): boolean {
    if (digest.length !== 32 || sig65.length !== 65) return false;
    try {
      const recovered = recoverFromCompact(sig65, digest);
      return Buffer.from(recovered).equals(Buffer.from(this.bytes));
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Recovery plumbing
// ---------------------------------------------------------------------------

/** Parses a 65-byte Steem compact signature ([31+recid, r, s]) into recid + r||s. */
function parseCompact(sig65: Uint8Array): { recid: number; sig64: Uint8Array } {
  if (sig65.length !== 65) throw new EncodingError("signature must be 65 bytes");
  const header = sig65[0];
  const recid = header - 31;
  if (recid < 0 || recid > 3) {
    throw new EncodingError(`signature header 0x${header.toString(16)} is not a compressed recovery form (31..34)`);
  }
  return { recid, sig64: new Uint8Array(sig65.subarray(1)) };
}

/** Recovers the 33-byte compressed public key from a Steem compact signature. */
export function recoverFromCompact(sig65: Uint8Array, digest: Uint8Array): Uint8Array {
  const { recid, sig64 } = parseCompact(sig65);
  const base = secp256k1.Signature.fromBytes(sig64, "compact");
  return new Uint8Array(base.addRecoveryBit(recid).recoverPublicKey(digest, { prehash: false }).toBytes(true));
}

/**
 * Determines the recovery bit for a freshly produced (r,s) pair by matching
 * against the signer's known public key — bounded to 4 attempts, exact.
 */
function findRecoveryBit(sig64: Uint8Array, digest: Uint8Array, expectedPub33: Uint8Array): number {
  const base = secp256k1.Signature.fromBytes(sig64, "compact");
  for (const recid of [0, 1, 2, 3]) {
    try {
      const recovered = new Uint8Array(base.addRecoveryBit(recid).recoverPublicKey(digest, { prehash: false }).toBytes(true));
      if (Buffer.from(recovered).equals(Buffer.from(expectedPub33))) return recid;
    } catch {
      // wrong recid → invalid point; try next
    }
  }
  throw new EncodingError("recovery bit not found — signature/public key mismatch (internal error)");
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

export interface RoleKeySet {
  owner: PrivateKey;
  active: PrivateKey;
  posting: PrivateKey;
  memo: PrivateKey;
}

/**
 * The canonical Steem/Hive account scheme:
 *   priv(role) = sha256(account + role + password)
 * Pass the FULL master password string including its leading "P".
 */
export function derivePrivateKey(account: string, password: string, role: SteemRole): PrivateKey {
  if (!account || !password) throw new EncodingError("account and password are required");
  return PrivateKey.fromSeed(`${account}${role}${password}`);
}

export function derivePrivateKeys(
  account: string,
  password: string,
  roles: readonly SteemRole[] = STEEM_ROLES,
): Partial<Record<SteemRole, PrivateKey>> {
  const out: Partial<Record<SteemRole, PrivateKey>> = {};
  for (const role of roles) out[role] = derivePrivateKey(account, password, role);
  return out;
}

/**
 * suggest_password shape: "P" + WIF(randomKey). The entropy is a full 32
 * random bytes; the "P" prefix marks it as a master password on-chain tools.
 */
export function generateMasterPassword(): string {
  return `P${PrivateKey.random().toWif()}`;
}

/** cli_wallet normalize: trim, collapse inner whitespace, lowercase. */
export function normalizeBrainKey(brainKey: string, lowercase = true): string {
  const collapsed = brainKey.trim().split(/\s+/).join(" ");
  return lowercase ? collapsed.toLowerCase() : collapsed;
}

/** cli_wallet derive_private_key: sha256(normalized + " " + sequence). */
export function deriveFromBrainKey(brainKey: string, sequence = 0, lowercase = true): PrivateKey {
  return PrivateKey.fromSeed(`${normalizeBrainKey(brainKey, lowercase)} ${sequence}`);
}
