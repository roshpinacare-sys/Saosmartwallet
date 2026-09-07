/**
 * PUT /api/vault/deadman — dead-man switch configuration (M2)
 * ===========================================================
 * Step-up protected (setupDeadManSwitch re-verifies the password against
 * the vault verifier — the same gate as addKey). lastHeartbeat is stamped
 * NOW on setup, so enabling starts a fresh silence window. The response
 * includes the pure overdue predicate for the UI's warning banner.
 */

import { NextResponse } from "next/server";

import { BackupManager, VaultError, getVaultRuntime, getInstanceId, mapVaultError } from "@/lib/vault-runtime";
import type { DeadManRequest, DeadManResponse } from "@/lib/vault-contracts";

export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  let body: DeadManRequest;
  try {
    body = (await req.json()) as DeadManRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  try {
    if (typeof body?.enabled !== "boolean") {
      throw new VaultError("VALIDATION", "enabled must be a boolean");
    }
    if (!Number.isInteger(body.inactiveDays) || body.inactiveDays < 1) {
      throw new VaultError("VALIDATION", "inactiveDays must be an integer ≥ 1");
    }
    if (!Array.isArray(body.beneficiaries) || !body.beneficiaries.every((b) => b && typeof b === "object" && typeof b.name === "string" && typeof b.account === "string" && typeof b.sharePercent === "number")) {
      throw new VaultError("VALIDATION", "beneficiaries must be an array of { name, account, sharePercent }");
    }
    if (typeof body.password !== "string" || body.password.length === 0) {
      throw new VaultError("VALIDATION", "password is required (step-up re-entry)");
    }

    const rt = getVaultRuntime();
    await rt.ready;
    const manager = new BackupManager({
      getVault: () => rt.vault,
      getInstanceId,
      getAudit: () => rt.audit,
    });
    // setupDeadManSwitch performs the step-up verification internally
    // (unlocked session + WRONG_PASSWORD fail-closed) — one Argon2id run.
    const deadManSwitch = await manager.setupDeadManSwitch(
      {
        enabled: body.enabled,
        inactiveDays: body.inactiveDays,
        beneficiaries: body.beneficiaries.map((b) => ({ name: b.name, account: b.account, sharePercent: b.sharePercent })),
      },
      body.password,
    );

    const res: DeadManResponse = {
      ok: true,
      deadManSwitch,
      overdue: BackupManager.deadManOverdue(deadManSwitch),
    };
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const { status, body: errBody } = mapVaultError(err);
    return NextResponse.json(errBody, { status, headers: { "Cache-Control": "no-store" } });
  }
}
