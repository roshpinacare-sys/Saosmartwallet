import { db } from "@/lib/db";
import { masterReady, setMaster } from "@/lib/gate/crypto";
import { requireOperator, openSessionMaster } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import { verifyAll } from "@/lib/gate/verify";

export const runtime = "nodejs";

/** GET /api/gate/inventory — operator. Live-verify the whole vault (fresh chain calls). */
export async function GET() {
  try {
    await requireOperator();
    if (!masterReady()) {
      // wake from the session's sealed master (server restarted mid-session)
      const m = await openSessionMaster();
      if (m) setMaster(m);
    }
    if (!masterReady()) {
      const count = await db.vaultEntry.count();
      return ok({ locked: true, entries: [], counts: { total: count }, note: "הכספת נעולה — פתח כדי לאמת live" });
    }
    const { entries, steemOk, hiveOk, githubOk } = await verifyAll();
    const summary = {
      total: entries.length,
      verified: entries.filter((e) => e.liveOk === true).length,
      failed: entries.filter((e) => e.liveOk === false).length,
      noLive: entries.filter((e) => e.liveOk === null).length,
    };
    return ok({ locked: false, entries, summary, chains: { steemOk, hiveOk, githubOk } });
  } catch (e) {
    return fail(e);
  }
}
