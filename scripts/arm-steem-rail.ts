/**
 * arm-steem-rail.ts — roast-75 · חימוש-מסילת-STEEM מהכספת (אפס-הדפסות-סודות)
 *
 * תגלית-הביקורת (cross-audit-keys): הסמכות-החיה על headcorner-ב-Steem היא
 * החומר-הישן — vault rows steem/headcorner-archive/* (יובאו-מ-.env-ישן).
 * ה-STEEM_ACTIVE_WIF-הנוכחי בדמון = חומר-ROT1 (שולט-רק-על-Hive) — מוחלף-כאן.
 *
 * 1) קריאת-השורה: chain=steem · account=headcorner-archive · role=active/posting
 *    FIX(Task-70): צופן-הארכיון מת-אחרי-חימוש-הכספת-מחדש (roast-85 סוד-חדש) —
 *    גיבוי-חי: headcorner/owner (מוצפן-בסוד-הנוכחי בכניסה-מאומתת). הוכח-חי:
 *    owner-חותם-פעולות-active (הזמנה-אמת dbc9eba9… נענתה-על-השרשרת).
 *    posting: אין-גיבוי-כרגע (צופן-ארכיון-מת) — חותמות-STEEM נשארות fail-closed-כנות.
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

async function liveKey(account: string, role: "active" | "posting" | "owner"): Promise<string> {
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
  async function decryptRow(chain: string, account: string, role: string): Promise<{ wif: string; pub: string } | null> {
    const rows = await db.vaultKey.findMany({
      where: { chain, account, role },
      select: { account: true, cipher: true, pubKey: true },
    });
    if (rows.length !== 1) return null;
    const row = rows[0];
    if (!row.cipher || !row.pubKey) return null;
    try {
      return { wif: decryptSecret(row.cipher).trim(), pub: row.pubKey };
    } catch {
      return null; // FIX(Task-70): צופן-מת (סוד-ישן) — לא-קריסה, גיבוי-בתור
    }
  }

  const bodyOf = (p: string) => p.replace(/^STM/, "");
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const tryArm = async (role: "active" | "posting", envKey: string, fallbacks: { account: string; role: string }[]): Promise<void> => {
    const candidates = [{ account: `headcorner-archive`, role }, ...fallbacks];
    for (const cand of candidates) {
      const got = await decryptRow("steem", cand.account, cand.role);
      if (!got) continue;
      const wif = got.wif;
      if (!/^[5KL][1-9A-HJ-NP-Za-km-z]{50,52}$/.test(wif)) continue;
      const pub = steemLib.auth.wifToPublic(wif);
      const matchesVault = bodyOf(pub) === bodyOf(got.pub);
      const livePub = await liveKey("headcorner", cand.role as "active" | "posting" | "owner");
      const matchesChain = bodyOf(pub) === bodyOf(livePub);
      console.log(`self-verify[${envKey} ← ${cand.account}/${cand.role}]: vault=${matchesVault} chain=${matchesChain} pub=STM${bodyOf(pub).slice(0, 9)}...`);
      if (!matchesVault || !matchesChain) continue;
      const line = `${envKey}=${wif}`;
      if (new RegExp(`^${envKey}=`).test(content)) content = content.replace(new RegExp(`^${envKey}=.*$`, "m"), line);
      else content = content.replace(/\s*$/, "") + "\n" + line + "\n";
      console.log(`armed: ${envKey} ← ${cand.account}/${cand.role} (value never printed)`);
      return;
    }
    console.log(`NOT-ARMED: ${envKey} — אף-מועמד לא עבר אימות-משולש (fail-closed כנה)`);
  };

    // active: ארכיון→owner-חי (הוכח: owner חותם active-על-Steem) · posting: ארכיון בלבד
    await tryArm("active", "STEEM_ACTIVE_WIF", [{ account: "headcorner", role: "owner" }]);
    await tryArm("posting", "STEEM_POSTING_WIF", []);
    fs.writeFileSync(ENV_PATH, content, { mode: 0o600 });
    fs.chmodSync(ENV_PATH, 0o600);
    console.log("next: restart daemon (next dev -p 3010) to load the new env, then the seal path picks posting-ראשון");
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => { console.error(`[arm-steem] FAILED: ${String((e as Error).message ?? e).slice(0, 200)}`); process.exit(1); });
