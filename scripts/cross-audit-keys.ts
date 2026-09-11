/**
 * cross-audit-keys.ts — roast-75 · key-audit "test everything"
 * Full cross-audit: mother vault (149 rows) vs live chains.
 *
 * A. graphene (steem/hive/blurt): live authorities for 11 accounts x 4 roles
 *    vs all vault rows of that chain (key-body compare) -> honest verified updates.
 * B. wallets (tron/sol/evm): decrypt -> derive address locally -> self-compare
 *    vs stored address -> live balance via public RPC. btc: watch-only balance.
 * C. door identities (from daemon .env): fingerprint match vs vault rows + live custody.
 *
 * Safety: zero secret prints. Only pubkeys, addresses, balances, fingerprints, booleans.
 * Explicit UA on all fetches (74-f Cloudflare lesson).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import steemLibRaw from "steem";
import { secp256k1 } from "/home/z/my-project/saos-dex/node_modules/@noble/curves/secp256k1.js";
import { ed25519 } from "/home/z/my-project/saos-dex/node_modules/@noble/curves/ed25519.js";
import { keccak_256 } from "/home/z/my-project/saos-dex/node_modules/@noble/hashes/sha3.js";
import bs58 from "bs58";

interface SteemAuth { auth: { wifToPublic(wif: string): string } }
const steemLib = steemLibRaw as unknown as SteemAuth;

const UA = "SAOS-Sovereign-Audit/1.0 (+sovereign-chain)";
const NODES: Record<string, string[]> = {
  steem: ["https://api.steemit.com", "https://steemapi.boylikegirl.club"],
  hive: ["https://api.hive.blog", "https://api.deathwing.me"],
  blurt: ["https://rpc.blurt.blog"],
};
const ACCOUNTS = ["headcorner", "cashmachine", "haran", "israelnews", "lsa", "macrame", "siq", "tov", "wic", "wog", "woq"];
const DEX_ENV = "/home/z/my-project/saos-dex/.env";

function body(pub: string): string { return pub.replace(/^(STM|BLT|TST)/, ""); }

async function rpc<T>(chain: string, method: string, params: unknown[]): Promise<T> {
  let lastErr = "";
  for (const node of NODES[chain]) {
    try {
      const r = await fetch(node, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": UA },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) { lastErr = `${node} -> ${r.status}`; continue; }
      const j = (await r.json()) as { result?: T; error?: { message?: string } };
      if (j.error) { lastErr = `${node} -> ${j.error.message ?? "rpc-error"}`; continue; }
      return j.result as T;
    } catch (e) { lastErr = `${node} -> ${String((e as Error).message).slice(0, 80)}`; }
  }
  throw new Error(`all nodes failed for ${chain}: ${lastErr}`);
}

interface ChainAcct {
  name: string;
  posting?: { key_auths?: [string, number][] };
  active?: { key_auths?: [string, number][] };
  owner?: { key_auths?: [string, number][] };
  memo_key?: string;
}

async function partA(db: PrismaClient): Promise<void> {
  console.log("=== A. graphene: live authorities vs vault ===");
  for (const chain of ["steem", "hive", "blurt"]) {
    const rows = await db.vaultKey.findMany({
      where: { chain },
      select: { id: true, account: true, role: true, pubKey: true, fingerprint: true, verified: true },
    });
    const byBody = new Map<string, { id: string; label: string }>();
    for (const r of rows) if (r.pubKey) byBody.set(body(r.pubKey), { id: r.id, label: `${r.account}/${r.role}` });

    const accounts = await rpc<ChainAcct[]>(chain, "condenser_api.get_accounts", [ACCOUNTS]);
    console.log(`--- ${chain}: ${accounts.length}/11 live accounts ---`);
    const verifiedNow: string[] = [];
    for (const a of accounts) {
      const live: { role: string; pubs: string[] }[] = [
        { role: "posting", pubs: (a.posting?.key_auths ?? []).map((k) => k[0]) },
        { role: "active", pubs: (a.active?.key_auths ?? []).map((k) => k[0]) },
        { role: "owner", pubs: (a.owner?.key_auths ?? []).map((k) => k[0]) },
        { role: "memo", pubs: a.memo_key ? [a.memo_key] : [] },
      ];
      const parts: string[] = [];
      for (const { role, pubs } of live) {
        for (const p of pubs) {
          const hit = byBody.get(body(p));
          if (hit) { parts.push(`${role}=>${hit.label}`); verifiedNow.push(hit.id); }
          else parts.push(`${role}=>UNKNOWN(${p.slice(0, 10)}...)`);
        }
      }
      console.log(`  ${a.name.padEnd(14)} ${parts.length ? parts.join(" | ") : "(none)"}`);
    }
    for (const id of new Set(verifiedNow)) {
      await db.vaultKey.update({ where: { id }, data: { verified: true, lastVerifiedAt: new Date(), lastError: null } });
    }
    const notLive = rows.filter((r) => !verifiedNow.includes(r.id) && r.pubKey);
    for (const r of notLive) {
      await db.vaultKey.update({
        where: { id: r.id },
        data: { verified: false, lastError: `no live authority match on ${chain} @ ${new Date().toISOString()}` },
      });
    }
    console.log(`  summary ${chain}: live-matched=${new Set(verifiedNow).size}/${rows.filter((r) => r.pubKey).length} rows (honest update)`);
  }
}

/* --- B. address derivations --- */
function b58check(payload: Buffer): string {
  const chk = crypto.createHash("sha256").update(crypto.createHash("sha256").update(payload).digest()).digest().subarray(0, 4);
  return bs58.encode(Buffer.concat([payload, chk]));
}
function tronAddrFromPk(pkHex: string): string | null {
  try {
    const pk = pkHex.startsWith("0x") ? pkHex.slice(2) : pkHex;
    const priv = Buffer.from(pk, "hex");
    if (priv.length !== 32) return null;
    const pub65 = Buffer.from(secp256k1.getPublicKey(priv, false));
    const h = keccak_256(pub65.subarray(1));
    return b58check(Buffer.concat([Buffer.from([0x41]), h.subarray(12)]));
  } catch { return null; }
}
function evmAddrFromPk(pkHex: string): string | null {
  try {
    const pk = pkHex.startsWith("0x") ? pkHex.slice(2) : pkHex;
    const priv = Buffer.from(pk, "hex");
    if (priv.length !== 32) return null;
    const pub65 = Buffer.from(secp256k1.getPublicKey(priv, false));
    return "0x" + Buffer.from(keccak_256(pub65.subarray(1)).subarray(12)).toString("hex");
  } catch { return null; }
}
function solAddrFromPk(pk: string): string | null {
  try {
    let raw: Buffer;
    if (/^[0-9a-fA-F]{64}$/.test(pk.trim()) || /^[0-9a-fA-F]{128}$/.test(pk.trim())) raw = Buffer.from(pk, "hex");
    else raw = bs58.decode(pk.trim());
    const seed = raw.subarray(0, 32);
    return bs58.encode(Buffer.from(ed25519.getPublicKey(seed)));
  } catch { return null; }
}

async function getJson<T>(url: string, opts?: RequestInit): Promise<T | null> {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, ...(opts?.headers ?? {}) }, signal: AbortSignal.timeout(15_000), ...opts });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch { return null; }
}

async function partB(db: PrismaClient): Promise<void> {
  console.log("=== B. wallets: self-derivation + live balance ===");
  const rows = await db.vaultKey.findMany({
    where: { chain: { in: ["tron", "sol", "evm", "btc"] }, role: "wallet" },
    select: { account: true, chain: true, cipher: true, address: true },
  });
  const { decryptSecret } = await import("../src/lib/vault");
  for (const chain of ["tron", "sol", "evm", "btc"]) {
    const sub = rows.filter((r) => r.chain === chain);
    console.log(`--- ${chain}: ${sub.length} wallets ---`);
    for (const r of sub) {
      const addr = r.address ?? "";
      let balance = "?";
      let selfOk: boolean | null = null;
      try {
        if (chain === "btc") {
          const j = await getJson<{ chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number } }>(`https://blockstream.info/api/address/${addr}`);
          if (j?.chain_stats) {
            const s = (j.chain_stats.funded_txo_sum ?? 0) - (j.chain_stats.spent_txo_sum ?? 0);
            balance = `${s} sat`;
          } else balance = "rpc-fail";
        } else {
          const pk = decryptSecret(r.cipher);
          const derived = chain === "tron" ? tronAddrFromPk(pk) : chain === "evm" ? evmAddrFromPk(pk) : solAddrFromPk(pk);
          selfOk = derived ? derived.toLowerCase() === addr.toLowerCase() : false;
          if (chain === "tron") {
            const j = await getJson<{ data?: { balance?: number }[] }>(`https://api.trongrid.io/v1/accounts/${addr}`);
            balance = j?.data?.[0] ? `${j.data[0].balance ?? 0} sun` : "0 sun (empty/unfunded)";
          } else if (chain === "sol") {
            const j = await getJson<{ result?: { value?: number } }>("https://api.mainnet-beta.solana.com", {
              method: "POST", headers: { "content-type": "application/json" },
              body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [addr, { commitment: "confirmed" }] }),
            });
            balance = `${j?.result?.value ?? 0} lamports`;
          } else {
            const j = await getJson<{ result?: string }>("https://ethereum-rpc.publicnode.com", {
              method: "POST", headers: { "content-type": "application/json" },
              body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [addr, "latest"] }),
            });
            balance = j?.result ? `${Number(BigInt(j.result)) / 1e18} ETH` : "rpc-fail";
          }
        }
      } catch (e) { balance = `err:${String((e as Error).message).slice(0, 40)}`; }
      console.log(`  ${r.account.padEnd(22)} ${addr.slice(0, 14)}... self=${selfOk === null ? "watch" : selfOk ? "OK" : "MISMATCH!"} bal=${balance}`);
    }
  }
}

/* --- C. door identities vs vault --- */
function readEnvVal(content: string, key: string): string {
  const m = content.match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^"|"$/g, "") : "";
}

async function partC(db: PrismaClient): Promise<void> {
  console.log("=== C. door identities (daemon .env) vs vault + custody ===");
  if (!fs.existsSync(DEX_ENV)) { console.log("  daemon .env not found — skip"); return; }
  const content = fs.readFileSync(DEX_ENV, "utf8");
  const { decryptSecret, fingerprint } = await import("../src/lib/vault");

  const steemWif = readEnvVal(content, "STEEM_ACTIVE_WIF");
  const solKey = readEnvVal(content, "SOL_PRIVATE_KEY");
  const ethKey = readEnvVal(content, "ETH_PRIVATE_KEY");

  const all = await db.vaultKey.findMany({ select: { id: true, account: true, chain: true, role: true, fingerprint: true } });
  const fpIndex = new Map(all.map((r) => [r.fingerprint, `${r.chain}/${r.account}/${r.role}`]));

  for (const [name, val] of [["STEEM_ACTIVE_WIF", steemWif], ["SOL_PRIVATE_KEY", solKey], ["ETH_PRIVATE_KEY", ethKey]] as const) {
    if (!val) { console.log(`  ${name}: missing in daemon env`); continue; }
    const fp = fingerprint(val);
    const hit = fpIndex.get(fp) ?? "NO vault match (external/stale material)";
    console.log(`  ${name}: fp=${fp.slice(0, 8)}... -> ${hit}`);
  }

  if (steemWif.length >= 51) {
    try {
      const raw = bs58.decode(steemWif);
      const priv = raw.subarray(1, 33);
      const pub65 = Buffer.from(secp256k1.getPublicKey(priv, false));
      const h = keccak_256(pub65.subarray(1));
      const trx = b58check(Buffer.concat([Buffer.from([0x41]), h.subarray(12)]));
      const j = await getJson<{ data?: { balance?: number }[] }>(`https://api.trongrid.io/v1/accounts/${trx}`);
      console.log(`  door-TRX-identity: ${trx.slice(0, 10)}... balance=${j?.data?.[0] ? `${j.data[0].balance ?? 0} sun` : "0 sun"}`);
    } catch { console.log("  door-TRX-identity: derivation failed"); }
  }
  if (solKey) {
    const a = solAddrFromPk(solKey);
    if (a) {
      const j = await getJson<{ result?: { value?: number } }>("https://api.mainnet-beta.solana.com", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [a, { commitment: "confirmed" }] }),
      });
      console.log(`  door-SOL-identity: ${a.slice(0, 10)}... balance=${j?.result?.value ?? 0} lamports`);
    }
  }
  if (ethKey) {
    const a = evmAddrFromPk(ethKey);
    if (a) {
      const j = await getJson<{ result?: string }>("https://ethereum-rpc.publicnode.com", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [a, "latest"] }),
      });
      console.log(`  door-ETH-identity: ${a.slice(0, 10)}... balance=${j?.result ? Number(BigInt(j.result)) / 1e18 : "rpc-fail"} ETH`);
    }
  }
  void db;
}

async function main(): Promise<void> {
  const db = new PrismaClient();
  try {
    await partA(db);
    await partB(db);
    await partC(db);
    console.log("=== audit done — zero secrets printed ===");
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => { console.error(`[cross-audit] FAILED: ${String((e as Error).message ?? e).slice(0, 300)}`); process.exit(1); });
