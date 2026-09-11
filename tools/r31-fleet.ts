/**
 * r31 — חיזוק-האוטונומיה והריבונות: הצי מסביב-לשעון (create-or-update, כמו r30)
 *
 * המצב שנמדד (2026-09-11T06:30Z):
 *  · 7 סוכנים — 5 פעילים-עם-מוח, 2 ישנים-מאז-הקמתם (ui-verify, vault-rider: active:false,
 *    אפס-מודולים, אפס-מוח — תבניות-בדיקה מ-2026-09-09 שמעולם-לא-הופעלו).
 *  · רשת-המשמרות היומית מכסה 05:00–23:00 UTC; 00:00–05:00 UTC הם מדבר-משמרות
 *    (רק-סיור-המרווחים + טריגרים-תגובתיים + תעסוקה-עצמית מכסים אותו).
 *
 * המהלך (כל-אחד תפקיד-נבדל, מודולים-במינימום-הדרוש, מכסה-יומית=1):
 *  · הפעלת vault-rider  → שומר-הכספת (ריבונות-מפתחות)  · משמרת 01:00Z
 *  · הפעלת ui-verify    → בודק-הפורטל (עיני-השער בלילה) · משמרת 02:00Z
 *  · חדש: scribe-agent   → סופר-הרשת (מדרגת-המימון צעד-2) · משמרת 03:00Z
 *  · חדש: door-diplomat  → דיפלומט-הדלת (טיוטות-תשובה לשותפים) · משמרת 04:00Z
 *
 * גבולות-ריבונות חרותים במטרות: scribe = מדיניות-חשיפה (השער-חוסם-טיוטות-חשופות),
 * door-diplomat = טיוטה-בלבד (אין chat.send, אין-כתיבה-לערוץ-השותפים),
 * vault-rider = קריאה-בלבד (אף-סיבוב/מחיקה/כתיבה).
 */
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
const db = new PrismaClient();

const BRAIN = "nvidia:openai/gpt-oss-20b";
const DAY = 86_400_000;

const AGENTS = [
  {
    name: "vault-rider",
    memo: "r31: שומר-הכספת — ריבונות-המפתחות, משמרת-לילה 01:00Z (קריאה-בלבד)",
    modules: ["vault.stats", "vault.map", "vault.verify", "vault.rescan", "fleet.status", "net.health", "runs.self", "memory.read", "chat.report"],
  },
  {
    name: "ui-verify",
    memo: "r31: בודק-הפורטל — עיני-השער במשמרת-הלילה, 02:00Z",
    modules: ["net.health", "saos.hub", "fleet.status", "fleet.digest", "runs.self", "memory.read", "chat.report"],
  },
  {
    name: "scribe-agent",
    memo: "r31: סופר-הרשת — תוכן-ציבורי באנגלית (מדרגת-המימון צעד-2), משמרת-לילה 03:00Z",
    modules: ["steem.trends", "social.audit", "steem.post", "steem.interact", "social.engagement", "web.search", "runs.self", "memory.read", "chat.report"],
  },
  {
    name: "door-diplomat",
    memo: "r31: דיפלומט-הדלת — קריאת-דופקים והכנת-טיוטות-תשובה (draft-only, אין-שידור), משמרת 04:00Z",
    modules: ["fleet.digest", "fleet.situation", "web.read", "memory.read", "memory.write", "runs.self", "chat.report"],
  },
];

const SCHEDULES = [
  {
    label: "סיור-כספת לילי",
    agent: "vault-rider",
    hourUtc: 1,
    budget: 5,
    modules: ["vault.stats", "vault.map", "fleet.status", "chat.report"],
    goal: `תור-שומר-הכספת הלילי (r31, מסלול-יחיד): אתה שומר-מפתחות-הריבונות — פעולה אחת בכל צעד, אין לולאות. (1) vault.stats — מצב-הכספת: כמה רשומות באילו סטטוסים (verified/imported/unverified). (2) אם יש רשומות-imported הממתינות-בדיקה — vault.map וזהה לאילו-חשבונות/תפקידים הן-שייכות; אם-הכספת נעולה — תעד בכנות והסתפק בסטטיסטיקה. (3) fleet.status — עומק-הצי: מי-חי, מי-נופל-מ-RC. (4) chat.report — דוח-עברית: מספרים-חיים, חריגות, מה-דורש-תשומת-לב. גבול-ריבונות: קריאה-בלבד — אף-סיבוב-מפתח, אף-מחיקה, אף-כתיבה-על-רשומות.`,
    doneMeans: [
      "vault.stats הופעל והחזיר מספרים-חיים (רשומות-לפי-סטטוס)",
      "מצב-הרשומות-הממתינות (imported/unverified) זוהה ודווח או נרשם-כנה שהכספת נעולה",
      "שורת-דיווח עברית לגשר עם המספרים והחריגות",
      "אף-פעולת-כתיבה/סיבוב/מחיקה לא בוצעה — קריאה-בלבד",
    ],
  },
  {
    label: "בדיקת-פורטל לילית",
    agent: "ui-verify",
    hourUtc: 2,
    budget: 3,
    modules: ["net.health", "saos.hub", "fleet.digest", "chat.report"],
    goal: `תור-בודק-הפורטל הלילי (r31, מסלול-יחיד): אתה עיני-השער במשמרת-הלילה — פעולה אחת בכל צעד. (1) net.health — בריאות-הקשרים החיים (steem/hive/blurt/שאר-הנקודות). (2) saos.hub — נוכחות-ה-hub חיה-ומחזירה. (3) fleet.digest — מצב-הדלת: כמה-קולות-שותפים, האם-יש-דופקים-נכנסים-חדשים. (4) chat.report — דוח-עברית: מה-חי, מה-איטי, מה-נפל. אפסים-כנים הם-ממצא-כן.`,
    doneMeans: [
      "net.health הופעל והחזיר מדידה-חיה לפחות-לשרשרת-אחת",
      "saos.hub נבדק חי (או נרשם-כנה שנפל)",
      "fleet.digest נקרא ומצב-הדלת דווח",
      "שורת-דיווח עברית לגשר עם המספרים (כולל אפסים-כנים)",
    ],
  },
  {
    label: "משמרת-תוכן לילית",
    agent: "scribe-agent",
    hourUtc: 3,
    budget: 6,
    modules: ["steem.trends", "social.audit", "steem.post", "chat.report"],
    goal: `תור-סופר-הרשת הלילי (r31, מסלול-יחיד): אתה קול-הרשת במשמרת-הלילה — פעולה אחת בכל צעד. (1) steem.trends — מכ"ם-נושאים חי: מה-הרשת-קוראת-עכשיו, בחר נושא-עם-ביקוש-אמיתי. (2) social.audit — מה-כבר-פורסם-על-החשבונות; אל-תשכפל-תוכן-קיים (תוכן-כפול-פוגע-בחשבון-וב-SEO). (3) פרסם ערך-ציבורי אחד נקי באנגלית (steem.post — rail=steem או rail=hive): מאמר/מדריך/עדכון-ערך-אמיתי-לקורא. ניתוב-שפה: אנגלית-החוצה; עברית-נשארת-בפנים. מדיניות-חשיפה: אסור-לפרסם סודות, מפתחות, נתיבים/תשתית, שמות-קוד-פנימיים, תוכניות-מוצר-שלא-יצאו-לאור — השער-חוסם-טיוטות-חשופות; אם-נחסמת — תקן-והגש-שוב, אל-תעקוף. (4) chat.report — דוח-עברית: מה-פרסמת (permlink+txId), באיזה-נושא-ולמה.`,
    doneMeans: [
      "steem.trends הופעל והנושא-נבחר מתוך-ביקוש-חי",
      "social.audit הופעל — אין-שכפול-תוכן-קיים",
      "פרסום-חי אחד (steem.post עם txId) או חסימת-חשיפה-מתועדת-בכנות-עם-תיקון",
      "שורת-דיווח עברית לגשר עם permlink ו-txId",
    ],
  },
  {
    label: "סיור-דלת לילי",
    agent: "door-diplomat",
    hourUtc: 4,
    budget: 4,
    modules: ["fleet.digest", "web.read", "memory.write", "chat.report"],
    goal: `תור-דיפלומט-הדלת הלילי (r31, מסלול-יחיד): אתה קשר-החוץ של-הרשת — פעולה אחת בכל צעד, אין-לולאות-חזרה על-קריאה-שכבר-נעשתה. (1) fleet.digest — קרא-את-ערוץ-הדלת פעם-אחת: קולות-שותפים-נכנסים (voices), שאלות/דוחות-שטרם-נענו. אם voices ריק-או-כל-הקולות-כבר-נקראו — זה-ממצא-כן-וכנה: דווח 'אין דופקים חדשים' וסיים; אין-צורך ב-memory.write כשאין-מי-לענות. (2) לכל-קול-שדורש-תשובה בלבד — web.read להקשר-אם-צריך, ואז memory.write: רשום-טיוטת-תשובה-כנה-ומנומקת-כזיכרון-מובנה (key=door:response:שם-הקובץ, kind=finding, provenance). (3) chat.report — דוח-עברית לגשר: מי-דפק, מה-נשאל, אילו-טיוטות-הוכנו (מפתחות-הזיכרון) או 'אין דופקים חדשים'. גבול-ריבונות: טיוטה-בלבד — אף-שידור-חוצה, אף-chat.send, אף-כתיבה-לערוץ-השותפים; ההכרעה-על-השידור-של-המפעיל.`,
    doneMeans: [
      "fleet.digest נקרא חי פעם-אחת — הדופקים-הנכנסים מוכרים-במפורש (כולל 'אין דופקים חדשים' כשהערוץ מהדהד-רק-אותנו)",
      "לכל-קול-דורש-תשובה נרשמה-טיוטה בזיכרון (memory.write עם key=door:response:*) — או 'אין קולות דורשי-תשובה' כנה (אפס הוא גם ממצא)",
      "שורת-דיווח עברית לגשר (עם מפתחות-הטיוטות או 'אין דופקים חדשים')",
      "אף-שידור-חוצה/כתיבה-לערוץ-השותפים לא-בוצעה — טיוטה-בלבד",
    ],
  },
];

function tonight(hourUtc: number): Date {
  const d = new Date(Date.now() + DAY);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d;
}

async function upsertAgent(spec: (typeof AGENTS)[number]) {
  const existing = await db.gateAgent.findUnique({ where: { name: spec.name } });
  if (existing) {
    await db.gateAgent.update({
      where: { name: spec.name },
      data: { active: true, autonomy: true, brain: BRAIN, modules: JSON.stringify(spec.modules), memo: spec.memo },
    });
    console.log(`agent ${spec.name}: activated (brain=${BRAIN}, ${spec.modules.length} modules)`);
  } else {
    // tokenHash = sha256 של-רנדום-טרי — הסוכן-הזה-מופעל-על-ידי-הלב-מבפנים,
    // אף-טוקן-API-לא-נוצר-ולא-מוצג (כנות: הטוקן-עצמו-לא-קיים-בשום-מקום)
    const tokenHash = createHash("sha256").update(randomBytes(32)).digest("hex");
    await db.gateAgent.create({
      data: { name: spec.name, tokenHash, memo: spec.memo, modules: JSON.stringify(spec.modules), brain: BRAIN, active: true, autonomy: true },
    });
    console.log(`agent ${spec.name}: created (brain=${BRAIN}, ${spec.modules.length} modules, token minted-not-shown)`);
  }
}

async function main() {
  for (const a of AGENTS) await upsertAgent(a);
  for (const s of SCHEDULES) {
    const next = tonight(s.hourUtc);
    const existing = await db.gateSchedule.findFirst({ where: { label: s.label } });
    if (existing) {
      await db.gateSchedule.update({
        where: { id: existing.id },
        data: { agentName: s.agent, goal: s.goal, doneMeans: JSON.stringify(s.doneMeans), modules: JSON.stringify(s.modules), brain: null, budget: s.budget, kind: "daily", hourUtc: s.hourUtc, maxPerDay: 1, enabled: true, nextRunAt: next },
      });
      console.log(`schedule "${s.label}": updated → next=${next.toISOString()}`);
    } else {
      await db.gateSchedule.create({
        data: { label: s.label, agentName: s.agent, goal: s.goal, doneMeans: JSON.stringify(s.doneMeans), modules: JSON.stringify(s.modules), budget: s.budget, kind: "daily", hourUtc: s.hourUtc, maxPerDay: 1, enabled: true, nextRunAt: next },
      });
      console.log(`schedule "${s.label}": created → next=${next.toISOString()}`);
    }
  }
  const agents = await db.gateAgent.count({ where: { active: true } });
  const scheds = await db.gateSchedule.count({ where: { enabled: true } });
  console.log(`fleet: ${agents} active agents · ${scheds} enabled schedules (מסביב-לשעון)`);
}
main().finally(() => db.$disconnect());
