/**
 * /api/vault/backup — encrypted state packages (M2)
 * =================================================
 * POST — create a BackupPackage: seals the whole state doc under a fresh
 *        Argon2id key (requires an UNLOCKED session) with optional Shamir
 *        sharding of the wrapping key. Audited as backup_created.
 * PUT  — restore into a FRESH vault storage: package HMAC + checksum are
 *        verified fail-closed; a sharded package restores from shares alone.
 *        Audited as backup_restored; the runtime singleton reloads the
 *        restored state before reporting status.
 *
 * SECURITY: passwords/shards travel in the request body only, are consumed
 * by the engine, and are never logged or echoed.
 *
 * ROAST r4: the docstring CLAIMED "requires an UNLOCKED session" while the
 * route verified NOTHING. Two live holes: (a) POST hands the FULL vault state
 * sealed under the CALLER's password — an unauthenticated attacker picks the
 * password and gets the ciphertext of everything; (b) PUT overwrites the live
 * vault state (restore path). Both are now gated behind the sovereign
 * operator session, fail-closed, BEFORE any state work.
 */

import { NextResponse } from "next/server";

import { PrismaVaultStorage } from "@/lib/vault-stores";
import { BackupManager, VaultError, getVaultRuntime, getInstanceId, mapVaultError } from "@/lib/vault-runtime";
import type {
  BackupPackage,
  CreateBackupRequest,
  CreateBackupResponse,
  RestoreBackupRequest,
  RestoreBackupResponse,
  Share,
} from "@/lib/vault-contracts";
import { requireOperator } from "@/lib/gate/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Fail-closed operator gate — ROAST r4: full-state export checked nothing.
  const gate = await requireOperator().then(
    () => null,
    (e: Error) => NextResponse.json({ ok: false, error: e.message }, { status: 401, headers: { "Cache-Control": "no-store" } }),
  );
  if (gate) return gate;

  let body: CreateBackupRequest;
  try {
    body = (await req.json()) as CreateBackupRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  try {
    if (typeof body?.password !== "string" || body.password.length === 0) {
      throw new VaultError("VALIDATION", "password is required (seals the backup package)");
    }
    if (body.shardThreshold !== undefined && (!Number.isInteger(body.shardThreshold) || body.shardThreshold < 0)) {
      throw new VaultError("VALIDATION", "shardThreshold must be a non-negative integer (0 = no sharding)");
    }
    if (body.shardTotal !== undefined && (!Number.isInteger(body.shardTotal) || body.shardTotal < 0)) {
      throw new VaultError("VALIDATION", "shardTotal must be a non-negative integer");
    }

    const rt = getVaultRuntime();
    await rt.ready;
    const manager = new BackupManager({
      getVault: () => rt.vault,
      getInstanceId,
      getAudit: () => rt.audit,
    });
    const { backup, shards } = await manager.createBackup(body.password, {
      shardThreshold: body.shardThreshold,
      shardTotal: body.shardTotal,
    });

    const res: CreateBackupResponse = { ok: true, backup, shards };
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const { status, body: errBody } = mapVaultError(err);
    return NextResponse.json(errBody, { status, headers: { "Cache-Control": "no-store" } });
  }
}

export async function PUT(req: Request) {
  // Fail-closed operator gate — ROAST r4: state-overwriting restore checked nothing.
  const gate = await requireOperator().then(
    () => null,
    (e: Error) => NextResponse.json({ ok: false, error: e.message }, { status: 401, headers: { "Cache-Control": "no-store" } }),
  );
  if (gate) return gate;

  let body: RestoreBackupRequest;
  try {
    body = (await req.json()) as RestoreBackupRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  try {
    // ---- structural sanity (the engine re-verifies integrity deeply) ------
    const backup = body?.backup;
    if (
      backup === null ||
      typeof backup !== "object" ||
      (backup as BackupPackage).format !== "saos-vault-backup" ||
      (backup as BackupPackage).version !== 1 ||
      typeof (backup as BackupPackage).encryptedState !== "object" ||
      (backup as BackupPackage).metadata === null ||
      typeof (backup as BackupPackage).metadata !== "object" ||
      typeof (backup as BackupPackage).signature !== "string"
    ) {
      throw new VaultError("VALIDATION", "backup must be a saos-vault-backup package (format/version/encryptedState/metadata/signature)");
    }
    if (body.password !== undefined && typeof body.password !== "string") {
      throw new VaultError("VALIDATION", "password must be a string");
    }
    if (body.shards !== undefined && (!Array.isArray(body.shards) || !body.shards.every((s) => s && typeof s === "object" && typeof s.data === "string"))) {
      throw new VaultError("VALIDATION", "shards must be an array of { index, data } shares");
    }

    const rt = getVaultRuntime();
    await rt.ready;
    const doc = await BackupManager.restoreBackup(new PrismaVaultStorage(), backup, {
      password: body.password,
      shards: body.shards as Share[] | undefined,
    });

    await rt.audit.log({
      type: "backup_restored",
      actor: { vaultId: "master" },
      target: {
        vaultId: "master",
        detail: {
          restoredInstanceId: doc.vaultInstanceId,
          vaultCount: 1 + Object.keys(doc.networks).length + Object.keys(doc.soldiers).length + Object.keys(doc.purposes).length,
          keyCount: Object.values(doc.keys).filter((k) => k.status === "active").length,
        },
      },
      result: "success",
      vaultInstanceId: doc.vaultInstanceId,
    });

    // The singleton holds the pre-restore (or empty) state — reload.
    await rt.vault.load();
    const status = await rt.vault.getStatus();

    const res: RestoreBackupResponse = { ok: true, status };
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const { status, body: errBody } = mapVaultError(err);
    return NextResponse.json(errBody, { status, headers: { "Cache-Control": "no-store" } });
  }
}
