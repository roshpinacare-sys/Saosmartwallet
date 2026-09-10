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
    // r18 — fleet employment health, computed LIVE (last 24h, aggregated,
    // public — no secrets, no goal text). The heart's blocked taxonomy is
    // classified the same way the r18 forensics did: fair-block (checker
    // said no), vault-locked, 429 rate window, watchdog crash, other.
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const recent = await db.gateRun.findMany({
      where: { createdAt: { gte: since } },
      select: { status: true, error: true, verdict: true, origin: true },
      take: 500,
      orderBy: { createdAt: "desc" },
    });
    let done = 0, blocked = 0, failed = 0, running = 0, idle = 0;
    const blockedTaxonomy = { fair: 0, vaultLocked: 0, rate429: 0, watchdog: 0, other: 0 };
    for (const r of recent) {
      if (r.origin === "idle") idle++;
      if (r.status === "done") done++;
      else if (r.status === "queued" || r.status === "running") running++;
      else if (r.status === "blocked" || r.status === "failed") {
        if (r.status === "blocked") blocked++; else failed++;
        const s = `${r.error || ""} ${r.verdict || ""}`;
        if (s.includes("נעולה")) blockedTaxonomy.vaultLocked++;
        else if (/429|too many requests|rate.?limit/i.test(s)) blockedTaxonomy.rate429++;
        else if (s.includes("watchdog")) blockedTaxonomy.watchdog++;
        else if (r.status === "blocked") blockedTaxonomy.fair++;
        else blockedTaxonomy.other++;
      }
    }
    const terminal = done + blocked + failed;
    const employment = {
      runs24h: recent.length,
      done, blocked, failed, running,
      doneRate: terminal > 0 ? Math.round((done * 100) / terminal) : null,
      blockedTaxonomy,
      idleRuns24h: idle,
      agentsActive: agents,
    };
    return ok({
      initialized: Boolean(cfg?.initialized),
      unlocked: masterReady(),
      hint: cfg?.hint || null,
      unlockedAt: cfg?.unlockedAt || null,
      keySeals: cfg?.keySeals ? (JSON.parse(cfg.keySeals) as unknown[]).length : 0,
      session: session ? { kind: session.kind, name: session.name, scopes: session.scopes } : null,
      counts: { vaultEntries: entries, activeAgents: agents, messages },
      employment,
    });
  } catch (e) {
    return fail(e);
  }
}
