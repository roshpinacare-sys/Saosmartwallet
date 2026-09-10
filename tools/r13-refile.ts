/**
 * r13 — gap-54 remediation, mechanical truth:
 * the r12 steemauto door-closure proposal (agentName "r12-audit") was
 * auto-"expired" by the policy engine 16s after filing because no such agent
 * exists — a sovereign operator-decision item was killed before the operator
 * ever saw it. This script re-files the proposal under a REAL agent
 * (harness-rider, active+autonomous) with budget 6 > policy maxBudget 4:
 * the over-budget cap is the DESIGNED operator-only gate — the policy engine
 * can never auto-launch it, only the operator can decide (PATCH approve).
 * The rationale carries the honest history of what happened to the first filing.
 */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  const policy = await db.gateState.findUnique({ where: { key: "proposal-policy" } });
  const maxBudget = policy ? (JSON.parse(policy.value) as { maxBudget: number }).maxBudget : 4;

  // is there already a live (pending/launched) steemauto closure proposal?
  const live = await db.gateProposal.findFirst({
    where: { goal: { contains: "steemauto" }, status: { in: ["pending", "launched"] } },
    orderBy: { createdAt: "desc" },
  });
  if (live) {
    console.log(`existing live steemauto proposal #${live.id} [${live.status}] agent=${live.agentName} budget=${live.budget} — nothing to file`);
    return;
  }

  // the honest history of the dead first filing
  const dead = await db.gateProposal.findFirst({
    where: { agentName: "r12-audit", status: "expired" },
    orderBy: { createdAt: "desc" },
  });

  const p = await db.gateProposal.create({
    data: {
      agentName: "harness-rider",
      goal: "ביטול דלתות-פרסום חוץ-מיושנות: steemauto (שירות צד-שלישי של mahdiyari, 2017) מחזיק posting account-auth על ynet@steem + 9 חשבונות-צי על hive — account_update לביטול בחתימת posting/active מהכספת",
      rationale:
        `פער-54: ההצעה המקורית של r12 (agentName "r12-audit" — לא סוכן קיים) נחתמה "expired" ע"י מנוע-המדיניות 16 שניות אחרי-ההגשה ומעולם לא הגיעה להכרעת-מפעיל — תוקנה ב-heart.ts והוגשה-מחדש כאן נכון. ` +
        `דלתות-2018 לשירות steemauto.io הן יד-חוץ על פרסום/הצבעה/תביעת-תגמולים — שליטת-תגמולים מלאה דורשת סגירתן. ` +
        `thoth.test ו-steemauto עצמו אומתו חוץ-מערכתיים (0 התאמות למפתחות-הכספת). ` +
        `תקציב ${maxBudget + 2} > מקס-מדיניות (${maxBudget}) בכוונה: המנוע אף-פעם לא מזניק אותה אוטומטית — רק המפעיל מכריע (sovereign-by-design).`,
      doneMeans: JSON.stringify([
        "רשימת החשבונות עם steemauto@posting נמדדת live לפני ואחרי",
        "כל account_update חתום בכספת ומשודר עם txId אמיתי",
        "מפעיל מאשר כל שידור בנפרד (sovereign-hand חוזה)",
      ]),
      budget: maxBudget + 2,
      status: "pending",
    },
  });
  console.log(`re-filed steemauto proposal #${p.id} agent=harness-rider budget=${p.budget} (> maxBudget ${maxBudget} ⇒ operator-only) status=pending`);
  console.log(`dead first filing: #${dead?.id ?? "—"} (stays expired — the honest history)`);
}
main().finally(() => process.exit(0));
