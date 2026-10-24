/**
 * Saosmartwallet — vault error taxonomy (fail-closed, redaction-safe)
 * ===================================================================
 * EVERY error raised by packages/vault is a VaultError carrying a stable
 * machine-readable code. Message discipline (owner directive §11):
 *
 *   • Messages NEVER contain key material — only ids (public), field names,
 *     lengths, byte counts and expected formats. Buffers are never toString()'d
 *     into a message; env values are never echoed; store file contents are
 *     never echoed.
 *   • Fail-closed: there is no "return null and continue" path anywhere in
 *     the vault — any inconsistency throws with one of the codes below.
 */

export type VaultErrorCode =
  /** SAOS_VAULT_MASTER_KEY is unset. */
  | "VAULT_E_ENV_MISSING"
  /** SAOS_VAULT_MASTER_KEY is set but not exactly 64 hex chars. */
  | "VAULT_E_ENV_INVALID"
  /** Store file unreadable / not JSON / failed schema validation / oversized. */
  | "VAULT_E_STORE_CORRUPT"
  /** On-disk store moved underneath us and belongs to a different salt (never clobbered). */
  | "VAULT_E_STORE_CONFLICT"
  /** AES-256-GCM authentication failed — wrong master key or tampered data. */
  | "VAULT_E_AUTH"
  /** No key sealed under the requested id. */
  | "VAULT_E_UNKNOWN_ID"
  /** The id is already sealed — silent overwrite is refused (rotation is explicit). */
  | "VAULT_E_DUPLICATE_ID"
  /** Bad caller input: id shape, material length/shape, wrong key type, non-serializable meta. */
  | "VAULT_E_BAD_INPUT";

export class VaultError extends Error {
  constructor(
    readonly code: VaultErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "VaultError";
  }
}
