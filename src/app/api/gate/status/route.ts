import { db } from "@/lib/db";
import { masterReady, setMaster } from "@/lib/gate/crypto";
import { getSession, openSessionMaster } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";

export const runtime = "nodejs";

/** GET /api/gate/status — initialized? unlocked? who's logged in? counts. */
export async function GET() {
  try {
    const cfg = await db.gateConfig.findUnique({ where: { id: "gate" } });
    const raw = await getSession();
    // A session counts as logged-in only if it can actually open the vault
    // (sealed master inside it, or master already in memory). Prevents the
    // "logged in but nothing works" dead state after schema/era changes.
    const session = raw && (raw.canOpenMaster || masterReady()) ? raw : null;
    // WAKE: valid session + cold server → silently re-open the master from the
    // session's sealed copy. "פשוט להתחבר ולעבוד" — restarts are invisible.
    if (raw?.canOpenMaster && !masterReady()) {
      const m = await openSessionMaster();
      if (m) setMaster(m);
    }
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
      keySeals: cfg?.keySeals ? (JSON.parse(cfg.keySeals) as unknown[]).length : 0,
      session: session ? { kind: session.kind, name: session.name, scopes: session.scopes } : null,
      counts: { vaultEntries: entries, activeAgents: agents, messages },
    });
  } catch (e) {
    return fail(e);
  }
}
