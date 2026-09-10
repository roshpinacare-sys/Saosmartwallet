import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const agents = await (db as any).gateAgent.findMany({ where: { active: true } });
  for (const a of agents) {
    console.log(`AGENT ${a.name} | autonomy=${a.autonomy} | modules=${a.modules ? JSON.parse(a.modules).join(",") : "—"} | brain=${(a.brain || "—").slice(0, 60)}`);
  }
  const schedules = await (db as any).gateSchedule.findMany();
  for (const s of schedules) console.log(`SCHEDULE [${s.enabled ? "on" : "off"}] ${s.label} → ${s.agentName} | kind=${s.kind} everyMs=${s.everyMs} hourUtc=${s.hourUtc} budget=${s.budget} maxPerDay=${s.maxPerDay}`);
  const triggers = await (db as any).gateTrigger.findMany();
  for (const t of triggers) console.log(`TRIGGER [${t.enabled ? "on" : "off"}] on=${t.on} → ${t.agentName} | budget=${t.budget} cooldown=${t.cooldownMs} maxPerDay=${t.maxPerDay}`);
  const runs = await (db as any).gateRun.groupBy({ by: ["agentName", "status"], _count: true });
  console.log("RUNS:", JSON.stringify(runs.map((r: any) => `${r.agentName}:${r.status}=${r._count}`)));
  const acts = await (db as any).gateAction.groupBy({ by: ["action"], _count: true, orderBy: { _count: { action: "desc" } }, take: 15 });
  console.log("ACTIONS:", JSON.stringify(acts.map((a: any) => `${a.action}=${a._count}`)));
}
main().finally(() => process.exit(0));
