/** r20 — STEEMAUTO DISCONNECT (operator instruction: "steemauto תנתק, הוא לא מעניין").
 *  The pending/launched door-closure proposal leaves the agenda BY OPERATOR
 *  DECISION — the honest terminal state is "rejected" with decidedBy=operator.
 *  The door facts stay documented (hive: RC-economics; steem: operator custody). */
export {};
async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  const p = await db.gateProposal.findFirst({ where: { goal: { contains: "steemauto" } }, orderBy: { createdAt: "desc" } });
  if (!p) { console.log("no steemauto proposal — nothing to do"); process.exit(0); }
  const note = " ── r20 הוראת-המפעיל: ״steemauto תנתק, הוא לא מעניין״ — הוצא מסדר-היום בהכרעת-המפעיל; הדלתות נשארות כפי-שהן ומתועדות-מדוד (hive: חסומות-כלכלה RC — מדידה-חי r19/r20; steem: חסות-מפעיל). איטום-הכספת עצמו לא נפגע: העוגן רב-המסילתי r20 חי על steem+blurt.";
  await db.gateProposal.update({
    where: { id: p.id },
    data: {
      status: "rejected",
      decidedBy: "operator",
      decidedAt: new Date(),
      rationale: `${String(p.rationale ?? "").slice(0, 1500)}${note}`,
    },
  });
  await db.gateMessage.create({
    data: { channel: "command", fromKind: "system", fromName: "r20-disconnect", body: "🔌 steemauto נותק מסדר-היום בהוראת-המפעיל (הצעת-סגירת-הדלתות נסגרה כ״נדחה על-ידי המפעיל״). המיקוד עובר לדרכים-חדשות לרשת: עוגן רב-מסילתי (steem+blurt חי, hive חסום-כלכלה-בכנות), מסילת-blurt נאטמה בכספת (48 שורות), ומשמרת anchor-watch חדשה לצי." },
  }).catch(() => {});
  console.log("steemauto proposal:", p.id, "→ rejected by operator");
  await db.$disconnect();
  process.exit(0);
}
main().catch((e) => { console.error("FATAL:", (e as Error).message); process.exit(1); });
