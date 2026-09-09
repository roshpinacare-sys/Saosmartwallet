import { db } from "@/lib/db";
import { requireOperator } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import { GateError } from "@/lib/gate/crypto";

export const runtime = "nodejs";

const MIN_EVERY_MIN = 5; // no runaway cadences — autonomy is bounded or it is nothing

/**
 * GET /api/gate/schedule — all patrol schedules (operator).
 * POST  — create a real recurring patrol: { label, agentName, goal,
 *         doneMeans?, everyMinutes | hourUtc, budget?, maxPerDay? }
 * PATCH — { id, enabled } — pause/resume without losing history.
 * DELETE ?id= — remove a schedule (its past runs keep their lineage).
 */
export async function GET() {
  try {
    await requireOperator();
    const schedules = await db.gateSchedule.findMany({ orderBy: { createdAt: "asc" } });
    return ok({ schedules });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  try {
    await requireOperator();
    const b = (await req.json()) as {
      label?: string; agentName?: string; goal?: string; doneMeans?: string[];
      everyMinutes?: number; hourUtc?: number; budget?: number; maxPerDay?: number;
    };
    const label = String(b.label || "").trim();
    const agentName = String(b.agentName || "").trim();
    const goal = String(b.goal || "").trim();
    if (label.length < 3) throw new GateError("bad-input", "דרוש שם-סיור (3+ תווים)");
    if (goal.length < 12) throw new GateError("bad-input", "דרושה מטרה אמיתית (12+ תווים) — מה הסוכן עושה בכל סבב?");
    const agent = await db.gateAgent.findFirst({ where: { name: agentName, active: true } });
    if (!agent) throw new GateError("bad-agent", "אין סוכן פעיל בשם הזה");

    const doneMeans = (Array.isArray(b.doneMeans) && b.doneMeans.filter((d) => typeof d === "string" && d.trim()).length
      ? b.doneMeans.filter((d) => typeof d === "string" && d.trim()).slice(0, 6)
      : ["הכלים החזירו נתונים אמיתיים בעקבות הריצה", "דוח עברית נשלח לגשר-הפיקוד"]);

    const kind = typeof b.hourUtc === "number" ? "daily" : "interval";
    let everyMs: number | null = null;
    let hourUtc: number | null = null;
    let nextRunAt: Date;
    if (kind === "daily") {
      hourUtc = Math.min(Math.max(Math.floor(b.hourUtc as number), 0), 23);
      const d = new Date();
      d.setUTCHours(hourUtc, 0, 0, 0);
      if (d.getTime() <= Date.now()) d.setUTCDate(d.getUTCDate() + 1);
      nextRunAt = d;
    } else {
      const min = Math.max(Number(b.everyMinutes) || 30, MIN_EVERY_MIN);
      everyMs = min * 60_000;
      nextRunAt = new Date(Date.now() + 60_000); // first fire within a minute — visible, provable
    }
    const s = await db.gateSchedule.create({
      data: {
        label: label.slice(0, 80),
        agentName: agent.name,
        goal: goal.slice(0, 600),
        doneMeans: JSON.stringify(doneMeans),
        budget: Math.min(Math.max(Number(b.budget) || 4, 1), 8),
        kind,
        everyMs,
        hourUtc,
        maxPerDay: Math.min(Math.max(Number(b.maxPerDay) || 8, 1), 48),
        nextRunAt,
      },
    });
    await db.gateMessage.create({
      data: {
        channel: "command",
        fromKind: "system",
        fromName: "harness",
        body: `⏰ סיור חדש בלב-האוטונומיה: "${s.label}" — סוכן ${agent.name} · ${kind === "daily" ? `יומי ב-${hourUtc}:00 UTC` : `כל ${Math.round((everyMs || 0) / 60_000)} דקות`} · מקס ${s.maxPerDay}/יום · הפעימה הראשונה בקרוב`,
        meta: "{}",
      },
    });
    return ok({ schedule: s });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req: Request) {
  try {
    await requireOperator();
    const b = (await req.json()) as { id?: string; enabled?: boolean };
    if (!b.id || typeof b.enabled !== "boolean") throw new GateError("bad-input", "דרוש id + enabled");
    const s = await db.gateSchedule.update({ where: { id: b.id }, data: { enabled: b.enabled } });
    return ok({ schedule: s });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request) {
  try {
    await requireOperator();
    const id = new URL(req.url).searchParams.get("id");
    if (!id) throw new GateError("bad-input", "דרוש id");
    await db.gateSchedule.delete({ where: { id } });
    return ok({ deleted: id });
  } catch (e) {
    return fail(e);
  }
}
