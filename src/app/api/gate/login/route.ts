import crypto from "crypto";

import { db } from "@/lib/db";
import { setMaster, sealWith, GateError } from "@/lib/gate/crypto";
import { createSession, revokeOtherSessions } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import { identifyKey, KeyControl } from "@/lib/gate/key-id";
import { loadKeySeals, openMasterWithKey, makeKeySeal, KeySeal } from "@/lib/gate/key-seal";
import { buildRecoveryBundle } from "@/lib/gate/recovery-import";
import { writeEncryptedBackup } from "@/lib/gate/backup";
import { clientIpOf, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/gate/login — THE one simple login. { key }
 * Paste any CURRENT headcorner key (steem/hive — owner/active/posting/memo):
 *   1. live chain proof of control (no stored assumptions).
 *   2. vault opens via its key-seal — no passphrase, ever.
 *   3. if the vault is not bound to this key yet AND the key is owner/active,
 *      the vault REBUILDS ITSELF mechanically from surviving sources
 *      (auto-bootstrap) and seals the fresh master under every current key.
 *   4. a 30-day session is minted with the master sealed inside it —
 *      "פשוט להתחבר ולעבוד", keys remain viewable after server restarts.
 */
export async function POST(req: Request) {
  const rl = rateLimit(`gate-login:${clientIpOf(req)}`, 10, 60_000);
  if (!rl.ok) {
    return Response.json({ ok: false, code: "rate", error: "יותר מדי ניסיונות — נסה בעוד דקה" }, { status: 429 });
  }
  try {
    const { key } = await req.json().catch(() => ({}));
    if (typeof key !== "string" || key.trim().length < 40) {
      throw new GateError("bad-input", "דרוש מפתח — הדבק מפתח פרטי של headcorner");
    }
    const keyStr = key.trim();

    // ── 1. live ownership proof ───────────────────────────────────────────
    let report;
    try {
      report = await identifyKey(keyStr);
    } catch {
      throw new GateError("bad-key", "המפתח פגום — בדוק שהעתקת את כל המפתח כמו שהוא, בלי רווחים או תווים חסרים");
    }
    if (!report.liveChecked) {
      throw new GateError(
        report.kind === "unknown" ? "bad-key" : "chains-down",
        report.kind === "unknown"
          ? "הקלט לא נראה כמפתח מוכר — הדבק מפתח-פרטי של STEEM/HIVE (מתחיל ב-5/K/L)"
          : "השרשרות לא נענו כרגע — נסה שוב בעוד רגע",
      );
    }
    const hc = report.controls.find(
      (c: KeyControl) => c.account === "headcorner" && (c.chain === "steem" || c.chain === "hive"),
    );
    if (!hc) {
      throw new GateError(
        "not-headcorner-key",
        "המפתח אינו מחזיק authority נוכחי על headcorner (STEEM/HIVE) — כניסה אפשרית רק עם מפתח כזה",
      );
    }

    // ── 2. try the normal path: open via key-seal ─────────────────────────
    const seals = await loadKeySeals();
    const seal = seals.find((s) => s.pub === hc.pub);
    let master: Buffer | null = null;
    let bootstrapped = false;
    let bootInfo: Record<string, unknown> | null = null;

    if (seal) {
      try {
        master = Buffer.from(openMasterWithKey(keyStr, seal), "hex");
      } catch {
        throw new GateError("wrong-key", "המפתח אומת בשרשרת אך חותם-הפתיחה דחה אותו — GCM סירב");
      }
    } else if (hc.role === "owner" || hc.role === "active") {
      // ── 3. auto-bootstrap: vault not bound to current keys yet ──────────
      const boot = await bootstrapVault(hc);
      master = boot.master;
      bootstrapped = true;
      bootInfo = boot.info;
    } else {
      throw new GateError(
        "need-owner-key",
        "הכספת עוד לא מקושרת למפתחות הנוכחיים — היכנס פעם אחת עם מפתח owner/active של headcorner והיא תוקם אוטומטית",
      );
    }

    if (!master || master.length !== 32) throw new GateError("internal", "מפתח-אב לא תקין");

    // ── 4. in-memory + fresh 30d session carrying the sealed master ───────
    setMaster(master);
    await revokeOtherSessions();
    await createSession("operator", "operator", ["*"], master);
    await db.gateConfig.update({ where: { id: "gate" }, data: { unlockedAt: new Date() } }).catch(() => {});
    await db.gateMessage.create({
      data: {
        fromKind: "system", fromName: "gate",
        body: bootstrapped
          ? `כניסה + הקמה-עצמית: הכספת נאטמה תחת ${bootInfo?.keySeals as number} מפתחות-headcorner נוכחיים · הוכחה: ${hc.chain}·${hc.role}`
          : `כניסה במפתח-חי (${hc.chain} · ${hc.role}) — בלי סיסמה`,
      },
    });

    return ok({
      in: true,
      identity: hc,
      bootstrapped,
      bootInfo,
      at: new Date().toISOString(),
    });
  } catch (e) {
    return fail(e);
  }
}

/** Rebuild the vault from surviving sources and seal the fresh master under EVERY current headcorner key. */
async function bootstrapVault(proof: KeyControl): Promise<{ master: Buffer; info: Record<string, unknown> }> {
  const bundle = buildRecoveryBundle();
  const currentKeyEntries = bundle.entries.filter(
    (e) => e.account === "headcorner" && (e.chain === "steem" || e.chain === "hive"),
  );
  if (!currentKeyEntries.some((e) => e.role === "owner" || e.role === "active")) {
    throw new GateError("no-current-keys", "מקורות-השחזור אינם מכילים את מפתחות-headcorner הנוכחיים — הקמה נדחתה");
  }

  const master = crypto.randomBytes(32);
  const masterHex = master.toString("hex");
  const keySeals: KeySeal[] = currentKeyEntries.map((e) =>
    makeKeySeal(masterHex, e.priv, {
      pub: e.pub as string, chain: e.chain as string, account: e.account as string, role: e.role as string,
    }),
  );

  await db.$transaction(async (tx) => {
    await tx.vaultEntry.deleteMany();
    await tx.gateConfig.upsert({
      where: { id: "gate" },
      create: {
        id: "gate", initialized: true, kdfSalt: null, encMaster: null, sealIv: null, sealTag: null,
        hint: null, keySeals: JSON.stringify(keySeals), unlockedAt: new Date(),
      },
      update: {
        initialized: true, kdfSalt: null, encMaster: null, sealIv: null, sealTag: null,
        hint: null, keySeals: JSON.stringify(keySeals), unlockedAt: new Date(),
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
        body: `הקמה-עצמית בכניסה: מפתח-אב חדש נאטם תחת ${keySeals.length} מפתחות נוכחיים · ${bundle.entries.length} סודות ייובאו · בלי סיסמה בכלל`,
      },
    });
  });

  let backup: unknown = null;
  try {
    backup = await writeEncryptedBackup();
  } catch {
    backup = null;
  }

  return {
    master,
    info: {
      imported: bundle.entries.length,
      byKind: bundle.entries.reduce<Record<string, number>>((acc, e) => { acc[e.kind] = (acc[e.kind] || 0) + 1; return acc; }, {}),
      sources: bundle.sources,
      nulls: bundle.nulls,
      keySeals: keySeals.length,
      backup,
    },
  };
}
