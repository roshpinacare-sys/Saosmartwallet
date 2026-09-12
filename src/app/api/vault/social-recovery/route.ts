export const runtime = "nodejs";

/**
 * /api/vault/social-recovery — contact-sharded recovery (M2)
 * ==========================================================
 * POST — set up social recovery: persist contacts+threshold, split a fresh
 *        recovery key across the contacts (Shamir) and return the shares.
 *        CONTRACT EXTENSION (additive): the response also carries
 *        `recoveryPackage` ({ payload, threshold }) — recovery needs BOTH
 *        the t shares AND this package, and the engine never persists them
 *        server-side; without it the setup would be unrecoverable. The
 *        frozen SetupSocialRecoveryResponse field set is unchanged otherwise.
 *
 * PUT  — recover a vault: CONTRACT EXTENSION (the frozen StartRecoveryRequest
 *        only carries shares). The live request shape is
 *          { recoveryPackage: { payload, threshold }, shares, newPassword }
 *        which BackupManager.recoverFromSocial needs to rebuild the state
 *        into a FRESH storage (the restored vault keeps its ORIGINAL master
 *        password — newPassword is reserved for post-recovery re-enrollment).
 *        Audited as recovery_initiated.
 */

import { NextResponse } from "next/server";

import { PrismaVaultStorage } from "@/lib/vault-stores";
import { BackupManager, VaultError, getVaultRuntime, getInstanceId, mapVaultError } from "@/lib/vault-runtime";
import type { RecoveryContact, SetupSocialRecoveryRequest, SetupSocialRecoveryResponse, Share } from "@/lib/vault-contracts";
import type { EncryptedPayload } from "@/lib/vault-runtime";

export const dynamic = "force-dynamic";

const CONTACT_METHODS: ReadonlySet<string> = new Set(["email", "phone", "on_chain", "in_person"]);
const TRUST_LEVELS: ReadonlySet<string> = new Set(["high", "medium", "low"]);

export async function POST(req: Request) {
  let body: SetupSocialRecoveryRequest;
  try {
    body = (await req.json()) as SetupSocialRecoveryRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  try {
    const contacts: RecoveryContact[] | null = Array.isArray(body?.contacts) && body.contacts.length > 0 ? (body.contacts as RecoveryContact[]) : null;
    if (contacts === null) {
      throw new VaultError("VALIDATION", "contacts must be a non-empty array");
    }
    for (const c of contacts) {
      if (
        c === null ||
        typeof c !== "object" ||
        typeof c.id !== "string" ||
        c.id.length === 0 ||
        typeof c.name !== "string" ||
        typeof c.contactMethod !== "string" ||
        !CONTACT_METHODS.has(c.contactMethod) ||
        typeof c.contactInfo !== "string" ||
        typeof c.publicKey !== "string" ||
        typeof c.trustLevel !== "string" ||
        !TRUST_LEVELS.has(c.trustLevel) ||
        typeof c.lastVerified !== "number"
      ) {
        throw new VaultError("VALIDATION", "each contact needs id, name, contactMethod, contactInfo, publicKey, trustLevel and lastVerified");
      }
    }
    if (!Number.isInteger(body.threshold) || body.threshold < 1 || body.threshold > contacts.length) {
      throw new VaultError("VALIDATION", `threshold must be an integer in [1, contacts.length=${contacts.length}]`);
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
    const setup = await manager.setupSocialRecovery(contacts, body.threshold, body.password);

    // CONTRACT EXTENSION (additive — see header): recoveryPackage included so
    // the owner can store it with their private backup.
    const res: SetupSocialRecoveryResponse & { recoveryPackage: { payload: EncryptedPayload; threshold: number } } = {
      ok: true,
      shares: setup.shares,
      recoveryPackage: setup.recoveryPackage,
    };
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const { status, body: errBody } = mapVaultError(err);
    return NextResponse.json(errBody, { status, headers: { "Cache-Control": "no-store" } });
  }
}

/**
 * CONTRACT EXTENSION (documented, additive): the frozen StartRecoveryRequest
 * type only carries `shares`; the live PUT accepts the full recovery
 * material below. See the module header for the rationale.
 */
interface StartRecoveryFullRequest {
  recoveryPackage: { payload: EncryptedPayload; threshold: number };
  shares: Array<{ contactId: string; share: Share }>;
  newPassword: string;
}

export async function PUT(req: Request) {
  let body: StartRecoveryFullRequest;
  try {
    body = (await req.json()) as StartRecoveryFullRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  try {
    const pkg = body?.recoveryPackage;
    if (pkg === null || typeof pkg !== "object" || pkg.payload === null || typeof pkg.payload !== "object" || typeof pkg.payload.ciphertext !== "string") {
      throw new VaultError("VALIDATION", "recoveryPackage.payload must be the encrypted payload returned at setup");
    }
    if (!Number.isInteger(pkg.threshold) || pkg.threshold < 1) {
      throw new VaultError("VALIDATION", "recoveryPackage.threshold must be a positive integer");
    }
    if (!Array.isArray(body.shares) || body.shares.length === 0 || !body.shares.every((s) => s && typeof s === "object" && s.share && typeof s.share.data === "string")) {
      throw new VaultError("VALIDATION", "shares must be an array of { contactId, share: { index, data } }");
    }
    if (typeof body.newPassword !== "string" || body.newPassword.length === 0) {
      throw new VaultError("VALIDATION", "newPassword is required (reserved for post-recovery re-enrollment)");
    }

    const rt = getVaultRuntime();
    await rt.ready;
    const doc = await BackupManager.recoverFromSocial(
      pkg,
      body.shares.map((s) => s.share),
      body.newPassword,
      new PrismaVaultStorage(), // NOTE: engine signature is (package, shares, newPassword, storage)
    );

    await rt.audit.log({
      type: "recovery_initiated",
      actor: { vaultId: "master" },
      target: {
        vaultId: "master",
        detail: { completed: true, restoredInstanceId: doc.vaultInstanceId, shares: body.shares.length },
      },
      result: "success",
      vaultInstanceId: doc.vaultInstanceId,
    });

    // The singleton may hold stale state — reload the recovered document.
    await rt.vault.load();
    const status = await rt.vault.getStatus();
    return NextResponse.json({ ok: true, status }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const { status, body: errBody } = mapVaultError(err);
    return NextResponse.json(errBody, { status, headers: { "Cache-Control": "no-store" } });
  }
}
