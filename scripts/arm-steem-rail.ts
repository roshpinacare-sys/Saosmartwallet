/**
 * arm-steem-rail.ts — roast-75 · חימוש-מסילת-STEEM מהכספת (אפס-הדפסות-סודות)
 *
 * תגלית-הביקורת (cross-audit-keys): הסמכות-החיה על headcorner-ב-Steem היא
 * החומר-הישן — vault rows steem/headcorner-archive/* (יובאו-מ-.env-ישן).
 * ה-STEEM_ACTIVE_WIF-הנוכחי בדמון = חומר-ROT1 (שולט-רק-על-Hive) — מוחלף-כאן.
 *
 * 1) קריאת-השורה: chain=steem · account=headcorner-archive · role=active
 * 2) פענוח-AES-256-GCM — ה-WIF-לעולם-לא-נדפס
 * 3) אימות-משולש: גזירה→pub מול-הכספת **וגם** מול-הסמכות-החיה-על-Steem
 * 4) כתיבה-ל-saos-dex/.env (0600)
 * פלט: בוליאנים + מפתח-ציבורי-חלקי-בלבד.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import steemLibRaw from "steem";

interface SteemAuth { auth: { wifToPublic(wif: string): string } }
const steemLib = steemLibRaw as unknown as SteemAuth;
const ENV_PATH = "/home/z/my-project/saos-dex/.env";
const UA = "SAOS-Sovereign-Audit/1.0 (+sovereign-chain)";

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

async function liveKey(account: string, role: "active" | "posting"): Promise<string> {
  const r = await fetch("https://api.steemit.com", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [[account]], id: 1 }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await r.json()) as { result?: Record<string, { key_auths?: [string, number][] }>[] };
  const pub = j.result?.[0]?.[role]?.key_auths?.[0]?.[0];
  if (!pub) throw new Error(`no live ${role} key on steem for ${account}`);
  return pub;
}

async function main(): Promise<void> {
  const db = new PrismaClient();
  try {
    const bodyOf = (p: string) => p.replace(/^STM/, "");
    // roast-77: חימוש-כפול — active (עבור-ops-פיננסיים) **וגם** posting (עבור-חותמות-עיגון).
    // האבחנה-החיה: ה-STEEM_POSTING_WIF-ב-.env היה-חומר-שגוי → כל-החותמות-נדחו-על-הצומת
    // ("missing required posting authority") — הרכבת-העוגן-המרתקת-הייתה-חסומה.
    const jobs: { role: "active" | "posting"; envKey: string }[] = [
      { role: "active", envKey: "STEEM_ACTIVE_WIF" },
      { role: "posting", envKey: "STEEM_POSTING_WIF" },
    ];
    let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
    for (const job of jobs) {
      const rows = await db.vaultKey.findMany({
        where: { chain: "steem", account: "headcorner-archive", role: job.role },
        select: { account: true, cipher: true, pubKey: true },
      });
      if (rows.length !== 1) throw new Error(`expected exactly 1 steem headcorner-archive/${job.role} row — got ${rows.length}`);
      const row = rows[0];
      if (!row.cipher || !row.pubKey) throw new Error("cipher/pubKey missing");
      const wif = decryptSecret(row.cipher);
      if (!/^[5KL][1-9A-HJ-NP-Za-km-z]{50,52}$/.test(wif.trim())) throw new Error("decrypted WIF shape invalid (fail-closed)");
      const pub = steemLib.auth.wifToPublic(wif.trim());
      const matchesVault = bodyOf(pub) === bodyOf(row.pubKey);
      const livePub = await liveKey("headcorner", job.role);
      const matchesChain = bodyOf(pub) === bodyOf(livePub);
      console.log(`self-verify[${job.role}]: vault=${matchesVault} chain=${matchesChain} pub=STM${bodyOf(pub).slice(0, 9)}...`);
      if (!matchesVault || !matchesChain) throw new Error(`cross-verify failed for ${job.role} — refusing to arm (fail-closed)`);
      const line = `${job.envKey}=${wif.trim()}`;
      if (new RegExp(`^${job.envKey}=`).test(content)) {
        content = content.replace(new RegExp(`^${job.envKey}=.*$`, "m"), line);
      } else {
        content = content.replace(/\s*$/, "") + "\n" + line + "\n";
      }
      console.log(`armed: ${job.envKey} written to ${path.basename(ENV_PATH)} (0600, value never printed)`);
    }
    fs.writeFileSync(ENV_PATH, content, { mode: 0o600 });
    fs.chmodSync(ENV_PATH, 0o600);
    console.log("next: restart daemon (next dev -p 3010) to load the new env, then the seal path picks posting-ראשון");
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => { console.error(`[arm-steem] FAILED: ${String((e as Error).message ?? e).slice(0, 200)}`); process.exit(1); });
