import { runRestoreDrill, DrillResult } from "@/lib/gate/restore-drill";
import { db } from "@/lib/db";
import { requireOperator } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import { GateError } from "@/lib/gate/crypto";

export const runtime = "nodejs";

/**
 * r37 — THE RESTORE DRILL ("וודא שהכספת תאטום יכולת לשחזר את כל המפתחות").
 *
 * POST /api/gate/restore-drill — operator-only. Opens EVERY VaultEntry
 * ciphertext against the live master and counts what actually decrypts.
 * On a full pass it also writes the sealed insurance snapshot. The response
 * (and GateConfig.lastRestoreDrill) carry ids/labels/booleans only — never
 * key material.
 *
 * GET — the persisted last drill summary (public shape, no secrets).
 */
export async function POST() {
  try {
    await requireOperator();
    const r = await runRestoreDrill(true);
    await db.gateMessage.create({
      data: {
        fromKind: "system", fromName: "gate",
        body: r.meaning,
      },
    }).catch(() => {});
    return ok(r);
  } catch (e) {
    if (e instanceof GateError && e.code === "vault-locked") {
      return Response.json({ ok: false, code: "vault-locked", error: "הכספת נעולה — התרגיל דורש מפתח-אב חי בזיכרון" }, { status: 423 });
    }
    return fail(e);
  }
}

export async function GET() {
  try {
    const cfg = await db.gateConfig.findUnique({ where: { id: "gate" } });
    let last: DrillResult | null = null;
    if (cfg?.lastRestoreDrill) {
      try { last = JSON.parse(cfg.lastRestoreDrill) as DrillResult; } catch { last = null; }
    }
    return ok({ last });
  } catch (e) {
    return fail(e);
  }
}
