import { setMaster } from "@/lib/gate/crypto";
import { requireOperator, revokeSession } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/** POST /api/gate/lock — wipe master key from memory
 *  roast r6 gap: this was ANONYMOUSLY callable — anyone on the network could
 *  kill the operator's live session + wipe the in-memory master mid-work
 *  (the exact DoS class r4 closed on vault/lock; the gate's own lock was
 *  missed). Locking is an operator action: the session is required, the
 *  wipe happens after identity, fail-closed. */
export async function POST() {
  try {
    await requireOperator();
    setMaster(null);
    await revokeSession();
    await db.gateMessage.create({ data: { fromKind: "system", fromName: "gate", body: "הכספת ננעלה — מפתח-האב נמחק מהזיכרון" } });
    return ok({ locked: true });
  } catch (e) {
    return fail(e);
  }
}
