/** r20 probe — busy runs, vault litness, steemauto proposal, anchor history. */
export {};

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();

  const busy = await db.gateRun.findMany({
    where: { status: { in: ["queued", "running"] } },
    select: { id: true, agentName: true, goal: true, status: true, origin: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  console.log("BUSY RUNS:", JSON.stringify(busy, null, 1));

  const recent = await db.gateRun.findMany({
    where: { status: { in: ["done", "blocked", "failed"] } },
    select: { agentName: true, status: true, finishedAt: true },
    orderBy: { finishedAt: "desc" },
    take: 8,
  });
  console.log("RECENT RUNS:", JSON.stringify(recent));

  const steemauto = await db.gateProposal.findFirst({
    where: { goal: { contains: "steemauto" } },
    orderBy: { createdAt: "desc" },
  });
  console.log("STEEMAUTO PROPOSAL:", steemauto ? JSON.stringify({ id: steemauto.id, status: steemauto.status, decidedBy: steemauto.decidedBy, budget: steemauto.budget, kind: steemauto.kind, goal: steemauto.goal.slice(0, 120), createdAt: steemauto.createdAt }) : "none");

  const anchors = await db.gateAction.findMany({
    where: { action: { startsWith: "vault-anchor" } },
    select: { agentName: true, action: true, ok: true, result: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 6,
  });
  console.log("ANCHOR ACTIONS:", JSON.stringify(anchors, null, 1));

  const blurtHead = await db.vaultEntry.findFirst({ where: { kind: "steem-key", chain: "blurt", account: "headcorner", role: "posting" }, select: { id: true, pub: true, status: true, updatedAt: true } });
  console.log("BLURT HEADCORNER POSTING ROW:", JSON.stringify(blurtHead));

  const vaultCounts = {
    total: await db.vaultEntry.count(),
    verified: await db.vaultEntry.count({ where: { status: "verified" } }),
    rotatedOut: await db.vaultEntry.count({ where: { status: "rotated-out" } }),
  };
  console.log("VAULT:", JSON.stringify(vaultCounts));

  await db.$disconnect();
}
main().catch((e) => { console.error("FATAL:", (e as Error).message); process.exit(1); });
