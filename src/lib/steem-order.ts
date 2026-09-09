/**
 * Saosmartwallet — deterministic Steem DEX order builder (M2, task 4-a)
 * =====================================================================
 * The shared order-build core extracted from POST /api/steem/trade/build
 * (M1). Computes the limit_order_create payload with INTEGER math (BigInt —
 * no floats ever touch chain amounts), stamps it with ref-block fields via
 * the M0 SteemAdapter, and serializes it with the oracle-verified binary
 * engine.
 *
 * Determinism contract (the signing path's rebuild guarantee):
 *   • spec.orderid          → used EXACTLY when provided (uint32);
 *                             else derived (Date.now() & 0xffffffff).
 *   • spec.orderExpiration  → used EXACTLY when provided (epoch seconds);
 *                             else derived (now + ttlSeconds, clamped
 *                             120s..7d, default 3600s).
 *   Ref-block fields + the 60s tx expiration are stamped FRESH by
 *   adapter.buildOperations on every call — the digest therefore always
 *   describes the bytes that will actually be signed/broadcast.
 *
 * SECURITY: no keys exist on this path — the result is a signing-ready
 * UNSIGNED transaction. Broadcast never happens here.
 */

import {
  SerializationError,
  formatAsset,
  STEEM_CHAIN_ID,
  serializeTransaction,
  transactionDigest,
  transactionId,
  type LimitOrderCancelOperation,
  type LimitOrderCreateOperation,
  type SteemTransaction,
} from "@/lib/steem-engine";
import type { UnsignedTx } from "../../packages/chains/chain-adapter";
import { steemAdapter } from "./steem-server";

const PRICE_SCALE = 1_000_000n; // 6 decimals of price resolution (SBD per STEEM)

export interface OrderAsset {
  amount: bigint;
  precision: 3;
  symbol: string;
}

export interface SteemOrderSpec {
  account: string;
  side: "buy" | "sell";
  /** STEEM amount, decimal string, up to 3 decimals (e.g. "12.345"). */
  amount: string;
  /** SBD per STEEM price, decimal string, up to 6 decimals (e.g. "0.098765"). */
  price: string;
  fillOrKill: boolean;
  ttlSeconds: number;
  /** Caller-chosen uint32 order id (deterministic rebuild for signing). */
  orderid?: number;
  /** Caller-fixed order expiration, epoch seconds (deterministic rebuild). */
  orderExpiration?: number;
}

export interface SteemOrderBuild {
  /** Adapter-level payload — assets as canonical strings across the boundary. */
  payload: {
    owner: string;
    orderid: number;
    amount_to_sell: string;
    min_to_receive: string;
    fill_or_kill: boolean;
    expiration: number;
  };
  /** The leg the account puts AT RISK (SBD on buy, STEEM on sell). */
  sellAsset: OrderAsset;
  /** The leg the account receives (STEEM on buy, SBD on sell). */
  receiveAsset: OrderAsset;
  /** Effective price in 1e6 scale (SBD satoshis per STEEM satoshi × 1e6). */
  effectivePriceSat: bigint;
  unsigned: UnsignedTx;
  serializedHex: string;
  /** sha256(chainId ‖ serialized tx) hex — the digest the key signs. */
  digestHex: string;
  txId: string;
  byteLength: number;
  /** Wire-exact transaction (asset bodies) behind serializedHex/digestHex. */
  steemTx: SteemTransaction;
}

/**
 * Parses a positive decimal string into (units, scale) integers. Fail closed.
 * (Moved verbatim from the M1 build route so every path shares one parser.)
 */
export function parseDecimalToUnits(s: string, maxDecimals: number): bigint {
  if (typeof s !== "string" || s.length === 0 || s.length > 24) throw new SerializationError("invalid number");
  const match = new RegExp(`^(\\d+)(?:\\.(\\d{1,${maxDecimals}}))?$`).exec(s.trim());
  if (!match) throw new SerializationError(`number "${s}" must have at most ${maxDecimals} decimals`);
  const intPart = match[1];
  const fracPart = (match[2] ?? "").padEnd(maxDecimals, "0");
  const units = BigInt(intPart + fracPart);
  if (units <= 0n) throw new SerializationError("value must be positive");
  return units;
}

/**
 * Builds one limit_order_create order end-to-end: payload → adapter-stamped
 * unsigned tx → serialized hex → digest → txId. All amounts stay in
 * satoshi/BigInt space until serialization.
 */
export async function buildSteemOrderTx(spec: SteemOrderSpec): Promise<SteemOrderBuild> {
  const account = spec.account.trim().toLowerCase();
  if (!account) throw new SerializationError("account is required");
  const side = spec.side === "buy" || spec.side === "sell" ? spec.side : null;
  if (!side) throw new SerializationError('side must be "buy" or "sell"');

  const amountSteemSat = parseDecimalToUnits(spec.amount, 3); // STEEM precision 3
  const priceSat6 = parseDecimalToUnits(spec.price, 6);

  // Integer cross-multiplication: SBD satoshis = STEEM sat × price(1e6) / 1e6.
  // BUY  ⇒ ceil (offer slightly more SBD per STEEM — order stays honest to quote)
  // SELL ⇒ floor (receive slightly fewer SBD per STEEM — never over-promises)
  const raw = amountSteemSat * priceSat6;
  const quotient = raw / PRICE_SCALE;
  const remainder = raw % PRICE_SCALE;
  const sellSbdSat = side === "buy" ? quotient + (remainder > 0n ? 1n : 0n) : quotient;
  if (sellSbdSat <= 0n) throw new SerializationError("total is below the 0.001 SBD resolution");

  // Deterministic order fields: caller-provided values are used EXACTLY
  // (signing rebuilds the exact order the user previewed); otherwise derive.
  const now = Math.floor(Date.now() / 1000);
  let orderExpiration: number;
  if (spec.orderExpiration !== undefined) {
    if (!Number.isInteger(spec.orderExpiration)) {
      throw new SerializationError("orderExpiration must be an integer (unix seconds)");
    }
    if (spec.orderExpiration <= now) {
      throw new SerializationError("orderExpiration is already in the past");
    }
    orderExpiration = spec.orderExpiration;
  } else {
    const ttlRaw = Number(spec.ttlSeconds ?? 3600);
    const ttl = Number.isFinite(ttlRaw) ? Math.min(604_800, Math.max(120, Math.floor(ttlRaw))) : 3_600;
    orderExpiration = now + ttl;
  }
  let orderid: number;
  if (spec.orderid !== undefined) {
    if (!Number.isInteger(spec.orderid) || spec.orderid < 0 || spec.orderid > 0xffffffff) {
      throw new SerializationError("orderid must be an integer in [0, 4294967295]");
    }
    orderid = spec.orderid;
  } else {
    // Caller-chosen uint32 order id — timestamp-derived, cancelable later.
    // (% not &: bitwise & yields a SIGNED int32 — negative since 2026-06 —
    // and would fail our own [0, 4294967295] validation.)
    orderid = Date.now() % 0x100000000;
  }
  const fillOrKill = spec.fillOrKill === true;

  // Asset objects for exact integer math + wire body (BigInt, never floats).
  const sellAsset: OrderAsset =
    side === "buy"
      ? { amount: sellSbdSat, precision: 3, symbol: "SBD" }
      : { amount: amountSteemSat, precision: 3, symbol: "STEEM" };
  const receiveAsset: OrderAsset =
    side === "buy"
      ? { amount: amountSteemSat, precision: 3, symbol: "STEEM" }
      : { amount: sellSbdSat, precision: 3, symbol: "SBD" };

  // The adapter contract carries assets as strings across the API boundary.
  const payload = {
    owner: account,
    orderid,
    amount_to_sell: formatAsset(sellAsset),
    min_to_receive: formatAsset(receiveAsset),
    fill_or_kill: fillOrKill,
    expiration: orderExpiration,
  };

  const adapter = steemAdapter();
  const unsigned = await adapter.buildOperations([
    { type: "limit_order_create", payload: payload as unknown as Record<string, unknown> },
  ]);

  const meta = unsigned.metadata as { refBlockNum: number; refBlockPrefix: number; expiration: number };
  const steemTx: SteemTransaction = {
    refBlockNum: meta.refBlockNum,
    refBlockPrefix: meta.refBlockPrefix,
    expiration: meta.expiration,
    operations: [
      {
        name: "limit_order_create",
        body: { ...payload, amount_to_sell: sellAsset, min_to_receive: receiveAsset } as LimitOrderCreateOperation,
      },
    ],
  };
  const serializedHex = Buffer.from(serializeTransaction(steemTx)).toString("hex");
  const digestHex = Buffer.from(transactionDigest(steemTx, STEEM_CHAIN_ID)).toString("hex");
  const txId = transactionId(steemTx);

  const effectivePriceSat = (sellSbdSat * PRICE_SCALE) / amountSteemSat; // in 1e6 scale
  return {
    payload,
    sellAsset,
    receiveAsset,
    effectivePriceSat,
    unsigned,
    serializedHex,
    digestHex,
    txId,
    byteLength: serializedHex.length / 2,
    steemTx,
  };
}

// ---------------------------------------------------------------------------
// limit_order_cancel — DEX lifecycle closure (M3+)
// ---------------------------------------------------------------------------

export interface SteemCancelSpec {
  account: string;
  /** The uint32 orderid from the original limit_order_create. */
  orderid: number;
}

export interface SteemCancelBuild {
  payload: { owner: string; orderid: number };
  unsigned: UnsignedTx;
  serializedHex: string;
  /** sha256(chainId ‖ serialized tx) hex — the digest the key signs. */
  digestHex: string;
  txId: string;
  byteLength: number;
  /** Wire-exact transaction (asset-free cancel body) behind serializedHex/digestHex. */
  steemTx: SteemTransaction;
}

/**
 * Builds one limit_order_cancel end-to-end: payload → adapter-stamped
 * unsigned tx → serialized hex → digest → txId. The orderid is used EXACTLY
 * as provided (the signing rebuild must cancel the very order the user saw);
 * ref-block fields + the 60s tx expiration are stamped FRESH by
 * adapter.buildOperations on every call.
 *
 * Cancel wire format is oracle-verified live against the node's own
 * serializer (see LimitOrderCancelOperation in packages/chains/steem).
 */
export async function buildSteemCancelTx(spec: SteemCancelSpec): Promise<SteemCancelBuild> {
  const account = spec.account.trim().toLowerCase();
  if (!account) throw new SerializationError("account is required");
  if (!Number.isInteger(spec.orderid) || spec.orderid < 0 || spec.orderid > 0xffffffff) {
    throw new SerializationError("orderid must be an integer in [0, 4294967295]");
  }
  const payload = { owner: account, orderid: spec.orderid };

  const adapter = steemAdapter();
  const unsigned = await adapter.buildOperations([
    { type: "limit_order_cancel", payload: payload as unknown as Record<string, unknown> },
  ]);

  const meta = unsigned.metadata as { refBlockNum: number; refBlockPrefix: number; expiration: number };
  const steemTx: SteemTransaction = {
    refBlockNum: meta.refBlockNum,
    refBlockPrefix: meta.refBlockPrefix,
    expiration: meta.expiration,
    operations: [
      {
        name: "limit_order_cancel",
        body: { ...payload } as LimitOrderCancelOperation,
      },
    ],
  };
  const serializedHex = Buffer.from(serializeTransaction(steemTx)).toString("hex");
  const digestHex = Buffer.from(transactionDigest(steemTx, STEEM_CHAIN_ID)).toString("hex");
  const txId = transactionId(steemTx);

  return {
    payload,
    unsigned,
    serializedHex,
    digestHex,
    txId,
    byteLength: serializedHex.length / 2,
    steemTx,
  };
}
