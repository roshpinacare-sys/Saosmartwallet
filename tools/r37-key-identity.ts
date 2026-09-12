/**
 * r37 — LIVE identity drill for the recovered primary key.
 *  1. read upload/headcorner.txt → auto-repair (checksum-verified)
 *  2. derive the graphene pubkey (steem-js canonical path)
 *  3. fetch the live authority map (steem+hive+blurt, all fleet accounts)
 *  4. report exactly what this key controls RIGHT NOW
 * Never prints the private key itself.
 */
import bs58 from "bs58";
import crypto from "crypto";
import fs from "fs";
import { createRequire } from "module";
const steemAuth: any = (createRequire(import.meta.url)("steem") as any).auth;

const FLEET = ["headcorner","ynet","cashmachine","haran","israelnews","lsa","macrame","siq","tov","wic","wog","woq"];
const NODES: Record<string, string[]> = {
  steem: ["https://api.steemit.com", "https://api.justyy.com", "https://api.steemitdev.com"],
  hive: ["https://api.hive.blog", "https://api.deathwing.me", "https://api.openhive.network"],
  blurt: ["https://blurt-rpc.saboin.com"],
};

const raw = fs.readFileSync("/home/z/my-project/upload/headcorner.txt", "utf8");
const orig = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[1];

function dsha(b: Buffer): Buffer { return crypto.createHash("sha256").update(crypto.createHash("sha256").update(b).digest()).digest(); }
function wifValid(c: string): boolean {
  try {
    const buf = Buffer.from(bs58.decode(c));
    if (buf[0] !== 0x80) return false;
    return dsha(buf.subarray(0, buf.length - 4)).subarray(0, 4).equals(buf.subarray(buf.length - 4));
  } catch { return false; }
}

let wif = orig;
let repaired = false;
if (!wifValid(orig)) {
  for (const cand of [orig.slice(1), orig.slice(0, -1), orig.slice(1, -1)]) {
    if (wifValid(cand)) { wif = cand; repaired = true; break; }
  }
}
console.log("repaired:", repaired, "· wif length:", wif.length, "· prefix:", wif.slice(0, 2));

// derive chain pub — canonical steem-js path for 5… WIFs
const pub: string = String(steemAuth.wifToPublic(wif));
const m = /^(STM|HIVE|BLT|TST)([1-9A-HJ-NP-Za-km-z]+)$/.exec(pub);
const raw33 = m ? Buffer.from(bs58.decode(m[2])).subarray(0, 33).toString("hex") : null;
console.log("derived pub:", pub.slice(0, 12) + "…" + pub.slice(-6), "· raw33:", raw33?.slice(0, 12) + "…");

// live authority map
const map = new Map<string, { chain: string; account: string; role: string; pub: string }[]>();
const alive: Record<string, boolean> = {};
await Promise.all(Object.entries(NODES).map(async ([chain, nodes]) => {
  for (const node of nodes) {
    for (let a = 0; a < 2; a++) {
      try {
        if (a > 0) await new Promise((r) => setTimeout(r, 1200));
        const r = await fetch(node, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [FLEET], id: 1 }),
          signal: AbortSignal.timeout(15000),
        });
        const j = await r.json();
        for (const acc of j.result || []) {
          for (const role of ["owner", "active", "posting"] as const) {
            for (const [p] of acc[role]?.key_auths || []) {
              const pm = /^(STM|HIVE|BLT|TST)([1-9A-HJ-NP-Za-km-z]+)$/.exec(p);
              if (!pm) continue;
              const rr = Buffer.from(bs58.decode(pm[2])).subarray(0, 33).toString("hex");
              const arr = map.get(rr) || []; arr.push({ chain, account: acc.name, role, pub: p }); map.set(rr, arr);
            }
          }
          const mm = /^(STM|HIVE|BLT|TST)([1-9A-HJ-NP-Za-km-z]+)$/.exec(acc.memo_key || "");
          if (mm) {
            const rr = Buffer.from(bs58.decode(mm[2])).subarray(0, 33).toString("hex");
            const arr = map.get(rr) || []; arr.push({ chain, account: acc.name, role: "memo", pub: acc.memo_key }); map.set(rr, arr);
          }
        }
        alive[chain] = true;
        return;
      } catch { /* next */ }
    }
  }
  alive[chain] = false;
}));

console.log("rails alive:", JSON.stringify(alive));
const controls = (raw33 ? map.get(raw33) : []) || [];
if (controls.length === 0) {
  console.log("CONTROLS: NONE — the key holds no live authority on any fleet account");
  process.exit(1);
}
for (const c of controls) console.log(`  controls: ${c.account}@${c.chain}·${c.role}`);
const hc = controls.filter((c) => c.account === "headcorner");
console.log(hc.length ? `HEADCORNER: YES (${hc.map((c) => `${c.chain}·${c.role}`).join(", ")})` : "HEADCORNER: no");
