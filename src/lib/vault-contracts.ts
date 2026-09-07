/**
 * Sovereign Key Vault — HTTP API contracts (M2)
 * =============================================
 * The single source of truth for every /api/vault/* request and response.
 * Task 4-a (routes) and Task 4-b (UI hooks/components) both import from here;
 * neither may drift from these shapes.
 *
 * Conventions:
 *  - Every response: { ok: true, ...payload } or { ok: false, error, code?, decision? }.
 *  - Amounts are satoshi decimal strings; AssetAmount carries precision/symbol.
 *  - Passwords travel ONLY in request bodies over the local gateway, never
 *    logged, never echoed back.
 */

import type {
  AnomalyScore,
  AssetAmount,
  AuditEvent,
  BackupPackage,
  ComplianceReport,
  ComplianceReportFormat,
  DeadManConfig,
  EncryptedKey,
  KeyRole,
  NetworkId,
  NetworkVaultConfig,
  OperationContext,
  PolicyDecision,
  PolicyRuleSet,
  PurposeVaultConfig,
  RecoveryContact,
  Share,
  SimulationResult,
  SoldierVaultConfig,
  VaultErrorCode,
  VaultStateDoc,
  VaultStatus,
} from "../../packages/core/src/types";

export type { AnomalyScore, AssetAmount, AuditEvent, BackupPackage, ComplianceReport, DeadManConfig, EncryptedKey, NetworkId, NetworkVaultConfig, PolicyDecision, PolicyRuleSet, PurposeVaultConfig, RecoveryContact, Share, SimulationResult, SoldierVaultConfig, VaultErrorCode, VaultStateDoc, VaultStatus };

export type StatusResponse = { ok: true; status: VaultStatus };

export type ApiError = {
  ok: false;
  error: string;
  code?: VaultErrorCode;
  decision?: PolicyDecision;
};

// ---------------------------------------------------------------------------
// POST /api/vault/init — first-time setup (wizard step 2–5)
// ---------------------------------------------------------------------------

export interface InitRequest {
  password: string;
  /** Optional daily-limit overrides applied to the steem network vault. */
  steemDailyLimitSatoshis?: string;
  /** Wizard soldier defaults: first N may trade, none may transfer. */
  soldierCount?: number; // default 13
  traderSoldiers?: number; // default 5
}

export type InitResponse = { ok: true; status: VaultStatus; recoveryPhraseShare: string | null };

// ---------------------------------------------------------------------------
// POST /api/vault/unlock — { password }
// POST /api/vault/lock   — {}
// ---------------------------------------------------------------------------

export interface UnlockRequest {
  password: string;
}

export type UnlockResponse = { ok: true; status: VaultStatus };
export type LockResponse = { ok: true; status: VaultStatus };

// ---------------------------------------------------------------------------
// GET  /api/vault/keys           — list encrypted key metadata (never secrets)
// POST /api/vault/keys           — import/derive a key
// DELETE /api/vault/keys?id=     — revoke a key
// ---------------------------------------------------------------------------

export interface KeyListResponse {
  ok: true;
  keys: Array<Pick<EncryptedKey, "keyId" | "vaultId" | "network" | "role" | "account" | "label" | "publicKey" | "storage" | "createdAt" | "lastUsedAt" | "status">>;
}

export type ImportKeyMode = "derive" | "wif";

export interface ImportKeyRequest {
  mode: ImportKeyMode;
  /** "derive": derive from account master password (Steem scheme). */
  account?: string;
  masterPassword?: string;
  /** "wif": import an existing WIF. */
  wif?: string;
  network: NetworkId;
  roles: KeyRole[];
  storage?: "hot" | "cold";
  /** Password re-entry (step-up) — required to seal new key material. */
  password: string;
}

export type ImportKeyResponse = { ok: true; imported: number; keys: KeyListResponse["keys"] };

export type RevokeKeyRequest = { keyId: string; password: string };
export type RevokeKeyResponse = { ok: true };

// ---------------------------------------------------------------------------
// POST /api/vault/networks — create/overwrite a network vault config
// POST /api/vault/soldiers — bulk configure soldier permissions
// ---------------------------------------------------------------------------

export interface UpsertNetworkRequest {
  network: NetworkId;
  roles?: KeyRole[];
  allowedOperations?: string[];
  maxAmountPerDay?: Record<string, string>;
  storage?: "hot" | "cold" | "air-gapped";
  status?: "active" | "offline";
}

export type UpsertNetworkResponse = { ok: true; network: NetworkVaultConfig };

export interface SoldierPermissionsInput {
  soldierName: string;
  canTrade: boolean;
  canVote: boolean;
  canComment: boolean;
  canTransfer: boolean;
  maxTransferSatoshis: string;
}

export interface UpsertSoldiersRequest {
  soldiers: SoldierPermissionsInput[];
}

export type UpsertSoldiersResponse = { ok: true; soldiers: SoldierVaultConfig[] };

// ---------------------------------------------------------------------------
// GET  /api/vault/policy — full rule set + static rule catalog
// PUT  /api/vault/policy — replace dynamic/contextual/composite sets
// ---------------------------------------------------------------------------

export interface PolicyResponse {
  ok: true;
  rules: PolicyRuleSet;
  staticRules: Array<{ id: string; name: string; description: string }>;
}

export interface UpdatePolicyRequest {
  rules: PolicyRuleSet;
}

export type UpdatePolicyResponse = { ok: true; rules: PolicyRuleSet };

// ---------------------------------------------------------------------------
// POST /api/vault/simulate — dry-run: policy + balance + risk, nothing signed
// ---------------------------------------------------------------------------

export interface SimulateOrderRequest {
  network: NetworkId;
  /** Steem DEX order spec (limit_order_create) — rebuilt server-side. */
  account: string;
  side: "buy" | "sell";
  amount: string; // "12.345" STEEM
  price: string; // "0.098765" SBD per STEEM
  fillOrKill?: boolean;
  ttlSeconds?: number;
}

export type SimulateResponse = { ok: true; simulation: SimulationResult };

// ---------------------------------------------------------------------------
// POST /api/vault/sign — policy → unlock check → sign → optional broadcast
// ---------------------------------------------------------------------------

export interface SignOrderRequest {
  network: NetworkId;
  account: string;
  side: "buy" | "sell";
  amount: string;
  price: string;
  fillOrKill?: boolean;
  ttlSeconds?: number;
  /** Deterministic rebuild inputs echoed from the build preview. */
  orderid: number;
  orderExpiration: number; // epoch seconds
  /** Step-up password — required when the vault is locked or rule demands it. */
  password?: string;
  /** false (default) → signed-only; true → broadcast via the gated adapter. */
  broadcast?: boolean;
}

export interface SignOrderResponse {
  ok: true;
  decision: PolicyDecision;
  digestHex: string;
  serializedHex: string;
  signatureHex: string;
  publicKey: string;
  txId: string;
  byteLength: number;
  broadcast: { txId: string; blockNum?: number } | null;
}

// ---------------------------------------------------------------------------
// GET  /api/vault/backup — package preview metadata
// POST /api/vault/backup — create backup package (password re-entry)
// POST /api/vault/restore — restore from package JSON (fresh state only)
// ---------------------------------------------------------------------------

export interface CreateBackupRequest {
  password: string;
  shardThreshold?: number; // 0 = no sharding
  shardTotal?: number;
}

export interface CreateBackupResponse {
  ok: true;
  backup: BackupPackage;
  shards: Share[]; // empty when unsharded
}

export interface RestoreBackupRequest {
  backup: BackupPackage;
  /** Either the original password, or enough Shamir shards to reconstruct. */
  password?: string;
  shards?: Share[];
}

export type RestoreBackupResponse = { ok: true; status: VaultStatus };

// ---------------------------------------------------------------------------
// POST /api/vault/social-recovery — configure contacts / initiate session
// ---------------------------------------------------------------------------

export interface SetupSocialRecoveryRequest {
  contacts: RecoveryContact[];
  threshold: number;
  password: string;
}

export type SetupSocialRecoveryResponse = { ok: true; shares: Array<{ contactId: string; share: Share }> };

export interface StartRecoveryRequest {
  /** Dead-man / recovery kickoff: receives shares until threshold met. */
  shares: Array<{ contactId: string; share: Share }>;
}

export type StartRecoveryResponse = { ok: true; complete: boolean; threshold: number; received: number };

// ---------------------------------------------------------------------------
// PUT /api/vault/deadman — configure dead-man switch
// ---------------------------------------------------------------------------

export interface DeadManRequest {
  enabled: boolean;
  inactiveDays: number;
  beneficiaries: Array<{ name: string; account: string; sharePercent: number }>;
  password: string;
}

export type DeadManResponse = { ok: true; deadManSwitch: DeadManConfig; overdue: boolean };

// ---------------------------------------------------------------------------
// GET /api/vault/audit?limit=&offset=&type=&result= — query the chain
// GET /api/vault/audit?verify=1                     — integrity walk
// GET /api/vault/audit?report=json|csv|pdf&from=&to= — compliance report
// ---------------------------------------------------------------------------

export interface AuditResponse {
  ok: true;
  events: AuditEvent[];
  total: number;
  headHash: string;
  integrityOk: boolean;
}

export interface AuditVerifyResponse {
  ok: true;
  integrityOk: boolean;
  eventsChecked: number;
  firstBadSeq: number | null;
}

export interface AuditReportRequest {
  format: ComplianceReportFormat;
  from?: number;
  to?: number;
}

export type AuditReportResponse = { ok: true; report: ComplianceReport };
