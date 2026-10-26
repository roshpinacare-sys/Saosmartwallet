/**
 * packages/hsm-runtime — error taxonomy
 * ======================================
 * Stable machine-readable codes; messages carry shapes/paths/counts only —
 * NEVER key material, token values, or vault contents (fleet secrets law).
 */

export type HsmErrorCode =
  | "HSM_E_AUTH_MISSING"
  | "HSM_E_AUTH_INVALID"
  | "HSM_E_TOKEN_UNSET"
  | "HSM_E_VAULT_SEALED"
  | "HSM_E_UNKNOWN_KEY"
  | "HSM_E_KEY_TYPE"
  | "HSM_E_ROLE_POLICY"
  | "HSM_E_BAD_INPUT"
  | "HSM_E_CHAIN_ID"
  | "HSM_E_BODY_TOO_LARGE"
  | "HSM_E_NOT_FOUND"
  | "HSM_E_METHOD";

export class HsmError extends Error {
  constructor(
    readonly code: HsmErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HsmError";
  }
}

export function isHsmError(e: unknown): e is HsmError {
  return e instanceof HsmError;
}
