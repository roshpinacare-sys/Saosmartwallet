import { db } from "@/lib/db";
import { createSession, revokeOtherSessions } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import { GateError, setMaster } from "@/lib/gate/crypto";
import { deviceMaster } from "@/lib/gate/device";
import { clientIpOf, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/gate/device/login — the secure "remember me" re-entry.
 * { deviceToken } → the token must match a live GateDevice row (hash-only
 * server-side) AND unseal the master (GCM rejects everything else).
 * On success: a fresh 30-day operator session is minted with the master
 * sealed inside — exactly like a key login, minus the key.
 */
export async function POST(req: Request) {
  const rl = rateLimit(`gate-device-login:${clientIpOf(req)}`, 10, 60_000);
  if (!rl.ok) {
    return Response.json({ ok: false, code: "rate", error: "יותר מדי ניסיונות — נסה בעוד דקה" }, { status: 429 });
  }
  try {
    const body = await req.json().catch(() => ({} as { deviceToken?: string }));
    const token = typeof body.deviceToken === "string" ? body.deviceToken.trim() : "";
    if (!token) throw new GateError("bad-input", "דרוש deviceToken");

    const { master, device } = await deviceMaster(token);

    setMaster(master);
    await revokeOtherSessions();
    const sessionToken = await createSession("operator", "operator", ["*"], master);
    await db.gateDevice.update({ where: { id: device.id }, data: { lastUsedAt: new Date() } });
    await db.gateConfig.update({ where: { id: "gate" }, data: { unlockedAt: new Date() } }).catch(() => {});
    await db.gateMessage.create({
      data: { fromKind: "system", fromName: "gate", body: `כניסה חוזרת ממכשיר-מהימן (${device.label}) — בלי מפתח, עם הוכחת-החזקה בלבד` },
    });

    return ok({
      in: true,
      token: sessionToken,
      device: { id: device.id, label: device.label },
      at: new Date().toISOString(),
    });
  } catch (e) {
    return fail(e);
  }
}
