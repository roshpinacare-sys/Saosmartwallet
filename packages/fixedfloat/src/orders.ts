/**
 * Saosmartwallet packages/fixedfloat — order lifecycle model + rail receipts
 * ==========================================================================
 * Honest status semantics: only the codes with a measured/documented meaning
 * get a phase name; every other code surfaces as {phase:"unknown", raw} so
 * the connector NEVER invents exchange semantics it has not verified.
 *
 * Rail receipts follow the fleet hash-chain law (sha256 over canonical JSON,
 * prev→hash, deterministic, tamper-evident) — the same discipline as
 * packages/swap rehearse.ts and packages/htlc receipts, so the fixedfloat
 * leg can anchor into fleet-economy without a bespoke format.
 */

import { createHash } from "node:crypto";

/** Documented FixedFloat v1 numeric order statuses. */
export type FfOrderStatus = number;

export type StatusPhase =
  | "awaiting-deposit"
  | "confirming"
  | "exchanging"
  | "sending"
  | "complete"
  | "expired"
  | "failed"
  | { phase: "unknown"; raw: number };

/** Documented mapping (v1 status codes). */
export function statusPhase(status: FfOrderStatus): StatusPhase {
  switch (status) {
    case 0:
      return "awaiting-deposit";
    case 1:
      return "confirming";
    case 2:
      return "exchanging";
    case 3:
      return "sending";
    case 4:
      return "complete";
    case -1:
      return "expired";
    case -2:
      return "failed";
    default:
      return { phase: "unknown", raw: status };
  }
}

/** Terminal phases. Unknown codes are NOT terminal — polling continues. */
export function isTerminalStatus(status: FfOrderStatus): boolean {
  const p = statusPhase(status);
  return p === "complete" || p === "expired" || p === "failed";
}

/** Emergency continuation choice (documented v1 setEmergency values). */
export type EmergencyChoice = "EXCHANGE" | "REFUND";

export interface EmergencyAction {
  id: string;
  choice: EmergencyChoice;
  /** Required for REFUND (destination of the returned funds); forbidden for EXCHANGE. */
  address?: string;
}

export type EmergencyVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Local fail-closed validation for setEmergency — zero wire calls on refusal:
 *   • order id must be non-empty;
 *   • REFUND requires a refund address;
 *   • EXCHANGE must NOT carry an address (the continuation uses the order's
 *     original destination — a second address here is a divergence).
 */
export function validateEmergencyAction(action: EmergencyAction): EmergencyVerdict {
  if (typeof action.id !== "string" || action.id.trim().length === 0) {
    return { ok: false, reason: "order id is empty" };
  }
  if (action.choice === "REFUND") {
    if (typeof action.address !== "string" || action.address.trim().length === 0) {
      return { ok: false, reason: "REFUND requires a refund address" };
    }
    return { ok: true };
  }
  if (action.choice === "EXCHANGE") {
    if (typeof action.address === "string" && action.address.trim().length > 0) {
      return { ok: false, reason: "EXCHANGE must not carry an address — the order's original destination applies" };
    }
    return { ok: true };
  }
  return { ok: false, reason: "unknown emergency choice" };
}

// ── rail receipts (fleet hash-chain law) ────────────────────────────────────

/** all-zero 32 bytes — the chain's genesis prev. */
export const RAIL_GENESIS_PREV_HASH: number[] = new Array<number>(32).fill(0);

export interface RailReceiptEvent {
  at: number;
  orderId: string;
  kind: string;
  detail?: Record<string, unknown>;
}

export interface RailReceiptRecord extends RailReceiptEvent {
  seq: number;
  prevHash: number[];
  hash: number[];
}

export interface RailHead {
  record: RailReceiptRecord;
  hash: number[];
  trail: RailReceiptRecord[];
}

/** Canonical JSON: keys sorted, arrays/objects recursive — byte-deterministic. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

function sha256Bytes(data: string): number[] {
  return Array.from(createHash("sha256").update(data, "utf8").digest());
}

/**
 * Append one rail event. prev === null starts a chain at the genesis prev.
 * The returned head carries the full trail (append-only view of the chain).
 */
export function appendRailReceipt(prev: RailHead | null, event: RailReceiptEvent): RailHead {
  const seq = prev === null ? 1 : prev.record.seq + 1;
  const prevHash = prev === null ? RAIL_GENESIS_PREV_HASH : prev.hash;
  const digest = sha256Bytes(canonicalJson({ ...event, seq, prevHash }));
  const record: RailReceiptRecord = { ...event, seq, prevHash, hash: digest };
  return { record, hash: digest, trail: [...(prev?.trail ?? []), record] };
}

/** Verify a chain: recomputes every link; reports the FIRST broken index. */
export function verifyRailReceiptChain(records: RailReceiptRecord[]): {
  ok: boolean;
  brokenIndex?: number;
} {
  let prevHash: number[] = RAIL_GENESIS_PREV_HASH;
  let expectedSeq = 1;
  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    const { hash, ...rest } = r;
    const digest = sha256Bytes(canonicalJson(rest));
    if (r.seq !== expectedSeq) return { ok: false, brokenIndex: i };
    if (!arraysEqual(r.prevHash, prevHash)) return { ok: false, brokenIndex: i };
    if (!arraysEqual(hash, digest)) return { ok: false, brokenIndex: i };
    prevHash = hash;
    expectedSeq += 1;
  }
  return { ok: true };
}

function arraysEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
