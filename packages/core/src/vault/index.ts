/**
 * Saosmartwallet — vault layer barrel (M2, layer 1)
 * =================================================
 * The single import surface for the vault hierarchy (SovereignVault,
 * VaultKeys, defaults) plus the whole crypto engine — consumed by the
 * signing orchestrator (layer 4), backup manager (layer 5) and API routes.
 */

export * from "../crypto";

export {
  DEFAULT_AUTO_LOCK_SECONDS,
  defaultPolicyRuleSet,
  emptyState,
} from "./defaults";

export { VaultKeys, type AddKeyInput } from "./keys";

export {
  SovereignVault,
  type InitializeOptions,
  type PurposeVaultInput,
  type RevealResult,
  type SoldierUpsertInput,
  type SovereignVaultOptions,
  type UpsertNetworkInput,
  type VaultAddKeyInput,
} from "./vault";
