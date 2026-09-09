import { db } from "@/lib/db";
import { masterReady } from "@/lib/gate/crypto";
import { getSession } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";

export const runtime = "nodejs";

/** GET /api/gate/status — initialized? unlocked? who's logged in? counts. */
export async function GET() {
  try {
    const cfg = await db.gateConfig.findUnique({ where: { id: "gate" } });
    const session = await getSession();
    const [entries, agents, messages] = await Promise.all([
      db.vaultEntry.count(),
      db.gateAgent.count({ where: { active: true } }),
      db.gateMessage.count(),
    ]);
    return ok({
      initialized: Boolean(cfg?.initialized),
      unlocked: masterReady(),
      hint: cfg?.hint || null,
      unlockedAt: cfg?.unlockedAt || null,
      session: session ? { kind: session.kind, name: session.name, scopes: session.scopes } : null,
      counts: { vaultEntries: entries, activeAgents: agents, messages },
    });
  } catch (e) {
    return fail(e);
  }
}
