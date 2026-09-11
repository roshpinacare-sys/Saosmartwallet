import crypto from "crypto";

import { db } from "@/lib/db";
import { setMaster, sealWith, GateError } from "@/lib/gate/crypto";
import { createSession, revokeOtherSessions } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import { identifyKey, KeyControl, pubRaw33, fetchChainAuthorityMap } from "@/lib/gate/key-id";
import { loadKeySeals, openMasterWithKey, makeKeySeal, KeySeal } from "@/lib/gate/key-seal";
import { buildRecoveryBundle } from "@/lib/gate/recovery-import";
import { refreshKeySeals } from "@/lib/gate/seal-refresh";
import { writeEncryptedBackup } from "@/lib/gate/backup";
import { clientIpOf, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/gate/login — THE one simple login. { key }
 * Paste any CURRENT headcorner key (steem/hive — owner/active/posting/memo):
 *   1. live chain proof of control (no stored assumptions).
 *   2. vault opens via its key-seal — no passphrase, ever.
 *   3. r32 — after ANY successful open, the master is mechanically RE-SEALED
 *      under every current headcorner key that lacked a seal (seal-refresh):
 *      a rotation on-chain can never again strand the operator's newer keys.
 *   4. if the vault is not bound to ANY live key yet AND the key is owner/active,
 *      the vault REBUILDS ITSELF mechanically from surviving sources
 *      (auto-bootstrap) and seals the fresh master under every current key
 *      PLUS the pasted key. A vault that still HAS live seals is NEVER wiped —
 *      the operator is pointed at a bound key instead (r32 wipe-guard).
 *   5. a 30-day session is minted with the master sealed inside it —
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
    // r32 — partial-sweep guard: if NEITHER steem NOR hive answered (blurt alone
    // proves nothing about headcorner), the key must not be convicted — the
    // honest answer is "chains down", never "not a headcorner key".
    if (report.kind === "steem-wif" && report.rails && !report.rails.steem && !report.rails.hive) {
      throw new GateError("chains-down", "צמתי steem+hive לא נענו כרגע — אין אפשרות לאמת authority על headcorner; נסה שוב בעוד רגע");
    }
    const hc = report.controls.find(
      (c: KeyControl) => c.account === "headcorner" && (c.chain === "steem" || c.chain === "hive"),
    );

    const seals = await loadKeySeals();

    if (!hc) {
      // r28 — the WHY, with on-chain evidence: when the key is rejected, the
      // rejection itself carries the live owner-authority update timestamps,
      // so "my key stopped working" gets its honest answer in the same breath:
      // the chain rotated the keys, HERE is exactly when.
      const evidence = await rotationEvidence();
      // ── r32 — rotated-out recognition: this may BE an old headcorner key that
      // the chain itself rotated away (e.g. the r16/r17 D1 rotation of steem).
      // An honest system says "this key WAS ours, it was replaced — here is the
      // way in", never a dead end.
      const pastedRaw = report.kind === "steem-wif" ? pubRaw33(report.pubs[0] || "") : null;
      if (pastedRaw) {
        const sealHit = seals.find((s) => pubRaw33(s.pub) === pastedRaw);
        const storedRows = await db.vaultEntry.findMany({ where: { kind: "steem-key", account: "headcorner" } }).catch(() => []);
        const storedHit = storedRows.find((e) => typeof e.pub === "string" && pubRaw33(e.pub) === pastedRaw);
        if (sealHit || storedHit) {
          const where = sealHit ? `${sealHit.chain}·${sealHit.role}` : `${storedHit!.chain}·${storedHit!.role} (${storedHit!.status})`;
          throw new GateError(
            "rotated-out-key",
            `המפתח הזה אכן היה מפתח-headcorner (${where}) — אך הוצא מה-authority ברוטציה על-השרשרת והוחלף בשורשי-D1.${evidence} ` +
            "היכנס עם מפתח נוכחי של headcorner: מפתח-HIVE מבלוק-HIVE בהדקור.txt (owner/active/posting/memo) " +
            "או מפתח-steem נוכחי — הכספת נאטמת תחת כל מפתח-נוכחי והיא תחתום את עצמה מחדש בכניסה הראשונה.",
          );
        }
      }
      throw new GateError(
        "not-headcorner-key",
        "המפתח אינו מחזיק authority נוכחי על headcorner (STEEM/HIVE) — כניסה אפשרית רק עם מפתח כזה." + evidence +
        " אם זה מפתח-ישן: הרשתות החליפו את מפתחות-headcorner ברוטציה על-השרשרת — הכניסה מתקבלת ממפתח-נוכחי בלבד.",
      );
    }

    // ── 2. try the normal path: open via key-seal (r32: raw-33-byte identity,
    //       prefix-independent — STM…/HIVE…/BLT… are the same 33 bytes) ─────
    const hcRaw = pubRaw33(hc.pub);
    const seal = seals.find((s) => pubRaw33(s.pub) === hcRaw);
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
      // ── 3. auto-bootstrap — ONLY when no live seal exists at all (r32 wipe-guard):
      //       a vault still bound to any current key must NEVER wipe itself;
      //       the operator is pointed at a key that opens it, and the seal-refresh
      //       then binds every current key mechanically. ─────────────────────
      const authority = await fetchChainAuthorityMap();
      const liveSeals = seals.filter((s) =>
        (authority.map.get(pubRaw33(s.pub) || "") || []).some(
          (c) => c.account === "headcorner" && (c.chain === "steem" || c.chain === "hive"),
        ),
      );
      if (seals.length > 0 && liveSeals.length > 0) {
        const bound = liveSeals.map((s) => `${s.chain}·${s.role}`).slice(0, 6).join(", ");
        throw new GateError(
          "vault-bound",
          `הכספת כבר קשורה למפתחות-headcorner נוכחיים (${bound}) — היכנס עם אחד מהם. ` +
          "הכספת אינה מוחקת את עצמה בזמן שמפתח-נוכחי עוד פותח אותה; " +
          "בכניסה הראשונה היא תחתום את המפתח-אב גם תחת כל מפתח-נוכחי אחר (ריענון-חותמות).",
        );
      }
      const boot = await bootstrapVault(hc, keyStr);
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

    // ── 4. r32 — mechanical seal refresh: seal the master under EVERY current
    //       headcorner key that lacked a seal, so a past rotation can never
    //       strand a newer key again. ────────────────────────────────────────
    let refreshed: Awaited<ReturnType<typeof refreshKeySeals>> | null = null;
    try {
      refreshed = await refreshKeySeals(master);
    } catch {
      refreshed = null; // refresh is best-effort — the login itself succeeded
    }

    // ── 5. in-memory + fresh 30d session carrying the sealed master ───────
    setMaster(master);
    await revokeOtherSessions();
    const token = await createSession("operator", "operator", ["*"], master);
    await db.gateConfig.update({ where: { id: "gate" }, data: { unlockedAt: new Date() } }).catch(() => {});
    await db.gateMessage.create({
      data: {
        fromKind: "system", fromName: "gate",
        body: bootstrapped
          ? `כניסה + הקמה-עצמית: הכספת נאטמה תחת ${bootInfo?.keySeals as number} מפתחות-headcorner נוכחיים (כולל המפתח שהדבקת) · הוכחה: ${hc.chain}·${hc.role}`
          : `כניסה במפתח-חי (${hc.chain} · ${hc.role}) — בלי סיסמה`,
      },
    });
    if (refreshed && refreshed.added > 0) {
      await db.gateMessage.create({
        data: {
          fromKind: "system", fromName: "gate",
          body: `ריענון-חותמות (r32): המפתח-אב נאטם גם תחת ${refreshed.added} מפתחות-נוכחיים שהיו חסרים (${refreshed.addedRoles.join(", ")}) — מ-${refreshed.currentSealed} חותמות-חיות · כל מפתח-headcorner נוכחי פותח עכשיו`,
        },
      });
    }

    return ok({
      in: true,
      token, // operator UI keeps it and sends it as `x-gate-token` (preview-iframe safe)
      identity: hc,
      bootstrapped,
      bootInfo,
      sealsRefreshed: refreshed ? { added: refreshed.added, roles: refreshed.addedRoles, currentSealed: refreshed.currentSealed } : null,
      at: new Date().toISOString(),
    });
  } catch (e) {
    return fail(e);
  }
}

/**
 * r28 — live rotation evidence for honest rejections: reads headcorner's
 * last_owner_update from both rails (best-effort; empty on silence).
 * Proven live 2026-09-11: STEEM owner updated 2026-09-10T23:25:21,
 * HIVE owner updated 2026-09-08T21:17:39 — the two rotations that retired
 * the operator's older keys.
 */
async function rotationEvidence(): Promise<string> {
  const rails: Array<[string, string]> = [
    ["STEEM", "https://api.steemit.com"],
    ["HIVE", "https://api.hive.blog"],
  ];
  const parts: string[] = [];
  await Promise.all(
    rails.map(async ([label, node]) => {
      try {
        const r = await fetch(node, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [["headcorner"]], id: 1 }),
          signal: AbortSignal.timeout(8000),
        });
        const j = (await r.json()) as { result?: Array<{ last_owner_update?: string }> };
        const ts = j.result?.[0]?.last_owner_update;
        if (ts && ts !== "1970-01-01T00:00:00") parts.push(`${label} owner עודכן על-השרשרת ב-${ts} UTC`);
      } catch {
        /* evidence is best-effort — the rejection stands on the sweep itself */
      }
    }),
  );
  return parts.length ? ` (ראיה חיה: ${parts.join(" · ")})` : "";
}

/** Rebuild the vault from surviving sources and seal the fresh master under EVERY current headcorner key — PLUS the pasted key (r32). */
async function bootstrapVault(proof: KeyControl, pastedKey: string): Promise<{ master: Buffer; info: Record<string, unknown> }> {
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
  // r32: the PROVEN pasted key always gets a seal of its own — the operator who
  // just proved on-chain ownership must never be locked out of the rebuilt vault.
  keySeals.push(
    makeKeySeal(masterHex, pastedKey, {
      pub: proof.pub, chain: proof.chain, account: proof.account, role: proof.role,
    }),
  );

  await db.$transaction(async (tx) => {
    await tx.vaultEntry.deleteMany();
    // a NEW master invalidates every trusted device's sealed copy — revoke them all
    await tx.gateDevice.updateMany({ where: { revoked: false }, data: { revoked: true } });
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
        body: `הקמה-עצמית בכניסה: מפתח-אב חדש נאטם תחת ${keySeals.length} מפתחות נוכחיים (כולל המפתח שהדבקת) · ${bundle.entries.length} סודות ייובאו · בלי סיסמה בכלל`,
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
