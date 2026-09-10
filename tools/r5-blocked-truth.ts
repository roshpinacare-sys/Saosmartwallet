/** ROAST r5 — why were the last harness-rider runs blocked? */
import { db } from "../src/lib/db";

async function main() {
  const runs = await db.gateRun.findMany({
    where: { status: "blocked" },
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  for (const r of runs) {
    console.log(`── blocked run ${r.id} @ ${r.createdAt.toISOString()} origin=${r.origin} agent=${r.agentName}`);
    console.log("  goal:", r.goal.slice(0, 160));
    console.log("  meta:", (r.meta ?? "").slice(0, 300));
  }
  // the messages the checker/report produced around the last blocked run
  const msgs = await db.gateMessage.findMany({ orderBy: { createdAt: "desc" }, take: 12 });
  for (const m of msgs) {
    console.log(`msg[${m.fromKind}/${m.fromName}] ${m.createdAt.toISOString()} :: ${m.body.slice(0, 150).replace(/\n/g, " | ")}`);
  }
  await db.$disconnect();
}

main().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
