export const runtime = "nodejs";

/**
 * POST /api/vault/sign-cancel — DEX order cancel (M3+, money path)
 * ================================================================
 * Mirrors POST /api/vault/sign for limit_order_cancel:
 * a. validate the cancel request shape;
 * b. deterministically rebuild the limit_order_cancel transaction (orderid
 *    reused EXACTLY from the build preview — the cancel must name the very
 *    order the user saw);
 * c. frame the PolicyOperation (a cancel puts nothing at risk — amountSatoshis
 *    "0" — but is still allowlist-gated: steem network default ops include
 *    limit_order_cancel);
 * d. orchestrator.sign — step-up password → policy gate → key reveal →
 *    adapter signature → optional broadcast (the ONLY broadcast path in the
 *    process, gated by policy + the broadcast-enabled adapter capability);
 * e. respond with signature + digest + broadcast result; fully audited.
 *
 * SECURITY: the step-up password travels in the body only; the WIF never
 * leaves the engine; failures carry policy decisions, never key material.
 */

import { NextResponse } from "next/server";

import { SerializationError } from "@/lib/steem-engine";
import { buildSteemCancelTx } from "@/lib/steem-order";
import { VaultError, buildSteemCancelOp, getVaultRuntime, mapVaultError } from "@/lib/vault-runtime";
import type { SignCancelRequest, SignCancelResponse } from "@/lib/vault-contracts";

import { requireOperator } from "@/lib/gate/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Fail-closed operator gate — ROAST r5: "unlocked vault" is NOT an identity.
  // While the operator works the vault is open; an anonymous caller must never
  // be able to sign, broadcast, or mutate policy through it.
  const gate = await requireOperator().then(
    () => null,
    (e: Error) => NextResponse.json({ ok: false, error: e.message }, { status: 401, headers: { "Cache-Control": "no-store" } }),
  );
  if (gate) return gate;

  let body: SignCancelRequest;
  try {
    body = (await req.json()) as SignCancelRequest;
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
    if (typeof body.orderid !== "number" || !Number.isInteger(body.orderid)) {
      throw new VaultError("VALIDATION", "orderid must be an integer (from the open order)");
    }
    if (body.password !== undefined && typeof body.password !== "string") {
      throw new VaultError("VALIDATION", "password must be a string");
    }

    const rt = getVaultRuntime();
    await rt.ready;

    // ---- b. deterministic rebuild ------------------------------------------
    let built;
    try {
      built = await buildSteemCancelTx({
        account: body.account,
        orderid: body.orderid,
      });
    } catch (e) {
      // Malformed cancel input is a client error, not a server failure.
      if (e instanceof SerializationError) throw new VaultError("VALIDATION", e.message);
      throw e;
    }

    // ---- c. policy operation ------------------------------------------------
    const op = buildSteemCancelOp(built.payload);

    // ---- d. sign under full policy + audit ----------------------------------
    const outcome = await rt.orchestrator.sign(op, built.unsigned, {
      broadcast: body.broadcast === true,
      ...(body.password !== undefined && body.password.length > 0 ? { stepUpPassword: body.password } : {}),
    });

    // ---- e. response (no raw adapter payloads, no key material) -------------
    const res: SignCancelResponse = {
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
