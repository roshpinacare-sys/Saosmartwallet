import { fail, ok } from "@/lib/gate/http";
import { getSituationSnapshot } from "@/lib/gate/situation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/gate/situation — THE SITUATION PLANE (r22).
 * One zero-load call that answers the operator's directive: what we have
 * (money on every rail + EVM/SOL eyes + vault), what is happening
 * everywhere (pending rewards + org repos where other agents work +
 * fleet + anchors). Cached 60s in-process; every section fails honestly
 * and independently; no secrets ever leave the vault.
 */
export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    const snap = await getSituationSnapshot(force);
    return ok(snap);
  } catch (e) {
    return fail(e);
  }
}
