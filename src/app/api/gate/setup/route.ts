import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deriveKek, sealWith, openWith, setMaster, GateError } from "@/lib/gate/crypto";
import { createSession } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import crypto from "crypto";

export const runtime = "nodejs";

/** POST /api/gate/setup — first-time vault creation { passphrase, hint? } */
export async function POST(req: Request) {
  try {
    const { passphrase, hint } = await req.json();
    if (typeof passphrase !== "string" || passphrase.length < 8)
      throw new GateError("weak-passphrase", "סיסמת-המפעיל חייבת להיות באורך 8+ תווים");
    const cfg = await db.gateConfig.findUnique({ where: { id: "gate" } });
    if (cfg?.initialized) throw new GateError("already-initialized", "הכספת כבר מאותחלת — השתמש בנעילה/פתיחה");

    const master = crypto.randomBytes(32);
    const salt = crypto.randomBytes(16);
    const kek = deriveKek(passphrase, salt.toString("hex"));
    const seal = sealWith(kek, master.toString("hex"));
    await db.gateConfig.upsert({
      where: { id: "gate" },
      create: {
        id: "gate", initialized: true, kdfSalt: salt.toString("hex"),
        encMaster: seal.ct, sealIv: seal.iv, sealTag: seal.tag, hint: hint || null, unlockedAt: new Date(),
      },
      update: {
        initialized: true, kdfSalt: salt.toString("hex"),
        encMaster: seal.ct, sealIv: seal.iv, sealTag: seal.tag, hint: hint || null, unlockedAt: new Date(),
      },
    });
    setMaster(master);
    await createSession("operator", "operator", ["*"]);
    await db.gateMessage.create({
      data: { fromKind: "system", fromName: "gate", body: "הכספת הריבונית אותחלה — מפתח-אב אקראי נאטם תחת סיסמת-המפעיל (AES-256-GCM · scrypt)" },
    });
    return ok({ initialized: true, note: "שמור את סיסמת-המפעיל מחוץ למכונה — בלעדיה הכספת אינה נפתחת" });
  } catch (e) {
    return fail(e);
  }
}

/** PUT /api/gate/setup — rotate operator passphrase { oldPassphrase, newPassphrase } */
export async function PUT(req: Request) {
  try {
    const { oldPassphrase, newPassphrase } = await req.json();
    if (typeof newPassphrase !== "string" || newPassphrase.length < 8)
      throw new GateError("weak-passphrase", "סיסמה חדשה חייבת 8+ תווים");
    const cfg = await db.gateConfig.findUnique({ where: { id: "gate" } });
    if (!cfg?.initialized || !cfg.encMaster) throw new GateError("not-initialized", "הכספת טרם אותחלה");
    const kekOld = deriveKek(String(oldPassphrase), cfg.kdfSalt as string);
    const masterHex = openWith(kekOld, { ct: cfg.encMaster, iv: cfg.sealIv as string, tag: cfg.sealTag as string });
    const salt = crypto.randomBytes(16);
    const kekNew = deriveKek(newPassphrase, salt.toString("hex"));
    const seal = sealWith(kekNew, masterHex);
    await db.gateConfig.update({
      where: { id: "gate" },
      data: { kdfSalt: salt.toString("hex"), encMaster: seal.ct, sealIv: seal.iv, sealTag: seal.tag },
    });
    setMaster(Buffer.from(masterHex, "hex"));
    return ok({ rotated: true, at: new Date().toISOString() });
  } catch (e) {
    return fail(e);
  }
}
