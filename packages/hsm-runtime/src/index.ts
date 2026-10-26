/**
 * Saosmartwallet packages/hsm-runtime — public API
 * =================================================
 * The production HSM signing runtime core (owner directive §3):
 * custody (scrypt master key from a 0600 key file outside the tree),
 * sealed keyring (AES-256-GCM envelopes via packages/vault — reused),
 * deny-by-default HTTP handler, hash-chained audit, deterministic HTLC
 * verdicts. The deployable entry is mini-services/hsm-runtime/index.ts.
 */

export {
  loadMasterKeyFromKeyFile,
  fingerprintOfKeyFile,
  DEFAULT_MASTER_KEY_PATH,
  SAOSMARTWALLET_VAULT_DIR,
  HsmMasterKeyError,
} from "./master-key";

export {
  HsmKeyring,
  HsmKeyringError,
  SECP256K1_KEY_ID,
  ED25519_KEY_ID,
  type HsmKeyInfo,
  type HsmSignature,
  type HsmCurve,
  type HsmKeyringOptions,
} from "./keyring";

export { HashChainAudit, GENESIS_PREV_HASH, type AuditEntry } from "./audit";

export { constantTimeEqual, extractBearerToken } from "./token";

export { htlcVerdict, type HtlcVerdict, type HtlcVerdictInput, type HtlcState } from "./htlc-verdicts";

export {
  createHsmHandler,
  HSM_SERVICE_NAME,
  HSM_SERVICE_VERSION,
  type HsmDeps,
  type HsmHandler,
} from "./server";
