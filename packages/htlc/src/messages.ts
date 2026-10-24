/**
 * Saosmartwallet — SAOS-HTLC/1 canonical codec + receipt hash-chain
 * =================================================================
 * The wire format of an atomic swap, deterministic at the BYTE level:
 *
 *   • canonicalize() — sorted-key, recursively-normalized JSON. Two logically
 *     equal messages encode to identical bytes regardless of key insertion
 *     order. Floats, NaN/Infinity, undefined, functions, bigints and
 *     non-plain objects are REFUSED (they have no deterministic cross-run
 *     encoding — amounts travel as decimal strings, timestamps as integers).
 *
 *   • Messages — a strict, versioned schema. Decoding validates the exact
 *     key set (unknown fields refuse, forward-compat is a protocol bump):
 *
 *       Offer { kind:"offer", protocol:"SAOS-HTLC/1", swapId, initiator,
 *               redeemer, assetGive, assetWant, amountGive, hashSecret,
 *               timelocks }
 *       Lock  { kind:"lock",  swapId }        (initiator's funding proof)
 *       Claim { kind:"claim", swapId, secret } (secret = 64 hex chars)
 *       Refund{ kind:"refund", swapId }
 *
 *   • Receipts — sha256-chained records (the fleet hash-chain law):
 *       hash(record_i) = sha256(canonical({seq, kind, at, swapId, payload,
 *                                          result, prev}))
 *       record_0.prev = GENESIS_PREV ("0"×64); record_i.prev = record_{i-1}.hash
 *     verifyChain() recomputes every hash and returns false on ANY tamper —
 *     it never throws on content, so callers can feed it arbitrary bytes.
 */

import { createHash } from "node:crypto";

import { HtlcError } from "./errors";
import { createTimelocks, type Timelocks } from "./timelock";

/** The protocol version string pinned into every Offer. */
export const PROTOCOL = "SAOS-HTLC/1";

/** prev-pointer of the genesis receipt record. */
export const GENESIS_PREV = "0".repeat(64);

// ---------------------------------------------------------------------------
// message types
// ---------------------------------------------------------------------------

/** A chain asset, addressed by chain id + symbol (adapter-validated). */
export interface Asset {
  chain: string;
  symbol: string;
}

/** The swap offer — the full contract terms, hash-locked. */
export interface Offer {
  kind: "offer";
  protocol: typeof PROTOCOL;
  swapId: string;
  initiator: string;
  redeemer: string;
  assetGive: Asset;
  assetWant: Asset;
  /** Decimal string (chain precision) — never a float. */
  amountGive: string;
  /** sha256 of the secret, 64 lowercase hex chars. */
  hashSecret: string;
  timelocks: Timelocks;
}

/** The initiator's funding proof (initiator locked assetGive on its chain). */
export interface Lock {
  kind: "lock";
  swapId: string;
}

/** The redeemer's claim — carries the preimage that unlocks both chains. */
export interface Claim {
  kind: "claim";
  swapId: string;
  /** The secret preimage, 64 hex chars (case-normalized to lowercase). */
  secret: string;
}

/** The initiator's refund after the claim window closed. */
export interface Refund {
  kind: "refund";
  swapId: string;
}

export type HtlcMessage = Offer | Lock | Claim | Refund;

/** Lifecycle names shared with the state machine (single source of truth). */
export type SwapStateName = "Initiated" | "Locked" | "Redeemed" | "Refunded";

// ---------------------------------------------------------------------------
// receipts — sha256-chained records (fleet hash-chain law)
// ---------------------------------------------------------------------------

export interface ReceiptRecord {
  /** Position in the chain, 0-based, contiguous. */
  seq: number;
  kind: "offer" | "lock" | "claim" | "refund";
  /** Clock value (epoch ms) when the record was appended. */
  at: number;
  swapId: string;
  /** The canonical message (or offer) this record attests. */
  payload: HtlcMessage;
  /** The swap state AFTER the payload was applied. */
  result: SwapStateName;
  /** Parent hash (GENESIS_PREV for seq 0). */
  prev: string;
  /** sha256 over the canonical form of every field above. */
  hash: string;
}

/** Everything but `seq`/`prev`/`hash`, which the chain itself assigns. */
export interface ReceiptInput {
  kind: ReceiptRecord["kind"];
  at: number;
  swapId: string;
  payload: HtlcMessage;
  result: SwapStateName;
}

/** The hash preimage of a record — canonical JSON of all fields but `hash`. */
export type RecordCore = Omit<ReceiptRecord, "hash">;

/** sha256 of the canonical form of a record's core fields. */
export function recordHash(core: RecordCore): string {
  return createHash("sha256")
    .update(
      canonicalBytes({
        seq: core.seq,
        kind: core.kind,
        at: core.at,
        swapId: core.swapId,
        payload: core.payload,
        result: core.result,
        prev: core.prev,
      }),
    )
    .digest("hex");
}

/**
 * Appends a record to the chain: assigns seq (chain length), prev (parent
 * hash or GENESIS_PREV) and hash. Refuses (HTLC_E_BAD_INPUT) if the incoming
 * chain is not a contiguous 0-based sequence — a broken chain can never be
 * silently extended.
 */
export function appendRecord(chain: readonly ReceiptRecord[], input: ReceiptInput): ReceiptRecord {
  assertContiguous(chain);
  const seq = chain.length;
  const prev = seq === 0 ? GENESIS_PREV : chain[seq - 1].hash;
  const core: RecordCore = {
    seq,
    kind: input.kind,
    at: input.at,
    swapId: input.swapId,
    payload: input.payload,
    result: input.result,
    prev,
  };
  return { ...core, hash: recordHash(core) };
}

/**
 * Verifies a receipt chain end-to-end. TOTAL function: returns false on any
 * tamper (payload, seq, prev, hash, shape) — never throws on content.
 */
export function verifyChain(records: readonly unknown[]): boolean {
  if (!Array.isArray(records)) return false;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r === null || typeof r !== "object" || Array.isArray(r)) return false;
    const rec = r as Partial<ReceiptRecord>;
    if (typeof rec.seq !== "number" || !Number.isSafeInteger(rec.seq) || rec.seq !== i) return false;
    if (rec.kind !== "offer" && rec.kind !== "lock" && rec.kind !== "claim" && rec.kind !== "refund") return false;
    if (typeof rec.at !== "number" || !Number.isSafeInteger(rec.at)) return false;
    if (typeof rec.swapId !== "string" || rec.swapId.length === 0) return false;
    if (rec.result !== "Initiated" && rec.result !== "Locked" && rec.result !== "Redeemed" && rec.result !== "Refunded")
      return false;
    if (typeof rec.prev !== "string" || !/^[0-9a-f]{64}$/.test(rec.prev)) return false;
    if (i === 0) {
      if (rec.prev !== GENESIS_PREV) return false;
    } else if (rec.prev !== (records[i - 1] as ReceiptRecord).hash) {
      return false;
    }
    // payload must be a well-formed protocol message
    try {
      decodeMessage(encodeMessage(rec.payload as HtlcMessage));
    } catch {
      return false;
    }
    if (typeof rec.hash !== "string" || !/^[0-9a-f]{64}$/.test(rec.hash)) return false;
    try {
      if (recordHash(rec as RecordCore) !== rec.hash) return false;
    } catch {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// canonical JSON
// ---------------------------------------------------------------------------

/**
 * Deterministic JSON: object keys sorted recursively (code-unit order),
 * arrays in order, only JSON-native values. Refuses anything without a
 * deterministic encoding (HTLC_E_BAD_INPUT).
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(canonicalNode(value, "$"));
}

/** canonicalize() as UTF-8 bytes — the input to every hash in this package. */
export function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(canonicalize(value), "utf8");
}

function canonicalNode(value: unknown, at: string): unknown {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      if (!Number.isFinite(value)) {
        throw new HtlcError("HTLC_E_BAD_INPUT", `canonical JSON refuses non-finite number at ${at}`);
      }
      return value;
    case "object":
      break; // handled below
    default:
      throw new HtlcError("HTLC_E_BAD_INPUT", `canonical JSON refuses value of type ${typeof value} at ${at}`);
  }
  if (Array.isArray(value)) return value.map((v, i) => canonicalNode(v, `${at}[${i}]`));
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new HtlcError("HTLC_E_BAD_INPUT", `canonical JSON refuses non-plain object at ${at}`);
  }
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    const v = source[key];
    if (v === undefined) {
      throw new HtlcError("HTLC_E_BAD_INPUT", `canonical JSON refuses undefined value at ${at}.${key}`);
    }
    out[key] = canonicalNode(v, `${at}.${key}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// builders (= validators) — the only sanctioned way to produce messages
// ---------------------------------------------------------------------------

/** Input of makeOffer — everything but `kind`, which the builder pins. */
export type OfferInput = Omit<Offer, "kind" | "protocol">;

/** Builds a canonical Offer; fails closed on any invalid field. */
export function makeOffer(input: OfferInput): Offer {
  return validateOffer({
    kind: "offer",
    protocol: PROTOCOL,
    swapId: input.swapId,
    initiator: input.initiator,
    redeemer: input.redeemer,
    assetGive: input.assetGive,
    assetWant: input.assetWant,
    amountGive: input.amountGive,
    hashSecret: input.hashSecret,
    timelocks: input.timelocks,
  });
}

export function makeLock(swapId: string): Lock {
  return validateLock({ kind: "lock", swapId });
}

export function makeClaim(swapId: string, secret: string): Claim {
  return validateClaim({ kind: "claim", swapId, secret });
}

export function makeRefund(swapId: string): Refund {
  return validateRefund({ kind: "refund", swapId });
}

// ---------------------------------------------------------------------------
// validation (shared by builders, decode, machine, session, adapter)
// ---------------------------------------------------------------------------

const HEX64 = /^[0-9a-f]{64}$/;
const ID_RE = /^[^\s]{1,512}$/;
const AMOUNT_RE = /^[0-9]{1,78}(\.[0-9]{1,18})?$/;
const OFFER_KEYS = [
  "amountGive",
  "assetGive",
  "assetWant",
  "hashSecret",
  "initiator",
  "kind",
  "protocol",
  "redeemer",
  "swapId",
  "timelocks",
].sort();
const LOCK_KEYS = ["kind", "swapId"].sort();
const CLAIM_KEYS = ["kind", "secret", "swapId"].sort();
const REFUND_KEYS = ["kind", "swapId"].sort();

/** Validates a wire-shaped Offer (strict key set, all invariants). */
export function validateOffer(value: unknown): Offer {
  requireKeys(value, OFFER_KEYS, "offer");
  const raw = value as Record<string, unknown>;
  if (raw.kind !== "offer") throw badMessage(`offer kind must be "offer"`);
  if (raw.protocol !== PROTOCOL) {
    throw badMessage(`offer protocol must be "${PROTOCOL}"`);
  }
  const swapId = requireId(raw.swapId, "swapId");
  const initiator = requireId(raw.initiator, "initiator");
  const redeemer = requireId(raw.redeemer, "redeemer");
  if (initiator === redeemer) {
    throw badMessage("initiator and redeemer must be different parties (self-swap refused)");
  }
  return {
    kind: "offer",
    protocol: PROTOCOL,
    swapId,
    initiator,
    redeemer,
    assetGive: requireAsset(raw.assetGive, "assetGive"),
    assetWant: requireAsset(raw.assetWant, "assetWant"),
    amountGive: requireAmount(raw.amountGive),
    hashSecret: requireHex64(raw.hashSecret, "hashSecret"),
    timelocks: requireTimelocks(raw.timelocks),
  };
}

export function validateLock(value: unknown): Lock {
  requireKeys(value, LOCK_KEYS, "lock");
  const raw = value as Record<string, unknown>;
  if (raw.kind !== "lock") throw badMessage(`lock kind must be "lock"`);
  return { kind: "lock", swapId: requireId(raw.swapId, "swapId") };
}

export function validateClaim(value: unknown): Claim {
  requireKeys(value, CLAIM_KEYS, "claim");
  const raw = value as Record<string, unknown>;
  if (raw.kind !== "claim") throw badMessage(`claim kind must be "claim"`);
  return { kind: "claim", swapId: requireId(raw.swapId, "swapId"), secret: requireHex64(raw.secret, "secret") };
}

export function validateRefund(value: unknown): Refund {
  requireKeys(value, REFUND_KEYS, "refund");
  const raw = value as Record<string, unknown>;
  if (raw.kind !== "refund") throw badMessage(`refund kind must be "refund"`);
  return { kind: "refund", swapId: requireId(raw.swapId, "swapId") };
}

// ---------------------------------------------------------------------------
// codec
// ---------------------------------------------------------------------------

/** Canonical wire bytes of a message (key order in the input is irrelevant). */
export function encodeMessage(message: HtlcMessage): string {
  return canonicalize(message);
}

/** Strict decode: parse + exact schema for the declared kind. Fail-closed. */
export function decodeMessage(json: string): HtlcMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw badMessage("message is not valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw badMessage("message must be a JSON object");
  }
  switch ((parsed as Record<string, unknown>).kind) {
    case "offer":
      return validateOffer(parsed);
    case "lock":
      return validateLock(parsed);
    case "claim":
      return validateClaim(parsed);
    case "refund":
      return validateRefund(parsed);
    default:
      throw badMessage(`unknown message kind "${String((parsed as Record<string, unknown>).kind)}"`);
  }
}

// ---------------------------------------------------------------------------
// internal validation helpers
// ---------------------------------------------------------------------------

function badMessage(detail: string): HtlcError {
  return new HtlcError("HTLC_E_BAD_MESSAGE", `SAOS-HTLC/1 message refused: ${detail}`);
}

/** Strict exact-key-set check — unknown or missing fields refuse. */
function requireKeys(value: unknown, expected: string[], what: string): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw badMessage(`${what} must be a JSON object`);
  }
  const actual = Object.keys(value as Record<string, unknown>).sort();
  if (actual.length !== expected.length || actual.some((k, i) => k !== expected[i])) {
    throw badMessage(`${what} has an invalid field set (strict schema — no missing, no extra fields)`);
  }
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== "string" || !ID_RE.test(value)) {
    throw badMessage(`${field} must be a non-empty string of 1..512 non-whitespace chars`);
  }
  return value;
}

function requireHex64(value: unknown, field: string): string {
  if (typeof value !== "string" || !HEX64.test(value)) {
    throw badMessage(`${field} must be exactly 64 lowercase-or-uppercase hex chars`);
  }
  return value.toLowerCase();
}

function requireAmount(value: unknown): string {
  if (typeof value !== "string" || !AMOUNT_RE.test(value)) {
    throw badMessage("amountGive must be a positive decimal string (≤78 digits, ≤18 fraction), never a float");
  }
  if (!/[1-9]/.test(value.replace(".", ""))) {
    throw badMessage("amountGive must be greater than zero");
  }
  return value;
}

function requireAsset(value: unknown, field: string): Asset {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw badMessage(`${field} must be an object { chain, symbol }`);
  }
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).sort().join(",") !== "chain,symbol") {
    throw badMessage(`${field} must have exactly the fields { chain, symbol }`);
  }
  if (typeof raw.chain !== "string" || !ID_RE.test(raw.chain)) {
    throw badMessage(`${field}.chain must be a non-empty string of 1..512 non-whitespace chars`);
  }
  if (typeof raw.symbol !== "string" || !ID_RE.test(raw.symbol)) {
    throw badMessage(`${field}.symbol must be a non-empty string of 1..512 non-whitespace chars`);
  }
  return { chain: raw.chain, symbol: raw.symbol };
}

function requireTimelocks(value: unknown): Timelocks {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw badMessage("timelocks must be an object");
  }
  const raw = value as Record<string, unknown>;
  const keys = Object.keys(raw).sort();
  const valid = keys.join(",") === "initiatorRefundAt,redeemerClaimAt" || keys.join(",") === "fundedAt,initiatorRefundAt,redeemerClaimAt";
  if (!valid) {
    throw badMessage("timelocks must have exactly { redeemerClaimAt, initiatorRefundAt } (+ optional fundedAt)");
  }
  if (typeof raw.redeemerClaimAt !== "number" || typeof raw.initiatorRefundAt !== "number") {
    throw badMessage("timelock deadlines must be numbers (epoch ms)");
  }
  if (raw.fundedAt !== undefined && typeof raw.fundedAt !== "number") {
    throw badMessage("timelocks.fundedAt must be a number (epoch ms)");
  }
  // Margin violations surface as HTLC_E_TIMELOCK_MARGIN (genesis law) —
  // shape problems surface as HTLC_E_BAD_MESSAGE (schema law).
  return createTimelocks(raw.initiatorRefundAt, raw.redeemerClaimAt, raw.fundedAt);
}

function assertContiguous(chain: readonly ReceiptRecord[]): void {
  for (let i = 0; i < chain.length; i++) {
    const r = chain[i];
    if (r === null || typeof r !== "object" || (r as Partial<ReceiptRecord>).seq !== i) {
      throw new HtlcError(
        "HTLC_E_BAD_INPUT",
        `receipt chain is not contiguous at position ${i} — refusing to append (fail-closed)`,
      );
    }
  }
}
