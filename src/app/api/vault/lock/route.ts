/**
 * POST /api/vault/lock — zero-fill the session master key (M2)
 * ============================================================
 * Idempotent; audits vault_locked and returns the post-lock status.
 *
 * ROAST r4: locking the vault is a SECURITY-RELEVANT mutation — an
 * unauthenticated caller could DoS the operator out of their own vault.
 * Now gated behind the sovereign operator session, fail-closed.
 */

import { NextResponse } from "next/server";

import type { LockResponse } from "@/lib/vault-contracts";
import { getVaultRuntime, getInstanceId, mapVaultError } from "@/lib/vault-runtime";
import { requireOperator } from "@/lib/gate/session";

export const dynamic = "force-dynamic";

export async function POST() {
  // Fail-closed operator gate — ROAST r4: this route checked nothing at all.
  const gate = await requireOperator().then(
    () => null,
    (e: Error) => NextResponse.json({ ok: false, error: e.message }, { status: 401, headers: { "Cache-Control": "no-store" } }),
  );
  if (gate) return gate;

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
