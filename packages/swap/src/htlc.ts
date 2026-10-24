/**
 * Saosmartwallet — pure HTLC core (packages/swap, agent-9 wallet-htlc-swap-engine)
 * ================================================================================
 * The chain-agnostic hash-time-lock state machine at the heart of the wallet's
 * atomic-swap surface (MASTER DIRECTIVE §3: production-grade Atomic Swap and
 * HTLC interfaces inside Saosmartwallet — ETH, SOL, HIVE, STEEM — without
 * centralized exchanges).
 *
 * Doctrine (matches the fleet's landed laws):
 *   • FAIL-CLOSED — every input is validated before any state change; unknown
 *     or malformed anything refuses (the BLURT chain-id lesson, generalized:
 *     never guess, never default).
 *   • IMMUTABLE RECORDS — claim/refund return NEW records; the caller's record
 *     is never mutated, so a stale reference can never lie about state.
 *   • ZERO WALL-CLOCK — every function takes `now` (unix seconds). Same inputs
 *     ⇒ same outputs ⇒ same receipt hashes (the fleet hash-chain law).
 *   • RECEIPT CHAIN — every state change emits a sha256-linked event
 *     (seq, prevHash → hash) verified by verifyReceiptChain; tampering any
 *     byte breaks the chain at its index.
 *   • NO KEY MATERIAL — preimages are caller-owned bytes; the core stores only
 *     the PUBLIC hashlock (sha256 binding) and validates reveals by digest
 *     comparison. Error messages carry generic codes, never preimage bytes.
 *
 * Canonical wire anchoring: expiries are bounded by the graphene u32
 * unix-seconds field the chains packer uses, so a lock made here can always
 * be expressed on a graphene leg. sha256 is anchored by the RFC 6234 vector
 * in the test suite (byte-array form — no hex-string entropy in the tree).
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Errors (generic codes — never preimage/hashlock bytes)
// ---------------------------------------------------------------------------

export class HtlcError extends Error {}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HtlcTerms {
  /** Caller-chosen lock id (≤ 64 chars). Convention: "<swapId>:<leg>". */
  id: string;
  /** The PUBLIC binding: sha256(preimage), exactly 32 bytes. */
  hashlock: Uint8Array;
  /** The party whose funds are locked; only they may refund. */
  issuer: string;
  /** The party who may claim by revealing the preimage. */
  beneficiary: string;
  /** Opaque canonical quantity string (e.g. "10.000 STEEM") — conserved, never interpreted here. */
  amount: string;
}

export interface HtlcRecord {
  terms: HtlcTerms;
  /** Unix seconds (u32-bounded) when the refund window opens. */
  expiresAt: number;
  status: "active" | "claimed" | "refunded";
  claimedAt?: number;
  claimedBy?: string;
  refundedAt?: number;
  refundedBy?: string;
}

export type HtlcEventKind = "create" | "claim" | "refund";

export interface HtlcEvent {
  kind: HtlcEventKind;
  htlcId: string;
  at: number;
  detail: Record<string, string>;
}

export interface HtlcReceipt extends HtlcEvent {
  seq: number;
  prevHash: string;
  /** sha256 over the canonical JSON of {seq, prevHash, kind, htlcId, at, detail}. */
  hash: string;
}

// ---------------------------------------------------------------------------
// Laws (constants)
// ---------------------------------------------------------------------------

/** Minimum preimage length — a reveal must have real entropy (fail-closed). */
export const HTLC_PREIMAGE_MIN = 16;
/** Maximum preimage length — bounded wire evidence (graphene strings ≤ 8k anyway). */
export const HTLC_PREIMAGE_MAX = 1024;
/** prevHash of the first receipt in any chain. */
export const HTLC_GENESIS_PREV_HASH = "0".repeat(64);
/** Maximum lock id length. */
const HTLC_ID_MAX = 64;
/** Maximum unix seconds (u32) — the graphene time_point_sec field. */
const U32_SECONDS_MAX = 0xffffffff;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** The swap binding hash — sha256 over exactly the given bytes. */
export function sha256Bytes(b: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(b).digest());
}

/** Canonical JSON: recursively sorted keys, zero whitespace — the digest domain. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

/**
 * The receipt hash covers EXACTLY the canonical six fields (seq, prevHash,
 * kind, htlcId, at, detail) — never the hash field itself, never extra
 * metadata. Append-time and verify-time therefore compute over identical
 * inputs by construction.
 */
function receiptHash(r: { seq: number; prevHash: string; kind: HtlcEventKind; htlcId: string; at: number; detail: Record<string, string> }): string {
  return Buffer.from(
    sha256Bytes(
      new TextEncoder().encode(
        canonicalJson({ seq: r.seq, prevHash: r.prevHash, kind: r.kind, htlcId: r.htlcId, at: r.at, detail: r.detail }),
      ),
    ),
  ).toString("hex");
}

/**
 * Appends an event to the receipt chain, computing seq/prevHash/hash.
 * Mutates the chain (single-writer ledger pattern) and returns the receipt.
 */
export function appendLedgerEvent(chain: HtlcReceipt[], ev: HtlcEvent): HtlcReceipt {
  const prevHash = chain.length === 0 ? HTLC_GENESIS_PREV_HASH : chain[chain.length - 1].hash;
  const hash = receiptHash({ seq: chain.length, prevHash, kind: ev.kind, htlcId: ev.htlcId, at: ev.at, detail: ev.detail });
  const sealed: HtlcReceipt = { seq: chain.length, prevHash, kind: ev.kind, htlcId: ev.htlcId, at: ev.at, detail: ev.detail, hash };
  chain.push(sealed);
  return sealed;
}

/** Verifies the chain's hash-links; reports the first broken index. */
export function verifyReceiptChain(chain: HtlcReceipt[]): { ok: boolean; brokenAt?: number; length: number } {
  for (let i = 0; i < chain.length; i++) {
    const r = chain[i];
    const expectedPrev = i === 0 ? HTLC_GENESIS_PREV_HASH : chain[i - 1].hash;
    if (r.seq !== i || r.prevHash !== expectedPrev || r.hash !== receiptHash(r)) {
      return { ok: false, brokenAt: i, length: chain.length };
    }
  }
  return { ok: true, length: chain.length };
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

function requireValidTerms(terms: HtlcTerms): void {
  if (typeof terms.id !== "string" || terms.id.length === 0 || terms.id.length > HTLC_ID_MAX) {
    throw new HtlcError(`htlc id must be a non-empty string of at most ${HTLC_ID_MAX} chars`);
  }
  if (!(terms.hashlock instanceof Uint8Array) || terms.hashlock.length !== 32) {
    throw new HtlcError("hashlock must be exactly 32 bytes");
  }
  if (typeof terms.issuer !== "string" || terms.issuer.length === 0) {
    throw new HtlcError("issuer must be a non-empty string");
  }
  if (typeof terms.beneficiary !== "string" || terms.beneficiary.length === 0) {
    throw new HtlcError("beneficiary must be a non-empty string");
  }
  if (terms.issuer === terms.beneficiary) {
    throw new HtlcError("issuer and beneficiary must differ");
  }
  if (typeof terms.amount !== "string" || terms.amount.length === 0) {
    throw new HtlcError("amount must be a non-empty string");
  }
}

/**
 * Creates an active HTLC record. Fail-closed on: bad id/hashlock/parties/
 * amount, non-positive duration, and expiries that would overflow the
 * graphene u32 unix-seconds field.
 */
export function createHtlc(
  terms: HtlcTerms,
  opts: { now: number; durationSeconds: number },
): { record: HtlcRecord; event: HtlcEvent } {
  requireValidTerms(terms);
  if (!Number.isFinite(opts.now) || !Number.isInteger(opts.now) || opts.now < 0) {
    throw new HtlcError("now must be a non-negative integer unix timestamp");
  }
  if (!Number.isFinite(opts.durationSeconds) || !Number.isInteger(opts.durationSeconds) || opts.durationSeconds <= 0) {
    throw new HtlcError("durationSeconds must be a positive integer");
  }
  const expiresAt = opts.now + opts.durationSeconds;
  if (expiresAt > U32_SECONDS_MAX) {
    throw new HtlcError("expiry overflows the graphene u32 unix-seconds field");
  }
  const record: HtlcRecord = { terms: { ...terms, hashlock: new Uint8Array(terms.hashlock) }, expiresAt, status: "active" };
  const event: HtlcEvent = {
    kind: "create",
    htlcId: terms.id,
    at: opts.now,
    detail: {
      issuer: terms.issuer,
      beneficiary: terms.beneficiary,
      amount: terms.amount,
      expiresAt: String(expiresAt),
      hashlock: Buffer.from(terms.hashlock).toString("hex"),
    },
  };
  return { record, event };
}

function requireActive(record: HtlcRecord): void {
  if (record.status !== "active") {
    throw new HtlcError(`htlc ${record.terms.id} is ${record.status} — terminal records cannot transition`);
  }
}

/**
 * Claim law: beneficiary-only, true-preimage-only, strictly before expiry
 * (the refund window opens AT expiry, exclusive to claims), once only.
 */
export function claimHtlc(
  record: HtlcRecord,
  opts: { now: number; party: string; preimage: Uint8Array },
): { record: HtlcRecord; event: HtlcEvent } {
  requireActive(record);
  if (!Number.isInteger(opts.now) || opts.now < 0) {
    throw new HtlcError("now must be a non-negative integer unix timestamp");
  }
  if (opts.party !== record.terms.beneficiary) {
    throw new HtlcError("claim refused: only the beneficiary may claim");
  }
  if (opts.now >= record.expiresAt) {
    throw new HtlcError("claim refused: the refund window is open (claim expired)");
  }
  if (!(opts.preimage instanceof Uint8Array)) {
    throw new HtlcError("preimage must be bytes");
  }
  if (opts.preimage.length < HTLC_PREIMAGE_MIN || opts.preimage.length > HTLC_PREIMAGE_MAX) {
    throw new HtlcError(`preimage must be ${HTLC_PREIMAGE_MIN}..${HTLC_PREIMAGE_MAX} bytes`);
  }
  const digest = sha256Bytes(opts.preimage);
  for (let i = 0; i < 32; i++) {
    if (digest[i] !== record.terms.hashlock[i]) {
      throw new HtlcError("claim refused: preimage does not satisfy the hashlock");
    }
  }
  const next: HtlcRecord = { ...record, status: "claimed", claimedAt: opts.now, claimedBy: opts.party };
  const event: HtlcEvent = {
    kind: "claim",
    htlcId: record.terms.id,
    at: opts.now,
    detail: { claimedBy: opts.party, preimage: Buffer.from(opts.preimage).toString("hex") },
  };
  return { record: next, event };
}

/**
 * Refund law: issuer-only, at/after expiry only (before that the lock holds —
 * fail-closed), once only.
 */
export function refundHtlc(record: HtlcRecord, opts: { now: number; party: string }): { record: HtlcRecord; event: HtlcEvent } {
  requireActive(record);
  if (!Number.isInteger(opts.now) || opts.now < 0) {
    throw new HtlcError("now must be a non-negative integer unix timestamp");
  }
  if (opts.party !== record.terms.issuer) {
    throw new HtlcError("refund refused: only the issuer may refund");
  }
  if (opts.now < record.expiresAt) {
    throw new HtlcError("refund refused: the lock has not expired");
  }
  const next: HtlcRecord = { ...record, status: "refunded", refundedAt: opts.now, refundedBy: opts.party };
  const event: HtlcEvent = {
    kind: "refund",
    htlcId: record.terms.id,
    at: opts.now,
    detail: { refundedBy: opts.party },
  };
  return { record: next, event };
}

/** Honest derived view: expired is a FACT of time, never a mutation. */
export function htlcStateAt(record: HtlcRecord, now: number): { expired: boolean; status: HtlcRecord["status"] } {
  if (!Number.isInteger(now) || now < 0) {
    throw new HtlcError("now must be a non-negative integer unix timestamp");
  }
  return { expired: now >= record.expiresAt, status: record.status };
}
