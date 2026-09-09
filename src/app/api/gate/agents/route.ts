import { db } from "@/lib/db";
import { sha256hex, randomToken, GateError } from "@/lib/gate/crypto";
import { requireOperator, requireAgent } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";

export const runtime = "nodejs";

/** GET /api/gate/agents — operator: list attached agents. */
export async function GET(req: Request) {
  try {
    await requireOperator();
    const agents = await db.gateAgent.findMany({ orderBy: { createdAt: "desc" } });
    return ok({
      agents: agents.map((a) => ({
        id: a.id, name: a.name, memo: a.memo, active: a.active,
        createdAt: a.createdAt, lastSeenAt: a.lastSeenAt,
      })),
    });
  } catch (e) {
    return fail(e);
  }
}

/** POST /api/gate/agents — operator: attach a new agent. Token returned ONCE. */
export async function POST(req: Request) {
  try {
    await requireOperator();
    const { name, memo } = await req.json();
    if (typeof name !== "string" || !/^[a-zA-Z0-9_-]{2,32}$/.test(name))
      throw new GateError("bad-name", "שם-סוכן: 2–32 תווים של a-z 0-9 _ -");
    const token = randomToken(32);
    const agent = await db.gateAgent.create({
      data: { name, memo: memo || null, tokenHash: sha256hex(token) },
    });
    await db.gateMessage.create({
      data: { fromKind: "system", fromName: "gate", body: `סוכן חדש צורף: "${name}" — טוקן הונפק למפעיל פעם-אחת (מאוחסן כ-hash בלבד)` },
    });
    return ok({
      agent: { id: agent.id, name: agent.name, createdAt: agent.createdAt },
      token, // shown once — never stored, never returned again
      note: "שמור את הטוקן עכשיו — הוא לא יוצג שוב",
    });
  } catch (e) {
    return fail(e);
  }
}

/** DELETE /api/gate/agents?name=… — operator: revoke an agent. */
export async function DELETE(req: Request) {
  try {
    await requireOperator();
    const name = new URL(req.url).searchParams.get("name");
    if (!name) throw new GateError("bad-input", "דרוש ?name=");
    await db.gateAgent.updateMany({ where: { name }, data: { active: false } });
    await db.gateMessage.create({ data: { fromKind: "system", fromName: "gate", body: `סוכן "${name}" בוטל` } });
    return ok({ revoked: name });
  } catch (e) {
    return fail(e);
  }
}

/** Helper export used by messages route for agent identity. */
export { requireAgent };
