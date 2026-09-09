import { db } from "@/lib/db";
import { requireOperator, openSessionMaster } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import { GateError, setMaster, masterReady } from "@/lib/gate/crypto";
import { getModule } from "@/lib/gate/harness/modules";
import { parseBrain, pickCheckerBrain } from "@/lib/gate/harness/brain";
import { processRun, buildLessons, type TraceStep } from "@/lib/gate/harness/loop";

export const runtime = "nodejs";

const MAX_BUDGET = 8;

/**
 * POST /api/gate/run — operator launches a goal-loop for an armed agent.
 *   { agentName, goal, doneMeans: string[], modules?: string[], brain?: string, budget?: number }
 * Cross-run lessons are distilled from the agent's past runs BEFORE launch
 * and stored on the row (external memory — the maker reads them on step 1).
 * The loop runs in the background; the trace builds in the DB (external state)
 * and the operator polls GET /api/gate/run?id=…
 */
export async function POST(req: Request) {
  try {
    await requireOperator();
    // Vault wake — after a server restart the in-memory master is gone; the
    // operator's session carries a sealed copy, so open it BEFORE the loop runs.
    if (!masterReady()) {
      const m = await openSessionMaster();
      if (m) setMaster(m);
    }
    const body = (await req.json()) as {
      agentName?: string; goal?: string; doneMeans?: string[]; modules?: string[]; brain?: string; budget?: number;
    };

    const agentName = String(body.agentName || "").trim();
    const goal = String(body.goal || "").trim();
    if (!goal || goal.length < 8) throw new GateError("bad-input", "דרוש goal אמיתי (8+ תווים) — מה נחשב מטרה?");
    if (!Array.isArray(body.doneMeans) || body.doneMeans.filter((d) => typeof d === "string" && d.trim()).length < 1)
      throw new GateError("bad-input", "דרוש לפחות קריטריון-סיום אחד (doneMeans) — בלי זה הבודק לא יכול לפסוק");

    const agent = await db.gateAgent.findFirst({ where: { name: agentName, active: true } });
    if (!agent) throw new GateError("bad-agent", "אין סוכן פעיל בשם הזה — חבר וחמש אותו קודם");

    let armed: string[] = [];
    try { armed = JSON.parse(agent.modules || "[]"); if (!Array.isArray(armed)) armed = []; } catch { armed = []; }
    const requested = Array.isArray(body.modules) && body.modules.length ? body.modules : armed;
    const modules = requested.filter((id) => getModule(id));
    if (!modules.length) throw new GateError("not-armed", "הסוכן לא חמוש באף מודול — חמש אותו קודם במחסן-המודולים");

    const brain = parseBrain(String(body.brain || agent.brain || "nvidia:openai/gpt-oss-20b"));
    const brainStr = `${brain.provider}:${brain.model}`;
    const checkerStr = pickCheckerBrain(brainStr); // generator/evaluator separation — enforced, not optional
    const budget = Math.min(Math.max(Number(body.budget) || 5, 1), MAX_BUDGET);

    const run = await db.gateRun.create({
      data: {
        agentName: agent.name,
        goal: goal.slice(0, 600),
        doneMeans: JSON.stringify(body.doneMeans.filter((d) => typeof d === "string" && d.trim()).slice(0, 8).map((d) => d.trim().slice(0, 200))),
        modules: JSON.stringify(modules),
        brain: brainStr,
        checker: checkerStr,
        budget,
        status: "queued",
      },
    });

    // cross-run external memory: lessons from THIS agent's past runs, before step 1
    const lessons = await buildLessons(agent.name, run.id);
    if (lessons.length) {
      await db.gateRun.update({ where: { id: run.id }, data: { lessons: JSON.stringify(lessons) } });
    }

    await db.gateMessage.create({
      data: { channel: "command", fromKind: "system", fromName: "harness", body: `🚀 מטרה חדשה לסוכן ${agent.name}: "${goal.slice(0, 200)}" · מוח: ${brainStr} · בודק עצמאי: ${checkerStr} · תקציב: ${budget} צעדים${lessons.length ? ` · לקחים מ-${lessons.length} ריצות-עבר הוזרקו` : ""}`, meta: JSON.stringify({ runId: run.id }) },
    });

    // Background execution — fire and forget; every step persists to GateRun.
    void processRun(run.id).catch(() => { /* processRun self-reports into GateRun.error */ });

    return ok({ run: { id: run.id, agentName: run.agentName, goal: run.goal, brain: brainStr, checker: checkerStr, budget, status: run.status, lessons: lessons.length } });
  } catch (e) {
    return fail(e);
  }
}

/**
 * GET /api/gate/run           — last 50 runs (lean: no step payloads) + per-agent fleet efficiency
 * GET /api/gate/run?id=…      — one run with full evidence trace
 */
export async function GET(req: Request) {
  try {
    await requireOperator();
    const id = new URL(req.url).searchParams.get("id");
    if (id) {
      const run = await db.gateRun.findUnique({ where: { id } });
      if (!run) throw new GateError("no-run", "אין הרצה כזו");
      return ok({
        run: {
          ...run,
          doneMeans: JSON.parse(run.doneMeans || "[]"),
          modules: JSON.parse(run.modules || "[]"),
          steps: run.steps ? JSON.parse(run.steps) : [],
          verdict: run.verdict ? JSON.parse(run.verdict) : null,
          lessons: run.lessons ? JSON.parse(run.lessons) : [],
          tokens: run.tokens ? JSON.parse(run.tokens) : null,
        },
      });
    }
    const runs = await db.gateRun.findMany({ orderBy: { createdAt: "desc" }, take: 50 });

    // real efficiency per agent — measured, not vibes
    interface AgentStat { agent: string; runs: number; done: number; blocked: number; failed: number; avgSteps: number; avgMs: number | null }
    const stats: Record<string, AgentStat> = {};
    const lean = runs.map((r) => {
      let makerSteps = 0;
      try { makerSteps = (JSON.parse(r.steps || "[]") as TraceStep[]).filter((s) => s.side === "maker").length; } catch { makerSteps = 0; }
      const s = (stats[r.agentName] ||= { agent: r.agentName, runs: 0, done: 0, blocked: 0, failed: 0, avgSteps: 0, avgMs: 0 });
      s.runs++;
      if (r.status === "done") s.done++;
      else if (r.status === "blocked") s.blocked++;
      else if (r.status === "failed") s.failed++;
      s.avgSteps += makerSteps;
      s.avgMs += r.durationMs ?? 0;
      const { steps: _steps, lessons: _lessons, ...rest } = r;
      return { ...rest, makerSteps };
    });
    const statList = Object.values(stats).map((s) => ({
      ...s,
      avgSteps: s.runs ? Math.round((s.avgSteps / s.runs) * 10) / 10 : 0,
      avgMs: s.runs && s.avgMs ? Math.round(s.avgMs / s.runs) : null,
    })).sort((a, b) => b.runs - a.runs);

    return ok({ runs: lean, stats: statList });
  } catch (e) {
    return fail(e);
  }
}
