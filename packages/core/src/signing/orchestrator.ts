/**
 * Saosmartwallet — signing orchestrator (M2, layer 4)
 * ===================================================
 * The ONE path from "user wants this operation signed" to "SignedTx /
 * BroadcastResult". Every sign() call flows through, in order:
 *
 *   1. session gate    — SovereignVault.ensureUnlocked() (+ optional step-up
 *                        password re-verification via vault.verifyStepUp)
 *   2. policy gate     — PolicyEngine.evaluate with VAULT-DERIVED config
 *                        injected through op.detail (allowedOperations,
 *                        dailyLimitSatoshis, spentTodaySatoshis,
 *                        soldierPermissions). Denials and step-up demands
 *                        THROW — nothing is ever signed on a maybe.
 *   3. key resolution  — active EncryptedKey for (vaultId, network, role);
 *                        soldier/purpose vault ids resolve to their
 *                        underlying network vault for key lookup. op.role
 *                        null defaults to "active" for funds ops and
 *                        "posting" for vote/comment (steem-family).
 *   4. reveal + sign   — SovereignVault.revealKeyFor → ChainAdapter.sign
 *                        (the only sanctioned plaintext-key exit; key bytes
 *                        exist solely inside the adapter call frame)
 *   5. broadcast (opt) — capability-checked ("broadcast"), timed-lock
 *                        honored, optional confirmRequired gate
 *   6. audit           — key_used / signing_attempt / broadcast events on
 *                        the hash-chained AuditSystem
 *
 * Security contracts:
 *   • Zero mock: signatures come from the registered ChainAdapter over real
 *     revealed key material or not at all — a missing adapter is an honest
 *     failure, never a fabricated result.
 *   • Audit records carry NO secrets: key ids, public keys, amounts, tx ids.
 *   • The daily-spend context counts each signed operation ONCE: broadcast
 *     events deliberately omit target.operation (they carry only the tx id +
 *     a compact summary in target.detail) so buildOperationContext cannot
 *     double-count a signing_attempt + its broadcast.
 *   • NOTE on imports: packages/chains is imported TYPE-ONLY — packages/core
 *     keeps zero runtime coupling to the chains package.
 */

import type { BroadcastResult, ChainAdapter, SignedTx, UnsignedTx } from "../../../chains/chain-adapter";
import { PrivateKey } from "../../../crypto/src/index";
import type { LogAuditInput } from "../audit/audit";
import { AuditSystem } from "../audit/audit";
import { parseSats } from "../encoding";
import { PolicyEngine } from "../policy/engine";
import type { SovereignVault } from "../vault/vault";
import {
  VaultError,
  type BatchSignResult,
  type CrossChainSignature,
  type KeyRole,
  type MultiSigResult,
  type NetworkId,
  type NetworkVaultConfig,
  type OperationContext,
  type PolicyDecision,
  type PolicyOperation,
  type SignatureRecord,
  type SigningOptions,
  type SimulationResult,
  type SoldierVaultConfig,
  type VaultStateDoc,
} from "../types";

// ---------------------------------------------------------------------------
// Dependency seam
// ---------------------------------------------------------------------------

/** Injected collaborators of the SigningOrchestrator (all accessor-style). */
export interface OrchestratorDeps {
  /** The unlocked-per-operation vault (layer 1). */
  getVault: () => SovereignVault;
  /** The policy engine (layer 3) — typically one shared instance. */
  getPolicy: () => PolicyEngine;
  /** The hash-chained audit system (layer 6). */
  getAudit: () => AuditSystem;
  /** Chain adapters by network — absent entries produce honest failures. */
  getAdapters: () => Partial<Record<NetworkId, ChainAdapter>>;
  /** Stable vault instance id — anchors audit genesis + context queries. */
  getInstanceId: () => string;
}

/** Result of {@link SigningOrchestrator.sign}. */
export interface SignOutcome {
  signed: SignedTx;
  /** One record per signing key (single-sign: exactly one). */
  signature: SignatureRecord;
  /** Null unless options.broadcast was true AND the broadcast happened. */
  broadcast: BroadcastResult | null;
  /** The policy decision that authorized this signing. */
  decision: PolicyDecision;
}

/** Options for {@link SigningOrchestrator.multiSign}. */
export interface MultiSignOptions {
  /**
   * Signing network. Inferred from the first given network-vault id when
   * omitted; must be passed explicitly when signing soldier/purpose ids.
   */
  network?: NetworkId;
  /** Fixed role for every vault; defaults to first available active → owner. */
  role?: KeyRole | null;
}

/** Step-up-capable option set (the orchestrator's internal extension of SigningOptions). */
export type OrchestratorSignOptions = SigningOptions & { stepUpPassword?: string };

// ---------------------------------------------------------------------------
// Internals — pure helpers
// ---------------------------------------------------------------------------

/** Operation types that move funds or custody → default signing role "active". */
const FUNDS_SIGNING_OPS: ReadonlySet<string> = new Set([
  "transfer",
  "transfer_to_vesting",
  "withdraw_vesting",
  "limit_order_create",
  "limit_order_cancel",
  "delegate_vesting_shares",
  "trigger_smart_contract",
]);

/** Social operations → default signing role "posting" (steem-family). */
const SOCIAL_SIGNING_OPS: ReadonlySet<string> = new Set(["vote", "comment", "custom_json"]);

/** Maps a token symbol to the TokenBalances field that carries its balance. */
const BALANCE_FIELD: Record<string, "liquid" | "debt"> = {
  STEEM: "liquid",
  SBD: "debt",
  HIVE: "liquid",
  HBD: "debt",
  BLURT: "liquid",
  SAOS: "liquid",
  TRX: "liquid",
};

/** Milliseconds in one day — dead-man/UTC-day math. */
const DAY_MS = 86_400_000;

/** Start of the UTC day containing `ms` (epoch ms). */
function utcDayStart(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Default key role for an operation with op.role === null: "active" for
 * steem-family funds operations, "posting" for vote/comment, "active"
 * otherwise (tron keeps flavor-less null — handled by the caller).
 */
function defaultRoleFor(opType: string, network: NetworkId): KeyRole | null {
  if (network === "tron") return null;
  if (FUNDS_SIGNING_OPS.has(opType)) return "active";
  if (SOCIAL_SIGNING_OPS.has(opType)) return "posting";
  return "active";
}

/** Structural guard for a recovered PolicyDecision carried in error details. */
function isPolicyDecision(v: unknown): v is PolicyDecision {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.allowed === "boolean" && Array.isArray(o.reasons) && Array.isArray(o.checks);
}

/**
 * Parses a chain asset string "10.000 STEEM" into exact satoshis (NO floats —
 * the decimal digits are re-arranged, never multiplied through a float).
 * Returns null for anything that is not an unsigned decimal + symbol.
 */
function parseAssetString(s: string): { satoshis: string; symbol: string } | null {
  const m = /^(\d+)(?:\.(\d+))?\s+([A-Za-z][A-Za-z0-9]*)$/.exec(s.trim());
  if (m === null) return null;
  const digits = `${m[1]}${m[2] ?? ""}`;
  return { satoshis: BigInt(digits).toString(), symbol: m[3]!.toUpperCase() };
}

/** Reads a string field from SignedTx.metadata (adapter-reported digests). */
function metadataString(signed: SignedTx, field: string): string | null {
  const md = signed.metadata as Record<string, unknown> | undefined;
  if (md === undefined) return null;
  const v = md[field];
  return typeof v === "string" ? v : null;
}

/** STM-family public key prefix per network (null = no honest representation). */
function publicKeyPrefix(network: NetworkId): string | null {
  if (network === "blurt") return "BLT";
  if (network === "tron") return null;
  return "STM"; // steem / hive / saos-net share the STM-style identity
}

// ---------------------------------------------------------------------------
// SigningOrchestrator
// ---------------------------------------------------------------------------

/**
 * Layer 4 — turns policy-approved operations into signatures and (optionally)
 * broadcasts, with a full audit trail. Stateless beyond its injected deps;
 * one instance can serve many requests.
 */
export class SigningOrchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  // -------------------------------------------------------------------------
  // Context building + policy gate
  // -------------------------------------------------------------------------

  /**
   * Builds the policy-engine OperationContext for one operation from the
   * audit history (via AuditSystem.buildOperationContext) and INJECTS the
   * vault-derived policy configuration into the operation's detail — the
   * reserved keys consumed by the compiled-in static rules:
   *
   *   - allowedOperations    ← network vault's allowedOperations
   *   - dailyLimitSatoshis   ← network vault's maxAmountPerDay[symbol]
   *   - spentTodaySatoshis   ← sum of today's (UTC) SUCCESSFUL signing
   *                            history amounts for the same symbol
   *   - soldierPermissions   ← the soldier's permissions when the operation
   *                            targets a vault-soldier-* id
   *
   * The injection is applied to a COPY of the operation (the caller's object
   * is never mutated); the effective operation is what gets evaluated and
   * audited. Malformed historical amounts are skipped (guarded parseSats).
   *
   * @throws VaultError("VAULT_NOT_INITIALIZED") when the vault has no state.
   */
  async buildContext(
    op: PolicyOperation,
    opts?: { trustedDevice?: boolean; stepUpSatisfied?: boolean },
  ): Promise<OperationContext> {
    const vault = this.deps.getVault();
    if (vault.getState() === null) {
      throw new VaultError("VAULT_NOT_INITIALIZED", "vault state not initialized — initialize() first");
    }
    return this.deps.getAudit().buildOperationContext(this.deps.getInstanceId(), {
      timestamp: Date.now(),
      network: op.network,
      trustedDevice: opts?.trustedDevice ?? true,
      stepUpSatisfied: opts?.stepUpSatisfied ?? false,
    });
  }

  /**
   * The non-secret policy gate: build context → evaluate → THROW on denial
   * or on an unsatisfied step-up requirement (fail closed — the caller gets
   * the full PolicyDecision in error.details for the signing dialog).
   *
   * - `decision.requirements.stepUpAuth && !ctx.stepUpSatisfied` → audit
   *   policy_violation (blocked) + VaultError("POLICY_STEP_UP_REQUIRED").
   * - `!decision.allowed` → audit policy_violation (blocked) +
   *   VaultError("POLICY_DENIED", reasons.join("; "), { decision }).
   *
   * @param options.stepUpSatisfied — set true by sign() AFTER a successful
   *   step-up password verification; drops the step-up requirement.
   * @throws VaultError("VAULT_NOT_FOUND") when no network vault exists for
   *   op.network (the orchestrator refuses to evaluate without the
   *   vault-level configuration — fail closed per the static-rule contract).
   */
  async evaluateAndCheck(
    op: PolicyOperation,
    options?: SigningOptions & { stepUpSatisfied?: boolean },
  ): Promise<PolicyDecision> {
    const { decision } = await this.evaluateInternal(op, options?.stepUpSatisfied === true);
    return decision;
  }

  // -------------------------------------------------------------------------
  // The main signing path
  // -------------------------------------------------------------------------

  /**
   * Sign one transaction under full policy + audit. THE main path — see the
   * class doc for the six-stage pipeline.
   *
   * Step-up: when `options.stepUpPassword` is provided it is re-verified
   * against the vault verifier BEFORE evaluation (a verified step-up drops
   * the policy step-up requirement). When `options.requirePassword` is true
   * but no password is supplied the call fails closed with VALIDATION.
   *
   * Broadcast (options.broadcast === true): the adapter must advertise the
   * "broadcast" capability, the (optional) timed lock must have expired and
   * the confirmRequired gate (when given) must approve. Any refusal is an
   * explicit VaultError — the orchestrator never silently skips a requested
   * broadcast.
   *
   * @throws VaultError("POLICY_STEP_UP_REQUIRED") / ("POLICY_DENIED") from
   *   the policy gate, ("WRONG_PASSWORD") on a bad step-up password,
   *   ("KEY_NOT_FOUND"), ("KEY_REVOKED"), ("ADAPTER_MISSING"),
   *   ("ADAPTER_INCAPABLE"), ("TIMED_LOCK"), ("VALIDATION") on a declined
   *   confirm gate or a flavor-less key, plus adapter-native failures.
   *   Every post-policy failure is audited as a signing_attempt failure.
   */
  async sign(
    op: PolicyOperation,
    tx: UnsignedTx,
    options?: OrchestratorSignOptions,
  ): Promise<SignOutcome> {
    const vault = this.deps.getVault();
    vault.ensureUnlocked();

    // 1. Step-up authentication (optional, fail closed).
    const stepUpProvided = typeof options?.stepUpPassword === "string" && options.stepUpPassword.length > 0;
    if (options?.requirePassword === true && !stepUpProvided) {
      throw new VaultError("VALIDATION", "requirePassword was requested but no stepUpPassword was provided");
    }
    if (stepUpProvided) {
      await vault.verifyStepUp(options.stepUpPassword as string);
    }

    // 2. Policy gate (audits policy_violation itself on denial/step-up).
    const { decision, effOp, networkVault, underlyingVaultId } = await this.evaluateInternal(op, stepUpProvided);

    // 3.–6. Resolve → reveal → sign → (broadcast) → touch/audit. Failures
    // after the policy gate are audited as signing_attempt failures; the
    // ORIGINAL error always wins over an audit outage on this path.
    try {
      const state = this.requireState(vault);
      const keyId = this.resolveKeyId(state, op.vaultId, op.network, op.role ?? defaultRoleFor(op.type, op.network));
      if (keyId === null) {
        throw new VaultError(
          "KEY_NOT_FOUND",
          `no active ${op.role ?? "default-role"} key for network "${op.network}" under vault "${op.vaultId}"`,
        );
      }
      const { privateKey, record } = await vault.revealKeyFor(keyId);
      if (record.role === null) {
        throw new VaultError(
          "VALIDATION",
          "flavor-less key (role null) cannot drive the steem-family signing contract — add it with an explicit role",
        );
      }
      const adapter = this.adapterFor(op.network);
      const signed = await adapter.sign(tx, { byRole: { [record.role]: privateKey } }, [record.role]);
      const signatureHex = signed.signatures[0];
      if (signatureHex === undefined) {
        throw new VaultError("VALIDATION", "adapter returned a signed transaction without signatures");
      }
      const publicKey = this.publicKeyFor(record.publicKey, privateKey, op.network);

      let broadcast: BroadcastResult | null = null;
      if (options?.broadcast === true) {
        broadcast = await this.broadcastSigned(adapter, signed, options, decision, effOp);
      }

      // 6. Activity + audit trail.
      vault.touch();
      await vault.markKeyUsed(keyId);
      await this.logAudit({
        type: "key_used",
        actor: { vaultId: underlyingVaultId, keyId },
        target: { vaultId: op.vaultId, keyId },
        result: "success",
      });
      await this.logAudit({
        type: "signing_attempt",
        actor: { vaultId: op.vaultId, keyId },
        target: { vaultId: op.vaultId, keyId, operation: effOp },
        result: "success",
        reason: `signed with ${record.role} key; ${networkVault.status === "offline" ? "network vault is OFFLINE" : "network vault active"}`,
      });
      if (broadcast !== null) {
        // Deliberately NO target.operation here: the broadcast history entry
        // must not double-count the daily spend of its signing_attempt (see
        // class doc). txId + compact summary travel in target.detail.
        await this.logAudit({
          type: "broadcast",
          actor: { vaultId: op.vaultId, keyId },
          target: {
            vaultId: op.vaultId,
            detail: {
              txId: broadcast.txId,
              ...(broadcast.blockNum !== undefined ? { blockNum: broadcast.blockNum } : {}),
              type: effOp.type,
              amountSatoshis: effOp.amountSatoshis,
              symbol: effOp.symbol,
            },
          },
          result: "success",
          reason: `${effOp.type} broadcast to ${op.network}`,
        });
      }

      return {
        signed,
        signature: {
          vaultId: op.vaultId,
          keyId,
          role: record.role,
          publicKey,
          signatureHex,
          signedAt: Date.now(),
        },
        broadcast,
        decision,
      };
    } catch (e) {
      try {
        await this.logAudit({
          type: "signing_attempt",
          actor: { vaultId: op.vaultId },
          target: { vaultId: op.vaultId, operation: op },
          result: "failure",
          reason: e instanceof VaultError ? `${e.code}: ${e.message}` : "unexpected signing failure",
        });
      } catch {
        // The audit store is down — the original signing failure is the one
        // to surface; masking it here would hide the security-relevant cause.
      }
      throw e;
    }
  }

  /**
   * Dry-run one operation WITHOUT signing. Explicitly non-throwing for
   * policy/adapter issues: every problem is reported as a SimulationRisk.
   *
   * Honest-by-construction:
   *   - no adapter for the network → missing_adapter (high) + success false;
   *   - network vault offline → offline_network (high) + success false;
   *   - policy denial / unevaluable policy → policy_violation (high);
   *   - debit leg above the adapter-reported balance → insufficient_balance;
   *   - estimatedFeeSatoshis is "0" for steem-family (no gas) — honest;
   *   - RC manabar percent (when available) → estimatedResourcePercent.
   *
   * success = policy-allowed AND no high-severity risk.
   */
  async simulate(op: PolicyOperation, account: string): Promise<SimulationResult> {
    const vault = this.deps.getVault();
    const state = vault.getState();
    const risks: SimulationResult["risks"] = [];
    const stateChanges: string[] = [];
    const events: string[] = [];
    const balanceChanges: SimulationResult["expectedOutcome"]["balanceChanges"] = [];

    // 1. Policy — non-throwing path around evaluateAndCheck.
    let decision: PolicyDecision | null = null;
    if (state === null) {
      risks.push({
        type: "policy_violation",
        severity: "high",
        description: "vault state is not initialized — policy could not be evaluated",
      });
    } else {
      if (state.networks[`network-${op.network}`] === undefined) {
        risks.push({
          type: "policy_violation",
          severity: "high",
          description: `no network vault is configured for network "${op.network}" — signing would be refused`,
        });
      }
      try {
        decision = await this.evaluateAndCheck(op);
      } catch (e) {
        if (!(e instanceof VaultError)) throw e;
        const fromDetails = e.details?.decision;
        if (isPolicyDecision(fromDetails)) {
          decision = fromDetails;
        } else {
          // No decision attached (e.g. VAULT_NOT_FOUND / audit failure) —
          // rebuild one directly (still non-throwing).
          try {
            const ctx = await this.buildContext(op);
            const view = this.buildEffectiveOp(state, op, ctx);
            decision = this.deps.getPolicy().evaluate(view.effOp, ctx, state.policies);
          } catch {
            decision = null;
          }
        }
      }
    }
    if (decision !== null && !decision.allowed) {
      risks.push({
        type: "policy_violation",
        severity: "high",
        description: `policy denies this operation: ${decision.reasons.join("; ")}`,
      });
    }

    // 2. Balance legs from the operation (no tx is simulated — op.detail
    //    carries the limit-order asset strings when applicable).
    const legs = this.balanceLegsFor(op);
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i]!;
      balanceChanges.push({ asset: leg.asset, satoshis: leg.satoshis, direction: i === 0 ? "debit" : "credit" });
    }
    if (op.type === "limit_order_create") {
      stateChanges.push("a limit order will rest on the internal market until filled, cancelled or expired");
    } else if (op.type === "transfer" || op.type === "transfer_to_vesting") {
      stateChanges.push("liquid balance decreases when the operation confirms on-chain");
    } else if (legs.length > 0) {
      stateChanges.push("asset balances change when the operation confirms on-chain");
    }

    // 3. Adapter-side checks (balance, RC) — absent adapter = honest risk.
    const adapter = this.deps.getAdapters()[op.network];
    let estimatedResourcePercent: number | null = null;
    if (adapter === undefined) {
      risks.push({
        type: "missing_adapter",
        severity: "high",
        description: `no chain adapter registered for network "${op.network}" — the operation cannot be built or signed`,
      });
    } else {
      const debit = legs[0];
      if (debit !== undefined) {
        const field = BALANCE_FIELD[debit.asset];
        if (field !== undefined) {
          try {
            const balances = await adapter.getBalances(account);
            const raw = balances[field];
            const onChain = typeof raw === "string" ? parseAssetString(raw) : null;
            if (onChain !== null && BigInt(debit.satoshis) > BigInt(onChain.satoshis)) {
              risks.push({
                type: "insufficient_balance",
                severity: "high",
                description: `debit of ${debit.satoshis} ${debit.asset} satoshis exceeds the ${onChain.satoshis} satoshi ${field} balance of "${account}"`,
              });
            }
          } catch (err) {
            events.push(`balance lookup failed (${err instanceof Error ? err.message : "unknown"}) — balance risk not assessed`);
          }
        }
      }
      try {
        const rc = await adapter.getRcManabar(account);
        estimatedResourcePercent = rc?.percent ?? null;
      } catch {
        estimatedResourcePercent = null; // honest absence — RC not assessable
      }
    }

    // 4. Offline network — config exists but refuses signing.
    if (state !== null && state.networks[`network-${op.network}`]?.status === "offline") {
      risks.push({
        type: "offline_network",
        severity: "high",
        description: `the network vault for "${op.network}" is configured offline — signing is refused`,
      });
    }

    if (decision !== null) {
      events.push(`policy: ${decision.allowed ? "allowed" : "denied"} (risk ${decision.riskLevel}, confidence ${decision.confidence.toFixed(2)})`);
    }
    // Steem-family operations consume Resource Credits, not gas — "0" is the
    // honest fee. Other flavors are not fee-estimated by this layer.
    const success = (decision?.allowed ?? false) && !risks.some((r) => r.severity === "high");

    return {
      success,
      expectedOutcome: { balanceChanges, stateChanges, events },
      risks,
      estimatedFeeSatoshis: "0",
      estimatedResourcePercent,
      decision,
    };
  }

  // -------------------------------------------------------------------------
  // Multi-signature / batch / cross-chain primitives
  // -------------------------------------------------------------------------

  /**
   * Sign the SAME transaction with the resolved key of EACH vault id — the
   * pre-chain multi-signature primitive. NOTE: Steem-family authorities merge
   * signatures at the AUTHORITY level (the chain recombines per-account
   * authority sets); this envelope only produces the independent per-key
   * signatures and checks them against the master-vault guardian threshold.
   *
   * - Missing vault ids → VaultError("VAULT_NOT_FOUND").
   * - Keys resolve through the same path as sign() (soldier/purpose ids fall
   *   back to their underlying network vault); the same physical key reached
   *   through two vault ids is signed ONCE (deduped by keyId — re-signing
   *   identical bytes adds no security).
   * - role: opts.role, else first available active → owner.
   * - threshold = master vault guardian threshold (3); satisfied =
   *   signatures.length >= threshold (honestly false when fewer keys exist).
   *
   * @throws VaultError("VAULT_NOT_FOUND"), ("KEY_NOT_FOUND"),
   *   ("ADAPTER_MISSING"), ("VALIDATION") when the network cannot be inferred
   *   or the adapter reports no digest.
   */
  async multiSign(vaultIds: string[], tx: UnsignedTx, opts?: MultiSignOptions): Promise<MultiSigResult> {
    if (vaultIds.length === 0) {
      throw new VaultError("VALIDATION", "multiSign requires at least one vault id");
    }
    const vault = this.deps.getVault();
    vault.ensureUnlocked();
    const state = this.requireState(vault);
    const uniqueIds = [...new Set(vaultIds)];
    for (const id of uniqueIds) {
      if (state.networks[id] === undefined && state.soldiers[id] === undefined && state.purposes[id] === undefined && state.master?.id !== id) {
        throw new VaultError("VAULT_NOT_FOUND", `vault "${id}" does not exist in this vault state`);
      }
    }
    const network = opts?.network ?? uniqueIds.map((id) => state.networks[id]?.network).find((n) => n !== undefined);
    if (network === undefined) {
      throw new VaultError("VALIDATION", "cannot infer the signing network — pass opts.network (none of the ids is a network vault)");
    }
    const adapter = this.adapterFor(network);

    const signatures: SignatureRecord[] = [];
    const seenKeyIds = new Set<string>();
    let digestHex: string | null = null;

    for (const id of uniqueIds) {
      const role = opts?.role !== undefined ? opts.role : this.firstAvailableRole(state, id, network);
      const keyId = this.resolveKeyId(state, id, network, role);
      if (keyId === null) {
        throw new VaultError("KEY_NOT_FOUND", `no active ${role ?? "default-role"} key for network "${network}" under vault "${id}"`);
      }
      if (seenKeyIds.has(keyId)) continue; // same physical key via another vault id
      seenKeyIds.add(keyId);

      const { privateKey, record } = await vault.revealKeyFor(keyId);
      if (record.role === null) {
        throw new VaultError("VALIDATION", `key ${keyId} is flavor-less (role null) and cannot sign this envelope`);
      }
      const signed = await adapter.sign(tx, { byRole: { [record.role]: privateKey } }, [record.role]);
      const signatureHex = signed.signatures[0];
      if (signatureHex === undefined) {
        throw new VaultError("VALIDATION", "adapter returned a signed transaction without signatures");
      }
      if (digestHex === null) {
        const reported = metadataString(signed, "digestHex");
        if (reported === null) {
          throw new VaultError("VALIDATION", "adapter did not report a digestHex in SignedTx.metadata");
        }
        digestHex = reported;
      }
      signatures.push({
        vaultId: id,
        keyId,
        role: record.role,
        publicKey: this.publicKeyFor(record.publicKey, privateKey, network),
        signatureHex,
        signedAt: Date.now(),
      });
    }

    const threshold = state.master?.threshold ?? 3;
    const satisfied = signatures.length >= threshold;

    await this.logAudit({
      type: "signing_attempt",
      actor: { vaultId: uniqueIds[0]! },
      target: { vaultId: uniqueIds[0]!, detail: { multiSig: true, vaultIds: uniqueIds, network, signatureCount: signatures.length, satisfied } },
      result: "success",
      reason: `multiSign: ${signatures.length} signature(s), threshold ${threshold}`,
    });
    for (const sig of signatures) {
      await this.logAudit({
        type: "key_used",
        actor: { vaultId: sig.vaultId, keyId: sig.keyId },
        target: { vaultId: sig.vaultId, keyId: sig.keyId, detail: { multiSig: true } },
        result: "success",
      });
    }

    return { digestHex: digestHex ?? "", signatures, threshold, satisfied };
  }

  /**
   * Sequentially signs a batch through the SAME single-sign path. Every
   * entry is independently try/caught: a POLICY_DENIED (or any other)
   * failure is recorded as a failed result entry and NEVER aborts the rest
   * of the batch. Each entry — success or failure — is audited by sign()
   * itself (signing_attempt success/failure, policy_violation on blocks,
   * broadcast events per options.broadcast).
   *
   * The entry operation's vaultId wins when non-empty; otherwise the batch
   * `vaultId` is applied.
   */
  async batchSign(
    vaultId: string,
    batch: Array<{ op: PolicyOperation; tx: UnsignedTx }>,
    options?: OrchestratorSignOptions,
  ): Promise<BatchSignResult> {
    const results: BatchSignResult["results"] = [];
    let succeeded = 0;
    let failed = 0;
    for (let i = 0; i < batch.length; i++) {
      const entry = batch[i]!;
      const op: PolicyOperation = entry.op.vaultId.length > 0 ? entry.op : { ...entry.op, vaultId };
      const result: BatchSignResult["results"][number] = {
        index: i,
        ok: false,
        txId: null,
        digestHex: null,
        error: null,
        broadcastResult: null,
      };
      try {
        const out = await this.sign(op, entry.tx, options);
        result.ok = true;
        result.digestHex = metadataString(out.signed, "digestHex");
        if (out.broadcast !== null) {
          result.broadcastResult = {
            txId: out.broadcast.txId,
            ...(out.broadcast.blockNum !== undefined ? { blockNum: out.broadcast.blockNum } : {}),
          };
          result.txId = out.broadcast.txId;
        }
        succeeded++;
      } catch (e) {
        result.error = e instanceof VaultError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : "unknown failure";
        failed++;
      }
      results.push(result);
    }
    return { results, succeeded, failed };
  }

  /**
   * Signs a source-network transaction and, when possible, the paired
   * target-network transaction of a cross-chain move. ZERO MOCK: the source
   * must sign for real (failures throw); a missing target adapter yields
   * errors ["no adapter for network ..."] with target: null — never a
   * fabricated signature. The target signing best-effort failure is
   * recorded in errors while the source result is preserved.
   */
  async crossChainSign(
    sourceVaultId: string,
    targetNetwork: NetworkId,
    op: PolicyOperation,
    txs: { source: UnsignedTx; target: UnsignedTx },
  ): Promise<CrossChainSignature> {
    const errors: string[] = [];
    const sourceOp: PolicyOperation = { ...op, vaultId: sourceVaultId };
    const sourceOut = await this.sign(sourceOp, txs.source, { broadcast: false });

    const adapters = this.deps.getAdapters();
    let target: SignatureRecord | null = null;
    if (adapters[targetNetwork] === undefined) {
      errors.push(`no adapter for network "${targetNetwork}"`);
    } else {
      const targetOp: PolicyOperation = { ...sourceOp, network: targetNetwork, vaultId: `network-${targetNetwork}` };
      try {
        const targetOut = await this.sign(targetOp, txs.target, { broadcast: false });
        target = targetOut.signature;
      } catch (e) {
        errors.push(
          `target signature failed: ${e instanceof VaultError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : "unknown failure"}`,
        );
      }
    }

    return {
      sourceNetwork: op.network,
      targetNetwork,
      source: sourceOut.signature,
      target,
      errors,
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Policy gate shared by evaluateAndCheck/sign — returns the audited form of the operation. */
  private async evaluateInternal(
    op: PolicyOperation,
    stepUpSatisfied: boolean,
  ): Promise<{ decision: PolicyDecision; effOp: PolicyOperation; networkVault: NetworkVaultConfig; underlyingVaultId: string }> {
    const vault = this.deps.getVault();
    const state = this.requireState(vault);
    const networkVault = state.networks[`network-${op.network}`];
    if (networkVault === undefined) {
      throw new VaultError(
        "VAULT_NOT_FOUND",
        `no network vault is configured for network "${op.network}" — the orchestrator refuses to evaluate (fail-closed)`,
      );
    }
    const ctx = await this.buildContext(op, { stepUpSatisfied });
    const { effOp } = this.buildEffectiveOp(state, op, ctx);
    const decision = this.deps.getPolicy().evaluate(effOp, ctx, state.policies);

    if (decision.requirements?.stepUpAuth === true && ctx.stepUpSatisfied !== true) {
      await this.auditPolicyViolation(effOp, op.vaultId, "POLICY_STEP_UP_REQUIRED", "step-up authentication required before signing");
      throw new VaultError("POLICY_STEP_UP_REQUIRED", "step-up authentication (password re-entry) is required before this operation can proceed", {
        decision,
      });
    }
    if (!decision.allowed) {
      await this.auditPolicyViolation(effOp, op.vaultId, "POLICY_DENIED", decision.reasons.join("; "));
      throw new VaultError("POLICY_DENIED", decision.reasons.join("; "), { decision });
    }
    return { decision, effOp, networkVault, underlyingVaultId: this.underlyingVaultId(state, op.vaultId, op.network) };
  }

  /** Injects the vault-derived policy config into a COPY of the operation. */
  private buildEffectiveOp(
    state: VaultStateDoc,
    op: PolicyOperation,
    ctx: OperationContext,
  ): { effOp: PolicyOperation } {
    const soldier: SoldierVaultConfig | null = state.soldiers[op.vaultId] ?? null;
    const networkVault = state.networks[`network-${op.network}`] ?? null;
    const detail: Record<string, unknown> = { ...(op.detail ?? {}) };

    if (networkVault !== null) {
      detail.allowedOperations = [...networkVault.allowedOperations];
      const limit = networkVault.maxAmountPerDay[op.symbol];
      if (typeof limit === "string") detail.dailyLimitSatoshis = limit;
    }
    detail.spentTodaySatoshis = this.spentTodaySatoshis(op, ctx);
    if (soldier !== null) {
      detail.soldierPermissions = { ...soldier.permissions };
    }
    return { effOp: { ...op, detail } };
  }

  /**
   * Today's (UTC-day) successful spend for the operation's symbol, summed
   * from the audit-derived history (bigint, malformed entries skipped).
   * Only signing lifecycle events feed the context; broadcast events carry
   * no target.operation, so each signed operation is counted exactly once.
   */
  private spentTodaySatoshis(op: PolicyOperation, ctx: OperationContext): string {
    const dayStart = utcDayStart(ctx.timestamp);
    let spent = 0n;
    for (const h of ctx.history) {
      if (h.timestamp < dayStart || h.result !== "success" || h.symbol !== op.symbol) continue;
      try {
        spent += parseSats(h.amountSatoshis);
      } catch {
        // Malformed historical amount — excluded from the sum, never fatal.
      }
    }
    return spent.toString();
  }

  /** Soldier/purpose ids resolve to their underlying network vault id. */
  private underlyingVaultId(state: VaultStateDoc, vaultId: string, network: NetworkId): string {
    const soldier = state.soldiers[vaultId];
    if (soldier !== undefined) {
      const linked = soldier.linkedVaults.find((vid) => state.networks[vid]?.network === network);
      return linked ?? `network-${network}`;
    }
    if (state.purposes[vaultId] !== undefined) return `network-${network}`;
    return vaultId;
  }

  /**
   * Key resolution: direct (vaultId, network, role) hit first; soldier and
   * purpose vault ids fall back to their underlying network vault. Returns
   * null when nothing matches (callers turn that into KEY_NOT_FOUND).
   */
  private resolveKeyId(state: VaultStateDoc, vaultId: string, network: NetworkId, role: KeyRole | null): string | null {
    const vault = this.deps.getVault();
    const direct = vault.selectKeyId({ vaultId, network, role });
    if (direct !== null) return direct;
    if (state.soldiers[vaultId] === undefined && state.purposes[vaultId] === undefined) return null;
    return vault.selectKeyId({ vaultId: this.underlyingVaultId(state, vaultId, network), network, role });
  }

  /** First available role for multiSign: active → owner (key-presence probe). */
  private firstAvailableRole(state: VaultStateDoc, vaultId: string, network: NetworkId): KeyRole | null {
    for (const role of ["active", "owner"] as const) {
      if (this.resolveKeyId(state, vaultId, network, role) !== null) return role;
    }
    return null;
  }

  /** Registered adapter or an honest ADAPTER_MISSING failure. */
  private adapterFor(network: NetworkId): ChainAdapter {
    const adapter = this.deps.getAdapters()[network];
    if (adapter === undefined) {
      throw new VaultError("ADAPTER_MISSING", `no chain adapter registered for network "${network}"`);
    }
    return adapter;
  }

  /**
   * The capability/timed-lock/confirm gate + actual broadcast. Every refusal
   * is an explicit VaultError — a requested broadcast is never silently
   * skipped.
   */
  private async broadcastSigned(
    adapter: ChainAdapter,
    signed: SignedTx,
    options: OrchestratorSignOptions,
    decision: PolicyDecision,
    effOp: PolicyOperation,
  ): Promise<BroadcastResult> {
    if (!adapter.capabilities.has("broadcast")) {
      throw new VaultError("ADAPTER_INCAPABLE", "broadcast not enabled for this adapter — construct with allowBroadcast");
    }
    // Timed lock: refuse to broadcast before the deadline. A positive lock
    // cannot elapse inside one synchronous call — callers split sign and
    // broadcast (or pass 0) deliberately.
    const lockSeconds = Math.max(options.timeLockSeconds ?? 0, decision.requirements?.timeLock ?? 0);
    if (lockSeconds > 0) {
      const lockUntil = Date.now() + lockSeconds * 1000;
      if (Date.now() < lockUntil) {
        throw new VaultError("TIMED_LOCK", `broadcast is time-locked for another ${lockSeconds}s — re-issue with broadcast once the lock expires`, {
          lockUntil,
        });
      }
    }
    if (options.confirmRequired !== undefined) {
      const approved = await options.confirmRequired({
        summary: `${effOp.type} ${effOp.amountSatoshis} ${effOp.symbol} on ${effOp.network}${effOp.counterparty !== null ? ` → ${effOp.counterparty}` : ""}`,
        operation: effOp,
        decision,
      });
      if (!approved) {
        throw new VaultError("VALIDATION", "operation cancelled — the confirmRequired gate declined the broadcast");
      }
    }
    return adapter.broadcast(signed);
  }

  /** Persisted public key, or honestly derived from the revealed key; never fabricated. */
  private publicKeyFor(persisted: string | null, privateKey: PrivateKey, network: NetworkId): string {
    if (persisted !== null) return persisted;
    const prefix = publicKeyPrefix(network);
    if (prefix === null) {
      throw new VaultError("VALIDATION", "key has no persisted public identity and this network has no STM-family representation");
    }
    return privateKey.publicKey.toString(prefix);
  }

  /** Debit/credit legs implied by the operation (for simulate's balance view). */
  private balanceLegsFor(op: PolicyOperation): Array<{ asset: string; satoshis: string }> {
    const legs: Array<{ asset: string; satoshis: string }> = [];
    if (op.type === "limit_order_create") {
      const sell = typeof op.detail?.amount_to_sell === "string" ? parseAssetString(op.detail.amount_to_sell) : null;
      const receive = typeof op.detail?.min_to_receive === "string" ? parseAssetString(op.detail.min_to_receive) : null;
      if (sell !== null) legs.push({ asset: sell.symbol, satoshis: sell.satoshis });
      if (receive !== null) legs.push({ asset: receive.symbol, satoshis: receive.satoshis });
    } else if (op.type === "transfer" || op.type === "transfer_to_vesting") {
      legs.push({ asset: op.symbol, satoshis: canonicalSats(op.amountSatoshis) });
    }
    return legs;
  }

  private async auditPolicyViolation(effOp: PolicyOperation, vaultId: string, code: string, reason: string): Promise<void> {
    await this.logAudit({
      type: "policy_violation",
      actor: { vaultId },
      target: { vaultId, operation: effOp, detail: { code } },
      result: "blocked",
      reason,
    });
  }

  private requireState(vault: SovereignVault): VaultStateDoc {
    const state = vault.getState();
    if (state === null) {
      throw new VaultError("VAULT_NOT_INITIALIZED", "vault state not initialized — initialize() first");
    }
    return state;
  }

  /** Audit log with the chain anchor (vaultInstanceId) injected here. */
  private async logAudit(input: Omit<LogAuditInput, "vaultInstanceId">): Promise<void> {
    await this.deps.getAudit().log({ ...input, vaultInstanceId: this.deps.getInstanceId() });
  }
}

/** Normalizes a satoshi string (strips leading zeros) — output form only. */
function canonicalSats(s: string): string {
  try {
    return parseSats(s).toString();
  } catch {
    return s;
  }
}
