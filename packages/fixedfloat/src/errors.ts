/**
 * Saosmartwallet packages/fixedfloat — error taxonomy
 * ===================================================
 * One error type, five kinds, redaction enforced AT CONSTRUCTION: the
 * redactor runs over every message before it escapes, so no credential can
 * ever ride out through an error path even if a transport echoes headers
 * back into a message.
 *
 *   CONFIG  — credential custody refusal (fail-closed, nothing sent)
 *   VALIDATE— local input refusal (fail-closed, zero wire calls)
 *   NETWORK — transport-level failure (non-2xx status, measured: the
 *             sandbox-facing Cloudflare 403 IP class lives here)
 *   PARSE   — response was not the documented JSON envelope
 *   API     — the documented envelope with code ≠ 0 (API-level refusal)
 */

/** The shape the redactor needs — the caller's custody pair. */
export interface RedactionSecrets {
  apiKey: string;
  apiSecret: string;
}

export type FixedFloatErrorKind = "CONFIG" | "VALIDATE" | "NETWORK" | "PARSE" | "API";

/** Replaced here to keep errors.ts dependency-free (config.ts re-exports). */
export function redactText(text: string, secrets: RedactionSecrets | null): string {
  if (secrets === null) return text;
  let out = text;
  // Pass 1 — FULL values (both credentials), until no occurrence remains.
  // Full strips must ALL precede any suffix work: a suffix pass on credential
  // A could otherwise corrupt an occurrence of credential B and defeat its
  // full strip (measured: shared suffix "89abcdef" in the fixture pair).
  for (const [value, label] of [
    [secrets.apiKey, "[REDACTED:key]"],
    [secrets.apiSecret, "[REDACTED:secret]"],
  ] as const) {
    if (value.length >= 8) {
      while (out.includes(value)) out = out.replace(value, label);
    }
  }
  // Pass 2 — partial (suffix) leaks, LONGEST first, re-scanning the whole
  // text per length; fail-safe over fail-open.
  for (const value of [secrets.apiKey, secrets.apiSecret]) {
    if (value.length < 8) continue;
    for (let len = value.length - 8; len >= 8; len -= 8) {
      const suffix = value.slice(value.length - len);
      while (out.includes(suffix)) out = out.split(suffix).join("[REDACTED:partial]");
    }
    const min8 = value.slice(value.length - 8);
    while (out.includes(min8)) out = out.split(min8).join("[REDACTED:partial]");
  }
  return out;
}

export class FixedFloatError extends Error {
  readonly kind: FixedFloatErrorKind;
  /** API envelope code when kind === "API". */
  readonly apiCode?: number;
  /** HTTP status when kind === "NETWORK". */
  readonly httpStatus?: number;

  constructor(
    kind: FixedFloatErrorKind,
    message: string,
    opts: { apiCode?: number; httpStatus?: number; secrets?: RedactionSecrets } = {},
  ) {
    super(redactText(message, opts.secrets ?? null));
    this.name = "FixedFloatError";
    this.kind = kind;
    this.apiCode = opts.apiCode;
    this.httpStatus = opts.httpStatus;
  }
}
