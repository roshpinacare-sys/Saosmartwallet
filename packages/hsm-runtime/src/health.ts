/**
 * packages/hsm-runtime — honest health verdicts
 * ==============================================
 * The measured truth per capability, computed from runtime state — never
 * asserted. Verdict vocabulary (fleet verdict discipline):
 *
 *   vault    OPEN | SEALED          — SEALED carries the stable vault error code
 *   signing  READY | NO-KEYS | BLOCKED-AUTH | BLOCKED-VAULT
 *   token    SET | UNSET
 *   broadcast DISABLED              — structural: no broadcast endpoint exists
 *
 * The BARE /health shape (bareHealth) carries liveness only — zero
 * operational data (fleet law: status endpoints are liveness; operational
 * verdicts live behind the token gate).
 */

import { BROADCAST, MODE, SERVICE_NAME } from "./config";

export type SigningVerdict = "READY" | "NO-KEYS" | "BLOCKED-AUTH" | "BLOCKED-VAULT";
export type VaultVerdict = "OPEN" | "SEALED";

export interface HealthState {
  service: typeof SERVICE_NAME;
  mode: typeof MODE;
  broadcast: typeof BROADCAST;
  time: string;
  uptimeSeconds: number;
  vault: VaultVerdict;
  vaultReason: string | null;
  signing: SigningVerdict;
  token: "SET" | "UNSET";
  keys: { total: number; byType: Record<string, number> };
  reasons: string[];
}

export interface KeyMetaLike {
  id: string;
  type: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export interface HealthInput {
  vaultOpen: boolean;
  vaultReason: string | null;
  tokenSet: boolean;
  keyMetadata: KeyMetaLike[] | null;
  startedAt: number;
  now: number;
}

const SIGNING_KEY_TYPES = new Set(["ed25519", "secp256k1-wif"]);

/** Computes the measured health verdicts (pure, deterministic). */
export function measureHealth(input: HealthInput): HealthState {
  const reasons: string[] = [];
  const vault: VaultVerdict = input.vaultOpen ? "OPEN" : "SEALED";
  const token = input.tokenSet ? "SET" : "UNSET";

  if (!input.tokenSet) {
    reasons.push("signing BLOCKED-AUTH: HSM_SIGNING_TOKEN is unset — the gated API refuses every request (deny-by-default)");
  }
  if (!input.vaultOpen) {
    reasons.push(`signing BLOCKED-VAULT: vault SEALED (${input.vaultReason ?? "unknown"})`);
  }

  const byType: Record<string, number> = {};
  let signingKeys = 0;
  for (const k of input.keyMetadata ?? []) {
    byType[k.type] = (byType[k.type] ?? 0) + 1;
    if (SIGNING_KEY_TYPES.has(k.type)) signingKeys += 1;
  }

  let signing: SigningVerdict;
  if (!input.tokenSet) {
    signing = "BLOCKED-AUTH";
  } else if (!input.vaultOpen) {
    signing = "BLOCKED-VAULT";
  } else if (signingKeys === 0) {
    signing = "NO-KEYS";
    reasons.push("signing NO-KEYS: vault is open but holds no signing-capable keys (ed25519/secp256k1-wif) — load keys via the owner's custody flow");
  } else {
    signing = "READY";
  }

  return {
    service: SERVICE_NAME,
    mode: MODE,
    broadcast: BROADCAST,
    time: new Date(input.now).toISOString(),
    uptimeSeconds: Math.max(0, Math.floor((input.now - input.startedAt) / 1000)),
    vault,
    vaultReason: input.vaultOpen ? null : (input.vaultReason ?? "unknown"),
    signing,
    token,
    keys: { total: (input.keyMetadata ?? []).length, byType },
    reasons,
  };
}

export interface BareHealth {
  ok: true;
  service: typeof SERVICE_NAME;
  mode: typeof MODE;
  broadcast: typeof BROADCAST;
  time: string;
  uptimeSeconds: number;
}

/** Liveness-only projection — deliberately carries no operational data. */
export function bareHealth(state: HealthState): BareHealth {
  return {
    ok: true,
    service: state.service,
    mode: state.mode,
    broadcast: state.broadcast,
    time: state.time,
    uptimeSeconds: state.uptimeSeconds,
  };
}
