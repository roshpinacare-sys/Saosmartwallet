import { db } from "@/lib/db";
import { requireOperator } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import { GateError } from "@/lib/gate/crypto";
import { launchProposal, readProposalPolicy, writeProposalPolicy } from "@/lib/gate/harness/heart";

export const runtime = "nodejs";

/**
 * GET /api/gate/proposals — the goal-initiative queue (operator view):
 * every proposal an agent made, the bounded policy, and the run lineage
 * (runId) for everything already launched.
 */
export async function GET() {
  try {
    await requireOperator();
    const [rows, policy] = await Promise.all([
      db.gateProposal.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
      readProposalPolicy(),
    ]);
    return ok({ proposals: rows, policy });
  } catch (e) {
    return fail(e);
  }
}

/**
 * PATCH /api/gate/proposals — the operator's verdict on a pending proposal:
 *   { id, decision: "approve" } → launches a real run (origin=proposal)
 *   { id, decision: "reject"  } → rejected honestly, visible in the bridge
 */
export async function PATCH(req: Request) {
  try {
    await requireOperator();
    const body = (await req.json()) as { id?: string; decision?: string };
    const id = String(body.id || "");
    const decision = String(body.decision || "");
    if (!id || !["approve", "reject"].includes(decision))
      throw new GateError("bad-input", "דרוש id + decision (approve|reject)");
    const p = await db.gateProposal.findUnique({ where: { id } });
    if (!p) throw new GateError("no-proposal", "אין הצעה כזו");
    if (p.status !== "pending") throw new GateError("already-decided", `ההצעה כבר הוכרעה (${p.status})`);
    if (decision === "reject") {
      await db.gateProposal.update({
        where: { id },
        data: { status: "rejected", decidedBy: "operator", decidedAt: new Date() },
      });
      await db.gateMessage
        .create({
          data: {
            channel: "command",
            fromKind: "system",
            fromName: "harness",
            body: `❌ הצעת-היעד של ${p.agentName} נדחתה על-ידי המפעיל: "${p.goal.slice(0, 140)}"`,
            meta: JSON.stringify({ proposalId: id }),
          },
        })
        .catch(() => {});
      return ok({ status: "rejected" });
    }
    const runId = await launchProposal(id, "operator");
    return ok({ status: "launched", runId });
  } catch (e) {
    return fail(e);
  }
}

/**
 * PUT /api/gate/proposals — set the bounded initiative policy:
 *   { autoApprove: boolean, maxAutoPerDay: 1-12, maxBudget: 2-8 }
 * autoApprove=false → every proposal waits for an explicit operator decision.
 */
export async function PUT(req: Request) {
  try {
    await requireOperator();
    const body = (await req.json()) as { autoApprove?: boolean; maxAutoPerDay?: number; maxBudget?: number };
    const policy = {
      autoApprove: body.autoApprove === true,
      maxAutoPerDay: Math.min(Math.max(Number(body.maxAutoPerDay) || 2, 1), 12),
      maxBudget: Math.min(Math.max(Number(body.maxBudget) || 4, 2), 8),
    };
    await writeProposalPolicy(policy);
    await db.gateMessage
      .create({
        data: {
          channel: "command",
          fromKind: "system",
          fromName: "harness",
          body: policy.autoApprove
            ? `💡 מדיניות-יוזמות עודכנה: אישור-אוטומטי מרוסן — מקס ${policy.maxAutoPerDay} הצעות/יום לכל הצי, תקציב עד ${policy.maxBudget} צעדים; יוזמות חורגות ממתינות למפעיל`
            : "🛑 מדיניות-יוזמות עודכנה: הצעות ממתינות לאישור-מפעיל בלבד — לא תקום יוזמה אוטומטית",
          meta: "{}",
        },
      })
      .catch(() => {});
    return ok({ policy });
  } catch (e) {
    return fail(e);
  }
}
