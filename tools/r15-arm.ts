/**
 * r15 — arm the fleet for network-presence employment:
 *   1. Arm the six new modules on every active agent (idempotent — merges
 *      into the agent's existing armed set, never shrinks it).
 *   2. Create the recurring employment schedules (idempotent by label):
 *      chain-pulse interval probe, daily presence census, daily echo
 *      measurement, daily governance scan, daily imported-rescan.
 * Every row it creates is printed with its id so the worklog can anchor it.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const NEW_MODULES = [
  "chain.pulse",        // dual-sample block-production proof on steem/hive/blurt
  "fleet.presence",     // 12-account census across the three rails
  "social.engagement",  // echo measurement: votes/comments on our recent posts
  "governance.scan",    // witness votes / proxies / silent accounts
  "vault.rescan",       // honest imported-backlog closer (honest when sealed)
  "schedule.propose",   // agents design their own recurring employment (operator-gated)
];

const AGENTS = ["anchor-agent", "zai-code", "verifier-agent", "ui-test-agent", "harness-rider"];

interface SchedSpec {
  label: string; agentName: string; kind: "interval" | "daily";
  everyMs?: number; hourUtc?: number; budget: number; maxPerDay: number;
  goal: string; doneMeans: string[];
}

const SCHEDULES: SchedSpec[] = [
  {
    label: "דופק-שרשראות כפול",
    agentName: "verifier-agent",
    kind: "interval",
    everyMs: 4 * 60 * 60_000,
    budget: 2,
    maxPerDay: 6,
    goal: "סיור-דופק מתוכנן: הפעל chain.pulse והוכח מכנית (דגימה-כפולה) אילו מסילות steem/hive/blurt מייצרות בלוקים עכשיו. דווח לגשר בעברית בשורה-אחת עם המספרים שנמדדו.",
    doneMeans: [
      "chain.pulse הופעל והחזיר headBefore/headAfter לכל מסילה שנענתה",
      "שורת-דיווח עברית לגשר עם הדלתאות שנמדדו",
    ],
  },
  {
    label: "נוכחות-הרשת היומית",
    agentName: "zai-code",
    kind: "daily",
    hourUtc: 7,
    budget: 3,
    maxPerDay: 1,
    goal: "מפקד-נוכחות יומי: הפעל fleet.presence — ספירה חיה של 12 חשבונות-הצי על steem/hive/blurt (פוסטים, עוקבים, יתרות). זהה חשבונות-רדומים ומסילות-חסרות, ודווח לגשר בעברית.",
    doneMeans: [
      "fleet.presence הופעל והחזיר ספירת-חשבונות לכל מסילה",
      "שורת-דיווח עברית לגשר עם מספרים חיים (כמה חשבונות באיזו מסילה)",
    ],
  },
  {
    label: "מדידת-הד היומית",
    agentName: "ui-test-agent",
    kind: "daily",
    hourUtc: 18,
    budget: 3,
    maxPerDay: 1,
    goal: "מדידת-הד יומית: הפעל social.engagement ומדוד האם הפוסטים-האחרונים של המפקד על שלוש-המסילות מקבלים הצבעות ותגובות אמיתיות. אפס-הד הוא ממצא-כן — דווח עליו בכנות.",
    doneMeans: [
      "social.engagement הופעל ומדד הצבעות/תגובות לפוסטים-האחרונים",
      "שורת-דיווח עברית לגשר עם המדידות (כולל אפסים-כנים)",
    ],
  },
  {
    label: "סריקת-ממשל היומית",
    agentName: "zai-code",
    kind: "daily",
    hourUtc: 16,
    budget: 2,
    maxPerDay: 1,
    goal: "סריקת-ממשל יומית: הפעל governance.scan ומפה את טביעת-הרגל-הממשלתית של הצי — למי מצביעים-עדים, מי מאציל נציגות, ומי ממשיל-בשתיקה. דווח לגשר בעברית.",
    doneMeans: [
      "governance.scan הופעל והחזיר ספירת-מצביעים/נציגויות/שותקים לכל מסילה",
      "שורת-דיווח עברית לגשר עם הממצא",
    ],
  },
  {
    label: "סריקת-יבוא היומית",
    agentName: "verifier-agent",
    kind: "daily",
    hourUtc: 19,
    budget: 3,
    maxPerDay: 1,
    goal: "סגירת-תיק יומית: הפעל vault.rescan — סרוק את כניסות-הכספת שעדיין 'imported' מול השרשרת עצמה. כספת-חתומה היא תשובה-כנה (לא כשל) — דווח מה נסרק, מה הוכח-חי, ומה נשאר.",
    doneMeans: [
      "vault.rescan הופעל והחזיר תשובה כנה (תוצאות-סריקה או כספת-חתומה)",
      "שורת-דיווח עברית לגשר עם המספרים (נסרקו/הוכחו/נכשלו/נשארו)",
    ],
  },
];

async function main() {
  console.log("=== 1. ARM MODULES ===");
  for (const name of AGENTS) {
    const a = await db.gateAgent.findFirst({ where: { name, active: true } });
    if (!a) { console.log(`· ${name}: לא נמצא/לא פעיל — דילוג`); continue; }
    let armed: string[] = [];
    try { armed = JSON.parse(a.modules || "[]"); if (!Array.isArray(armed)) armed = []; } catch { armed = []; }
    const added = NEW_MODULES.filter((m) => !armed.includes(m));
    if (!added.length) { console.log(`· ${name}: כבר חמוש בכל ${NEW_MODULES.length} — ללא שינוי`); continue; }
    const next = [...armed, ...added];
    await db.gateAgent.update({ where: { id: a.id }, data: { modules: JSON.stringify(next) } });
    console.log(`· ${name}: +${added.length} מודולים (${added.join(", ")}) — סה"כ חמוש: ${next.length}`);
  }

  console.log("\n=== 2. EMPLOYMENT SCHEDULES ===");
  for (const s of SCHEDULES) {
    const dup = await db.gateSchedule.findFirst({ where: { label: s.label } });
    if (dup) { console.log(`· ${s.label}: קיים (id=${dup.id}) — ללא שינוי`); continue; }
    const next =
      s.kind === "daily"
        ? (() => { const d = new Date(); d.setUTCHours(s.hourUtc!, 0, 0, 0); if (d.getTime() <= Date.now()) d.setUTCDate(d.getUTCDate() + 1); return d; })()
        : new Date(Date.now() + s.everyMs!);
    const row = await db.gateSchedule.create({
      data: {
        label: s.label, agentName: s.agentName, goal: s.goal,
        doneMeans: JSON.stringify(s.doneMeans),
        modules: null, // the agent's armed set rules
        brain: null, budget: s.budget, kind: s.kind,
        everyMs: s.kind === "interval" ? s.everyMs! : null,
        hourUtc: s.kind === "daily" ? s.hourUtc! : null,
        maxPerDay: s.maxPerDay, enabled: true, nextRunAt: next,
      },
    });
    console.log(`· ${s.label} → ${s.agentName} (${s.kind}${s.kind === "daily" ? ` @ ${s.hourUtc}:00 UTC` : ` every ${(s.everyMs! / 3_600_000)}h`}) id=${row.id} next=${next.toISOString()}`);
  }

  console.log("\n=== 3. STATE ===");
  const total = await db.gateSchedule.count({ where: { enabled: true } });
  console.log(`סה"כ סיורים פעילים: ${total}`);
}

main().finally(() => db.$disconnect());
