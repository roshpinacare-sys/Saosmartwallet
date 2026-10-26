/**
 * Saosmartwallet packages/hsm-runtime — master-key custody (scrypt from a key file)
 * ==================================================================================
 * Owner directive §3: the production HSM runtime derives its vault master key
 * from a key file that lives OUTSIDE the tree (sandbox custody convention:
 * /home/z/coord-work/vaults/saosmartwallet/master.key, dir 0700, file 0600).
 *
 *   vaultMasterHex = scrypt(keyFileBytes, salt="saos/hsm-runtime/v1", N=2^14, r=8, p=1) hex
 *
 * The derived value is handed to packages/vault's openVault() via the
 * SAOS_VAULT_MASTER_KEY env contract — the W49 envelope primitives
 * (AES-256-GCM, verify block, merge-on-disk-change, 0600 store) are REUSED,
 * never reinvented.
 *
 * Fail-closed everywhere: a missing, unreadable, loose-permission (not
 * exactly 0600), empty, or malformed key file throws — there is no default
 * master, no fallback, no degraded mode. The file's content is never logged
 * or echoed; the fingerprint is a one-way sha256 prefix over the file bytes.
 */

import { createHash, scryptSync } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

/** The custody directory convention (documented, never hardcoded as a fallback). */
export const SAOSMARTWALLET_VAULT_DIR = "/home/z/coord-work/vaults/saosmartwallet";
export const DEFAULT_MASTER_KEY_PATH = `${SAOSMARTWALLET_VAULT_DIR}/master.key`;

const SCRYPT_SALT = "saos/hsm-runtime/v1";
const SCRYPT_N = 1 << 14; // 16384 — OWASP-aligned interactive parameterization
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 32;

export class HsmMasterKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HsmMasterKeyError";
  }
}

/**
 * Reads the key file (must be exactly 0600) and scrypt-derives the 64-hex
 * vault master. The key file may carry trailing whitespace/newline (editor
 * benignity); anything else malformed is refused.
 */
export function loadMasterKeyFromKeyFile(keyFilePath: string): string {
  let raw: Buffer;
  try {
    raw = readFileSync(keyFilePath);
  } catch {
    throw new HsmMasterKeyError(
      `HSM_E_KEYFILE_MISSING — custody key file is unreadable at the declared path (fail-closed; no fallback master exists)`,
    );
  }
  const st = statSync(keyFilePath);
  // Owner read/write ONLY. Anything looser is a custody breach, not a warning.
  if ((st.mode & 0o777) !== 0o600) {
    throw new HsmMasterKeyError(
      `HSM_E_KEYFILE_PERMS — custody key file permissions are ${st.mode & 0o777}, must be exactly 600 (fail-closed)`,
    );
  }
  const material = raw.toString("utf8").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(material)) {
    throw new HsmMasterKeyError(
      "HSM_E_KEYFILE_MALFORMED — custody key file must contain exactly 64 hex chars (32 bytes of entropy)",
    );
  }
  const derived = scryptSync(Buffer.from(material, "hex"), SCRYPT_SALT, KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  const hex = derived.toString("hex");
  derived.fill(0);
  return hex;
}

/** Deterministic printable fingerprint of the custody key file (one-way, material-free). */
export function fingerprintOfKeyFile(keyFilePath: string): string {
  const raw = readFileSync(keyFilePath);
  const digest = createHash("sha256").update(raw).digest("hex");
  return `sha256:${digest.slice(0, 12)}…`;
}
