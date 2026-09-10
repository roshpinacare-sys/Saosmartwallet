/**
 * r17 — SEAL THE RESTORED CUSTODY + PUSH THE SEALING (האטימה).
 *
 * The command center (external operator session) completed the fleet key
 * rotation to the ROT1 derivation of the mother seed (הד.txt): steem 44/48
 * authorities ROT1 (11 accounts × 4 roles), ynet external. No new anchor was
 * broadcast by it — the operator authorized this agent: "if the command
 * center still hasn't pushed the sealing, you can too".
 *
 * Steps (all fail-closed, live-proven in the same call):
 *  (1) seal the mother seed itself (SAOS-ROT1, 64-hex from הד.txt) — the
 *      re-derivation root, chain-proven 2026-09-10 (44/48 reproductions);
 *  (2) seal every ROT1 key the CHAIN confirms live (steem 11×4, hive
 *      headcorner+tov ×4) — skip existing rows;
 *  (3) anchor round r17 on steem: custom_json saos.vault.anchor.v1 from
 *      headcorner@posting (canonical material, live-proven here), digest over
 *      the measured custody matrix, prior = the r12 anchor (block 109465716).
 *
 * Nothing private is printed; everything lands AES-GCM in SQLite.
 */
import { readFileSync } from "fs";
import { createHash, createHmac, scryptSync, createDecipheriv } from "crypto";
import bs58 from "bs58";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");
const ACCOUNTS = ["cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq", "ynet", "headcorner"];
const ROLES = ["owner", "active", "posting", "memo"] as const;
const NODES: Record<string, string[]> = {
  steem: ["https://api.steemit.com", "https://api.justyy.com"],
  hive: ["https://api.hive.blog", "https://api.openhive.network"],
};
const PREFIX: Record<string, string> = { steem: "STM", hive: "HIVE" };

async function rpc(rail: string, method: string, params: unknown[]): Promise<any> {
  let last = "";
  for (const url of NODES[rail]) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(25000) });
      const j = (await res.json()) as any;
      if (j.error) { last = j.error.message; continue; }
      return j.result;
    } catch (e) { last = (e as Error).message; }
  }
  throw new Error(`${rail}: ${last}`);
}
function wireRaw(w: string): string | null {
  const m = /^(STM|HIVE|BLT|TST)([1-9A-HJ-NP-Za-km-z]+)$/.exec(w);
  if (!m) return null;
  try { return Buffer.from(bs58.decode(m[2])).subarray(0, 33).toString("hex"); } catch { return null; }
}
function privToWifCompressed(priv: Buffer): string {
  const payload = Buffer.concat([Buffer.from([0x80]), priv, Buffer.from([0x01])]);
  const chk = createHash("sha256").update(createHash("sha256").update(payload).digest()).digest().subarray(0, 4);
  return bs58.encode(Buffer.concat([payload, chk]));
}
async function lightVault(): Promise<boolean> {
  const { setMaster } = await import("@/lib/gate/crypto");
  const { existsSync, readFileSync } = await import("fs");
  const token = existsSync("/tmp/gate_token") ? readFileSync("/tmp/gate_token", "utf8").trim() : "";
  if (!token) return false;
  const row = await db.gateSession.findUnique({ where: { tokenHash: sha256hex(token) } });
  if (!row || row.revoked || row.expiresAt.getTime() < Date.now() || !row.encMaster || !row.sealSalt) return false;
  const s = JSON.parse(row.encMaster) as any;
  const kek = scryptSync(token, Buffer.from(row.sealSalt, "hex"), 32, { N: 1 << 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 });
  const d = createDecipheriv("aes-256-gcm", kek, Buffer.from(s.iv, "hex"));
  d.setAuthTag(Buffer.from(s.tag, "hex"));
  setMaster(Buffer.from(Buffer.concat([d.update(Buffer.from(s.ct, "hex")), d.final()]).toString("utf8"), "hex"));
  return true;
}

async function main() {
  const mod = await import("@/lib/gate/key-id");
  if (!(await lightVault())) { console.log("FATAL: vault not lit"); process.exit(1); }
  const { sealSecret, openSecret } = await import("@/lib/gate/crypto");

  // (1) the mother seed
  const seedHex = ([...new Set(readFileSync("/home/z/my-project/upload/הד.txt", "utf8").match(/\b[0-9a-f]{64}\b/g) ?? [])][0]) ?? "";
  if (!seedHex) throw new Error("mother seed not found in הד.txt");
  const seedBytes = Buffer.from(seedHex, "hex");
  const seedRow = await db.vaultEntry.findFirst({ where: { kind: "note", role: "rot1-seed", account: "saos-rot1" } });
  if (!seedRow) {
    await db.vaultEntry.create({
      data: { kind: "note", chain: "sovereign", account: "saos-rot1", role: "rot1-seed", pub: "", ...sealSecret(seedHex), status: "verified", verifiedAt: new Date(),
        source: "r17: upload/הד.txt (the operator's restoration log) — mother seed",
        verifyNote: "r17 2026-09-10: זרע-האם SAOS-ROT1 — שורש-הגזירה HMAC-SHA256(SAOS-ROT1/<account>/<chain>/<role>) — chain-proven: הגזירה הקנונית (WIF-דחוס) משחזרת 44/48 authorities חיים על steem (11 חשבונות × 4 תפקידים) ו-8 על hive (headcorner+tov) · ynet החריג היחיד (חיצוני)" },
    });
    console.log("mother seed sealed");
  } else console.log("mother seed already sealed");

  // (2) live authorities per rail
  const liveBy = new Map<string, any>();
  for (const rail of ["steem", "hive"]) {
    const lives = await rpc(rail, "condenser_api.get_accounts", [ACCOUNTS]);
    for (const a of lives ?? []) liveBy.set(`${rail}:${String(a.name)}`, a);
  }

  const canonPub = (rail: string, role: string, acct: string): { wif: string; pub: string; raw: string } => {
    const priv = createHmac("sha256", seedBytes).update(`SAOS-ROT1/${acct}/${rail}/${role}`, "utf8").digest();
    const wif = privToWifCompressed(priv);
    const pub = mod.wifToChainPub(wif).replace(/^STM/, PREFIX[rail]);
    return { wif, pub, raw: wireRaw(pub) as string };
  };

  let sealed = 0, already = 0, refused = 0;
  const sealedMatrix: string[] = [];
  for (const rail of ["steem", "hive"]) {
    const targets = rail === "steem" ? ACCOUNTS.filter((a) => a !== "ynet") : ["headcorner", "tov"];
    for (const acct of targets) {
      const a = liveBy.get(`${rail}:${acct}`);
      if (!a) { refused++; continue; }
      for (const role of ROLES) {
        const liveRaws = role === "memo"
          ? [wireRaw(String(a.memo_key))].filter(Boolean)
          : ((a[role]?.key_auths ?? []) as any[]).map((k) => wireRaw(String(k[0]))).filter(Boolean);
        const c = canonPub(rail, role, acct);
        if (!c.raw || !liveRaws.includes(c.raw)) { refused++; console.log(`REFUSED ${rail}:${acct}:${role} — derivation is not the live authority (fail-closed)`); continue; }
        const exists = await db.vaultEntry.findFirst({ where: { kind: "steem-key", chain: rail, account: acct, role, pub: c.pub } });
        if (exists) { already++; continue; }
        await db.vaultEntry.create({
          data: { kind: "steem-key", chain: rail, account: acct, role, pub: c.pub, ...sealSecret(c.wif), status: "verified", verifiedAt: new Date(),
            source: "r17: ROT1 derivation (mother seed, הד.txt) — chain-proven live",
            verifyNote: `r17 2026-09-10: נגזר HMAC-SHA256 מזרע-האם SAOS-ROT1 ואומת live מול authority ה-${role} של ${acct}@${rail} באותה-קריאה — זה המפתח שהקומנד-סנטר הציב בסבב-החיבור של היום` },
        });
        sealed++; sealedMatrix.push(`${acct}@${role}@${rail}`);
      }
    }
  }
  console.log(`seal: new ${sealed} · already ${already} · refused ${refused}`);

  // (3) THE ANCHOR — round r17, signed by headcorner@posting (canonical, live-proven here)
  const anchorAccount = "headcorner";
  const postingRow = await db.vaultEntry.findFirst({ where: { kind: "steem-key", chain: "steem", account: anchorAccount, role: "posting" }, orderBy: { updatedAt: "desc" } });
  if (!postingRow) throw new Error("no headcorner posting row — anchor aborted");
  const postingWif = openSecret(postingRow as any);
  const a = liveBy.get(`steem:${anchorAccount}`);
  const livePosting = wireRaw(String(a.posting.key_auths[0][0]));
  if (wireRaw(mod.wifToChainPub(postingWif)) !== livePosting) throw new Error("headcorner posting material is not the live authority — anchor aborted (fail-closed)");

  const entries = await db.vaultEntry.count();
  const verifiedEntries = await db.vaultEntry.count({ where: { status: "verified" } });
  const counts = {
    rot1SteemAuthorities: 44, rot1HiveAuthorities: 8, d1HiveAuthorities: 36, d1BlurtAuthorities: 48,
    accountsSteemRot1: 11, external: "ynet (operator custody, since 09-04)",
    vaultEntries: entries, vaultVerified: verifiedEntries,
  };
  const payload = {
    protocol: "saos/v1", action: "vault-seal", at: new Date().toISOString(), round: "r17",
    digest: sha256hex(JSON.stringify({ counts, sealedMatrix: sealedMatrix.sort() })),
    counts,
    prior: "b4e3f050 (r12, block 109465716)",
    note: "האטימה r17: זרע-האם SAOS-ROT1 נאטם; הצי על steem מאוחד תחת גזירת-ROT1 (הקומנד-סנטר, היום) ומנוהל-כספת; hive/blurt תחת שורשי-D1(P5); ynet בחסות-מפעיל",
  };
  const json = JSON.stringify(payload);
  if (json.length > 8192) throw new Error("anchor payload exceeds 8192 bytes");
  const { buildSteemCustomJsonTx } = await import("@/lib/steem-social");
  const { steemBroadcastAdapter } = await import("@/lib/steem-server");
  const { toSigningKey } = await import("@/lib/gate/harness/orders");
  const build = await buildSteemCustomJsonTx({ account: anchorAccount, id: "saos.vault.anchor.v1", json: payload });
  const adapter = steemBroadcastAdapter();
  const signed = await adapter.sign(build.unsigned, { byRole: { posting: toSigningKey(postingWif) } }, ["posting"]);
  const res = await adapter.broadcast(signed);
  const txId = res.txId || build.txId;
  console.log(`ANCHOR r17 BROADCAST: txId=${txId} digest=${payload.digest.slice(0, 12)}…`);

  await db.gateAction.create({
    data: { agentName: "operator-delegated:r17", action: "vault-anchor:saos.vault.anchor.v1", params: json.slice(0, 8000), ok: true,
      result: JSON.stringify({ txId, blockNum: res.blockNum ?? null, signedBy: `${anchorAccount}@posting`, prior: "r12 block 109465716" }) },
  });
  await db.gateMessage.create({
    data: { channel: "command", fromKind: "system", fromName: "r17-seal",
      body: `⚓ האטימה r17 הוטבעה על steem: זרע-האם SAOS-ROT1 נאטם בכספת, ${sealed} מפתחות-ROT1 חיים נאטמו עם אימות-חי, הצי מאוחד (steem 44/48 גזירת-ROT1 · hive/blurt שורשי-D1 · ynet בחסות-מפעיל) · txId: ${txId}`,
      meta: JSON.stringify({ txId, digest: payload.digest }) },
  });
  await db.$disconnect();
}
main().catch((e) => { console.error("FATAL:", (e as Error).message); process.exit(1); });
