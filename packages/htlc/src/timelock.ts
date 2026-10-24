/**
 * Saosmartwallet — HTLC timelocks (task 4-c, directive §3)
 * ========================================================
 * The two-sided clock of an atomic swap, in absolute epoch milliseconds:
 *
 *   • redeemerClaimAt   — end of the CLAIM window. The redeemer may claim
 *     with the secret strictly BEFORE this instant; from this instant on the
 *     initiator may refund.
 *   • initiatorRefundAt — end of the REFUND window. From here the swap is
 *     "expired" (terminal-no-move in the deterministic core; on-chain
 *     contracts may still refund, which is out of this core's model).
 *
 * GENESIS INVARIANT (fail-closed, pinned by test):
 *   initiatorRefundAt - redeemerClaimAt >= MIN_SAFETY_MARGIN_MS
 *
 * The margin is the redeemer's safety headroom on the counter-chain: it
 * guarantees the redeemer's claim window closes well before the initiator
 * can pull funds back, so a swap can never end with both sides moving.
 * Violating it at genesis throws HTLC_E_TIMELOCK_MARGIN — an offer with a
 * too-thin margin NEVER enters the machine, no matter who proposes it.
 *
 * Phase math (injected clock, deadlines exclusive):
 *   pre-funding   : now < fundedAt            (only when fundedAt present)
 *   claim-window  : fundedAt <= now < redeemerClaimAt
 *   refund-window : redeemerClaimAt <= now < initiatorRefundAt
 *   expired       : now >= initiatorRefundAt
 */

import { HtlcError } from "./errors";

/** Minimum headroom between the claim deadline and the refund deadline. */
export const MIN_SAFETY_MARGIN_MS = 60_000; // 1 minute — test-friendly, protocol-tightenable

/** The two-sided timelock set of SAOS-HTLC/1 (epoch milliseconds). */
export interface Timelocks {
  /** Absolute deadline after which the redeemer can no longer claim. */
  redeemerClaimAt: number;
  /** Absolute deadline after which the initiator can no longer refund. */
  initiatorRefundAt: number;
  /**
   * Optional agreed funding instant: the swap is expected to be locked at
   * this time. When absent, the swap is funded at genesis and the
   * "pre-funding" phase never occurs.
   */
  fundedAt?: number;
}

/** The four temporal phases of a swap lifecycle. */
export type Phase = "pre-funding" | "claim-window" | "refund-window" | "expired";

/**
 * Constructs + validates a Timelocks set. THE ONLY sanctioned way to obtain
 * one — the invariant is enforced here, at genesis, fail-closed.
 */
export function createTimelocks(
  initiatorRefundAt: number,
  redeemerClaimAt: number,
  fundedAt?: number,
): Timelocks {
  assertSafeEpoch(initiatorRefundAt, "initiatorRefundAt");
  assertSafeEpoch(redeemerClaimAt, "redeemerClaimAt");

  const margin = initiatorRefundAt - redeemerClaimAt;
  if (margin < MIN_SAFETY_MARGIN_MS) {
    throw new HtlcError(
      "HTLC_E_TIMELOCK_MARGIN",
      `timelock margin violated at genesis: initiatorRefundAt - redeemerClaimAt = ${margin} ms, ` +
        `minimum is ${MIN_SAFETY_MARGIN_MS} ms — refusing the swap (fail-closed)`,
    );
  }

  if (fundedAt !== undefined) {
    assertSafeEpoch(fundedAt, "fundedAt");
    if (fundedAt >= redeemerClaimAt) {
      throw new HtlcError(
        "HTLC_E_BAD_INPUT",
        "fundedAt must be strictly before redeemerClaimAt (an empty claim window is refused)",
      );
    }
  }

  return fundedAt === undefined
    ? { redeemerClaimAt, initiatorRefundAt }
    : { redeemerClaimAt, initiatorRefundAt, fundedAt };
}

/**
 * Pure phase evaluation for an injected clock value `now` (epoch ms).
 * Deadlines are EXCLUSIVE: at exactly redeemerClaimAt the claim window has
 * closed; at exactly initiatorRefundAt the swap is expired.
 */
export function phase(now: number, t: Timelocks): Phase {
  if (!Number.isSafeInteger(now)) {
    throw new HtlcError("HTLC_E_BAD_INPUT", "phase() clock value must be a safe integer (epoch ms)");
  }
  if (t.fundedAt !== undefined && now < t.fundedAt) return "pre-funding";
  if (now < t.redeemerClaimAt) return "claim-window";
  if (now < t.initiatorRefundAt) return "refund-window";
  return "expired";
}

// ---------------------------------------------------------------------------
// internal
// ---------------------------------------------------------------------------

function assertSafeEpoch(value: unknown, field: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new HtlcError(
      "HTLC_E_BAD_INPUT",
      `${field} must be a positive safe integer (epoch ms), got ${typeof value}`,
    );
  }
}
