export const runtime = "nodejs";

/**
 * POST /api/vault/simulate — policy/balance/risk dry-run, nothing signed (M2)
 * ===========================================================================
 * Rebuilds the limit_order_create server-side (identical to the sign path),
 * then hands it to the policy-gated orchestrator's honest simulation:
 * policy decision, balance legs against the live chain, RC percent — zero
 * invented numbers, zero signatures, zero audit side effects beyond the
 * policy engine's own violation records.
 */

import { NextResponse } from "next/server";

import { SerializationError } from "@/lib/steem-engine";
import { buildSteemOrderTx } from "@/lib/steem-order";
import { VaultError, buildSteemLimitOrderOp, getVaultRuntime, mapVaultError } from "@/lib/vault-runtime";
import type { SimulateOrderRequest, SimulateResponse } from "@/lib/vault-contracts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: SimulateOrderRequest;
  try {
    body = (await req.json()) as SimulateOrderRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  try {
    if (typeof body?.account !== "string" || body.account.trim().length === 0) {
      throw new VaultError("VALIDATION", "account is required");
    }
    if (body.network !== "steem") {
      throw new VaultError("VALIDATION", "only the steem internal market is wired for order simulation");
    }
    if (body.side !== "buy" && body.side !== "sell") {
      throw new VaultError("VALIDATION", 'side must be "buy" or "sell"');
    }
    if (typeof body.amount !== "string" || typeof body.price !== "string") {
      throw new VaultError("VALIDATION", "amount and price are required strings");
    }

    const rt = getVaultRuntime();
    await rt.ready;

    let built;
    try {
      built = await buildSteemOrderTx({
        account: body.account,
        side: body.side,
        amount: body.amount,
        price: body.price,
        fillOrKill: body.fillOrKill === true,
        ttlSeconds: typeof body.ttlSeconds === "number" ? body.ttlSeconds : 3600,
      });
    } catch (e) {
      // Malformed order input is a client error, not a server failure.
      if (e instanceof SerializationError) throw new VaultError("VALIDATION", e.message);
      throw e;
    }

    const op = buildSteemLimitOrderOp(built, { side: body.side });
    // The orchestrator resolves balances for the operation's debit leg via
    // the registered steem adapter — account matches the payload owner.
    const simulation = await rt.orchestrator.simulate(op, built.payload.owner);

    const res: SimulateResponse = { ok: true, simulation };
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const { status, body: errBody } = mapVaultError(err);
    return NextResponse.json(errBody, { status, headers: { "Cache-Control": "no-store" } });
  }
}
