/**
 * Saosmartwallet — hand-rolled base58 (vault package)
 * ===================================================
 * Dependency-free base58 for the vault's WIF codec. The alphabet is the
 * canonical Bitcoin one; leading zero bytes map to leading '1' characters
 * (the standard leading-zeros-preserving reading). Decode is fail-closed:
 * any character outside the alphabet (including '0', 'O', 'I', 'l' and any
 * non-ASCII) throws — no silent truncation, no best-effort partial output.
 */

import { VaultError } from "./errors";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const CHAR_TO_VALUE = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) CHAR_TO_VALUE[ALPHABET.charCodeAt(i)] = i;

/** Encodes bytes to base58, preserving leading zero bytes as '1' characters. */
export function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  // Big-number digits in base 58, little-endian. Standard schoolbook
  // multiply-by-256 per input byte; magnitude fits because we normalize per step.
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] * 256;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}

/** Decodes base58 to bytes; throws VAULT_E_BAD_INPUT on any invalid character. */
export function base58Decode(input: string): Buffer {
  if (input.length === 0) {
    throw new VaultError("VAULT_E_BAD_INPUT", "base58 input is empty");
  }
  let zeros = 0;
  while (zeros < input.length && input[zeros] === "1") zeros++;

  // Big-number bytes in base 256, little-endian, built digit by digit.
  const bytes: number[] = [];
  for (let i = zeros; i < input.length; i++) {
    const code = input.charCodeAt(i);
    const value = code < 128 ? CHAR_TO_VALUE[code] : -1;
    if (value < 0) {
      throw new VaultError(
        "VAULT_E_BAD_INPUT",
        `invalid base58 character at position ${i} (alphabet is Bitcoin's 58-char set)`,
      );
    }
    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  return Buffer.concat([Buffer.alloc(zeros), Buffer.from(bytes.reverse())]);
}
