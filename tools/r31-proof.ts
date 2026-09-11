/**
 * r31 — הוכחה-חיה לצי-מסביב-לשעון (סבב-ב, אחרי-הריסטארט):
 * חלון-חתום (הכספת-כבויה אחרי-הריסטארט — הדלקה-מחדש היא-הכניסה-עם-המפתח של
 * המפעיל, ולא-שלנו): ההוכחה-המיידית היא על-משימות-הקריאה המקומיות —
 * vault-rider (המטרה-עצמה-מלמדת-את-מסלול-הכנות-בחלון-חתום) ו-door-diplomat
 * (fleet.digest+memory.write+דוח — כולם-קריאות-מקומיות). המוח-יורד-ל-zai
 * לפי-דוקטרינת-r27 (בלי-מפתח-NIM-חי ובלי-מפתח-סביבה) עם-brainNote-כנה,
 * והבודק-העצמאי נופל-בשרשרת-r18 ל-zai-בכנות. scribe-agent ו-ui-verify:
 * ui-verify הוכיח-את-עצמו-חי-כבר (done, בודק-עבר, על-nvidia); משמרת-התוכן
 * של-הסופר תוכיח-את-עצמו-במשמרת-הלילה 03:00Z (או-תדחה-בכנות על-ידי
 * שער-הכספת כל-עוד-החלון-חתום — זו-בעצמה-הוכחת-ההלכה).
 * ההרצות-נכנסות-כזוג (כמו-הלב: 2-מקבילות, מטרה-אחת-לסוכן) והלב-החי-חוטף-אותן.
 */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

const PAIR = [
  {
    agent: "vault-rider",
    label: "סיור-כספת לילי",
    modules: ["vault.stats", "vault.map", "fleet.status", "chat.report"],
  },
  {
    agent: "door-diplomat",
    label: "סיור-דלת לילי",
    modules: ["fleet.digest", "web.read", "memory.write", "chat.report"],
  },
];

async function main() {
  const ids: string[] = [];
  for (const p of PAIR) {
    const sched = await db.gateSchedule.findFirst({ where: { label: p.label } });
    const agent = await db.gateAgent.findUnique({ where: { name: p.agent } });
    if (!sched || !agent) throw new Error(`missing ${p.agent}/${p.label}`);
    const goal = sched.goal;
    const run = await db.gateRun.create({
      data: {
        agentName: agent.name,
        goal,
        doneMeans: sched.doneMeans,
        modules: JSON.stringify(p.modules),
        brain: "zai:default",
        checker: "nvidia:openai/gpt-oss-20b", // הפרדת-מייצר/בודק; קריאת-nvidia נופלת-ל-zai בכנות (r18)
        budget: sched.budget,
        status: "queued",
        origin: "manual",
        meta: JSON.stringify({ r31: "provisioning-proof-b", schedule: p.label, brainNote: "חלון-חתום — המוח הוחלף ל-zai לפי דוקטרינת-r27 (אף מפתח-סביבה)" }),
      },
    });
    ids.push(run.id);
    console.log(`queued ${p.agent} (budget ${sched.budget}, brain zai-fallback) → ${run.id}`);
  }
  // poll the DB directly — the live heart claims and runs them
  const deadline = Date.now() + 9 * 60_000;
  const done: Record<string, { status: string; report: string; verdict: string; dur: string }> = {};
  while (Date.now() < deadline && Object.keys(done).length < ids.length) {
    await new Promise((r) => setTimeout(r, 15_000));
    for (const id of ids) {
      if (done[id]) continue;
      const r = await db.gateRun.findUnique({ where: { id } });
      if (!r || ["queued", "running"].includes(r.status)) continue;
      let verdictNote = "";
      try { const v = JSON.parse(r.verdict || "null"); verdictNote = v ? `done=${v.done} rescues=${v.rescues ?? 0}` : "verdict=null"; } catch { verdictNote = "verdict=unparsable"; }
      done[id] = { status: r.status, report: (r.report || r.error || "").slice(-220), verdict: verdictNote, dur: `${((r.durationMs || 0) / 1000).toFixed(1)}s` };
    }
  }
  console.log("\n=== r31 PROOF (sealed window) ===");
  for (const id of ids) {
    const d = done[id];
    if (!d) { console.log(`${id}: TIMEOUT — still open, checking status…`); continue; }
    console.log(`${d.status} · ${d.verdict} · ${d.dur}\n  ${d.report.replace(/\n/g, " | ")}`);
  }
  await db.$disconnect();
}
main();
