import { setMaster } from "@/lib/gate/crypto";
import { revokeSession } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/** POST /api/gate/lock — wipe master key from memory */
export async function POST() {
  try {
    setMaster(null);
    await revokeSession();
    await db.gateMessage.create({ data: { fromKind: "system", fromName: "gate", body: "הכספת ננעלה — מפתח-האב נמחק מהזיכרון" } });
    return ok({ locked: true });
  } catch (e) {
    return fail(e);
  }
}
