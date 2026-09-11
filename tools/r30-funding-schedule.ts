/** r30 — לוח-זמנים קבוע: צפייה-יומית בכתובת-המימון (create-or-update לפי-תווית) */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

const LABEL = "צפייה-בכתובת-המימון היומית";
const GOAL = `תור-צופה-המימון היומי (r30, מסלול-יחיד): אתה עיני-הכספת על נקודת-הנחיתה של הכסף — פעולה אחת בכל צעד, אין לולאות. (1) הפעל chain.funding (בלי-פרמטרים — הכתובת המפורסמת כבר-מוגדרת) וקבל צנזורה-חיה של כתובת-המימון על 8 רשתות-EVM. (2) שורת-דיווח אחת בעברית לגשר: כמה רשתות נמדדו, לאילו יש יתרה (עם המספרים) ואילו ריקות, ואם יש יתרה-חדשה יחסית לריקנות-הבזלית (mainnet 0.000334 · BSC 0.000006 · שאר ריקות ב-2026-09-11T05:39Z) — סמן "כסף-נחת?" במפורש. גבול-ריבונות: הכתובת שייכת למישור-הפלטפורמה — צפייה-בלבד, אף-הצהרה על בעלות, אף-פעולה.`;
const DONE_MEANS = [
  "chain.funding הופעל והחזיר צנזורה-חיה (reachable/total) — ראייה: צעד chain.funding עם ok=true",
  "שורת-דיווח עברית לגשר עם המספרים-החיים: רשתות-נמדדו · יתרות-לא-אפס · ריקות",
  "סימון-כנה אם כסף-נחת מול-הבזלית המתועדת במטרה, או ״אין-שינוי״ — אפסים-כנים הם-גם-דיווח",
  "אין-טענת-בעלות ואין-פעולה-על-הכתובת — הגבול-הריבוני נשמר (צפייה-בלבד)",
];

async function main() {
  const now = Date.now();
  const win = new Date();
  win.setUTCHours(14, 0, 0, 0);
  if (win.getTime() <= now) win.setTime(win.getTime() + 86_400_000); // next 14:00Z
  const existing = await db.$queryRawUnsafe<any[]>(`SELECT id FROM GateSchedule WHERE label = ?`, LABEL);
  if (existing.length) {
    await db.$executeRawUnsafe(
      `UPDATE GateSchedule SET goal = ?, doneMeans = ?, modules = ?, budget = 2, enabled = 1, nextRunAt = ? WHERE id = ?`,
      GOAL, JSON.stringify(DONE_MEANS), JSON.stringify(["chain.funding", "chat.report"]), new Date(win), existing[0].id
    );
    console.log(`updated existing schedule ${existing[0].id} → next=${win.toISOString()}`);
  } else {
    const id = `cmtwfund${Math.random().toString(36).slice(2, 10)}`.slice(0, 25);
    await db.$executeRawUnsafe(
      `INSERT INTO GateSchedule (id, label, agentName, goal, doneMeans, modules, brain, budget, kind, everyMs, hourUtc, maxPerDay, dayCount, dayKey, enabled, lastRunAt, nextRunAt, createdAt) VALUES (?, ?, ?, ?, ?, ?, NULL, 2, 'daily', NULL, 14, 1, 0, NULL, 1, NULL, ?, ?)`,
      id, LABEL, "verifier-agent", GOAL, JSON.stringify(DONE_MEANS), JSON.stringify(["chain.funding", "chat.report"]), new Date(win), new Date(now)
    );
    console.log(`created schedule ${id} → next=${win.toISOString()}`);
  }
  const check = await db.$queryRawUnsafe<any[]>(`SELECT label, agentName, budget, enabled, hourUtc, substr(nextRunAt,1,16) as next FROM GateSchedule WHERE label = ?`, LABEL);
  console.log(JSON.stringify(check[0]));
}
main().finally(() => db.$disconnect());
