/**
 * Saosmartwallet — Solana commitment levels (M3)
 * ==============================================
 * Typed vocabulary + the level this wallet uses. `confirmed` is the
 * operational default: fast enough for UX, durable enough for a wallet.
 */

export type CommitmentLevel = "processed" | "confirmed" | "finalized";

export const COMMITMENT_LEVELS: readonly CommitmentLevel[] = ["processed", "confirmed", "finalized"];

/** Wallet default — configurable per vault (SolanaVault.commitment). */
export const DEFAULT_COMMITMENT: CommitmentLevel = "confirmed";

/** Map to web3.js param without importing the whole lib here. */
export function toRpcCommitment(c: CommitmentLevel): { commitment: CommitmentLevel } {
  return { commitment: c };
}
