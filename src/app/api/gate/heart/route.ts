import { db } from "@/lib/db";
import { requireOperator } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import { GateError } from "@/lib/gate/crypto";
import { readPulse, HEART_CONSTANTS, tickOnce, readProposalPolicy } from "@/lib/gate/harness/heart";

export const runtime = "nodejs";

/**
 * GET /api/gate/heart — the autonomy nervous system, one honest view:
 * the heart's pulse (self-observability), live queue counts, schedules,
 * trigger policy and the freshest events. The operator sees WHY every
 * autonomous run exists (למה), WHO ran (מי), WHAT it wanted (מה)
 * and HOW it went (איך) — evidence, not vibes.
 */
export async function GET() {
  try {
    await requireOperator();
    const [pulse, queued, running, schedules, triggers, events, cfg, agents, proposals, policy, checkerRow] = await Promise.all([
      readPulse(),
      db.gateRun.count({ where: { status: "queued" } }),
      db.gateRun.count({ where: { status: "running" } }),
      db.gateSchedule.findMany({ orderBy: { createdAt: "asc" } }),
      db.gateTrigger.findMany({ orderBy: { createdAt: "asc" } }),
      db.gateEvent.findMany({ orderBy: { createdAt: "desc" }, take: 12 }),
      db.gateConfig.findUnique({ where: { id: "gate" }, select: { autonomyEnabled: true } }),
      db.gateAgent.findMany({ where: { active: true }, select: { name: true, autonomy: true, lastSeenAt: true, brain: true }, orderBy: { createdAt: "asc" } }),
      db.gateProposal.findMany({ orderBy: { createdAt: "desc" }, take: 15 }),
      readProposalPolicy(),
      db.gateState.findUnique({ where: { key: "checkerstats" } }),
    ]);
    let checkerStats: unknown = null;
    try { checkerStats = checkerRow ? JSON.parse(checkerRow.value) : null; } catch { checkerStats = null; }
    return ok({
      pulse,
      constants: HEART_CONSTANTS,
      counts: { queued, running },
      autonomyEnabled: cfg?.autonomyEnabled !== false,
      schedules,
      triggers: triggers.map((t) => ({ ...t, doneMeans: JSON.parse(t.doneMeans || "[]") })),
      events: events.map((e) => ({ ...e, payload: e.payload ? JSON.parse(e.payload) : null })),
      agents,
      proposals,
      proposalPolicy: policy,
      checkerStats,
    });
  } catch (e) {
    return fail(e);
  }
}

/**
 * POST /api/gate/heart — the autonomy kill-switch (operator-only).
 * { autonomyEnabled: boolean } — OFF drains to a clean stop (the heart
 * launches nothing new; in-flight runs complete and the reaper still
 * guards crash-safety).
 */
export async function POST(req: Request) {
  try {
    await requireOperator();
    const body = (await req.json()) as { autonomyEnabled?: boolean };
    if (typeof body.autonomyEnabled !== "boolean") throw new GateError("bad-input", "דרוש autonomyEnabled: boolean");
    await db.gateConfig.upsert({
      where: { id: "gate" },
      create: { id: "gate", autonomyEnabled: body.autonomyEnabled },
      update: { autonomyEnabled: body.autonomyEnabled },
    });
    await db.gateMessage.create({
      data: {
        channel: "command",
        fromKind: "system",
        fromName: "harness",
        body: body.autonomyEnabled
          ? "🧠 לב-האוטונומיה הופעל — הסוכנים יקומו לבד לפי סיורים וטריגרים (מרוסן: תקציבים, מקסימום-יומי, ומוח-שונה לבודק)"
          : "🛑 לב-האוטונומיה נעצר — אף סוכן לא יקום לבד עד שהמפעיל יפעיל מחדש",
        meta: "{}",
      },
    });
    const pulse = await tickOnce(); // apply immediately — the operator sees the switch bite
    return ok({ autonomyEnabled: body.autonomyEnabled, pulse });
  } catch (e) {
    return fail(e);
  }
}
