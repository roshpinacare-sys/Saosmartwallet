/**
 * r37 — vault memory + chain history for the recovered primary key.
 *  A. does the vault already hold this key? (raw33 match across VaultEntry)
 *  B. steem + hive owner history for headcorner → the honest rotation timeline
 *  C. current authority fingerprint for headcorner on both rails
 */
import bs58 from "bs58";
import crypto from "crypto";
import fs from "fs";
import { createRequire } from "module";
import { PrismaClient } from "@prisma/client";
const steemAuth: any = (createRequire(import.meta.url)("steem") as any).auth;
const db = new PrismaClient();

// r37-hygiene: the repaired primary key is sealed in the vault (role=primary-original) —
// read its PUBLIC key from there instead of embedding any secret in code.
const keyRow = await db.vaultEntry.findFirst({ where: { account: "headcorner", role: "primary-original" } });
if (!keyRow?.pub) { console.error("primary-original row missing in vault"); process.exit(1); }
const pub = keyRow.pub;
const m = /^(STM|HIVE|BLT|TST)([1-9A-HJ-NP-Za-km-z]+)$/.exec(pub)!;
const raw33 = Buffer.from(bs58.decode(m[2])).subarray(0, 33).toString("hex");
console.log("looking for raw33:", raw33);

const entries = await db.vaultEntry.findMany({ where: { kind: "steem-key" } });
let found = 0;
for (const e of entries) {
  if (!e.pub) continue;
  const pm = /^(STM|HIVE|BLT|TST)([1-9A-HJ-NP-Za-km-z]+)$/.exec(e.pub);
  if (!pm) continue;
  try {
    const rr = Buffer.from(bs58.decode(pm[2])).subarray(0, 33).toString("hex");
    if (rr === raw33) {
      found++;
      console.log(`VAULT HIT: id=${e.id} chain=${e.chain} account=${e.account} role=${e.role} status=${e.status} note=${(e.verifyNote ?? "").slice(0, 120)}`);
    }
  } catch { /* skip */ }
}
if (!found) console.log("VAULT HIT: none — the vault does NOT yet hold this key");

// owner history on both rails
for (const [chain, node] of [["steem", "https://api.steemit.com"], ["hive", "https://api.hive.blog"]] as const) {
  try {
    const r = await fetch(node, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_owner_history", params: ["headcorner"], id: 1 }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json();
    const hist: Array<{ last_owner_update: string; previous_owner: string; previous_owner_key: string }> = j.result || [];
    console.log(`\n${chain} owner history (newest first, top 6):`);
    for (const h of hist.slice(0, 6)) console.log(`  ${h.last_owner_update} prev-owner=${h.previous_owner} prev-key=${h.previous_owner_key.slice(0, 14)}…`);
    const keyHist = hist.map((h) => h.previous_owner_key);
    const inHist = keyHist.some((k) => {
      const km = /^(STM|HIVE|BLT|TST)([1-9A-HJ-NP-Za-km-z]+)$/.exec(k);
      if (!km) return false;
      try { return Buffer.from(bs58.decode(km[2])).subarray(0, 33).toString("hex") === raw33; } catch { return false; }
    });
    console.log(`  → our recovered key appears in ${chain} owner history: ${inHist ? "YES (it WAS an owner key)" : "no"}`);
  } catch (e) { console.log(`${chain} owner history failed: ${(e as Error).message}`); }
}

await db.$disconnect();
