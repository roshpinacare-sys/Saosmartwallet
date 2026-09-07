/**
 * POST /api/steem/trade/build — DEX terminal order builder (M1, refactored 4-a)
 * ===========================================================================
 * Takes an order spec, computes the limit_order_create payload with INTEGER
 * math (BigInt — no floats on chain amounts), stamps it with fresh ref-block
 * fields via the M0 SteemAdapter, serializes it with the oracle-verified
 * binary engine, and returns the UNSIGNED transaction preview.
 *
 * The deterministic build logic now lives in @/lib/steem-order
 * (buildSteemOrderTx) so /api/vault/sign can rebuild byte-identical orders.
 * The HTTP response shape is unchanged from M1 — byte-identical fields and
 * the same signingStatus string.
 *
 * SECURITY: no keys exist on this path. The response is a signing-ready
 * unsigned payload (serializedHex + digestHex); actual signing happens in
 * POST /api/vault/sign behind the vault + policy engine. broadcast() is not
 * wired here — the adapter is constructed fail-closed.
 */

import { NextResponse } from "next/server";

import { SerializationError } from "@/lib/steem-engine";
import { buildSteemOrderTx } from "@/lib/steem-order";

export const dynamic = "force-dynamic";

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
    if (typeof body.account !== "string") throw new SerializationError("account is required");
    if (typeof body.amount !== "string" || typeof body.price !== "string") {
      throw new SerializationError("amount and price are required strings");
    }
    if (body.side !== "buy" && body.side !== "sell") {
      throw new SerializationError('side must be "buy" or "sell"');
    }

    const built = await buildSteemOrderTx({
      account: body.account,
      side: body.side,
      amount: body.amount,
      price: body.price,
      fillOrKill: body.fillOrKill === true,
      ttlSeconds: typeof body.ttlSeconds === "number" ? body.ttlSeconds : 3600,
    });

    const { payload, meta } = { payload: built.payload, meta: built.unsigned.metadata as { refBlockNum: number; refBlockPrefix: number; expiration: number } };
    return NextResponse.json(
      {
        ok: true,
        signingStatus: "awaiting-keystore (M2) — unsigned preview only",
        side: body.side,
        operation: {
          type: "limit_order_create",
          payload: {
            owner: payload.owner,
            orderid: payload.orderid,
            amount_to_sell: payload.amount_to_sell, // already a canonical asset string
            min_to_receive: payload.min_to_receive,
            fill_or_kill: payload.fill_or_kill,
            expiration: new Date(payload.expiration * 1000).toISOString().slice(0, 19),
          },
        },
        effectivePrice: String(built.effectivePriceSat),
        unsignedTx: {
          chainId: built.unsigned.chainId,
          refBlockNum: meta.refBlockNum,
          refBlockPrefix: meta.refBlockPrefix,
          txExpiration: new Date(meta.expiration * 1000).toISOString().slice(0, 19),
          orderExpiration: new Date(payload.expiration * 1000).toISOString().slice(0, 19),
        },
        serializedHex: built.serializedHex,
        digestHex: built.digestHex,
        txId: built.txId,
        byteLength: built.byteLength,
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
