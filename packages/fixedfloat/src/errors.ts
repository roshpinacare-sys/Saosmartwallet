/**
 * Saosmartwallet packages/fixedfloat — fail-honest error taxonomy (wave G76-b)
 * ==============================================================================
 * Every failure on this rail is a FixedFloatError with a stable FF_E_* code.
 * Verdict honesty law: an error names WHAT failed and the public metadata that
 * helps an operator act (method name, API code, vault path, observed status) —
 * and NEVER carries key material, request payloads with credentials, or any
 * invented "fallback" result. Nothing here guesses.
 */

export type FixedFloatErrorCode =
  | "FF_E_API" // the API answered with an envelope whose code !== 0
  | "FF_E_TRANSPORT" // network / HTTP-level failure outside the API envelope
  | "FF_E_TIMEOUT" // the request aborted (timeout) — retryable only for read-only methods
  | "FF_E_MALFORMED" // response body is not the documented {code,msg,data} envelope
  | "FF_E_STATE" // caller input or an observed order status is outside the documented law
  | "FF_E_POLL_TIMEOUT" // bounded polling exhausted without meeting the accept predicate
  | "FF_E_VAULT_MISSING" // custody vault file absent (path resolution order named in the message)
  | "FF_E_VAULT_PERMS" // custody vault file permissions breach (actual mode named)
  | "FF_E_VAULT_CORRUPT" // custody vault content violates the documented schema
  | "FF_E_VAULT_ENVELOPE"; // AES-256-GCM envelope open failed (master key / tamper)

export class FixedFloatError extends Error {
  readonly code: FixedFloatErrorCode;

  constructor(code: FixedFloatErrorCode, message: string) {
    super(message);
    this.name = "FixedFloatError";
    this.code = code;
  }
}
