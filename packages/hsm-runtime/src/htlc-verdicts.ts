/**
 * Saosmartwallet packages/hsm-runtime — deterministic HTLC claim/refund verdicts
 * ===============================================================================
 * A pure, total decision function over a hashlock's current reality: SHOULD the
 * redeemer CLAIM (preimage revealed, funds move to redeemer), SHOULD the
 * initiator REFUND (window closed), or is the move REJECTED? Composes the W49
 * HTLC primitives (packages/htlc): constant-time sha256 preimage verification
 * (verifySecret) and the same state vocabulary (SwapState) — REUSED, not
 * reinvented. Zero I/O, zero clock reads — `now` is injected (deterministic).
 *
 * Precedence law (production semantics, pinned by test):
 *   1. terminal states refuse everything (double-claim / double-refund refusal)
 *   2. non-Locked states never move funds
 *   3. past initiatorRefundAt the swap is EXPIRED — terminal, nothing moves
 *   4. inside the claim window: CLAIM only with a verified preimage (constant
 *      time); a refund before the window closes is refused (the initiator
 *      cannot jump the gun)
 *   5. after redeemerClaimAt the TIMEOUT OUTRANKS THE CLAIM: even a valid
 *      preimage arriving late cannot claim — the verdict is REFUND while the
 *      refund window is open (this is the redeemer's safety-margin semantics
 *      from packages/htlc timelocks)
 */

import { verifySecret } from "../../htlc/src/secret";

/** The state vocabulary shared with packages/htlc (SwapState). */
export type HtlcState = "Initiated" | "Locked" | "Redeemed" | "Refunded";

export interface HtlcVerdictInput {
  /** Lifecycle state of the hashlock (SwapState of the machine holding it). */
  state: HtlcState;
  /** The offer's hashlock — sha256 hex (64 chars) the preimage must match. */
  hashlock: string;
  /** Injected clock (epoch ms) — deterministic, no wall time. */
  now: number;
  /** Claim window closes here (exclusive). */
  redeemerClaimAt: number;
  /** Refund window closes here (exclusive). */
  initiatorRefundAt: number;
  /** The claimed preimage as 64-hex (present when a claim is attempted). */
  preimageHex?: string;
}

export interface HtlcVerdict {
  verdict: "CLAIM" | "REFUND" | "REJECT";
  reason:
    | "preimage-verified-in-claim-window"
    | "claim-window-closed-refund-open"
    | "preimage-mismatch"
    | "claim-window-open-no-refund"
    | "already-redeemed"
    | "already-refunded"
    | "expired-terminal"
    | "not-locked";
}

export function htlcVerdict(input: HtlcVerdictInput): HtlcVerdict {
  const { state, hashlock, now, redeemerClaimAt, initiatorRefundAt, preimageHex } = input;

  // 1. terminal states — nothing ever moves again (double-move refusal).
  if (state === "Redeemed") return { verdict: "REJECT", reason: "already-redeemed" };
  if (state === "Refunded") return { verdict: "REJECT", reason: "already-refunded" };

  // 2. funds not yet locked — no verdict can unlock them here.
  if (state !== "Locked") return { verdict: "REJECT", reason: "not-locked" };

  // 3. expired — past the refund deadline the swap is terminal everywhere.
  if (now >= initiatorRefundAt) return { verdict: "REJECT", reason: "expired-terminal" };

  // 4. claim window open: claim with verified preimage; refund is premature.
  if (now < redeemerClaimAt) {
    if (preimageHex === undefined) {
      return { verdict: "REJECT", reason: "claim-window-open-no-refund" };
    }
    // verifySecret is constant-time but THROWING on malformed preimage shapes —
    // a failed claim must be a verdict, never an exception path.
    let verified = false;
    try {
      verified = verifySecret(preimageHex, hashlock);
    } catch {
      verified = false;
    }
    if (verified) {
      return { verdict: "CLAIM", reason: "preimage-verified-in-claim-window" };
    }
    return { verdict: "REJECT", reason: "preimage-mismatch" };
  }

  // 5. claim window closed, refund window open: TIMEOUT OUTRANKS CLAIM.
  //    A preimage present or not — the lawful move is the initiator refund.
  return { verdict: "REFUND", reason: "claim-window-closed-refund-open" };
}
