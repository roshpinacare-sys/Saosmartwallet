import { db } from "@/lib/db";
import { getSession, requireAgent } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import { GateError } from "@/lib/gate/crypto";
import { detectAndEmitMentions } from "@/lib/gate/harness/events";

export const runtime = "nodejs";

const TAKE = 200;

/** GET /api/gate/messages — feed (operator session or agent token). */
export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (session) {
      const messages = await db.gateMessage.findMany({ orderBy: { createdAt: "desc" }, take: TAKE });
      return ok({ messages: messages.reverse(), as: "operator" });
    }
    const agent = await requireAgent(req);
    const messages = await db.gateMessage.findMany({ orderBy: { createdAt: "desc" }, take: TAKE });
    return ok({ messages: messages.reverse(), as: "agent:" + agent.name });
  } catch (e) {
    return fail(e);
  }
}

/** POST /api/gate/messages — { body, channel? } as operator OR agent.
 *  An operator/agent message that mentions an autonomous agent (@name) is a
 *  real stimulus: the mention becomes a GateEvent the heart consumes into a
 *  bounded run (cooldown + daily cap). Autonomy that hears the bridge. */
export async function POST(req: Request) {
  try {
    const { body, channel } = await req.json();
    if (typeof body !== "string" || !body.trim()) throw new GateError("bad-input", "דרוש תוכן-הודעה");
    if (body.length > 4000) throw new GateError("too-long", "הודעה עד 4000 תווים");
    const session = await getSession();
    if (session) {
      const m = await db.gateMessage.create({
        data: { channel: channel || "command", fromKind: "operator", fromName: session.name, body: body.trim() },
      });
      const mentions = await detectAndEmitMentions(body.trim(), session.name, "operator");
      return ok({ message: m, mentions });
    }
    const agent = await requireAgent(req);
    const m = await db.gateMessage.create({
      data: { channel: channel || "command", fromKind: "agent", fromName: agent.name, body: body.trim() },
    });
    const mentions = await detectAndEmitMentions(body.trim(), agent.name, "agent");
    return ok({ message: m, mentions });
  } catch (e) {
    return fail(e);
  }
}
