/**
 * THE SOVEREIGN PULSE PLANE (r33) — הפעימה חוזרת-הביתה.
 *
 * h16–h20 were anchored from the foundry lane: six rails a cycle, honest
 * gates, zero secrets. The capability never lived in this repo — the fleet
 * here could anchor the graphene trio only (steem/hive/blurt, r20). This
 * plane closes that gap: ONE command (`runPulseCycle`) seals the vault
 * digest on EVERY rail this repo can reach:
 *
 *   · steem / hive / blurt — the r20 graphene anchor plane (same payload,
 *     same signature path, unchanged);
 *   · solana   — Memo-program transaction carrying the full root digest,
 *                signed by the sovereign SOL key (M3 unified scalar →
 *                Ed25519 seed), verified via signature status + memo decode;
 *   · ethereum — self-transfer whose wei VALUE encodes the root prefix
 *                (the h19/h20 convention: amt=0x… root encoding), under a
 *                measured gas gate — balance below cost = honest refusal,
 *                zero broadcast;
 *   · tron     — scan-only lane (the TRON signer still lives in the foundry
 *                lane): balance + bandwidth measured from the authoritative
 *                /wallet/getaccount, refusal recorded with the numbers.
 *
 * Iron rules carried over untouched:
 *   · fail-closed everywhere — a gate that refuses records WHY and broadcasts
 *     nothing; one dead rail never kills the cycle (per-rail try/catch);
 *   · the vault identity gate: the derived address MUST equal the vault
 *     row's pub before anything signs;
 *   · nothing private leaves the process — the pulse carries PUBLIC state
 *     only (digest + counts + public ids);
 *   · every outcome lands in gateAction (`pulse:<rail>`) — the audit trail
 *     is the ledger, chain evidence is the proof.
 */
import { db } from "@/lib/db";
import { masterReady, openSecret } from "@/lib/gate/crypto";
import { vaultDigestV2, sealAnchorRound } from "@/lib/gate/anchor";
import { evmAddress, solAddress } from "@/lib/gate/key-id";
import { SolanaAdapter, keypairFromSecretBytes, formatLamports } from "../../../packages/chains/solana";
import { EthereumAdapter } from "../../../packages/chains/ethereum";
import { ETHEREUM_RPC_URLS, SOLANA_RPC_URLS } from "../../../packages/chains/index";
import { formatEther } from "ethers";
import bs58 from "bs58";

export interface PulseRailOutcome {
  rail: string;
  ok: boolean; // the broadcast happened and the chain accepted it
  txId: string | null;
  blockNum: number | null; // block number (graphene/eth) or slot (solana)
  onChain: boolean; // chain-verified after broadcast
  mode?: string; // how it was signed/verified (source·path)
  detail?: string; // measured numbers (balances, gas, bandwidth)
  error?: string; // honest refusal reason
}

export interface PulseCycleResult {
  digest: string;
  counts: Record<string, number>;
  rowCount: number;
  rails: PulseRailOutcome[];
  landed: number; // ok && onChain
  skipped?: boolean;
}

const strip0x = (s: string) => s.replace(/^0x/, "").toLowerCase();
const cut = (s: string | null | undefined, n: number) => (s ? String(s).slice(0, n) : "");

async function record(rail: string, ok: boolean, agentName: string, result: Record<string, unknown>): Promise<void> {
  await db.gateAction.create({
    data: { agentName, action: `pulse:${rail}`, params: JSON.stringify({ plane: "pulse.r33" }), ok, result: JSON.stringify(result).slice(0, 3500) },
  }).catch(() => {});
}

/* ══════════════════ SOLANA — memo anchor ══════════════════ */

const SOL_FEE_FLOOR_LAMPORTS = 10_000n; // memo-only tx fee ~5000 lamports — refuse below this

async function pulseSolana(round: string, digest: string, agentName: string): Promise<PulseRailOutcome> {
  const rows = (await db.vaultEntry.findMany({
    where: { kind: "sol-key", chain: "solana", role: "wallet", status: "verified", account: { in: ["headcorner", "cashmachine"] } },
    orderBy: { account: "asc" }, // headcorner first — cashmachine is the fallback fee payer
  })).filter((r): r is typeof r & { pub: string } => typeof r.pub === "string" && r.pub.length > 0);
  if (!rows.length) {
    const detail = "no verified sol-key rows for headcorner/cashmachine";
    await record("solana", false, agentName, { error: detail, round });
    return { rail: "solana", ok: false, txId: null, blockNum: null, onChain: false, error: detail };
  }
  const adapter = new SolanaAdapter({ rpcUrls: [...SOLANA_RPC_URLS], allowBroadcast: true });
  let last = "";
  for (const row of rows) {
    try {
      const seedHex = strip0x(openSecret(row as never));
      // Vault identity gate FIRST: the derived address must be the row's pub.
      let seed: Uint8Array, addr: string;
      try {
        seed = new Uint8Array(Buffer.from(seedHex, "hex"));
        if (seed.length !== 32) throw new Error("seed must be 32 bytes");
        addr = bs58.encode(Buffer.from(keypairFromSecretBytes(seed).publicKey.toBytes()));
      } catch (e) {
        last = `derive: ${(e as Error).message}`;
        continue;
      }
      if (addr !== row.pub) { last = `identity-gate: derived ${addr.slice(0, 8)}… ≠ vault ${row.pub.slice(0, 8)}…`; continue; }

      const info = await adapter.getAccountInfo(row.pub);
      const bal = BigInt(info.balance);
      if (bal < SOL_FEE_FLOOR_LAMPORTS) {
        last = `fuel-gate: ${formatLamports(bal.toString())} SOL < fee floor — fail-closed, zero broadcast`;
        continue;
      }

      const text = `SAOS-PULSE ${round} root=${digest} at=${new Date().toISOString()} lane=saos-wallet`;
      const unsigned = await adapter.buildOperations([{ type: "memo", payload: { from: row.pub, text } }]);
      const signed = await adapter.sign(unsigned, { byRole: { active: seed } }, ["active"]);
      const res = await adapter.broadcast(signed);
      const sig = res.txId;

      // Chain truth: signature status (failover RPC), then memo decode (raw RPC).
      let status = await adapter.getSignatureStatus(sig);
      for (let i = 0; i < 3 && !status.confirmationStatus; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        status = await adapter.getSignatureStatus(sig);
      }
      const onChain = status.err === null && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized");
      let decoded: string | null = null;
      try {
        const j = await solRpc<{ result?: { meta?: { err: unknown } ; slot?: number; transaction?: { message?: { accountKeys?: Array<{ pubkey: string }> } } } }>(0, "getTransaction", [sig, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 0 }]);
        const raw = JSON.stringify(j.result ?? {});
        decoded = raw.includes(digest) ? digest : raw.includes(digest.slice(0, 16)) ? digest.slice(0, 16) : null;
      } catch { /* decode is best-effort — the status is the primary evidence */ }

      const outcome: PulseRailOutcome = {
        rail: "solana",
        ok: true,
        txId: sig,
        blockNum: status.slot,
        onChain,
        mode: `${row.account}·memo`,
        detail: `balance ${formatLamports(bal.toString())} SOL · fee ~0.000005 · status=${status.confirmationStatus ?? "—"} · memo-decoded=${decoded ? "✓" : "pending"}`,
      };
      if (!onChain) outcome.error = `broadcast accepted but not yet confirmed (status=${status.confirmationStatus ?? "none"}, err=${JSON.stringify(status.err)})`;
      await record("solana", outcome.ok, agentName, { round, sig, slot: status.slot, onChain, decoded, account: row.account, digest });
      return outcome;
    } catch (e) {
      last = (e as Error).message;
    }
  }
  await record("solana", false, agentName, { error: cut(last, 300), round });
  return { rail: "solana", ok: false, txId: null, blockNum: null, onChain: false, error: `all sol rows refused — last: ${cut(last, 200)}` };
}

async function solRpc<T>(idx: number, method: string, params: unknown[]): Promise<T> {
  let last = "";
  for (const url of SOLANA_RPC_URLS.slice(idx)) {
    try {
      const res = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(20_000),
      });
      const j = (await res.json()) as { error?: { message: string }; result?: T };
      if (j?.error) { last = j.error.message; continue; }
      return j.result as T;
    } catch (e) { last = (e as Error).message; }
  }
  throw new Error(`solana:${method} — ${last}`);
}

/* ══════════════════ ETHEREUM — value-encoded anchor ══════════════════ */

async function pulseEthereum(round: string, digest: string, agentName: string): Promise<PulseRailOutcome> {
  const rows = (await db.vaultEntry.findMany({
    where: { kind: "evm-key", chain: "ethereum", role: "wallet", status: "verified", account: { in: ["headcorner", "cashmachine"] } },
    orderBy: { account: "asc" },
  })).filter((r): r is typeof r & { pub: string } => typeof r.pub === "string" && r.pub.length > 0);
  if (!rows.length) {
    const detail = "no verified evm-key rows for headcorner/cashmachine";
    await record("ethereum", false, agentName, { error: detail, round });
    return { rail: "ethereum", ok: false, txId: null, blockNum: null, onChain: false, error: detail };
  }
  const adapter = new EthereumAdapter({ rpcUrls: [...ETHEREUM_RPC_URLS], allowBroadcast: true });
  // h19/h20 convention: the tx VALUE in wei encodes the root prefix (first 2
  // bytes of the digest) — the amount itself is the message.
  const rootWei = BigInt(`0x${digest.slice(0, 4)}`);
  const valueStr = formatEther(rootWei);
  let last = "";
  for (const row of rows) {
    try {
      const privHex = strip0x(openSecret(row as never));
      // Vault identity gate FIRST (compare 0x-stripped lowercase on BOTH sides —
      // evmAddress returns a checksummed 0x-address; the vault row may carry
      // EIP-55 casing too).
      const addr = strip0x(evmAddress(privHex));
      if (addr !== strip0x(row.pub)) { last = `identity-gate: derived ${addr.slice(0, 10)}… ≠ vault ${strip0x(row.pub).slice(0, 10)}…`; continue; }

      const info = await adapter.getAccountInfo(row.pub);
      const bal = BigInt(info.balance);
      const unsigned = await adapter.buildOperations([{ type: "transfer", payload: { from: row.pub, to: row.pub, amount: valueStr } }]);
      const meta = unsigned.metadata as { maxFeePerGas: string; gasLimit: string };
      const maxCost = BigInt(meta.maxFeePerGas) * BigInt(meta.gasLimit) + rootWei;
      if (bal < maxCost) {
        last = `gas-gate: balance ${formatEther(bal)} ETH < cost ${formatEther(maxCost)} ETH (maxFee ${formatEther(BigInt(meta.maxFeePerGas))} × ${meta.gasLimit} gas) — fail-closed, zero broadcast`;
        continue;
      }

      const signed = await adapter.sign(unsigned, { byRole: { active: `0x${privHex}` } }, ["active"]);
      const res = await adapter.broadcast(signed);
      const hash = res.txId;

      let status: number | null = null;
      let blockNum: number | null = null;
      for (let i = 0; i < 4 && status === null; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const rc = await adapter.getTransactionReceipt(hash).catch(() => null);
        if (rc) { status = rc.status; blockNum = rc.blockNumber; }
      }
      // Encoding proof: read the tx back from the wire and decode the value.
      let encodingMatch: boolean | null = null;
      try {
        const j = await ethRpc("eth_getTransactionByHash", [hash]) as { value?: string } | null;
        encodingMatch = j?.value ? BigInt(j.value) === rootWei : null;
      } catch { /* best-effort */ }
      const outcome: PulseRailOutcome = {
        rail: "ethereum",
        ok: status === 1,
        txId: hash,
        blockNum,
        onChain: status === 1,
        mode: `${row.account}·value-encoding`,
        detail: `amount ${valueStr} ETH = wei 0x${rootWei.toString(16)} ↔ root ${digest.slice(0, 4)} · status=${status ?? "pending"} · encoding=${encodingMatch === null ? "unverified" : encodingMatch ? "✓" : "✗"}`,
      };
      if (status !== 1) outcome.error = `broadcast accepted but receipt pending/status=${status}`;
      await record("ethereum", outcome.ok, agentName, { round, hash, blockNum, status, rootWei: rootWei.toString(), encodingMatch, account: row.account, digest });
      return outcome;
    } catch (e) {
      last = (e as Error).message;
    }
  }
  await record("ethereum", false, agentName, { error: cut(last, 300), round });
  return { rail: "ethereum", ok: false, txId: null, blockNum: null, onChain: false, error: `all eth rows refused — last: ${cut(last, 200)}` };
}

async function ethRpc<T = unknown>(method: string, params: unknown[]): Promise<T> {
  let last = "";
  for (const url of ETHEREUM_RPC_URLS) {
    try {
      const res = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(20_000),
      });
      const j = (await res.json()) as { error?: { message: string }; result?: T };
      if (j?.error) { last = j.error.message; continue; }
      return j.result as T;
    } catch (e) { last = (e as Error).message; }
  }
  throw new Error(`eth:${method} — ${last}`);
}

/* ══════════════════ TRON — scan-only honest lane ══════════════════ */

async function pulseTronScan(round: string, agentName: string): Promise<PulseRailOutcome> {
  const row = await db.vaultEntry.findFirst({
    where: { kind: "tron-key", chain: "tron", account: "headcorner", role: "wallet", status: "verified" },
  });
  if (!row?.pub) {
    await record("tron", false, agentName, { error: "no verified tron row for headcorner", round });
    return { rail: "tron", ok: false, txId: null, blockNum: null, onChain: false, error: "no verified tron row for headcorner" };
  }
  try {
    // /wallet/getaccount is THE authoritative balance source (h19 lesson:
    // getaccountresource omits the balance field — caught live before a
    // wrong conclusion was drawn from it).
    const acc = await tronRpc<{ balance?: number }>("/wallet/getaccount", { address: row.pub, visible: true });
    const res2 = await tronRpc<{ freeNetUsed?: number; freeNetLimit?: number; NetUsed?: number; NetLimit?: number }>("/wallet/getaccountresource", { address: row.pub, visible: true }).catch(() => ({}) as { freeNetUsed?: number; freeNetLimit?: number; NetUsed?: number; NetLimit?: number });
    const balTrx = (acc.balance ?? 0) / 1e6;
    const freeUsed = res2.freeNetUsed ?? 0, freeLimit = res2.freeNetLimit ?? 600;
    const detail = `balance ${balTrx} TRX · bandwidth ${freeUsed}/${freeLimit}B free · fuel-scan honest`;
    const error = `scan-only lane — the TRON signer lives in the foundry lane; ${detail}; no broadcast from this repo (fail-closed by design, not by fault)`;
    await record("tron", false, agentName, { round, address: row.pub, balTrx, freeUsed, freeLimit, scanOnly: true });
    return { rail: "tron", ok: false, txId: null, blockNum: null, onChain: false, mode: "scan-only", detail, error };
  } catch (e) {
    const msg = (e as Error).message;
    await record("tron", false, agentName, { error: cut(msg, 300), round });
    return { rail: "tron", ok: false, txId: null, blockNum: null, onChain: false, error: `scan failed honestly: ${cut(msg, 160)}` };
  }
}

async function tronRpc<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.trongrid.io${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`trongrid ${path} HTTP ${res.status}`);
  return (await res.json()) as T;
}

/* ══════════════════ THE ONE COMMAND ══════════════════ */

/**
 * ONE command: seal → 6 rails → ingest. (h19 plan item 4, delivered.)
 * `force` is the operator's explicit pulse round (API path); the autonomous
 * heart path runs capped at one cycle per day (`pulse:cycle` audit row).
 */
export async function runPulseCycle(round: string, agentName: string, opts?: { force?: boolean; only?: string[] }): Promise<PulseCycleResult> {
  if (!masterReady()) throw new Error("הכספת נעולה — פעימה דורשת פתיחה (fail-closed)");
  const only = opts?.only?.length ? new Set(opts.only.map((s) => s.toLowerCase())) : null;
  const fullCycle = !only; // a filtered run (rail backfill) is never "the day's pulse"
  if (!opts?.force && fullCycle) {
    const dayStart = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    const pulsedToday = await db.gateAction.count({ where: { action: "pulse:cycle", ok: true, createdAt: { gte: dayStart } } });
    if (pulsedToday >= 1) {
      return { digest: "", counts: {}, rowCount: 0, rails: [], landed: 0, skipped: true };
    }
  }

  const { digest, counts, rowCount } = await vaultDigestV2();

  const wantGraphene = !only || [...only].some((r) => ["steem", "hive", "blurt", "graphene"].includes(r));
  const wantSol = !only || only.has("solana");
  const wantEth = !only || only.has("ethereum");
  const wantTron = !only || only.has("tron");

  // 1) the graphene trio — the r20 plane, unchanged, same payload formula.
  const g = wantGraphene
    ? await sealAnchorRound(round, agentName).catch((e) => ({
        digest, counts, rowCount,
        rails: [{ rail: "graphene", ok: false, txId: null, blockNum: null, onChain: false, error: (e as Error).message.slice(0, 200) }],
      }))
    : { digest, counts, rowCount, rails: [] as import("@/lib/gate/anchor").RailAnchorOutcome[] };

  // 2) the sovereign rails — solana memo, ethereum value-encoding, tron scan.
  const sol = wantSol
    ? await pulseSolana(round, digest, agentName).catch((e) => ({ rail: "solana", ok: false, txId: null, blockNum: null, onChain: false, error: (e as Error).message.slice(0, 200) } as PulseRailOutcome))
    : ({ rail: "solana", ok: false, txId: null, blockNum: null, onChain: false, mode: "skipped" } as PulseRailOutcome);
  const eth = wantEth
    ? await pulseEthereum(round, digest, agentName).catch((e) => ({ rail: "ethereum", ok: false, txId: null, blockNum: null, onChain: false, error: (e as Error).message.slice(0, 200) } as PulseRailOutcome))
    : ({ rail: "ethereum", ok: false, txId: null, blockNum: null, onChain: false, mode: "skipped" } as PulseRailOutcome);
  const tron = wantTron
    ? await pulseTronScan(round, agentName).catch((e) => ({ rail: "tron", ok: false, txId: null, blockNum: null, onChain: false, error: (e as Error).message.slice(0, 200) } as PulseRailOutcome))
    : ({ rail: "tron", ok: false, txId: null, blockNum: null, onChain: false, mode: "skipped" } as PulseRailOutcome);

  const rails: PulseRailOutcome[] = [
    ...g.rails.map((r) => ({ ...r, rail: r.rail, mode: r.mode ?? "graphene-anchor" })),
    sol, eth, tron,
  ].filter((r) => r.mode !== "skipped");
  const landed = rails.filter((r) => r.ok && r.onChain).length;

  if (fullCycle) {
    await db.gateAction.create({
      data: {
        agentName,
        action: "pulse:cycle",
        params: JSON.stringify({ round, plane: "pulse.r33" }),
        ok: landed > 0,
        result: JSON.stringify({ round, digest, landed, total: rails.length, rails: rails.map((r) => ({ rail: r.rail, ok: r.ok, onChain: r.onChain, txId: cut(r.txId, 18), blockNum: r.blockNum })) }),
      },
    }).catch(() => {});

    const line = rails.map((r) => `${r.rail}=${r.ok ? (r.onChain ? "✓" : "שודר") : "שער-כן"}`).join(" · ");
    await db.gateMessage.create({
      data: { channel: "command", fromKind: "system", fromName: "pulse-plane", body: `⚓ פעימה ${round} · digest ${digest.slice(0, 12)}… · ${landed}/${rails.length} מסילות עוגן-חי · ${line}`.slice(0, 980) },
    }).catch(() => {});
  }

  return { digest, counts, rowCount, rails, landed };
}

/** Latest pulse cycles from the audit trail (GET /api/gate/pulse). */
export async function readPulseHistory(take = 12): Promise<Array<{ round: string; at: string; ok: boolean; landed: number; total: number; rails: Array<{ rail: string; ok: boolean; onChain: boolean; txId: string | null; blockNum: number | null }> }>> {
  const acts = await db.gateAction.findMany({ where: { action: "pulse:cycle" }, orderBy: { createdAt: "desc" }, take });
  return acts.map((a) => {
    let r: Record<string, unknown> = {};
    try { r = JSON.parse(a.result || "{}") as Record<string, unknown>; } catch { /* empty */ }
    return {
      round: String(r.round ?? "?"),
      at: a.createdAt.toISOString(),
      ok: a.ok,
      landed: Number(r.landed ?? 0),
      total: Number(r.total ?? 0),
      rails: (r.rails as Array<{ rail: string; ok: boolean; onChain: boolean; txId: string | null; blockNum: number | null }>) ?? [],
    };
  });
}
