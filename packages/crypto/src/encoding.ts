/**
 * Saosmartwallet — Steem key encodings
 * ====================================
 * Two DIFFERENT checksum conventions exist in the Steem family and both are
 * load-bearing (checksum convention verified against live on-chain key
 * strings, 2026-09-07 — stored checksum bytes matched RIPEMD160(pub) exactly):
 *
 *   • WIF private key   : base58(0x80 ‖ key32 ‖ first4(sha256(sha256(payload))))
 *   • Public key string : "STM" + base58(pub33 ‖ first4(ripemd160(pub33)))
 *
 * Note the asymmetry: the public-key string checksum is a plain RIPEMD160 of
 * the 33-byte key (verified empirically), while WIF uses double-SHA256.
 */

import { base58 } from "@scure/base";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";

export class EncodingError extends Error {}

export function base58Encode(b: Uint8Array): string {
  return base58.encode(b);
}

export function base58Decode(s: string): Uint8Array {
  try {
    return base58.decode(s);
  } catch {
    throw new EncodingError("invalid base58 input");
  }
}

function doubleSha256(b: Uint8Array): Uint8Array {
  return sha256(sha256(b));
}

const WIF_VERSION = 0x80;

/** Encodes a 32-byte private key as a standard WIF string (uncompressed form, 51 chars). */
export function wifEncode(key32: Uint8Array): string {
  if (key32.length !== 32) throw new EncodingError("private key must be 32 bytes");
  const payload = new Uint8Array(1 + 32);
  payload[0] = WIF_VERSION;
  payload.set(key32, 1);
  const checksum = doubleSha256(payload).slice(0, 4);
  return base58Encode(new Uint8Array([...payload, ...checksum]));
}

/** Decodes + checksum-verifies a WIF string, returning the 32-byte key. */
export function wifDecode(wif: string): Uint8Array {
  const raw = base58Decode(wif);
  if (raw.length !== 37) throw new EncodingError(`WIF payload must be 37 bytes, got ${raw.length}`);
  if (raw[0] !== WIF_VERSION) throw new EncodingError(`WIF version byte must be 0x80, got 0x${raw[0].toString(16)}`);
  const payload = raw.subarray(0, 33);
  const expected = doubleSha256(payload).slice(0, 4);
  const actual = raw.subarray(33, 37);
  if (!Buffer.from(expected).equals(Buffer.from(actual))) {
    throw new EncodingError("WIF checksum mismatch");
  }
  return new Uint8Array(payload.subarray(1));
}

/**
 * Encodes a 33-byte compressed public key in Steem address notation
 * ("STM…" on mainnet, "TST…" on testnet) with the RIPEMD160(pub) checksum.
 * This IS the Steem "address" — identities are public-key strings owned by
 * named accounts, not Bitcoin-style hashes.
 */
export function steemPublicKeyEncode(pub33: Uint8Array, prefix = "STM"): string {
  if (pub33.length !== 33) throw new EncodingError("public key must be 33 bytes (compressed)");
  const checksum = ripemd160(pub33).slice(0, 4);
  return prefix + base58Encode(new Uint8Array([...pub33, ...checksum]));
}

/** Decodes + checksum-verifies an STM/TST public key string into 33 raw bytes. */
export function steemPublicKeyDecode(s: string, prefixes: readonly string[] = ["STM", "TST"]): Uint8Array {
  for (const p of prefixes) {
    if (s.startsWith(p)) {
      const raw = base58Decode(s.slice(p.length));
      if (raw.length !== 37) throw new EncodingError(`public key payload must be 37 bytes, got ${raw.length}`);
      const pub33 = raw.subarray(0, 33);
      const expected = ripemd160(pub33).slice(0, 4);
      if (!Buffer.from(expected).equals(Buffer.from(raw.subarray(33, 37)))) {
        throw new EncodingError("public key checksum mismatch");
      }
      return new Uint8Array(pub33);
    }
  }
  throw new EncodingError(`public key must start with one of: ${prefixes.join(", ")}`);
}
