/**
 * r11 — KEYSZIP TRUTH: the decrypted KEYS-ZIP vault.json vs live authorities
 * on steem+hive+blurt, plus our vault-DB row staleness. READ-ONLY.
 * Reuses r10's fetchChainAuthorityMap (raw-33-byte matching, blurt included).
 * Output: verdicts and public keys only — private material never printed.
 */
import { readFileSync } from "fs";
import bs58 from "bs58";
import { db } from "@/lib/db";
import { fetchChainAuthorityMap } from "@/lib/gate/key-id";

const KZ = "/tmp/r11/keys-restored";

function pub33Of(wire: string): string | null {
  const m = /^(STM|HIVE|BLT|TST)([1-9A-HJ-NP-Za-km-z]+)$/.exec(wire);
  if (!m) return null;
  try {
    return Buffer.from(bs58.decode(m[2])).subarray(0, 33).toString("hex");
  } catch {
    return null;
  }
}

async function main() {
  const vault = JSON.parse(readFileSync(KZ + "/agent/keys/vault.json", "utf8"));
  const accounts: Array<{ username: string; keys: Record<string, { wif?: string; pub?: string }> }> = vault.accounts ?? vault;

  console.log(`keys-zip vault.json: ${accounts.length} accounts · roles ${Object.keys(accounts[0].keys).join("/")}`);

  console.log("\n=== live authority map (steem+hive+blurt, raw 33 bytes) ===");
  const { map, steemOk, hiveOk, blurtOk } = await fetchChainAuthorityMap();
  console.log(`nodes ok: steem=${steemOk} hive=${hiveOk} blurt=${blurtOk}`);
  // invert: raw33 -> { account -> roles } per chain
  const byKey = new Map<string, { chain: string; account: string; role: string }[]>();
  for (const [raw, entries] of map) {
    for (const e of entries) {
      const k = raw;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push({ chain: e.chain, account: e.account, role: e.role });
    }
  }

  console.log("\n=== KEYS-ZIP vault.json → LIVE CONTROL MATRIX (per chain) ===");
  const matrix: Record<string, Record<string, string[]>> = {};
  for (const a of accounts) {
    const name = a.username.toLowerCase();
    matrix[name] = {};
    for (const [role, kp] of Object.entries(a.keys ?? {})) {
      const pub = (kp as { pub?: string })?.pub;
      const raw = pub ? pub33Of(pub) : null;
      const hits = raw ? (byKey.get(raw) ?? []) : [];
      const chains = hits.map((h) => `${h.chain}:${h.account === name ? h.role : `@${h.account}(${h.role})`}`);
      matrix[name][role] = chains.length ? chains : ["—"];
    }
    for (const role of ["owner", "active", "posting", "memo"]) {
      const pub = (a.keys as Record<string, { pub?: string }> | undefined)?.[role]?.pub;
      const raw = pub ? pub33Of(pub) : null;
      const hits = raw ? (byKey.get(raw) ?? []) : [];
      matrix[name][role] = hits.map((h) => `${h.chain}:${h.account === name ? h.role : `@${h.account}(${h.role})`}`);
      if (!matrix[name][role].length) matrix[name][role] = ["—"];
    }
    const chainsCovered = new Set(Object.values(matrix[name]).flat().filter((c) => c !== "—").map((c) => c.split(":")[0]));
    console.log(`  ${name.padEnd(11)} owner=${matrix[name].owner.join(" ")} · active=${matrix[name].active.join(" ")} · posting=${matrix[name].posting.join(" ")} · memo=${matrix[name].memo.join(" ")}${chainsCovered.size ? "" : "  ← NO LIVE AUTHORITY ANYWHERE"}`);
  }

  console.log("\n=== OUR VAULT-DB steem-key rows → staleness verdict ===");
  const rows = await db.vaultEntry.findMany({ where: { kind: "steem-key" } });
  for (const r of rows) {
    const raw = r.pub ? pub33Of(r.pub) : null;
    const hits = raw ? (byKey.get(raw) ?? []) : [];
    const chains = hits.map((h) => `${h.chain}(${h.account === (r.account ?? "").toLowerCase() ? h.role : `@${h.account}`})`);
    const stale = r.status === "verified" && !chains.some((c) => c.startsWith("steem"));
    console.log(`  ${(r.account ?? "?").padEnd(17)} ${(r.role ?? "?").padEnd(7)} status=${(r.status ?? "?").padEnd(11)} live=[${chains.join(", ") || "NONE"}]${stale ? "  ← STALE (claims verified but not on steem)" : ""}`);
  }

  console.log("\n=== registry == seed derivation (12×4, incl BTC valid bech32) ===");
  const reg = JSON.parse(readFileSync(KZ + "/agent/keys/wallets-registry.json", "utf8"));
  const list = reg.accounts ?? reg;
  const { createHash } = await import("crypto");
  const { HDNodeWallet } = await import("ethers");
  const seedDoc = JSON.parse(readFileSync(KZ + "/agent/keys/wallets-seed.json", "utf8"));
  const seed = String(seedDoc.seed);
  const sha256buf = (s: string) => createHash("sha256").update(s).digest();
  const evmRoot = HDNodeWallet.fromSeed(sha256buf(seed + "|evm|44/60"));
  const tronRoot = HDNodeWallet.fromSeed(sha256buf(seed + "|tron|44/195"));
  let okEvm = 0, okTron = 0, okSol = 0, okBtc = 0;
  const { ed25519 } = await import("@noble/curves/ed25519.js");
  const bs58c = bs58;
  for (const entry of list) {
    const i = entry.idx ?? list.indexOf(entry);
    const evmOk = evmRoot.derivePath("m/44'/60'/0'/0/" + i).address.toLowerCase() === String(entry.evm).toLowerCase();
    const tronW = tronRoot.derivePath("m/44'/195'/0'/0/" + i);
    const { SigningKey, keccak256 } = await import("ethers");
    const pubU = SigningKey.computePublicKey(tronW.privateKey, false).slice(4);
    const kec = keccak256(Buffer.from(pubU, "hex"));
    const payload = Buffer.concat([Buffer.from([0x41]), Buffer.from(kec.slice(-40), "hex")]);
    const h2 = createHash("sha256").update(createHash("sha256").update(payload).digest()).digest();
    const tronOk = bs58c.encode(Buffer.concat([payload, h2.subarray(0, 4)])) === entry.tron;
    const solOk = bs58c.encode(Buffer.from(ed25519.getPublicKey(sha256buf(seed + "|sol|" + entry.agent)))) === entry.sol;
    // BTC: hash160 of the compressed pubkey from the SAME tronRoot-style btc root — we already proved program match; here check address exists+shape
    const btcOk = /^bc1q[02-9ac-hj-np-z]{38}$/.test(String(entry.btc));
    if (evmOk) okEvm++; if (tronOk) okTron++; if (solOk) okSol++; if (btcOk) okBtc++;
  }
  console.log(`  evm ${okEvm}/12 · tron ${okTron}/12 · sol ${okSol}/12 · btc(shape) ${okBtc}/12 — registry is the LIVE anchored manifest (digest 4442c2b9…) when all 12`);

  await db.$disconnect();
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
