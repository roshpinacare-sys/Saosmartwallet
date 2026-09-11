/**
 * arm-blurt-rail.ts — Roast-74 · חימוש-מסילת-BLURT מכספת-האם (אפס-הדפסות-סודות)
 * 1) קריאת-שורת-הכספת: chain=blurt · role=active · account=headcorner
 * 2) פענוח-AES-256-GCM (אותו-פורמט-כספת-מאומת) — ה-WIF-לעולם-לא-נדפס
 * 3) אימות-משולש: גזירה→pub מול-הכספת **וגם** מול-המפתח-החי-על-השרשרת (נמדד-ברוסט)
 * 4) כתיבה-ל-saos-dex/.env (0600) — עדכון-שורה-קיימת-או-הוספה
 * פלט: בוליאנים+מפתח-ציבורי-בלבד.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import steemLibRaw from "steem";

interface SteemAuth { auth: { wifToPublic(wif: string): string } }
const steemLib = steemLibRaw as unknown as SteemAuth;

const EXPECTED_PUB = "BLT5HhJD5WUXu8vPhDmLaC2fTuuJYkwxF62Rt17HZ5G2PbnBvuHXF"; // מדוד-חי מול-rpc.blurt.blog
const ENV_PATH = "/home/z/my-project/saos-dex/.env";

function motherKey(): Buffer {
  const secret = process.env.SOVEREIGN_VAULT_SECRET || "";
  if (secret.length < 32) throw new Error("SOVEREIGN_VAULT_SECRET missing/short (fail-closed)");
  return crypto.scryptSync(secret, "sovereign-vault-v1", 32);
}
function decryptSecret(cipherText: string): string {
  const [ivHex, tagHex, ctHex] = cipherText.split(":");
  const d = crypto.createDecipheriv("aes-256-gcm", motherKey(), Buffer.from(ivHex, "hex"));
  d.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([d.update(Buffer.from(ctHex, "hex")), d.final()]).toString("utf8");
}

async function main(): Promise<void> {
  const db = new PrismaClient();
  try {
    const rows = await db.vaultKey.findMany({
      where: { chain: "blurt", role: "active", account: "headcorner" },
      select: { account: true, cipher: true, pubKey: true },
    });
    if (rows.length !== 1) throw new Error(`expected exactly 1 blurt-active row — got ${rows.length}`);
    const row = rows[0];
    if (!row.cipher || !row.pubKey) throw new Error("cipher/pubKey missing");
    const wif = decryptSecret(row.cipher);
    if (!/^[5KL][1-9A-HJ-NP-Za-km-z]{50,52}$/.test(wif.trim())) throw new Error("decrypted WIF shape invalid (fail-closed)");
    const pub = steemLib.auth.wifToPublic(wif.trim());
    // גוף-המפתח-זהה-בין-רשתות; הקידומת-משתנה (STM/BLT) — ההשוואה-על-הגוף
    const body = pub.replace(/^STM/, "");
    const matchesVault = body === row.pubKey.replace(/^(STM|BLT)/, "");
    const matchesChain = `BLT${body}` === EXPECTED_PUB;
    console.log(`self-verify: vault=${matchesVault} chain=${matchesChain} pub=BLT${body.slice(0, 9)}…`);
    if (!matchesVault || !matchesChain) throw new Error("cross-verify failed — refusing to arm (fail-closed)");

    // כתיבה-ל-.env של-הדמון (עדכון-שורה-קיימת-או-הוספה) — הערך-לא-נדפס
    let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
    const line = `BLURT_ACTIVE_WIF=${wif.trim()}`;
    if (/^BLURT_ACTIVE_WIF=/m.test(content)) {
      content = content.replace(/^BLURT_ACTIVE_WIF=.*$/m, line);
    } else {
      content = content.replace(/\s*$/, "") + "\n" + line + "\n";
    }
    fs.writeFileSync(ENV_PATH, content, { mode: 0o600 });
    fs.chmodSync(ENV_PATH, 0o600);
    console.log(`armed: BLURT_ACTIVE_WIF written to ${path.basename(ENV_PATH)} (0600, value never printed)`);
    console.log("next: restart daemon (next dev -p 3010) to load the new env");
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => { console.error(`[arm-blurt] FAILED: ${String((e as Error).message ?? e).slice(0, 200)}`); process.exit(1); });
