/**
 * Saosmartwallet — unified multichain signing surface (§7B, task t56)
 * ===================================================================
 * ONE vocabulary for the four directive chains — STEEM, BLURT (secp256k1 /
 * WIF), ETHEREUM (secp256k1 / raw-32), SOLANA (ed25519 / seed-32) — composed
 * strictly from audited primitives (@noble/curves, @scure/base, node:crypto).
 * This module COMPOSES and ENCODES; it never invents cryptographic math.
 *
 * Key-isolation contracts (pinned by packages/crypto/test/multichain.test.ts):
 *   • Error messages NEVER contain key material — generic failure codes only.
 *   • wipeBytes() is the sanctioned zeroization helper for key buffers.
 *   • WIF semantics here are the STANDARD reading (scalar = 32 bytes after
 *     the 0x80 version; a 0x01 33rd byte is the compression FLAG, stripped,
 *     checksum still verified). The fleet's ROT1 body-as-scalar reading is a
 *     steem-adapter boundary concern (r17/r19 there) and is deliberately NOT
 *     repeated here — this module matches every public chain tool's reading.
 *   • Fail-closed: bad lengths, zero scalars, bad checksums and unknown
 *     chains throw BEFORE any signing math.
 */

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Errors (generic — key material never enters a message)
// ---------------------------------------------------------------------------

export class SigningError extends Error {}

// ---------------------------------------------------------------------------
// WIF (standard semantics — see module header)
// ---------------------------------------------------------------------------

const WIF_VERSION = 0x80;

function doubleSha256(b: Uint8Array): Uint8Array {
  return createHash("sha256").update(createHash("sha256").update(b).digest()).digest();
}

/** Standard WIF decode: accepts 37-byte (uncompressed) and 38-byte (compressed, 0x01 flag) payloads. */
function scalarFromWif(wif: string): Uint8Array {
  const trimmed = wif.trim();
  let raw: Uint8Array;
  try {
    raw = base58.decode(trimmed);
  } catch {
    throw new SigningError("invalid WIF base58");
  }
  if (raw.length !== 37 && raw.length !== 38) {
    throw new SigningError(`WIF payload must be 37 or 38 bytes, got ${raw.length}`);
  }
  if (raw[0] !== WIF_VERSION) {
    throw new SigningError(`WIF version byte must be 0x80, got 0x${raw[0].toString(16)}`);
  }
  const body = raw.subarray(0, raw.length - 4);
  const calc = doubleSha256(body).subarray(0, 4);
  for (let i = 0; i < 4; i++) {
    if (calc[i] !== raw[raw.length - 4 + i]) throw new SigningError("WIF checksum mismatch");
  }
  const scalar = new Uint8Array(raw.subarray(1, 33));
  if (raw.length === 38 && raw[33] !== 0x01) {
    // Compressed form carries exactly the 0x01 flag; anything else is corrupt.
    throw new SigningError("compressed WIF flag byte must be 0x01");
  }
  return scalar;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function bytesToHex(b: Uint8Array): string {
  return Buffer.from(b).toString("hex");
}

function isZeroScalar(b: Uint8Array): boolean {
  return b.every((v) => v === 0);
}

/** Zeroizes every byte of every buffer (best-effort JS zeroization; documents intent at call sites). */
export function wipeBytes(...buffers: Uint8Array[]): void {
  for (const b of buffers) b.fill(0);
}

// ---------------------------------------------------------------------------
// Secp256k1Signer — steem-family (STEEM, BLURT) + ethereum
// ---------------------------------------------------------------------------

export interface Secp256k1Signature {
  /** 65-byte steem-family wire form: [31 + recid, r(32), s(32)]. */
  compact65: Uint8Array;
  /** DER form (variable length) — the ethereum/JSON-RPC convention. */
  der: Uint8Array;
}

export class Secp256k1Signer {
  private constructor(readonly scalar: Uint8Array) {}

  /** sha256 of an arbitrary seed string (the steem fromSeed semantic). */
  static fromSeed(seed: string): Secp256k1Signer {
    return Secp256k1Signer.fromBytes(new Uint8Array(createHash("sha256").update(seed, "utf8").digest()));
  }

  static fromHex(hex: string): Secp256k1Signer {
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new SigningError("scalar hex must be exactly 64 hex chars");
    return Secp256k1Signer.fromBytes(new Uint8Array(Buffer.from(hex, "hex")));
  }

  static fromBytes(b: Uint8Array): Secp256k1Signer {
    if (b.length !== 32) throw new SigningError("scalar must be exactly 32 bytes");
    if (isZeroScalar(b)) throw new SigningError("scalar must not be zero");
    // Range validation happens inside getPublicKey (3 <= s < N) — fail-closed.
    secp256k1.getPublicKey(b, true);
    return new Secp256k1Signer(new Uint8Array(b));
  }

  /** Standard WIF (5K…/L…/K…) with checksum + version verification. */
  static fromWif(wif: string): Secp256k1Signer {
    return Secp256k1Signer.fromBytes(scalarFromWif(wif));
  }

  get publicKey(): Uint8Array {
    return new Uint8Array(secp256k1.getPublicKey(this.scalar, true));
  }

  /** RFC 6979 deterministic signature over a 32-byte digest — same (key, digest) ⇒ same bytes. */
  signDigest(digest: Uint8Array): Secp256k1Signature {
    if (digest.length !== 32) throw new SigningError("digest must be exactly 32 bytes");
    const sig64 = secp256k1.sign(digest, this.scalar, { prehash: false });
    const recid = findRecoveryBit(sig64, digest, this.publicKey);
    const compact65 = new Uint8Array(65);
    compact65[0] = 31 + recid;
    compact65.set(sig64, 1);
    const der = secp256k1.Signature.fromBytes(sig64, "compact").toBytes("der");
    return { compact65, der };
  }

  /** Recover-and-compare verification (the chain's own authority semantics). */
  static verify(digest: Uint8Array, compact65: Uint8Array, pub33: Uint8Array): boolean {
    if (digest.length !== 32 || compact65.length !== 65 || pub33.length !== 33) return false;
    try {
      const recovered = Secp256k1Signer.recover(digest, compact65);
      return Buffer.from(recovered).equals(Buffer.from(pub33));
    } catch {
      return false;
    }
  }

  static verifyDer(digest: Uint8Array, der: Uint8Array, pub33: Uint8Array): boolean {
    if (digest.length !== 32 || pub33.length !== 33) return false;
    try {
      const sig = secp256k1.Signature.fromBytes(new Uint8Array(der), "der");
      const compact = new Uint8Array(sig.toBytes("compact"));
      return secp256k1.verify(compact, digest, pub33, { prehash: false, format: "compact" });
    } catch {
      return false;
    }
  }

  static recover(digest: Uint8Array, compact65: Uint8Array): Uint8Array {
    if (digest.length !== 32) throw new SigningError("digest must be exactly 32 bytes");
    if (compact65.length !== 65) throw new SigningError("signature must be exactly 65 bytes");
    const recid = compact65[0] - 31;
    if (recid < 0 || recid > 3) {
      throw new SigningError(`signature header must be 31..34, got ${compact65[0]}`);
    }
    const base = secp256k1.Signature.fromBytes(new Uint8Array(compact65.subarray(1)), "compact");
    return new Uint8Array(base.addRecoveryBit(recid).recoverPublicKey(digest).toBytes(true));
  }
}

function findRecoveryBit(sig64: Uint8Array, digest: Uint8Array, expectedPub33: Uint8Array): number {
  const base = secp256k1.Signature.fromBytes(sig64, "compact");
  for (const recid of [0, 1, 2, 3]) {
    try {
      const recovered = new Uint8Array(base.addRecoveryBit(recid).recoverPublicKey(digest).toBytes(true));
      if (Buffer.from(recovered).equals(Buffer.from(expectedPub33))) return recid;
    } catch {
      // wrong recid → invalid point; try next
    }
  }
  throw new SigningError("recovery bit not found — signature/public key mismatch (internal error)");
}

// ---------------------------------------------------------------------------
// Ed25519Signer — solana
// ---------------------------------------------------------------------------

export class Ed25519Signer {
  private constructor(readonly seed: Uint8Array) {}

  static fromSeed(seed: Uint8Array): Ed25519Signer {
    if (seed.length !== 32) throw new SigningError("ed25519 seed must be exactly 32 bytes");
    if (isZeroScalar(seed)) throw new SigningError("ed25519 seed must not be all-zero");
    // Force key computation so a structurally invalid seed fails at construction.
    ed25519.getPublicKey(seed);
    return new Ed25519Signer(new Uint8Array(seed));
  }

  get publicKey(): Uint8Array {
    return new Uint8Array(ed25519.getPublicKey(this.seed));
  }

  /** Deterministic Ed25519 signature over an arbitrary message (64 bytes). */
  sign(message: Uint8Array): Uint8Array {
    return new Uint8Array(ed25519.sign(new Uint8Array(message), this.seed));
  }

  static verify(message: Uint8Array, sig64: Uint8Array, pub32: Uint8Array): boolean {
    if (sig64.length !== 64 || pub32.length !== 32) return false;
    try {
      return ed25519.verify(sig64, new Uint8Array(message), pub32);
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// §7B chain→key-scheme registry (fail-closed)
// ---------------------------------------------------------------------------

export type ChainKeyScheme = {
  curve: "secp256k1" | "ed25519";
  privateKeyFormat: "wif" | "raw-32" | "seed-32";
};

export const CHAIN_KEY_SCHEMES: Record<string, ChainKeyScheme> = {
  steem: { curve: "secp256k1", privateKeyFormat: "wif" },
  blurt: { curve: "secp256k1", privateKeyFormat: "wif" },
  ethereum: { curve: "secp256k1", privateKeyFormat: "raw-32" },
  solana: { curve: "ed25519", privateKeyFormat: "seed-32" },
} as const;

/** Resolves a chain's signing scheme; throws on any chain outside §7B (fail-closed). */
export function describeChainKeyScheme(chain: string): ChainKeyScheme {
  const scheme = CHAIN_KEY_SCHEMES[chain];
  if (!scheme) {
    throw new SigningError(`unknown chain "${chain}" — known: ${Object.keys(CHAIN_KEY_SCHEMES).join(", ")}`);
  }
  return scheme;
}
