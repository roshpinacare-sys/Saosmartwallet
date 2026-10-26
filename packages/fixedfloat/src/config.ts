/**
 * Saosmartwallet packages/fixedfloat — credential custody (fail-closed)
 * =====================================================================
 * The owner supplied a LIVE production keypair (upload fffixedflot.txt,
 * 2026-10-25) — custody lives OUTSIDE the tree, in the runtime secret store
 * (`/home/z/.secrets/fixedfloat.env`, vault-sealed into giant's economy
 * lane). This module:
 *
 *   • loads the pair from the documented env names, refusing (throw, kind
 *     CONFIG) on missing / empty / whitespace values — no placeholder, no
 *     default, no degraded mode;
 *   • exposes a printable fingerprint that reveals NEITHER credential
 *     (sha256 prefix of the key only);
 *   • provides redact() so every downstream error/log path can strip the
 *     credentials from any text before it escapes.
 */

import { createHash } from "node:crypto";

import { FixedFloatError, redactText, type RedactionSecrets } from "./errors";

export { FixedFloatError, redactText };
export type { RedactionSecrets };

export interface FixedFloatConfigEnv {
  FIXEDFLOAT_API_KEY?: string;
  FIXEDFLOAT_API_SECRET?: string;
  FIXEDFLOAT_KEY?: string;
  FIXEDFLOAT_SECRET?: string;
}

export class FixedFloatConfig {
  readonly apiKey: string;
  readonly apiSecret: string;

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  /** Printable fingerprint — deterministic, credential-free. */
  fingerprint(): string {
    const digest = createHash("sha256").update(this.apiKey, "utf8").digest("hex");
    return `key:sha256:${digest.slice(0, 12)}…`;
  }

  /** The redaction view handed to error/log paths. */
  secrets(): RedactionSecrets {
    return { apiKey: this.apiKey, apiSecret: this.apiSecret };
  }
}

export type FixedFloatConfigObject = FixedFloatConfig;

function clean(v: string | undefined): string | null {
  if (typeof v !== "string") return null;
  if (v.length === 0) return null;
  if (v.trim().length === 0) return null;
  return v;
}

/**
 * Load the custody pair from env — fail-closed. Refusals name the missing
 * env var(s) and never echo any value.
 */
export function loadFixedFloatConfig(env: FixedFloatConfigEnv): FixedFloatConfigObject {
  const apiKey = clean(env.FIXEDFLOAT_API_KEY) ?? clean(env.FIXEDFLOAT_KEY);
  const apiSecret = clean(env.FIXEDFLOAT_API_SECRET) ?? clean(env.FIXEDFLOAT_SECRET);
  const missing: string[] = [];
  if (apiKey === null) missing.push("FIXEDFLOAT_API_KEY");
  if (apiSecret === null) missing.push("FIXEDFLOAT_API_SECRET");
  if (missing.length > 0) {
    throw new FixedFloatError(
      "CONFIG",
      `fixedfloat: credential custody refusal — missing env ${missing.join(", ")}` +
        ` (custody file: /home/z/.secrets/fixedfloat.env — never commit the values)`,
    );
  }
  return Object.freeze(new FixedFloatConfig(apiKey!, apiSecret!));
}

/** Strip every occurrence of the credentials (full values and ≥8-char secret suffixes). */
export function redact(text: string, secrets: RedactionSecrets): string {
  return redactText(text, secrets);
}

/** Convenience: redact against a loaded config. */
export function redactAgainst(text: string, cfg: FixedFloatConfigObject): string {
  return redactText(text, cfg.secrets());
}
