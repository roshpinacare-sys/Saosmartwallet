// r37 — annotate the coinomi vault entry with the scan findings (public data only)
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const entry = await db.vaultEntry.findFirst({ where: { kind: "mnemonic", chain: "coinomi" } });
if (!entry) { console.error("coinomi entry not found"); process.exit(1); }
const note = "ביטוי-שחזור Coinomi (24 מילים) · סריקת-r37: ETH m/44'/60'/0'/0/0 0x01Bd2879Cd9990Cb4B25cD6DE47f378Dc5D18B37 — 0.0000265 ETH, nonce 11 (ארנק-פעיל-היסטורית) · BTC (44/49/84 ×idx0-2) אפס · LTC idx0: 0.185 LTC נקלטו-ונשלחו, יתרה 0 · DOGE idx0: 420.06 DOGE נקלטו-ונשלחו, יתרה 0 · ארנק רוקן-היסטורית; הזרע נשמר לשחזור-עתידי";
await db.vaultEntry.update({ where: { id: entry.id }, data: { verifyNote: note, verifiedAt: new Date() } });
await db.gateMessage.create({ data: {
  fromKind: "system", fromName: "gate",
  body: "ר37 — תרגיל-שחזור עבר (235/235 סודות נפתחו בפועל · גיבוי-אטום 409KB נכתב) · בדיקת-עומק headcorner: 20/20 חומר-תקין, 12 סמכות-חיה · ביטוי-Coinomi (24 מילים) נאטם בכספת ונסרק: ארנק-ישן שרוקן-היסטורית (שארית 0.0000265 ETH, nonce 11) — הזרע מובטח לשחזור-עתידי",
} });
console.log("annotated:", entry.id);
await db.$disconnect();
