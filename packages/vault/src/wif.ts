/**
 * Saosmartwallet — hand-rolled WIF codec (base58check, vault package)
 * ===================================================================
 * Standard Bitcoin WIF semantics (the same reading packages/crypto uses):
 *
 *   payload  = 0x80 ‖ secret32 [‖ 0x01]          (0x01 = compressed flag)
 *   wif      = base58(payload ‖ first4(sha256(sha256(payload))))
 *
 * Decode verifies the double-SHA256 checksum BEFORE any material is returned
 * and enforces: exact payload length (37 / 38 bytes), version byte 0x80, and
 * for the 38-byte form a compression flag of exactly 0x01. Every violation
 * throws — corrupted or mistyped WIFs never yield partial key material.
 *
 * NOTE: secp256k1 SIGNING is deliberately out of scope here (no third-party
 * deps in the vault); this module is storage / roundtrip / validation only.
 */

import { createHash } from "node:crypto";

import { base58Decode, base58Encode } from "./base58";
import { VaultError } from "./errors";

const WIF_VERSION = 0x80;
const WIF_COMPRESSED_FLAG = 0x01;
const SECRET_BYTES = 32;
const CHECKSUM_BYTES = 4;

export interface WifDecoded {
  /** The 32-byte secret (scalar), checksum-verified. */
  secret: Buffer;
  /** True when the WIF carried the 0x01 compressed flag. */
  compressed: boolean;
}

function doubleSha256(b: Buffer): Buffer {
  return createHash("sha256").update(createHash("sha256").update(b).digest()).digest();
}

/**
 * Encodes a 32-byte secp256k1 secret as a WIF string.
 * `compressed: true` appends the 0x01 flag (the "K…/L…" form).
 */
export function wifEncode(secret: Buffer, options?: { compressed?: boolean }): string {
  if (!Buffer.isBuffer(secret) || secret.length !== SECRET_BYTES) {
    throw new VaultError(
      "VAULT_E_BAD_INPUT",
      `WIF secret must be exactly ${SECRET_BYTES} bytes, got ${secret?.length ?? "non-buffer"}`,
    );
  }
  const compressed = options?.compressed === true;
  const payload = Buffer.concat([
    Buffer.from([WIF_VERSION]),
    secret,
    ...(compressed ? [Buffer.from([WIF_COMPRESSED_FLAG])] : []),
  ]);
  const checksum = doubleSha256(payload).subarray(0, CHECKSUM_BYTES);
  return base58Encode(Buffer.concat([payload, checksum]));
}

/**
 * Decodes + checksum-verifies a WIF string, returning the 32-byte secret.
 * Fail-closed on: invalid base58, wrong payload length, wrong version byte,
 * checksum mismatch, non-0x01 compression flag.
 */
export function wifDecode(wif: string): WifDecoded {
  const trimmed = typeof wif === "string" ? wif.trim() : "";
  const raw = base58Decode(trimmed);
  if (raw.length !== 37 && raw.length !== 38) {
    throw new VaultError(
      "VAULT_E_BAD_INPUT",
      `WIF payload must be 37 or 38 bytes, got ${raw.length}`,
    );
  }
  if (raw[0] !== WIF_VERSION) {
    throw new VaultError(
      "VAULT_E_BAD_INPUT",
      `WIF version byte must be 0x80, got 0x${raw[0].toString(16)}`,
    );
  }
  const body = raw.subarray(0, raw.length - CHECKSUM_BYTES);
  const expected = doubleSha256(body);
  for (let i = 0; i < CHECKSUM_BYTES; i++) {
    if (expected[i] !== raw[raw.length - CHECKSUM_BYTES + i]) {
      throw new VaultError(
        "VAULT_E_BAD_INPUT",
        "WIF checksum mismatch — input is corrupt or mistyped",
      );
    }
  }
  if (raw.length === 38 && raw[33] !== WIF_COMPRESSED_FLAG) {
    throw new VaultError(
      "VAULT_E_BAD_INPUT",
      `compressed WIF flag byte must be 0x01, got 0x${raw[33].toString(16)}`,
    );
  }
  return {
    secret: Buffer.from(raw.subarray(1, 1 + SECRET_BYTES)),
    compressed: raw.length === 38,
  };
}
