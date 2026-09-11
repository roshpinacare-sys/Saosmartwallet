/**
 * r35 — חוזי-אמת למשמרות-השומר: רשת-כבויה היא ממצא-כנה, לא פער
 *
 * המצב שנמדד (2026-09-11T22:15Z):
 *  · 10 משמרות "סיור-שומר יומי" חולקות חוזה שדורש "וכל חריגה נבדקה".
 *  · Blurt (ו-TRX במסילת-סריקה) כבויות מזה-ימים — הבודק העצמאי (כנה!) מציין
 *    "בדיקת חריגה ב-Blurt (offline) לא בוצעה" → פסיקת blocked על מציאות
 *    סביבתית שאינה ניתנת-לשינוי בידי הסוכן. שתי-הפסיקות האחרונות (21Z) כאלה.
 *  · זה עיוורון-חיתוך בהיפוך: הבודק רואה-הכל — החוזה שמבטיח את-הבלתי-אפשרי.
 *
 * המהלך: החוזה מתוקן לאמת — "חריגה נבדקה או הוכחה-כבלתי-ניתנת-לבדיקה
 * (reachable:false שנמדד = ממצא-כנה לדווח, לא פער)". שער-האיכות נשאר
 * מהודק: הסוכן חייב להוכיח את המדידה, לא להצהיר.
 */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

const OLD_CLAUSE = "וכל חריגה נבדקה";
const NEW_CLAUSE =
  "וכל חריגה נבדקה או הוכחה-כבלתי-ניתנת-לבדיקה (רשת-כבויה שנמדדה reachable:false ב-net.health היא ממצא-כנה לדווח — לא פער)";
const GOAL_ADDENDUM = " רשת-כבויה שנמדדה אינה פער — הוכח את המדידה והמשך.";

async function main() {
  const rows = await db.$queryRawUnsafe<Array<{ id: string; agentName: string; hourUtc: number | null; goal: string; doneMeans: string }>>(
    `SELECT id, agentName, hourUtc, goal, doneMeans FROM GateSchedule WHERE goal LIKE '%סיור-שומר יומי%' ORDER BY agentName, hourUtc`,
  );
  let updated = 0;
  for (const r of rows) {
    const means: string[] = JSON.parse(r.doneMeans);
    const fixed = means.map((m) => (m.includes(OLD_CLAUSE) ? m.replace(OLD_CLAUSE, NEW_CLAUSE) : m));
    const goalFixed = r.goal.includes("רשת-כבויה שנמדדה") ? r.goal : r.goal + GOAL_ADDENDUM;
    if (JSON.stringify(fixed) === r.doneMeans && goalFixed === r.goal) {
      console.log(`  כבר-כן: ${r.agentName} ${r.hourUtc}Z`);
      continue;
    }
    await db.$executeRawUnsafe(`UPDATE GateSchedule SET doneMeans = ?, goal = ? WHERE id = ?`, JSON.stringify(fixed), goalFixed, r.id);
    console.log(`  תוקן: ${r.agentName} ${r.hourUtc}Z — חוזה-אמת נחרת`);
    updated++;
  }
  console.log(`סה"כ: ${updated}/${rows.length} משמרות-שומר עודכנו`);
}

main().finally(() => db.$disconnect());
