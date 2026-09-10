/**
 * POST /api/vault/soldiers — bulk soldier permission upsert (M2)
 * ==============================================================
 * Merge-by-name permission updates (and creation of new soldiers) through
 * SovereignVault.upsertSoldiers. Transfer caps stay satoshi strings.
 * Requires an unlocked session.
 */

import { NextResponse } from "next/server";

import { VaultError, getVaultRuntime, getInstanceId, mapVaultError, parseSats } from "@/lib/vault-runtime";
import type { SoldierPermissionsInput, SoldierVaultConfig, UpsertSoldiersRequest, UpsertSoldiersResponse } from "@/lib/vault-contracts";
import type { SoldierUpsertInput } from "@/lib/vault-runtime";

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

  let body: UpsertSoldiersRequest;
  try {
    body = (await req.json()) as UpsertSoldiersRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  try {
    if (!Array.isArray(body?.soldiers) || body.soldiers.length === 0) {
      throw new VaultError("VALIDATION", "soldiers must be a non-empty array");
    }
    for (const s of body.soldiers as SoldierPermissionsInput[]) {
      if (s === null || typeof s !== "object") {
        throw new VaultError("VALIDATION", "each soldier entry must be an object");
      }
      if (typeof s.soldierName !== "string" || s.soldierName.trim().length === 0) {
        throw new VaultError("VALIDATION", "soldierName is required for every soldier entry");
      }
      for (const flag of ["canTrade", "canVote", "canComment", "canTransfer"] as const) {
        if (typeof s[flag] !== "boolean") {
          throw new VaultError("VALIDATION", `soldier "${s.soldierName}": ${flag} must be a boolean`);
        }
      }
      if (typeof s.maxTransferSatoshis !== "string") {
        throw new VaultError("VALIDATION", `soldier "${s.soldierName}": maxTransferSatoshis must be a satoshi string`);
      }
      try {
        parseSats(s.maxTransferSatoshis);
      } catch {
        throw new VaultError("VALIDATION", `soldier "${s.soldierName}": maxTransferSatoshis is not a valid satoshi string`);
      }
    }

    const rt = getVaultRuntime();
    await rt.ready;
    const inputs: SoldierUpsertInput[] = (body.soldiers as SoldierPermissionsInput[]).map((s) => ({
      soldierName: s.soldierName.trim(),
      permissions: {
        canTrade: s.canTrade,
        canVote: s.canVote,
        canComment: s.canComment,
        canTransfer: s.canTransfer,
        // The frozen SoldierPermissions field is maxTransferAmount (satoshis).
        maxTransferAmount: s.maxTransferSatoshis,
      },
    }));
    const soldiers: SoldierVaultConfig[] = await rt.vault.upsertSoldiers(inputs);

    await rt.audit.log({
      type: "vault_created_soldier",
      actor: { vaultId: "master" },
      target: {
        vaultId: "master",
        detail: { upserted: soldiers.length, traders: soldiers.filter((s) => s.permissions.canTrade).length },
      },
      result: "success",
      vaultInstanceId: getInstanceId(),
    });

    const res: UpsertSoldiersResponse = { ok: true, soldiers };
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const { status, body: errBody } = mapVaultError(err);
    return NextResponse.json(errBody, { status, headers: { "Cache-Control": "no-store" } });
  }
}
