/**
 * Saosmartwallet — vault runtime singleton (M2, task 4-a)
 * =======================================================
 * The ONE wiring point between the Sovereign Key Vault engine
 * (packages/core) and the /api/vault/* routes:
 *
 *   vault      — SovereignVault over the Prisma state store (layer 1)
 *   audit      — hash-chained AuditSystem over the Prisma audit store (layer 6)
 *   policy     — PolicyEngine with the compiled-in STATIC_RULES (layer 3)
 *   steemSigningAdapter — the ONLY broadcast-enabled SteemAdapter in the
 *                 process; every broadcast flows exclusively through the
 *                 policy-gated SigningOrchestrator (never this adapter
 *                 directly).
 *   orchestrator — SigningOrchestrator (layer 4) wired to all of the above.
 *
 * A 30s sweeper arms the idle auto-lock (vault.maybeAutoLock) and records
 * the dead-man heartbeat (BackupManager.heartbeat) while a session is
 * unlocked. It is registered once per process, never throws, and is unref'd
 * so it cannot keep the runtime alive.
 *
 * SECURITY: no password/secret ever crosses this module; error mapping
 * exposes only the engine's own VaultError codes and the (non-secret)
 * PolicyDecision attached to policy failures.
 */

import {
  AuditSystem,
  BackupManager,
  PolicyEngine,
  STATIC_RULES,
  SigningOrchestrator,
  SovereignVault,
  VaultError,
  VaultKeys,
  derivePrivateKey,
  parseSats,
  type PolicyDecision,
  type PolicyOperation,
} from "../../packages/core/src/index";
import { SteemAdapter } from "../../packages/chains/steem/src/adapter";
import { ETHEREUM_RPC_URLS, SOLANA_RPC_URLS, EthereumAdapter, SolanaAdapter } from "../../packages/chains";
import type { ApiError } from "@/lib/vault-contracts";
import { PrismaAuditStore, PrismaVaultStorage } from "./vault-stores";

// Re-exports for route files — Turbopack does not resolve deep relative
// imports from src/app/**, so routes pull the core runtime through here.
// (vault-contracts is FROZEN and does not export KeyRole/AuditEventType/
// ComplianceReportFormat/EncryptedPayload, so they route through here too.)
export { BackupManager, VaultError, VaultKeys, derivePrivateKey, parseSats, STATIC_RULES };
export type { OperationType, StorageKind } from "../../packages/core/src/index";
export type { InitializeOptions, SoldierUpsertInput, UpsertNetworkInput } from "../../packages/core/src/vault/vault";
export type { AuditEventType, ComplianceReportFormat, EncryptedPayload, KeyRole } from "../../packages/core/src/types";

// ---------------------------------------------------------------------------
// Runtime container
// ---------------------------------------------------------------------------

export interface VaultRuntime {
  vault: SovereignVault;
  audit: AuditSystem;
  policy: PolicyEngine;
  steemSigningAdapter: SteemAdapter;
  /** M3 — sign-capable, broadcast fail-closed (no "broadcast" capability). */
  ethereumAdapter: EthereumAdapter;
  solanaAdapter: SolanaAdapter;
  orchestrator: SigningOrchestrator;
  /** Resolves once the persisted state doc is loaded into memory. */
  ready: Promise<void>;
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

const globalForVault = globalThis as unknown as {
  __saosVaultRuntime?: VaultRuntime;
  __saosVaultSweeperArmed?: boolean;
};

function armSweeper(rt: VaultRuntime): void {
  if (globalForVault.__saosVaultSweeperArmed === true) return; // double-registration guard
  globalForVault.__saosVaultSweeperArmed = true;
  const timer = setInterval(() => {
    void autoLockSweep(rt);
  }, 30_000);
  // A background sweep must never keep the process alive on its own.
  timer.unref?.();
}

/**
 * Idle auto-lock + dead-man heartbeat sweep. Best-effort by design: any
 * failure (e.g. storage hiccup, VAULT_LOCKED race) is swallowed — the next
 * tick retries and the routes remain the source of truth for session state.
 */
async function autoLockSweep(rt: VaultRuntime): Promise<void> {
  try {
    if (!rt.vault.isUnlocked) return;
    const locked = rt.vault.maybeAutoLock();
    if (!locked) await BackupManager.heartbeat(rt.vault);
  } catch {
    // never crash the process from the sweep
  }
}

export function getVaultRuntime(): VaultRuntime {
  if (globalForVault.__saosVaultRuntime !== undefined) {
    return globalForVault.__saosVaultRuntime;
  }

  const auditStore = new PrismaAuditStore();
  const vault = new SovereignVault(new PrismaVaultStorage(), auditStore);
  const audit = new AuditSystem(auditStore);
  const policy = new PolicyEngine(STATIC_RULES);
  // The ONLY broadcast-enabled adapter in the process. It is handed to the
  // orchestrator alone — routes must never import it for signing/broadcast.
  const steemSigningAdapter = new SteemAdapter({
    rpcUrl: process.env.STEEM_RPC_URL ?? "https://api.steemit.com",
    allowBroadcast: true,
    requestTimeoutMs: 15_000,
  });
  // M3 adapters — SIGN-capable only: constructed WITHOUT allowBroadcast so
  // their capabilities lack "broadcast" and the orchestrator's broadcast
  // gate fails closed (honest "not broadcast-capable", never a silent send).
  const ethereumAdapter = new EthereumAdapter({ rpcUrls: [...ETHEREUM_RPC_URLS] });
  const solanaAdapter = new SolanaAdapter({ rpcUrls: [...SOLANA_RPC_URLS] });

  const getInstanceId = (): string => {
    const state = vault.getState();
    if (state === null) {
      throw new VaultError("VAULT_NOT_INITIALIZED", "vault state not initialized — initialize() first");
    }
    return state.vaultInstanceId;
  };

  const orchestrator = new SigningOrchestrator({
    getVault: () => vault,
    getPolicy: () => policy,
    getAudit: () => audit,
    getAdapters: () => ({ steem: steemSigningAdapter, ethereum: ethereumAdapter, solana: solanaAdapter }),
    getInstanceId,
  });

  const rt: VaultRuntime = {
    vault,
    audit,
    policy,
    steemSigningAdapter,
    ethereumAdapter,
    solanaAdapter,
    orchestrator,
    ready: vault.load(),
  };
  globalForVault.__saosVaultRuntime = rt;
  armSweeper(rt);
  return rt;
}

/** Stable vault instance id — throws VAULT_NOT_INITIALIZED before init. */
export function getInstanceId(): string {
  const state = getVaultRuntime().vault.getState();
  if (state === null) {
    throw new VaultError("VAULT_NOT_INITIALIZED", "vault state not initialized — initialize() first");
  }
  return state.vaultInstanceId;
}

// ---------------------------------------------------------------------------
// Shared op builder (POST /api/vault/simulate + POST /api/vault/sign)
// ---------------------------------------------------------------------------

/**
 * Builds the policy-gated limit_order_create PolicyOperation from a
 * deterministic steem-order build.
 *
 * amountSatoshis/symbol carry the leg the account puts AT RISK: the SBD
 * offered on a BUY, the STEEM sold on a SELL (`built.sellAsset`). This
 * matches the SimulateOrderRequest spec and routes both sides through the
 * STEEM daily-limit rule (the sign-route draft's `receiveAsset` branch for
 * sells would have keyed sells on SBD — which has no configured daily
 * limit — and bypassed the cap).
 */
export function buildSteemLimitOrderOp(built: {
  payload: { owner: string; orderid: number; amount_to_sell: string; min_to_receive: string; fill_or_kill: boolean; expiration: number };
  sellAsset: { amount: bigint; symbol: string };
}, params: { side: "buy" | "sell" }): PolicyOperation {
  return {
    vaultId: "network-steem",
    network: "steem",
    type: "limit_order_create",
    amountSatoshis: built.sellAsset.amount.toString(),
    symbol: built.sellAsset.symbol,
    counterparty: null,
    role: "active",
    detail: {
      account: built.payload.owner,
      side: params.side,
      orderid: built.payload.orderid,
      fill_or_kill: built.payload.fill_or_kill,
      // Asset strings — consumed by the orchestrator's balance-leg analysis
      // and echoed in the audit trail for the operation.
      amount_to_sell: built.payload.amount_to_sell,
      min_to_receive: built.payload.min_to_receive,
      expiration: built.payload.expiration,
    },
  };
}

// ---------------------------------------------------------------------------
// Error mapping — VaultError codes → HTTP status
// ---------------------------------------------------------------------------

const STATUS_BY_CODE: Record<string, number> = {
  VAULT_LOCKED: 423,
  VAULT_NOT_INITIALIZED: 409,
  WRONG_PASSWORD: 401,
  VAULT_EXISTS: 409,
  POLICY_DENIED: 403,
  POLICY_STEP_UP_REQUIRED: 403,
  VALIDATION: 400,
  SHAMIR_INVALID: 400,
  KEY_NOT_FOUND: 404,
  ADAPTER_MISSING: 502,
  ADAPTER_INCAPABLE: 502,
};

/** Structural guard for a recovered PolicyDecision in error details. */
function isPolicyDecision(v: unknown): v is PolicyDecision {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.allowed === "boolean" && Array.isArray(o.reasons) && Array.isArray(o.checks);
}

/**
 * Maps any thrown error to an HTTP status + ApiError body for the
 * /api/vault routes. VaultError codes map per the M2 table; everything else
 * is a generic 500. Never logs, never echoes secrets.
 */
export function mapVaultError(e: unknown): { status: number; body: ApiError } {
  if (e instanceof VaultError) {
    const status = STATUS_BY_CODE[e.code] ?? 500;
    const decision: unknown = e.details?.decision;
    return {
      status,
      body: {
        ok: false,
        error: e.message,
        code: e.code,
        ...(isPolicyDecision(decision) ? { decision } : {}),
      },
    };
  }
  return {
    status: 500,
    body: { ok: false, error: e instanceof Error ? e.message : "internal error" },
  };
}
