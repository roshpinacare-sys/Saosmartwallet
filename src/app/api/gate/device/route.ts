import { db } from "@/lib/db";
import { requireOperator, openSessionMaster, currentSessionTokenHash } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import { GateError, getMaster, masterReady } from "@/lib/gate/crypto";
import { armDevice, revokeDeviceRows, deviceLabelFrom, DEVICE_DAYS, DEVICE_MAX_LIVE, DEVICE_WARN_DAYS } from "@/lib/gate/device";

export const runtime = "nodejs";

/**
 * POST /api/gate/device — arm THIS browser as a trusted device ("זכור אותי").
 * Requires an operator session (the key was already proven live).
 * ROAST r9: sending a valid live `deviceToken` ROTATES that device in place
 * (same row, new token, fresh 90 days — the renewal path, gap-34) instead of
 * duplicating. The token is returned EXACTLY ONCE — the browser stores it,
 * the DB stores only its hash plus the master sealed under it.
 */
export async function POST(req: Request) {
  try {
    const s = await requireOperator();
    const master = masterReady() ? getMaster() : await openSessionMaster();
    if (!master) throw new GateError("vault-locked", "הכספת נעולה — אי אפשר לחתום מפתח-אב על מכשיר חדש");

    const body = await req.json().catch(() => ({} as { label?: string; deviceToken?: string }));
    const label = (typeof body.label === "string" && body.label.trim()) || deviceLabelFrom(req.headers.get("user-agent"));
    const rotateToken = typeof body.deviceToken === "string" ? body.deviceToken.trim() : "";

    const d = await armDevice(master, label, rotateToken || undefined);
    await db.gateMessage.create({
      data: {
        fromKind: "system", fromName: "gate",
        body: rotateToken
          ? `מכשיר-מהימן חודש (רוטציה): "${d.label}" — טוקן חדש, תוקף עד ${d.expiresAt.toISOString().slice(0, 10)} · הטוקן הישן מת לאלתר`
          : `מכשיר-מהימן חומש: "${d.label}" — כניסה חוזרת בלי מפתח ל-${DEVICE_DAYS} יום · הטוקן חי בדפדפן בלבד (בשרת: hash + צופן בלבד)`,
      },
    });
    return ok({
      device: { id: d.id, label: d.label, expiresAt: d.expiresAt },
      deviceToken: d.token, // shown once — localStorage of THIS browser only
      rotated: Boolean(rotateToken),
      note: "הטוקן נשמר בדפדפן הזה בלבד — שלילה מוחקת את הצופן מה-DB (לא רק דגל)",
    });
  } catch (e) {
    return fail(e);
  }
}

/**
 * GET /api/gate/device — operator: the trusted-device roster.
 * ROAST r9 gap-30: the roster no longer lies — every row carries `live`
 * (not revoked AND not expired) and `daysLeft`; `liveCount` counts only
 * devices that can actually still log in.
 */
export async function GET() {
  try {
    await requireOperator();
    const now = Date.now();
    const devices = await db.gateDevice.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
    const mapped = devices.map((d) => {
      const daysLeft = Math.max(0, Math.ceil((d.expiresAt.getTime() - now) / 86_400_000));
      return {
        id: d.id, label: d.label, createdAt: d.createdAt, lastUsedAt: d.lastUsedAt,
        expiresAt: d.expiresAt, revoked: d.revoked,
        live: !d.revoked && d.expiresAt.getTime() >= now && Boolean(d.encMaster),
        daysLeft,
        expiringSoon: !d.revoked && daysLeft <= DEVICE_WARN_DAYS,
      };
    });
    return ok({
      devices: mapped,
      liveCount: mapped.filter((d) => d.live).length,
      expiringSoon: mapped.filter((d) => d.expiringSoon).length,
      cap: DEVICE_MAX_LIVE,
    });
  } catch (e) {
    return fail(e);
  }
}

/**
 * DELETE /api/gate/device?id=… | ?all=1 — operator: revoke one / every device.
 * ROAST r9: revocation SCRUBS the sealed master out of the DB (gap-31) and
 * closes the sessions the device minted (gap-33) — the caller's own session
 * stays alive (he is holding the console).
 */
export async function DELETE(req: Request) {
  try {
    await requireOperator();
    const keep = await currentSessionTokenHash();
    const url = new URL(req.url);
    if (url.searchParams.get("all") === "1") {
      const r = await revokeDeviceRows({ all: true }, keep, "כניסת-מכשיר חסומה מעתה — השער-הפתוח של האופרטור נשאר לפי מדיניותו");
      return ok({ revoked: r.devices, sessionsKilled: r.sessionsKilled });
    }
    const id = url.searchParams.get("id");
    if (!id) throw new GateError("bad-input", "דרוש ?id= או ?all=1");
    const r = await revokeDeviceRows({ id }, keep);
    if (!r.devices) throw new GateError("no-device", "אין מכשיר כזה");
    return ok({ revoked: id, sessionsKilled: r.sessionsKilled });
  } catch (e) {
    return fail(e);
  }
}
