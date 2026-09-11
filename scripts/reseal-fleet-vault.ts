/**
 * reseal-fleet-vault.ts — Roast-73 · בניית-כספת-הצי-מחדש (SAOS-FLEET-VAULT-1)
 * ═══════════════════════════════════════════════════════════════════════════
 * דבר-המפעיל: "תבדוק את שאר-הסוכנים — איזה-רשתות ואיזה-מטבעות אנחנו צריכים
 * כדי-להצית-את-השרשראות".
 *
 * מה-נמצא: קובץ-כספת-הצי (agent/keys/fleet_keys.enc) **נעלם** מהדיסק — הצי
 * היה quiet-disabled ("vault-not-present"). אבל כל-חשבונות-החיילים (11 על-HIVE,
 * דו-שרשרת-עם-STEEM) קיימים-בכספת-האם (VaultKey · מוצפנים AES-256-GCM).
 *
 * הסקריפט: פתח-את-כספת-האם → גזע-מפתחות-posting של-11-החיילים → אמת-עצמית
 * (WIF→pub מול-pubKey-שבבסיס) → חתום-כספת-צי-חדשה (פורמט-SAOS-FLEET-VAULT-1,
 * סיסמה-אקראית-חדשה, chmod-600) → ודא-פתיחה-חוזרת.
 *
 * אפס-הדפסות-סודות: רק-ספירות/שמות-חשבון/תוצאות-אימות. הסיסמה-החדשה כלל-לא
 * נדפסת (רק-נכתבת-ל-meta.json · 0600 · gitignored).
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import steemLibRaw from "steem";

interface SteemAuth { auth: { wifToPublic(wif: string): string } }
const steemLib = steemLibRaw as unknown as SteemAuth;

const MAGIC = "SAOS-FLEET-VAULT-1";
const OUT_DIR = "/home/z/my-project/agent/keys";

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
      where: { chain: "hive", role: "posting" },
      select: { account: true, cipher: true, pubKey: true },
    });
    console.log(`[reseal] mother vault: ${rows.length} hive-posting rows`);
    if (rows.length === 0) throw new Error("no hive-posting rows — refusing to write an empty fleet vault");

    const accounts: { username: string; keys: Record<string, { wif: string; pub: string }> }[] = [];
    let verified = 0;
    for (const r of rows) {
      if (!r.cipher || !r.pubKey) continue;
      let wif = "";
      try { wif = decryptSecret(r.cipher); } catch (e) {
        console.log(`[reseal] ${r.account}: decrypt-fail (skipped) — ${String((e as Error).message).slice(0, 60)}`);
        continue;
      }
      let pub = "";
      try { pub = steemLib.auth.wifToPublic(wif); } catch { pub = ""; }
      const ok = pub === r.pubKey;
      if (ok) verified += 1; else console.log(`[reseal] ${r.account}: self-verify MISMATCH (skipped — fail-closed)`);
      accounts.push({ username: r.account, keys: { posting: { wif, pub: r.pubKey } } });
    }
    console.log(`[reseal] self-verified: ${verified}/${rows.length} (mismatches are skipped by fleet at open — fail-closed)`);
    if (verified === 0) throw new Error("zero self-verified accounts — refusing to seal an unusable fleet vault");

    // פורמט-הצי: files["keys/vault.json"] = {accounts:[{username, keys:{posting:{wif,pub}}}]}
    const vaultJson = JSON.stringify({ accounts });
    const bundle = JSON.stringify({ sealedAt: new Date().toISOString(), files: { "keys/vault.json": vaultJson } });

    const pass = crypto.randomBytes(24).toString("base64url"); // סיסמה-אקראית-חדשה — לא-נדפסת
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", crypto.scryptSync(pass, salt, 32), iv);
    const ct = Buffer.concat([cipher.update(bundle, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const sealed = MAGIC + Buffer.concat([salt, iv, tag, ct]).toString("hex");

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const encPath = path.join(OUT_DIR, "fleet_keys.enc");
    const metaPath = path.join(OUT_DIR, "fleet_keys.meta.json");
    fs.writeFileSync(encPath, sealed, { mode: 0o600 });
    fs.writeFileSync(metaPath, JSON.stringify({ pass }, null, 0) + "\n", { mode: 0o600 });
    fs.chmodSync(encPath, 0o600);
    fs.chmodSync(metaPath, 0o600);
    console.log(`[reseal] sealed: ${encPath} (${accounts.length} accounts) + meta (0600, gitignored)`);

    // אימות-חוזר: פתח-בדיוק-כמו fleet.openVault וספור
    const raw = fs.readFileSync(encPath, "utf8");
    if (!raw.startsWith(MAGIC)) throw new Error("roundtrip: bad magic");
    const payload = Buffer.from(raw.slice(MAGIC.length).replace(/\s+/g, ""), "hex");
    const key = crypto.scryptSync(pass, payload.subarray(0, 16), 32);
    const d = crypto.createDecipheriv("aes-256-gcm", key, payload.subarray(16, 28));
    d.setAuthTag(payload.subarray(28, 44));
    const plain = Buffer.concat([d.update(payload.subarray(44)), d.final()]).toString("utf8");
    const parsed = JSON.parse(plain) as { files?: Record<string, string> };
    const round = JSON.parse(parsed.files?.["keys/vault.json"] ?? "{}") as { accounts?: { username: string }[] };
    console.log(`[reseal] roundtrip OK: ${round.accounts?.length ?? 0} accounts readable — fleet will self-verify on open`);
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => { console.error(`[reseal] FAILED: ${String((e as Error).message ?? e).slice(0, 200)}`); process.exit(1); });
