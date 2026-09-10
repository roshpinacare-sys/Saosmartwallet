/**
 * r11 — CONTROL MATRIX: rewards-level control across every account and wallet family.
 * READ-ONLY. Addresses and balances only — key material never printed.
 *
 * Families probed (all live):
 *   steem authority (owner/active/posting/memo) vs vault pubs — headcorner + 11 soldiers
 *   TRON balances  — fleet(12 from sovereign seed) + bridge(6) + sov-mnemonic doors(6) + old-anchored(12, superseded seed-A)
 *   ETH balances   — fleet(12)
 *   SOL balances   — fleet(12)
 *   BTC funded/spent — fleet(12) via mempool.space
 */
import { readFileSync } from "fs";
import { createHash } from "crypto";
import { HDNodeWallet, SigningKey, keccak256 } from "ethers";
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";
import { db } from "@/lib/db";

const RECOVERY_MD = "/tmp/my-project/MASTER-KEYS-RECOVERY-2026-09-09.md";
const ZIP_DIR = "/tmp/r11/extracted/steem-main/sovereign/node";
const AGENTS = ["cashmachine","haran","headcorner","israelnews","lsa","macrame","siq","tov","wic","wog","woq","ynet"];
const sha256buf = (s: string) => createHash("sha256").update(s).digest();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function steemRpc<T>(method: string, params: unknown[]): Promise<T> {
  for (const url of ["https://api.steemit.com", "https://api.justyy.com"]) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15000) });
      const j = (await res.json()) as any;
      if (j.error) throw new Error(j.error.message);
      return j.result as T;
    } catch {}
  }
  throw new Error("steem nodes down");
}

async function tronBalance(address: string): Promise<{ trx: number; usdt: number; activated: boolean }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(`https://api.trongrid.io/v1/accounts/${address}`, { signal: AbortSignal.timeout(15000) });
      if (r.status === 429) { await sleep(2000); continue; }
      const j = (await r.json()) as any;
      if (j.success) {
        const d = j.data?.[0];
        const trx = (d?.balance ?? 0) / 1e6;
        const usdtEntry = (d?.trc20 ?? []).find((t: any) => t["TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"] !== undefined);
        return { trx, usdt: usdtEntry ? Number(Object.values(usdtEntry)[0]) / 1e6 : 0, activated: !!d };
      }
    } catch { await sleep(1200); }
  }
  return { trx: -1, usdt: -1, activated: false }; // -1 = chain silent (honest null)
}

async function ethBalance(address: string): Promise<number> {
  try {
    const r = await fetch("https://ethereum-rpc.publicnode.com", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] }), signal: AbortSignal.timeout(15000) });
    const j = (await r.json()) as any;
    if (typeof j.result === "string") return Number(BigInt(j.result) / 10n ** 12n) / 1e6;
  } catch {}
  return -1;
}

async function solBalance(address: string): Promise<number> {
  for (const node of ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"]) {
    try {
      const r = await fetch(node, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address] }), signal: AbortSignal.timeout(15000) });
      const j = (await r.json()) as any;
      if (j.result) return (j.result.value ?? 0) / 1e9;
    } catch {}
  }
  return -1;
}

async function btcBalance(address: string): Promise<{ funded: number; spent: number; txs: number }> {
  try {
    const r = await fetch(`https://mempool.space/api/address/${address}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return { funded: -1, spent: -1, txs: -1 };
    const j = (await r.json()) as any;
    const cs = j.chain_stats, ms = j.mempool_stats;
    return { funded: (cs.funded_txo_sum + (ms?.funded_txo_sum ?? 0)) / 1e8, spent: (cs.spent_txo_sum + (ms?.spent_txo_sum ?? 0)) / 1e8, txs: cs.tx_count + (ms?.tx_count ?? 0) };
  } catch { return { funded: -1, spent: -1, txs: -1 }; }
}

function parseRecovery() {
  const txt = readFileSync(RECOVERY_MD, "utf8");
  const seed = txt.match(/## 3\)[\s\S]*?\n([0-9a-f]{96})\s*\n/)?.[1] ?? null;
  const sec5 = txt.match(/## 5\)([\s\S]*?)(?=\n## 6\))/)?.[1] ?? "";
  const mnemonics = Array.from(sec5.matchAll(/^\s*([a-z]+(?:\s+[a-z]+){11,23})\s*$/gm)).map((m) => m[1]);
  return { seed, mnemonics };
}

function tronAddrFromW(privHex: string): string {
  const pubU = SigningKey.computePublicKey(("0x" + privHex) as `0x${string}`, false).slice(4);
  const kec = keccak256(Buffer.from(pubU, "hex"));
  const payload = Buffer.concat([Buffer.from([0x41]), Buffer.from(kec.slice(-40), "hex")]);
  const h2 = createHash("sha256").update(createHash("sha256").update(payload).digest()).digest();
  return bs58.encode(Buffer.concat([payload, h2.subarray(0, 4)]));
}

async function main() {
  const { seed, mnemonics } = parseRecovery();
  const zipManifest = JSON.parse(readFileSync(ZIP_DIR + "/wallets-public.json", "utf8"));

  /* ── 1. steem authority matrix (rewards-level control) ── */
  console.log("=== [1] STEEM AUTHORITY MATRIX — rewards-level control ===");
  const names = ["headcorner", ...AGENTS.filter((a) => a !== "headcorner")];
  const accounts = await steemRpc<any[]>("condenser_api.get_accounts", [names]);
  const vaultSteem = await db.vaultEntry.findMany({ where: { kind: "steem-key" } });
  const vaultPubBy: Record<string, Record<string, string>> = {};
  for (const v of vaultSteem) {
    if (!v.pub) continue;
    const m = /^(STM|TST)([1-9A-HJ-NP-Za-km-z]+)$/.exec(v.pub);
    if (!m) continue;
    try {
      const raw = Buffer.from(bs58.decode(m[2])).subarray(0, 33).toString("hex");
      if (v.account) (vaultPubBy[v.account] ??= {})[raw] = v.role ?? "?";
    } catch {}
  }
  const chainKeyRaw = (wire: string): string | null => {
    const m = /^(STM|TST)([1-9A-HJ-NP-Za-km-z]+)$/.exec(wire);
    if (!m) return null;
    try { return Buffer.from(bs58.decode(m[2])).subarray(0, 33).toString("hex"); } catch { return null; }
  };
  let withOwner = 0, withActive = 0, claimable = 0;
  for (const a of accounts) {
    const name = a.name;
    const roles: Record<string, string[]> = { owner: [], active: [], posting: [] };
    for (const role of ["owner", "active", "posting"] as const) {
      const keyAuths = a[role]?.key_auths ?? [];
      for (const k of keyAuths) {
        const raw = chainKeyRaw(String(k[0]));
        const vRole = raw ? vaultPubBy[name]?.[raw] : undefined;
        if (vRole) roles[role].push(`${vRole}(vault)→${role}(chain)`);
      }
    }
    const hits = [...roles.owner, ...roles.active, ...roles.posting];
    const ownerHit = roles.owner.length > 0, activeHit = roles.active.length > 0, postingHit = roles.posting.length > 0;
    if (ownerHit) withOwner++;
    if (activeHit) withActive++;
    if (postingHit || ownerHit || activeHit) claimable++;
    const bal = { s: parseFloat(a.balance), sbd: parseFloat(a.sbd_balance), v: parseFloat(a.vesting_shares), rS: a.reward_steem_balance, rSbd: a.reward_sbd_balance, rV: a.reward_vesting_balance };
    const pendingRewards = parseFloat(a.reward_steem_balance) + parseFloat(a.reward_sbd_balance) + parseFloat(a.reward_vesting_balance) > 0;
    console.log(`  ${name.padEnd(11)} bal=${bal.s}STEEM/${bal.sbd}SBD/${(bal.v / 1e6).toFixed(1)}MVESTS pending=${pendingRewards ? "YES" : "no"} · vault-controls: owner=${ownerHit ? "YES" : "NO"} active=${activeHit ? "YES" : "NO"} posting=${postingHit ? "YES" : "NO"} ${hits.length === 0 && name !== "ynet" ? "⚠️ NO VAULT MATCH" : ""}`);
  }
  console.log(`  verdict: owner-control ${withOwner}/${accounts.length} · active-control ${withActive}/${accounts.length} · claim-path exists ${claimable}/${accounts.length}`);

  /* ── 2. wallet balance sweep ── */
  console.log("\n=== [2] WALLET BALANCES (live) ===");
  if (seed) {
    const evmRoot = HDNodeWallet.fromSeed(sha256buf(seed + "|evm|44/60"));
    const tronRoot = HDNodeWallet.fromSeed(sha256buf(seed + "|tron|44/195"));
    const btcRoot = HDNodeWallet.fromSeed(sha256buf(seed + "|btc|84/0"));
    let tronSum = 0, tronSilent = 0, ethSum = 0, ethSilent = 0, solSum = 0, solSilent = 0, btcFunded = 0;
    console.log("  -- fleet (sovereign seed → 12 agents × 4 families) --");
    for (const name of AGENTS) {
      const i = AGENTS.indexOf(name);
      const tronW = tronRoot.derivePath("m/44'/195'/0'/0/" + i);
      const tronA = tronAddrFromW(tronW.privateKey.slice(2));
      const evmA = evmRoot.derivePath("m/44'/60'/0'/0/" + i).address;
      const solA = bs58.encode(Buffer.from(ed25519.getPublicKey(sha256buf(seed + "|sol|" + name))));
      const btcA = (() => { // bech32 P2WPKH v0 with witness byte
        const B32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
        const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
        const polymod = (values: number[]) => { let chk = 1; for (const v of values) { const b = chk >> 25; chk = ((chk & 0x1ffffff) << 5) ^ v; for (let k = 0; k < 5; k++) if ((b >> k) & 1) chk ^= GEN[k]; } return chk; };
        const h160 = createHash("ripemd160").update(createHash("sha256").update(Buffer.from(btcRoot.derivePath("m/84'/0'/0'/0/" + i).publicKey.slice(2), "hex")).digest()).digest();
        const conv = (data: number[], from: number, to: number, pad: boolean) => { let acc = 0, bits = 0; const out: number[] = []; const maxv = (1 << to) - 1; for (const v of data) { acc = (acc << from) | v; bits += from; while (bits >= to) { bits -= to; out.push((acc >> bits) & maxv); } } if (pad && bits) out.push((acc << (to - bits)) & maxv); return out; };
        const hrp = "bc"; const hrpExp: number[] = []; for (const c of hrp) hrpExp.push(c.charCodeAt(0) >> 5, c.charCodeAt(0) & 31);
        const prog = conv(Array.from(h160), 8, 5, true);
        const data = [...hrpExp, 0, ...prog];
        const mod = polymod([...data, 0, 0, 0, 0, 0, 0]) ^ 1;
        const chk: number[] = []; for (let k = 0; k < 6; k++) chk.push((mod >> (5 * (5 - k))) & 31);
        return hrp + "1" + [0, ...prog, ...chk].map((d) => B32[d]).join("");
      })();
      const t = await tronBalance(tronA);
      const e = await ethBalance(evmA);
      const s = await solBalance(solA);
      const b = await btcBalance(btcA);
      if (t.trx < 0) tronSilent++; else tronSum += t.trx;
      if (e < 0) ethSilent++; else ethSum += e;
      if (s < 0) solSilent++; else solSum += s;
      if (b.txs > 0) btcFunded++;
      console.log(`  ${name.padEnd(11)} tron ${tronA} ${t.trx < 0 ? "SILENT" : t.trx + "TRX" + (t.usdt ? "/" + t.usdt + "USDT" : "")} · eth ${evmA} ${e < 0 ? "SILENT" : e + "ETH"} · sol ${solA.slice(0, 12)}… ${s < 0 ? "SILENT" : s + "SOL"} · btc ${btcA} ${b.txs < 0 ? "SILENT" : `txs=${b.txs}${b.funded > 0 ? " FUNDED " + b.funded + "BTC" : ""}`}`);
      await sleep(150);
    }
    console.log(`  fleet sums: TRX=${tronSum} (${tronSilent} silent) · ETH=${ethSum} (${ethSilent} silent) · SOL=${solSum} (${solSilent} silent) · BTC addresses ever-funded: ${btcFunded}`);

    console.log("  -- bridge family (vault mnemonic#2 → doors 0..5) --");
    const bridge = JSON.parse(readFileSync(ZIP_DIR + "/tron-bridge-state.json", "utf8"));
    const roles0 = ["sender", "relay", "squad2", "squad3", "squad4", "squad5"];
    let bridgeTrx = 0, bridgeSilent = 0;
    for (let i = 0; i < 6; i++) {
      const a = tronAddrFromW(HDNodeWallet.fromPhrase(mnemonics[1], undefined, "m/44'/195'/0'/0/" + i).privateKey.slice(2));
      const t = await tronBalance(a);
      if (t.trx < 0) bridgeSilent++; else bridgeTrx += t.trx;
      console.log(`  bridge.${roles0[i].padEnd(7)} ${a} ${t.trx < 0 ? "SILENT" : t.trx + "TRX" + (t.usdt ? "/" + t.usdt + "USDT" : "")} · in-bridge-state=${bridge.address === a ? "sender" : (bridge.squadAddresses ?? []).includes(a) ? "squad" : "relay?"}`);
      await sleep(150);
    }
    console.log(`  bridge sums: TRX=${bridgeTrx} (${bridgeSilent} silent)`);

    console.log("  -- sovereign-mnemonic#1 doors 0..5 (what do THEY control?) --");
    for (let i = 0; i < 6; i++) {
      const a = tronAddrFromW(HDNodeWallet.fromPhrase(mnemonics[0], undefined, "m/44'/195'/0'/0/" + i).privateKey.slice(2));
      const t = await tronBalance(a);
      console.log(`  sov.door${i} ${a} ${t.trx < 0 ? "SILENT" : t.trx + "TRX" + (t.usdt ? "/" + t.usdt + "USDT" : "")}`);
      await sleep(150);
    }
  }

  console.log("  -- OLD anchored family (seed-A, superseded 2026-09-07T12:02) — are they empty? --");
  let oldSum = 0, oldFunded = 0;
  for (const a of zipManifest.agents) {
    const t = await tronBalance(a.tron);
    if (t.trx > 0) oldFunded++;
    if (t.trx > 0) oldSum += t.trx;
    console.log(`  old.${a.agent.padEnd(11)} ${a.tron} ${t.trx < 0 ? "SILENT" : t.trx + "TRX"}`);
    await sleep(150);
  }
  console.log(`  old-family TRX total=${oldSum} funded-addresses=${oldFunded}`);

  await db.$disconnect();
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
