/**
 * Saosmartwallet — Graphene HTLC witness layer (packages/swap, agent-9)
 * =====================================================================
 * Turns HTLC state into ON-CHAIN EVIDENCE for graphene-family legs (STEEM,
 * BLURT, HIVE — the chains the fleet's multichain surface already signs),
 * built exclusively through the EXISTING oracle-proven packer in
 * packages/chains/steem/src (imported READ-ONLY — zero edits to landed code).
 *
 * Two witness channels, both production patterns:
 *   1. custom_json op (id "saos.htlc") — the pure commitment/reveal channel
 *      (posting- or active-authority), packed with the node-proven op-id
 *      table (steem 18 / blurt 12 — the r20 live-oracle law).
 *   2. transfer op with the canonical witness JSON as the memo — the
 *      funds-and-proof channel: the lock moves value AND publishes the
 *      hashlock commitment in the same op, so the counterparty can verify
 *      the binding from block data alone.
 *
 * Fail-closed laws: id charset ^[a-z0-9._-]+$ ≤ 32 (chain rule), witness json
 * ≤ 8192 bytes (chain rule), transfer memo ≤ 2048 (conservative wire cap),
 * hashlock fields must be exactly 64 lowercase hex chars, preimage-phase
 * payloads must carry the preimage, and transactions must carry ≥ 1 op.
 * No wall-clock, no network, no new dependencies.
 */

import {
  type CustomJsonOperation,
  type OpIdTable,
  OP_IDS,
  type SteemOperationBody,
  type SteemOperationName,
  type TransferOperation,
  packOperation,
} from "../../chains/steem/src/operations";
import { type Asset } from "../../chains/steem/src/serializer";
import { type SteemTransaction, transactionDigest } from "../../chains/steem/src/transaction";
import { sha256Bytes, HTLC_PREIMAGE_MIN, HTLC_PREIMAGE_MAX } from "./htlc";

// ---------------------------------------------------------------------------
// Errors + laws
// ---------------------------------------------------------------------------

export class WitnessError extends Error {}

/** The custom_json plugin id for wallet HTLC witnesses (chain charset [a-z0-9._-], ≤ 32). */
export const HTLC_WITNESS_JSON_ID = "saos.htlc";
/** Chain rule: custom_json payload ≤ 8192 bytes. */
export const HTLC_WITNESS_JSON_MAX = 8192;
/** Conservative transfer-memo cap for witness memos (wire hygiene). */
export const HTLC_WITNESS_MEMO_MAX = 2048;
/** Witness schema version. */
export const HTLC_WITNESS_VERSION = 1 as const;

const JSON_ID_PATTERN = /^[a-z0-9._-]+$/;
const HEX64_PATTERN = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// Canonical witness payload
// ---------------------------------------------------------------------------

export interface WitnessPayload {
  v: typeof HTLC_WITNESS_VERSION;
  swap: string;
  phase: "hashlock" | "preimage";
  leg: "A" | "B";
  chain: string;
  /** 64 lowercase hex chars — sha256(preimage). */
  hashlock: string;
  /** 64 lowercase hex chars — required iff phase === "preimage". */
  preimage?: string;
  expiresAt: number;
}

/** Canonical deterministic JSON (sorted keys, zero whitespace) — from the core law. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

export function canonicalWitnessJson(payload: WitnessPayload): string {
  return canonicalJson(payload);
}

// ---------------------------------------------------------------------------
// Hex helpers (test-safe: fixtures derive digests at runtime, never literals)
// ---------------------------------------------------------------------------

export function bytesToHex(b: Uint8Array): string {
  return Buffer.from(b).toString("hex");
}

export function hexToBytes(h: string): Uint8Array {
  if (typeof h !== "string" || h.length % 2 !== 0 || /[^0-9a-fA-F]/.test(h)) {
    throw new WitnessError("hex string must be even-length and hexadecimal");
  }
  return new Uint8Array(Buffer.from(h, "hex"));
}

// ---------------------------------------------------------------------------
// Validation (fail-closed, before ANY packing)
// ---------------------------------------------------------------------------

function validatePayload(payload: WitnessPayload): string {
  if (!payload || payload.v !== 1) throw new WitnessError("witness payload v must be 1");
  if (typeof payload.swap !== "string" || payload.swap.length === 0) {
    throw new WitnessError("witness swap id must be a non-empty string");
  }
  if (payload.phase !== "hashlock" && payload.phase !== "preimage") {
    throw new WitnessError('witness phase must be "hashlock" or "preimage"');
  }
  if (payload.leg !== "A" && payload.leg !== "B") {
    throw new WitnessError('witness leg must be "A" or "B"');
  }
  if (typeof payload.chain !== "string" || payload.chain.length === 0) {
    throw new WitnessError("witness chain must be a non-empty string");
  }
  if (!HEX64_PATTERN.test(payload.hashlock)) {
    throw new WitnessError("witness hashlock must be 64 lowercase hex chars");
  }
  if (payload.phase === "preimage") {
    // The reveal hex must be even-length hex with byte length inside the core's
    // preimage law (16..1024), and MUST satisfy the binding — the witness never
    // publishes a lie.
    const preimageHex = payload.preimage ?? "";
    if (!/^[0-9a-f]*$/.test(preimageHex) || preimageHex.length % 2 !== 0) {
      throw new WitnessError("a preimage-phase witness must carry an even-length lowercase hex preimage");
    }
    const preimageBytes = hexToBytes(preimageHex);
    if (preimageBytes.length < HTLC_PREIMAGE_MIN || preimageBytes.length > HTLC_PREIMAGE_MAX) {
      throw new WitnessError(`preimage byte length must be ${HTLC_PREIMAGE_MIN}..${HTLC_PREIMAGE_MAX}`);
    }
    if (bytesToHex(sha256Bytes(preimageBytes)) !== payload.hashlock) {
      throw new WitnessError("witness refused: sha256(preimage) does not equal the hashlock");
    }
  }
  if (!Number.isInteger(payload.expiresAt) || payload.expiresAt < 0 || payload.expiresAt > 0xffffffff) {
    throw new WitnessError("witness expiresAt must be a u32 unix timestamp");
  }
  const json = canonicalWitnessJson(payload);
  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes > HTLC_WITNESS_JSON_MAX) {
    throw new WitnessError(`witness json is ${bytes} bytes — the chain rule caps custom_json at ${HTLC_WITNESS_JSON_MAX}`);
  }
  return json;
}

function validateJsonId(id: string): void {
  if (typeof id !== "string" || id.length === 0 || id.length > 32 || !JSON_ID_PATTERN.test(id)) {
    throw new WitnessError('custom_json id must match [a-z0-9._-]+ and be at most 32 chars');
  }
}

// ---------------------------------------------------------------------------
// Witness op builders
// ---------------------------------------------------------------------------

export interface WitnessCustomJsonOptions {
  account: string;
  payload: WitnessPayload;
  /** Override the plugin id (defaults to HTLC_WITNESS_JSON_ID); chain charset enforced. */
  jsonId?: string;
  /** "posting" (default — the agent hand) or "active" (funds-authority witness). */
  authority?: "posting" | "active";
}

/** Builds a custom_json witness op body through the canonical witness JSON. */
export function buildWitnessCustomJson(opts: WitnessCustomJsonOptions): CustomJsonOperation {
  validateJsonId(opts.jsonId ?? HTLC_WITNESS_JSON_ID);
  if (typeof opts.account !== "string" || opts.account.length === 0) {
    throw new WitnessError("account must be a non-empty string");
  }
  const json = validatePayload(opts.payload);
  return opts.authority === "active"
    ? { required_auths: [opts.account], required_posting_auths: [], id: opts.jsonId ?? HTLC_WITNESS_JSON_ID, json }
    : { required_auths: [], required_posting_auths: [opts.account], id: opts.jsonId ?? HTLC_WITNESS_JSON_ID, json };
}

export interface WitnessTransferOptions {
  from: string;
  to: string;
  amount: Asset;
  payload: WitnessPayload;
}

/** Builds a transfer op whose memo IS the canonical witness JSON (funds + proof in one op). */
export function buildWitnessTransfer(opts: WitnessTransferOptions): TransferOperation {
  const memo = validatePayload(opts.payload);
  if (typeof opts.from !== "string" || opts.from.length === 0) throw new WitnessError("from must be a non-empty string");
  if (typeof opts.to !== "string" || opts.to.length === 0) throw new WitnessError("to must be a non-empty string");
  if (Buffer.byteLength(memo, "utf8") > HTLC_WITNESS_MEMO_MAX) {
    throw new WitnessError(`witness memo is over the ${HTLC_WITNESS_MEMO_MAX}-byte cap`);
  }
  return { from: opts.from, to: opts.to, amount: opts.amount, memo };
}

// ---------------------------------------------------------------------------
// Transaction assembly (envelope from the landed chains law, read-only)
// ---------------------------------------------------------------------------

export type WitnessOpSpec =
  | ({ kind: "custom_json" } & WitnessCustomJsonOptions)
  | ({ kind: "transfer" } & WitnessTransferOptions);

export interface WitnessTxSpec {
  refBlockNum: number;
  refBlockPrefix: number;
  /** Unix seconds (u32) — the transaction expiration. */
  expiration: number;
  operations: WitnessOpSpec[];
}

/** Maps one witness spec onto the native chains op vocabulary. */
export function buildWitnessOperation(spec: WitnessOpSpec): { name: SteemOperationName; body: SteemOperationBody } {
  if (spec.kind === "custom_json") {
    const { kind: _kind, ...rest } = spec;
    return { name: "custom_json", body: buildWitnessCustomJson(rest) };
  }
  const { kind: _kind, ...rest } = spec;
  return { name: "transfer", body: buildWitnessTransfer(rest) };
}

/** Assembles a SteemTransaction carrying witness ops (chains envelope, read-only reuse). */
export function buildWitnessTransaction(spec: WitnessTxSpec): SteemTransaction {
  if (!Array.isArray(spec.operations) || spec.operations.length === 0) {
    throw new WitnessError("a witness transaction must carry at least one operation");
  }
  if (!Number.isInteger(spec.refBlockNum) || spec.refBlockNum < 0 || spec.refBlockNum > 0xffff) {
    throw new WitnessError("refBlockNum must be a u16");
  }
  if (!Number.isInteger(spec.refBlockPrefix) || spec.refBlockPrefix < 0 || spec.refBlockPrefix > 0xffffffff) {
    throw new WitnessError("refBlockPrefix must be a u32");
  }
  if (!Number.isInteger(spec.expiration) || spec.expiration <= 0 || spec.expiration > 0xffffffff) {
    throw new WitnessError("expiration must be a positive u32 unix timestamp");
  }
  return {
    refBlockNum: spec.refBlockNum,
    refBlockPrefix: spec.refBlockPrefix,
    expiration: spec.expiration,
    operations: spec.operations.map(buildWitnessOperation),
  };
}

/**
 * The bytes signatures commit to for a witness transaction:
 * sha256(chain_id ‖ serialized_tx) — the chains law, with the per-chain
 * op-id table override (steem OP_IDS default, BLURT_OP_IDS for blurt legs).
 */
export function witnessTransactionDigest(tx: SteemTransaction, chainId: Uint8Array, opIds: OpIdTable = OP_IDS): Uint8Array {
  return transactionDigest(tx, chainId, opIds);
}

/** Packs a witness op into a ByteWriter (exposed for oracle-vector tests). */
export function packWitnessOperation(
  w: Parameters<typeof packOperation>[0],
  spec: WitnessOpSpec,
  opIds: OpIdTable = OP_IDS,
): void {
  const { name, body } = buildWitnessOperation(spec);
  packOperation(w, name, body, opIds);
}
