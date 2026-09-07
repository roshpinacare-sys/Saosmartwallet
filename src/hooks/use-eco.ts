"use client";

/**
 * Grid Dashboard hooks — live ecosystem data. Every hook polls a local API
 * route; the server owns all external probing (chain RPCs + GitHub) with a
 * small TTL cache. NO mock data: a dead chain renders as an honest
 * "offline" state, never as invented numbers.
 */

import { keepPreviousData, useQuery } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types (mirror of the API responses — server is the source of truth)
// ---------------------------------------------------------------------------

export type ChainStatusKind = "online" | "stale" | "offline";

export interface EcoChain {
  id: string;
  name: string;
  family: string;
  kind: string;
  status: ChainStatusKind;
  headHeight: number | null;
  lagSeconds: number | null;
  stateAgeSeconds: number | null;
  headId: string | null;
  version: string | null;
  note: string;
  probedAt: string;
}

export interface NetworksResponse {
  ok: true;
  chains: EcoChain[];
  fetchedAt: string;
}

export interface SaosNetPool {
  pair: string;
  baseReserve: number;
  quoteReserve: number;
  px: number;
  lp: number;
}

export interface SaosNetOracleQuote {
  asset: string;
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

export interface SaosNetResponse {
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

export interface AnchorRecord {
  id: string;
  kind: "checkpoint-anchor" | "tron-anchor" | "soldier-attest";
  chain: "steem" | "hive" | "tron" | "internal";
  cpHeight: number;
  txid: string | null;
  detail: string;
  explorer: string | null;
}

export interface AnchorsResponse {
  ok: true;
  anchors: AnchorRecord[];
  attests: AnchorRecord[];
  lastCheckpoint: { height: number | null; checkpointHash: string | null; stateRoot: string | null } | null;
  fetchedAt: string;
}

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const body: unknown = await res.json();
  const probe = body as { ok?: unknown; error?: unknown } | null;
  if (!res.ok || !probe || probe.ok !== true) {
    const message = typeof probe?.error === "string" && probe.error ? probe.error : `request failed (${res.status})`;
    throw new Error(message);
  }
  return body as T;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useEcoNetworks() {
  return useQuery({
    queryKey: ["eco", "networks"],
    queryFn: () => getJson<NetworksResponse>("/api/eco/networks"),
    refetchInterval: 7000,
    placeholderData: keepPreviousData,
  });
}

export function useEcoSaosNet() {
  return useQuery({
    queryKey: ["eco", "saosnet"],
    queryFn: () => getJson<SaosNetResponse>("/api/eco/saosnet"),
    refetchInterval: 12000,
    retry: 1,
    placeholderData: keepPreviousData,
  });
}

export function useEcoAnchors() {
  return useQuery({
    queryKey: ["eco", "anchors"],
    queryFn: () => getJson<AnchorsResponse>("/api/eco/anchors"),
    refetchInterval: 30000,
    placeholderData: keepPreviousData,
  });
}

// ---------------------------------------------------------------------------
// M3 — bridges + multi-chain accounts
// ---------------------------------------------------------------------------

export interface BridgePath {
  id: string;
  source: string;
  target: string;
  label: string;
  route: Array<{ network: string; contract: string | null; action: string }>;
  estimatedTime: number;
  fee: {
    legs: Array<{ network: string; amount: string; currency: string; source: string }>;
    allMeasured: boolean;
  };
  readiness: "live" | "gated";
  gateReason: string | null;
  trustLevel: string;
  trustDetail: string;
}

export interface BridgeRoutesResponse {
  ok: true;
  from: string;
  to: string;
  asset: string;
  amount: string;
  paths: BridgePath[];
  quotedAt: string;
}

export function useBridgeRoutes(params: { from: string; to: string; asset: string; amount: string; enabled: boolean }) {
  return useQuery({
    queryKey: ["bridge", "routes", params.from, params.to, params.asset, params.amount],
    queryFn: () =>
      getJson<BridgeRoutesResponse>(
        `/api/bridge/routes?from=${encodeURIComponent(params.from)}&to=${encodeURIComponent(params.to)}&asset=${encodeURIComponent(params.asset)}&amount=${encodeURIComponent(params.amount)}`,
      ),
    enabled: params.enabled && params.from !== params.to,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
}

export interface BridgeStatusResponse {
  ok: true;
  statuses: Array<{
    id: string;
    rail: string;
    mechanism: string;
    status: "live" | "gated" | "offline";
    evidence: string;
    explorer: string | null;
    lastActivityAt: string | null;
  }>;
  analytics: {
    anchoredTotal: number | null;
    checkpointsVerified: number | null;
    checkpointsTotal: number | null;
    lastAnchor: { at: string | null; txid: string | null; chain: string | null; cpHeight: number | null } | null;
    wrapped: Array<{ asset: string; supply: number; locked: number; holders: number }>;
    sourcedAt: string;
  };
  fetchedAt: string;
}

export function useBridgeStatus() {
  return useQuery({
    queryKey: ["bridge", "status"],
    queryFn: () => getJson<BridgeStatusResponse>("/api/bridge/status"),
    refetchInterval: 45_000,
    placeholderData: keepPreviousData,
  });
}

export interface EcoAccountResponse {
  ok: true;
  network: "ethereum" | "solana";
  account: { address: string; balance: string; nonce?: number; ownerProgram?: string | null; isContract?: boolean; codeKind?: "none" | "eip7702" | "contract" };
  native: { symbol: string; decimals: number; amount: string };
  token?: { token: string; symbol: string | null; decimals: number | null; amount: string; formatted: string | null } | null;
  tokens?: Array<{ mint: string; amount: string; decimals: number | null; formatted: string | null; tokenProgram: string }>;
  probedAt: string;
}

export function useEcoAccount(network: "ethereum" | "solana" | null, address: string) {
  return useQuery({
    queryKey: ["eco", "account", network, address],
    queryFn: () =>
      getJson<EcoAccountResponse>(
        `/api/eco/account?network=${network}&address=${encodeURIComponent(address)}`,
      ),
    enabled: Boolean(network && address),
    refetchInterval: 30_000,
    retry: false,
    placeholderData: keepPreviousData,
  });
}

// ---------------------------------------------------------------------------
// Formatting helpers (display only)
// ---------------------------------------------------------------------------

export function fmtHeight(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US") : "—";
}

export function fmtUsd(n: number | null | undefined, opts?: { maxDecimals?: number }): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const decimals =
    opts?.maxDecimals ??
    (abs === 0 ? 2 : abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 5 : 8);
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: Math.min(2, decimals), maximumFractionDigits: decimals })}`;
}

export function fmtAge(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "—";
  if (seconds < 90) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

export function fmtCompact(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function fmtMicroSaos(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return `${(n / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAOS`;
}
