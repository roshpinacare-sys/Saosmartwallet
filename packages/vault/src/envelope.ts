/**
 * Saosmartwallet — AES-256-GCM envelope core + store schema (vault package)
 * =========================================================================
 * Envelope encryption (owner directive §11):
 *
 *   AES key   = HKDF-SHA256(masterKey, salt, info)     (info separates purposes)
 *   envelope  = { iv: random 12B, authTag: 16B, ciphertext: AES-256-GCM }
 *
 * The master key arrives ONLY from SAOS_VAULT_MASTER_KEY and is never
 * persisted, logged, or embedded in errors. The per-store salt is generated
 * once at store creation, carried inside every envelope, and must agree
 * across the whole file (mismatch ⇒ VAULT_E_STORE_CORRUPT, fail-closed).
 *
 * A store-level VERIFY block (GCM seal of a constant plaintext) lets
 * openVault reject a wrong master key immediately — before any key envelope
 * is touched — even when the store is empty.
 *
 * Schema validation is hand-rolled and fail-closed: exact hex lengths, even
 * hex lengths, known key types, ISO parseable createdAt, JSON-object meta,
 * duplicate-id detection. Nothing "best-effort"; nothing partially loaded.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import { VaultError, type VaultErrorCode } from "./errors";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export const VAULT_KEY_TYPES = ["ed25519", "secp256k1-wif", "opaque"] as const;
export type VaultKeyType = (typeof VAULT_KEY_TYPES)[number];

export function isVaultKeyType(v: unknown): v is VaultKeyType {
  return typeof v === "string" && (VAULT_KEY_TYPES as readonly string[]).includes(v);
}

/** Hex-encoded, persisted-without-plaintext representation of one sealed key. */
export interface SealedEnvelope {
  id: string;
  type: VaultKeyType;
  /** Per-store salt (hex, 32 bytes) — identical across all envelopes. */
  salt: string;
  /** Random per-key GCM IV (hex, 12 bytes). */
  iv: string;
  /** GCM authentication tag (hex, 16 bytes). */
  authTag: string;
  /** AES-256-GCM ciphertext of the key material (hex). */
  ciphertext: string;
  /** Caller metadata — public data only, JSON round-trippable. */
  meta: Record<string, unknown> | null;
  /** ISO-8601 timestamp of sealing. */
  createdAt: string;
}

export interface VerifyBlock {
  iv: string;
  authTag: string;
  ciphertext: string;
}

/** The on-disk keys.enc document. */
export interface StoreFile {
  version: 1;
  store: { salt: string; verify: VerifyBlock };
  keys: SealedEnvelope[];
}

// ---------------------------------------------------------------------------
// Limits (memory-bomb guards; oversized stores fail closed)
// ---------------------------------------------------------------------------

export const MAX_STORE_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_ENVELOPE_CIPHER_BYTES = 4 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Hex helpers (strict — Buffer.from would silently truncate odd input)
// ---------------------------------------------------------------------------

const HEX_RE = /^[0-9a-f]+$/;

export function toHex(b: Buffer): string {
  return b.toString("hex");
}

/** Validates a hex string of exactly `byteLen` bytes (when given); fail-closed. */
export function requireHex(value: unknown, field: string, byteLen?: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length % 2 !== 0) {
    throw new VaultError("VAULT_E_STORE_CORRUPT", `${field} must be a non-empty even-length hex string`);
  }
  if (!HEX_RE.test(value)) {
    throw new VaultError("VAULT_E_STORE_CORRUPT", `${field} must contain only hex digits`);
  }
  if (byteLen !== undefined && value.length !== byteLen * 2) {
    throw new VaultError(
      "VAULT_E_STORE_CORRUPT",
      `${field} must be exactly ${byteLen} bytes (${byteLen * 2} hex chars), got ${value.length / 2}`,
    );
  }
  return value.toLowerCase();
}

// ---------------------------------------------------------------------------
// Key derivation + GCM seal/open
// ---------------------------------------------------------------------------

const HKDF_INFO_VERIFY = Buffer.from("saos/vault/v1/verify", "utf8");
const HKDF_INFO_KEY = Buffer.from("saos/vault/v1/key", "utf8");

/** HKDF-SHA256(master, salt, info) → 32-byte AES-256 key (fresh buffer each call). */
export function deriveAesKey(master: Buffer, salt: Buffer, purpose: "verify" | "key"): Buffer {
  return Buffer.from(hkdfSync("sha256", master, salt, purpose === "verify" ? HKDF_INFO_VERIFY : HKDF_INFO_KEY, 32));
}

export interface GcmBlock {
  iv: string;
  authTag: string;
  ciphertext: string;
}

/** AES-256-GCM encrypt with a fresh random 12-byte IV; returns hex fields. */
export function gcmSeal(key: Buffer, plaintext: Buffer): GcmBlock {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { iv: toHex(iv), authTag: toHex(authTag), ciphertext: toHex(ciphertext) };
}

/**
 * AES-256-GCM decrypt with authentication. ANY failure — wrong key, tampered
 * ciphertext, truncated tag — throws VAULT_E_AUTH. The `label` is a public
 * descriptor (never material) used to make the message actionable.
 */
export function gcmOpen(
  key: Buffer,
  iv: Buffer,
  authTag: Buffer,
  ciphertext: Buffer,
  label: string,
): Buffer {
  if (authTag.length !== 16) {
    throw new VaultError("VAULT_E_AUTH", `authentication failed for ${label} — authTag must be 16 bytes`);
  }
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // Node's GCM failure text is generic, but we never surface it — the
    // distinguishing fact (wrong key vs tamper) is not ours to guess.
    throw new VaultError(
      "VAULT_E_AUTH",
      `authentication failed for ${label} — wrong master key or tampered data`,
    );
  }
}

// ---------------------------------------------------------------------------
// Store schema validation (fail-closed, hand-rolled)
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function reqObject(v: unknown, field: string): Record<string, unknown> {
  if (!isPlainObject(v)) throw new VaultError("VAULT_E_STORE_CORRUPT", `${field} must be a JSON object`);
  return v;
}

function reqString(v: unknown, field: string, maxLen: number): string {
  if (typeof v !== "string" || v.length === 0) {
    throw new VaultError("VAULT_E_STORE_CORRUPT", `${field} must be a non-empty string`);
  }
  if (v.length > maxLen) {
    throw new VaultError("VAULT_E_STORE_CORRUPT", `${field} exceeds ${maxLen} characters`);
  }
  return v;
}

/** Normalizes one raw envelope; throws VAULT_E_STORE_CORRUPT on any deviation. */
export function validateEnvelope(raw: unknown, storeSaltHex: string, index: number): SealedEnvelope {
  const field = `keys[${index}]`;
  const obj = reqObject(raw, field);
  const id = reqString(obj.id, `${field}.id`, 512);
  if (id.trim().length === 0) {
    throw new VaultError("VAULT_E_STORE_CORRUPT", `${field}.id must not be blank`);
  }
  if (!isVaultKeyType(obj.type)) {
    throw new VaultError(
      "VAULT_E_STORE_CORRUPT",
      `${field}.type must be one of: ${VAULT_KEY_TYPES.join(", ")}`,
    );
  }
  const salt = requireHex(obj.salt, `${field}.salt`, 32);
  if (salt !== storeSaltHex) {
    throw new VaultError("VAULT_E_STORE_CORRUPT", `${field}.salt does not match the store salt`);
  }
  const iv = requireHex(obj.iv, `${field}.iv`, 12);
  const authTag = requireHex(obj.authTag, `${field}.authTag`, 16);
  const ciphertext = requireHex(obj.ciphertext, `${field}.ciphertext`);
  if (ciphertext.length / 2 > MAX_ENVELOPE_CIPHER_BYTES) {
    throw new VaultError(
      "VAULT_E_STORE_CORRUPT",
      `${field}.ciphertext exceeds ${MAX_ENVELOPE_CIPHER_BYTES} bytes`,
    );
  }
  if (!isPlainObject(obj.meta) && obj.meta !== null && obj.meta !== undefined) {
    throw new VaultError("VAULT_E_STORE_CORRUPT", `${field}.meta must be an object or null`);
  }
  const createdAt = reqString(obj.createdAt, `${field}.createdAt`, 64);
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new VaultError("VAULT_E_STORE_CORRUPT", `${field}.createdAt must be an ISO-8601 timestamp`);
  }
  return {
    id,
    type: obj.type,
    salt,
    iv,
    authTag,
    ciphertext,
    meta: (obj.meta ?? null) as Record<string, unknown> | null,
    createdAt,
  };
}

/** Validates + normalizes the whole parsed store document; fail-closed. */
export function validateStoreFile(parsed: unknown): StoreFile {
  const root = reqObject(parsed, "store document");
  if (root.version !== 1) {
    throw new VaultError("VAULT_E_STORE_CORRUPT", "store version must be exactly 1");
  }
  const store = reqObject(root.store, "store");
  const salt = requireHex(store.salt, "store.salt", 32);
  const verifyRaw = reqObject(store.verify, "store.verify");
  const verify: VerifyBlock = {
    iv: requireHex(verifyRaw.iv, "store.verify.iv", 12),
    authTag: requireHex(verifyRaw.authTag, "store.verify.authTag", 16),
    ciphertext: requireHex(verifyRaw.ciphertext, "store.verify.ciphertext"),
  };
  if (!Array.isArray(root.keys)) {
    throw new VaultError("VAULT_E_STORE_CORRUPT", "keys must be an array");
  }
  const keys: SealedEnvelope[] = root.keys.map((raw, i) => validateEnvelope(raw, salt, i));
  const seen = new Set<string>();
  for (const env of keys) {
    if (seen.has(env.id)) {
      throw new VaultError("VAULT_E_STORE_CORRUPT", `duplicate envelope id "${env.id}" in store`);
    }
    seen.add(env.id);
  }
  return { version: 1, store: { salt, verify }, keys };
}

export { VaultError, type VaultErrorCode };
