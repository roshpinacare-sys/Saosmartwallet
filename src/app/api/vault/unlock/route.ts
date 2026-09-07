/**
 * POST /api/vault/unlock — verify the master password, hold the derived key
 * in VOLATILE memory only (M2)
 * =========================================================================
 * On success: audits vault_unlocked and records a dead-man heartbeat
 * (liveness proof). Failures reveal only that verification failed.
 */

import { NextResponse } from "next/server";

import { BackupManager, VaultError, getVaultRuntime, getInstanceId, mapVaultError } from "@/lib/vault-runtime";
import type { UnlockRequest, UnlockResponse } from "@/lib/vault-contracts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: UnlockRequest;
  try {
    body = (await req.json()) as UnlockRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  try {
    if (typeof body?.password !== "string" || body.password.length === 0) {
      throw new VaultError("VALIDATION", "password is required");
    }

    const rt = getVaultRuntime();
    await rt.ready;
    const status = await rt.vault.unlock(body.password);

    await rt.audit.log({
      type: "vault_unlocked",
      actor: { vaultId: "master" },
      target: { vaultId: "master", detail: { autoLocksAt: status.autoLocksAt } },
      result: "success",
      vaultInstanceId: getInstanceId(),
    });

    // Liveness proof for the dead-man switch — best-effort, never masks a
    // successful unlock.
    try {
      await BackupManager.heartbeat(rt.vault);
    } catch {
      // heartbeat requires the live session; it just succeeded — ignore.
    }

    const res: UnlockResponse = { ok: true, status };
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const { status, body: errBody } = mapVaultError(err);
    return NextResponse.json(errBody, { status, headers: { "Cache-Control": "no-store" } });
  }
}
