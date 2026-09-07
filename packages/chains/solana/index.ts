/**
 * Saosmartwallet — Solana adapter barrel (M3)
 */

export {
  SolanaAdapter,
  toSolanaAddress,
  keypairFromSecretBytes,
  solanaAddressFromSeed,
  formatLamports,
} from "./adapter";
export type {
  SolanaAdapterOptions,
  SolanaOperationType,
  SolanaChainInfo,
  SolanaAccountInfo,
  SplTokenBalance,
  SolanaSignatureStatus,
} from "./adapter";
export {
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MEMO_PROGRAM_ID,
  NATIVE_MINT,
  SOLANA_CLUSTER,
} from "./programs/programs";
export {
  COMMITMENT_LEVELS,
  DEFAULT_COMMITMENT,
  toRpcCommitment,
} from "./commitment";
export type { CommitmentLevel } from "./commitment";
