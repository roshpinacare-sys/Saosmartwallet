/**
 * /api/vault/keys — key lifecycle (M2)
 * ====================================
 * GET    — metadata-only list (payloads stay sealed; works while locked)
 * POST   — import/derive keys behind a step-up password re-entry
 * DELETE — revoke a key (?id=&password=), step-up protected
 *
 * SECURITY: WIFs/master passwords travel in the request body only, are
 * sealed by the engine, and are NEVER logged, stored or echoed.
 */

import { NextResponse } from "next/server";

import { VaultError, VaultKeys, derivePrivateKey, getVaultRuntime, getInstanceId, mapVaultError } from "@/lib/vault-runtime";
import type { EncryptedKey, ImportKeyResponse, KeyListResponse, NetworkId, RevokeKeyResponse } from "@/lib/vault-contracts";
import type { KeyRole } from "@/lib/vault-runtime";

export const dynamic = "force-dynamic";

const NETWORK_IDS: ReadonlySet<string> = new Set(["steem", "hive", "tron", "blurt", "saos-net"]);
const STEEM_ROLES: ReadonlySet<string> = new Set(["owner", "active", "posting", "memo"]);
const STORAGE_KINDS: ReadonlySet<string> = new Set(["hot", "cold", "air-gapped"]);

/** Strips the sealed payload — metadata only leaves the vault. */
function toMetadata(record: Omit<EncryptedKey, "payload">): Omit<EncryptedKey, "payload"> {
  return {
    keyId: record.keyId,
    vaultId: record.vaultId,
    network: record.network,
    role: record.role,
    account: record.account,
    label: record.label,
    algorithm: record.algorithm,
    publicKey: record.publicKey,
    storage: record.storage,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    status: record.status,
  };
}

export async function GET() {
  try {
    const rt = getVaultRuntime();
    await rt.ready;
    const state = rt.vault.getState();
    if (state === null) {
      throw new VaultError("VAULT_NOT_INITIALIZED", "vault state not initialized — initialize() first");
    }
    const res: KeyListResponse = { ok: true, keys: VaultKeys.listKeys(state).map(toMetadata) };
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const { status, body } = mapVaultError(err);
    return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  }
}

interface ImportBody {
  mode?: unknown;
  account?: unknown;
  masterPassword?: unknown;
  wif?: unknown;
  network?: unknown;
  roles?: unknown;
  storage?: unknown;
  password?: unknown;
}

export async function POST(req: Request) {
  let body: ImportBody;
  try {
    body = (await req.json()) as ImportBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  try {
    // ---- shape validation (before the engine is touched) -----------------
    const mode = body.mode === "derive" || body.mode === "wif" ? body.mode : null;
    if (mode === null) throw new VaultError("VALIDATION", 'mode must be "derive" or "wif"');
    if (typeof body.network !== "string" || !NETWORK_IDS.has(body.network)) {
      throw new VaultError("VALIDATION", "network must be one of: steem, hive, tron, blurt, saos-net");
    }
    if (!Array.isArray(body.roles) || body.roles.length === 0 || !body.roles.every((r) => typeof r === "string" && STEEM_ROLES.has(r))) {
      throw new VaultError("VALIDATION", "roles must be a non-empty array of: owner, active, posting, memo");
    }
    if (body.storage !== undefined && (typeof body.storage !== "string" || !STORAGE_KINDS.has(body.storage))) {
      throw new VaultError("VALIDATION", "storage must be hot, cold or air-gapped");
    }
    if (typeof body.password !== "string" || body.password.length === 0) {
      throw new VaultError("VALIDATION", "password is required (step-up re-entry)");
    }
    if (mode === "derive" && (typeof body.account !== "string" || body.account.trim().length === 0)) {
      throw new VaultError("VALIDATION", "account is required for mode \"derive\"");
    }
    if (mode === "derive" && (typeof body.masterPassword !== "string" || body.masterPassword.length === 0)) {
      throw new VaultError("VALIDATION", "masterPassword is required for mode \"derive\"");
    }
    if (mode === "wif" && (typeof body.wif !== "string" || body.wif.length === 0)) {
      throw new VaultError("VALIDATION", 'wif is required for mode "wif"');
    }

    // ---- step-up + session gates ------------------------------------------
    const rt = getVaultRuntime();
    await rt.ready;
    rt.vault.ensureUnlocked(); // VAULT_LOCKED (423) without a live session
    await rt.vault.verifyStepUp(body.password); // WRONG_PASSWORD (401) fail closed

    // ---- seal one key per role --------------------------------------------
    const network = body.network as NetworkId;
    const storage = (body.storage as "hot" | "cold" | "air-gapped" | undefined) ?? "hot";
    const account = typeof body.account === "string" ? body.account.trim() : null;
    const imported: ImportKeyResponse["keys"] = [];
    for (const role of body.roles as KeyRole[]) {
      const wif = mode === "derive" ? derivePrivateKey(account as string, body.masterPassword as string, role).toWif() : (body.wif as string);
      const record = await rt.vault.addKey({
        vaultId: `network-${network}`,
        network,
        role,
        account,
        wif,
        storage,
      });
      imported.push(toMetadata(record));
      await rt.audit.log({
        type: "key_added",
        actor: { vaultId: "master" },
        target: { vaultId: record.vaultId, keyId: record.keyId, detail: { network, role, storage, mode } },
        result: "success",
        vaultInstanceId: getInstanceId(),
      });
    }

    const res: ImportKeyResponse = { ok: true, imported: imported.length, keys: imported };
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const { status, body: errBody } = mapVaultError(err);
    return NextResponse.json(errBody, { status, headers: { "Cache-Control": "no-store" } });
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const keyId = url.searchParams.get("id");
    const password = url.searchParams.get("password");
    if (keyId === null || keyId.length === 0) throw new VaultError("VALIDATION", "id query parameter is required");
    if (password === null || password.length === 0) throw new VaultError("VALIDATION", "password query parameter is required");

    const rt = getVaultRuntime();
    await rt.ready;
    await rt.vault.verifyStepUp(password); // WRONG_PASSWORD (401) fail closed
    const record = await rt.vault.revokeKey(keyId);

    await rt.audit.log({
      type: "key_removed",
      actor: { vaultId: "master" },
      target: { vaultId: record.vaultId, keyId: record.keyId, detail: { network: record.network, role: record.role } },
      result: "success",
      vaultInstanceId: getInstanceId(),
    });

    const res: RevokeKeyResponse = { ok: true };
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const { status, body } = mapVaultError(err);
    return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  }
}
