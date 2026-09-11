/** r20 — arm the anchor plane: anchor-agent gets anchor.integrity + anchor.seal. */
export {};
async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  const NEW = ["anchor.integrity", "anchor.seal"];
  const agent = await db.gateAgent.findFirst({ where: { name: "anchor-agent" } });
  if (!agent) { console.log("no anchor-agent"); process.exit(1); }
  const cur = (() => { try { return JSON.parse(agent.modules || "[]") as string[]; } catch { return []; } })();
  const merged = [...new Set([...cur, ...NEW])];
  await db.gateAgent.update({ where: { id: agent.id }, data: { modules: JSON.stringify(merged) } });
  console.log(`anchor-agent armed: ${cur.length} → ${merged.length} (${NEW.join(", ")} ${NEW.every((n) => cur.includes(n)) ? "already" : "added"})`);
  await db.$disconnect();
  process.exit(0);
}
main().catch((e) => { console.error("FATAL:", (e as Error).message); process.exit(1); });
