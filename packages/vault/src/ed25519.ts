/**
 * Saosmartwallet — ed25519 via raw 32-byte seeds (vault package)
 * ==============================================================
 * node:crypto speaks ed25519 only through DER-encoded KeyObjects, so this
 * module implements the deterministic raw-seed → PKCS#8 wrapping itself
 * (RFC 8410; the prefix is a constant — no ASN.1 parser needed):
 *
 *   PKCS#8: 30 2e 02 01 00 30 05 06 03 2b 65 70 04 22 04 20 ‖ seed(32)
 *           └SEQUENCE┘ └v=0┘ └Ed25519 OID 1.3.101.112┘ └octets┘
 *   SPKI  : 30 2a 30 05 06 03 2b 65 70 03 21 00 ‖ publicKey(32)
 *
 * Signing uses crypto.sign(null, msg, key) — the ed25519 one-shot form
 * (message is hashed inside the algorithm; no external digest). Verification
 * is a pure function that returns false (never throws) on malformed inputs,
 * matching packages/crypto's Ed25519Signer.verify semantics.
 *
 * Zeroization is best-effort by the nature of JS: the DER buffer produced
 * here contains the seed and is wiped after the KeyObject is built; the
 * KeyObject's internal copy is unreferenced as soon as it goes out of scope.
 */

import { createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";

import { VaultError } from "./errors";

const SEED_BYTES = 32;
const PUBLIC_KEY_BYTES = 32;
const SIGNATURE_BYTES = 64;

/** RFC 8410 Ed25519 PKCS#8 DER prefix — concat with the raw 32-byte seed. */
export const ED25519_PKCS8_PREFIX = Buffer.from(
  "302e020100300506032b657004220420",
  "hex",
);
/** RFC 8410 Ed25519 SPKI DER prefix — concat with the raw 32-byte public key. */
export const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** Wraps a raw 32-byte ed25519 seed into a 48-byte PKCS#8 DER buffer. */
export function ed25519SeedToPkcs8(seed: Buffer): Buffer {
  if (!Buffer.isBuffer(seed) || seed.length !== SEED_BYTES) {
    throw new VaultError(
      "VAULT_E_BAD_INPUT",
      `ed25519 seed must be exactly ${SEED_BYTES} bytes, got ${seed?.length ?? "non-buffer"}`,
    );
  }
  return Buffer.concat([ED25519_PKCS8_PREFIX, seed]);
}

/** Derives the raw 32-byte ed25519 public key from a raw 32-byte seed. */
export function ed25519PublicKey(seed: Buffer): Buffer {
  const der = ed25519SeedToPkcs8(seed);
  try {
    const privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" });
    return Buffer.from(spki.subarray(spki.length - PUBLIC_KEY_BYTES));
  } catch {
    // Structurally valid seeds cannot fail here; anything that does is fatal.
    throw new VaultError("VAULT_E_BAD_INPUT", "ed25519 key derivation failed (invalid seed)");
  }
}

/** Signs an arbitrary-length message with a raw 32-byte ed25519 seed (64-byte signature). */
export function ed25519Sign(seed: Buffer, message: Buffer): Buffer {
  if (!Buffer.isBuffer(message)) {
    throw new VaultError("VAULT_E_BAD_INPUT", "ed25519 message must be a Buffer");
  }
  const der = ed25519SeedToPkcs8(seed);
  try {
    const privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    return Buffer.from(cryptoSign(null, message, privateKey));
  } finally {
    der.fill(0); // DER contains the seed — wipe the wrapping immediately.
  }
}

/**
 * Pure ed25519 verification: true for a valid (pubkey, message, signature)
 * triple, false for anything else — malformed lengths and invalid points
 * return false instead of throwing (boolean verify API, fail-closed answer).
 */
export function ed25519Verify(publicKeyRaw: Buffer, message: Buffer, signature: Buffer): boolean {
  if (!Buffer.isBuffer(publicKeyRaw) || publicKeyRaw.length !== PUBLIC_KEY_BYTES) return false;
  if (!Buffer.isBuffer(signature) || signature.length !== SIGNATURE_BYTES) return false;
  if (!Buffer.isBuffer(message)) return false;
  try {
    const spki = Buffer.concat([ED25519_SPKI_PREFIX, publicKeyRaw]);
    const publicKey = createPublicKey({ key: spki, format: "der", type: "spki" });
    return cryptoVerify(null, message, publicKey, signature);
  } catch {
    return false;
  }
}
