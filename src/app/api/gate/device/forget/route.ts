import { db } from "@/lib/db";
import { fail, ok } from "@/lib/gate/http";
import { sha256hex } from "@/lib/gate/crypto";
import { revokeDeviceRows } from "@/lib/gate/device";
import { clientIpOf, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/gate/device/forget — the browser forgets itself.
 * Works WITHOUT an operator session: possession of the device token IS the
 * authorization to revoke it (an attacker with the token could revoke it —
 * which only makes it inert, never weaker). Honest result either way.
 * ROAST r9 gap-31: forgetting now SCRUBS the sealed master out of the DB —
 * inert by data, not by flag. (The operator's already-open sessions are NOT
 * touched here: this is self-service, not a security revocation.)
 */
export async function POST(req: Request) {
  const rl = rateLimit(`gate-device-forget:${clientIpOf(req)}`, 10, 60_000);
  if (!rl.ok) {
    return Response.json({ ok: false, code: "rate", error: "יותר מדי ניסיונות — נסה בעוד דקה" }, { status: 429 });
  }
  try {
    const body = await req.json().catch(() => ({} as { deviceToken?: string }));
    const token = typeof body.deviceToken === "string" ? body.deviceToken.trim() : "";
    if (!token) return ok({ forgotten: false, note: "אין טוקן-מכשיר — אין מה לשכוח" });
    const row = await db.gateDevice.findUnique({ where: { tokenHash: sha256hex(token) }, select: { id: true, revoked: true } });
    if (!row || row.revoked) return ok({ forgotten: true, rows: 0, note: "המכשיר כבר לא פעיל" });
    const r = await revokeDeviceRows({ id: row.id }, null, "הדפדפן שכח את עצמו");
    return ok({ forgotten: true, rows: r.devices, note: "המכשיר נשלל והצופן נמחק מה-DB — הצופן לא ייפתח שוב בשום מקרה" });
  } catch (e) {
    return fail(e);
  }
}
