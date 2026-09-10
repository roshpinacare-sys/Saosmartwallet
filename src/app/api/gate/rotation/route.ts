import { db } from "@/lib/db";
import { masterReady, setMaster } from "@/lib/gate/crypto";
import { requireOperator, openSessionMaster } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import { importOwnerKeys, rotationStatus, previewRotation, executeRotation } from "@/lib/gate/rotation";

export const runtime = "nodejs";

/** POST /api/gate/rotation — operator-only SOVEREIGN-HAND plane (gap-58, r16).
 *  actions: "status" | "import" | "preview" | "rotate"
 *  The vault signs the one op that moves keys (account_update) ONLY on this
 *  explicit operator call; agents never reach here. */
export async function POST(req: Request) {
  try {
    await requireOperator();
    if (!masterReady()) {
      const m = await openSessionMaster();
      if (m) setMaster(m);
    }
    const body = (await req.json().catch(() => ({}))) as {
      action?: string; account?: string; items?: Array<{ account: string; wif: string }>;
    };
    const action = String(body.action || "status");

    if (action === "status") {
      return ok(await rotationStatus());
    }
    if (action === "import") {
      const items = Array.isArray(body.items) ? body.items.slice(0, 16) : [];
      if (!items.length) return ok({ verdicts: [], sealed: 0, note: "אין פריטים לייבוא" });
      const r = await importOwnerKeys(items);
      return ok(r);
    }
    if (action === "preview") {
      const account = String(body.account || "").trim().toLowerCase();
      if (!account) return fail(new Error("נדרש account"));
      return ok(await previewRotation(account));
    }
    if (action === "rotate") {
      const account = String(body.account || "").trim().toLowerCase();
      if (!account) return fail(new Error("נדרש account"));
      const r = await executeRotation(account);
      return ok(r);
    }
    return fail(new Error(`פעולה לא מוכרת: ${action}`));
  } catch (e) {
    return fail(e);
  } finally {
    await db.$disconnect();
  }
}
