/**
 * Saosmartwallet packages/arb-executor — public API (G78-d)
 * ==========================================================
 * The lawful execution rail for owner directive §1.3: internal STEEM↔SBD
 * conversions under the armed policy, signed through packages/hsm-runtime,
 * receipts hash-chained, broadcast structurally absent (OWNER lever).
 * ETH/SOL lanes are honest-gated (KEYS-ABSENT-honest until owner custody).
 */

export {
  loadArmedPolicy,
  parseArmedPolicy,
  BUILTIN_ARB_THRESHOLDS,
  MAX_OPS_PER_CYCLE_CAP,
  type ArmedPolicy,
  type ArbThresholds,
  type PolicyVerdict,
} from "./policy";

export { loadArmyKeys, type LoadedArmy, type ArmyAccountMeta, type ArmyKeyfileMeta } from "./keys";

export {
  ChainReader,
  type ChainReaderOptions,
  type JsonRpcLike,
  type RefBlock,
  type AccountState,
  type AuthorityVerdict,
} from "./chain";

export {
  planCycle,
  decideConversion,
  bestInternalEdge,
  type ConversionDecision,
  type DecisionAction,
  type DecisionVerdict,
  type CycleLedger,
  type PlanInput,
} from "./plan";

export {
  ArbExecutor,
  buildLimitOrderOp,
  deriveOrderId,
  type ArbExecutorOptions,
  type ExecutorRun,
  type SignedIntent,
} from "./executor";

export { ethSolReadiness, ETH_CUSTODY_DIR, SOL_CUSTODY_DIR, type CorridorReadiness } from "./corridors";
