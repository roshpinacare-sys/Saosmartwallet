/**
 * Saosmartwallet — signing layer barrel (M2, layer 4).
 *
 * Consumers: `import { SigningOrchestrator } from "…/packages/core/src/signing"`.
 * Shared vocabulary (SigningOptions, SimulationResult, SignatureRecord,
 * MultiSigResult, BatchSignResult, CrossChainSignature) lives in `../types`
 * and is re-exported here for one-stop imports; the chain write/read models
 * are re-exported TYPE-ONLY from the frozen adapter seam.
 */

export {
  SigningOrchestrator,
  type MultiSignOptions,
  type OrchestratorDeps,
  type OrchestratorSignOptions,
  type SignOutcome,
} from "./orchestrator";

export type {
  BatchSignResult,
  ConfirmationDetails,
  CrossChainSignature,
  MultiSigResult,
  SignatureRecord,
  SigningOptions,
  SimulationResult,
  SimulationRisk,
} from "../types";

export type { BroadcastResult, ChainAdapter, SignedTx, UnsignedTx } from "../../../chains/chain-adapter";
