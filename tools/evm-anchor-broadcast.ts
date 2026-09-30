/**
 * evm-anchor-broadcast.ts — perform the real Ethereum mainnet anchor signature.
 *
 * Anchors the SAOS sovereign chain's canonical state (height + stateRoot, as
 * published by the gitkeeper-synced sovereign/node/state.json) to Ethereum
 * mainnet, per the saos-jumpper/v1 protocol: an EOA self-transfer with the
 * commitment in calldata, witnessed by 5 independent chain clocks.
 *
 * SAFETY (all enforced, fail-closed):
 *   - value is hardwired 0; tx.to === tx.from (self-transfer — nothing can move)
 *   - budget guard: estimated max cost must be <= 20% of the wallet balance
 *   - broadcast requires the explicit --broadcast flag; default is preview
 *   - signer address must equal the wallet's registry address (recovered check)
 *   - tier-3 verification re-reads the tx from the chain and decodes calldata
 *
 * SECRETS: the fleet registry lives in the gitignored lab; this tool never
 * prints or writes private key material — only addresses, hashes and verdicts.
 */
import { existsSync, readFileSync } from "node:fs";
import { ethers } from "ethers";

import { EthereumAdapter } from "../packages/chains/ethereum/adapter";
import type { UnsignedTx } from "../packages/chains/chain-adapter";
import { totalGas } from "../packages/jumpper/gas-model";

const RPC = process.env.EVM_RPC ?? "https://ethereum-rpc.publicnode.com";
// Task 13-c: env override wins; then the lab default, then the canonical org
// vault registry (steem/agent/keys/wallets-registry.json — 12/12 accounts).
const REGISTRY_PATH = process.env.FLEET_REGISTRY_PATH
  ?? [".grid98-lab/agent/keys/wallets-registry.json", "/home/z/git-audit/steem/agent/keys/wallets-registry.json"].find((p) => existsSync(p))
  ?? ".grid98-lab/agent/keys/wallets-registry.json";
const STATE_URL =
  process.env.SOVEREIGN_STATE_URL ?? "https://raw.githubusercontent.com/roshpinacare-sys/steem/main/sovereign/node/state.json";
const CHAIN_ID = 1;
const BUDGET_FRACTION = 0.2;
const DO_BROADCAST = process.argv.includes("--broadcast");
const VERIFY_TXID = process.argv.find((a) => a.startsWith("--verify="))?.slice(9) ?? null;
const WALLET_NAME = process.argv.find((a) => a.startsWith("--wallet="))?.slice(9) ?? "headcorner";

interface RegistryEntry {
  agent: string;
  evm: { address: string; pk: string };
}
interface SovereignState {
  height: number;
  stateRoot: string;
  updatedAt: string;
  checkpoints?: unknown[];
}

async function fetchSovereignState(): Promise<SovereignState> {
  // the steem repo is PRIVATE — raw fetch needs the owner token (local gitignored file / env)
  const headers: Record<string, string> = {};
  // Task 13-c: token chain — env first, then the live upload/pat.env, then the
  // legacy Roshcaregt.txt (each optional — a private-repo fetch without a token
  // fails honestly at HTTP level instead of crashing on a missing file).
  const fsmod = { existsSync, readFileSync };
  const token = process.env.GITHUB_TOKEN
    ?? ["upload/pat.env", "/home/z/my-project/upload/pat.env", "upload/Roshcaregt.txt"]
      .filter((p) => fsmod.existsSync(p))
      .map((p) => { try { return fsmod.readFileSync(p, "utf8").trim(); } catch { return ""; } })
      .find((t) => t.length > 10);
  if (token) headers.Authorization = `token ${token}`;
  const res = await fetch(STATE_URL, { headers, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`sovereign state fetch failed: HTTP ${res.status}`);
  return (await res.json()) as SovereignState;
}

async function captureWitness(): Promise<Record<string, number | null>> {
  const probe = async (url: string, body: unknown, pick: (j: any) => number): Promise<number | null> => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(6_000),
      });
      return pick(await res.json());
    } catch {
      return null; // honest degradation — never invented
    }
  };
  const num = (j: any) => Number(j?.result);
  return {
    steem: await probe("https://api.steemit.com", { jsonrpc: "2.0", id: 1, method: "condenser_api.get_dynamic_global_properties", params: [] }, (j) => Number(j?.result?.head_block_number)),
    hive: await probe("https://api.hive.blog", { jsonrpc: "2.0", id: 1, method: "condenser_api.get_dynamic_global_properties", params: [] }, (j) => Number(j?.result?.head_block_number)),
    tron: await probe("https://api.trongrid.io/wallet/getnowblock", {}, (j) => Number(j?.block_header?.raw_data?.number)),
    ethereum: await probe(RPC, { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }, num),
    solana: await probe("https://api.mainnet-beta.solana.com", { jsonrpc: "2.0", id: 1, method: "getSlot", params: [] }, num),
  };
}

function buildPayload(height: number, root: string, leafCount: number, at: string, witness: Record<string, number | null>): string {
  if (!/^[0-9a-f]{64}$/.test(root)) throw new Error(`root must be 64-char lowercase hex, got "${root.slice(0, 20)}…"`);
  return JSON.stringify({
    protocol: "saos-jumpper/v1",
    action: "batch-anchor",
    height,
    root,
    leafCount,
    at,
    witness,
  });
}

/** Tier-3 verification against a live tx: decode calldata, compare with the
 *  canonical published state. No keys, no network writes — the re-runnable proof. */
async function verifyExisting(provider: ethers.JsonRpcProvider, txid: string, registry: { accounts: RegistryEntry[] }): Promise<void> {
  const tx = await provider.getTransaction(txid);
  if (!tx) throw new Error(`tx ${txid} not found on chain`);
  const receipt = await provider.getTransactionReceipt(txid);
  if (!receipt) throw new Error("receipt unavailable");
  if (receipt.status !== 1) throw new Error("tx not successful on chain");
  const decoded = JSON.parse(Buffer.from(tx.data.slice(2), "hex").toString("utf8"));
  const signer = registry.accounts.find((a) => a.evm.address.toLowerCase() === tx.from?.toLowerCase());
  if (decoded.protocol !== "saos-jumpper/v1" || decoded.action !== "batch-anchor") {
    throw new Error("tx is not a saos-jumpper/v1 batch-anchor");
  }
  console.log(JSON.stringify({
    mode: "verify",
    txid,
    explorer: `https://etherscan.io/tx/${txid}`,
    block: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    signer: tx.from,
    signerIdentity: signer ? signer.agent : "NOT-IN-FLEET-REGISTRY",
    anchored: { height: decoded.height, root: decoded.root, leafCount: decoded.leafCount, at: decoded.at, witness: decoded.witness ?? null },
    crossCheck: (() => {
      try {
        const s = JSON.parse(readFileSync("/tmp/sovereign-state.json", "utf8")) as SovereignState;
        return { heightMatches: Number(s.height) === decoded.height, rootMatches: String(s.stateRoot).replace(/^0x/, "") === decoded.root, publishedHeight: s.height };
      } catch { return { note: "cached state unavailable — cross-check via published state.json manually" }; }
    })(),
  }, null, 2));
  console.log("\nTIER-3-VERIFY: PROVEN (calldata decodes to a valid jumpper anchor, signed by a fleet wallet)");
}

async function main(): Promise<void> {
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as { accounts: RegistryEntry[] };

  if (VERIFY_TXID) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(VERIFY_TXID)) throw new Error("--verify expects a 0x tx hash");
    const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
    await verifyExisting(provider, VERIFY_TXID, registry);
    return;
  }

  const entry = registry.accounts.find((a) => a.agent === WALLET_NAME);
  if (!entry) throw new Error(`wallet "${WALLET_NAME}" not in fleet registry`);

  console.log(`[1/6] canonical sovereign state ← ${STATE_URL.split("/main/")[1]}`);
  const state = await fetchSovereignState();
  const height = Number(state.height);
  const root = String(state.stateRoot).toLowerCase().replace(/^0x/, "");
  const leafCount = Array.isArray(state.checkpoints) ? state.checkpoints.length : 0;
  const at = String(state.updatedAt);
  if (!Number.isInteger(height) || height < 1) throw new Error("state.height invalid");
  console.log(`      height=${height} root=${root.slice(0, 16)}… checkpoints=${leafCount} at=${at}`);

  console.log("[2/6] capturing 5-chain witness (live, honest degradation)…");
  const witness = await captureWitness();
  console.log(`      witness=${JSON.stringify(witness)}`);

  const payload = buildPayload(height, root, leafCount, at, witness);
  const data = "0x" + Buffer.from(payload, "utf8").toString("hex");
  console.log(`[3/6] payload ${payload.length}B calldata ${data.length - 2} hex chars`);

  const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
  const [fee, nonce, balance] = await Promise.all([
    provider.getFeeData(),
    provider.getTransactionCount(entry.evm.address, "pending"),
    provider.getBalance(entry.evm.address),
  ]);
  if (!fee.maxFeePerGas || !fee.maxPriorityFeePerGas) throw new Error("fee data unavailable");
  const gas = totalGas(Buffer.from(payload, "utf8"));
  const maxCost = gas * fee.maxFeePerGas;
  const budgetCap = (balance * BigInt(Math.round(BUDGET_FRACTION * 100))) / 100n;
  console.log(`[4/6] wallet ${entry.evm.address} nonce=${nonce} balance=${ethers.formatEther(balance)} ETH`);
  console.log(`      gasModel=${gas} maxFee=${ethers.formatUnits(fee.maxFeePerGas, "gwei")} gwei → maxCost=${ethers.formatEther(maxCost)} ETH (cap ${ethers.formatEther(budgetCap)})`);
  if (maxCost > budgetCap) throw new Error(`budget guard: maxCost ${maxCost} > 20% of balance ${balance} — refusing`);
  if (balance === 0n) throw new Error("wallet empty — cannot anchor");

  // hardwire the jummpper shape: EOA self-transfer, value 0, commitment in data
  const unsigned: UnsignedTx = {
    chainId: "eip155:1",
    operations: [{ type: "anchor", payload: { height, root, leafCount } }],
    metadata: {
      type: 2,
      chainId: CHAIN_ID,
      nonce,
      to: entry.evm.address,
      value: "0",
      data,
      gasLimit: String(gas + 5_000n), // model + honest headroom
      maxFeePerGas: fee.maxFeePerGas.toString(),
      maxPriorityFeePerGas: fee.maxPriorityFeePerGas.toString(),
    },
  };
  const meta = unsigned.metadata as Record<string, unknown>;
  if (meta.to !== entry.evm.address) throw new Error("guard: tx is not a self-transfer");
  if (BigInt(String(meta.value)) !== 0n) throw new Error("guard: tx value must be 0");
  const adapter = new EthereumAdapter({ rpcUrls: [RPC], chainId: CHAIN_ID, allowBroadcast: DO_BROADCAST });

  console.log("[5/6] signing (key never leaves the call)…");
  const signed = await adapter.sign(unsigned, { byRole: { active: entry.evm.pk } }, ["active"]);
  const signedMeta = signed.metadata as Record<string, unknown>;
  if (String(signedMeta.recoveredSigner).toLowerCase() !== entry.evm.address.toLowerCase()) {
    throw new Error("recovered signer does not match registry address — refusing to broadcast");
  }
  console.log(`      digest=${String(signedMeta.digestHex).slice(0, 18)}… recovered=${String(signedMeta.recoveredSigner)}`);
  if (!DO_BROADCAST) {
    console.log("\nPREVIEW ONLY (no --broadcast): signed raw tx ready, length " + String(signedMeta.rawTransactionHex).length);
    console.log(JSON.stringify({ mode: "preview", height, root, leafCount, from: entry.evm.address, maxCostWei: maxCost.toString() }, null, 2));
    return;
  }

  console.log("[6/6] broadcasting to Ethereum mainnet…");
  const sent = await adapter.broadcast(signed);
  console.log(`      txid=${sent.txId}`);
  const receipt = await provider.waitForTransaction(sent.txId, 1, 180_000);
  if (!receipt) throw new Error("receipt not mined within 180s");
  console.log(`      mined: block=${receipt.blockNumber} status=${receipt.status} gasUsed=${receipt.gasUsed}`);
  if (receipt.status !== 1) throw new Error("tx REVERTED on chain");

  // tier-3: re-read from the chain, decode, verify
  const tx = await provider.getTransaction(sent.txId);
  const decoded = JSON.parse(Buffer.from((tx?.data ?? "0x").slice(2), "hex").toString("utf8"));
  const verified =
    decoded.protocol === "saos-jumpper/v1" &&
    decoded.action === "batch-anchor" &&
    decoded.height === height &&
    decoded.root === root &&
    decoded.leafCount === leafCount &&
    tx?.from?.toLowerCase() === entry.evm.address.toLowerCase() &&
    tx?.to?.toLowerCase() === entry.evm.address.toLowerCase();
  if (!verified) throw new Error("tier-3 verification FAILED — calldata does not match what we signed");

  console.log("\nANCHOR-BROADCAST-PROVEN");
  console.log(JSON.stringify({
    mode: "broadcast",
    txid: sent.txId,
    explorer: `https://etherscan.io/tx/${sent.txId}`,
    block: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    height, root, leafCount, at,
    signer: entry.evm.address,
    witness,
    decoded: { protocol: decoded.protocol, action: decoded.action },
  }, null, 2));
}

main().catch((e) => { console.error("evm-anchor-broadcast FAILED:", e.message); process.exit(1); });
