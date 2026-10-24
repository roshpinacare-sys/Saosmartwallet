/**
 * Saosmartwallet — HTLC state machine (task 4-c, directive §3)
 * ============================================================
 * Initiated → Locked → (Redeemed | Refunded), with every transition guarded
 * by (phase, party, secret-validity) and every refusal a typed HtlcError:
 *
 *   lock(by=initiator)   : Initiated  + claim-window     → Locked
 *   claim(by=redeemer)   : Locked     + claim-window
 *                          + sha256(secret) === hashSecret → Redeemed
 *   refund(by=initiator) : Locked     + refund-window         → Refunded
 *
 * Refusal matrix (all typed, all leave the state UNCHANGED):
 *   • wrong party          → HTLC_E_BAD_PARTY
 *   • claim before lock /
 *     double-claim / double-lock / any post-terminal move
 *                          → HTLC_E_INVALID_TRANSITION
 *   • claim in refund-window or expired, refund in claim-window,
 *     lock in pre-funding  → HTLC_E_WRONG_PHASE
 *   • wrong claim secret   → HTLC_E_BAD_SECRET (verified in constant time)
 *
 * Guard evaluation order is deterministic: party → state → phase → secret.
 * The clock is INJECTED (default Date.now) — tests and dry-runs drive time
 * explicitly; no wall-clock dependency anywhere in the core.
 */

import { HtlcError } from "./errors";
import {
  phase as evalPhase,
  type Phase,
  type Timelocks,
} from "./timelock";
import { validateOffer, type Offer } from "./messages";
import { verifySecret } from "./secret";

/** The two protocol parties. */
export type Party = "initiator" | "redeemer";

/** Lifecycle states of the machine (names shared with receipts). */
export type SwapState = "Initiated" | "Locked" | "Redeemed" | "Refunded";

/** Audit trail entry for an ACCEPTED transition. */
export interface TransitionEvent {
  kind: "lock" | "claim" | "refund";
  by: Party;
  /** Injected-clock value at which the transition landed (epoch ms). */
  at: number;
  from: SwapState;
  to: SwapState;
}

const TERMINAL: ReadonlySet<SwapState> = new Set(["Redeemed", "Refunded"]);

/**
 * A single-side deterministic HTLC state machine. The SwapSession runs TWO
 * of these (one per side's view) and advances them in lockstep.
 */
export class SwapMachine {
  private readonly offer: Offer;
  private readonly clock: () => number;
  private currentState: SwapState = "Initiated";
  private readonly audit: TransitionEvent[] = [];

  /** Fails closed on an invalid offer (protocol, shapes, timelock margin). */
  constructor(offer: Offer, clock: () => number = Date.now) {
    this.offer = validateOffer(offer);
    if (typeof clock !== "function") {
      throw new HtlcError("HTLC_E_BAD_INPUT", "clock must be a function returning epoch ms");
    }
    this.clock = clock;
  }

  get swapId(): string {
    return this.offer.swapId;
  }

  get state(): SwapState {
    return this.currentState;
  }

  get isTerminal(): boolean {
    return TERMINAL.has(this.currentState);
  }

  /** Phase under the injected clock at the moment of inspection. */
  get phase(): Phase {
    return evalPhase(this.clock(), this.offer.timelocks);
  }

  get timelocks(): Timelocks {
    return this.offer.timelocks;
  }

  /** Accepted transitions so far, in order (audit trail). */
  get events(): readonly TransitionEvent[] {
    return this.audit;
  }

  /**
   * Initiator funds the swap. Requires Initiated + claim-window phase.
   * (In pre-funding the agreed funding instant has not arrived yet; in
   * refund-window/expired the swap must never lock.)
   */
  lock(by: Party): TransitionEvent {
    if (by !== "initiator") {
      throw new HtlcError(
        "HTLC_E_BAD_PARTY",
        `lock is an initiator transition, called by "${by}" (swap ${this.offer.swapId})`,
      );
    }
    if (this.currentState !== "Initiated") {
      throw new HtlcError(
        "HTLC_E_INVALID_TRANSITION",
        `lock requires state Initiated, swap ${this.offer.swapId} is ${this.currentState}`,
      );
    }
    const now = this.clock();
    const p = evalPhase(now, this.offer.timelocks);
    if (p !== "claim-window") {
      throw new HtlcError(
        "HTLC_E_WRONG_PHASE",
        `lock requires the claim-window phase, swap ${this.offer.swapId} is in "${p}" at ${now}`,
      );
    }
    return this.commit("lock", by, now, "Locked");
  }

  /**
   * Redeemer claims with the secret preimage. Requires Locked + claim-window
   * + sha256(secret) === hashSecret. Guard order: party → state → phase →
   * secret (a wrong-phase claim never leaks whether the secret was right).
   */
  claim(by: Party, secret: Uint8Array | string): TransitionEvent {
    if (by !== "redeemer") {
      throw new HtlcError(
        "HTLC_E_BAD_PARTY",
        `claim is a redeemer transition, called by "${by}" (swap ${this.offer.swapId})`,
      );
    }
    if (this.currentState !== "Locked") {
      throw new HtlcError(
        "HTLC_E_INVALID_TRANSITION",
        `claim requires state Locked, swap ${this.offer.swapId} is ${this.currentState}`,
      );
    }
    const now = this.clock();
    const p = evalPhase(now, this.offer.timelocks);
    if (p !== "claim-window") {
      throw new HtlcError(
        "HTLC_E_WRONG_PHASE",
        `claim requires the claim-window phase, swap ${this.offer.swapId} is in "${p}" at ${now}`,
      );
    }
    let verified: boolean;
    try {
      verified = verifySecret(secret, this.offer.hashSecret);
    } catch (e) {
      // A malformed secret (wrong length / non-hex) is an invalid CLAIM, not
      // a programming error — surface it through the refusal matrix.
      if (e instanceof HtlcError && e.code === "HTLC_E_BAD_INPUT") {
        throw new HtlcError(
          "HTLC_E_BAD_SECRET",
          `claim secret malformed for swap ${this.offer.swapId} (secret never echoed)`,
        );
      }
      throw e;
    }
    if (!verified) {
      throw new HtlcError(
        "HTLC_E_BAD_SECRET",
        `claim secret does not hash to the offer hash for swap ${this.offer.swapId} (secret never echoed)`,
      );
    }
    return this.commit("claim", by, now, "Redeemed");
  }

  /**
   * Initiator refunds. Requires Locked + refund-window phase. Refunding
   * inside the claim window is refused — the redeemer still has time to
   * claim, and pulling funds early would make the swap unsafe for them.
   */
  refund(by: Party): TransitionEvent {
    if (by !== "initiator") {
      throw new HtlcError(
        "HTLC_E_BAD_PARTY",
        `refund is an initiator transition, called by "${by}" (swap ${this.offer.swapId})`,
      );
    }
    if (this.currentState !== "Locked") {
      throw new HtlcError(
        "HTLC_E_INVALID_TRANSITION",
        `refund requires state Locked, swap ${this.offer.swapId} is ${this.currentState}`,
      );
    }
    const now = this.clock();
    const p = evalPhase(now, this.offer.timelocks);
    if (p !== "refund-window") {
      throw new HtlcError(
        "HTLC_E_WRONG_PHASE",
        `refund requires the refund-window phase, swap ${this.offer.swapId} is in "${p}" at ${now}`,
      );
    }
    return this.commit("refund", by, now, "Refunded");
  }

  // ------------------------------------------------------------------ internal

  private commit(kind: TransitionEvent["kind"], by: Party, at: number, to: SwapState): TransitionEvent {
    const event: TransitionEvent = { kind, by, at, from: this.currentState, to };
    this.currentState = to;
    this.audit.push(event);
    return event;
  }
}
