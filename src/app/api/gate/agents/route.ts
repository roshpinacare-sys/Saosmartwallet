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
        modules: a.modules ? (JSON.parse(a.modules) as string[]) : [],
        brain: a.brain,
        autonomy: a.autonomy,
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
    const { name, memo, modules, brain } = await req.json();
    if (typeof name !== "string" || !/^[a-zA-Z0-9_-]{2,32}$/.test(name))
      throw new GateError("bad-name", "שם-סוכן: 2–32 תווים של a-z 0-9 _ -");
    const token = randomToken(32);
    const agent = await db.gateAgent.create({
      data: {
        name,
        memo: memo || null,
        tokenHash: sha256hex(token),
        // armed at birth — the armory module-ids + brain spec (validated there)
        modules: Array.isArray(modules) && modules.length ? JSON.stringify(modules.filter((m: unknown) => typeof m === "string")) : null,
        brain: typeof brain === "string" && brain ? brain : null,
      },
    });
    const armedCount = Array.isArray(modules) ? modules.length : 0;
    await db.gateMessage.create({
      data: { fromKind: "system", fromName: "gate", body: `סוכן חדש צורף: "${name}"${armedCount ? ` — חמוש ב-${armedCount} מודולים` : ""} — טוקן הונפק למפעיל פעם-אחת (מאוחסן כ-hash בלבד)` },
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

/** PATCH /api/gate/agents — operator: re-arm an existing agent (modules + brain). */
export async function PATCH(req: Request) {
  try {
    await requireOperator();
    const { name, modules, brain, autonomy } = await req.json();
    if (typeof name !== "string" || !name) throw new GateError("bad-input", "דרוש name");
    const data: { modules?: string | null; brain?: string | null; autonomy?: boolean } = {};
    if (Array.isArray(modules)) data.modules = JSON.stringify(modules.filter((m: unknown) => typeof m === "string"));
    if (typeof brain === "string") data.brain = brain || null;
    if (typeof autonomy === "boolean") data.autonomy = autonomy;
    if (!("modules" in data) && !("brain" in data) && !("autonomy" in data)) throw new GateError("bad-input", "אין מה לעדכן — דרוש modules או brain או autonomy");
    const res = await db.gateAgent.updateMany({ where: { name }, data });
    if (!res.count) throw new GateError("bad-agent", "אין סוכן כזה");
    await db.gateMessage.create({
      data: { fromKind: "system", fromName: "gate", body: `סוכן "${name}" עודכן: ${data.modules ? JSON.parse(data.modules).length + " מודולים" : "modules ללא-שינוי"}${data.brain ? ` · מוח ${data.brain}` : ""}${data.autonomy !== undefined ? ` · אוטונומיה ${data.autonomy ? "הופעלה" : "כובתה"}` : ""}` },
    });
    return ok({ armed: name, modules: data.modules ? JSON.parse(data.modules) : undefined, brain: data.brain ?? undefined });
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
