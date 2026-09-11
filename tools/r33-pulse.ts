/**
 * r33 — הוכחה-חיה: הפעימה חוזרת-הביתה (הפקודה-האחת, h19 תוכנית סעיף 4).
 *
 * דוחף ריצה אחת עם anchor.seal (מודול-הפעימה המשודרג r33) ישר-ל-db — הלב
 * החי חוטף ומריץ בתוך-התהליך (הכספת פתוחה אצל-המפעיל). לאחר-מכן סוקר את
 * שורות-ה-audit (pulse:* ) ומדפיס את המטריצה בכנות: כל-מסילה, עוגן-חי או
 * שער-כן עם-המספרים.
 * אפס-סודות בקוד ובפלט: רק txid/סלוט/שערים.
 */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  const agent = await db.gateAgent.findUnique({ where: { name: "vault-rider" } });
  if (!agent) throw new Error("missing agent vault-rider");

  const run = await db.gateRun.create({
    data: {
      agentName: agent.name,
      goal: "הפעל את מודול anchor.seal — פעימה ריבונית r33: איטום הדיגסט על כל המסילות (graphene + SOLANA memo + ETHEREUM value-encoding + TRON סריקה-כנה). הצג את המטריצה המלאה.",
      doneMeans: "מטריצת-מסילות מלאה — כל מסילה עוגן-חי או שער-כן עם סיבה; אפס-סודות בדוח",
      modules: JSON.stringify(["anchor.seal"]),
      brain: "zai:default",
      checker: "nvidia:openai/gpt-oss-20b",
      budget: 5,
      status: "queued",
      origin: "manual",
      meta: JSON.stringify({ r33: "pulse-comes-home", brainNote: "הפעימה עצמה נעשית בתוך-התהליך על-ידי המודול; המוח רק מדווח" }),
    },
  });
  console.log(`queued pulse run → ${run.id}`);

  // poll: the run itself, then the pulse:cycle audit row
  const deadline = Date.now() + 8 * 60_000;
  let finished = false;
  while (Date.now() < deadline && !finished) {
    await new Promise((r) => setTimeout(r, 10_000));
    const r = await db.gateRun.findUnique({ where: { id: run.id } });
    if (r && !["queued", "running"].includes(r.status)) finished = true;
  }
  const r = await db.gateRun.findUnique({ where: { id: run.id } });
  if (!r) throw new Error("run vanished");
  console.log(`run ${r.status} · ${((r.durationMs || 0) / 1000).toFixed(1)}s`);
  console.log(`report: ${(r.report || r.error || "(none)").slice(-500).replace(/\n/g, " | ")}`);

  // the pulse matrix from the audit trail
  const acts = await db.gateAction.findMany({
    where: { action: { startsWith: "pulse:" }, createdAt: { gte: new Date(Date.now() - 15 * 60_000) } },
    orderBy: { createdAt: "asc" },
  });
  console.log("\n=== r33 PULSE MATRIX (audit trail, last 15min) ===");
  for (const a of acts) {
    let res: Record<string, unknown> = {};
    try { res = JSON.parse(a.result || "{}") as Record<string, unknown>; } catch { /* honest */ }
    const rail = a.action.replace("pulse:", "");
    if (rail === "cycle") {
      console.log(`CYCLE round=${res.round} landed=${res.landed}/${res.total} ok=${a.ok}`);
      continue;
    }
    const tx = res.sig || res.hash || "(none)";
    const h = res.slot ?? res.blockNum ?? "—";
    console.log(`${rail.padEnd(9)} ok=${String(a.ok).padEnd(5)} tx=${String(tx).slice(0, 20)} height=${h}${res.error ? ` · gate: ${String(res.error).slice(0, 120)}` : ""}`);
  }
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
