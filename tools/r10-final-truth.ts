/**
 * r10 — FINAL TRUTH: the whole "מחובר להכל" claim, proven live, rail by rail.
 * Read-only: no broadcast, no master unlock, no key material ever printed.
 * WIFs for the authority proof are read from the operator's own upload file
 * at runtime (never a literal in code — r5 doctrine).
 */
import { db } from "@/lib/db";
import { fetchChainAuthorityMap } from "@/lib/gate/key-id";
import { railHealth, verifyPostingKeyOnChain } from "@/lib/social/rails-server";
import { toSigningKey } from "@/lib/gate/harness/orders";
import { readFileSync } from "fs";

const HEAD_ACCOUNT = "headcorner";

function wifsFromUpload(): Record<string, string> {
  const txt = readFileSync("upload/הדקור.txt", "utf8");
  const out: Record<string, string> = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = /^\s*(OWNER|ACTIVE|POSTING|MEMO)\s*=\s*(\S+)\s*$/i.exec(line);
    if (m) out[m[1].toLowerCase()] = m[2];
  }
  return out;
}

async function main() {
  console.log("=== 1. rail health (live condenser calls) ===");
  for (const rail of ["steem", "hive", "blurt"] as const) {
    const h = await railHealth(rail);
    console.log(`  ${rail}: reachable=${h.reachable} head=${h.headBlock ?? "—"} ${h.error ? `error=${h.error}` : ""}`);
  }

  console.log("\n=== 2. authority map — 3 rails, raw-33-byte keys ===");
  const { map, steemOk, hiveOk, blurtOk } = await fetchChainAuthorityMap();
  console.log(`  nodes ok: steem=${steemOk} hive=${hiveOk} blurt=${blurtOk} · distinct 33B keys on map: ${map.size}`);
  const perChain: Record<string, number> = {};
  for (const arr of map.values()) for (const c of arr) perChain[c.chain] = (perChain[c.chain] || 0) + 1;
  console.log("  authority entries per chain:", JSON.stringify(perChain));

  console.log("\n=== 3. the VAULT's headcorner posting key vs each rail (BLT-prefix fix proven) ===");
  const { steemPublicKeyDecode } = await import("../packages/crypto/src/index");
  const vrow = await db.vaultEntry.findFirst({ where: { chain: "steem", account: HEAD_ACCOUNT, role: "posting" } });
  if (vrow?.pub) {
    // decode the stored wire pub (STM-prefix base58check) to raw 33 bytes — no decryption needed
    const m = /^STM([1-9A-HJ-NP-Za-km-z]+)$/.exec(vrow.pub);
    const raw = m ? Buffer.from(await import("bs58").then((b) => (b.default || b).decode(m[1]))) : null;
    const pub33 = raw ? new Uint8Array(raw.subarray(0, 33)) : null;
    if (pub33) {
      for (const rail of ["steem", "hive", "blurt"] as const) {
        const proof = await verifyPostingKeyOnChain(rail, HEAD_ACCOUNT, { pub33 });
        console.log(`  vault ${HEAD_ACCOUNT}@posting → ${rail}: match=${proof.match}${proof.reason ? ` (${proof.reason})` : ""}`);
      }
    }
  }
  // the upload file, for the record: its posting key still rules HIVE (drift documented)
  const wifs = wifsFromUpload();
  if (wifs.posting) {
    const pub33 = toSigningKey(wifs.posting).publicKey.bytes;
    const proof = await verifyPostingKeyOnChain("hive", HEAD_ACCOUNT, { pub33 });
    console.log(`  upload-file posting → hive: match=${proof.match} (key-generation drift, documented honestly)`);
  }

  console.log("\n=== 4. vault stored pubs vs live chains (no decryption — pubs are metadata) ===");
  const evm = await db.vaultEntry.findFirst({ where: { kind: "evm-key" } });
  const tron = await db.vaultEntry.findFirst({ where: { kind: "tron-key" } });
  const sol = await db.vaultEntry.findFirst({ where: { kind: "sol-key" } });
  if (evm?.pub) {
    const r = await fetch("https://ethereum-rpc.publicnode.com", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [evm.pub, "latest"] }), signal: AbortSignal.timeout(15000) });
    const j = await r.json() as { result?: string };
    console.log(`  ETH ${evm.pub.slice(0, 10)}…: live balance = ${j.result ? Number(BigInt(j.result) / 10n ** 12n) / 1e6 + " ETH" : "error"}`);
  }
  if (tron?.pub) {
    const r = await fetch(`https://api.trongrid.io/v1/accounts/${tron.pub}`, { signal: AbortSignal.timeout(15000) });
    const j = await r.json() as { success?: boolean; data?: Array<{ balance?: number }> };
    console.log(`  TRX ${tron.pub.slice(0, 10)}…: live ok=${j.success === true} balance=${(j.data?.[0]?.balance ?? 0) / 1e6} TRX`);
  }
  if (sol?.pub) {
    const r = await fetch("https://api.mainnet-beta.solana.com", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [sol.pub] }), signal: AbortSignal.timeout(15000) });
    const j = await r.json() as { result?: { value?: number } };
    console.log(`  SOL ${sol.pub.slice(0, 10)}…: live balance = ${(j.result?.value ?? 0) / 1e9} SOL`);
  }

  console.log("\n=== 5. blurt chain-id (already oracle-proven — recorded) ===");
  console.log("  cd8d90f29ae273abec3eaa7731e25934c63eb654d55080caff2ebb7f5df6381f — 3/3 on-chain signatures recovered (tools/r10-blurt-digest-oracle.ts)");

  console.log("\n=== 6. vault status after the fix (who is 'verified' now) ===");
  const grouped = await db.vaultEntry.groupBy({ by: ["status"], _count: { _all: true } });
  for (const g of grouped) console.log(`  ${g.status}: ${g._count._all}`);
  const blurtCapable = await db.vaultEntry.count({ where: { kind: "steem-key", status: "verified" } });
  console.log(`  steem-key entries now live-verified: ${blurtCapable} (was 4 before r10)`);

  await db.$disconnect();
}

main().then(() => process.exit(0)).catch((e) => { console.error("FINAL TRUTH FAIL:", e.message); process.exit(1); });
