import { db } from "@/lib/db";
import { requireAgent, getSession } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import { masterReady } from "@/lib/gate/crypto";
import { verifyAll } from "@/lib/gate/verify";
import { GateError } from "@/lib/gate/crypto";

export const runtime = "nodejs";

/**
 * POST /api/gate/actions — agent executes a whitelisted action.
 *   message.post    { body }                 → write to the command chat
 *   report.status   {}                       → connectivity summary (public-safe)
 *   vault.list-pubs {}                       → public identities only (never privs)
 *   verify.run      {}                       → re-run live verification (read-only)
 */
export async function POST(req: Request) {
  const rawBody = await req.json().catch(() => ({}));
  try {
    const agent = await requireAgent(req);
    const { action, params } = rawBody as { action?: string; params?: Record<string, unknown> };
    let result: unknown = null;
    let okAction = true;

    switch (action) {
      case "message.post": {
        const body = String(params?.body || "").trim();
        if (!body) throw new GateError("bad-input", "דרוש params.body");
        const m = await db.gateMessage.create({
          data: { channel: "command", fromKind: "agent", fromName: agent.name, body: body.slice(0, 4000) },
        });
        result = { messageId: m.id };
        break;
      }
      case "report.status": {
        const cfg = await db.gateConfig.findUnique({ where: { id: "gate" } });
        result = {
          vault: { initialized: Boolean(cfg?.initialized), unlocked: masterReady(), entries: await db.vaultEntry.count() },
          agents: await db.gateAgent.count({ where: { active: true } }),
        };
        break;
      }
      case "vault.list-pubs": {
        if (!masterReady()) throw new GateError("vault-locked", "הכספת נעולה — אין לגשת לזהויות");
        const rows = await db.vaultEntry.findMany({
          select: { kind: true, chain: true, account: true, role: true, pub: true, status: true },
          orderBy: [{ chain: "asc" }, { account: "asc" }],
        });
        result = { entries: rows, note: "pubs בלבד — חומר-פרטי לעולם לא נחשף לסוכנים" };
        break;
      }
      case "verify.run": {
        if (!masterReady()) throw new GateError("vault-locked", "הכספת נעולה");
        const v = await verifyAll();
        result = {
          summary: {
            total: v.entries.length,
            verified: v.entries.filter((e) => e.liveOk === true).length,
            failed: v.entries.filter((e) => e.liveOk === false).length,
          },
          chains: { steemOk: v.steemOk, hiveOk: v.hiveOk, githubOk: v.githubOk },
        };
        break;
      }
      default:
        okAction = false;
        result = "פעולה לא-מוכרת. מותרות: message.post · report.status · vault.list-pubs · verify.run";
    }

    await db.gateAction.create({
      data: { agentName: agent.name, action: String(action || "unknown"), params: JSON.stringify(params || {}), ok: okAction, result: JSON.stringify(result).slice(0, 4000) },
    });
    return ok({ action, ok: okAction, result });
  } catch (e) {
    // still audit the failure
    try {
      const agent = await requireAgent(req);
      await db.gateAction.create({
        data: { agentName: agent.name, action: String((rawBody as { action?: string })?.action || "unknown"), ok: false, result: String((e as Error).message).slice(0, 2000) },
      });
    } catch { /* no valid agent — nothing to audit */ }
    return fail(e);
  }
}

/** GET /api/gate/actions — operator: recent audit log. */
export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.kind !== "operator") throw new GateError("operator-only", "רק למפעיל");
    const actions = await db.gateAction.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
    return ok({ actions });
  } catch (e) {
    return fail(e);
  }
}
