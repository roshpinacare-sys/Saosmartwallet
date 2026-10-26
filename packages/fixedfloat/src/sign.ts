/**
 * Saosmartwallet packages/fixedfloat — official v2 request signing (wave G76-b)
 * ===============================================================================
 * Spec provenance (pinned honestly): the OFFICIAL FixedFloat API v2 documentation
 * at https://fixedfloat.com/api (fetched and archived by wave G76-b into the
 * worklog; the deterministic vectors in test/sign.test.ts were computed
 * independently with node:crypto against a DUMMY secret):
 *
 *   • Every request: POST {base}{method} with a UTF-8 JSON body.
 *   • X-API-KEY carries the API key; X-API-SIGN carries the signature.
 *   • Signature = HMAC-SHA256(apiSecret, exactBodyString), lowercase hex —
 *     the openssl convention `echo -n 'DATA_JSON' | openssl dgst -sha256 -hmac SECRET`.
 *   • With no parameters the signature is HMAC over the EMPTY string.
 *   • Content-Type must be exactly "application/json; charset=UTF-8".
 *
 * The canonical string law: we canonicalize payloads ONCE (sorted keys, JSON
 * escaping, no whitespace) and sign that exact string — the string the client
 * sends is the string the signature proves. Deterministic ⇒ identical requests
 * produce identical signatures across runs and across processes.
 *
 * Secret hygiene: these helpers never log, never throw with material in the
 * message, and never embed the secret in any returned structure.
 */

import { createHmac } from "node:crypto";

import { FixedFloatError } from "./errors";

/** The documented Content-Type for every v2 request. */
export const FF_CONTENT_TYPE = "application/json; charset=UTF-8" as const;

/** The empty-string body used by parameter-less requests (signature over ""). */
export const EMPTY_PAYLOAD = "" as const;

/**
 * Deterministic JSON canonicalization: object keys sort lexicographically
 * (recursively), arrays preserve order, `undefined` object values are dropped
 * (JSON semantics), numbers keep their JSON form. Returns the exact string to
 * send AND sign.
 */
export function canonicalPayloadString(payload: unknown): string {
  return serializeValue(payload);
}

function serializeValue(value: unknown): string {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "string") return JSON.stringify(value);
  if (t === "number") {
    if (!Number.isFinite(value as number)) {
      throw new FixedFloatError("FF_E_STATE", "payload contains a non-finite number — refusing to sign it");
    }
    return JSON.stringify(value);
  }
  if (t === "boolean") return (value as boolean) ? "true" : "false";
  if (Array.isArray(value)) {
    const parts = value.map((v) => serializeValue(v));
    return `[${parts.join(",")}]`;
  }
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${serializeValue(obj[k])}`);
    return `{${parts.join(",")}}`;
  }
  throw new FixedFloatError("FF_E_STATE", `payload contains a non-JSON value of type ${t} — refusing to sign it`);
}

/**
 * HMAC-SHA256(apiSecret, exactBodyString) → 64 lowercase hex chars.
 * Fail-closed on non-string inputs (a wrong-typed secret or payload must never
 * silently produce a signature).
 */
export function buildApiSignature(apiSecret: string, payloadString: string): string {
  if (typeof apiSecret !== "string" || apiSecret.length === 0) {
    throw new FixedFloatError("FF_E_STATE", "API secret must be a non-empty string");
  }
  if (typeof payloadString !== "string") {
    throw new FixedFloatError("FF_E_STATE", "payload string must be a string (sign the exact sent body)");
  }
  return createHmac("sha256", apiSecret).update(payloadString, "utf8").digest("hex");
}

/** The exact mandatory header set for one signed v2 request. */
export function buildApiHeaders(apiKey: string, signature: string): Record<string, string> {
  return {
    "Content-Type": FF_CONTENT_TYPE,
    "X-API-KEY": apiKey,
    "X-API-SIGN": signature,
  };
}
