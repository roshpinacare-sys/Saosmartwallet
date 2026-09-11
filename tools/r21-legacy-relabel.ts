/**
 * r21 — HONESTY RELABEL: the headcorner-legacy rows are HISTORICAL material
 * (pre-rotation, "לא חי ב-authority" per their own r17 note) yet still carried
 * status="verified" — which leaked them into the CONVERSION PLANE's signing
 * roster and the treasury roster as a 13th/14th "account" that does not even
 * exist on chain. The r17 precedent: material superseded by a rotation is
 * relabeled "rotated-out" (kept sealed, never deleted). This tool applies
 * that same label honestly and re-measures the rosters.
 */
import { db } from "../src/lib/db";
import { fleetAccountsForRail } from "../src/lib/gate/dex-rail";

async function main() {
  const stale = await db.vaultEntry.findMany({
    where: { account: { contains: "-legacy" }, status: "verified" },
    select: { id: true, account: true, role: true },
  });
  console.log(`legacy rows still marked verified: ${stale.length}`);
  for (const r of stale) console.log(`  ${r.id} ${r.account}@${r.role}`);
  if (stale.length) {
    const res = await db.vaultEntry.updateMany({
      where: { id: { in: stale.map((r) => r.id) } },
      data: {
        status: "rotated-out",
        verifyNote: "r21: חומר-היסטוריה — אינו ה-authority החי (קדם ל-ROT1 ול-D1); סומן rotated-out לפי ההיגיין של r17 — נשמר אטום",
      },
    });
    console.log(`relabeled: ${res.count}`);
  }
  for (const rail of ["steem", "hive"] as const) {
    console.log(`${rail} signing roster now: ${(await fleetAccountsForRail(rail)).join(", ")}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error("crashed:", e); process.exit(1); });
