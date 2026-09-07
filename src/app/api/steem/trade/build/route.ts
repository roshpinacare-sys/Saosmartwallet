/**
 * POST /api/steem/trade/build — DEX terminal order builder (M1)
 * ============================================================
 * Takes an order spec, computes the limit_order_create payload with INTEGER
 * math (BigInt — no floats on chain amounts), stamps it with fresh ref-block
 * fields via the M0 SteemAdapter, serializes it with the oracle-verified
 * binary engine, and returns the UNSIGNED transaction preview.
 *
 * SECURITY: no keys exist on this path. The response is a signing-ready
 * unsigned payload (serializedHex + digestHex); actual signing waits for the
 * packages/core keystore (M2). broadcast() is not wired here — the adapter is
 * constructed fail-closed.
 */

import { NextResponse } from "next/server";

import { steemAdapter } from "@/lib/steem-server";
import {
  SerializationError,
  formatAsset,
  STEEM_CHAIN_ID,
  serializeTransaction,
  transactionDigest,
  transactionId,
  type LimitOrderCreateOperation,
  type SteemTransaction,
} from "@/lib/steem-engine";

export const dynamic = "force-dynamic";

const PRICE_SCALE = 1_000_000n; // 6 decimals of price resolution (SBD per STEEM)

/** Parses a positive decimal string into (units, scale) integers. Fail closed. */
function parseDecimalToUnits(s: string, maxDecimals: number): bigint {
  if (typeof s !== "string" || s.length === 0 || s.length > 24) throw new SerializationError("invalid number");
  const match = new RegExp(`^(\\d+)(?:\\.(\\d{1,${maxDecimals}}))?$`).exec(s.trim());
  if (!match) throw new SerializationError(`number "${s}" must have at most ${maxDecimals} decimals`);
  const intPart = match[1];
  const fracPart = (match[2] ?? "").padEnd(maxDecimals, "0");
  const units = BigInt(intPart + fracPart);
  if (units <= 0n) throw new SerializationError("value must be positive");
  return units;
}

interface BuildRequest {
  account?: unknown;
  side?: unknown;
  amount?: unknown; // STEEM amount, up to 3 decimals
  price?: unknown; // SBD per STEEM, up to 6 decimals
  fillOrKill?: unknown;
  ttlSeconds?: unknown; // order lifetime
}

export async function POST(req: Request) {
  let body: BuildRequest;
  try {
    body = (await req.json()) as BuildRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  try {
    const account = String(body.account ?? "").trim().toLowerCase();
    const side = body.side === "buy" || body.side === "sell" ? body.side : null;
    if (!side) throw new SerializationError('side must be "buy" or "sell"');
    if (typeof body.amount !== "string" || typeof body.price !== "string") {
      throw new SerializationError("amount and price are required strings");
    }

    const amountSteemSat = parseDecimalToUnits(body.amount, 3); // STEEM precision 3
    const priceSat6 = parseDecimalToUnits(body.price, 6);

    // Integer cross-multiplication: SBD satoshis = STEEM sat × price(1e6) / 1e6.
    // BUY  ⇒ ceil (offer slightly more SBD per STEEM — order stays honest to quote)
    // SELL ⇒ floor (receive slightly fewer SBD per STEEM — never over-promises)
    const raw = amountSteemSat * priceSat6;
    const quotient = raw / PRICE_SCALE;
    const remainder = raw % PRICE_SCALE;
    const sellSbdSat = side === "buy" ? quotient + (remainder > 0n ? 1n : 0n) : quotient;
    if (sellSbdSat <= 0n) throw new SerializationError("total is below the 0.001 SBD resolution");

    const now = Math.floor(Date.now() / 1000);
    const ttlRaw = Number(body.ttlSeconds ?? 3600);
    const ttl = Number.isFinite(ttlRaw) ? Math.min(604_800, Math.max(120, Math.floor(ttlRaw))) : 3_600;
    const orderExpiration = now + ttl;
    const fillOrKill = body.fillOrKill === true;
    // Caller-chosen uint32 order id — timestamp-derived, cancelable later.
    const orderid = Date.now() & 0xffffffff;

    // Asset objects for exact integer math + wire body (BigInt, never floats).
    const sellAsset =
      side === "buy"
        ? { amount: sellSbdSat, precision: 3, symbol: "SBD" }
        : { amount: amountSteemSat, precision: 3, symbol: "STEEM" };
    const receiveAsset =
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
      operations: [{ name: "limit_order_create", body: { ...payload, amount_to_sell: sellAsset, min_to_receive: receiveAsset } as LimitOrderCreateOperation }],
    };
    const serializedHex = Buffer.from(serializeTransaction(steemTx)).toString("hex");
    const digestHex = Buffer.from(transactionDigest(steemTx, STEEM_CHAIN_ID)).toString("hex");
    const txId = transactionId(steemTx);

    const effectivePriceSat = sellSbdSat * PRICE_SCALE / amountSteemSat; // in 1e6 scale
    return NextResponse.json(
      {
        ok: true,
        signingStatus: "awaiting-keystore (M2) — unsigned preview only",
        side,
        operation: {
          type: "limit_order_create",
          payload: {
            owner: payload.owner,
            orderid: payload.orderid,
            amount_to_sell: payload.amount_to_sell, // already a canonical asset string
            min_to_receive: payload.min_to_receive,
            fill_or_kill: payload.fill_or_kill,
            expiration: new Date(orderExpiration * 1000).toISOString().slice(0, 19),
          },
        },
        effectivePrice: String(effectivePriceSat),
        unsignedTx: {
          chainId: unsigned.chainId,
          refBlockNum: meta.refBlockNum,
          refBlockPrefix: meta.refBlockPrefix,
          txExpiration: new Date(meta.expiration * 1000).toISOString().slice(0, 19),
          orderExpiration: new Date(orderExpiration * 1000).toISOString().slice(0, 19),
        },
        serializedHex,
        digestHex,
        txId,
        byteLength: serializedHex.length / 2,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "order build failed" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
