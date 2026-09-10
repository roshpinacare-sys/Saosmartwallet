/** r17 — honest relabeling of vault rows to the measured r17 truth. */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const SOLDIERS = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq"];

async function main() {
  // (1) ynet: the 09-04 op was FULL-4 (owner+active+posting+memo), op 9defc295…
  const ynet = await db.vaultEntry.findMany({ where: { kind: "steem-key", chain: "steem", account: "ynet" } });
  for (const r of ynet) {
    if ((r.verifyNote || "").includes("r17 תיקון")) continue;
    await db.vaultEntry.update({ where: { id: r.id }, data: { verifyNote: `${r.verifyNote || ""} · r17 תיקון: ה-op של 2026-09-04T07:42:36 (9defc295…) הציב FULL-4 — כל ארבעת התפקידים של ynet@steem חיצוניים (חסות-מפעיל), לא owner-בלבד כפי שנרשם ב-r16`.slice(0, 900) } });
  }
  console.log(`ynet rows updated: ${ynet.length}`);

  // (2) soldiers' 2018-era rows (MASTER-KEYS-RECOVERY source): rotated out by the command-center ROT1 round
  let rot = 0;
  for (const acct of SOLDIERS) {
    const rows = await db.vaultEntry.findMany({ where: { kind: "steem-key", chain: "steem", account: acct, source: { contains: "MASTER-KEYS-RECOVERY" } } });
    for (const r of rows) {
      if (r.status === "rotated-out") continue;
      await db.vaultEntry.update({ where: { id: r.id }, data: { status: "rotated-out", verifyNote: `${r.verifyNote || ""} · r17: הוחלף בשרשרת — owner בסבב 2026-09-08, active/posting/memo בסבב-הקומנד-סנטר של 2026-09-10 (גזירת-ROT1 מזרע-האם, chain-proven) — החומר ההיסטורי נשאר נאטם`.slice(0, 900) } });
      rot++;
    }
  }
  console.log(`soldier rows relabeled rotated-out: ${rot}`);

  // (3) headcorner-legacy rows — stale since the 09-08 rotation
  const legacy = await db.vaultEntry.findMany({ where: { kind: "steem-key", chain: "steem", account: "headcorner-legacy", status: { not: "rotated-out" } } });
  for (const r of legacy) {
    await db.vaultEntry.update({ where: { id: r.id }, data: { status: "rotated-out", verifyNote: `${r.verifyNote || ""} · r17: לא חי ב-authority (הוחלף ב-2026-09-08 ואז בגזירת-ROT1) — חומר היסטורי נאטם`.slice(0, 900) } });
  }
  console.log(`legacy rows relabeled: ${legacy.length}`);

  // (4) headcorner's הדקור.txt rows (steem+hive): canonical-consistency proven
  const hc = await db.vaultEntry.findMany({ where: { kind: "steem-key", account: "headcorner", source: { contains: "הדקור" } } });
  for (const r of hc) {
    if ((r.verifyNote || "").includes("r17 עקביות")) continue;
    await db.vaultEntry.update({ where: { id: r.id }, data: { verifyNote: `${r.verifyNote || ""} · r17 עקביות-חומר אומתה בפרשנות-הקנונית (גוף-33 בייטים כסקלר): ה-WIF הנאטם מייצר בדיוק את ה-pub של השורה = ה-authority-החי`.slice(0, 900) } });
  }
  console.log(`headcorner rows annotated: ${hc.length}`);
  await db.$disconnect();
}
main();
