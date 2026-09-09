import { db } from "@/lib/db";
import { requireOperator } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";

export const runtime = "nodejs";

/**
 * GET /api/gate/memory — operator visibility into the fleet's shared knowledge
 * bank (GateMemory): final findings written once by agents or by the harness
 * auto-harvest (drift), with provenance and real read counters.
 */
export async function GET() {
  try {
    await requireOperator();
    const [rows, total] = await Promise.all([
      db.gateMemory.findMany({ orderBy: { updatedAt: "desc" }, take: 40 }),
      db.gateMemory.count(),
    ]);
    const reads = rows.reduce((acc, r) => acc + r.refCount, 0);
    return ok({ total, reads, facts: rows });
  } catch (e) {
    return fail(e);
  }
}
