import { db } from "@/lib/db";
import { deriveKek, openWith, setMaster, GateError } from "@/lib/gate/crypto";
import { createSession } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import { rateLimit } from "@/lib/gate/rate-limit";

export const runtime = "nodejs";

/** POST /api/gate/unlock — { passphrase } → master key in memory + operator session */
export async function POST(req: Request) {
  try {
    // חוק: קידוח-KDF יקר לא רץ לפני סיווג-קצב — ניחוש-מקוון נחסם כאן (10/15 דק׳ לכל-IP)
    const clientIp = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";
    const rl = rateLimit(`unlock:${clientIp}`);
    if (!rl.ok) throw new GateError("rate-limited", `יותר מדי ניסיונות — נסה שוב בעוד ${rl.retryAfterS} שניות`);
    const { passphrase } = await req.json();
    if (typeof passphrase !== "string") throw new GateError("bad-input", "דרוש סיסמת-מפעיל");
    const cfg = await db.gateConfig.findUnique({ where: { id: "gate" } });
    if (!cfg?.initialized || !cfg.encMaster) throw new GateError("not-initialized", "הכספת טרם אותחלה — קרא ל-setup");
    let master: Buffer;
    try {
      const kek = deriveKek(passphrase, cfg.kdfSalt as string);
      master = Buffer.from(openWith(kek, { ct: cfg.encMaster, iv: cfg.sealIv as string, tag: cfg.sealTag as string }), "hex");
    } catch {
      throw new GateError("wrong-passphrase", "סיסמה שגויה — GCM אימת וסירב");
    }
    setMaster(master);
    await db.gateConfig.update({ where: { id: "gate" }, data: { unlockedAt: new Date() } });
    const token = await createSession("operator", "operator", ["*"]);
    await db.gateMessage.create({
      data: { fromKind: "system", fromName: "gate", body: "הכספת נפתחה — המפעיל מחובר (סשן 30 יום)" },
    });
    return ok({ unlocked: true, token, at: new Date().toISOString() });
  } catch (e) {
    return fail(e);
  }
}
