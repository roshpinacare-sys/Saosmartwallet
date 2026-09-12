/**
 * r37 — COINOMI DEEP-SCAN ("בדיקת-המפתח לעומק" על ביטוי-השחזור מהקונמי).
 *
 * Reads upload/קונמי.txt (line 1 = the 24-word recovery phrase), derives the
 * STANDARD first addresses (BIP39 → BIP32 → BIP44/49/84, account 0) and checks
 * LIVE balances:
 *   · BTC  — legacy P2PKH (1…), P2SH-P2WPKH (3…), bech32 P2WPKH (bc1…)
 *   · ETH  — m/44'/60'/0'/0/{0,1,2}
 *   · LTC  — legacy P2PKH (L…)
 *   · DOGE — legacy P2PKH (D…)
 *
 * NEVER prints the phrase, the seed, or any private key. Addresses and
 * balances are public data. A down API is an honest miss, never a zero.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash, createHmac, pbkdf2Sync } from "node:crypto";
import { SigningKey, keccak256, getAddress, formatEther } from "ethers";
import { base58, bech32 } from "@scure/base";

const PHRASE_FILE = "/home/z/my-project/upload/קונמי.txt";
const OUT_FILE = "/tmp/r37-coinomi-scan.json";

const CURVE_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const HARD = 0x80000000;

/* ── primitives (node crypto + ethers — the proven stack from key-id.ts) ── */

function sha256d(b: Buffer): Buffer {
  return createHash("sha256").update(createHash("sha256").update(b).digest()).digest();
}
function hash160(pub: Buffer): Buffer {
  return createHash("ripemd160").update(createHash("sha256").update(pub).digest()).digest();
}
function compressedPub(priv: Buffer): Buffer {
  return Buffer.from(SigningKey.computePublicKey(("0x" + priv.toString("hex")) as `0x${string}`, true).slice(2), "hex");
}
function b58check(version: number, payload: Buffer): string {
  const body = Buffer.concat([Buffer.from([version]), payload]);
  return base58.encode(Buffer.concat([body, sha256d(body).subarray(0, 4)]));
}
function p2pkh(pub: Buffer, version: number): string {
  return b58check(version, hash160(pub));
}
function p2shP2wpkh(pub: Buffer, version: number): string {
  const redeem = Buffer.concat([Buffer.from([0x00, 0x14]), hash160(pub)]);
  return b58check(version, hash160(redeem));
}
function p2wpkh(pub: Buffer, hrp = "bc"): string {
  return bech32.encode(hrp, [0, ...bech32.toWords(hash160(pub))]);
}
function ethAddress(priv: Buffer): string {
  const pubU = SigningKey.computePublicKey(("0x" + priv.toString("hex")) as `0x${string}`, false);
  return getAddress("0x" + keccak256(Buffer.from(pubU.slice(4), "hex")).slice(-40));
}

/* ── BIP39 seed (no wordlist needed — the phrase came straight from the operator) ── */

function bip39Seed(mnemonic: string, passphrase = ""): Buffer {
  return pbkdf2Sync(mnemonic.normalize("NFKD"), "mnemonic" + passphrase, 2048, 64, "sha512");
}

/* ── minimal BIP32 (CKDpriv) ── */

interface Node { k: Buffer; c: Buffer }
function masterFromSeed(seed: Buffer): Node {
  const I = createHmac("sha512", "Bitcoin seed").update(seed).digest();
  return { k: I.subarray(0, 32), c: I.subarray(32) };
}
function ckd(n: Node, index: number): Node {
  const serP = index >= HARD
    ? Buffer.concat([Buffer.alloc(1, 0), n.k])
    : compressedPub(n.k);
  const ser32 = Buffer.from([(index >>> 24) & 0xff, (index >>> 16) & 0xff, (index >>> 8) & 0xff, index & 0xff]);
  const I = createHmac("sha512", n.c).update(Buffer.concat([serP, ser32])).digest();
  const il = BigInt("0x" + I.subarray(0, 32).toString("hex"));
  const kn = (il + BigInt("0x" + n.k.toString("hex"))) % CURVE_N;
  if (il >= CURVE_N || kn === 0n) throw new Error("CKD out of range");
  return { k: Buffer.from(kn.toString(16).padStart(64, "0"), "hex"), c: I.subarray(32) };
}
function derivePath(seed: Buffer, path: string): Node {
  let n = masterFromSeed(seed);
  for (const part of path.split("/").slice(1)) {
    const hardened = part.endsWith("'") || part.endsWith("h");
    n = ckd(n, parseInt(part.replace(/['h]$/, ""), 10) + (hardened ? HARD : 0));
  }
  return n;
}

/* ── live balance probes ── */

async function btcBalance(addr: string): Promise<{ sats: number | null; txs: number | null; via: string }> {
  const endpoints = [
    { via: "blockstream", url: `https://blockstream.info/api/address/${addr}` },
    { via: "mempool.space", url: `https://mempool.space/api/address/${addr}` },
  ];
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, { signal: AbortSignal.timeout(12_000) });
      if (!res.ok) continue;
      const j = (await res.json()) as { chain_stats?: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number } };
      if (j.chain_stats) {
        return { sats: j.chain_stats.funded_txo_sum - j.chain_stats.spent_txo_sum, txs: j.chain_stats.tx_count, via: ep.via };
      }
    } catch { /* next endpoint */ }
  }
  return { sats: null, txs: null, via: "unreachable" };
}

async function evmBalance(rpc: string, addr: string, sym: string): Promise<{ amount: string | null; via: string }> {
  try {
    const res = await fetch(rpc, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_getBalance", params: [addr, "latest"], id: 1 }),
      signal: AbortSignal.timeout(12_000),
    });
    const j = (await res.json()) as { result?: string };
    if (j.result != null) return { amount: formatEther(BigInt(j.result)), via: sym };
  } catch { /* honest miss */ }
  return { amount: null, via: "unreachable" };
}

async function blockchairBalance(chain: string, addr: string): Promise<{ amount: string | null; via: string }> {
  try {
    const res = await fetch(`https://api.blockchair.com/${chain}/dashboards/address/${addr}`, { signal: AbortSignal.timeout(12_000) });
    const j = (await res.json()) as { data?: Record<string, { address?: { balance?: string } }> };
    const b = j.data?.[addr]?.address?.balance;
    if (b != null) return { amount: (Number(b) / 1e8).toFixed(8), via: `blockchair:${chain}` };
  } catch { /* honest miss */ }
  return { amount: null, via: "unreachable" };
}

/* ── main ── */

async function main(): Promise<void> {
  const line1 = (readFileSync(PHRASE_FILE, "utf8").split(/\r?\n/)[0] || "").trim().toLowerCase();
  const words = line1.split(/\s+/);
  if (words.length < 12 || words.length > 24 || !words.every((w) => /^[a-z]+$/.test(w))) {
    console.error("קונמי: השורה-הראשונה אינה ביטוי-שחזור תקני — נעצר (שום דבר לא נחשף)");
    process.exit(1);
  }
  const phrase = words.join(" ");
  console.log(`קונמי: ביטוי זוהה — ${words.length} מילים (חומר-הסוד עצמו לא מודפס לעולם)`);

  const seed = bip39Seed(phrase);
  const report: Record<string, unknown> = { at: new Date().toISOString(), words: words.length, coins: [] };

  interface Row { path: string; address: string; balance: string; via: string }
  const coins: { coin: string; rows: Row[]; note?: string }[] = [];
  const push = (coin: string, rows: Row[], note?: string) => coins.push({ coin, rows, note });

  // BTC — three address generations, indices 0..2 on legacy (Coinomi default account 0)
  const btcRows: Row[] = [];
  for (const i of [0, 1, 2]) {
    const node = derivePath(seed, `m/44'/0'/0'/0/${i}`);
    const pub = compressedPub(node.k);
    const addr = p2pkh(pub, 0x00);
    const b = await btcBalance(addr);
    btcRows.push({ path: `m/44'/0'/0'/0/${i}`, address: addr, balance: b.sats == null ? "לא-נמדד" : `${(b.sats / 1e8).toFixed(8)} BTC`, via: b.via });
  }
  {
    const node = derivePath(seed, "m/49'/0'/0'/0/0");
    const addr = p2shP2wpkh(compressedPub(node.k), 0x05);
    const b = await btcBalance(addr);
    btcRows.push({ path: "m/49'/0'/0'/0/0", address: addr, balance: b.sats == null ? "לא-נמדד" : `${(b.sats / 1e8).toFixed(8)} BTC`, via: b.via });
  }
  {
    const node = derivePath(seed, "m/84'/0'/0'/0/0");
    const addr = p2wpkh(compressedPub(node.k));
    const b = await btcBalance(addr);
    btcRows.push({ path: "m/84'/0'/0'/0/0", address: addr, balance: b.sats == null ? "לא-נמדד" : `${(b.sats / 1e8).toFixed(8)} BTC`, via: b.via });
  }
  push("BTC", btcRows);

  // ETH — indices 0..2
  const ethRows: Row[] = [];
  for (const i of [0, 1, 2]) {
    const node = derivePath(seed, `m/44'/60'/0'/0/${i}`);
    const addr = ethAddress(node.k);
    const b = await evmBalance("https://ethereum-rpc.publicnode.com", addr, "publicnode");
    ethRows.push({ path: `m/44'/60'/0'/0/${i}`, address: addr, balance: b.amount == null ? "לא-נמדד" : `${b.amount} ETH`, via: b.via });
  }
  push("ETH", ethRows);

  // LTC + DOGE — legacy, index 0
  {
    const node = derivePath(seed, "m/44'/2'/0'/0/0");
    const addr = p2pkh(compressedPub(node.k), 0x30);
    const b = await blockchairBalance("litecoin", addr);
    push("LTC", [{ path: "m/44'/2'/0'/0/0", address: addr, balance: b.amount == null ? "לא-נמדד" : `${b.amount} LTC`, via: b.via }]);
  }
  {
    const node = derivePath(seed, "m/44'/3'/0'/0/0");
    const addr = p2pkh(compressedPub(node.k), 0x1e);
    const b = await blockchairBalance("dogecoin", addr);
    push("DOGE", [{ path: "m/44'/3'/0'/0/0", address: addr, balance: b.amount == null ? "לא-נמדד" : `${b.amount} DOGE`, via: b.via }]);
  }

  report.coins = coins;
  writeFileSync(OUT_FILE, JSON.stringify(report, null, 2), { mode: 0o600 });

  console.log("\n── תוצאות-סריקה (כתובות-ציבוריות בלבד) ──");
  for (const c of coins) {
    console.log(`\n${c.coin}:`);
    for (const r of c.rows) console.log(`  ${r.path}  ${r.address}  יתרה: ${r.balance} [${r.via}]`);
  }
  console.log(`\nדוח מלא נשמר: ${OUT_FILE}`);
}

main().catch((e) => { console.error("scan failed:", String(e).slice(0, 300)); process.exit(1); });
