/**
 * Saosmartwallet — htlc package public API (task 4-c, cycle 31)
 * =============================================================
 * Production-grade Hash-Time-Locked-Contract core for cross-chain atomic
 * swaps (master directive §3): deterministic state machine, canonical
 * SAOS-HTLC/1 codec, sha256-chained receipts, dual-view session
 * orchestration, vault sealing, and an honestly-marked simulated chain
 * adapter. Zero third-party dependencies (node:crypto only).
 *
 * Quick start:
 *
 *   import { makeOffer, makeClaim, SwapSession, sealSessionReceipt } from "@saos/htlc";
 *
 *   const session = new SwapSession(offer, injectedClock);   // offer = makeOffer({...})
 *   session.submit(makeLock(offer.swapId));                  // initiator funds
 *   session.submit(makeClaim(offer.swapId, secretHex));      // redeemer claims
 *   session.state === "Redeemed";
 *   verifyChain(session.receipts());                          // tamper-evident
 *   await sealSessionReceipt(vault, "htlc/receipt/x", session); // vault-sealed
 *
 * Honest scope (see packages/htlc/README.md): this is the deterministic
 * core + interfaces. Per-chain signing/broadcast adapters are future work;
 * the only adapter shipped today is the honestly-marked simulated one.
 *
 * Security contract (pinned by test/htlc.test.ts):
 *   • timelock margin invariant fails closed at genesis
 *   • every refusal is a typed HtlcError; state never silently changes
 *   • claim secrets are constant-time-verified and never echoed
 *   • canonical JSON is byte-deterministic; receipts form a sha256 chain
 *   • dual-view divergence poisons the session (no silent drift)
 */

export { HtlcError, type HtlcErrorCode } from "./errors";

export {
  SECRET_BYTES,
  generateSecret,
  hashSecret,
  verifySecret,
} from "./secret";

export {
  MIN_SAFETY_MARGIN_MS,
  createTimelocks,
  phase,
  type Phase,
  type Timelocks,
} from "./timelock";

export {
  GENESIS_PREV,
  PROTOCOL,
  appendRecord,
  canonicalBytes,
  canonicalize,
  decodeMessage,
  encodeMessage,
  makeClaim,
  makeLock,
  makeOffer,
  makeRefund,
  recordHash,
  validateClaim,
  validateLock,
  validateOffer,
  validateRefund,
  verifyChain,
  type Asset,
  type Claim,
  type HtlcMessage,
  type Lock,
  type Offer,
  type OfferInput,
  type ReceiptInput,
  type ReceiptRecord,
  type RecordCore,
  type Refund,
  type SwapStateName,
} from "./messages";

export {
  SwapMachine,
  type Party,
  type SwapState,
  type TransitionEvent,
} from "./state";

export {
  SwapSession,
  openSessionReceipt,
  sealSessionReceipt,
  type OpenedSessionReceipt,
  type SealedSessionReceipt,
  type VaultLike,
} from "./session";

export {
  SimulatedChainAdapter,
  type AdapterBookEntry,
  type AdapterReceipt,
  type ChainAdapter,
} from "./chains";
