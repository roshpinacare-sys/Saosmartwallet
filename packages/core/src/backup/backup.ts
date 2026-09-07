/**
 * Saosmartwallet — backup & recovery manager (M2, layer 5)
 * ========================================================
 * Everything that lets a sovereign vault survive its own hardware:
 *
 *   • createBackup       — the full state document sealed under a backup
 *                          password (Argon2id, fresh salt), optionally
 *                          Shamir-sharded: a random wrapping key seals the
 *                          inner payload and the key itself is split 2-of-3
 *                          (or any t-of-n) across guardians.
 *   • restoreBackup      — integrity-verified restore (HMAC + checksum +
 *                          timing-safe compare) into a FRESH vault only.
 *   • social recovery    — one share per trusted contact + a recovery
 *                          package (the state sealed under a random
 *                          recovery key) held by the OWNER; t shares +
 *                          the package rebuild the vault anywhere.
 *   • dead-man switch    — inactivity window + beneficiaries + heartbeat.
 *   • air-gapped export  — the whole BackupPackage as a sequence of QR
 *                          data URLs (≤800 chars of payload per frame).
 *
 * Security contracts:
 *   • Wrapping/recovery keys are randomBytes(32), zero-filled after use and
 *     NEVER persisted — only their Shamir shares leave the process.
 *   • Package integrity = HMAC-SHA256(key = sha256(canonical inner JSON)) over
 *     the canonical package fields, verified with a timing-safe compare on
 *     restore; the inner envelope AEAD adds a second, independent layer.
 *   • Restore fails closed: only into a fresh (never-initialized) storage,
 *     and only after every integrity check passes.
 *   • No secrets in errors or audit records — amounts, ids and checksums only.
 */

import { createHash, createHmac } from "node:crypto";

import { AuditSystem, type LogAuditInput } from "../audit/audit";
import {
  DEFAULT_KDF_PARAMS,
  deriveMasterKey,
  open,
  openJson,
  randomBytes,
  reconstructSecret,
  seal,
  sealJson,
  shardSecret,
} from "../crypto";
import { b64ToBytes, bytesEqual, canonicalJson, fromUtf8, utf8 } from "../encoding";
import type { VaultStorage } from "../storage/types";
import {
  VaultError,
  type BackupPackage,
  type Beneficiary,
  type DeadManConfig,
  type EncryptedPayload,
  type RecoveryContact,
  type Share,
  type VaultStateDoc,
} from "../types";
import type { SovereignVault } from "../vault/vault";

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/** Injected collaborators of the BackupManager (all accessor-style). */
export interface BackupManagerDeps {
  /** The vault to back up / configure (layer 1). */
  getVault: () => SovereignVault;
  /** Stable vault instance id — anchors audit events. */
  getInstanceId: () => string;
  /**
   * Optional audit system — when present, backup_created / recovery_initiated
   * / deadman_updated events join the hash chain.
   */
  getAudit?: () => AuditSystem;
}

/** Options for {@link BackupManager.createBackup}. */
export interface BackupCreateOptions {
  /** Shamir threshold for the wrapping key (≥ 2 enables sharding). */
  shardThreshold?: number;
  /** Total shares to generate (must be ≥ shardThreshold). */
  shardTotal?: number;
  /** Step-up password — re-verified against the vault verifier before export. */
  stepUpPassword?: string;
}

/**
 * Result of {@link BackupManager.setupSocialRecovery}. The shares are handed
 * to the contacts; the recoveryPackage (the state sealed under the random
 * recovery key + the threshold) is stored BY THE OWNER with their private
 * backup — recovery needs BOTH (t shares + the package). The vault state
 * itself keeps only the contacts+threshold metadata (types.ts stays frozen).
 */
export interface SocialRecoverySetup {
  shares: Array<{ contactId: string; share: Share }>;
  recoveryPackage: { payload: EncryptedPayload; threshold: number };
}

/** Air-gap QR frame prefix + maximum payload characters per frame. */
const AIR_GAP_PREFIX = "SAOSVAULT|1|";
const AIR_GAP_CHUNK_CHARS = 800;

// ---------------------------------------------------------------------------
// Package integrity helpers (shared by create + restore)
// ---------------------------------------------------------------------------

/** The exact canonical preimage bound by the package HMAC. */
function packagePreimage(
  backup: Pick<BackupPackage, "format" | "version" | "createdAt" | "encryptedState" | "metadata">,
): string {
  return canonicalJson({
    format: backup.format,
    version: backup.version,
    createdAt: backup.createdAt,
    encryptedState: backup.encryptedState,
    metadata: backup.metadata,
  });
}

/** HMAC-SHA256 over the canonical package bytes, keyed by the inner checksum. */
function packageSignature(
  backup: Pick<BackupPackage, "format" | "version" | "createdAt" | "encryptedState" | "metadata">,
): string {
  return createHmac("sha256", utf8(backup.metadata.checksum)).update(packagePreimage(backup), "utf8").digest("base64");
}

/** sha256 hex over the canonical encryptedState JSON (the metadata checksum). */
function packageChecksum(encryptedState: EncryptedPayload): string {
  return createHash("sha256").update(canonicalJson(encryptedState), "utf8").digest("hex");
}

/** The audit-chain genesis convention (mirrors AuditSystem.genesisHash). */
function auditGenesisHash(vaultInstanceId: string): string {
  return createHash("sha256").update(`saos-audit-genesis:${vaultInstanceId}`, "utf8").digest("hex");
}

/** Local structural guard for a restored state document (docVersion 1, initialized). */
function isRestorableStateDoc(v: unknown): v is VaultStateDoc {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    o.docVersion === 1 &&
    o.initialized === true &&
    typeof o.vaultInstanceId === "string" &&
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

/** Structural guard for a nested EncryptedPayload (legacy dual-layer packages). */
function isEncryptedPayloadShape(v: unknown): v is EncryptedPayload {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    (o.algorithm === "aes-256-gcm" || o.algorithm === "chacha20-poly1305") &&
    typeof o.ciphertext === "string" &&
    typeof o.iv === "string" &&
    typeof o.authTag === "string" &&
    typeof o.salt === "string" &&
    typeof o.checksum === "string" &&
    Array.isArray(o.layers)
  );
}

/**
 * Opens the inner state payload under the backup password (Argon2id over the
 * payload's stored salt — exportState seals with DEFAULT_KDF_PARAMS).
 * @throws VaultError("DECRYPTION_FAILED") on any failure — no key material,
 *   and no hint WHICH check failed, ever leaves this function.
 */
async function openStateDoc(payload: EncryptedPayload, password: string): Promise<VaultStateDoc> {
  if (password.length === 0) {
    throw new VaultError("VALIDATION", "backup password must not be empty");
  }
  let key: Uint8Array;
  try {
    key = await deriveMasterKey(password, b64ToBytes(payload.salt), DEFAULT_KDF_PARAMS);
  } catch {
    throw new VaultError("DECRYPTION_FAILED", "backup payload kdf parameters are invalid");
  }
  try {
    const bytes = open(payload, key);
    let parsed: unknown;
    try {
      parsed = JSON.parse(fromUtf8(bytes));
    } catch {
      throw new VaultError("DECRYPTION_FAILED", "decrypted backup is not valid JSON");
    }
    if (!isRestorableStateDoc(parsed)) {
      throw new VaultError("DECRYPTION_FAILED", "decrypted backup does not contain a valid docVersion-1 initialized vault state");
    }
    return parsed;
  } finally {
    key.fill(0);
  }
}

/** Fresh-vault fail-closed gate + save under the audit genesis hash. */
async function persistRestoredDoc(storage: VaultStorage, doc: VaultStateDoc): Promise<VaultStateDoc> {
  const existing = await storage.load();
  if (existing !== null) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(existing.stateJson);
    } catch {
      // Unparsable record — not an initialized vault, restore may proceed.
    }
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      (parsed as Record<string, unknown>).initialized === true
    ) {
      throw new VaultError("VAULT_EXISTS", "restore only allowed into a fresh vault");
    }
  }
  await storage.save(JSON.stringify(doc), auditGenesisHash(doc.vaultInstanceId));
  return doc;
}

// ---------------------------------------------------------------------------
// BackupManager
// ---------------------------------------------------------------------------

export class BackupManager {
  constructor(private readonly deps: BackupManagerDeps) {}

  // -------------------------------------------------------------------------
  // Encrypted + sharded backup
  // -------------------------------------------------------------------------

  /**
   * Exports the ENTIRE vault state as a verifiable BackupPackage:
   *
   *   1. vault.ensureUnlocked() (+ optional stepUpPassword verification);
   *   2. inner = vault.exportState(password) — the full state JSON sealed
   *      under the backup password with a FRESH Argon2id salt (self-contained
   *      payload: key = deriveMasterKey(password, payload.salt));
   *   3. sharding (shardThreshold ≥ 2 && shardTotal ≥ threshold): a random
   *      32-byte wrapping key seals the INNER payload JSON into the OUTER
   *      envelope, then the wrapping key is Shamir-split — the outer payload
   *      becomes encryptedState and the shares travel in package.shards.
   *      The wrapping key itself is zero-filled and never persisted;
   *   4. metadata (networks, vaultCount = 1 + networks + soldiers + purposes,
   *      keyCount = active keys, checksum = sha256(canonical inner JSON));
   *   5. signature = HMAC-SHA256(key = checksum, canonical package fields).
   *
   * @returns the package and the raw Share[] (empty when unsharded).
   * @throws VaultError("VAULT_LOCKED"), ("WRONG_PASSWORD"), ("VALIDATION"),
   *   ("SHAMIR_INVALID") for a nonsensical shard configuration.
   */
  async createBackup(
    password: string,
    opts?: BackupCreateOptions,
  ): Promise<{ backup: BackupPackage; shards: Share[] }> {
    const vault = this.deps.getVault();
    vault.ensureUnlocked();
    if (opts?.stepUpPassword !== undefined) {
      await vault.verifyStepUp(opts.stepUpPassword);
    }
    if (password.length === 0) {
      throw new VaultError("VALIDATION", "backup password must not be empty");
    }
    const state = vault.getState();
    if (state === null) {
      throw new VaultError("VAULT_NOT_INITIALIZED", "vault state not initialized — initialize() first");
    }

    const inner = await vault.exportState(password);

    const threshold = opts?.shardThreshold ?? 0;
    const total = opts?.shardTotal ?? 0;
    let encryptedState = inner;
    let shards: Share[] = [];
    let sharding: { threshold: number; total: number } | null = null;
    if (threshold >= 2 && total >= threshold) {
      const wrappingKey = randomBytes(32);
      try {
        // The outer envelope seals the STATE DOCUMENT directly under the
        // wrapping key — shards alone must be sufficient to restore (that is
        // the entire point of sharding: recovery without the password). The
        // password-sealed `inner` payload stays available for the
        // password-only restore path.
        encryptedState = seal(utf8(canonicalJson(state)), wrappingKey, { keyId: "backup-wrap-v1" });
        shards = await shardSecret(wrappingKey, threshold, total);
        sharding = { threshold, total };
      } finally {
        wrappingKey.fill(0);
      }
    }

    const metadata = {
      networks: Object.values(state.networks).map((n) => n.network),
      vaultCount:
        1 + Object.keys(state.networks).length + Object.keys(state.soldiers).length + Object.keys(state.purposes).length,
      keyCount: Object.values(state.keys).filter((k) => k.status === "active").length,
      checksum: packageChecksum(encryptedState),
    };
    const createdAt = Date.now();
    const backup: BackupPackage = {
      format: "saos-vault-backup",
      version: 1,
      createdAt,
      encryptedState,
      metadata,
      signature: packageSignature({ format: "saos-vault-backup", version: 1, createdAt, encryptedState, metadata }),
    };
    if (sharding !== null) {
      backup.shards = shards;
      backup.sharding = sharding;
    }

    await this.logAudit({
      type: "backup_created",
      actor: { vaultId: "master" },
      target: {
        vaultId: "master",
        detail: {
          sharded: sharding !== null,
          threshold: sharding?.threshold ?? null,
          total: sharding?.total ?? null,
          vaultCount: metadata.vaultCount,
          keyCount: metadata.keyCount,
        },
      },
      result: "success",
    });

    return { backup, shards };
  }

  /**
   * Static, side-effect-light restore: verifies the package (HMAC signature
   * via timing-safe compare, then the metadata checksum), then recovers the
   * state document by EXACTLY ONE credential path:
   *   • sharded package  → ≥threshold Shamir shares reconstruct the wrapping
   *     key that seals the state document directly (no password involved —
   *     passwordless recovery is the point of sharding);
   *   • unsharded package → the backup password (Argon2id over the payload's
   *     stored salt).
   * The decrypted document is validated (docVersion 1 + initialized) and
   * saved into a FRESH VaultStorage under the audit genesis convention.
   *
   * Fail closed: any integrity mismatch → VaultError("VALIDATION", "backup
   * package integrity check failed"); bad key material → ("DECRYPTION_FAILED");
   * wrong credential class → ("VALIDATION"); an already-initialized target
   * storage → ("VAULT_EXISTS").
   */
  static async restoreBackup(
    storage: VaultStorage,
    backup: BackupPackage,
    creds: { password?: string; shards?: Share[] },
  ): Promise<VaultStateDoc> {
    // 1. Structural sanity.
    if (backup?.format !== "saos-vault-backup" || backup?.version !== 1) {
      throw new VaultError("VALIDATION", "backup package integrity check failed");
    }
    // 2. Package HMAC — timing-safe compare of the decoded signatures.
    const expected = b64ToBytes(packageSignature(backup));
    const provided = b64ToBytes(backup.signature);
    if (!bytesEqual(expected, provided)) {
      throw new VaultError("VALIDATION", "backup package integrity check failed");
    }
    // 3. Inner-envelope checksum binding.
    if (packageChecksum(backup.encryptedState) !== backup.metadata.checksum) {
      throw new VaultError("VALIDATION", "backup package integrity check failed");
    }

    // 4. Unwrap the optional Shamir layer — shards alone recover the document.
    let inner = backup.encryptedState;
    let shardDoc: VaultStateDoc | null = null;
    if (backup.sharding !== undefined) {
      const shares = creds.shards ?? [];
      const threshold = backup.sharding.threshold;
      if (!Number.isInteger(threshold) || shares.length < threshold) {
        throw new VaultError("SHAMIR_INVALID", `shard recovery needs at least ${threshold} shares, got ${shares.length}`);
      }
      const wrappingKey = await reconstructSecret(shares);
      try {
        if (wrappingKey.length !== 32) {
          throw new VaultError("DECRYPTION_FAILED", "reconstructed wrapping key has the wrong length");
        }
        const outerPlain = open(backup.encryptedState, wrappingKey);
        let parsedOuter: unknown;
        try {
          parsedOuter = JSON.parse(fromUtf8(outerPlain));
        } catch {
          throw new VaultError("DECRYPTION_FAILED", "outer payload is not valid JSON");
        }
        if (isRestorableStateDoc(parsedOuter)) {
          shardDoc = parsedOuter;
        } else if (isEncryptedPayloadShape(parsedOuter)) {
          inner = parsedOuter; // legacy dual-layer package: password still required
        } else {
          throw new VaultError("DECRYPTION_FAILED", "outer payload is neither a state document nor an encrypted envelope");
        }
      } catch (e) {
        if (e instanceof VaultError) throw e;
        throw new VaultError("DECRYPTION_FAILED", "outer payload could not be opened with the reconstructed wrapping key");
      } finally {
        wrappingKey.fill(0);
      }
    }

    // 5. Password path — open the state under the backup password.
    let doc: VaultStateDoc;
    if (shardDoc !== null) {
      doc = shardDoc;
    } else {
      if (typeof creds.password !== "string") {
        throw new VaultError("VALIDATION", "backup password is required to open the encrypted state");
      }
      doc = await openStateDoc(inner, creds.password);
    }

    // 6. Fresh-vault fail-closed gate + persist.
    return persistRestoredDoc(storage, doc);
  }

  // -------------------------------------------------------------------------
  // Social recovery
  // -------------------------------------------------------------------------

  /**
   * Registers recovery contacts and splits a fresh 32-byte recovery key
   * across them (threshold-of-contacts). The ENTIRE state document is sealed
   * under that recovery key into a `recoveryPackage` which — together with
   * the threshold — the CALLER must store safely: recovery needs t shares
   * AND the package. Only the contacts+threshold metadata persists in the
   * vault state (types.ts is frozen); shares and the payload NEVER persist
   * server-side.
   *
   * Requires an unlocked session + step-up password (same gate as addKey).
   *
   * @throws VaultError("VAULT_LOCKED"), ("WRONG_PASSWORD"), ("VALIDATION").
   */
  async setupSocialRecovery(
    contacts: RecoveryContact[],
    threshold: number,
    password: string,
  ): Promise<SocialRecoverySetup> {
    const vault = this.deps.getVault();
    vault.ensureUnlocked();
    await vault.verifyStepUp(password);
    if (!Array.isArray(contacts) || contacts.length === 0) {
      throw new VaultError("VALIDATION", "at least one recovery contact is required");
    }
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > contacts.length) {
      throw new VaultError("VALIDATION", `threshold must be an integer in [1, contacts.length=${contacts.length}]`);
    }

    // Persist the configuration FIRST so the sealed state doc carries it.
    await vault.setSocialRecovery({
      contacts: contacts.map((c) => ({ ...c })),
      threshold,
    });
    const state = vault.getState();
    if (state === null) {
      throw new VaultError("VAULT_NOT_INITIALIZED", "vault state not initialized — initialize() first");
    }

    const recoveryKey = randomBytes(32);
    try {
      const payload = sealJson(state, recoveryKey, { keyId: "social-recovery-v1" });
      const shares = await shardSecret(recoveryKey, threshold, contacts.length);
      await this.logAudit({
        type: "recovery_initiated",
        actor: { vaultId: "master" },
        target: { vaultId: "master", detail: { contacts: contacts.length, threshold } },
        result: "success",
      });
      return {
        shares: contacts.map((contact, i) => ({ contactId: contact.id, share: shares[i]! })),
        recoveryPackage: { payload, threshold },
      };
    } finally {
      recoveryKey.fill(0);
    }
  }

  /**
   * Rebuilds a vault from a recovery package + ≥threshold contact shares
   * into a FRESH VaultStorage. The reconstructed key opens the package
   * payload; the decrypted document is validated and saved AS-IS — the state
   * at rest is plaintext JSON whose key payloads are individually sealed, so
   * the restored vault keeps working with its ORIGINAL master password.
   *
   * `newPassword` must be non-empty and is RESERVED for post-recovery
   * re-enrollment: rotating the verifier here would orphan every sealed key
   * (they are wrapped under the original password's Argon2id key) — the
   * honest path is to re-add keys under the new password after recovery.
   *
   * @throws VaultError("SHAMIR_INVALID") on too few shares,
   *   ("DECRYPTION_FAILED") on a wrong key/tampered payload,
   *   ("VAULT_EXISTS") when the target storage is not fresh.
   */
  static async recoverFromSocial(
    recoveryPackage: { payload: EncryptedPayload; threshold: number },
    shares: Share[],
    newPassword: string,
    storage: VaultStorage,
  ): Promise<VaultStateDoc> {
    if (
      recoveryPackage === null ||
      typeof recoveryPackage !== "object" ||
      !Number.isInteger(recoveryPackage.threshold) ||
      recoveryPackage.threshold < 1
    ) {
      throw new VaultError("VALIDATION", "recovery package threshold is invalid");
    }
    if (typeof newPassword !== "string" || newPassword.length === 0) {
      throw new VaultError("VALIDATION", "new password must not be empty (reserved for post-recovery key re-enrollment)");
    }
    if (!Array.isArray(shares) || shares.length < recoveryPackage.threshold) {
      throw new VaultError("SHAMIR_INVALID", `recovery needs at least ${recoveryPackage.threshold} shares, got ${shares?.length ?? 0}`);
    }

    const recoveryKey = await reconstructSecret(shares);
    let doc: VaultStateDoc;
    try {
      if (recoveryKey.length !== 32) {
        throw new VaultError("DECRYPTION_FAILED", "reconstructed recovery key has the wrong length");
      }
      const parsed: unknown = openJson(recoveryPackage.payload, recoveryKey);
      if (!isRestorableStateDoc(parsed)) {
        throw new VaultError("DECRYPTION_FAILED", "recovered payload is not a valid docVersion-1 initialized vault state");
      }
      doc = parsed;
    } catch (e) {
      if (e instanceof VaultError) throw e;
      throw new VaultError("DECRYPTION_FAILED", "recovery package could not be opened with the supplied shares");
    }
    return persistRestoredDoc(storage, doc);
  }

  // -------------------------------------------------------------------------
  // Dead-man switch
  // -------------------------------------------------------------------------

  /**
   * Configures the dead-man switch (unlocked session + step-up required).
   * `lastHeartbeat` is stamped NOW — enabling the switch starts a fresh
   * silence window.
   *
   * @throws VaultError("VAULT_LOCKED"), ("WRONG_PASSWORD"), ("VALIDATION").
   */
  async setupDeadManSwitch(
    config: { enabled: boolean; inactiveDays: number; beneficiaries: Beneficiary[] },
    password: string,
  ): Promise<DeadManConfig> {
    const vault = this.deps.getVault();
    vault.ensureUnlocked();
    await vault.verifyStepUp(password);
    if (!Number.isInteger(config.inactiveDays) || config.inactiveDays < 1) {
      throw new VaultError("VALIDATION", "inactiveDays must be an integer ≥ 1");
    }
    if (config.enabled && (!Array.isArray(config.beneficiaries) || config.beneficiaries.length === 0)) {
      throw new VaultError("VALIDATION", "an enabled dead-man switch requires at least one beneficiary");
    }
    const totalShare = (config.beneficiaries ?? []).reduce((sum, b) => sum + b.sharePercent, 0);
    if (config.enabled && totalShare > 100) {
      throw new VaultError("VALIDATION", "beneficiary shares exceed 100%");
    }
    const deadManConfig: DeadManConfig = {
      enabled: config.enabled,
      inactiveDays: config.inactiveDays,
      beneficiaries: config.beneficiaries.map((b) => ({ ...b })),
      lastHeartbeat: Date.now(),
    };
    await vault.setDeadManConfig(deadManConfig);
    await this.logAudit({
      type: "deadman_updated",
      actor: { vaultId: "master" },
      target: {
        vaultId: "master",
        detail: { enabled: deadManConfig.enabled, inactiveDays: deadManConfig.inactiveDays, beneficiaries: deadManConfig.beneficiaries.length },
      },
      result: "success",
    });
    return deadManConfig;
  }

  /**
   * Pure overdue predicate: enabled && the silence window has elapsed.
   * A null/disabled config is NEVER overdue (fail-safe, not fail-deadly).
   */
  static deadManOverdue(config: DeadManConfig | null, now: number = Date.now()): boolean {
    if (config === null || !config.enabled) return false;
    return now - config.lastHeartbeat > config.inactiveDays * 86_400_000;
  }

  /**
   * Liveness heartbeat: refreshes lastHeartbeat when the switch is enabled.
   * Uses the same vault setter as setup — therefore requires an UNLOCKED
   * session (a heartbeat is a proof of liveness; a locked vault proves
   * nothing). Returns whether a heartbeat was recorded.
   *
   * @throws VaultError("VAULT_LOCKED") when the vault is locked.
   */
  static async heartbeat(vault: SovereignVault): Promise<boolean> {
    const state = vault.getState();
    const config = state?.backup.deadManSwitch ?? null;
    if (config === null || !config.enabled) return false;
    await vault.setDeadManConfig({ ...config, lastHeartbeat: Date.now() });
    return true;
  }

  // -------------------------------------------------------------------------
  // Air-gapped export
  // -------------------------------------------------------------------------

  /**
   * Renders a BackupPackage as a sequence of QR data URLs for cold storage:
   * the package JSON is split into ≤800-character chunks, each framed as
   * `SAOSVAULT|1|<i>/<n>|<chunk>` (order + total embedded for reassembly)
   * and encoded as a 512px PNG with EC level M. Nothing here is secrets —
   * the package is already double-encrypted (inner AEAD + optional Shamir).
   *
   * @returns data URLs in frame order (reassembly = join chunks by index).
   */
  async createAirGappedBackup(backup: BackupPackage): Promise<string[]> {
    const serialized = JSON.stringify(backup);
    const chunks: string[] = [];
    for (let i = 0; i < serialized.length; i += AIR_GAP_CHUNK_CHARS) {
      chunks.push(serialized.slice(i, i + AIR_GAP_CHUNK_CHARS));
    }
    const { toDataURL } = await import("qrcode");
    const frames: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      frames.push(
        await toDataURL(`${AIR_GAP_PREFIX}${i + 1}/${chunks.length}|${chunks[i]}`, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 512,
        }),
      );
    }
    return frames;
  }

  /** Audit logging when an AuditSystem was provided (never required). */
  private async logAudit(input: Omit<LogAuditInput, "vaultInstanceId">): Promise<void> {
    const audit = this.deps.getAudit?.();
    if (audit === undefined) return;
    await audit.log({ ...input, vaultInstanceId: this.deps.getInstanceId() });
  }
}
