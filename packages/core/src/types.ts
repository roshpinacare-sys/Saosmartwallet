/**
 * Saosmartwallet — Sovereign Key Vault shared vocabulary (M2)
 * ===========================================================
 * The single type contract for packages/core. Every layer (crypto, vault,
 * policy, signing, backup, audit) imports from here and NOWHERE else, so
 * parallel work cannot drift. Serialization rules:
 *
 *   - bigint NEVER crosses a persistence or JSON boundary → satoshi-style
 *     amounts travel as decimal strings; helpers `satsToAmount`/`amountToSats`
 *     convert at the edges.
 *   - binary payloads (ciphertext, keys, shares) travel as base64 strings via
 *     `b64` helpers in encoding.ts — the structured types here already use the
 *     string form so the whole state document is JSON-safe by construction.
 */

// ---------------------------------------------------------------------------
// Networks & operations
// ---------------------------------------------------------------------------

export type NetworkId = "steem" | "hive" | "tron" | "blurt" | "saos-net" | "ethereum" | "solana";

export const NETWORK_IDS: readonly NetworkId[] = ["steem", "hive", "tron", "blurt", "saos-net", "ethereum", "solana"];

/** Operation types the ecosystem actually issues today (open string for forks). */
export type OperationType =
  | "transfer"
  | "transfer_to_vesting"
  | "withdraw_vesting"
  | "vote"
  | "comment"
  | "limit_order_create"
  | "limit_order_cancel"
  | "custom_json"
  | "witness_vote"
  | "delegate_vesting_shares"
  | "account_update"
  | "trigger_smart_contract"
  | "erc20_transfer"
  | "erc20_approve"
  | "spl_transfer"
  | "memo";

/** How a vault's key material is stored. */
export type StorageKind = "hot" | "cold" | "air-gapped";

/** The four Steem-family key roles (mirrors packages/chains/chain-adapter.ts). */
export type KeyRole = "owner" | "active" | "posting" | "memo";

// ---------------------------------------------------------------------------
// Amounts — always satoshi strings on the wire
// ---------------------------------------------------------------------------

/** Amount with explicit precision, satoshi-exact. e.g. 10,000 STEEM = { satoshis:"10000000", precision:3, symbol:"STEEM" }. */
export interface AssetAmount {
  satoshis: string; // decimal string of integer satoshis
  precision: number;
  symbol: string;
}

// ---------------------------------------------------------------------------
// Crypto layer types (layer 2)
// ---------------------------------------------------------------------------

export type CipherAlgorithm = "aes-256-gcm" | "chacha20-poly1305";

/** One envelope layer: a content key wrapped under a key-encryption key. */
export interface PayloadLayer {
  keyId: string;
  /** Content-encryption key, encrypted under the KEK named by keyId. */
  encryptedKey: string; // base64
}

/** The canonical encrypted-at-rest envelope. JSON-safe by construction. */
export interface EncryptedPayload {
  version: number; // envelope format version (1)
  algorithm: CipherAlgorithm;
  /** Content ciphertext. */
  ciphertext: string; // base64
  iv: string; // base64 (12 bytes for both algorithms)
  authTag: string; // base64 (16 bytes)
  /** KDF salt used for the master key that sealed this payload (fresh per seal). */
  salt: string; // base64
  /** Envelope layers — first layer that decrypts wins; checksum binds plaintext. */
  layers: PayloadLayer[];
  /** SHA-256(plaintext), base64 — integrity independent of AEAD. */
  checksum: string; // base64
  createdAt: number; // epoch ms
  expiresAt?: number;
}

/** Argon2id parameters — pinned and stored alongside verifiers. */
export interface KdfParams {
  algorithm: "argon2id";
  /** KiB. Default 65536 (64 MiB) per the M2 spec penetration-test budget. */
  memoryKiB: number;
  /** Passes. Default 3. */
  iterations: number;
  /** Lanes. Default 1. */
  parallelism: number;
  /** Output length in bytes. Default 32. */
  hashLength: number;
}

/** A stored password verifier — Argon2id hash + params + salt, constant-time compared. */
export interface PasswordVerifier {
  params: KdfParams;
  salt: string; // base64
  /** Argon2id output, base64 — never the password itself. */
  hash: string; // base64
  createdAt: number;
}

/** Shamir share: x ∈ [1..255], y ∈ GF(256). */
export interface Share {
  index: number; // x — nonzero byte
  data: string; // base64 of y bytes
}

/**
 * Non-interactive zero-knowledge proof of password knowledge
 * (Fiat–Shamir Schnorr identification over secp256k1):
 *   x = hash_to_scalar(password ‖ salt), X = x·G
 *   prover: random r → A = r·G; c = H(X ‖ A ‖ context); z = r + c·x mod n
 * Verifier re-derives X from stored commitment and checks z·G == A + c·X.
 */
export interface ZKProof {
  /** Public commitment X = x·G, compressed 33 bytes, base64. */
  commitment: string;
  /** Nonce commitment A = r·G, base64. */
  nonceCommitment: string;
  /** Fiat–Shamir challenge, base64 (32 bytes). */
  challenge: string;
  /** Response z = r + c·x mod n, base64 (32 bytes). */
  response: string;
  /** Proof context binding (vault id + purpose), UTF-8. */
  context: string;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Vault hierarchy (layer 1)
// ---------------------------------------------------------------------------

export type VaultKind = "master" | "network" | "soldier" | "purpose";

export type PurposeId = "trading" | "bridging" | "governance" | "treasury";

export interface VaultIdentity {
  id: string;
  kind: VaultKind;
  /** Human label, e.g. "STEEM network vault" / "saos-soldier-01". */
  label: string;
  createdAt: number;
  /** Vault IDs that must co-approve operations under threshold policy. */
  approvers: string[];
}

export interface MasterVaultConfig extends VaultIdentity {
  kind: "master";
  /** Root-of-trust key algorithm. ed25519 per spec (fast + safe). */
  keyType: "ed25519";
  requiresMultiSig: true;
  /** Guardian threshold, e.g. 3-of-5. */
  threshold: number;
  guardianCount: number;
}

export interface NetworkVaultConfig extends VaultIdentity {
  kind: "network";
  network: NetworkId;
  /** Which authority roles this vault holds keys for. */
  roles: KeyRole[];
  allowedOperations: OperationType[];
  /** Daily spend ceiling in satoshis (decimal string), per token symbol. */
  maxAmountPerDay: Record<string, string>;
  requiresApproval: boolean;
  storage: StorageKind;
  /** Present only for saos-net — sovereign features. */
  special?: { soldierManagement?: boolean; oracleFeeds?: boolean };
  /** Offline networks keep config but refuse signing. */
  status: "active" | "offline";
}

export interface SoldierPermissions {
  canTrade: boolean;
  canVote: boolean;
  canComment: boolean;
  canTransfer: boolean;
  /** Satoshi string; "0" when canTransfer is false. */
  maxTransferAmount: string;
}

export interface SoldierVaultConfig extends VaultIdentity {
  kind: "soldier";
  soldierName: string;
  permissions: SoldierPermissions;
  /** Network vault ids this soldier draws keys from. */
  linkedVaults: string[];
  anomalyDetection: boolean;
  /** Epoch ms of last signed operation; 0 = never. */
  lastActivity: number;
}

export interface PurposeVaultConfig extends VaultIdentity {
  kind: "purpose";
  purpose: PurposeId;
  allowedOperations: OperationType[];
  networkScope: NetworkId[];
  storage: StorageKind;
}

/** A key sealed inside the vault. Ciphertext only — plaintext never persists. */
export interface EncryptedKey {
  keyId: string;
  /** Owning vault id. */
  vaultId: string;
  network: NetworkId;
  role: KeyRole | null; // null for flavor-less keys (e.g. tron owner)
  /** Steem account this key authenticates (when applicable). */
  account: string | null;
  label: string;
  algorithm: CipherAlgorithm;
  payload: EncryptedPayload;
  /** Derived public key (STM… form) — safe to persist, enables offline checks. */
  publicKey: string | null;
  storage: StorageKind;
  createdAt: number;
  lastUsedAt: number | null;
  status: "active" | "revoked";
}

// ---------------------------------------------------------------------------
// The persisted state document (VaultState.stateJson)
// ---------------------------------------------------------------------------

export interface VaultStateDoc {
  docVersion: 1;
  /** Stable vault instance id (uuid) — binds ZK contexts and audit genesis. */
  vaultInstanceId: string;
  initialized: boolean;
  createdAt: number;
  updatedAt: number;
  /** KDF params + Argon2id verifier for the master password. */
  verifier: PasswordVerifier | null;
  /**
   * Enrollment commitment for the zero-knowledge password-knowledge check
   * (Fiat–Shamir Schnorr over secp256k1 — see crypto/zk.ts), installed at
   * initialize() alongside the Argon2id verifier. Public by design (a curve
   * point): unlock() verifies a fresh transcript against it so TWO independent
   * verifiers must agree on the same password — a mutated/corrupted Argon2id
   * verifier alone can no longer produce a passing unlock.
   */
  zkCommitment: string | null;
  master: MasterVaultConfig | null;
  networks: Record<string, NetworkVaultConfig>;
  soldiers: Record<string, SoldierVaultConfig>;
  purposes: Record<string, PurposeVaultConfig>;
  keys: Record<string, EncryptedKey>;
  policies: PolicyRuleSet;
  backup: {
    lastBackupAt: number | null;
    lastBackupChecksum: string | null;
    sharding: { threshold: number; total: number } | null;
    socialRecovery: { contacts: RecoveryContact[]; threshold: number } | null;
    deadManSwitch: DeadManConfig | null;
  };
  /** Auto-lock after idle, seconds. Server default 300. */
  autoLockSeconds: number;
}

// ---------------------------------------------------------------------------
// Policy engine (layer 3)
// ---------------------------------------------------------------------------

export type PolicyAction = "allow" | "deny" | "require_approval" | "step_up_auth";

export type RiskLevel = "low" | "medium" | "high" | "critical";

/** Static rules are compiled in — they cannot be disabled, only satisfied. */
export interface StaticRule {
  id: string;
  name: string;
  description: string;
  evaluate: (op: PolicyOperation, ctx: OperationContext) => RuleOutcome;
}

export interface DynamicRule {
  id: string;
  name: string;
  enabled: boolean;
  /** Deny when amount (satoshi string) exceeds threshold for this symbol. */
  amountThreshold?: Record<string, string>;
  /** Deny operations on these types entirely. */
  deniedOperations?: OperationType[];
  /** Require N approvals from approvers chain. */
  requireApprovalCount?: number;
  /** Force step-up (password re-entry) for these operations. */
  stepUpFor?: OperationType[];
}

export interface ContextualRule {
  id: string;
  name: string;
  enabled: boolean;
  timeWindow?: { start: string; end: string }; // "09:00"–"17:00" UTC
  maxOperationsPerHour?: number;
  /** Hours before a first-seen recipient/action becomes trusted. 0 = off. */
  newActionCooldownHours?: number;
  requireTrustedDevice?: boolean;
  action: PolicyAction;
}

export interface CompositeRule {
  id: string;
  name: string;
  enabled: boolean;
  operator: "all" | "any";
  /** Rule ids (dynamic/contextual) this composition references. */
  refs: string[];
  action: PolicyAction;
}

export interface RuleOutcome {
  pass: boolean;
  reason: string;
  /** Whether failing this rule is hard-deny vs requires-approval. */
  action?: PolicyAction;
}

export interface PolicyOperation {
  vaultId: string;
  network: NetworkId;
  type: OperationType | string;
  /** Amount at risk, satoshi string (max of the operation's asset legs). */
  amountSatoshis: string;
  symbol: string;
  /** Recipient / order counterpart when applicable. */
  counterparty: string | null;
  /** Free-form detail for audit + anomaly detection. */
  detail?: Record<string, unknown>;
  /** Requested key role for signing. */
  role: KeyRole | null;
}

export interface OperationContext {
  timestamp: number;
  dayOfWeek: number; // 0–6 UTC
  hourOfDay: number; // 0–23 UTC
  network: NetworkId;
  /** Recent operations from the audit trail (most recent first). */
  history: HistoryEntry[];
  userBehavior: {
    averageTransferSatoshis: string;
    averageOperationsPerHour: number;
    typicalCounterparties: string[];
  };
  trustedDevice: boolean;
  /** Volatile session info — is the vault freshly unlocked (step-up satisfied). */
  stepUpSatisfied: boolean;
}

export interface HistoryEntry {
  timestamp: number;
  type: string;
  network: NetworkId;
  counterparty: string | null;
  amountSatoshis: string;
  symbol: string;
  result: "success" | "failure" | "blocked";
}

export interface Anomaly {
  kind: "frequency_spike" | "unusual_amount" | "new_counterparty" | "odd_hour" | "rapid_fire" | "failed_history";
  severity: RiskLevel;
  description: string;
  score: number; // 0–100 contribution
}

export interface AnomalyScore {
  score: number; // 0–100 aggregate risk
  anomalies: Anomaly[];
}

export interface PolicyDecision {
  allowed: boolean;
  confidence: number; // 0–1
  reasons: string[];
  requirements?: {
    additionalApprovals?: string[];
    multiSigThreshold?: number;
    timeLock?: number; // seconds
    stepUpAuth?: boolean;
  };
  riskLevel: RiskLevel;
  anomalies: Anomaly[];
  /** Rule-by-rule trace for the signing dialog. */
  checks: Array<{ ruleId: string; name: string; pass: boolean; detail: string }>;
}

export interface PolicyRuleSet {
  dynamic: DynamicRule[];
  contextual: ContextualRule[];
  composite: CompositeRule[];
}

// ---------------------------------------------------------------------------
// Signing orchestrator (layer 4)
// ---------------------------------------------------------------------------

export interface SigningOptions {
  requirePassword?: boolean; // step-up: verify password again at sign time
  timeLockSeconds?: number; // refuse to broadcast before epoch ms
  maxFeeSatoshis?: string;
  /** Optional confirm gate — orchestrator awaits this before broadcasting. */
  confirmRequired?: (details: ConfirmationDetails) => Promise<boolean>;
  /** Broadcast after signing (default false — signed-only). */
  broadcast?: boolean;
}

export interface ConfirmationDetails {
  summary: string;
  operation: PolicyOperation;
  decision: PolicyDecision;
}

export interface SimulationRisk {
  type: "slippage" | "front_running" | "insufficient_balance" | "policy_violation" | "offline_network" | "missing_adapter";
  severity: "low" | "medium" | "high";
  description: string;
}

export interface SimulationResult {
  success: boolean;
  expectedOutcome: {
    balanceChanges: Array<{ asset: string; satoshis: string; direction: "debit" | "credit" }>;
    stateChanges: string[];
    events: string[];
  };
  risks: SimulationRisk[];
  /** On-chain resource cost estimate. Steem: RC percent consumed, best-effort. */
  estimatedFeeSatoshis: string;
  estimatedResourcePercent: number | null;
  decision: PolicyDecision | null;
}

export interface SignatureRecord {
  vaultId: string;
  keyId: string;
  role: KeyRole | null;
  publicKey: string;
  /** Hex signature (Steem compact 65-byte form). */
  signatureHex: string;
  signedAt: number;
}

export interface MultiSigResult {
  digestHex: string;
  signatures: SignatureRecord[];
  threshold: number;
  satisfied: boolean;
}

export interface BatchSignResult {
  results: Array<{
    index: number;
    ok: boolean;
    txId: string | null;
    digestHex: string | null;
    error: string | null;
    broadcastResult: { txId: string; blockNum?: number } | null;
  }>;
  succeeded: number;
  failed: number;
}

export interface CrossChainSignature {
  sourceNetwork: NetworkId;
  targetNetwork: NetworkId;
  source: SignatureRecord | null;
  target: SignatureRecord | null;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Backup & recovery (layer 5)
// ---------------------------------------------------------------------------

export type ContactMethod = "email" | "phone" | "on_chain" | "in_person";

export interface RecoveryContact {
  id: string;
  name: string;
  contactMethod: ContactMethod;
  contactInfo: string;
  /** Public key (or account handle for on_chain) used to wrap their share. */
  publicKey: string;
  trustLevel: "high" | "medium" | "low";
  lastVerified: number;
}

export interface Beneficiary {
  name: string;
  account: string;
  sharePercent: number;
}

export interface DeadManConfig {
  enabled: boolean;
  /** Silence window in days before the switch trips. */
  inactiveDays: number;
  beneficiaries: Beneficiary[];
  /** Epoch ms of last confirmed activity (updated on every sign/unlock). */
  lastHeartbeat: number;
}

export interface BackupPackage {
  format: "saos-vault-backup";
  version: 1;
  createdAt: number;
  /** The encrypted state document (EncryptedPayload JSON, sealed under password). */
  encryptedState: EncryptedPayload;
  /** Optional Shamir shards of the backup wrapping key. */
  shards?: Array<{ index: number; data: string }>;
  sharding?: { threshold: number; total: number };
  metadata: {
    networks: NetworkId[];
    vaultCount: number;
    keyCount: number;
    checksum: string; // sha256 of encryptedState JSON, hex
  };
  /** HMAC-SHA256 over canonical package bytes (integrity of the package itself). */
  signature: string; // base64
}

export interface RecoverySession {
  id: string;
  initiatedAt: number;
  expiresAt: number;
  threshold: number;
  receivedShares: Array<{ contactId: string; share: Share }>;
  status: "pending" | "complete" | "expired";
}

// ---------------------------------------------------------------------------
// Audit & compliance (layer 6)
// ---------------------------------------------------------------------------

export type AuditEventType =
  | "vault_created"
  | "vault_unlocked"
  | "vault_locked"
  | "vault_locked_auto"
  | "key_added"
  | "key_removed"
  | "key_used"
  | "vault_created_network"
  | "vault_created_soldier"
  | "vault_created_purpose"
  | "signing_attempt"
  | "broadcast"
  | "policy_violation"
  | "policy_updated"
  | "backup_created"
  | "backup_restored"
  | "recovery_initiated"
  | "deadman_updated"
  | "integrity_verified";

export interface AuditActor {
  vaultId?: string;
  keyId?: string;
  ipAddress?: string;
  deviceId?: string;
  location?: string;
}

export interface AuditTarget {
  vaultId?: string;
  keyId?: string;
  operation?: PolicyOperation;
  detail?: Record<string, unknown>;
}

export interface AuditEvent {
  id: string;
  seq: number;
  timestamp: number;
  type: AuditEventType;
  actor: AuditActor;
  target: AuditTarget;
  result: "success" | "failure" | "blocked";
  reason?: string;
  previousEventHash: string;
  eventHash: string;
}

export interface AuditQueryFilters {
  types?: AuditEventType[];
  vaultId?: string;
  from?: number;
  to?: number;
  result?: "success" | "failure" | "blocked";
  limit?: number;
  offset?: number;
}

export type ComplianceReportFormat = "json" | "csv" | "pdf";

export interface ComplianceReport {
  period: { start: number; end: number };
  format: ComplianceReportFormat;
  /** json → pretty JSON; csv → RFC-4180-ish text; pdf → base64 of the PDF bytes. */
  body: string;
  eventCount: number;
  generatedAt: number;
  /** Chain head hash at generation time — binds the report to an audited state. */
  headHash: string;
  integrityOk: boolean;
}

// ---------------------------------------------------------------------------
// Status snapshot — secret-free summary for dashboards/polling
// ---------------------------------------------------------------------------

/** Summarized, non-secret view of the vault (consumed by UI status widgets). */
export interface VaultStatus {
  initialized: boolean;
  locked: boolean;
  autoLockSeconds: number;
  /** Epoch ms when the unlocked session auto-locks; null while locked. */
  autoLocksAt: number | null;
  createdAt: number | null;
  /** 0–100 heuristic security score computed from real configuration. */
  securityScore: number;
  /** Actionable findings (never secrets). */
  securityFindings: string[];
  counts: {
    networks: number;
    soldiers: number;
    purposes: number;
    keys: number;
    activeKeys: number;
    guardians: number;
  };
  networks: NetworkId[];
  lastSigningAt: number | null;
  lastBackupAt: number | null;
  deadManSwitch: DeadManConfig | null;
  auditHeadHash: string | null;
  auditEventCount: number;
  auditIntegrityOk: boolean;
}

// ---------------------------------------------------------------------------
// Errors — typed, catchable, never leak key material
// ---------------------------------------------------------------------------

export type VaultErrorCode =
  | "VAULT_EXISTS"
  | "VAULT_NOT_INITIALIZED"
  | "VAULT_LOCKED"
  | "VAULT_ALREADY_UNLOCKED"
  | "WRONG_PASSWORD"
  | "KEY_NOT_FOUND"
  | "KEY_REVOKED"
  | "VAULT_NOT_FOUND"
  | "POLICY_DENIED"
  | "POLICY_STEP_UP_REQUIRED"
  | "ADAPTER_MISSING"
  | "ADAPTER_INCAPABLE"
  | "NETWORK_OFFLINE"
  | "STORAGE_FAILURE"
  | "CORRUPT_STATE"
  | "VALIDATION"
  | "DECRYPTION_FAILED"
  | "SHAMIR_INVALID"
  | "RATE_LIMITED"
  | "TIMED_LOCK";

export class VaultError extends Error {
  constructor(
    readonly code: VaultErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "VaultError";
  }
}
