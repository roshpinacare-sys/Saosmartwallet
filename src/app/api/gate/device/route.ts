import { db } from "@/lib/db";
import { requireOperator, openSessionMaster } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import { GateError, getMaster, masterReady } from "@/lib/gate/crypto";
import { armDevice, deviceLabelFrom, DEVICE_DAYS } from "@/lib/gate/device";

export const runtime = "nodejs";

/**
 * POST /api/gate/device — arm THIS browser as a trusted device ("זכור אותי").
 * Requires an operator session (the key was already proven live).
 * Returns the device token EXACTLY ONCE — the browser stores it, the DB
 * stores only its hash plus the master sealed under it.
 */
export async function POST(req: Request) {
  try {
    const s = await requireOperator();
    const master = masterReady() ? getMaster() : await openSessionMaster();
    if (!master) throw new GateError("vault-locked", "הכספת נעולה — אי אפשר לחתום מפתח-אב על מכשיר חדש");

    const body = await req.json().catch(() => ({} as { label?: string }));
    const label = (typeof body.label === "string" && body.label.trim()) || deviceLabelFrom(req.headers.get("user-agent"));

    const d = await armDevice(master, label);
    await db.gateMessage.create({
      data: { fromKind: "system", fromName: "gate", body: `מכשיר-מהימן חומש: "${d.label}" — כניסה חוזרת בלי מפתח ל-${DEVICE_DAYS} יום · הטוקן חי בדפדפן בלבד (בשרת: hash + צופן בלבד)` },
    });
    return ok({
      device: { id: d.id, label: d.label, expiresAt: d.expiresAt },
      deviceToken: d.token, // shown once — localStorage of THIS browser only
      note: "הטוקן נשמר בדפדפן הזה בלבד — שלילה מיידית דרך מכשירים-מהימנים",
    });
  } catch (e) {
    return fail(e);
  }
}

/** GET /api/gate/device — operator: the trusted-device roster. */
export async function GET() {
  try {
    await requireOperator();
    const devices = await db.gateDevice.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
    return ok({
      devices: devices.map((d) => ({
        id: d.id, label: d.label, createdAt: d.createdAt, lastUsedAt: d.lastUsedAt,
        expiresAt: d.expiresAt, revoked: d.revoked,
      })),
    });
  } catch (e) {
    return fail(e);
  }
}

/** DELETE /api/gate/device?id=… | ?all=1 — operator: revoke one / every device. */
export async function DELETE(req: Request) {
  try {
    await requireOperator();
    const url = new URL(req.url);
    if (url.searchParams.get("all") === "1") {
      const r = await db.gateDevice.updateMany({ where: { revoked: false }, data: { revoked: true } });
      await db.gateMessage.create({ data: { fromKind: "system", fromName: "gate", body: `כל המכשירים-המהימנים נשללו (${r.count}) — כניסה חוזרת רק במפתח-חי` } });
      return ok({ revoked: r.count });
    }
    const id = url.searchParams.get("id");
    if (!id) throw new GateError("bad-input", "דרוש ?id= או ?all=1");
    const r = await db.gateDevice.updateMany({ where: { id }, data: { revoked: true } });
    if (!r.count) throw new GateError("no-device", "אין מכשיר כזה");
    await db.gateMessage.create({ data: { fromKind: "system", fromName: "gate", body: `מכשיר-מהימן נשלל (${id.slice(-6)}) — הצופן שלו אינרטי מעתה` } });
    return ok({ revoked: id });
  } catch (e) {
    return fail(e);
  }
}
