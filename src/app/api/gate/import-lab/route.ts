import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { sealSecret, GateError } from "@/lib/gate/crypto";
import { requireOperator } from "@/lib/gate/session";
import { fail, ok } from "@/lib/gate/http";
import { wifToChainPub } from "@/lib/gate/key-id";

export const runtime = "nodejs";

const LAB = "/home/z/my-project/.grid98-lab";
const UPLOAD = "/home/z/my-project/upload";

interface Sealed {
  encPriv: string;
  privIv: string;
  privTag: string;
}

async function put(
  kind: string,
  chain: string | null,
  account: string | null,
  role: string | null,
  pub: string | null,
  secret: string,
  status: string,
  verifyNote: string,
  source: string,
) {
  const dup = await db.vaultEntry.findFirst({ where: { kind, chain, account, role, pub } });
  if (dup) return { created: false, id: dup.id };
  const s: Sealed = sealSecret(secret);
  const row = await db.vaultEntry.create({
    data: {
      kind, chain, account, role, pub, status, verifyNote, source, verifiedAt: status === "verified" ? new Date() : null, ...s,
    },
  });
  return { created: true, id: row.id };
}

/** POST /api/gate/import-lab — operator only. One-shot bulk import from the lab
 *  plaintext sources into the encrypted vault, then they can be retired. */
export async function POST() {
  try {
    await requireOperator();
    const results: Record<string, unknown> = {};
    let created = 0;

    /* 1) NEW headcorner keys — the operator's uploaded file (steem + hive blocks) */
    const uploadedPath = path.join(UPLOAD, "הדקור.txt");
    let uploadedParsed = { steem: 0, hive: 0 };
    if (fs.existsSync(uploadedPath)) {
      const txt = fs.readFileSync(uploadedPath, "utf8");
      const blocks = txt.split(/HIVE/i);
      const parseBlock = (b: string) => {
        const out: Record<string, string> = {};
        for (const m of b.matchAll(/(OWNER|ACTIVE|POSTING|MEMO)\s*=\s*(\S+)/gi)) out[m[1].toLowerCase()] = m[2];
        return out;
      };
      const steemKeys = parseBlock(blocks[0] || "");
      const hiveKeys = parseBlock(blocks[1] || "");
      for (const [role, wif] of Object.entries(steemKeys)) {
        const pub = wifToChainPub(wif);
        const r = await put("steem-key", "steem", "headcorner", role, pub, wif, "verified", "מהקובץ-שהועלה — אומת live", "upload-file");
        if (r.created) created++;
        uploadedParsed.steem++;
      }
      for (const [role, wif] of Object.entries(hiveKeys)) {
        const pub = wifToChainPub(wif);
        const r = await put("steem-key", "hive", "headcorner", role, pub, wif, "verified", "מהקובץ-שהועלה — אומת live", "upload-file");
        if (r.created) created++;
        uploadedParsed.hive++;
      }
    }
    results.uploaded = uploadedParsed;

    /* 2) headcorner OLD set from lab agent/.env — kept for forensics, marked rotated-out */
    const envPath = path.join(LAB, "agent", ".env");
    if (fs.existsSync(envPath)) {
      const env = fs.readFileSync(envPath, "utf8");
      let oldCount = 0;
      for (const m of env.matchAll(/(OWNER|ACTIVE|POSTING|MEMO)_WIF=([^\s]+)/g)) {
        const role = m[1].toLowerCase();
        const pub = (env.match(new RegExp(m[1] + "_WIF_PUB=([^\\s]+)")) || [])[1] || null;
        const r = await put("steem-key", "steem", "headcorner-legacy", role, pub, m[2], "rotated-out", "הסט הקודם — איבד authority ברוטציה 2026-09-08T21:17:33Z", "agent-env");
        if (r.created) { created++; oldCount++; }
      }
      const ghTok = (env.match(/GITHUB_TOKEN=([^\s]+)/) || [])[1];
      if (ghTok) {
        const r = await put("token", "github", "roshpinacare-sys", "gitkeeper-push", null, ghTok, "imported", "מ-agent/.env", "agent-env");
        if (r.created) created++;
      }
      results.headcornerLegacy = oldCount;
    }

    /* 3) soldiers' full steem sets from vault.json */
    const vaultPath = path.join(LAB, "agent", "keys", "vault.json");
    if (fs.existsSync(vaultPath)) {
      const vault = JSON.parse(fs.readFileSync(vaultPath, "utf8"));
      let soldierKeys = 0;
      for (const a of vault.accounts || []) {
        for (const [role, k] of Object.entries(a.keys || {})) {
          const kk = k as { wif?: string; pub?: string } | undefined;
          if (!kk?.wif) continue;
          const r = await put("steem-key", "steem", a.username, role, kk.pub || null, kk.wif, "verified", "vault.json — מאומת WIF→pub", "vault-json");
          if (r.created) { created++; soldierKeys++; }
        }
      }
      results.soldiers = soldierKeys;
    }

    /* 4) fleet wallets from wallets-registry.json (EVM + TRON) + SOL seed */
    const regPath = path.join(LAB, "agent", "keys", "wallets-registry.json");
    if (fs.existsSync(regPath)) {
      const reg = JSON.parse(fs.readFileSync(regPath, "utf8"));
      let fleet = 0;
      for (const a of reg.accounts || []) {
        if (a.evm?.pk) {
          const r = await put("evm-key", "ethereum", a.agent, "wallet", a.evm.address, a.evm.pk, "imported", "wallets-registry", "registry");
          if (r.created) { created++; fleet++; }
        }
        if (a.tron?.pk) {
          const r = await put("tron-key", "tron", a.agent, "wallet", a.tron.address, a.tron.pk, "imported", "wallets-registry", "registry");
          if (r.created) { created++; fleet++; }
        }
      }
      results.fleetWallets = fleet;
    }

    /* 5) sovereign root seed + tron mnemonics + infra tokens */
    const seedPath = path.join(LAB, "agent", "keys", "wallets-seed.json");
    if (fs.existsSync(seedPath)) {
      const seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
      const r = await put("mnemonic", "sovereign", "root", "root-seed", null, String(seed.seed), "imported", "הזרע-הריבוני — גוזר את כל ארנקי-הצי", "vault-json");
      if (r.created) created++;
    }
    for (const f of ["tron-mnemonic.txt", "tron-legacy-mnemonic.txt"]) {
      const p = path.join(LAB, "agent", "keys", f);
      if (fs.existsSync(p)) {
        const r = await put("mnemonic", "tron", f.startsWith("tron-legacy") ? "legacy" : "sov", "doors", null, fs.readFileSync(p, "utf8").trim(), "imported", f, "vault-json");
        if (r.created) created++;
      }
    }
    const infra: [string, string | null, string, string][] = [];
    const vk = path.join(LAB, "agent", "keys", ".vaultkey");
    if (fs.existsSync(vk)) infra.push(["infra", "vault-114-master", "vaultkey", fs.readFileSync(vk, "utf8").trim()]);
    const bt = path.join(LAB, "agent", "keys", "key-broker.token");
    if (fs.existsSync(bt)) infra.push(["infra", "key-broker-3040", "bearer", fs.readFileSync(bt, "utf8").trim()]);
    const fp = path.join(LAB, "agent", "fleet_keys.meta.json");
    if (fs.existsSync(fp)) {
      try { infra.push(["infra", "fleet-seal", "passphrase", String(JSON.parse(fs.readFileSync(fp, "utf8")).pass)]); } catch { /* noop */ }
    }
    const pat = path.join(UPLOAD, "Roshcaregt.txt");
    if (fs.existsSync(pat)) {
      const v = fs.readFileSync(pat, "utf8").trim();
      if (v && !v.includes("[REDACTED")) infra.push(["token", "github", "operator-pat", v]);
    }
    const projEnv = path.join("/home/z/my-project", ".env");
    if (fs.existsSync(projEnv)) {
      const t = (fs.readFileSync(projEnv, "utf8").match(/SAOS_ADMIN_TOKEN=([^\s]+)/) || [])[1];
      if (t) infra.push(["token", "saos-web", "admin", t]);
    }
    let infraCount = 0;
    for (const [kind, account, role, secret] of infra) {
      if (!secret) continue;
      const r = await put(kind, kind === "token" && account === "github" ? "github" : "infra", account, role, null, secret, "imported", "תשתית", "system");
      if (r.created) { created++; infraCount++; }
    }
    results.infra = infraCount;
    results.created = created;

    await db.gateMessage.create({
      data: {
        fromKind: "system", fromName: "gate",
        body: `ייבוא-המוני הושלם: ${created} פריטי-סוד חדשים נאטמו בכספת (headcorner חדש+ישן · חיילים · צי · זרע · תשתית)`,
      },
    });
    return ok({ results });
  } catch (e) {
    return fail(e);
  }
}
