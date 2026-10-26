/**
 * Saosmartwallet packages/fixedfloat — cross-chain swap rail (wave G76-b)
 * =========================================================================
 * Maps the official FixedFloat v2 order lifecycle onto the packages/swap
 * atomic-swap vocabulary — WITH HONESTY ABOUT WHAT THIS RAIL IS NOT.
 *
 * WHAT THE RAIL IS: a production custodial exchange rail. Orders are created,
 * polled to a terminal verdict, and — when the service enters EMERGENCY —
 * driven to an explicit EXCHANGE-or-REFUND choice. The timelock analog is the
 * service's own order expiration (data.time.expiration → EXPIRED → refund per
 * FixedFloat policy).
 *
 * WHAT THE RAIL IS NOT (fail-honest verdicts, pinned by test/rail.test.ts):
 *   • NOT trustless. FixedFloat v2 exposes NO hashlock parameter: our session
 *     preimage can NOT be bound to the order, so the counterparty claim logic
 *     of packages/swap (claim-by-reveal, counter-claim-on-public-reveal) has NO
 *     wire-level counterpart here. htlcSupport() returns REFUSED for hashlock.
 *   • NO user timelock. FixedFloat v2 exposes no timelock parameter; the order
 *     expiration is service-controlled data, reported as data — never claimed
 *     as an HTLC timelock. htlcSupport() returns REFUSED for timelock.
 *
 * SETTLE-EVIDENCE LAW: a DONE order yields evidence {txid: "ff:<orderId>",
 * chainProof: false, kind: "fixedfloat-order"} — the orderId is the ONLY
 * honest evidence id this rail can produce; it is NOT an on-chain txid and is
 * never presented as one. packages/swap's session accepts it as the commit
 * evidence id while the custody disclosure (RAIL_CUSTODY_DISCLOSURE) stays
 * attached to every artifact this rail emits.
 *
 * Status vocabulary (official docs): NEW, PENDING, EXCHANGE, WITHDRAW, DONE,
 * EXPIRED, EMERGENCY. Unknown statuses refuse (FF_E_STATE) — funds verdicts
 * are never guessed.
 */

import { FixedFloatClient } from "./client";
import { FixedFloatError } from "./errors";

// ---------------------------------------------------------------------------
// Status vocabulary (official 7-value table)
// ---------------------------------------------------------------------------

export const FF_ORDER_STATUSES = ["NEW", "PENDING", "EXCHANGE", "WITHDRAW", "DONE", "EXPIRED", "EMERGENCY"] as const;
export type FfOrderStatus = (typeof FF_ORDER_STATUSES)[number];

export type RailPhase =
  | "deposit-waiting"
  | "deposit-confirming"
  | "exchanging"
  | "sending"
  | "settled"
  | "expired"
  | "emergency";

export function isFfOrderStatus(v: unknown): v is FfOrderStatus {
  return typeof v === "string" && (FF_ORDER_STATUSES as readonly string[]).includes(v);
}

export function mapOrderStatus(status: string): RailPhase {
  if (!isFfOrderStatus(status)) {
    throw new FixedFloatError("FF_E_STATE", `unknown FixedFloat order status: ${JSON.stringify(String(status))} — refusing to guess a funds verdict`);
  }
  switch (status) {
    case "NEW":
      return "deposit-waiting";
    case "PENDING":
      return "deposit-confirming";
    case "EXCHANGE":
      return "exchanging";
    case "WITHDRAW":
      return "sending";
    case "DONE":
      return "settled";
    case "EXPIRED":
      return "expired";
    case "EMERGENCY":
      return "emergency";
  }
}

// ---------------------------------------------------------------------------
// HTLC honesty verdicts
// ---------------------------------------------------------------------------

export const RAIL_CUSTODY_DISCLOSURE =
  "custodial rail: FixedFloat holds both legs; hashlock/timelock atomicity is NOT enforceable on this rail (see htlcSupport) — settle evidence is the order id, never a chain txid" as const;

export interface HtlcSupportVerdict {
  supported: false;
  verdict: "REFUSED";
  cause: string;
}

export interface HtlcSupportReport {
  hashlock: HtlcSupportVerdict;
  timelock: HtlcSupportVerdict;
  custodyModel: "custodial";
  note: string;
}

/**
 * The honest HTLC capability report for this rail. Both trustless laws are
 * REFUSED with precise causes; this function is the contract test target that
 * keeps the rail from ever overclaiming atomicity.
 */
export function htlcSupport(): HtlcSupportReport {
  return {
    hashlock: {
      supported: false,
      verdict: "REFUSED",
      cause:
        "FixedFloat v2 exposes no hashlock parameter — the session preimage cannot be bound to the order, so trustless claim/counter-claim is impossible on this rail",
    },
    timelock: {
      supported: false,
      verdict: "REFUSED",
      cause:
        "FixedFloat v2 exposes no user timelock parameter — order expiration (data.time.expiration) is service-controlled data, not an HTLC timelock we can set or enforce",
    },
    custodyModel: "custodial",
    note: RAIL_CUSTODY_DISCLOSURE,
  };
}

// ---------------------------------------------------------------------------
// Order view + settle verdicts
// ---------------------------------------------------------------------------

export interface RailOrderTime {
  reg?: number | null;
  start?: number | null;
  finish?: number | null;
  update?: number | null;
  expiration?: number | null;
  left?: number | null;
}

export interface RailOrder {
  id: string;
  token: string;
  status: string;
  type?: string;
  time?: RailOrderTime | null;
  emergency?: { status?: unknown; choice?: string; repeat?: number } | null;
  /** The documented envelope carries more fields; they pass through unvalidated. */
  [key: string]: unknown;
}

export type SettleVerdictName = "SETTLED" | "IN-FLIGHT" | "EMERGENCY-CHOICE-REQUIRED" | "REFUNDED-TIMEOUT";

export interface SettleEvidence {
  /** The honest evidence id: "ff:<orderId>" — explicitly NOT an on-chain txid. */
  txid: string;
  kind: "fixedfloat-order";
  orderId: string;
  status: string;
  chainProof: false;
  custody: string;
}

export interface SettleVerdictResult {
  verdict: SettleVerdictName;
  evidence: SettleEvidence;
}

/** The settle-evidence artifact for one order — chainProof is ALWAYS false. */
export function settleEvidence(order: RailOrder): SettleEvidence {
  if (typeof order.id !== "string" || order.id.length === 0) {
    throw new FixedFloatError("FF_E_STATE", "settle evidence requires an order id");
  }
  if (typeof order.status !== "string" || order.status.length === 0) {
    throw new FixedFloatError("FF_E_STATE", "settle evidence requires an order status");
  }
  return {
    txid: `ff:${order.id}`,
    kind: "fixedfloat-order",
    orderId: order.id,
    status: order.status,
    chainProof: false,
    custody: RAIL_CUSTODY_DISCLOSURE,
  };
}

/** Maps an order to a funds verdict — fail-honest on unknown statuses. */
export function settleVerdict(order: RailOrder): SettleVerdictResult {
  const phase = mapOrderStatus(order.status);
  const evidence = settleEvidence(order);
  switch (phase) {
    case "settled":
      return { verdict: "SETTLED", evidence };
    case "expired":
      return { verdict: "REFUNDED-TIMEOUT", evidence };
    case "emergency":
      return { verdict: "EMERGENCY-CHOICE-REQUIRED", evidence };
    default:
      return { verdict: "IN-FLIGHT", evidence };
  }
}

// ---------------------------------------------------------------------------
// The rail
// ---------------------------------------------------------------------------

export interface CreateSwapLegOrderRequest {
  type: "fixed" | "float";
  fromCcy: string;
  toCcy: string;
  direction: "from" | "to";
  amount: number;
  toAddress: string;
  tag?: string | false;
}

export interface SwapLegOrderRef {
  orderId: string;
  token: string;
  status: string;
  expiresAt?: number | null;
  evidence: SettleEvidence;
}

export interface RefundPath {
  action: "REFUND-EMERGENCY" | "AUTO-POLICY" | "NONE";
  verdict: SettleVerdictName;
  requiresAddress: boolean;
  note: string;
}

export interface PollOrderOptions {
  /** Predicate deciding acceptance (e.g. terminal statuses). */
  accept: (order: RailOrder) => boolean;
  /** Hard bound on polls — exhaustion is an honest FF_E_POLL_TIMEOUT. */
  maxPolls: number;
  /** Sleep between polls in ms (via the client's injected sleep). */
  intervalMs: number;
}

export class FixedFloatSwapRail {
  readonly #client: FixedFloatClient;

  constructor(client: FixedFloatClient) {
    if (!(client instanceof FixedFloatClient)) {
      throw new FixedFloatError("FF_E_STATE", "FixedFloatSwapRail requires a FixedFloatClient");
    }
    this.#client = client;
  }

  /**
   * Creates one swap-leg order. The request schema is validated HERE — before
   * any transport call — because a malformed leg must never reach the wire.
   * Side-effect honesty: the client attempts `create` exactly once.
   */
  async createSwapLegOrder(req: CreateSwapLegOrderRequest): Promise<SwapLegOrderRef> {
    if (req.type !== "fixed" && req.type !== "float") {
      throw new FixedFloatError("FF_E_STATE", 'swap leg type must be "fixed" or "float"');
    }
    if (req.direction !== "from" && req.direction !== "to") {
      throw new FixedFloatError("FF_E_STATE", 'swap leg direction must be "from" or "to"');
    }
    if (typeof req.amount !== "number" || !Number.isFinite(req.amount) || req.amount <= 0) {
      throw new FixedFloatError("FF_E_STATE", "swap leg amount must be a positive finite number");
    }
    if (typeof req.toAddress !== "string" || req.toAddress.length === 0) {
      throw new FixedFloatError("FF_E_STATE", "swap leg requires a non-empty toAddress");
    }
    if (typeof req.fromCcy !== "string" || req.fromCcy.length === 0 || typeof req.toCcy !== "string" || req.toCcy.length === 0) {
      throw new FixedFloatError("FF_E_STATE", "swap leg requires non-empty fromCcy and toCcy");
    }
    const data = (await this.#client.createOrder({ ...req })) as Record<string, unknown>;
    const id = data.id;
    const token = data.token;
    const status = data.status;
    if (typeof id !== "string" || id.length === 0 || typeof token !== "string" || token.length === 0) {
      throw new FixedFloatError("FF_E_MALFORMED", "create response lacks the order id/token — refusing to track an unidentifiable order");
    }
    if (typeof status !== "string") {
      throw new FixedFloatError("FF_E_MALFORMED", "create response lacks a string order status");
    }
    const time = (data.time ?? null) as RailOrderTime | null;
    return {
      orderId: id,
      token,
      status,
      expiresAt: time?.expiration ?? null,
      evidence: settleEvidence({ id, token, status, type: typeof data.type === "string" ? data.type : undefined, time }),
    };
  }

  /** Fetches the current order view (read-only; bounded retry inside the client). */
  async orderInfo(id: string, token: string): Promise<RailOrder> {
    const data = (await this.#client.orderInfo(id, token)) as Record<string, unknown>;
    if (typeof data.id !== "string" || typeof data.status !== "string") {
      throw new FixedFloatError("FF_E_MALFORMED", `order response for ${id} lacks id/status`);
    }
    return { ...(data as RailOrder), token };
  }

  /**
   * EMERGENCY → REFUND (minus miner fee). The refund address is REQUIRED —
   * fail-closed before the wire; the client attempts `emergency` exactly once.
   */
  async emergencyRefund(id: string, token: string, refundAddress: string, tag?: string): Promise<unknown> {
    if (typeof refundAddress !== "string" || refundAddress.length === 0) {
      throw new FixedFloatError("FF_E_STATE", "emergency REFUND requires a non-empty refund address — refusing a refund without a destination");
    }
    const payload: Record<string, unknown> = { id, token, choice: "REFUND", address: refundAddress };
    if (tag !== undefined) payload.tag = tag;
    return this.#client.emergencyAction(payload as { id: string; token: string; choice: "REFUND"; address: string; tag?: string });
  }

  /** EMERGENCY → EXCHANGE (continue at market rate). */
  emergencyExchange(id: string, token: string): Promise<unknown> {
    return this.#client.emergencyAction({ id, token, choice: "EXCHANGE" });
  }

  /**
   * Bounded, deterministic polling: fetch → accept? → sleep(interval) → repeat,
   * at most maxPolls times; exhaustion throws FF_E_POLL_TIMEOUT carrying the
   * last observed status (public data only).
   */
  async pollOrderUntil(id: string, token: string, opts: PollOrderOptions): Promise<RailOrder> {
    if (!Number.isInteger(opts.maxPolls) || opts.maxPolls <= 0) {
      throw new FixedFloatError("FF_E_STATE", "maxPolls must be a positive integer");
    }
    if (!Number.isInteger(opts.intervalMs) || opts.intervalMs < 0) {
      throw new FixedFloatError("FF_E_STATE", "intervalMs must be a non-negative integer");
    }
    if (typeof opts.accept !== "function") {
      throw new FixedFloatError("FF_E_STATE", "pollOrderUntil requires an accept predicate");
    }
    let last: RailOrder | null = null;
    for (let poll = 0; poll < opts.maxPolls; poll++) {
      if (poll > 0) await this.#client.sleepFn(opts.intervalMs);
      last = await this.orderInfo(id, token);
      if (opts.accept(last)) return last;
    }
    throw new FixedFloatError(
      "FF_E_POLL_TIMEOUT",
      `polling exhausted after ${opts.maxPolls} polls — last observed status: ${last?.status ?? "unknown"}`,
    );
  }

  /** The honest refund recommendation for an order's current status. */
  refundPath(order: RailOrder): RefundPath {
    const phase = mapOrderStatus(order.status);
    if (phase === "emergency") {
      return {
        action: "REFUND-EMERGENCY",
        verdict: "EMERGENCY-CHOICE-REQUIRED",
        requiresAddress: true,
        note: "EMERGENCY requires an explicit choice; emergencyRefund(id, token, address) issues choice=REFUND (minus miner fee)",
      };
    }
    if (phase === "expired") {
      return {
        action: "AUTO-POLICY",
        verdict: "REFUNDED-TIMEOUT",
        requiresAddress: false,
        note: "EXPIRED orders refund per FixedFloat's own policy — the v2 API exposes no manual refund trigger, and this rail does not invent one",
      };
    }
    return {
      action: "NONE",
      verdict: settleVerdict(order).verdict,
      requiresAddress: false,
      note: "no refund action applies to the current status",
    };
  }
}
