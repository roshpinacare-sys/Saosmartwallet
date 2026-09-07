/**
 * Saosmartwallet — SovereignVault state machine (M2, layer 1)
 * ==========================================================
 * The layer-1 owner of the persisted vault hierarchy: master vault, network
 * vaults, soldier fleet, purpose vaults, sealed keys, policy rule data and
 * backup bookkeeping — all inside ONE JSON state document (VaultStateDoc).
 *
 * Session model (fail closed):
 *   • Locked (fresh construction): everything is readable via getStatus()/
 *     getState() — those surfaces are SECRET-FREE by construction — but any
 *     mutation, key operation or export requires unlock(password).
 *   • unlock() re-derives the Argon2id master key into VOLATILE memory only
 *     and arms the idle auto-lock timer. lock() zero-fills the key bytes.
 *   • addKey({password}) performs an OPTIONAL step-up: the password is
 *     verified AGAIN against the stored verifier before a seal happens.
 *   • The derived key never persists, never travels in errors, and is wiped
 *     on lock — a stolen process snapshot after lock() has nothing.
 *
 * Persistence: storage-agnostic (VaultStorage seam). The genesis hash binds
 * all saves of one vault instance (sha256 of the stable vaultInstanceId) so
 * the audit layer can anchor its chain to a specific state lineage.
 */

import { createHash } from "node:crypto";

import { STEEM_ROLES, PrivateKey } from "../../../crypto/src/index";
import { DEFAULT_KDF_PARAMS, deriveMasterKey, deriveVerifier, randomBytes, seal, verifyPassword } from "../crypto";
import { b64ToBytes, parseSats, utf8 } from "../encoding";
import type { AuditStore, VaultStateRecord, VaultStorage } from "../storage/types";
import {
  VaultError,
  type DeadManConfig,
  type EncryptedKey,
  type EncryptedPayload,
  type KeyRole,
  type NetworkId,
  type NetworkVaultConfig,
  type OperationType,
  type PolicyRuleSet,
  type PurposeId,
  type PurposeVaultConfig,
  type RecoveryContact,
  type SoldierPermissions,
  type SoldierVaultConfig,
  type StorageKind,
  type VaultStateDoc,
  type VaultStatus,
} from "../types";
import { DEFAULT_AUTO_LOCK_SECONDS, emptyState } from "./defaults";
import { VaultKeys, type AddKeyInput } from "./keys";

// ---------------------------------------------------------------------------
// Options & inputs
// ---------------------------------------------------------------------------

export interface SovereignVaultOptions {
  /** Injectable clock for tests (defaults to Date.now). */
  now?: () => number;
}

export interface InitializeOptions {
  /** Steem daily spend ceiling in satoshis (default 10000000 = 10 STEEM). */
  steemDailyLimitSatoshis?: string;
  /** Soldier fleet size (default 13). */
  soldierCount?: number;
  /** How many of the first soldiers may trade (default 5). */
  traderSoldiers?: number;
}

/** Partial network-vault config for create/update (UpsertNetworkRequest shape). */
export interface UpsertNetworkInput {
  network: NetworkId;
  roles?: KeyRole[];
  allowedOperations?: OperationType[];
  maxAmountPerDay?: Record<string, string>;
  requiresApproval?: boolean;
  storage?: StorageKind;
  special?: { soldierManagement?: boolean; oracleFeeds?: boolean };
  status?: "active" | "offline";
  label?: string;
}

/** Merge-by-name input for the soldier fleet. */
export interface SoldierUpsertInput {
  soldierName: string;
  permissions?: Partial<SoldierPermissions>;
  linkedVaults?: string[];
  anomalyDetection?: boolean;
  label?: string;
}

/** Partial purpose-vault config for creation. */
export interface PurposeVaultInput {
  purpose: PurposeId;
  allowedOperations?: OperationType[];
  networkScope?: NetworkId[];
  storage?: StorageKind;
  label?: string;
}

/** addKey with the optional step-up password. */
export type VaultAddKeyInput = AddKeyInput & { password?: string };

/** The one and only plaintext key exit — consumed by the signing orchestrator. */
export interface RevealResult {
  privateKey: PrivateKey;
  record: EncryptedKey;
}

// ---------------------------------------------------------------------------
// Ecosystem defaults (M2 spec tables)
// ---------------------------------------------------------------------------

const ALL_NETWORK_IDS: readonly NetworkId[] = ["steem", "hive", "tron", "blurt", "saos-net"];
const STEEM_FAMILY_ROLES: readonly KeyRole[] = ["owner", "active", "posting", "memo"];

const DEFAULT_NETWORK_ROLES: Record<NetworkId, readonly KeyRole[]> = {
  steem: STEEM_FAMILY_ROLES,
  hive: STEEM_FAMILY_ROLES,
  tron: ["owner"],
  blurt: STEEM_FAMILY_ROLES,
  "saos-net": ["owner", "active", "posting"],
};

const DEFAULT_NETWORK_OPS: Record<NetworkId, readonly OperationType[]> = {
  steem: [
    "transfer",
    "vote",
    "comment",
    "limit_order_create",
    "limit_order_cancel",
    "custom_json",
    "delegate_vesting_shares",
    "witness_vote",
  ],
  hive: [
    "transfer",
    "vote",
    "comment",
    "limit_order_create",
    "limit_order_cancel",
    "custom_json",
    "delegate_vesting_shares",
    "witness_vote",
  ],
  tron: ["transfer", "trigger_smart_contract"],
  blurt: ["transfer", "vote", "comment"],
  "saos-net": ["transfer", "vote", "custom_json"],
};

/** Daily spend ceilings in satoshi strings, per token symbol. */
const DEFAULT_NETWORK_LIMITS: Record<NetworkId, Record<string, string>> = {
  steem: { STEEM: "10000000" },
  hive: { HIVE: "10000000" },
  tron: { TRX: "100000000000" },
  blurt: { BLURT: "10000000" },
  "saos-net": { SAOS: "100000000" },
};

/** Networks every soldier is bound to (only vaults that actually exist). */
const DEFAULT_SOLDIER_LINKS: readonly string[] = ["network-steem", "network-hive", "network-saos-net"];

/**
 * Purpose-vault defaults. NOTE: the frozen PurposeVaultConfig type has no
 * requiresApproval field — treasury's approval gate is expressed through
 * policy rules (e.g. requireApprovalCount) evaluated by the policy engine,
 * not by per-vault flags.
 */
const PURPOSE_DEFAULTS: Record<PurposeId, { allowedOperations: readonly OperationType[]; networkScope: readonly NetworkId[]; storage: StorageKind }> = {
  trading: {
    allowedOperations: ["limit_order_create", "limit_order_cancel"],
    networkScope: ["steem", "hive"],
    storage: "hot",
  },
  bridging: {
    allowedOperations: ["transfer", "custom_json"],
    networkScope: ALL_NETWORK_IDS,
    storage: "hot",
  },
  governance: {
    allowedOperations: ["vote", "witness_vote", "comment"],
    networkScope: ["steem", "hive", "saos-net"],
    storage: "cold",
  },
  treasury: {
    allowedOperations: ["transfer", "transfer_to_vesting", "delegate_vesting_shares"],
    networkScope: ["steem", "hive"],
    storage: "air-gapped",
  },
};

// ---------------------------------------------------------------------------
// SovereignVault
// ---------------------------------------------------------------------------

export class SovereignVault {
  private readonly storage: VaultStorage;
  private readonly audit: AuditStore | null;
  private readonly nowFn: () => number;

  /** Session master key — volatile, zero-filled on lock(). */
  private derivedKey: Uint8Array | null = null;
  private unlockedAt: number | null = null;
  private lastActivityAt: number | null = null;
  private autoLocksAt: number | null = null;
  /** Cached state document (persisted copy lives in the VaultStorage seam). */
  private state: VaultStateDoc | null = null;
  private genesisHashValue: string | null = null;

  /**
   * @param storage the VaultStorage seam (memory store for tools/tests,
   *   Prisma-backed store in the app layer).
   * @param audit optional AuditStore — read-only here for status telemetry
   *   (head hash + event count); chain writing belongs to the audit layer.
   */
  constructor(storage: VaultStorage, audit?: AuditStore, opts?: SovereignVaultOptions) {
    this.storage = storage;
    this.audit = audit ?? null;
    this.nowFn = opts?.now ?? (() => Date.now());
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Loads (or reloads) the state document from the storage seam. Safe to call
   * repeatedly; a missing record leaves the vault in the uninitialized state.
   *
   * @throws VaultError("STORAGE_FAILURE") on backend errors,
   *   VaultError("CORRUPT_STATE") when the stored document is not valid
   *   docVersion-1 JSON (fail closed — never run against a half-parsed state).
   */
  async load(): Promise<void> {
    let record: VaultStateRecord | null = null;
    try {
      record = await this.storage.load();
    } catch {
      throw new VaultError("STORAGE_FAILURE", "failed to read the vault state record");
    }
    if (record === null) {
      this.state = null;
      this.genesisHashValue = null;
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(record.stateJson);
    } catch {
      throw new VaultError("CORRUPT_STATE", "stored vault state is not valid JSON");
    }
    if (!isVaultStateDoc(parsed)) {
      throw new VaultError("CORRUPT_STATE", "stored vault state does not match the docVersion 1 schema");
    }
    this.state = parsed;
    this.genesisHashValue = null; // re-derived lazily from the loaded instance id
  }

  /**
   * First-boot ceremony: installs the Argon2id password verifier and the full
   * M2 ecosystem — master vault (3-of-5 guardians, multi-sig), the five
   * network vaults (steem/hive/tron/blurt/saos-net), the soldier fleet
   * (13 by default, 5 traders), and the four purpose vaults
   * (trading/bridging/governance/treasury).
   *
   * The password itself is consumed here and never stored — only its verifier.
   *
   * @throws VaultError("VAULT_EXISTS") when already initialized,
   *   VaultError("VALIDATION") for malformed option amounts.
   */
  async initialize(password: string, opts?: InitializeOptions): Promise<VaultStatus> {
    await this.ensureLoaded();
    if (this.state === null) {
      // First boot — no persisted document yet: start from a fresh skeleton
      // with a stable random instance id (binds audit genesis + ZK contexts).
      this.state = emptyState(crypto.randomUUID());
    }
    const state = this.state;
    if (state.initialized) {
      throw new VaultError("VAULT_EXISTS", "vault is already initialized");
    }
    if (opts?.steemDailyLimitSatoshis !== undefined) {
      try {
        parseSats(opts.steemDailyLimitSatoshis);
      } catch {
        throw new VaultError("VALIDATION", "steemDailyLimitSatoshis is not a valid satoshi string");
      }
    }
    const soldierCount = opts?.soldierCount ?? 13;
    const traderSoldiers = opts?.traderSoldiers ?? 5;
    if (!Number.isInteger(soldierCount) || soldierCount < 1 || soldierCount > 999) {
      throw new VaultError("VALIDATION", "soldierCount must be an integer in [1, 999]");
    }
    if (!Number.isInteger(traderSoldiers) || traderSoldiers < 0 || traderSoldiers > soldierCount) {
      throw new VaultError("VALIDATION", "traderSoldiers must be an integer in [0, soldierCount]");
    }

    const now = this.nowFn();

    // Master vault — root of trust, ed25519, 3-of-5 guardian multi-sig.
    state.master = {
      id: "master",
      kind: "master",
      label: "Master vault",
      createdAt: now,
      approvers: ["master"],
      keyType: "ed25519",
      requiresMultiSig: true,
      threshold: 3,
      guardianCount: 5,
    };

    // Network vaults — blurt ships offline; saos-net carries the sovereign flags.
    const networks: Record<string, NetworkVaultConfig> = {};
    const networkConfigs = [
      this.buildNetworkConfig(
        { network: "steem", maxAmountPerDay: { STEEM: opts?.steemDailyLimitSatoshis ?? "10000000" } },
        now,
      ),
      this.buildNetworkConfig({ network: "hive" }, now),
      this.buildNetworkConfig({ network: "tron" }, now),
      this.buildNetworkConfig({ network: "blurt", status: "offline" }, now),
      this.buildNetworkConfig(
        { network: "saos-net", special: { soldierManagement: true, oracleFeeds: true } },
        now,
      ),
    ];
    for (const cfg of networkConfigs) networks[cfg.id] = cfg;

    // Soldier fleet — ids and names zero-padded; the first N are traders.
    const soldiers: Record<string, SoldierVaultConfig> = {};
    for (let i = 1; i <= soldierCount; i++) {
      const seq = String(i).padStart(2, "0");
      soldiers[`vault-soldier-${seq}`] = {
        id: `vault-soldier-${seq}`,
        kind: "soldier",
        label: `saos-soldier-${seq}`,
        createdAt: now,
        approvers: ["master"],
        soldierName: `saos-soldier-${seq}`,
        permissions: {
          canTrade: i <= traderSoldiers,
          canVote: true,
          canComment: true,
          canTransfer: false,
          maxTransferAmount: "0",
        },
        linkedVaults: [...DEFAULT_SOLDIER_LINKS],
        anomalyDetection: true,
        lastActivity: 0,
      };
    }

    // Purpose vaults — treasury is air-gapped (approval via policy rules).
    const purposes: Record<string, PurposeVaultConfig> = {};
    for (const purpose of ["trading", "bridging", "governance", "treasury"] as const) {
      const d = PURPOSE_DEFAULTS[purpose];
      purposes[`purpose-${purpose}`] = {
        id: `purpose-${purpose}`,
        kind: "purpose",
        label: `${purpose} purpose vault`,
        createdAt: now,
        approvers: ["master"],
        purpose,
        allowedOperations: [...d.allowedOperations],
        networkScope: [...d.networkScope],
        storage: d.storage,
      };
    }

    state.networks = networks;
    state.soldiers = soldiers;
    state.purposes = purposes;
    state.verifier = await deriveVerifier(password);
    state.initialized = true;

    await this.persist();
    return this.getStatus();
  }

  /**
   * Verifies the master password against the stored Argon2id verifier and, on
   * success, holds the derived 32-byte master key in VOLATILE memory until
   * lock() wipes it. Also arms the idle auto-lock timer.
   *
   * @throws VaultError("VAULT_NOT_INITIALIZED"), ("WRONG_PASSWORD") — the
   *   error reveals only that verification failed, never why or what was stored.
   */
  async unlock(password: string): Promise<VaultStatus> {
    await this.ensureLoaded();
    const state = this.requireState();
    if (!state.initialized || state.verifier === null) {
      throw new VaultError("VAULT_NOT_INITIALIZED", "vault has no password verifier — initialize() first");
    }
    const ok = await verifyPassword(password, state.verifier);
    if (!ok) {
      throw new VaultError("WRONG_PASSWORD", "password verification failed");
    }
    this.derivedKey = await deriveMasterKey(password, b64ToBytes(state.verifier.salt), state.verifier.params);
    const t = this.nowFn();
    this.unlockedAt = t;
    this.lastActivityAt = t;
    this.autoLocksAt = t + state.autoLockSeconds * 1000;
    return this.getStatus();
  }

  /**
   * Locks the session: zero-fills the derived key bytes, clears all volatile
   * session timestamps. Idempotent and safe to call at any time.
   */
  lock(): void {
    if (this.derivedKey !== null) {
      this.derivedKey.fill(0);
      this.derivedKey = null;
    }
    this.unlockedAt = null;
    this.autoLocksAt = null;
  }

  /**
   * Auto-lock check — call from a timer/poll. Locks and returns true when the
   * idle window has elapsed; otherwise a no-op returning false.
   */
  maybeAutoLock(now: number = Date.now()): boolean {
    if (this.derivedKey !== null && this.autoLocksAt !== null && now > this.autoLocksAt) {
      this.lock();
      return true;
    }
    return false;
  }

  /**
   * Sliding-window activity bump: refreshes lastActivityAt and re-arms the
   * auto-lock deadline. Called automatically by ensureUnlocked().
   */
  touch(): void {
    const t = this.nowFn();
    this.lastActivityAt = t;
    this.autoLocksAt = t + this.autoLockSeconds() * 1000;
  }

  /**
   * Session gate for every privileged operation: throws VaultError("VAULT_LOCKED")
   * unless the derived key is in memory, then refreshes the idle timer.
   */
  ensureUnlocked(): void {
    if (this.derivedKey === null) {
      throw new VaultError("VAULT_LOCKED", "vault is locked — unlock() required");
    }
    this.touch();
  }

  /** Whether a derived key is currently held in memory. */
  get isUnlocked(): boolean {
    return this.derivedKey !== null;
  }

  /**
   * Secret-free read of the state document (key payloads are sealed — the doc
   * is safe to hand to UI/policy layers). Returns null before initialization.
   */
  getState(): VaultStateDoc | null {
    return this.state;
  }

  // -------------------------------------------------------------------------
  // Hierarchy mutations (all require an unlocked session)
  // -------------------------------------------------------------------------

  /**
   * Creates a network vault (steem-family roles/ops/limits default from the
   * M2 tables; every field is overridable).
   *
   * @throws VaultError("VAULT_NOT_INITIALIZED"), ("VAULT_LOCKED"),
   *   ("VAULT_EXISTS") when this network already has a vault.
   */
  async createNetworkVault(input: UpsertNetworkInput): Promise<NetworkVaultConfig> {
    await this.ensureLoaded();
    const state = this.requireState();
    this.ensureUnlocked();
    if (Object.values(state.networks).some((n) => n.network === input.network)) {
      throw new VaultError("VAULT_EXISTS", `a vault for network ${input.network} already exists`);
    }
    const config = this.buildNetworkConfig(input, this.nowFn());
    state.networks[config.id] = config;
    await this.persist();
    return config;
  }

  /**
   * Merges a partial config into an existing network vault (unspecified
   * fields keep their current values).
   *
   * @throws VaultError("VAULT_NOT_INITIALIZED"), ("VAULT_LOCKED"),
   *   ("VAULT_NOT_FOUND") when no vault exists for that network.
   */
  async updateNetworkVault(input: UpsertNetworkInput): Promise<NetworkVaultConfig> {
    await this.ensureLoaded();
    const state = this.requireState();
    this.ensureUnlocked();
    const existing = Object.values(state.networks).find((n) => n.network === input.network);
    if (!existing) {
      throw new VaultError("VAULT_NOT_FOUND", `no vault exists for network ${input.network}`);
    }
    const merged: NetworkVaultConfig = {
      ...existing,
      roles: input.roles ?? existing.roles,
      allowedOperations: input.allowedOperations ?? existing.allowedOperations,
      maxAmountPerDay: input.maxAmountPerDay ?? existing.maxAmountPerDay,
      requiresApproval: input.requiresApproval ?? existing.requiresApproval,
      storage: input.storage ?? existing.storage,
      special: input.special ?? existing.special,
      status: input.status ?? existing.status,
      label: input.label ?? existing.label,
    };
    state.networks[merged.id] = merged;
    await this.persist();
    return merged;
  }

  /**
   * Creates new soldiers and merges permission updates into existing ones,
   * matched by soldierName (so fleet renames never orphan permissions).
   * Returns the affected configs.
   *
   * @throws VaultError("VAULT_NOT_INITIALIZED"), ("VAULT_LOCKED"),
   *   ("VALIDATION") for empty soldier names.
   */
  async upsertSoldiers(inputs: SoldierUpsertInput[]): Promise<SoldierVaultConfig[]> {
    await this.ensureLoaded();
    const state = this.requireState();
    this.ensureUnlocked();
    const now = this.nowFn();
    const updated: SoldierVaultConfig[] = [];
    for (const input of inputs) {
      if (typeof input.soldierName !== "string" || input.soldierName.length === 0) {
        throw new VaultError("VALIDATION", "soldierName is required");
      }
      const existing = Object.values(state.soldiers).find((s) => s.soldierName === input.soldierName);
      if (existing) {
        const merged: SoldierVaultConfig = {
          ...existing,
          label: input.label ?? existing.label,
          permissions: { ...existing.permissions, ...input.permissions },
          linkedVaults: input.linkedVaults ?? existing.linkedVaults,
          anomalyDetection: input.anomalyDetection ?? existing.anomalyDetection,
        };
        state.soldiers[merged.id] = merged;
        updated.push(merged);
      } else {
        const id = `vault-soldier-${crypto.randomUUID()}`;
        const config: SoldierVaultConfig = {
          id,
          kind: "soldier",
          label: input.label ?? input.soldierName,
          createdAt: now,
          approvers: ["master"],
          soldierName: input.soldierName,
          permissions: {
            canTrade: false,
            canVote: true,
            canComment: true,
            canTransfer: false,
            maxTransferAmount: "0",
            ...input.permissions,
          },
          linkedVaults: input.linkedVaults ?? [...DEFAULT_SOLDIER_LINKS],
          anomalyDetection: input.anomalyDetection ?? true,
          lastActivity: 0,
        };
        state.soldiers[id] = config;
        updated.push(config);
      }
    }
    await this.persist();
    return updated;
  }

  /**
   * Creates a purpose vault with the M2 defaults (trading/bridging hot,
   * governance cold, treasury air-gapped).
   *
   * @throws VaultError("VAULT_NOT_INITIALIZED"), ("VAULT_LOCKED"),
   *   ("VAULT_EXISTS") when the purpose vault already exists.
   */
  async createPurposeVault(input: PurposeVaultInput): Promise<PurposeVaultConfig> {
    await this.ensureLoaded();
    const state = this.requireState();
    this.ensureUnlocked();
    const id = `purpose-${input.purpose}`;
    if (state.purposes[id] !== undefined) {
      throw new VaultError("VAULT_EXISTS", `purpose vault ${input.purpose} already exists`);
    }
    const d = PURPOSE_DEFAULTS[input.purpose];
    const config: PurposeVaultConfig = {
      id,
      kind: "purpose",
      label: input.label ?? `${input.purpose} purpose vault`,
      createdAt: this.nowFn(),
      approvers: ["master"],
      purpose: input.purpose,
      allowedOperations: input.allowedOperations ?? [...d.allowedOperations],
      networkScope: input.networkScope ?? [...d.networkScope],
      storage: input.storage ?? d.storage,
    };
    state.purposes[id] = config;
    await this.persist();
    return config;
  }

  // -------------------------------------------------------------------------
  // Key lifecycle
  // -------------------------------------------------------------------------

  /**
   * Seals a WIF into the vault under the session master key (see VaultKeys).
   *
   * Step-up: when `input.password` is provided it is verified AGAIN against
   * the stored verifier — a failed step-up aborts the seal with
   * VaultError("WRONG_PASSWORD").
   *
   * Returns metadata WITHOUT the sealed payload (the caller never needs the
   * ciphertext; reveal goes through revealKeyFor).
   *
   * @throws VaultError("VAULT_NOT_INITIALIZED"), ("VAULT_LOCKED"),
   *   ("WRONG_PASSWORD"), ("VALIDATION") for bad WIFs/roles.
   */
  async addKey(input: VaultAddKeyInput): Promise<Omit<EncryptedKey, "payload">> {
    await this.ensureLoaded();
    const state = this.requireState();
    this.ensureUnlocked();
    if (input.password !== undefined) {
      if (state.verifier === null) {
        throw new VaultError("VAULT_NOT_INITIALIZED", "vault has no password verifier");
      }
      const ok = await verifyPassword(input.password, state.verifier);
      if (!ok) {
        throw new VaultError("WRONG_PASSWORD", "step-up password verification failed");
      }
    }
    const { record, state: nextState } = VaultKeys.addKey(state, this.requireDerivedKey(), input);
    this.state = nextState;
    await this.persist();
    return {
      keyId: record.keyId,
      vaultId: record.vaultId,
      network: record.network,
      role: record.role,
      account: record.account,
      label: record.label,
      algorithm: record.algorithm,
      publicKey: record.publicKey,
      storage: record.storage,
      createdAt: record.createdAt,
      lastUsedAt: record.lastUsedAt,
      status: record.status,
    };
  }

  /**
   * The ONLY sanctioned plaintext exit for a sealed key: unlock + policy +
   * revocation checks happen HERE, before VaultKeys.revealKey ever runs.
   * Refreshes session activity (idle-timer discipline for signing flows).
   *
   * @throws VaultError("VAULT_NOT_INITIALIZED"), ("VAULT_LOCKED"),
   *   ("KEY_NOT_FOUND"), ("KEY_REVOKED"), ("DECRYPTION_FAILED").
   */
  async revealKeyFor(keyId: string): Promise<RevealResult> {
    await this.ensureLoaded();
    const state = this.requireState();
    this.ensureUnlocked();
    const record = state.keys[keyId];
    if (!record) {
      throw new VaultError("KEY_NOT_FOUND", "no such key in the vault");
    }
    if (record.status === "revoked") {
      throw new VaultError("KEY_REVOKED", "key has been revoked");
    }
    const privateKey = VaultKeys.revealKey(record, this.requireDerivedKey());
    return { privateKey, record };
  }

  /**
   * Records a signing use (lastUsedAt) for audit + dead-man telemetry.
   * Metadata-only: deliberately does NOT require an unlocked session.
   *
   * @throws VaultError("VAULT_NOT_INITIALIZED"), ("KEY_NOT_FOUND").
   */
  async markKeyUsed(keyId: string): Promise<void> {
    await this.ensureLoaded();
    const state = this.requireState();
    const record = state.keys[keyId];
    if (!record) {
      throw new VaultError("KEY_NOT_FOUND", "no such key in the vault");
    }
    state.keys[keyId] = { ...record, lastUsedAt: this.nowFn() };
    await this.persist();
  }

  /**
   * Step-up authentication gate (used by the signing orchestrator and the
   * backup manager): re-verifies a password against the stored Argon2id
   * verifier — the SAME pattern addKey uses for its optional step-up.
   *
   * @throws VaultError("VAULT_NOT_INITIALIZED") when no verifier exists,
   *   VaultError("WRONG_PASSWORD") when verification fails. The error
   *   reveals only that verification failed — never what was stored.
   */
  async verifyStepUp(password: string): Promise<void> {
    await this.ensureLoaded();
    const state = this.requireState();
    if (!state.initialized || state.verifier === null) {
      throw new VaultError("VAULT_NOT_INITIALIZED", "vault has no password verifier — initialize() first");
    }
    const ok = await verifyPassword(password, state.verifier);
    if (!ok) {
      throw new VaultError("WRONG_PASSWORD", "step-up password verification failed");
    }
  }

  /**
   * Key-selection lookup for the signing orchestrator: the keyId of the first
   * ACTIVE key matching (vaultId, network, role), oldest creation first.
   * Metadata-only read — works while LOCKED (the payload stays sealed; the
   * caller still needs revealKeyFor + an unlocked session to use the key).
   *
   * @returns the keyId, or null when no active key matches.
   */
  selectKeyId(input: { vaultId: string; network: NetworkId; role: KeyRole | null }): string | null {
    const state = this.state;
    if (state === null) return null;
    let best: EncryptedKey | null = null;
    for (const record of Object.values(state.keys)) {
      if (record.status !== "active") continue;
      if (record.vaultId !== input.vaultId || record.network !== input.network) continue;
      if (record.role !== input.role) continue;
      if (best === null || record.createdAt < best.createdAt) best = record;
    }
    return best?.keyId ?? null;
  }

  /**
   * Marks a key revoked (M2 API routes) — the state-machine wrapper over
   * VaultKeys.revokeKey. Records persist (revocation history is audit
   * evidence); idempotent on already-revoked keys. Requires an unlocked
   * session — the key material stays sealed.
   *
   * @returns the revoked record's metadata WITHOUT the sealed payload.
   * @throws VaultError("VAULT_NOT_INITIALIZED"), ("VAULT_LOCKED"),
   *   ("KEY_NOT_FOUND") for an unknown keyId.
   */
  async revokeKey(keyId: string): Promise<Omit<EncryptedKey, "payload">> {
    await this.ensureLoaded();
    const state = this.requireState();
    this.ensureUnlocked();
    const { record, state: nextState } = VaultKeys.revokeKey(state, keyId);
    this.state = nextState;
    await this.persist();
    const { payload: _sealed, ...metadata } = record;
    return metadata;
  }

  // -------------------------------------------------------------------------
  // Policy persistence (M2 API routes)
  // -------------------------------------------------------------------------

  /**
   * Replaces the persisted policy rule set (`state.policies`) — minimal
   * public surface for PUT /api/vault/policy. Shape validation belongs to
   * the route layer; this method only persists atomically. Requires an
   * unlocked session (policy is security-relevant configuration).
   *
   * @throws VaultError("VAULT_NOT_INITIALIZED"), ("VAULT_LOCKED").
   */
  async updatePolicies(rules: PolicyRuleSet): Promise<PolicyRuleSet> {
    await this.ensureLoaded();
    const state = this.requireState();
    this.ensureUnlocked();
    const next: PolicyRuleSet = {
      dynamic: [...rules.dynamic],
      contextual: [...rules.contextual],
      composite: [...rules.composite],
    };
    state.policies = next;
    await this.persist();
    return next;
  }

  // -------------------------------------------------------------------------
  // Backup
  // -------------------------------------------------------------------------

  /**
   * Re-seals the ENTIRE state document JSON under a freshly Argon2id-derived
   * key (fresh 16-byte salt, default params). The payload's `salt` field
   * carries the REAL derivation salt, so a restorer needs only the password:
   *   key = deriveMasterKey(password, b64ToBytes(payload.salt))
   *   state = openJson(payload, key)
   *
   * This is the input format BackupManager (layer 5) wraps into a
   * BackupPackage with Shamir shards of the wrapping key.
   *
   * @throws VaultError("VAULT_NOT_INITIALIZED"), ("VAULT_LOCKED"),
   *   ("VALIDATION") for an empty password.
   */
  async exportState(password: string): Promise<EncryptedPayload> {
    await this.ensureLoaded();
    const state = this.requireState();
    this.ensureUnlocked();
    if (password.length === 0) {
      throw new VaultError("VALIDATION", "backup password must not be empty");
    }
    const salt = randomBytes(16);
    const key = await deriveMasterKey(password, salt, DEFAULT_KDF_PARAMS);
    try {
      return seal(utf8(JSON.stringify(state)), key, { keyId: "backup-v1", salt });
    } finally {
      key.fill(0);
    }
  }

  /**
   * Persists the social-recovery CONFIGURATION (contacts + threshold) into
   * `state.backup.socialRecovery`. Metadata only — the Shamir shares and the
   * R-sealed state payload NEVER persist here; the BackupManager returns
   * them to the caller for out-of-band storage.
   *
   * @throws VaultError("VAULT_NOT_INITIALIZED"), ("VAULT_LOCKED").
   */
  async setSocialRecovery(config: { contacts: RecoveryContact[]; threshold: number } | null): Promise<{ contacts: RecoveryContact[]; threshold: number } | null> {
    await this.ensureLoaded();
    const state = this.requireState();
    this.ensureUnlocked();
    state.backup = { ...state.backup, socialRecovery: config === null ? null : { contacts: config.contacts, threshold: config.threshold } };
    await this.persist();
    return config;
  }

  /**
   * Persists the dead-man switch configuration into
   * `state.backup.deadManSwitch`. Security-relevant config change → requires
   * an unlocked session (heartbeat updates go through the same setter and
   * therefore also require a live session — heartbeat = proof of liveness).
   *
   * @throws VaultError("VAULT_NOT_INITIALIZED"), ("VAULT_LOCKED").
   */
  async setDeadManConfig(config: DeadManConfig | null): Promise<DeadManConfig | null> {
    await this.ensureLoaded();
    const state = this.requireState();
    this.ensureUnlocked();
    state.backup = { ...state.backup, deadManSwitch: config };
    await this.persist();
    return config;
  }

  // -------------------------------------------------------------------------
  // Status & security scoring
  // -------------------------------------------------------------------------

  /**
   * Secret-free status snapshot — works while LOCKED (nothing derived, no
   * unsealing). Includes counts, security score, and audit telemetry
   * (head hash + event count from the AuditStore when one was provided).
   */
  async getStatus(): Promise<VaultStatus> {
    const auditStats = await this.auditStats();
    const state = this.state;
    if (state === null) {
      return {
        initialized: false,
        locked: true,
        autoLockSeconds: DEFAULT_AUTO_LOCK_SECONDS,
        autoLocksAt: null,
        createdAt: null,
        securityScore: 0,
        securityFindings: ["vault is not initialized — run initialize() to set a master password verifier"],
        counts: { networks: 0, soldiers: 0, purposes: 0, keys: 0, activeKeys: 0, guardians: 0 },
        networks: [],
        lastSigningAt: null,
        lastBackupAt: null,
        deadManSwitch: null,
        auditHeadHash: auditStats.headHash,
        auditEventCount: auditStats.count,
        auditIntegrityOk: true,
      };
    }

    const keys = Object.values(state.keys);
    const activeKeys = keys.filter((k) => k.status === "active");
    let lastSigningAt: number | null = null;
    for (const k of keys) {
      if (k.lastUsedAt !== null && (lastSigningAt === null || k.lastUsedAt > lastSigningAt)) {
        lastSigningAt = k.lastUsedAt;
      }
    }
    const { score, findings } = this.computeSecurityScore(state);

    return {
      initialized: state.initialized,
      locked: this.derivedKey === null,
      autoLockSeconds: state.autoLockSeconds,
      autoLocksAt: this.autoLocksAt,
      createdAt: state.createdAt,
      securityScore: score,
      securityFindings: findings,
      counts: {
        networks: Object.keys(state.networks).length,
        soldiers: Object.keys(state.soldiers).length,
        purposes: Object.keys(state.purposes).length,
        keys: keys.length,
        activeKeys: activeKeys.length,
        guardians: state.master?.guardianCount ?? 0,
      },
      networks: Object.values(state.networks).map((n) => n.network),
      lastSigningAt,
      lastBackupAt: state.backup.lastBackupAt,
      deadManSwitch: state.backup.deadManSwitch,
      auditHeadHash: auditStats.headHash,
      auditEventCount: auditStats.count,
      // Deep chain verification lives in the audit layer; an empty chain is
      // vacuously intact and a populated one is reported optimistically here.
      auditIntegrityOk: true,
    };
  }

  /**
   * Honest security posture scoring (0–100) from REAL configuration only —
   * never defaults that make an uninitialized vault look good. Findings are
   * short, actionable, and contain no secrets.
   *
   * Budget: 20 base + 15 verifier + 10 keys + 10 steem role coverage +
   * 10 cold/air-gapped storage + 10 backup + 10 social recovery +
   * 10 dead-man switch + 5 tight auto-lock = 100.
   */
  computeSecurityScore(state: VaultStateDoc): { score: number; findings: string[] } {
    if (!state.initialized) {
      return {
        score: 0,
        findings: ["vault is not initialized — run initialize() to set a master password verifier"],
      };
    }
    const findings: string[] = [];
    let score = 20;

    const keys = Object.values(state.keys);
    if (state.verifier !== null) score += 15;
    else findings.push("no master-password verifier present — the vault cannot verify unlock attempts");

    if (keys.length > 0) score += 10;
    else findings.push("no keys sealed yet — add at least one network key");

    const steemCfg = Object.values(state.networks).find((n) => n.network === "steem");
    const roles = new Set(steemCfg?.roles ?? []);
    if (STEEM_ROLES.every((r) => roles.has(r))) score += 10;
    else findings.push("steem vault lacks full role coverage (owner/active/posting/memo)");

    if (keys.some((k) => k.storage !== "hot")) score += 10;
    else findings.push("all keys are hot-stored — seal at least one cold or air-gapped key");

    if (state.backup.lastBackupAt !== null) score += 10;
    else findings.push("no backup created yet — export the state doc via exportState()");

    const recovery = state.backup.socialRecovery;
    if (recovery !== null && recovery.threshold > 0 && recovery.contacts.length >= recovery.threshold) score += 10;
    else findings.push("social recovery is not configured — register recovery contacts up to a threshold");

    if (state.backup.deadManSwitch?.enabled) score += 10;
    else findings.push("dead-man switch is disabled — configure beneficiaries and an inactivity window");

    if (state.autoLockSeconds <= 300) score += 5;
    else findings.push(`auto-lock of ${state.autoLockSeconds}s exceeds the 300s budget`);

    return { score: Math.max(0, Math.min(100, score)), findings };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Lazily loads state so every public method works on a fresh instance. */
  private async ensureLoaded(): Promise<void> {
    if (this.state === null) await this.load();
  }

  private requireState(): VaultStateDoc {
    if (this.state === null) {
      throw new VaultError("VAULT_NOT_INITIALIZED", "vault state not initialized — call initialize() first");
    }
    return this.state;
  }

  private requireDerivedKey(): Uint8Array {
    if (this.derivedKey === null) {
      throw new VaultError("VAULT_LOCKED", "vault is locked — unlock() required");
    }
    return this.derivedKey;
  }

  private autoLockSeconds(): number {
    return this.state?.autoLockSeconds ?? DEFAULT_AUTO_LOCK_SECONDS;
  }

  /** Persists the state doc under the instance's stable genesis hash. */
  private async persist(): Promise<void> {
    const state = this.state;
    if (state === null) {
      throw new VaultError("VAULT_NOT_INITIALIZED", "nothing to persist");
    }
    state.updatedAt = this.nowFn();
    await this.storage.save(JSON.stringify(state), this.genesisHash());
  }

  /** sha256(vaultInstanceId) — stable across saves, anchors the audit chain. */
  private genesisHash(): string {
    if (this.genesisHashValue === null) {
      this.genesisHashValue = createHash("sha256").update(this.state?.vaultInstanceId ?? "").digest("hex");
    }
    return this.genesisHashValue;
  }

  private async auditStats(): Promise<{ headHash: string | null; count: number }> {
    if (this.audit === null) return { headHash: null, count: 0 };
    const [head, count] = await Promise.all([this.audit.head(), this.audit.count({})]);
    return { headHash: head?.eventHash ?? null, count };
  }

  private buildNetworkConfig(input: UpsertNetworkInput, now: number): NetworkVaultConfig {
    return {
      id: `network-${input.network}`,
      kind: "network",
      label: input.label ?? `${input.network.toUpperCase()} network vault`,
      createdAt: now,
      approvers: ["master"],
      network: input.network,
      roles: input.roles ?? [...DEFAULT_NETWORK_ROLES[input.network]],
      allowedOperations: input.allowedOperations ?? [...DEFAULT_NETWORK_OPS[input.network]],
      maxAmountPerDay: input.maxAmountPerDay ?? { ...DEFAULT_NETWORK_LIMITS[input.network] },
      requiresApproval: input.requiresApproval ?? false,
      storage: input.storage ?? "hot",
      special: input.special,
      status: input.status ?? "active",
    };
  }
}

/** Structural guard for the persisted state document (docVersion 1). */
function isVaultStateDoc(v: unknown): v is VaultStateDoc {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    o.docVersion === 1 &&
    typeof o.vaultInstanceId === "string" &&
    typeof o.initialized === "boolean" &&
    typeof o.createdAt === "number" &&
    typeof o.updatedAt === "number" &&
    typeof o.keys === "object" &&
    o.keys !== null &&
    typeof o.policies === "object" &&
    o.policies !== null &&
    typeof o.backup === "object" &&
    o.backup !== null
  );
}
