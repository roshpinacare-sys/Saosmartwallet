/**
 * Saosmartwallet — Sovereign Key Vault byte/encoding helpers (M2)
 * ===============================================================
 * The ONLY place core touches encodings. Everything travels as base64 or hex
 * strings across JSON boundaries; these helpers are the edge converters.
 * Canonical JSON (sorted keys) is what audit hashes bind to.
 */

/** UTF-8 encode. */
export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** UTF-8 decode. */
export function fromUtf8(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

export function bytesToB64(b: Uint8Array): string {
  return Buffer.from(b).toString("base64");
}

export function b64ToBytes(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64"));
}

export function bytesToHex(b: Uint8Array): string {
  return Buffer.from(b).toString("hex");
}

export function hexToBytes(s: string): Uint8Array {
  if (s.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(s)) throw new Error("invalid hex");
  return new Uint8Array(Buffer.from(s, "hex"));
}

/** Stable stringify — sorted object keys, arrays in order, no whitespace. */
export function canonicalJson(value: unknown): string {
  return canonicalValue(value, new Set());
}

function canonicalValue(value: unknown, seen: Set<object>): string {
  if (value === null || typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value instanceof Uint8Array) return JSON.stringify(bytesToB64(value));
  if (Array.isArray(value)) {
    if (seen.has(value)) return '"[circular]"';
    seen.add(value);
    const items = value.map((v) => canonicalValue(v, seen));
    seen.delete(value);
    return `[${items.join(",")}]`;
  }
  if (typeof value === "object") {
    if (seen.has(value as object)) return '"[circular]"';
    seen.add(value as object);
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalValue(v, seen)}`);
    seen.delete(value as object);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(String(value));
}

/** Concatenate byte arrays. */
export function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Constant-time equality for byte strings. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Parse a decimal satoshi string into bigint (strict). */
export function parseSats(s: string): bigint {
  if (!/^\d{1,30}$/.test(s)) throw new Error(`invalid satoshi string: "${s}"`);
  return BigInt(s);
}

/** Convert satoshi bigint to a decimal human amount with fixed precision. */
export function satsToAmount(sats: bigint, precision: number): string {
  if (precision < 0 || precision > 18) throw new Error("precision out of range");
  const neg = sats < 0n;
  const abs = neg ? -sats : sats;
  const base = 10n ** BigInt(precision);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(precision, "0");
  return `${neg ? "-" : ""}${whole.toString()}${precision > 0 ? "." + frac : ""}`;
}

/** Convert a decimal human amount string to satoshis with fixed precision. */
export function amountToSats(amount: string, precision: number): bigint {
  const m = /^(-)?(\d+)(?:\.(\d{1,\d+}))?$/.exec(amount.trim());
  if (!m) throw new Error(`invalid amount: "${amount}"`);
  const sign = m[1] ? -1n : 1n;
  const whole = m[2] ?? "0";
  const fracRaw = m[3] ?? "";
  if (fracRaw.length > precision) throw new Error(`amount "${amount}" exceeds ${precision} decimals`);
  const frac = fracRaw.padEnd(precision, "0");
  return sign * BigInt(whole + (precision > 0 ? frac : ""));
}
