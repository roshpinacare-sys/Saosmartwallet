import crypto from "crypto";

import { db } from "@/lib/db";
import { deriveKek, sealWith, setMaster, GateError } from "@/lib/gate/crypto";
import { createSession } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import { identifyKey } from "@/lib/gate/key-id";
import { makeKeySeal, KeySeal } from "@/lib/gate/key-seal";
import { buildRecoveryBundle } from "@/lib/gate/recovery-import";
import { writeEncryptedBackup } from "@/lib/gate/backup";
import { clientIpOf, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/gate/reset — EMERGENCY VAULT RECOVERY with proof of ownership.
 * { key, newPassphrase } →
 *   1. live-identify the key: must hold owner|active authority on
 *      @headcorner (steem or hive) RIGHT NOW — cryptographic proof the
 *      resetter controls the account today.
 *   2. mechanically re-import every surviving secret source
 *      (recovery-import.ts) — zero manual typing, honest nulls reported.
 *   3. mint a FRESH master key, seal it under the NEW passphrase AND under
 *      every current headcorner key (key-seals) — from now on the vault
 *      opens with the passphrase OR any current key.
 *   4. wipe the old (unopenable) entries, write an encrypted local backup.
 *
 * The old master (sealed under the lost passphrase) dies here — that is the
 * point: nothing in the old vault was recoverable, this rebuilds everything
 * from sources that DID survive.
 */
export async function POST(req: Request) {
  const rl = rateLimit(`gate-reset:${clientIpOf(req)}`, 3, 60_000);
  if (!rl.ok) {
    return Response.json({ ok: false, code: "rate", error: "יותר מדי ניסיונות-איפוס — נסה בעוד דקה" }, { status: 429 });
  }
  try {
    const { key, newPassphrase } = await req.json().catch(() => ({}));
    if (typeof newPassphrase !== "string" || newPassphrase.length < 8) {
      throw new GateError("weak-passphrase", "סיסמה חדשה חייבת 8+ תווים");
    }
    if (typeof key !== "string" || key.trim().length < 40) {
      throw new GateError("bad-input", "דרוש מפתח-בעלות (owner/active של headcorner)");
    }

    // ── 1. live ownership proof ────────────────────────────────────────────
    const report = await identifyKey(key.trim());
    if (!report.liveChecked) throw new GateError("chains-down", "השרשרות לא נענו — לא ניתן להוכיח בעלות כרגע");
    const proof = report.controls.find(
      (c) => c.account === "headcorner" && (c.chain === "steem" || c.chain === "hive") && (c.role === "owner" || c.role === "active"),
    );
    if (!proof) {
      throw new GateError(
        "ownership-not-proven",
        "האיפוס דורש מפתח owner/active שמחזיק authority נוכחי על headcorner — המפתח שהודבק אינו מוכיח בעלות",
      );
    }

    // ── 2. mechanical re-import from surviving sources ─────────────────────
    const bundle = buildRecoveryBundle();
    const currentKeyEntries = bundle.entries.filter(
      (e) => e.account === "headcorner" && (e.chain === "steem" || e.chain === "hive"),
    );
    if (!currentKeyEntries.some((e) => e.role === "owner" || e.role === "active")) {
      throw new GateError("no-current-keys", "מקורות-השחזור אינם מכילים את מפתחות-headcorner הנוכחיים — איסור איפוס");
    }

    // ── 3. fresh master + dual sealing (passphrase + every current key) ────
    const master = crypto.randomBytes(32);
    const masterHex = master.toString("hex");
    const salt = crypto.randomBytes(16).toString("hex");
    const passSeal = sealWith(deriveKek(newPassphrase, salt), masterHex);

    const keySeals: KeySeal[] = [];
    for (const e of currentKeyEntries) {
      keySeals.push(makeKeySeal(masterHex, e.priv, { pub: e.pub as string, chain: e.chain as string, account: e.account as string, role: e.role as string }));
    }

    // ── 4. swap the vault contents atomically ─────────────────────────────
    await db.$transaction(async (tx) => {
      await tx.vaultEntry.deleteMany();
      await tx.gateConfig.update({
        where: { id: "gate" },
        data: {
          initialized: true, kdfSalt: salt, encMaster: passSeal.ct, sealIv: passSeal.iv,
          sealTag: passSeal.tag, hint: null, keySeals: JSON.stringify(keySeals), unlockedAt: new Date(),
        },
      });
      for (const e of bundle.entries) {
        const s = sealWith(master, e.priv);
        await tx.vaultEntry.create({
          data: {
            kind: e.kind, chain: e.chain, account: e.account, role: e.role, pub: e.pub,
            encPriv: s.ct, privIv: s.iv, privTag: s.tag,
            status: e.status, source: e.source, verifiedAt: e.status === "verified" ? new Date() : null,
            verifyNote: null,
          },
        });
      }
      await tx.gateMessage.create({
        data: {
          fromKind: "system", fromName: "gate",
          body: `שחזור-חירום בוצע: מפתח-אב חדש נאטם תחת סיסמה חדשה + ${keySeals.length} חותמות-מפתח · ${bundle.entries.length} סודות ייובאו מחדש · הוכחת-בעלות: ${proof.chain}·${proof.role}`,
        },
      });
    });

    setMaster(master);
    const token = await createSession("operator", "operator", ["*"]);

    // ── 5. encrypted local backup (gitignored) ────────────────────────────
    let backup: { file: string; bytes: number; entries: number } | null = null;
    try {
      backup = await writeEncryptedBackup();
    } catch (be) {
      backup = null;
      await db.gateMessage.create({
        data: { fromKind: "system", fromName: "gate", body: "גיבוי-מקומי נכשל: " + (be as Error).message },
      }).catch(() => {});
    }

    return ok({
      reset: true,
      token,
      ownershipProof: proof,
      imported: bundle.entries.length,
      byKind: bundle.entries.reduce<Record<string, number>>((acc, e) => { acc[e.kind] = (acc[e.kind] || 0) + 1; return acc; }, {}),
      sources: bundle.sources,
      nulls: bundle.nulls,
      keySeals: keySeals.map((s) => ({ chain: s.chain, role: s.role, pub: s.pub.slice(0, 16) + "…" })),
      backup,
      at: new Date().toISOString(),
    });
  } catch (e) {
    return fail(e);
  }
}
