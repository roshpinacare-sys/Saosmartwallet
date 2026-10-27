/**
 * packages/arb-executor — armed policy (fail-closed)
 * ===================================================
 * The standing order file lives in OWNER custody
 * (/home/z/coord-work/vaults/steem-secrets/exec-armed.json, measured shape
 * 2026-10-27). Loading laws:
 *
 *   • missing / unparsable / disarmed file ⇒ REFUSED rail (fail-closed) —
 *     an unarmed policy must never degrade into "run anyway";
 *   • allowTransfersOut MUST be false: the lawful rail is INTERNAL market
 *     conversions only (STEEM↔SBD on the internal exchange). A policy that
 *     permits out-transfers is not the lawful rail and is refused here —
 *     the executor structurally emits limit_order_create and nothing else;
 *   • cycle caps (maxOpsPerCycle, maxAskSteemPerCycle, maxBidSbdPerCycle,
 *     bidReserveSbd, minRcPct) are honored as hard ceilings;
 *   • arb thresholds: `policy.arb` (owner-configurable) — minSpreadBps,
 *     maxNotionalSbdPerOp, orderTtlSec. When the owner has not set them, a
 *     DOCUMENTED conservative built-in applies (never a permissive one) and
 *     every receipt records the threshold + its source.
 */

import { readFileSync } from "node:fs";

export interface ArmedPolicyRaw {
  armed?: boolean;
  maxOpsPerCycle?: number;
  maxAskSteemPerCycle?: number;
  maxBidSbdPerCycle?: number;
  bidReserveSbd?: number;
  minRcPct?: number;
  policy?: {
    allowTransfersOut?: boolean;
    allowDelegation?: boolean;
    transferAllowlist?: string[];
    delegationAllowlist?: string[];
    arb?: Partial<ArbThresholds>;
  };
  [k: string]: unknown;
}

export interface ArbThresholds {
  /** A conversion fires only when the measured edge clears this (bps). */
  minSpreadBps: number;
  /** Hard ceiling on a single conversion's SBD notional. */
  maxNotionalSbdPerOp: number;
  /** Internal-order lifetime seconds (uint32, ≤ the chain's own window). */
  orderTtlSec: number;
}

/** Conservative built-ins — apply ONLY when the owner policy is silent. */
export const BUILTIN_ARB_THRESHOLDS: ArbThresholds = {
  minSpreadBps: 100, // 1% — never fire on noise
  maxNotionalSbdPerOp: 50,
  orderTtlSec: 900,
};

export const MAX_OPS_PER_CYCLE_CAP = 60;

export type PolicyVerdict =
  | { ok: true; policy: ArmedPolicy }
  | { ok: false; reason: string };

export interface ArmedPolicy {
  armed: true;
  maxOpsPerCycle: number;
  maxAskSteemPerCycleSatoshis: number;
  maxBidSbdPerCycleSatoshis: number;
  bidReserveSbdSatoshis: number;
  minRcPct: number;
  allowTransfersOut: false;
  thresholds: ArbThresholds;
  thresholdsSource: "owner-policy" | "builtin-conservative";
  sourcePath: string;
}

const UNIT = 1000; // STEEM/SBD wire precision 3

function requirePositiveNumber(v: unknown, name: string): number {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
    throw new Error(`ARMED_POLICY_E_FIELD — "${name}" must be a positive finite number, got ${JSON.stringify(v)}`);
  }
  return n;
}

/** Parses + validates a raw policy document. Throws on every violation. */
export function parseArmedPolicy(raw: unknown, sourcePath: string): ArmedPolicy {
  const doc = raw as ArmedPolicyRaw;
  if (!doc || typeof doc !== "object") {
    throw new Error("ARMED_POLICY_E_MALFORMED — policy file is not an object");
  }
  if (doc.armed !== true) {
    throw new Error("ARMED_POLICY_E_DISARMED — rail refuses to run on a disarmed/missing armed flag (fail-closed)");
  }
  const allowTransfersOut = doc.policy?.allowTransfersOut;
  if (allowTransfersOut !== false) {
    throw new Error(
      "ARMED_POLICY_E_TRANSFER_LAW — policy.allowTransfersOut must be exactly false: the lawful rail is INTERNAL market conversions only (no external chain transfers)",
    );
  }
  const maxOps = requirePositiveNumber(doc.maxOpsPerCycle ?? MAX_OPS_PER_CYCLE_CAP, "maxOpsPerCycle");
  if (!Number.isInteger(maxOps) || maxOps > MAX_OPS_PER_CYCLE_CAP) {
    throw new Error(`ARMED_POLICY_E_CAP — maxOpsPerCycle ${maxOps} exceeds the mandate ceiling ${MAX_OPS_PER_CYCLE_CAP}`);
  }
  const ownerArb = doc.policy?.arb ?? {};
  const thresholds: ArbThresholds = {
    minSpreadBps:
      ownerArb.minSpreadBps !== undefined
        ? requirePositiveNumber(ownerArb.minSpreadBps, "policy.arb.minSpreadBps")
        : BUILTIN_ARB_THRESHOLDS.minSpreadBps,
    maxNotionalSbdPerOp:
      ownerArb.maxNotionalSbdPerOp !== undefined
        ? requirePositiveNumber(ownerArb.maxNotionalSbdPerOp, "policy.arb.maxNotionalSbdPerOp")
        : BUILTIN_ARB_THRESHOLDS.maxNotionalSbdPerOp,
    orderTtlSec:
      ownerArb.orderTtlSec !== undefined
        ? requirePositiveNumber(ownerArb.orderTtlSec, "policy.arb.orderTtlSec")
        : BUILTIN_ARB_THRESHOLDS.orderTtlSec,
  };
  if (!Number.isInteger(thresholds.orderTtlSec) || thresholds.orderTtlSec < 30 || thresholds.orderTtlSec > 3600) {
    throw new Error("ARMED_POLICY_E_TTL — orderTtlSec must be an integer within [30, 3600] (the chain's own window)");
  }
  return {
    armed: true,
    maxOpsPerCycle: maxOps,
    maxAskSteemPerCycleSatoshis: Math.round(requirePositiveNumber(doc.maxAskSteemPerCycle ?? 0.001, "maxAskSteemPerCycle") * UNIT),
    maxBidSbdPerCycleSatoshis: Math.round(requirePositiveNumber(doc.maxBidSbdPerCycle ?? 0.001, "maxBidSbdPerCycle") * UNIT),
    bidReserveSbdSatoshis: Math.round(requirePositiveNumber(doc.bidReserveSbd ?? 0, "bidReserveSbd") * UNIT),
    minRcPct: requirePositiveNumber(doc.minRcPct ?? 0, "minRcPct"),
    allowTransfersOut: false,
    thresholds,
    thresholdsSource: doc.policy?.arb !== undefined ? "owner-policy" : "builtin-conservative",
    sourcePath,
  };
}

/** Loads + validates the owner custody file. Throws (fail-closed). */
export function loadArmedPolicy(path: string): ArmedPolicy {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    throw new Error(`ARMED_POLICY_E_CUSTODY — cannot read ${path}: ${(e as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`ARMED_POLICY_E_MALFORMED — ${path} is not valid JSON`);
  }
  return parseArmedPolicy(parsed, path);
}
