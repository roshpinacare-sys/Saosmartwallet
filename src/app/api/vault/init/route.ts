export const runtime = "nodejs";

/**
 * POST /api/vault/init — first-boot ceremony (M2)
 * ===============================================
 * Installs the Argon2id password verifier and provisions the full M2
 * ecosystem (master 3-of-5, five network vaults, soldier fleet, purpose
 * vaults), then anchors the audit chain with a vault_created event.
 * The password is consumed by the engine and never stored, logged or echoed.
 */

import { NextResponse } from "next/server";

import { VaultError, getVaultRuntime, getInstanceId, mapVaultError } from "@/lib/vault-runtime";
import { clientIpOf, rateLimit } from "@/lib/rate-limit";
import type { InitRequest, InitResponse } from "@/lib/vault-contracts";

export const dynamic = "force-dynamic";

interface InitBody {
  password?: unknown;
  steemDailyLimitSatoshis?: unknown;
  soldierCount?: unknown;
  traderSoldiers?: unknown;
}

export async function POST(req: Request) {
  // One-shot ceremony — 5/min/IP is generous for the owner, hostile to abuse.
  const rl = rateLimit(`vault-init:${clientIpOf(req)}`, 5, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "too many init attempts — retry later" },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  let body: InitBody;
  try {
    body = (await req.json()) as InitBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  try {
    if (typeof body.password !== "string" || body.password.length === 0) {
      throw new VaultError("VALIDATION", "password is required");
    }
    if (
      body.steemDailyLimitSatoshis !== undefined &&
      (typeof body.steemDailyLimitSatoshis !== "string" || !/^\d+$/.test(body.steemDailyLimitSatoshis))
    ) {
      throw new VaultError("VALIDATION", "steemDailyLimitSatoshis must be a satoshi string");
    }
    const soldierCount = body.soldierCount;
    if (soldierCount !== undefined && (typeof soldierCount !== "number" || !Number.isInteger(soldierCount) || soldierCount < 1)) {
      throw new VaultError("VALIDATION", "soldierCount must be a positive integer");
    }
    const traderSoldiers = body.traderSoldiers;
    if (traderSoldiers !== undefined && (typeof traderSoldiers !== "number" || !Number.isInteger(traderSoldiers) || traderSoldiers < 0)) {
      throw new VaultError("VALIDATION", "traderSoldiers must be a non-negative integer");
    }

    const rt = getVaultRuntime();
    await rt.ready;
    const initRequest: InitRequest = {
      password: body.password,
      ...(body.steemDailyLimitSatoshis !== undefined ? { steemDailyLimitSatoshis: body.steemDailyLimitSatoshis } : {}),
      ...(soldierCount !== undefined ? { soldierCount } : {}),
      ...(traderSoldiers !== undefined ? { traderSoldiers } : {}),
    };
    const status = await rt.vault.initialize(initRequest.password, {
      steemDailyLimitSatoshis: initRequest.steemDailyLimitSatoshis,
      soldierCount: initRequest.soldierCount,
      traderSoldiers: initRequest.traderSoldiers,
    });

    await rt.audit.log({
      type: "vault_created",
      actor: { vaultId: "master" },
      target: { vaultId: "master", detail: { networks: status.counts.networks, soldiers: status.counts.soldiers } },
      result: "success",
      vaultInstanceId: getInstanceId(),
    });

    // No recovery-phrase feature exists in the vault flow — the honest null.
    const res: InitResponse = { ok: true, status, recoveryPhraseShare: null };
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const { status, body: errBody } = mapVaultError(err);
    return NextResponse.json(errBody, { status, headers: { "Cache-Control": "no-store" } });
  }
}
