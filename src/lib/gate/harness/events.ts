/**
 * SOVEREIGN GATE — autonomy events (עצב-המערכת).
 *
 * Pattern source: the steem agent army's commandBus/chaintalk + the workspace
 * Trust-Control-Plane's transactional outbox. Events are stimuli written FIRST
 * (at-least-once) and consumed by the Gate Heart's beat into bounded trigger
 * fires. Nothing reacts inline — reaction is the heart's job, so a dead
 * consumer loses nothing and a slow consumer retries safely.
 */
import { db } from "@/lib/db";

export type GateEventType =
  | "message.mentions" // operator/agent addressed an agent in the bridge — payload {agent, body, by}
  | "run.blocked" // a run finished blocked — payload {agent, goal, gaps}
  | "run.ungraded" // r28: the checker never answered (429/JSON silence ×2) — real gaps unproven, NO repair chase fires on this
  | "run.failed" // a run crashed — payload {agent, goal, gaps:""}
  | "run.done" // a run passed the gate — payload {agent, goal}
  | "market.move" // the heart watched the real DEX price cross a threshold — payload {price, prev, pct}
  | "rotation"; // the sovereign account_update plane moved (or imported) keys — payload {kind, account?, txId?, sealed?}

/** Write one stimulus. Never throws — an event must never break its emitter. */
export async function emitEvent(type: GateEventType, payload: Record<string, unknown>, source: string): Promise<void> {
  try {
    await db.gateEvent.create({
      data: {
        type,
        payload: JSON.stringify(payload || {}).slice(0, 4000),
        source: String(source || "system").slice(0, 40),
      },
    });
  } catch { /* the heart re-derives what matters; events are best-effort stimuli */ }
}

/** Detect @agent mentions in a bridge message and emit events for each (bounded by real agent names). */
export async function detectAndEmitMentions(body: string, fromName: string, fromKind: string): Promise<number> {
  try {
    const agents = await db.gateAgent.findMany({ where: { active: true, autonomy: true }, select: { name: true } });
    const lowered = String(body || "").toLowerCase();
    let n = 0;
    for (const a of agents) {
      if (a.name === fromName) continue;
      if (lowered.includes("@" + a.name.toLowerCase())) {
        await emitEvent("message.mentions", { agent: a.name, body: String(body).slice(0, 800), by: fromName }, fromKind);
        n++;
      }
    }
    return n;
  } catch { return 0; }
}
