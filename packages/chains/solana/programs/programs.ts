/**
 * Saosmartwallet — Solana program IDs (M3)
 * ========================================
 * Well-known on-chain program addresses, stated as constants. These are
 * public protocol facts, not configuration.
 */

import { PublicKey } from "@solana/web3.js";

/** Native System Program — SOL transfers, account creation. */
export const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");

/** SPL Token Program (classic). */
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/** SPL Associated Token Account Program. */
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/** Memo Program — used for bridge annotation payloads. */
export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export const NATIVE_MINT = "So11111111111111111111111111111111111111112";

/** Solana exposes no chain id; the cluster name is the honest identifier. */
export const SOLANA_CLUSTER = "mainnet-beta" as const;
