/**
 * packages/hsm-runtime — signed receipts with wire digests
 * =========================================================
 * Every signing act produces a receipt: a canonical, hash-chained-to-itself
 * JSON record. receiptId = sha256(canonicalJson(body-without-id)). The
 * receipt carries PUBLIC wire artifacts only (digest hex, signature hex, wire
 * hex, wire sha256, tx id) and the SIGN-ONLY posture — never key material,
 * never the token, never vault contents.
 */

import { createHash } from "node:crypto";

import { BROADCAST, MODE, SERVICE_NAME } from "./config";

export interface ReceiptPolicy {
  /** Always false — structural, not a flag. There is no broadcast endpoint. */
  broadcast: false;
  /** Authority role the key declared (from vault meta), when known. */
  role?: string;
  /** Account the key declared (from vault meta), when known. */
  account?: string;
}

export interface SignReceipt {
  /** sha256 over canonicalJson of the receipt body (without this field). */
  receiptId: string;
  at: string;
  service: typeof SERVICE_NAME;
  mode: typeof MODE;
  broadcast: typeof BROADCAST;
  /** "steem-family" | "ed25519". */
  kind: string;
  /** Chain label for steem-family receipts. */
  chain?: string;
  /** Vault key id (metadata only — never material). */
  keyId: string;
  /** Vault key type. */
  keyType: string;
  /** Hex of the exact 32-byte digest the signature commits to. */
  digest: string;
  /** Chain transaction id (steem-family only): sha256(serialized_tx)[:20]. */
  txId?: string;
  /** Hex of the full signed wire form (steem-family: digest ‖ sigs). */
  wireHex?: string;
  /** sha256 over the full wire bytes (ed25519: message ‖ signature). */
  wireSha256: string;
  /** 65-byte steem-family compact signatures, hex. */
  wireSignatures?: string[];
  /** 64-byte ed25519 signature, hex. */
  signatureHex?: string;
  signatureCount: number;
  policy: ReceiptPolicy;
}

export type ReceiptBody = Omit<SignReceipt, "receiptId">;

/** sha256 hex over arbitrary bytes. */
export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Deterministic JSON: object keys sorted recursively, arrays in order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
  return `{${parts.join(",")}}`;
}

/** Seals a receipt body with its self-describing receiptId. */
export function finalizeReceipt(body: ReceiptBody): SignReceipt {
  const canonical = canonicalJson(body);
  const receiptId = sha256Hex(Buffer.from(canonical, "utf8"));
  return { ...body, receiptId };
}

export function newReceiptBody(at: string): ReceiptBody {
  return {
    at,
    service: SERVICE_NAME,
    mode: MODE,
    broadcast: BROADCAST,
    kind: "",
    keyId: "",
    keyType: "",
    digest: "",
    wireSha256: "",
    signatureCount: 0,
    policy: { broadcast: false },
  };
}
