import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const failed = await (db as any).gateRun.findMany({
    where: { status: { in: ["failed", "blocked"] }, agentName: { in: ["anchor-agent", "zai-code", "verifier-agent", "ui-test-agent"] } },
    orderBy: { createdAt: "desc" }, take: 8,
  });
  for (const r of failed) {
    console.log(`=== ${r.agentName} [${r.status}] ${r.createdAt.toISOString()} brain=${r.brain || "null"} budget=${r.budget} attempt=${r.attempt} origin=${r.origin}`);
    console.log(`  goal: ${r.goal.slice(0, 100)}`);
    console.log(`  error: ${(r.error || "—").slice(0, 200)}`);
    console.log(`  report: ${(r.report || "—").slice(0, 200)}`);
  }
  // brain usage stats for all runs
  const byBrain = await (db as any).gateRun.groupBy({ by: ["brain", "status"], _count: true });
  console.log("BY-BRAIN:", JSON.stringify(byBrain.map((b: any) => `${b.brain || "null"}:${b.status}=${b._count}`)));
}
main().finally(() => process.exit(0));
