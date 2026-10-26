/**
 * Saosmartwallet packages/fixedfloat — custody vault loader (wave G76-b)
 * ========================================================================
 * The FixedFloat API key + secret live ONLY in a custody vault file; they are
 * never hardcoded, never inlined in env-config, never committed, never logged.
 * (Production custody: /home/z/coord-work/vaults/fixedfloat/keys.json, mode 0600,
 * dir 0700 — outside the repo, pointed at via FIXEDFLOAT_VAULT.)
 *
 * Resolution order (fail-closed when none exists):
 *   1. explicit `path` option
 *   2. env FIXEDFLOAT_VAULT
 *   3. packages/fixedfloat/state/keys.json  (gitignored default)
 *
 * Vault formats:
 *   • plain  — { format: "fixedfloat/keys/1", apiKey, apiSecret }   (0600 REQUIRED)
 *   • sealed — { format: "fixedfloat/keys/enc/1", v: 1, salt, iv, authTag, ciphertext }
 *     AES-256-GCM envelope under SAOS_VAULT_MASTER_KEY via HKDF-SHA256
 *     (info "saos/fixedfloat/v1/key"), reusing the W49 packages/vault envelope
 *     primitives as the single seal/open organ.
 *
 * Fail-closed laws (all pinned by test/vault-loader.test.ts):
 *   • PERMS: plain mode requires exactly 0600 — looser is a custody breach
 *     (the actual octal mode is named in the error; modes are public).
 *   • SCHEMA: unknown format tag, missing/empty/whitespace keys, and key
 *     charset violations (alphanumeric only — colons/spaces/newlines refuse)
 *     all throw FF_E_VAULT_CORRUPT. Nothing partially loads.
 *   • ENVELOPE: missing master key env, wrong master key, tampered ciphertext
 *     each throw FF_E_VAULT_ENVELOPE (auth-fail-closed; VaultError translated).
 *   • NO-SECRET-LEAK: no error message ever carries key material — paths and
 *     public metadata only.
 *   • SIZE GUARD: oversized vault files refuse before parsing (memory bomb).
 */

import { hkdfSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FixedFloatError, type FixedFloatErrorCode } from "./errors";
import { gcmOpen, requireHex, VaultError } from "../../vault/src/envelope";

export class FixedFloatVaultError extends FixedFloatError {}

const FORMAT_PLAIN = "fixedfloat/keys/1";
const FORMAT_SEALED = "fixedfloat/keys/enc/1";
const SEALED_V = 1;
const HKDF_INFO_SEALED = Buffer.from("saos/fixedfloat/v1/key", "utf8");
const MAX_VAULT_BYTES = 2 * 1024 * 1024;
/** FixedFloat API credentials are alphanumeric (observed + charset law). */
const FF_KEY_CHARSET = /^[A-Za-z0-9]+$/;

/** Repo-local default (gitignored); production points FIXEDFLOAT_VAULT at coord-work. */
export const DEFAULT_FF_VAULT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "state",
  "keys.json",
);

export interface LoadFixedFloatKeysOptions {
  /** Explicit custody vault path (highest priority). */
  path?: string;
  /** Environment for resolution + master key (defaults to process.env). */
  env?: Record<string, string | undefined>;
}

export interface FixedFloatKeys {
  apiKey: string;
  apiSecret: string;
}

function vaultErr(code: FixedFloatErrorCode, message: string): FixedFloatVaultError {
  return new FixedFloatVaultError(code, message);
}

function octal(mode: number): string {
  return (mode & 0o777).toString(8);
}

/** Validates one loaded credential pair (charset law; no material in errors). */
function validateKeys(apiKey: unknown, apiSecret: unknown, context: string): FixedFloatKeys {
  if (typeof apiKey !== "string" || typeof apiSecret !== "string") {
    throw vaultErr("FF_E_VAULT_CORRUPT", `vault document must carry string apiKey and apiSecret fields (${context})`);
  }
  if (apiKey.length === 0 || apiSecret.length === 0) {
    throw vaultErr("FF_E_VAULT_CORRUPT", `apiKey and apiSecret must be non-empty (${context})`);
  }
  if (!FF_KEY_CHARSET.test(apiKey) || !FF_KEY_CHARSET.test(apiSecret)) {
    throw vaultErr("FF_E_VAULT_CORRUPT", `apiKey/apiSecret charset violated: alphanumeric only, no whitespace/colons/control chars (${context})`);
  }
  return { apiKey, apiSecret };
}

function openSealed(doc: Record<string, unknown>, env: Record<string, string | undefined>, context: string): FixedFloatKeys {
  if (doc.v !== SEALED_V) {
    throw vaultErr("FF_E_VAULT_CORRUPT", `sealed vault version must be exactly ${SEALED_V}`);
  }
  const masterHex = env.SAOS_VAULT_MASTER_KEY;
  if (typeof masterHex !== "string" || masterHex.length === 0) {
    throw vaultErr("FF_E_VAULT_ENVELOPE", "sealed vault requires SAOS_VAULT_MASTER_KEY (32-byte hex master key) — refusing to open without it");
  }
  let master: Buffer;
  try {
    requireHex(masterHex, "SAOS_VAULT_MASTER_KEY", 32);
    master = Buffer.from(masterHex, "hex");
  } catch {
    throw vaultErr("FF_E_VAULT_ENVELOPE", "SAOS_VAULT_MASTER_KEY is not a valid 32-byte hex master key");
  }
  let salt: Buffer, iv: Buffer, authTag: Buffer, ciphertext: Buffer;
  try {
    salt = Buffer.from(requireHex(doc.salt, "vault.salt", 32), "hex");
    iv = Buffer.from(requireHex(doc.iv, "vault.iv", 12), "hex");
    authTag = Buffer.from(requireHex(doc.authTag, "vault.authTag", 16), "hex");
    ciphertext = Buffer.from(requireHex(doc.ciphertext, "vault.ciphertext"), "hex");
  } catch (err) {
    if (err instanceof VaultError) {
      throw vaultErr("FF_E_VAULT_CORRUPT", `sealed vault schema violation: ${err.message}`);
    }
    throw err;
  }
  const aesKey = Buffer.from(hkdfSync("sha256", master, salt, HKDF_INFO_SEALED, 32));
  let plaintext: Buffer;
  try {
    plaintext = gcmOpen(aesKey, iv, authTag, ciphertext, "fixedfloat custody vault");
  } catch (err) {
    if (err instanceof VaultError) {
      // Authentication failure: wrong master key or tampered data — never guess which.
      throw vaultErr("FF_E_VAULT_ENVELOPE", "sealed vault authentication failed — wrong master key or tampered data");
    }
    throw err;
  }
  let inner: unknown;
  try {
    inner = JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw vaultErr("FF_E_VAULT_CORRUPT", "sealed vault plaintext is not valid JSON");
  }
  if (inner === null || typeof inner !== "object" || Array.isArray(inner)) {
    throw vaultErr("FF_E_VAULT_CORRUPT", "sealed vault plaintext must be a JSON object");
  }
  const obj = inner as Record<string, unknown>;
  return validateKeys(obj.apiKey, obj.apiSecret, context);
}

/**
 * Loads the FixedFloat credentials from custody. Throws FixedFloatVaultError
 * (FF_E_VAULT_*) on EVERY deviation — never returns a partial pair.
 */
export function loadFixedFloatKeys(opts: LoadFixedFloatKeysOptions = {}): FixedFloatKeys {
  const env = opts.env ?? process.env;
  const resolved = opts.path ?? env.FIXEDFLOAT_VAULT ?? DEFAULT_FF_VAULT_PATH;
  const where = opts.path !== undefined ? "explicit path" : env.FIXEDFLOAT_VAULT !== undefined ? "FIXEDFLOAT_VAULT" : "default state path";

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw vaultErr(
      "FF_E_VAULT_MISSING",
      `FixedFloat custody vault not found (${where}): ${resolved} — resolve via explicit path, env FIXEDFLOAT_VAULT, or create the default state path`,
    );
  }
  if (!stat.isFile()) {
    throw vaultErr("FF_E_VAULT_MISSING", `FixedFloat custody vault path is not a regular file (${where}): ${resolved}`);
  }
  if (stat.size > MAX_VAULT_BYTES) {
    throw vaultErr("FF_E_VAULT_CORRUPT", `custody vault exceeds ${MAX_VAULT_BYTES} bytes — refusing (${resolved})`);
  }
  const mode = stat.mode & 0o777;
  if (mode !== 0o600) {
    throw vaultErr(
      "FF_E_VAULT_PERMS",
      `custody breach: vault must be mode 600, found ${octal(stat.mode)} (${resolved}) — tighten with chmod 600`,
    );
  }

  let raw: string;
  try {
    raw = fs.readFileSync(resolved, "utf8");
  } catch {
    throw vaultErr("FF_E_VAULT_MISSING", `custody vault became unreadable: ${resolved}`);
  }
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    throw vaultErr("FF_E_VAULT_CORRUPT", `custody vault is not valid JSON (${resolved})`);
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    throw vaultErr("FF_E_VAULT_CORRUPT", `custody vault must be a JSON object (${resolved})`);
  }
  const obj = doc as Record<string, unknown>;
  if (obj.format === FORMAT_PLAIN) {
    return validateKeys(obj.apiKey, obj.apiSecret, resolved);
  }
  if (obj.format === FORMAT_SEALED) {
    return openSealed(obj, env, resolved);
  }
  throw vaultErr("FF_E_VAULT_CORRUPT", `custody vault format must be "${FORMAT_PLAIN}" or "${FORMAT_SEALED}" (${resolved})`);
}
