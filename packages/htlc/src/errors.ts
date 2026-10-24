/**
 * Saosmartwallet — HTLC error taxonomy (fail-closed, redaction-safe)
 * ==================================================================
 * EVERY error raised by packages/htlc is an HtlcError carrying a stable
 * machine-readable code. Message discipline (owner directive §11):
 *
 *   • Messages NEVER contain secret material — only swap ids (public),
 *     party ids (public), phase names, state names and expected/actual
 *     shapes. Claim secrets are never echoed, not even truncated.
 *   • Fail-closed: there is no "return null and continue" path anywhere in
 *     the state machine, codec, session or simulated adapter — any
 *     inconsistency throws with one of the codes below.
 */

export type HtlcErrorCode =
  /** Bad caller input: shapes, lengths, non-canonicalizable values. */
  | "HTLC_E_BAD_INPUT"
  /** A claim secret does not hash to the offer's hashSecret. */
  | "HTLC_E_BAD_SECRET"
  /** Wire message failed strict schema validation (shape/protocol/kind). */
  | "HTLC_E_BAD_MESSAGE"
  /** The message belongs to a different swap than the session. */
  | "HTLC_E_SWAP_MISMATCH"
  /** The transition belongs to the other party. */
  | "HTLC_E_BAD_PARTY"
  /** The timelock phase forbids the transition (claim/refund windows). */
  | "HTLC_E_WRONG_PHASE"
  /** The state machine forbids the transition (pre-lock, post-terminal…). */
  | "HTLC_E_INVALID_TRANSITION"
  /** Genesis invariant violated: initiatorRefundAt - redeemerClaimAt < margin. */
  | "HTLC_E_TIMELOCK_MARGIN"
  /** The two session views diverged — session is poisoned, fail-closed. */
  | "HTLC_E_DIVERGENCE"
  /** The adapter does not support the requested asset. */
  | "HTLC_E_ADAPTER_ASSET"
  /** The adapter's books are inconsistent with the requested operation. */
  | "HTLC_E_ADAPTER_STATE";

export class HtlcError extends Error {
  constructor(
    readonly code: HtlcErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HtlcError";
  }
}
