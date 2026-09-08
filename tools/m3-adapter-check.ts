/**
 * M3 adapter live verification — Ethereum + Solana
 * =================================================
 * Exercises health / chain info / account reads / tx build+sign against
 * public mainnet RPCs. NO broadcast anywhere (fail-closed gate stays shut).
 * Run: bun tools/m3-adapter-check.ts
 */

import { ed25519 } from "@noble/curves/ed25519.js";
import {
  EthereumAdapter,
  SolanaAdapter,
  ethAddressFromPrivateKey,
  solanaAddressFromSeed,
  formatLamports,
} from "../packages/chains/index";
import { PrivateKey } from "../packages/crypto/src/index";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  console.log("=== ETHEREUM ===");
  const eth = new EthereumAdapter({
    rpcUrls: ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"],
  });

  const h = await eth.health();
  ok("health.reachable", h.reachable, `head=${h.headBlock} lag=${h.lagSeconds}s`);

  const info = await eth.getChainInfo();
  ok(
    "chainInfo",
    info.blockHeight > 25_000_000 && info.chainId === 1,
    `height=${info.blockHeight} maxFeeGwei=${info.maxFee ? Number(BigInt(info.maxFee)) / 1e9 : "?"}`,
  );

  // A famous mainnet address — read-only.
  const vitalk = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
  const bal = await eth.getBalances(vitalk);
  ok("getBalances", bal.liquid.endsWith("ETH"), `liquid=${bal.liquid.slice(0, 12)} ETH`);

  const acct = await eth.getAccount(vitalk.toLowerCase()); // any-case input
  ok("getAccount canonicalizes", acct !== null && acct.name === vitalk, acct?.name ?? "null");

  // USDT balance (read-only; token contract is public knowledge).
  const usdt = await eth.getTokenBalance(vitalk, "0xdAC17F958D2ee523a2206206994597C13D831ec7");
  ok(
    "erc20 read",
    usdt.symbol === "USDT" && usdt.decimals === 6,
    `symbol=${usdt.symbol} decimals=${usdt.decimals} amount=${usdt.formatted ?? usdt.amount}`,
  );

  // Vault-key → address derivation (deterministic secp256k1 → EIP-55).
  const k = PrivateKey.fromSeed("m3-derivation-vector");
  const addr = ethAddressFromPrivateKey(k.bytes);
  ok("ethAddressFromPrivateKey", /^0x[0-9a-fA-F]{40}$/.test(addr), addr);

  // Build + sign an EIP-1559 transfer (NOT broadcast).
  const unsigned = await eth.buildOperations([
    {
      type: "transfer",
      payload: { from: addr, to: "0x000000000000000000000000000000000000dEaD", amount: "0.001" },
    },
  ]);
  ok("buildOperations eip1559", unsigned.metadata?.type === 2, `nonce=${unsigned.metadata?.nonce} gas=${unsigned.metadata?.gasLimit}`);

  const signed = await eth.sign(unsigned, { byRole: { active: k.bytes } }, ["active"]);
  const meta = signed.metadata as { digestHex?: string; rawTransactionHex?: string; from?: string };
  ok(
    "sign eip1559",
    typeof meta.rawTransactionHex === "string" && meta.rawTransactionHex.startsWith("0x02f8"),
    `digest=${meta.digestHex?.slice(0, 14)}… from=${meta.from}`,
  );

  // Fail-closed: broadcast without opt-in must throw.
  let broadcastBlocked = false;
  try {
    await eth.broadcast(signed);
  } catch (e) {
    broadcastBlocked = e instanceof Error && e.message.includes("broadcast disabled");
  }
  ok("broadcast fail-closed", broadcastBlocked);

  // Fail-closed: wrong roles must throw.
  let rolesBlocked = false;
  try {
    await eth.sign(unsigned, { byRole: { posting: k.bytes } }, ["posting"]);
  } catch (e) {
    rolesBlocked = e instanceof Error && e.message.includes('exactly roles ["active"]');
  }
  ok("role policy fail-closed", rolesBlocked);

  console.log("=== SOLANA ===");
  const sol = new SolanaAdapter({
    rpcUrls: ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"],
  });

  const hs = await sol.health();
  ok("health.reachable", hs.reachable, `slot=${hs.headBlock}`);

  const sinfo = await sol.getChainInfo();
  ok(
    "chainInfo",
    sinfo.blockHeight > 400_000_000 && sinfo.nativeToken.decimals === 9,
    `slot=${sinfo.blockHeight} epoch=${sinfo.epoch} core=${sinfo.nodeVersion}`,
  );

  // A well-known mainnet address (Binance hot wallet) — read-only.
  const binance = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
  const sbal = await sol.getBalances(binance);
  ok("getBalances exact bigint math", sbal.liquid.endsWith("SOL"), `${sbal.liquid.slice(0, 14)} SOL`);

  // SPL token read (read-only).
  const tokens = await sol.getTokenBalances(binance);
  ok("spl token read", Array.isArray(tokens), `${tokens.length} token accounts (first: ${tokens[0]?.mint.slice(0, 8) ?? "—"}… ${tokens[0]?.formatted?.slice(0, 10) ?? ""})`);

  // Vault seed → keypair derivation.
  const seed = PrivateKey.fromSeed("m3-solana-vector").bytes;
  const solAddr = solanaAddressFromSeed(seed);
  ok("solanaAddressFromSeed", /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(solAddr), solAddr);

  // Build + sign a 1000-lamport self-transfer-shaped tx (NOT broadcast;
  // the fee payer is the fresh vault key — signing must succeed offline).
  const unsignedSol = await sol.buildOperations([
    {
      type: "transfer",
      payload: { from: solAddr, to: solAddr, amountLamports: "1000" },
    },
  ]);
  ok(
    "buildOperations legacy msg",
    typeof unsignedSol.metadata?.messageHex === "string" && unsignedSol.metadata.messageHex.length > 0,
    `feePayer=${String(unsignedSol.metadata?.feePayer ?? "").slice(0, 8)}… blockhash=${String(unsignedSol.metadata?.recentBlockhash).slice(0, 8)}…`,
  );

  const signedSol = await sol.sign(
    unsignedSol,
    { byRole: { active: seed } },
    ["active"],
  );
  const sig58 = String(signedSol.signatures[0] ?? "");
  ok(
    "sign legacy tx",
    /^[1-9A-HJ-NP-Za-km-z]{80,100}$/.test(sig58),
    `sig=${sig58.slice(0, 16)}…`,
  );

  // Wire integrity: signature must verify against the message via the pubkey.
  const { ed25519 } = await import("@noble/curves/ed25519.js");
  const msgHex = String(unsignedSol.metadata?.messageHex ?? "");
  const msgBytes = Buffer.from(msgHex, "hex");
  const sigBytes = base58Decode(sig58);
  const pubBytes = KeypairPub(seed);
  ok("ed25519 verify", ed25519.verify(new Uint8Array(sigBytes), new Uint8Array(msgBytes), new Uint8Array(pubBytes)));

  let solBroadcastBlocked = false;
  try {
    await sol.broadcast(signedSol);
  } catch (e) {
    solBroadcastBlocked = e instanceof Error && e.message.includes("broadcast disabled");
  }
  ok("broadcast fail-closed", solBroadcastBlocked);

  console.log("=== FORMATTING ===");
  ok("formatLamports 0", formatLamports("0") === "0");
  ok("formatLamports 1e9", formatLamports("1000000000") === "1");
  ok("formatLamports 1.5 SOL", formatLamports("1500000000") === "1.5");
  ok("formatLamports max-ish", formatLamports("18446744073709551615") === "18446744073.709551615");

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  if (fail > 0) process.exit(1);
}

import { base58 } from "@scure/base";
function base58Decode(s: string): Uint8Array {
  return base58.decode(s);
}
function KeypairPub(seed: Uint8Array): Uint8Array {
  // ed25519 pubkey from seed
  return ed25519.getPublicKey(seed);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
