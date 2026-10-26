/**
 * packages/hsm-runtime — public surface
 * ======================================
 * The production HSM signing runtime (owner directive §3.1): keys only from
 * the packages/vault AES-256-GCM store, a token-authenticated deny-by-default
 * signing API, steem-family + ed25519 signing with wire-digest receipts, and
 * an honest health vocabulary (READY/NO-KEYS/SEALED/BLOCKED — never
 * fake-ready). There is no broadcast path, structurally.
 */

export { HsmError, isHsmError, type HsmErrorCode } from "./src/errors";
export { authorizeToken, tokenFingerprint } from "./src/auth";
export {
  loadHsmConfig,
  DEFAULT_HSM_PORT,
  SERVICE_NAME,
  MODE,
  BROADCAST,
  type HsmConfig,
} from "./src/config";
export {
  measureHealth,
  bareHealth,
  type HealthState,
  type HealthInput,
  type SigningVerdict,
  type VaultVerdict,
  type KeyMetaLike,
} from "./src/health";
export { canonicalJson, sha256Hex, finalizeReceipt, type SignReceipt, type ReceiptPolicy } from "./src/receipt";
export {
  HsmSigner,
  probeVault,
  MAX_MESSAGE_BYTES,
  MAX_EXPIRATION_WINDOW_SECONDS,
  type SignSteemInput,
  type SignBytesInput,
} from "./src/sign";
export { createHsmServer, listen, listenOnEphemeralPort, type HsmServerDeps } from "./src/server";
export { runOnce, main, PROOF_MESSAGE, type RunOnceOptions } from "./src/cli";
