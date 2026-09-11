/**
 * verify-key-candidates.ts — roast-84 · אימות-מועמדי-מפתח-מהתיקיות (אפס-הדפסות-סודות)
 * קלט: upload/בלורט.evm + upload/הדקור.txt — חומר-מפתח פוטנציאלי ששרד את ה-reset
 * בדיקה: גזירה→pub מול תוויות-ציבוריות (כספת: pubKey בלבד · קבוע-ידוע BLT)
 * פלט: בוליאנים + תחיליות-ציבוריות בלבד. חומר-המפתח לעולם לא נדפס.
 */
import fs from "node:fs";
import steemLibRaw from "steem";

interface SteemAuth { auth: { wifToPublic(wif: string): string } }
const steemLib = steemLibRaw as unknown as SteemAuth;

const KNOWN_BLURT_PUB = "BLT5HhJD5WUXu8vPhDmLaC2fTuuJYkwxF62Rt17HZ5G2PbnBvuHXF";

function maskPub(pub: string): string {
  return pub ? `${pub.slice(0, 8)}…` : "(none)";
}

function tryWif(wif: string, label: string, prefixes: string[]): void {
  const trimmed = wif.trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{50,52}$/.test(trimmed)) {
    console.log(`${label}: not-WIF-shaped (len=${trimmed.length})`);
    return;
  }
  for (const p of prefixes) {
    try {
      const pub = steemLib.auth.wifToPublic(trimmed);
      // wifToPublic מחזיר תמיד תחילית STM — מחליפים-להשוואה
      const adapted = p === "STM" ? pub : p + pub.slice(3);
      console.log(`${label} as ${p}: pub=${maskPub(adapted)} matchBLURT=${adapted === KNOWN_BLURT_PUB}`);
      return; // ה-pub-זהה-בין-התחיליות — די-אחרי-הראשונה-שהצליחה
    } catch (e) {
      console.log(`${label} as ${p}: derive-FAILED (${String((e as Error).message).slice(0, 60)})`);
    }
  }
}

async function main(): Promise<void> {
  // 1) קריאת-המועמדים (לעולם לא נדפסים)
  const blurtRaw = fs.readFileSync("upload/בלורט.evm", "utf8").trim();
  tryWif(blurtRaw, "בלורט.evm", ["BLT", "STM"]);

  // 2) הדקור.txt — ניתוח-צורה (סטי-תווים בלבד, אפס-תוכן)
  const hd = fs.readFileSync("upload/הדקור.txt", "utf8").split(/\r?\n/).filter(Boolean);
  console.log(`הדקור.txt: ${hd.length} non-empty lines`);
  hd.forEach((ln, i) => {
    const hexish = /^[0-9a-fA-F]+$/.test(ln);
    const b58ish = /^[1-9A-HJ-NP-Za-km-z]+$/.test(ln);
    const kind = hexish ? "hex" : b58ish ? "base58" : "mixed";
    console.log(`  line${i + 1}: len=${ln.length} kind=${kind}`);
    if (b58ish && ln.length >= 50) tryWif(ln, `הדקור:line${i + 1}`, ["BLT", "STM"]);
  });

  // 3) כספת: תוויות-ציבוריות להשוואה (pubKey בלבד — לא cipher)
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  try {
    const rows = await db.vaultKey.findMany({
      where: { account: { in: ["headcorner", "headcorner-archive", "tov"] }, pubKey: { not: null } },
      select: { chain: true, account: true, role: true, pubKey: true, fingerprint: true },
      orderBy: [{ chain: "asc" }, { role: "asc" }],
    });
    console.log(`vault pub-labels (headcorner/tov): ${rows.length}`);
    for (const r of rows.slice(0, 12)) {
      console.log(`  ${r.chain}/${r.account}/${r.role}: ${maskPub(r.pubKey ?? "")}`);
    }
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => { console.error(`[verify-candidates] FAILED: ${String((e as Error).message ?? e).slice(0, 200)}`); process.exit(1); });
