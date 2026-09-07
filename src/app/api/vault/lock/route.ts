/**
 * POST /api/vault/lock — zero-fill the session master key (M2)
 * ============================================================
 * Idempotent; audits vault_locked and returns the post-lock status.
 */

import { NextResponse } from "next/server";

import type { LockResponse } from "@/lib/vault-contracts";
import { getVaultRuntime, getInstanceId, mapVaultError } from "@/lib/vault-runtime";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const rt = getVaultRuntime();
    await rt.ready;
    rt.vault.lock();

    await rt.audit.log({
      type: "vault_locked",
      actor: { vaultId: "master" },
      target: { vaultId: "master", detail: { manual: true } },
      result: "success",
      vaultInstanceId: getInstanceId(),
    });

    const status = await rt.vault.getStatus();
    const res: LockResponse = { ok: true, status };
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const { status, body } = mapVaultError(err);
    return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  }
}
