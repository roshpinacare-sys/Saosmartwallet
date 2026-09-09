import { db } from "@/lib/db";
import { requireOperator, } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import { GateError, masterReady } from "@/lib/gate/crypto";
import { approveOrder, rejectOrder, ORDER_RAILS, COMMANDER_ACCOUNT } from "@/lib/gate/harness/orders";

export const runtime = "nodejs";

/**
 * GET /api/gate/orders — the SOVEREIGN-HAND queue (operator view):
 * every order an agent built (unsigned), the rails, and the real chain
 * evidence (broadcastId) for everything already signed.
 */
export async function GET() {
  try {
    await requireOperator();
    const [rows, signedToday] = await Promise.all([
      db.gateOrder.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
      db.gateOrder.count({
        where: { status: "signed", decidedAt: { gte: new Date(new Date().toISOString().slice(0, 10)) } },
      }),
    ]);
    return ok({
      orders: rows,
      rails: ORDER_RAILS,
      account: COMMANDER_ACCOUNT,
      signedToday,
      vaultOpen: masterReady(), // signing needs an open vault — say so BEFORE the operator clicks approve
    });
  } catch (e) {
    return fail(e);
  }
}

/**
 * PATCH /api/gate/orders — the operator's verdict on a pending order:
 *   { id, decision: "approve" } → rebuild (same spec) → vault signs with the
 *     ACTIVE key → real broadcast → txId recorded (chain evidence).
 *   { id, decision: "reject"  } → rejected honestly, never signed.
 * The vault must be open in this process (operator session) — fail closed.
 */
export async function PATCH(req: Request) {
  try {
    await requireOperator();
    const body = (await req.json()) as { id?: string; decision?: string };
    const id = String(body.id || "");
    const decision = String(body.decision || "");
    if (!id || !["approve", "reject"].includes(decision))
      throw new GateError("bad-input", "דרוש id + decision (approve|reject)");
    if (decision === "reject") {
      await rejectOrder(id, "operator");
      return ok({ status: "rejected" });
    }
    const r = await approveOrder(id, "operator");
    return ok({ status: "signed", broadcastId: r.broadcastId, blockNum: r.blockNum ?? null });
  } catch (e) {
    return fail(e);
  }
}
