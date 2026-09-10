/**
 * r16 — CONNECT: the mechanical answer to "connect them all".
 *
 * (1) open the vault master through the headcorner key-seals (the same proven
 *     r12 path — no passphrase involved);
 * (2) seal the headcorner P5 root from upload/הד.txt — the TWELFTH master
 *     password — only after the chain itself proves D1 derives its live
 *     blurt authorities (never trusting the file's labels);
 * (3) gap-59: the soldiers' steem rows carried the claim "owner+active+
 *     posting+memo rotated on-chain" — the chain disproves it (owner only,
 *     last_active/last_post_update = 1970, creation-era keys never matched).
 *     Every lying note is replaced with the measured truth, per role;
 * (4) record a fleet-memory fact + rotationStatus snapshot.
 */
import { readFileSync } from "fs";
import { createHash } from "crypto";
import bs58 from "bs58";
import { db } from "@/lib/db";
import { setMaster, sealSecret } from "@/lib/gate/crypto";
import { loadKeySeals, openMasterWithKey } from "@/lib/gate/key-seal";
import { wifToChainPub, chainPub } from "@/lib/gate/key-id";
import { deriveRolePrivHex, privHexToWif, rotationStatus } from "@/lib/gate/rotation";

const HEAD_WIF_FILE = "/home/z/my-project/upload/הדקור.txt";
const TOKENS_FILE = "/home/z/my-project/upload/הד.txt";

const sha256hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

function headcornerWifs(): Record<string, string> {
  const txt = readFileSync(HEAD_WIF_FILE, "utf8");
  const out: Record<string, string> = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = /^\s*(OWNER|ACTIVE|POSTING|MEMO)\s*=\s*(\S+)\s*$/i.exec(line);
    if (m) out[m[1].toLowerCase()] = m[2];
  }
  return out;
}

function raw33FromWire(pub: string | null): string | null {
  if (!pub) return null;
  const m = /^(STM|HIVE|BLT|TST)([1-9A-HJ-NP-Za-km-z]+)$/.exec(pub);
  if (!m) return null;
  try { return Buffer.from(bs58.decode(m[2])).subarray(0, 33).toString("hex"); } catch { return null; }
}

function pub33(privHex: string): string {
  const stm = chainPub(privHex, true);
  return Buffer.from(bs58.decode(stm.slice(3))).subarray(0, 33).toString("hex");
}

async function railAccounts(rail: string, names: string[]): Promise<any[]> {
  const nodes: Record<string, string[]> = {
    steem: ["https://api.steemit.com", "https://api.justyy.com"],
    hive: ["https://api.hive.blog", "https://api.deathwing.me"],
    blurt: ["https://blurt-rpc.saboin.com"],
  };
  for (const url of nodes[rail]) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "condenser_api.get_accounts", params: [names] }), signal: AbortSignal.timeout(20000) });
      const j = (await res.json()) as any;
      if (!j.error) return j.result as any[];
    } catch { /* next */ }
  }
  return [];
}

async function main() {
  console.log("== r16 CONNECT ==");
  // (1) open master via key-seals
  const wifs = headcornerWifs();
  const seals = await loadKeySeals();
  let opened = false;
  for (const [role, wif] of Object.entries(wifs)) {
    const pub = wifToChainPub(wif);
    const seal = seals.find((s) => s.pub === pub);
    if (!seal) continue;
    try {
      const masterHex = openMasterWithKey(wif, seal);
      setMaster(Buffer.from(masterHex, "hex"));
      console.log(`master opened via headcorner ${role} key-seal (${seal.chain})`);
      opened = true;
      break;
    } catch { /* next */ }
  }
  if (!opened) throw new Error("no key-seal opened — aborting (nothing mutated)");

  // (2) the headcorner P5 root — chain-proven against LIVE blurt before sealing
  const txt = readFileSync(TOKENS_FILE, "utf8");
  const tokens = [...new Set((txt.match(/P[1-9A-HJ-NP-Za-km-z]{50,52}/g) ?? []))];
  const blurtAccounts = await railAccounts("blurt", ["headcorner"]);
  const headBlurt = blurtAccounts[0];
  let sealedRoot = false;
  if (headBlurt) {
    for (const p5 of tokens) {
      const derived = ["owner", "active", "posting", "memo"].map((role) => ({ role, raw: pub33(deriveRolePrivHex("headcorner", role, p5)) }));
      const live: Record<string, string[]> = {};
      for (const role of ["owner", "active", "posting"] as const) {
        live[role] = ((headBlurt[role]?.key_auths ?? []) as any[]).map((k) => raw33FromWire(String(k[0])) || "");
      }
      live["memo"] = [raw33FromWire(String(headBlurt.memo_key)) || ""];
      const allMatch = derived.every((d) => live[d.role]?.includes(d.raw));
      if (!allMatch) continue;
      // this token IS headcorner's D1 root — seal it as the 12th master password
      const exists = await db.vaultEntry.findFirst({ where: { kind: "note", role: "master-password", account: "headcorner" } });
      if (!exists) {
        const s = sealSecret(p5);
        await db.vaultEntry.create({
          data: {
            kind: "note", chain: "steem", account: "headcorner", role: "master-password",
            pub: null, ...s, status: "imported", verifiedAt: new Date(),
            source: "r16: upload/הד.txt (chain-proven vs live blurt authorities)",
            verifyNote: "סיסמת-אב P5 של headcorner (פורמט steemit: P+WIF) — שורש-D1 לכל תפקידי החשבון: sha256(account+role+סיסמה) · r16 2026-09-10: השרשרת עצמה הוכיחה — הגזירה משחזרת בדיוק את ארבעת ה-authorities החיים של headcorner על blurt · על steem המפתחות-החיים סטו מהשורש הזה ברוטציית 2026-09-08 (הוכח 1970/last_owner) — הכספת מחזיקה את מפתחות-headcorner@steem החיים בנפרד (upload/הדקור.txt) · לרוטציה עתידית: גזירת-תפקידים מהשורש הזה",
          },
        });
        sealedRoot = true;
        console.log("headcorner P5 root sealed (chain-proven on blurt, 4/4 authorities)");
      } else {
        console.log("headcorner P5 root already present");
      }
      break;
    }
    if (!sealedRoot) console.log("no token matched headcorner's live blurt authorities — nothing sealed (honest null)");
  }

  // (3) gap-59 — replace every lying rotation note with the measured truth
  const stRows = await db.vaultEntry.findMany({ where: { kind: "steem-key", chain: "steem", account: { in: ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq"] } } });
  const ynetRows = await db.vaultEntry.findMany({ where: { kind: "steem-key", chain: "steem", account: "ynet" } });
  let fixed = 0;
  const LIE = "רוטציית-owner+active+posting+memo בוצעה on-chain";
  for (const row of stRows) {
    if (!(row.verifyNote || "").includes(LIE)) continue;
    const note = row.role === "owner"
      ? `r16 תיקון-אמת (פער-59): רוטציית 2026-09-08T21:33Z החליפה בשרשרת את authority ה-owner בלבד (chain-proven last_owner_update; last_active/last_post_update=1970) — המפתח-החי החדש נמסר למפעיל בצ'אט ולא נשמר באף מקור · החומר-הנאטם כאן הוא שורש-D1 ששלט לפני-הרוטציה ואינו ה-authority החי של ${row.account}@steem · חי ומוכח על hive+blurt`
      : `r16 תיקון-אמת (פער-59): ${row.role} של ${row.account}@steem מעולם לא סובב (chain-proven: last_update=1970) — ה-authority החי הוא מפתח-יצירה מ-2018 שמעולם לא היה ברשותנו · הטענה הקודמת שהחומר-הנאטם הוצב on-chain הייתה שקרית · החומר (שורש-D1) חי ומוכח על hive+blurt`;
    await db.vaultEntry.update({ where: { id: row.id }, data: { verifyNote: note, updatedAt: new Date() } });
    fixed++;
  }
  for (const row of ynetRows) {
    if (row.role === "operator-custody") continue;
    if (!(row.verifyNote || "").includes("מתאים live ל-authority הנוכחי")) continue;
    const note = `r16 תיקון-אמת (פער-59): החומר (שורש-D1 של ynet) חי ומוכח על blurt (4/4 authorities) אך אינו ה-authority החי של ynet@steem — ה-owner סובב 2026-09-04T07:42Z ע"י סשן-חוץ (chain-proven) ו-active/posting/memo הם מפתחות-יצירה מ-2018 שמעולם לא היו ברשותנו · הפרסום על ynet@steem חי דרך account_auth של headcorner`;
    await db.vaultEntry.update({ where: { id: row.id }, data: { verifyNote: note, updatedAt: new Date() } });
    fixed++;
  }
  console.log(`gap-59 notes corrected: ${fixed}`);

  // (4) fleet memory + snapshot
  const st = await rotationStatus();
  await db.gateMemory.upsert({
    where: { key: "rotation:steem-truth" },
    create: { key: "rotation:steem-truth", kind: "fact", body: `r16 אמת-שרשרת: הרוטציה החוץ-מערכתית של 2026-09-08 (ynet: 09-04) סובבה owner בלבד ב-11 חשבונות; רק headcorner קיבל סט מלא של 4 מפתחות (הדקור.txt — בכספת). active/posting/memo של החיילים מעולם לא סובבו (1970) ומפתחות-היצירה מ-2018 לא ברשותנו. הדרך-לחבר-הכל: מפתחי-owner שהמפעיל מדביק → רוטציה לשורשי-D1 (מישור account_update, r16). מוכן-לרוטציה עכשיו: ${st.readyCount}/${st.targets.length}`, source: "r16-rotation-plane" },
    update: { kind: "fact", body: `r16 אמת-שרשרת: הרוטציה החוץ-מערכתית של 2026-09-08 (ynet: 09-04) סובבה owner בלבד ב-11 חשבונות; רק headcorner קיבל סט מלא של 4 מפתחות (הדקור.txt — בכספת). active/posting/memo של החיילים מעולם לא סובבו (1970) ומפתחות-היצירה מ-2018 לא ברשותנו. הדרך-לחבר-הכל: מפתחי-owner שהמפעיל מדביק → רוטציה לשורשי-D1 (מישור account_update, r16). מוכן-לרוטציה עכשיו: ${st.readyCount}/${st.targets.length}`, updatedAt: new Date() },
  });
  console.log(`rotation-ready: ${st.readyCount}/${st.targets.length}`);
  for (const t of st.targets) console.log(`  ${t.account}: ownerKey=${t.hasOwnerKey ? "yes" : "no"} p5Root=${t.hasP5Root ? "yes" : "no"} ready=${t.ready}`);
  await db.$disconnect();
}
main();
