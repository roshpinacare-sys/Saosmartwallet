/**
 * r11 part 2 — the decisive checks the reconcile left open. READ-ONLY.
 *  A. scan headcorner custom_json history for saos wallet anchors — is there a NEWER
 *     manifest (post-2026-09-09) with the seed-B addresses? → public-identity truth.
 *  B. BTC isolate: derived btc pubkey vs §4 listed pub (derivation vs bech32 encoding).
 *  C. bridge relay retest (proper extraction) + legacy doors 0–1 of both mnemonics.
 */
import { readFileSync } from "fs";
import { createHash } from "crypto";
import { HDNodeWallet, SigningKey, keccak256 } from "ethers";
import bs58 from "bs58";
import { ed25519 } from "@noble/curves/ed25519.js";

const RECOVERY_MD = "/tmp/my-project/MASTER-KEYS-RECOVERY-2026-09-09.md";
const ZIP_DIR = "/tmp/r11/extracted/steem-main/sovereign/node";
const AGENTS = ["cashmachine","haran","headcorner","israelnews","lsa","macrame","siq","tov","wic","wog","woq","ynet"];
const sha256buf = (s: string) => createHash("sha256").update(s).digest();

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(20000) });
  const j = (await res.json()) as any;
  if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200));
  return j.result as T;
}

/* ── A: custom_json wallet anchors on steem (id saos / saos-dex.anchor.v1), latest first ── */
async function scanAnchors() {
  const urls = ["https://api.steemit.com", "https://api.justyy.com"];
  let head = -1;
  for (const u of urls) {
    try { const h = await rpc<any>(u, "condenser_api.get_dynamic_global_properties", []); head = h.head_block_number; break; } catch {}
  }
  console.log(`[A] steem head=${head} — scanning headcorner account history for custom_json wallet anchors`);
  // walk back in chunks until 2026-09-06 (justyy allows large batches; steemit caps 100)
  let start = -1;
  const anchors: { ts: string; id: string; digest?: string; count?: number; firstTron?: string }[] = [];
  let guard = 0;
  let stop = false;
  while (!stop && guard++ < 400) {
    const limit = start === -1 ? 2000 : 2000;
    let batch: Array<[number, any]>;
    try {
      batch = await rpc<Array<[number, any]>>("https://api.justyy.com", "condenser_api.get_account_history", ["headcorner", start, limit]);
    } catch {
      batch = await rpc<Array<[number, any]>>("https://api.steemit.com", "condenser_api.get_account_history", ["headcorner", start, Math.min(limit, 100)]);
    }
    if (!batch.length) break;
    batch.reverse();
    for (const [idx, t] of batch) {
      if (t.timestamp < "2026-09-06T00:00:00") { stop = true; break; }
      if (t.op[0] === "custom_json") {
        const id = String(t.op[1].id || "");
        if (id === "saos" || id.includes("wallet")) {
          let j: any = {};
          try { j = JSON.parse(t.op[1].json); } catch {}
          if (j.protocol?.startsWith("saos:wallets") || j.action === "wallets" || id.includes("wallet")) {
            anchors.push({ ts: t.timestamp, id, digest: j.digest, count: j.count ?? j.agents?.length, firstTron: j.agents?.[0]?.tron ?? j.agents?.[2]?.tron });
          }
        }
      }
      if (start === -1 || idx < start) start = idx;
    }
    start = start - 1;
    if (start <= 0) break;
  }
  console.log(`  wallet-anchors found: ${anchors.length}`);
  for (const a of anchors) console.log(`   ${a.ts} id=${a.id} count=${a.count} digest=${(a.digest ?? "").slice(0, 16)} firstTron=${a.firstTron ?? "—"}`);
  return anchors;
}

/* ── B: BTC isolate ── */
function parseRecovery() {
  const txt = readFileSync(RECOVERY_MD, "utf8");
  const seed = txt.match(/## 3\)[\s\S]*?\n([0-9a-f]{96})\s*\n/)?.[1] ?? null;
  const sec4 = txt.match(/## 4\)([\s\S]*?)(?=\n## 5\))/)?.[1] ?? "";
  const fleet: Record<string, { btc?: string; btcPub?: string }> = {};
  for (const b of sec4.split(/^###\s+/m).slice(1)) {
    const name = /^([a-z0-9-]+)/.exec(b)?.[1]; if (!name) continue;
    fleet[name] = {
      btc: /BTC[^`]*`(bc1[a-z0-9]{20,62})`/.exec(b)?.[1],
      btcPub: /BTC[^`]*pub:\s*`(0x[0-9a-f]{66})`/.exec(b)?.[1],
    };
  }
  const sec5 = txt.match(/## 5\)([\s\S]*?)(?=\n## 6\))/)?.[1] ?? "";
  const mnemonics = Array.from(sec5.matchAll(/^\s*([a-z]+(?:\s+[a-z]+){11,23})\s*$/gm)).map((m) => m[1]);
  return { seed, fleet, mnemonics };
}

const B32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) { const b = chk >> 25; chk = ((chk & 0x1ffffff) << 5) ^ v; for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i]; }
  return chk;
}
function btcP2wpkh(pubKey: Buffer, hrp: string): string {
  const h160 = createHash("ripemd160").update(createHash("sha256").update(pubKey).digest()).digest();
  const convert = (data: number[], from: number, to: number, pad: boolean) => {
    let acc = 0, bits = 0; const out: number[] = []; const maxv = (1 << to) - 1;
    for (const v of data) { acc = (acc << from) | v; bits += from; while (bits >= to) { bits -= to; out.push((acc >> bits) & maxv); } }
    if (pad && bits) out.push((acc << (to - bits)) & maxv);
    return out;
  };
  const prog = convert(Array.from(h160), 8, 5, true);
  const hrpExp: number[] = [];
  for (const c of hrp) hrpExp.push(c.charCodeAt(0) >> 5, c.charCodeAt(0) & 31);
  const data = [...hrpExp, 0, ...prog];
  const mod = bech32Polymod([...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const chk: number[] = [];
  for (let i = 0; i < 6; i++) chk.push((mod >> (5 * (5 - i))) & 31);
  return hrp + "1" + [...prog, ...chk].map((d) => B32[d]).join("");
}

function tronAddrFromW(privHex: string): string {
  const pubU = SigningKey.computePublicKey(("0x" + privHex) as `0x${string}`, false).slice(4);
  const kec = keccak256(Buffer.from(pubU, "hex"));
  const payload = Buffer.concat([Buffer.from([0x41]), Buffer.from(kec.slice(-40), "hex")]);
  const h2 = createHash("sha256").update(createHash("sha256").update(payload).digest()).digest();
  return bs58.encode(Buffer.concat([payload, h2.subarray(0, 4)]));
}

async function main() {
  const { seed, fleet, mnemonics } = parseRecovery();

  await scanAnchors();

  console.log(`\n[B] BTC isolate (seed present: ${!!seed})`);
  if (seed) {
    const btcRoot = HDNodeWallet.fromSeed(sha256buf(seed + "|btc|84/0"));
    for (const name of AGENTS.slice(0, 3)) {
      const i = AGENTS.indexOf(name);
      const w = btcRoot.derivePath("m/84'/0'/0'/0/" + i);
      const pubC = w.publicKey.slice(2); // 33→32? no: publicKey = 0x04uncompressed? ethers gives compressed 33B starting 02/03
      const derivedAddr = btcP2wpkh(Buffer.from(pubC, "hex"), "bc");
      const f = fleet[name];
      console.log(`  ${name}: derived-pub ${pubC.slice(0, 14)}… listed-pub ${(f.btcPub ?? "—").slice(0, 16)}… pubMatch=${(f.btcPub ?? "").toLowerCase().endsWith(pubC.toLowerCase())} · derived-addr ${derivedAddr} · listed-addr ${f.btc ?? "—"} match=${derivedAddr === f.btc}`);
    }
  }

  console.log("\n[C] bridge mnemonic full test (sender/relay/squad, proper relay extraction)");
  const bridge = JSON.parse(readFileSync(ZIP_DIR + "/tron-bridge-state.json", "utf8"));
  const relayAddr = bridge.derivatives?.usdt?.find((u: any) => u.role === "relay")?.address ?? bridge.wallet?.relay?.address;
  const target = new Set([bridge.address, relayAddr, ...(bridge.squadAddresses ?? [])].filter((x: any) => typeof x === "string"));
  console.log(`  targets: ${[...target].join(", ")}`);
  mnemonics.forEach((m, mi) => {
    const hits: string[] = [];
    for (let i = 0; i < 8; i++) {
      const a = tronAddrFromW(HDNodeWallet.fromPhrase(m, undefined, "m/44'/195'/0'/0/" + i).privateKey.slice(2));
      if (target.has(a)) hits.push(`idx${i}`);
    }
    console.log(`  mnemonic#${mi + 1}: hits=[${hits.join(",")}] ${hits.length >= 5 ? "← BRIDGE MNEMONIC (sender+relay+squad all derived)" : ""}`);
  });

  console.log("\n[C2] sol-family spot check: fleet SOL derives from seed (reconcile says 12/12) — zip anchored SOL vs seed (expected 0/12, already proven for tron)");
  if (seed) {
    for (const name of ["cashmachine", "headcorner"]) {
      const solPub = ed25519.getPublicKey(sha256buf(seed + "|sol|" + name));
      console.log(`  ${name}: seed-sol ${bs58.encode(Buffer.from(solPub)).slice(0, 16)}…`);
    }
  }
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
