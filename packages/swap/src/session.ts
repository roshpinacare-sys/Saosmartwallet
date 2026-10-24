/**
 * Saosmartwallet — two-party cross-chain swap session (packages/swap, agent-9)
 * ============================================================================
 * The atomic-swap orchestrator that composes the HTLC core into the classic
 * cross-chain pattern, in force on graphene legs (STEEM/BLURT/HIVE) today and
 * expressible on ETH/SOL legs through the same vocabulary:
 *
 *   1. INITIATOR locks legA (chain A, timeout T1) publishing the hashlock.
 *   2. RESPONDER observes legA, locks legB (chain B, timeout T2, T2 < T1)
 *      under the SAME hashlock.
 *   3. INITIATOR claims legB by REVEALING the preimage (before T2).
 *   4. RESPONDER counter-claims legA with the now-public preimage (before T1).
 *
 * Failure honesty: if the responder never locks, the initiator refunds A at
 * T1; if the initiator never claims, the responder refunds B at T2. Funds are
 * never stranded in the model — every path ends claimed or refunded, every
 * step receipt-chained (the fleet hash-chain law), every timestamp injected.
 *
 * Fail-closed laws:
 *   • SAFETY: T1 > T2 — a session where the responder's leg outlives the
 *     initiator's refuses to exist (the responder must always have the
 *     shorter exposure).
 *   • COUNTERPARTY BINDING: legB.initiator === legA.responder AND
 *     legB.responder === legA.initiator — the legs mirror exactly.
 *   • ONE HASHLOCK: both legs bind sha256(preimage); divergence is
 *     structurally impossible (the hashlock is session-owned).
 *   • SEQUENCING: respond-after-initiate, claim-after-lock, and the
 *     counter-claim of A is fail-closed on a PUBLIC REVEAL observed in this
 *     session's history — the responder never acts on private knowledge.
 */

import { randomBytes } from "node:crypto";

import {
  createHtlc,
  claimHtlc,
  refundHtlc,
  sha256Bytes,
  appendLedgerEvent,
  verifyReceiptChain,
  HTLC_PREIMAGE_MIN,
  type HtlcRecord,
  type HtlcReceipt,
} from "./htlc";

// ---------------------------------------------------------------------------
// Errors + types
// ---------------------------------------------------------------------------

export class SwapSessionError extends Error {}

export type SwapPhase =
  | "draft"
  | "legA-committed"
  | "legB-committed"
  | "legB-claimed"
  | "settled"
  | "legA-refunded"
  | "legB-refunded";

export interface SwapLegSpec {
  chain: string;
  asset: string;
  amount: string;
  /** The party whose funds lock on this leg (legA: session initiator; legB: counterparty). */
  initiator: string;
  /** The party who claims on this leg (legA: counterparty; legB: session initiator). */
  responder: string;
  /** Lock duration in seconds (legA: T1 — must strictly exceed legB's T2). */
  timeoutSeconds: number;
}

export interface SwapLegView {
  spec: SwapLegSpec;
  record: HtlcRecord | null;
  /** On-chain evidence of the lock (caller-provided txid at commit). */
  committedTxid: string | null;
}

export interface SwapSessionView {
  swapId: string;
  hashlock: Uint8Array;
  legA: SwapLegView;
  legB: SwapLegView;
  /** Whether a preimage reveal entered THIS session's observed history. */
  preimageRevealed: boolean;
  receipts: HtlcReceipt[];
}

export const SWAP_PREIMAGE_BYTES = 32;

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export interface CreateSwapSessionOptions {
  swapId: string;
  legA: SwapLegSpec;
  legB: SwapLegSpec;
  /** Fixed preimage (deterministic tests / recovery). Omit → 32 random bytes. */
  preimage?: Uint8Array;
}

/**
 * Creates the session in draft. Fail-closed on: empty swap id, T1 <= T2,
 * broken counterparty binding, and preimages outside the core's length law.
 */
export function createSwapSession(
  opts: CreateSwapSessionOptions,
): { view: SwapSessionView; hashlock: Uint8Array; preimage: Uint8Array } {
  if (typeof opts.swapId !== "string" || opts.swapId.length === 0) {
    throw new SwapSessionError("swapId must be a non-empty string");
  }
  const preimage = opts.preimage ? new Uint8Array(opts.preimage) : new Uint8Array(randomBytes(SWAP_PREIMAGE_BYTES));
  if (preimage.length < HTLC_PREIMAGE_MIN) {
    throw new SwapSessionError(`preimage must be at least ${HTLC_PREIMAGE_MIN} bytes`);
  }
  const legA = opts.legA;
  const legB = opts.legB;
  if (!Number.isInteger(legA.timeoutSeconds) || !Number.isInteger(legB.timeoutSeconds) || legA.timeoutSeconds <= 0 || legB.timeoutSeconds <= 0) {
    throw new SwapSessionError("leg timeouts must be positive integers");
  }
  // SAFETY LAW: the initiator's lock strictly outlives the responder's.
  if (legA.timeoutSeconds <= legB.timeoutSeconds) {
    throw new SwapSessionError("safety law violated: legA timeout (T1) must strictly exceed legB timeout (T2)");
  }
  // COUNTERPARTY BINDING: the legs mirror exactly.
  if (legB.initiator !== legA.responder || legB.responder !== legA.initiator) {
    throw new SwapSessionError("counterparty binding violated: legB must mirror legA (initiator↔responder)");
  }
  if (legA.initiator === legA.responder) {
    throw new SwapSessionError("self-swap refused: the parties must differ");
  }
  const hashlock = sha256Bytes(preimage);
  const view: SwapSessionView = {
    swapId: opts.swapId,
    hashlock,
    legA: { spec: legA, record: null, committedTxid: null },
    legB: { spec: legB, record: null, committedTxid: null },
    preimageRevealed: false,
    receipts: [],
  };
  return { view, hashlock, preimage };
}

// ---------------------------------------------------------------------------
// Phase derivation (honest, from records)
// ---------------------------------------------------------------------------

export function sessionPhase(view: SwapSessionView): SwapPhase {
  const a = view.legA.record;
  const b = view.legB.record;
  if (a?.status === "refunded") return "legA-refunded";
  if (b?.status === "refunded") return "legB-refunded";
  if (a?.status === "claimed" && b?.status === "claimed") return "settled";
  if (b?.status === "claimed") return "legB-claimed";
  if (b && b.status === "active") return "legB-committed";
  if (a && a.status === "active") return "legA-committed";
  return "draft";
}

function requireTxid(txid: string): void {
  if (typeof txid !== "string" || txid.length === 0) {
    throw new SwapSessionError("a leg commit requires the on-chain txid evidence");
  }
}

function requireTime(now: number): void {
  if (!Number.isInteger(now) || now < 0) {
    throw new SwapSessionError("now must be a non-negative integer unix timestamp");
  }
}

// ---------------------------------------------------------------------------
// Sequencing
// ---------------------------------------------------------------------------

/** Step 1 — the initiator locks legA on chain A (creates the legA HTLC). */
export function sessionInitiateLegA(view: SwapSessionView, opts: { now: number; txid: string }): SwapSessionView {
  requireTime(opts.now);
  if (sessionPhase(view) !== "draft") {
    throw new SwapSessionError("legA already committed — a session initiates once");
  }
  requireTxid(opts.txid);
  const spec = view.legA.spec;
  const { record, event } = createHtlc(
    {
      id: `${view.swapId}:A`,
      hashlock: view.hashlock,
      issuer: spec.initiator,
      beneficiary: spec.responder,
      amount: spec.amount,
    },
    { now: opts.now, durationSeconds: spec.timeoutSeconds },
  );
  view.legA.record = record;
  view.legA.committedTxid = opts.txid;
  appendLedgerEvent(view.receipts, { ...event, detail: { ...event.detail, chain: spec.chain, asset: spec.asset, txid: opts.txid } });
  return view;
}

/** Step 2 — the responder locks legB on chain B under the same hashlock. */
export function sessionRespondLegB(view: SwapSessionView, opts: { now: number; txid: string }): SwapSessionView {
  requireTime(opts.now);
  if (sessionPhase(view) !== "legA-committed") {
    throw new SwapSessionError("legB responds only after legA is committed");
  }
  requireTxid(opts.txid);
  const spec = view.legB.spec;
  const { record, event } = createHtlc(
    {
      id: `${view.swapId}:B`,
      hashlock: view.hashlock,
      issuer: spec.initiator,
      beneficiary: spec.responder,
      amount: spec.amount,
    },
    { now: opts.now, durationSeconds: spec.timeoutSeconds },
  );
  view.legB.record = record;
  view.legB.committedTxid = opts.txid;
  appendLedgerEvent(view.receipts, { ...event, detail: { ...event.detail, chain: spec.chain, asset: spec.asset, txid: opts.txid } });
  return view;
}

/** Step 3 — the initiator claims legB by REVEALING the preimage (before T2). */
export function sessionClaimLegB(view: SwapSessionView, opts: { now: number; preimage: Uint8Array }): SwapSessionView {
  requireTime(opts.now);
  const leg = view.legB;
  if (!leg.record) {
    throw new SwapSessionError("legB is not locked — nothing to claim");
  }
  const { record, event } = claimHtlc(leg.record, {
    now: opts.now,
    party: leg.record.terms.beneficiary,
    preimage: opts.preimage,
  });
  leg.record = record;
  view.preimageRevealed = true;
  appendLedgerEvent(view.receipts, { ...event, detail: { ...event.detail, chain: leg.spec.chain } });
  return view;
}

/**
 * Step 4 — the responder counter-claims legA with the public preimage
 * (before T1). Fail-closed on a PUBLIC REVEAL: this session must have
 * observed the reveal first — private-knowledge shortcuts refuse.
 */
export function sessionCounterClaimLegA(view: SwapSessionView, opts: { now: number; preimage: Uint8Array }): SwapSessionView {
  requireTime(opts.now);
  const leg = view.legA;
  if (!leg.record) {
    throw new SwapSessionError("legA is not locked — nothing to claim");
  }
  if (!view.preimageRevealed) {
    throw new SwapSessionError("counter-claim refused: no preimage reveal observed in this session");
  }
  const { record, event } = claimHtlc(leg.record, {
    now: opts.now,
    party: leg.record.terms.beneficiary,
    preimage: opts.preimage,
  });
  leg.record = record;
  appendLedgerEvent(view.receipts, { ...event, detail: { ...event.detail, chain: leg.spec.chain } });
  return view;
}

/** Failure path — refund one leg per the core expiry law (issuer-only, post-expiry). */
export function sessionRefundLeg(view: SwapSessionView, opts: { leg: "A" | "B"; now: number }): SwapSessionView {
  requireTime(opts.now);
  const leg = opts.leg === "A" ? view.legA : view.legB;
  if (!leg.record) {
    throw new SwapSessionError(`leg${opts.leg} is not locked — nothing to refund`);
  }
  const { record, event } = refundHtlc(leg.record, { now: opts.now, party: leg.record.terms.issuer });
  leg.record = record;
  appendLedgerEvent(view.receipts, { ...event, detail: { ...event.detail, chain: leg.spec.chain } });
  return view;
}

/** The session's receipt chain must always verify (the fleet hash-chain law). */
export function verifySessionReceipts(view: SwapSessionView): { ok: boolean; brokenAt?: number; length: number } {
  return verifyReceiptChain(view.receipts);
}
