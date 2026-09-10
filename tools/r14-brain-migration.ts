/**
 * r14 — fleet brain migration, driven by measured truth:
 * BY-BRAIN run history: nvidia:openai/gpt-oss-20b → 37 done / 2 failed (~63% success);
 * zai:default → 10 done / 18 failed (~20%) — the zai shared sandbox quota dies
 * on sustained 429 windows mid-run (r7/r8 documented; re-proven today by the
 * anchor-agent editor shift dying five times in one afternoon).
 * The four zai-brained agents migrate to the PROVEN nvidia maker brain.
 * The checker stays zai:default (cross-provider separation, 1 call/run —
 * sustainable on the scarce quota) via pickCheckerBrain at enqueue time.
 */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  const before = await db.gateRun.groupBy({ by: ["brain", "status"], _count: true });
  console.log("BEFORE:", JSON.stringify(before.map((b: any) => `${b.brain || "null"}:${b.status}=${b._count}`)));

  const r = await db.gateAgent.updateMany({
    where: { active: true, OR: [{ brain: null }, { brain: "zai:default" }, { brain: "" }] },
    data: { brain: "nvidia:openai/gpt-oss-20b" },
  });
  console.log(`migrated ${r.count} agents → nvidia:openai/gpt-oss-20b`);

  const agents = await db.gateAgent.findMany({ where: { active: true }, select: { name: true, brain: true } });
  for (const a of agents) console.log(`AGENT ${a.name} → ${a.brain || "null"}`);
}
main().finally(() => process.exit(0));
