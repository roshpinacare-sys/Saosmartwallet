/** ROAST r5 — heart truth: schedules firing on time + recent run outcomes. */
import { db } from "../src/lib/db";

async function main() {
  const now = new Date();
  console.log(`now=${now.toISOString()}`);
  const scheds = await db.gateSchedule.findMany();
  for (const s of scheds) {
    const lr = s.lastRunAt?.toISOString() ?? "never";
    const ageH = s.lastRunAt ? ((now.getTime() - s.lastRunAt.getTime()) / 3_600_000).toFixed(1) : "-";
    console.log(`  [${s.kind}] hourUtc=${(s as unknown as { hourUtc?: number }).hourUtc ?? "-"} lastRun=${lr} (${ageH}h ago)`);
  }
  const runs = await db.gateRun.findMany({ orderBy: { createdAt: "desc" }, take: 10 });
  console.log("recent runs:");
  for (const r of runs) {
    const dur = r.finishedAt ? Math.round((r.finishedAt.getTime() - r.createdAt.getTime()) / 1000) + "s" : "running";
    console.log(`  [${r.status}] ${r.origin} ${r.agentName} ${r.createdAt.toISOString()} dur=${dur} modules=${(r.modules ?? "").slice(0, 60)}`);
  }
  const byStatus = await db.gateRun.groupBy({ by: ["status"], _count: { _all: true } });
  console.log("runs by status:", byStatus.map((g) => `${g.status}=${g._count._all}`).join(", "));
  await db.$disconnect();
}

main().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
