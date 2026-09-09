import { db } from "@/lib/db";
import { setMaster, GateError } from "@/lib/gate/crypto";
import { createSession } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import { identifyKey } from "@/lib/gate/key-id";
import { loadKeySeals, openMasterWithKey } from "@/lib/gate/key-seal";
import { clientIpOf, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/gate/unlock-key — open the vault with ANY current control-key.
 * { key } → live-identify → must hold authority on headcorner (steem/hive,
 * any role) RIGHT NOW → open the key-seal → master in memory + 30d session.
 * This is the "אתחבר עם כל מפתח" promise: losing the passphrase can never
 * lock the owner out again.
 */
export async function POST(req: Request) {
  const rl = rateLimit(`gate-unlock-key:${clientIpOf(req)}`, 10, 60_000);
  if (!rl.ok) {
    return Response.json({ ok: false, code: "rate", error: "יותר מדי ניסיונות — נסה בעוד דקה" }, { status: 429 });
  }
  try {
    const { key } = await req.json().catch(() => ({}));
    if (typeof key !== "string" || key.trim().length < 40) throw new GateError("bad-input", "דרוש מפתח-פרטי");

    const report = await identifyKey(key.trim());
    const hc = report.controls.find((c) => c.account === "headcorner" && (c.chain === "steem" || c.chain === "hive"));
    if (!report.liveChecked) throw new GateError("chains-down", "השרשרות לא נענו — לא ניתן לאמת בעלות כרגע");
    if (!hc) throw new GateError("not-owner", "המפתח אינו מחזיק authority נוכחי על headcorner — פתיחה נדחתה");

    const seals = await loadKeySeals();
    const seal = seals.find((s) => s.pub === hc.pub);
    if (!seal) {
      throw new GateError(
        "no-key-seal",
        "למפתח זה אין חותם-פתיחה (כנראה מפתח-חדש אחרי רוטציה) — השתמש בשחזור-חירום: איפוס-כספת בהוכחת-בעלות",
      );
    }
    let masterHex: string;
    try {
      masterHex = openMasterWithKey(key.trim(), seal);
    } catch {
      throw new GateError("wrong-key", "המפתח אימת אצל השרשרת אך חותם-הפתיחה דחה אותו — GCM סירב");
    }
    setMaster(Buffer.from(masterHex, "hex"));
    await db.gateConfig.update({ where: { id: "gate" }, data: { unlockedAt: new Date() } });
    const token = await createSession("operator", "operator", ["*"]);
    await db.gateMessage.create({
      data: { fromKind: "system", fromName: "gate", body: `הכספת נפתחה במפתח-חי (${hc.chain} · ${hc.role}) — בלי סיסמת-מפעיל` },
    });
    return ok({ unlocked: true, token, identity: hc, at: new Date().toISOString() });
  } catch (e) {
    return fail(e);
  }
}
