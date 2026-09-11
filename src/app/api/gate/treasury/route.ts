import { requireOperator } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import { getTreasurySnapshot } from "@/lib/gate/treasury";

export const runtime = "nodejs";

/**
 * GET /api/gate/treasury — the fleet's money, measured LIVE (r21).
 * Three rails × every vault-known account: liquid + debt + vesting, honest
 * per-rail failures, 30s in-process cache. Operator-scoped: the money truth
 * belongs to the command center (agents read it via the fleet.treasury
 * module, which calls the same snapshot server-side).
 */
export async function GET(req: Request) {
  try {
    await requireOperator();
    const force = new URL(req.url).searchParams.get("force") === "1";
    const snap = await getTreasurySnapshot(force);
    return ok(snap);
  } catch (e) {
    return fail(e);
  }
}
