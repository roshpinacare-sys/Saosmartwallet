/**
 * POST /api/vault/networks — create/overwrite a network vault config (M2)
 * =======================================================================
 * Upsert semantics: update the existing network vault when present, create
 * it otherwise. Amounts stay satoshi strings; requires an unlocked session
 * (security-relevant configuration).
 */

import { NextResponse } from "next/server";

import { VaultError, getVaultRuntime, getInstanceId, mapVaultError, parseSats } from "@/lib/vault-runtime";
import type { NetworkId, NetworkVaultConfig, UpsertNetworkRequest, UpsertNetworkResponse } from "@/lib/vault-contracts";
import type { OperationType, StorageKind } from "@/lib/vault-runtime";

export const dynamic = "force-dynamic";

const NETWORK_IDS: ReadonlySet<string> = new Set(["steem", "hive", "tron", "blurt", "saos-net", "ethereum", "solana"]);
const STORAGE_KINDS: ReadonlySet<string> = new Set(["hot", "cold", "air-gapped"]);

export async function POST(req: Request) {
  let body: UpsertNetworkRequest;
  try {
    body = (await req.json()) as UpsertNetworkRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  try {
    if (typeof body?.network !== "string" || !NETWORK_IDS.has(body.network)) {
      throw new VaultError("VALIDATION", "network must be one of: steem, hive, tron, blurt, saos-net");
    }
    if (
      body.allowedOperations !== undefined &&
      (!Array.isArray(body.allowedOperations) || !body.allowedOperations.every((op) => typeof op === "string" && op.length > 0))
    ) {
      throw new VaultError("VALIDATION", "allowedOperations must be an array of operation names");
    }
    if (body.maxAmountPerDay !== undefined) {
      if (body.maxAmountPerDay === null || typeof body.maxAmountPerDay !== "object") {
        throw new VaultError("VALIDATION", "maxAmountPerDay must be an object of symbol → satoshi string");
      }
      for (const [symbol, amount] of Object.entries(body.maxAmountPerDay)) {
        if (typeof amount !== "string") {
          throw new VaultError("VALIDATION", `maxAmountPerDay[${symbol}] must be a satoshi string`);
        }
        try {
          parseSats(amount);
        } catch {
          throw new VaultError("VALIDATION", `maxAmountPerDay[${symbol}] is not a valid satoshi string`);
        }
      }
    }
    if (body.storage !== undefined && (typeof body.storage !== "string" || !STORAGE_KINDS.has(body.storage))) {
      throw new VaultError("VALIDATION", "storage must be hot, cold or air-gapped");
    }
    if (body.status !== undefined && body.status !== "active" && body.status !== "offline") {
      throw new VaultError("VALIDATION", 'status must be "active" or "offline"');
    }

    const rt = getVaultRuntime();
    await rt.ready;
    const input = {
      network: body.network as NetworkId,
      ...(body.roles !== undefined ? { roles: body.roles } : {}),
      ...(body.allowedOperations !== undefined ? { allowedOperations: body.allowedOperations as OperationType[] } : {}),
      ...(body.maxAmountPerDay !== undefined ? { maxAmountPerDay: body.maxAmountPerDay } : {}),
      ...(body.storage !== undefined ? { storage: body.storage as StorageKind } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    };

    // Upsert: the engine refuses to blur create/update semantics, so pick
    // the branch from the live state.
    const state = rt.vault.getState();
    const exists = state !== null && Object.values(state.networks).some((n) => n.network === body.network);
    const network: NetworkVaultConfig = exists ? await rt.vault.updateNetworkVault(input) : await rt.vault.createNetworkVault(input);

    await rt.audit.log({
      type: "vault_created_network",
      actor: { vaultId: "master" },
      target: { vaultId: network.id, detail: { upserted: exists, network: network.network, status: network.status } },
      result: "success",
      vaultInstanceId: getInstanceId(),
    });

    const res: UpsertNetworkResponse = { ok: true, network };
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const { status, body: errBody } = mapVaultError(err);
    return NextResponse.json(errBody, { status, headers: { "Cache-Control": "no-store" } });
  }
}
