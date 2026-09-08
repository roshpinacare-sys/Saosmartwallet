/**
 * Saosmartwallet — Ecosystem server layer (Grid Dashboard)
 * =========================================================
 * Live probes for every network in the SAOS ecosystem + the SAOS-NET
 * sovereign chain state (daemon-pushed by their node into the `steem`
 * repo, read here through the GitHub API).
 *
 * Rules:
 *  · Every field is chain- or repo-sourced — ZERO mock market data.
 *  · Probes never throw: a dead chain is DATA (status: offline), not a 500.
 *  · Small in-process TTL cache — external RPCs and GitHub stay politely
 *    rate-limited even with several browser tabs polling.
 *  · The GitHub token never leaves the server process and is never logged.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { steemMarket } from "./steem-server";

// ---------------------------------------------------------------------------
// Tiny TTL cache
// ---------------------------------------------------------------------------

type CacheEntry = { at: number; value: unknown };

const cache = new Map<string, CacheEntry>();

export async function withCache<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: now, value });
  return value;
}

// ---------------------------------------------------------------------------
// Fetch helpers (fail-soft, with timeout)
// ---------------------------------------------------------------------------

async function fetchJson(
  url: string,
  init: RequestInit & { timeoutMs?: number },
): Promise<unknown> {
  const { timeoutMs = 5_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...rest,
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

function rpcBody(method: string, params: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 });
}

// ---------------------------------------------------------------------------
// GitHub (private repos → token required; read-only)
// ---------------------------------------------------------------------------

const GH_OWNER = "roshpinacare-sys";
const STEEM_REPO = "steem";
const SAOSNET_STATE_PATH = "sovereign/node/state.json";
const GRID98_STATE_PATH = "sovereign/node/grid98-state.json";

async function githubToken(): Promise<string | null> {
  const env = process.env.GITHUB_TOKEN;
  if (env && env.trim().length > 10) return env.trim();
  try {
    const raw = await readFile(path.join(process.cwd(), "upload", "Roshcaregt.txt"), "utf8");
    const token = raw.trim();
    return token.length > 10 ? token : null;
  } catch {
    return null;
  }
}

export async function githubRaw(repo: string, filePath: string): Promise<string | null> {
  const token = await githubToken();
  if (!token) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(`https://raw.githubusercontent.com/${GH_OWNER}/${repo}/main/${filePath}`, {
      headers: { Authorization: `token ${token}` },
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Chain probes — each returns a normalized, honest status
// ---------------------------------------------------------------------------

export type ChainStatusKind = "online" | "stale" | "offline";

export interface EcoChain {
  id: string;
  name: string;
  family: string;
  kind: string;
  status: ChainStatusKind;
  /** Head height (number) when the chain exposes one. */
  headHeight: number | null;
  /** Seconds between the chain's head time and our clock (probed chains only). */
  lagSeconds: number | null;
  /** For push-based chains (SAOS-NET): age of the last daemon-pushed state. */
  stateAgeSeconds: number | null;
  headId: string | null;
  version: string | null;
  /** One-line, human-readable evidence (what was actually measured). */
  note: string;
  probedAt: string;
}

async function probeGraphene(
  id: string,
  name: string,
  kind: string,
  urls: string[],
  timeoutMs: number,
): Promise<EcoChain> {
  const base: Omit<EcoChain, "status" | "headHeight" | "lagSeconds" | "headId" | "version" | "note"> & {
    status?: ChainStatusKind;
    note?: string;
  } = {
    id,
    name,
    family: "Graphene",
    kind,
    stateAgeSeconds: null,
    probedAt: new Date().toISOString(),
  };
  let lastErr = "unknown";
  for (const url of urls) {
    try {
      const res = (await fetchJson(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: rpcBody("condenser_api.get_dynamic_global_properties", []),
        timeoutMs,
      })) as { result?: Record<string, unknown> } | Record<string, unknown>;
      const r = ("result" in res && res.result ? res.result : res) as Record<string, unknown>;
      const head = typeof r.head_block_number === "number" ? r.head_block_number : null;
      if (head === null) throw new Error("no head_block_number");
      const timeStr = typeof r.time === "string" ? r.time : null;
      const lag = timeStr ? Math.max(0, Math.round((Date.now() - Date.parse(`${timeStr}Z`)) / 1000)) : null;
      return {
        ...base,
        status: "online",
        headHeight: head,
        lagSeconds: lag,
        headId: typeof r.head_block_id === "string" ? r.head_block_id : null,
        version: typeof r.hf_version === "string" ? r.hf_version : null,
        note: `live probe ${url.replace("https://", "")}`,
      };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : "unknown";
    }
  }
  return {
    ...base,
    status: "offline",
    headHeight: null,
    lagSeconds: null,
    headId: null,
    version: null,
    note: `probe failed: ${lastErr}`,
  };
}

async function probeTron(): Promise<EcoChain> {
  const base = {
    id: "tron",
    name: "TRON",
    family: "TVM (DPoS)",
    kind: "L1 public — zero-fee anchor rail",
    stateAgeSeconds: null,
    probedAt: new Date().toISOString(),
  };
  try {
    const r = (await fetchJson("https://api.trongrid.io/wallet/getnowblock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      timeoutMs: 5_000,
    })) as {
      blockID?: string;
      block_header?: { raw_data?: { number?: number; timestamp?: number } };
    };
    const head = r.block_header?.raw_data?.number;
    if (typeof head !== "number") throw new Error("no block number");
    const ts = r.block_header?.raw_data?.timestamp ?? Date.now();
    const lag = Math.max(0, Math.round((Date.now() - ts) / 1000));
    return {
      ...base,
      status: "online",
      headHeight: head,
      lagSeconds: lag,
      headId: r.blockID ? `${r.blockID.slice(0, 16)}…` : null,
      version: null,
      note: "live probe api.trongrid.io",
    };
  } catch (err) {
    return {
      ...base,
      status: "offline",
      headHeight: null,
      lagSeconds: null,
      headId: null,
      version: null,
      note: `probe failed: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}

async function probeSteem(): Promise<EcoChain> {
  const base = {
    id: "steem",
    name: "STEEM",
    family: "Graphene",
    kind: "L1 public — internal market (our DEX)",
    stateAgeSeconds: null,
    probedAt: new Date().toISOString(),
  };
  try {
    const cs = await steemMarket().chainStatus();
    return {
      ...base,
      status: cs.lagSeconds > 0 && cs.lagSeconds < 60 ? "online" : "stale",
      headHeight: cs.headBlock,
      lagSeconds: cs.lagSeconds,
      headId: cs.headBlockId.slice(0, 16) || null,
      version: null,
      note: "live probe via M0/M1 SteemMarketClient",
    };
  } catch (err) {
    return {
      ...base,
      status: "offline",
      headHeight: null,
      lagSeconds: null,
      headId: null,
      version: null,
      note: `probe failed: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}

async function probeEthereum(): Promise<EcoChain> {
  const base = {
    id: "ethereum",
    name: "ETHEREUM",
    family: "EVM",
    kind: "L1 public — settlement + ERC-20 wrapped economy (M3)",
    stateAgeSeconds: null,
    probedAt: new Date().toISOString(),
  };
  const urls = ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org", "https://eth-mainnet.public.blastapi.io"];
  let lastErr = "unknown";
  for (const url of urls) {
    try {
      // Raw JSON-RPC — no SDK in the probe path; eth_getBlockByNumber(false)
      // gives head height + timestamp + baseFee in ONE call.
      const r = (await fetchJson(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["latest", false] }),
        timeoutMs: 6_000,
      })) as { result?: { number?: string; timestamp?: string; baseFeePerGas?: string } };
      const block = r.result;
      if (!block?.number) throw new Error("no block");
      const head = Number.parseInt(block.number, 16);
      const ts = block.timestamp ? Number.parseInt(block.timestamp, 16) * 1000 : Date.now();
      const baseFeeWei = block.baseFeePerGas ? BigInt(block.baseFeePerGas) : null;
      return {
        ...base,
        status: "online",
        headHeight: head,
        lagSeconds: Math.max(0, Math.round((Date.now() - ts) / 1000)),
        headId: null,
        version: baseFeeWei ? `${Number(baseFeeWei) / 1e9} gwei baseFee` : null,
        note: `live probe ${url.replace("https://", "")}`,
      };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : "unknown";
    }
  }
  return {
    ...base,
    status: "offline",
    headHeight: null,
    lagSeconds: null,
    headId: null,
    version: null,
    note: `probe failed: ${lastErr}`,
  };
}

async function probeSolana(): Promise<EcoChain> {
  const base = {
    id: "solana",
    name: "SOLANA",
    family: "PoH + PoS",
    kind: "L1 public — SPL wrapped economy (M3)",
    stateAgeSeconds: null,
    probedAt: new Date().toISOString(),
  };
  const urls = ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"];
  let lastErr = "unknown";
  for (const url of urls) {
    try {
      const r = (await fetchJson(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getEpochInfo" }),
        timeoutMs: 6_000,
      })) as { result?: { absoluteSlot?: number; epoch?: number; slotIndex?: number; slotsInEpoch?: number } };
      const ep = r.result;
      if (!ep?.absoluteSlot) throw new Error("no epoch info");
      return {
        ...base,
        status: "online",
        headHeight: ep.absoluteSlot,
        lagSeconds: null, // slots carry no wall-clock timestamp in this response — honest null
        headId: null,
        version: `epoch ${ep.epoch} · slot ${ep.slotIndex ?? "—"}/${ep.slotsInEpoch ?? "—"}`,
        note: `live probe ${url.replace("https://", "")}`,
      };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : "unknown";
    }
  }
  return {
    ...base,
    status: "offline",
    headHeight: null,
    lagSeconds: null,
    headId: null,
    version: null,
    note: `probe failed: ${lastErr}`,
  };
}

// ---------------------------------------------------------------------------
// SAOS-NET sovereign state (daemon-pushed into the `steem` repo)
// ---------------------------------------------------------------------------

export interface SaosNetPool {
  pair: string;
  baseReserve: number;
  quoteReserve: number;
  px: number;
  lp: number;
}

export interface SaosNetOracleQuote {
  asset: string;
  /** Quoted price in USD (nano-dollar scale converted). */
  pxUsd: number;
  src: string;
  ref: string;
  at: string;
}

export interface SaosNetWrapped {
  asset: string;
  supply: number;
  locked: number;
  holders: number;
}

export interface SaosNetSnapshot {
  ok: true;
  fetchedAt: string;
  stateAvailable: boolean;
  core: {
    netVersion: string | null;
    genesisHash: string | null;
    height: number | null;
    stateRoot: string | null;
    lastBlockHash: string | null;
    updatedAt: string | null;
    checkpointCount: number;
    verifiedCount: number;
  };
  engine: {
    at: string | null;
    ticks: number | null;
    rounds: number | null;
    tradesToday: number | null;
    txsToday: number | null;
    tradesTotal: number | null;
    txsTotal: number | null;
    treasuryPnlSAOS: number | null;
    treasuryPnlTodaySAOS: number | null;
    floor: number | null;
    bench: { txsPerSec: number | null; capabilityPerDay: number | null; at: string | null; note: string | null };
    leaderboard: Array<{ name: string; pnlMicro: number }>;
  };
  book: {
    asks: Array<{ id: number; owner: string; amount: number; price: number }>;
    bids: Array<{ id: number; owner: string; amount: number; price: number }>;
  };
  sov: { floats: number | null; orders: number | null; fills: number | null; matches: number | null };
  oracle: SaosNetOracleQuote[];
  wrapped: SaosNetWrapped[];
  assetMeta: Record<string, { chain: string; contract: string; decimals: number; note: string }>;
  pools: SaosNetPool[];
  tronBridge: {
    address: string | null;
    relay: string | null;
    anchors: number | null;
    lastAnchor: { cpHeight: number | null; txid: string | null; tronBlock: number | null; at: string | null } | null;
    pulse: { tronHeight: number | null; at: string | null } | null;
    usdtTotal: number | null;
    measuredAddresses: string | null;
  };
  delegations: Array<{ name: string; scopes: string[] }>;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function normalizeSaosNet(raw: Record<string, unknown>, grid98Raw: Record<string, unknown> | null): SaosNetSnapshot {
  const checkpoints = Array.isArray(raw.checkpoints) ? (raw.checkpoints as Record<string, unknown>[]) : [];
  const lastCp = checkpoints.length > 0 ? checkpoints[checkpoints.length - 1] : null;
  const verified = raw.verified;
  // `verified` has been observed as an array of verified checkpoint hashes
  // (len 1112 at scan time) — accept both array and object shapes.
  const verifiedCount = Array.isArray(verified)
    ? verified.length
    : verified && typeof verified === "object"
      ? Object.keys(verified).length
      : 0;

  const g = grid98Raw ?? {};
  const bench = (g.bench ?? {}) as Record<string, unknown>;
  const leaderboard = Array.isArray(g.leaderboard) ? (g.leaderboard as Record<string, unknown>[]) : [];

  const oracleRaw = (raw.assetPricesSummary ?? {}) as Record<string, Record<string, unknown>>;
  const oracle: SaosNetOracleQuote[] = Object.entries(oracleRaw)
    .map(([asset, q]) => ({
      asset,
      // their oracle quotes are integer nano-dollars (1e9 = $1.00)
      pxUsd: typeof q.px === "number" ? q.px / 1e9 : NaN,
      src: typeof q.src === "string" ? q.src : "—",
      ref: typeof q.ref === "string" ? q.ref : "—",
      at: typeof q.at === "string" ? q.at : "—",
    }))
    .sort((a, b) => a.asset.localeCompare(b.asset));

  const wrappedRaw = (raw.wrappedSummary ?? {}) as Record<string, Record<string, unknown>>;
  const wrapped: SaosNetWrapped[] = Object.entries(wrappedRaw)
    .map(([asset, w]) => ({
      asset,
      supply: typeof w.supply === "number" ? w.supply : 0,
      locked: typeof w.locked === "number" ? w.locked : 0,
      holders: typeof w.holders === "number" ? w.holders : 0,
    }))
    .sort((a, b) => b.locked - a.locked || a.asset.localeCompare(b.asset));

  const metaRaw = (raw.assetMetaSummary ?? {}) as Record<string, Record<string, unknown>>;
  const assetMeta: SaosNetSnapshot["assetMeta"] = {};
  for (const [asset, m] of Object.entries(metaRaw)) {
    assetMeta[asset] = {
      chain: typeof m.chain === "string" ? m.chain : "—",
      contract: typeof m.contract === "string" ? m.contract : "",
      decimals: typeof m.decimals === "number" ? m.decimals : 0,
      note: typeof m.note === "string" ? m.note : "",
    };
  }

  const poolsRaw = (g.pools ?? {}) as Record<string, Record<string, unknown>>;
  const pools: SaosNetPool[] = Object.entries(poolsRaw)
    .map(([pair, p]) => ({
      pair,
      baseReserve: typeof p.a === "number" ? p.a : 0,
      quoteReserve: typeof p.b === "number" ? p.b : 0,
      px: typeof p.px === "number" ? p.px : 0,
      lp: typeof p.lp === "number" ? p.lp : 0,
    }))
    .sort((a, b) => b.lp - a.lp || a.pair.localeCompare(b.pair));

  const bookRaw = (raw.book ?? {}) as Record<string, unknown>;
  const sideOf = (v: unknown) =>
    Array.isArray(v)
      ? (v as Record<string, unknown>[]).map((o) => ({
          id: typeof o.id === "number" ? o.id : 0,
          owner: typeof o.owner === "string" ? o.owner : "—",
          amount: typeof o.amount === "number" ? o.amount : 0,
          price: typeof o.price === "number" ? o.price : 0,
        }))
      : [];

  const sovRaw = (raw.sov ?? {}) as Record<string, unknown>;
  const tronRaw = (raw.tron ?? {}) as Record<string, unknown>;
  const lastAnchorRaw = (tronRaw.lastAnchor ?? {}) as Record<string, unknown>;
  const pulseRaw = (tronRaw.pulse ?? {}) as Record<string, unknown>;
  const derivativesRaw = (tronRaw.derivatives ?? {}) as Record<string, unknown>;
  const delegationsRaw = (raw.delegationsSummary ?? {}) as Record<string, Record<string, unknown>>;

  return {
    ok: true,
    fetchedAt: new Date().toISOString(),
    stateAvailable: true,
    core: {
      netVersion: str(raw.netVersion),
      genesisHash: str(raw.genesisHash),
      height: num(raw.height),
      stateRoot: str(raw.stateRoot),
      lastBlockHash: str(raw.lastBlockHash),
      updatedAt: str(raw.updatedAt),
      checkpointCount: checkpoints.length,
      verifiedCount,
    },
    engine: {
      at: str(g.at),
      ticks: num(g.ticks),
      rounds: num(g.rounds),
      tradesToday: num(g.tradesToday),
      txsToday: num(g.txsToday),
      tradesTotal: num(g.tradesTotal),
      txsTotal: num(g.txsTotal),
      treasuryPnlSAOS: num(g.treasuryPnlSAOS),
      treasuryPnlTodaySAOS: num(g.treasuryPnlTodaySAOS),
      floor: num(g.floor),
      bench: {
        txsPerSec: num(bench.txsPerSec),
        capabilityPerDay: num(bench.capabilityPerDay),
        at: str(bench.at),
        note: str(bench.note),
      },
      leaderboard: leaderboard.map((l) => ({
        name: typeof l.name === "string" ? l.name : "—",
        pnlMicro: typeof l.pnlµ === "number" ? l.pnlµ : 0,
      })),
    },
    book: { asks: sideOf(bookRaw.asks), bids: sideOf(bookRaw.bids) },
    sov: {
      floats: num(sovRaw.floats),
      orders: num(sovRaw.orders),
      fills: num(sovRaw.fills),
      matches: num(sovRaw.matches),
    },
    oracle,
    wrapped,
    assetMeta,
    pools,
    tronBridge: {
      address: str(tronRaw.address),
      relay: str(tronRaw.relay),
      anchors: num(tronRaw.anchors),
      lastAnchor: lastAnchorRaw
        ? {
            cpHeight: num(lastAnchorRaw.cpHeight),
            txid: str(lastAnchorRaw.txid),
            tronBlock: num(lastAnchorRaw.tronBlock),
            at: str(lastAnchorRaw.at),
          }
        : null,
      pulse: { tronHeight: num(pulseRaw.tronHeight), at: str(pulseRaw.at) },
      usdtTotal: num(derivativesRaw.usdtTotal),
      measuredAddresses: str(derivativesRaw.measured),
    },
    delegations: Object.entries(delegationsRaw).map(([name, d]) => ({
      name,
      scopes: Array.isArray(d.scopes) ? (d.scopes as string[]) : [],
    })),
  };
}

export async function saosNetSnapshot(): Promise<SaosNetSnapshot | { ok: false; error: string }> {
  return withCache("saosnet", 15_000, async () => {
    const [stateText, gridText] = await Promise.all([
      githubRaw(STEEM_REPO, SAOSNET_STATE_PATH),
      githubRaw(STEEM_REPO, GRID98_STATE_PATH),
    ]);
    if (!stateText) {
      return { ok: false, error: "SAOS-NET state unavailable (github raw fetch failed)" };
    }
    try {
      const state = JSON.parse(stateText) as Record<string, unknown>;
      const grid = gridText ? (JSON.parse(gridText) as Record<string, unknown>) : null;
      return normalizeSaosNet(state, grid);
    } catch (err) {
      return { ok: false, error: `state parse failed: ${err instanceof Error ? err.message : "unknown"}` };
    }
  });
}

async function probeSaosNet(): Promise<EcoChain> {
  const snap = await saosNetSnapshot();
  const base = {
    id: "saos-net",
    name: "SAOS-NET",
    family: "Sovereign (deterministic kernel)",
    kind: "L1 shadow chain — anchored to Steem/Hive/TRON",
    probedAt: new Date().toISOString(),
  };
  if (!("ok" in snap) || snap.ok !== true) {
    return {
      ...base,
      status: "offline",
      headHeight: null,
      lagSeconds: null,
      stateAgeSeconds: null,
      headId: null,
      version: null,
      note: "daemon state not reachable",
    };
  }
  const updatedAt = snap.core.updatedAt ? Date.parse(snap.core.updatedAt) : NaN;
  const age = Number.isFinite(updatedAt) ? Math.max(0, Math.round((Date.now() - updatedAt) / 1000)) : null;
  return {
    ...base,
    status: age !== null && age < 3_600 ? "online" : "stale",
    headHeight: snap.core.height,
    lagSeconds: null,
    stateAgeSeconds: age,
    headId: snap.core.lastBlockHash ? `${snap.core.lastBlockHash.slice(0, 16)}…` : null,
    version: snap.core.netVersion,
    note:
      age !== null
        ? `daemon-pushed state, ${age < 90 ? `${age}s` : `${Math.round(age / 60)}m`} old (github: steem repo)`
        : "daemon-pushed state (github: steem repo)",
  };
}

// ---------------------------------------------------------------------------
// Public server API
// ---------------------------------------------------------------------------

export async function ecoNetworks(): Promise<{ ok: true; chains: EcoChain[]; fetchedAt: string }> {
  return withCache("eco-networks", 6_000, async () => {
    const [steem, hive, blurt, tron, saosnet, ethereum, solana] = await Promise.all([
      probeSteem(),
      probeGraphene(
        "hive",
        "HIVE",
        "L1 public — anchor rail (RC-gated)",
        ["https://api.hive.blog", "https://api.openhive.network", "https://anyx.tv"],
        5_000,
      ),
      probeGraphene(
        "blurt",
        "BLURT",
        "L1 public — anchor rail (canonical sig)",
        ["https://rpc.blurt.world", "https://blurt-rpc.saboin.com"],
        4_500,
      ),
      probeTron(),
      probeSaosNet(),
      probeEthereum(),
      probeSolana(),
    ]);
    return { ok: true, chains: [steem, hive, blurt, tron, saosnet, ethereum, solana], fetchedAt: new Date().toISOString() };
  });
}

export interface AnchorRecord {
  id: string;
  kind: "checkpoint-anchor" | "tron-anchor" | "soldier-attest";
  chain: "steem" | "hive" | "tron" | "internal";
  cpHeight: number;
  txid: string | null;
  detail: string;
  explorer: string | null;
}

export interface EcoAnchors {
  ok: true;
  anchors: AnchorRecord[];
  attests: AnchorRecord[];
  lastCheckpoint: {
    height: number | null;
    checkpointHash: string | null;
    stateRoot: string | null;
  } | null;
  fetchedAt: string;
}

function steemExplorer(txid: string): string {
  return `https://steemworld.org/tx/${txid}`;
}

function hiveExplorer(txid: string): string {
  return `https://hiveblocks.com/tx/${txid}`;
}

export async function ecoAnchors(): Promise<EcoAnchors> {
  return withCache("eco-anchors", 45_000, async () => {
    const snap = await saosNetSnapshot();
    const anchors: AnchorRecord[] = [];
    const attests: AnchorRecord[] = [];
    let lastCheckpoint: EcoAnchors["lastCheckpoint"] = null;

    if ("ok" in snap && snap.ok === true) {
      // fresh checkpoints from the live state — pull anchors + attests out of them
      const stateText = await githubRaw(STEEM_REPO, SAOSNET_STATE_PATH);
      if (stateText) {
        try {
          const state = JSON.parse(stateText) as Record<string, unknown>;
          const cps = Array.isArray(state.checkpoints) ? (state.checkpoints as Record<string, unknown>[]) : [];
          const lastCp = cps.length > 0 ? cps[cps.length - 1] : null;
          if (lastCp) {
            lastCheckpoint = {
              height: typeof lastCp.height === "number" ? lastCp.height : null,
              checkpointHash: typeof lastCp.checkpointHash === "string" ? lastCp.checkpointHash : null,
              stateRoot: typeof lastCp.stateRoot === "string" ? lastCp.stateRoot : null,
            };
          }
          for (const cp of cps.slice(-14).reverse()) {
            const cpHeight = typeof cp.height === "number" ? cp.height : 0;
            const cpHash = typeof cp.checkpointHash === "string" ? cp.checkpointHash : null;
            const cpAnchors = (cp.anchors ?? {}) as Record<string, unknown>;
            for (const [chain, txid] of Object.entries(cpAnchors)) {
              if (typeof txid !== "string" || txid.length < 10) continue;
              anchors.push({
                id: `cp-${cpHeight}-${chain}`,
                kind: "checkpoint-anchor",
                chain: chain === "hive" ? "hive" : chain === "tron" ? "tron" : "steem",
                cpHeight,
                txid,
                detail: `SAOS-NET cp#${cpHeight} → ${chain.toUpperCase()} (stateRoot ${(typeof cp.stateRoot === "string" ? cp.stateRoot : "").slice(0, 14)}…)`,
                explorer: chain === "hive" ? hiveExplorer(txid) : chain === "tron" ? `https://tronscan.org/#/transaction/${txid}` : steemExplorer(txid),
              });
            }
            const cpAttests = Array.isArray(cp.attests) ? (cp.attests as Record<string, unknown>[]) : [];
            for (const a of cpAttests) {
              if (typeof a.txid !== "string" || a.txid.length < 10) continue;
              attests.push({
                id: `att-${cpHeight}-${String(a.by)}`,
                kind: "soldier-attest",
                chain: "internal",
                cpHeight,
                txid: a.txid,
                detail: `${String(a.by ?? "soldier")} attested cp#${cpHeight}`,
                explorer: steemExplorer(a.txid),
              });
            }
          }
        } catch {
          // fall through — anchors list stays empty (honest)
        }
      }

      const tb = snap.tronBridge.lastAnchor;
      if (tb?.txid && tb.cpHeight) {
        anchors.push({
          id: `tron-${tb.cpHeight}`,
          kind: "tron-anchor",
          chain: "tron",
          cpHeight: tb.cpHeight,
          txid: tb.txid,
          detail: `SAOS⇄TRON bridge anchor cp#${tb.cpHeight} @ TRON blk ${tb.tronBlock ?? "—"} (amount encodes hash)`,
          explorer: `https://tronscan.org/#/transaction/${tb.txid}`,
        });
      }
    }

    return {
      ok: true,
      anchors: anchors.slice(0, 16),
      attests: attests.slice(0, 12),
      lastCheckpoint,
      fetchedAt: new Date().toISOString(),
    };
  });
}
