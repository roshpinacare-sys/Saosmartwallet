/**
 * POST /api/vault/sign — THE money path (M2)
 * ==========================================
 * a. validate the order request shape;
 * b. deterministically rebuild the limit_order_create transaction
 *    (orderid/orderExpiration reused EXACTLY from the build preview);
 * c. frame the PolicyOperation (at-risk leg: SBD on buy, STEEM on sell);
 * d. orchestrator.sign — step-up password → policy gate → key reveal →
 *    adapter signature → optional broadcast (the ONLY broadcast path in the
 *    process, gated by policy + the broadcast-enabled adapter capability);
 * e. respond with the signature + digest + broadcast result. The full
 *    signing lifecycle is audited by the orchestrator itself.
 *
 * SECURITY: the step-up password travels in the body only and is consumed
 * by the vault verifier; the WIF never leaves the engine; failures carry
 * policy decisions, never key material.
 */

import { NextResponse } from "next/server";

import { SerializationError } from "@/lib/steem-engine";
import { buildSteemOrderTx } from "@/lib/steem-order";
import { VaultError, buildSteemLimitOrderOp, getVaultRuntime, mapVaultError } from "@/lib/vault-runtime";
import type { SignOrderRequest, SignOrderResponse } from "@/lib/vault-contracts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: SignOrderRequest;
  try {
    body = (await req.json()) as SignOrderRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  try {
    // ---- a. shape validation ----------------------------------------------
    if (typeof body?.account !== "string" || body.account.trim().length === 0) {
      throw new VaultError("VALIDATION", "account is required");
    }
    if (body.network !== "steem") {
      throw new VaultError("VALIDATION", "only the steem internal market is wired for order signing");
    }
    if (body.side !== "buy" && body.side !== "sell") {
      throw new VaultError("VALIDATION", 'side must be "buy" or "sell"');
    }
    if (typeof body.amount !== "string" || typeof body.price !== "string") {
      throw new VaultError("VALIDATION", "amount and price are required strings");
    }
    if (body.orderid !== undefined && !Number.isInteger(body.orderid)) {
      throw new VaultError("VALIDATION", "orderid must be an integer");
    }
    if (body.orderExpiration !== undefined && !Number.isInteger(body.orderExpiration)) {
      throw new VaultError("VALIDATION", "orderExpiration must be an integer (unix seconds)");
    }
    if (body.password !== undefined && typeof body.password !== "string") {
      throw new VaultError("VALIDATION", "password must be a string");
    }

    const rt = getVaultRuntime();
    await rt.ready;

    // ---- b. deterministic rebuild ------------------------------------------
    let built;
    try {
      built = await buildSteemOrderTx({
        account: body.account,
        side: body.side,
        amount: body.amount,
        price: body.price,
        fillOrKill: body.fillOrKill === true,
        ttlSeconds: typeof body.ttlSeconds === "number" ? body.ttlSeconds : 3600,
        // Deterministic-rebuild inputs from the build preview (contract sends
        // both; both are optional in the builder — provided values win).
        ...(body.orderid !== undefined ? { orderid: body.orderid } : {}),
        ...(body.orderExpiration !== undefined ? { orderExpiration: body.orderExpiration } : {}),
      });
    } catch (e) {
      // Malformed order input is a client error, not a server failure.
      if (e instanceof SerializationError) throw new VaultError("VALIDATION", e.message);
      throw e;
    }

    // ---- c. policy operation ------------------------------------------------
    const op = buildSteemLimitOrderOp(built, { side: body.side });

    // ---- d. sign under full policy + audit ----------------------------------
    // The orchestrator derives stepUpSatisfied from the provided password
    // itself (verify → evaluate); a wrong password fails closed (401).
    const outcome = await rt.orchestrator.sign(op, built.unsigned, {
      broadcast: body.broadcast === true,
      ...(body.password !== undefined && body.password.length > 0 ? { stepUpPassword: body.password } : {}),
    });

    // ---- e. response (no raw adapter payloads, no key material) -------------
    const res: SignOrderResponse = {
      ok: true,
      decision: outcome.decision,
      digestHex: built.digestHex,
      serializedHex: built.serializedHex,
      signatureHex: outcome.signature.signatureHex,
      publicKey: outcome.signature.publicKey,
      txId: outcome.broadcast !== null ? outcome.broadcast.txId : built.txId,
      byteLength: built.byteLength,
      broadcast:
        outcome.broadcast !== null
          ? {
              txId: outcome.broadcast.txId,
              ...(outcome.broadcast.blockNum !== undefined ? { blockNum: outcome.broadcast.blockNum } : {}),
            }
          : null,
    };
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const { status, body: errBody } = mapVaultError(err);
    return NextResponse.json(errBody, { status, headers: { "Cache-Control": "no-store" } });
  }
}
