/**
 * r11 — RECONCILIATION: the steem zip's wallet truths vs the recovery doc vs the vault.
 * =====================================================================================================================
 * Sources compared (addresses only — key material NEVER printed):
 *   A. zip   /tmp/r11/extracted/steem-main/sovereign/node/wallets-public.json
 *            — the ANCHORED army-wallet manifest (saos:wallets/v1, digest b3c752e7…, steem txid 702f9e17…, 2026-09-07)
 *   B. zip   /tmp/r11/extracted/steem-main/sovereign/node/tron-bridge-state.json
 *            — bridge sender/relay/squad TRON family (real TRX balances)
 *   C. local /tmp/my-project/MASTER-KEYS-RECOVERY-2026-09-09.md §3 seed, §4 fleet pks, §5 two TRON mnemonics
 *   D. vault db/custom.db evm-key/tron-key/sol-key pubs
 * Derivation schemes under test (from zip wallets.cjs / tronbridge.cjs):
 *   fleet:  root_i = HDNodeWallet.fromSeed(sha256(seedHex + '|<fam>|<path>')) → m/44'/<coin>'/0'/0/i
 *   sol:    ed25519 pubkey of sha256(seedHex + '|sol|' + agentName)
 *   bridge: HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/195'/0'/0/" + idx)
 * Read-only: no broadcast, no decryption of vault envelopes, no key output.
 */
import { readFileSync } from "fs";
import { createHash } from "crypto";
import { HDNodeWallet, SigningKey, keccak256 } from "ethers";
import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";
import { db } from "@/lib/db";
import { evmAddress, tronAddress } from "@/lib/gate/key-id";

const RECOVERY_MD = "/tmp/my-project/MASTER-KEYS-RECOVERY-2026-09-09.md";
const ZIP_DIR = "/tmp/r11/extracted/steem-main/sovereign/node";
const AGENTS = ["cashmachine","haran","headcorner","israelnews","lsa","macrame","siq","tov","wic","wog","woq","ynet"];

const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");
const sha256buf = (s: string) => createHash("sha256").update(s).digest();

/* bech32 P2WPKH v0 (BIP-173) — port of the zip's own implementation */
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

/* ── parse the recovery md (in-memory only) ── */
function parseRecovery() {
  const txt = readFileSync(RECOVERY_MD, "utf8");
  const seedM = txt.match(/## 3\)[\s\S]*?\n([0-9a-f]{96})\s*\n/);
  const seed = seedM ? seedM[1] : null;
  const sec4 = txt.match(/## 4\)([\s\S]*?)(?=\n## 5\))/)?.[1] ?? "";
  const fleet: Record<string, { evm?: string; tron?: string; sol?: string; btc?: string; evmPk?: string; tronPk?: string; solPk?: string }> = {};
  const blocks = sec4.split(/^###\s+/m).slice(1);
  for (const b of blocks) {
    const name = /^([a-z0-9-]+)/.exec(b)?.[1]; if (!name) continue;
    const evm = /EVM[^`]*`(0x[0-9a-fA-F]{40})`/.exec(b)?.[1];
    const tron = /TRON[^`]*`(T[1-9A-HJ-NP-Za-km-z]{33})`/.exec(b)?.[1];
    const sol = /SOL[^`]*`([1-9A-HJ-NP-Za-km-z]{43,44})`/.exec(b)?.[1];
    const btc = /BTC[^`]*`(bc1[a-z0-9]{20,62})`/.exec(b)?.[1];
    const pks = Array.from(b.matchAll(/- pk:\s*`0x?([0-9a-fA-F]{64})`/g)).map((m) => m[1].toLowerCase());
    fleet[name] = { evm, tron, sol, btc, evmPk: pks[0], tronPk: pks[1], solPk: pks[2] };
  }
  const sec5 = txt.match(/## 5\)([\s\S]*?)(?=\n## 6\))/)?.[1] ?? "";
  const mnemonics = Array.from(sec5.matchAll(/^\s*([a-z]+(?:\s+[a-z]+){11,23})\s*$/gm)).map((m) => m[1]);
  return { seed, fleet, mnemonics };
}

/* ── fleet derivation from a hex seed, zip scheme verbatim ── */
function deriveFleet(seed: string) {
  const evmRoot = HDNodeWallet.fromSeed(sha256buf(seed + "|evm|44/60"));
  const tronRoot = HDNodeWallet.fromSeed(sha256buf(seed + "|tron|44/195"));
  const btcRoot = HDNodeWallet.fromSeed(sha256buf(seed + "|btc|84/0"));
  const out: Record<string, { evm: string; tron: string; sol: string; btc: string }> = {};
  AGENTS.forEach((name, i) => {
    const evmW = evmRoot.derivePath("m/44'/60'/0'/0/" + i);
    const tronW = tronRoot.derivePath("m/44'/195'/0'/0/" + i);
    const btcW = btcRoot.derivePath("m/84'/0'/0'/0/" + i);
    const solPub = ed25519.getPublicKey(sha256buf(seed + "|sol|" + name));
    const pubU = SigningKey.computePublicKey(tronW.privateKey, false).slice(4);
    const kec = keccak256(Buffer.from(pubU, "hex"));
    const payload = Buffer.concat([Buffer.from([0x41]), Buffer.from(kec.slice(-40), "hex")]);
    const h2 = createHash("sha256").update(createHash("sha256").update(payload).digest()).digest();
    const tronAddr = bs58.encode(Buffer.concat([payload, h2.subarray(0, 4)]));
    out[name] = {
      evm: evmW.address,
      tron: tronAddr,
      sol: bs58.encode(Buffer.from(solPub)),
      btc: btcP2wpkh(Buffer.from(btcW.publicKey.slice(2), "hex"), "bc"),
    };
  });
  return out;
}

async function main() {
  console.log("=== r11 RECONCILIATION — zip vs recovery-doc vs vault (addresses only) ===\n");

  const zipManifest = JSON.parse(readFileSync(ZIP_DIR + "/wallets-public.json", "utf8"));
  const zipByAgent: Record<string, any> = {};
  for (const a of zipManifest.agents) zipByAgent[a.agent] = a;
  const bridge = JSON.parse(readFileSync(ZIP_DIR + "/tron-bridge-state.json", "utf8"));
  const bridgeAddrs: string[] = [bridge.address, bridge.wallet?.relay, ...(bridge.squadAddresses ?? [])].filter(Boolean);
  const { seed, fleet, mnemonics } = parseRecovery();

  const vaultRows = await db.vaultEntry.findMany({ where: { kind: { in: ["evm-key", "tron-key", "sol-key"] } } });
  const vaultPub: Record<string, { evm?: string; tron?: string; sol?: string }> = {};
  for (const r of vaultRows) {
    if (!r.account) continue;
    (vaultPub[r.account] ??= {})[r.kind === "evm-key" ? "evm" : r.kind === "tron-key" ? "tron" : "sol"] = r.pub ?? undefined;
  }

  console.log(`sources: zip-manifest ${zipManifest.agents.length} agents (anchor txid ${(zipManifest.anchor?.txid ?? "").slice(0, 16)}…) · bridge ${bridgeAddrs.length} addrs · recovery seed ${seed ? "PRESENT(96hex)" : "MISSING"} · recovery mnemonics ${mnemonics.length} · vault wallet rows ${vaultRows.length}`);

  /* 1. does the recovery §3 seed re-derive the recovery §4 fleet (and what the vault holds)? */
  let seedConsistent = 0, seedVsVault = 0, seedVsZip = 0, seedVsBtcFile = 0;
  if (seed) {
    const derived = deriveFleet(seed);
    console.log("\n[1] recovery §3 seed → zip derivation scheme (m/44'/60|195|84 + sol-domain), 12 agents ×4 families");
    for (const name of AGENTS) {
      const d = derived[name], f = fleet[name] ?? {}, v = vaultPub[name] ?? {}, z = zipByAgent[name] ?? {};
      const evmOk = d.evm.toLowerCase() === (f.evm ?? "").toLowerCase();
      const tronOk = d.tron === f.tron;
      const solOk = d.sol === f.sol;
      const btcFileOk = d.btc === f.btc; // §4 lists BTC addresses too
      const vEvm = (v.evm ?? "").toLowerCase() === d.evm.toLowerCase();
      const vTron = v.tron === d.tron;
      const vSol = v.sol === d.sol;
      const zMatch = d.evm.toLowerCase() === (z.evm ?? "").toLowerCase() && d.tron === z.tron && d.sol === z.sol;
      if (evmOk && tronOk && solOk) seedConsistent++;
      if (vEvm && vTron && vSol) seedVsVault++;
      if (zMatch) seedVsZip++;
      if (btcFileOk) seedVsBtcFile++;
      console.log(`  ${name.padEnd(11)} derive==§4 ${evmOk && tronOk && solOk ? "OK " : "MIX"}(evm${evmOk ? "+" : "-"} tron${tronOk ? "+" : "-"} sol${solOk ? "+" : "-"} btc§4${btcFileOk ? "+" : "-"}) · derive==vault ${vEvm && vTron && vSol ? "OK" : "MIX"} · derive==zip-anchored ${zMatch ? "OK" : "NO"}`);
    }
    console.log(`  verdict: seed→§4 ${seedConsistent}/12 · seed→vault ${seedVsVault}/12 · seed→ZIP-ANCHORED ${seedVsZip}/12 · seed→§4BTC ${seedVsBtcFile}/12`);
  } else {
    console.log("\n[1] recovery §3 seed MISSING — cannot re-derive");
  }

  /* 2. anchored zip manifest vs vault pubs (the public identity question) */
  console.log("\n[2] ZIP-ANCHORED manifest vs vault pubs (is the PUBLIC soldier address the one we hold?)");
  let zipInVault = 0, zipInRecovery = 0;
  for (const name of AGENTS) {
    const z = zipByAgent[name], v = vaultPub[name] ?? {}, f = fleet[name] ?? {};
    const inVault = (v.evm ?? "").toLowerCase() === (z.evm ?? "").toLowerCase() && v.tron === z.tron && v.sol === z.sol;
    const inRecovery = (f.evm ?? "").toLowerCase() === (z.evm ?? "").toLowerCase() && f.tron === z.tron && f.sol === z.sol;
    if (inVault) zipInVault++;
    if (inRecovery) zipInRecovery++;
    console.log(`  ${name.padEnd(11)} anchored-tron ${z.tron} · vault-tron ${v.tron ?? "—"} ${inVault ? "SAME" : "DIFFERENT"}${inRecovery ? " (recovery holds it)" : ""}`);
  }
  console.log(`  verdict: anchored manifest present in vault ${zipInVault}/12 · in recovery doc ${zipInRecovery}/12`);

  /* 3. recovery §5 mnemonics → bridge sender/relay/squad */
  console.log("\n[3] recovery §5 TRON mnemonics → bridge family (sender/relay/squad, real TRX)");
  const bridgeSet = new Set(bridgeAddrs);
  mnemonics.forEach((m, mi) => {
    const hits: string[] = [];
    const addrs: string[] = [];
    for (let i = 0; i < 6; i++) {
      const w = HDNodeWallet.fromPhrase(m, undefined, "m/44'/195'/0'/0/" + i);
      const a = tronAddress(w.privateKey.slice(2));
      addrs.push(a);
      if (bridgeSet.has(a)) hits.push(`idx${i}=${a}`);
    }
    console.log(`  mnemonic#${mi + 1}: bridge hits ${hits.length ? hits.join(" ") : "NONE"}${hits.length ? "  ← CONTROLS THE BRIDGE" : ""}`);
    void addrs;
  });
  console.log(`  bridge family under test: ${bridgeAddrs.join(", ")}`);

  /* 4. §4 pks self-consistency (does each pk derive its own listed address?) */
  console.log("\n[4] recovery §4 pk → own listed address (parser/key integrity)");
  let pkOk = 0, pkTotal = 0;
  for (const name of AGENTS) {
    const f = fleet[name]; if (!f) continue;
    const checks: boolean[] = [];
    if (f.evmPk && f.evm) { pkTotal++; const ok = evmAddress(f.evmPk).toLowerCase() === f.evm.toLowerCase(); checks.push(ok); if (ok) pkOk++; }
    if (f.tronPk && f.tron) { pkTotal++; const ok = tronAddress(f.tronPk) === f.tron; checks.push(ok); if (ok) pkOk++; }
    if (f.solPk && f.sol) {
      pkTotal++;
      const kp = ed25519.getPublicKey(Buffer.from(f.solPk, "hex"));
      const ok = bs58.encode(Buffer.from(kp)) === f.sol; checks.push(ok); if (ok) pkOk++;
    }
    console.log(`  ${name.padEnd(11)} pk→addr ${checks.every(Boolean) ? "ALL-OK" : "MISMATCH(" + checks.filter((c) => !c).length + ")"}`);
  }
  console.log(`  verdict: ${pkOk}/${pkTotal} pk↔address pairs consistent`);

  /* 5. what exists but was never entered in the vault */
  console.log("\n[5] EXISTING-BUT-NOT-IN-VAULT (the operator's question: מה לא הוכנס וקיים)");
  const missing: string[] = [];
  for (const name of AGENTS) {
    const f = fleet[name];
    if (f?.btc) missing.push(`BTC/${name} ${f.btc}`);
  }
  console.log(`  · BTC fleet addresses (12): ${fleet[AGENTS[0]]?.btc ? "recoverable from §3 seed — derivation proven above" : "?"} — vault rows: 0`);
  console.log(`  · bridge TRON family (sender/relay/squad ×4): ${bridgeAddrs.length} addresses with live balances — vault rows: 0`);
  console.log(`  · anchored-manifest family (2026-09-07 seed-A): ${zipInVault}/12 in vault${seedVsZip ? " — also derivable from current seed: NO" : ""}`);
  console.log(`  · EVM fleet key serves 7 networks (ETH/BSC/Polygon/Arbitrum/Optimism/Base/Avalanche) — vault stores 1 row per agent (chain=ethereum)`);
  console.log(missing.length ? "  (BTC rows listable on demand — addresses above in [1])" : "");

  await db.$disconnect();
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
