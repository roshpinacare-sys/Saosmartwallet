export const runtime = "nodejs";

/**
 * POST /api/steem/trade/cancel — DEX order-cancel builder (M3+, lifecycle)
 * =========================================================================
 * Takes { account, orderid }, builds the limit_order_cancel payload (the
 * orderid rides through EXACTLY — the cancel must name the very order the
 * user saw), stamps fresh ref-block fields via the M0 SteemAdapter,
 * serializes with the oracle-verified engine (cancel wire format verified
 * live against condenser_api.get_transaction_hex, 2026-09-08), and returns
 * the UNSIGNED transaction preview.
 *
 * SECURITY: no keys exist on this path. The response is a signing-ready
 * unsigned payload (serializedHex + digestHex); signing+broadcast happen in
 * POST /api/vault/sign-cancel behind the vault + policy engine.
 *
 * Rate limit: per-IP token bucket (shared util with trade/build) — the
 * builder hits the upstream RPC for ref-block fields on every call.
 */

import { NextResponse } from "next/server";

import { SerializationError } from "@/lib/steem-engine";
import { buildSteemCancelTx } from "@/lib/steem-order";
import { clientIpOf, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Per-IP budget — the build re-stamps ref-block fields via a live RPC call.
  const ip = clientIpOf(req);
  const rl = rateLimit(`trade-cancel:${ip}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: `too many builds — retry in ${rl.retryAfterSeconds}s` },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  let body: { account?: unknown; orderid?: unknown };
  try {
    body = (await req.json()) as { account?: unknown; orderid?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  try {
    if (typeof body.account !== "string") throw new SerializationError("account is required");
    if (typeof body.orderid !== "number" || !Number.isInteger(body.orderid)) {
      throw new SerializationError("orderid must be an integer (from the open order)");
    }

    const built = await buildSteemCancelTx({ account: body.account, orderid: body.orderid });
    const meta = built.unsigned.metadata as { refBlockNum: number; refBlockPrefix: number; expiration: number };

    return NextResponse.json(
      {
        ok: true,
        signingStatus: "awaiting-keystore (M2) — unsigned preview only",
        operation: {
          type: "limit_order_cancel",
          payload: {
            owner: built.payload.owner,
            orderid: built.payload.orderid,
          },
        },
        unsignedTx: {
          chainId: built.unsigned.chainId,
          refBlockNum: meta.refBlockNum,
          refBlockPrefix: meta.refBlockPrefix,
          txExpiration: new Date(meta.expiration * 1000).toISOString().slice(0, 19),
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
      { ok: false, error: err instanceof Error ? err.message : "cancel build failed" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
