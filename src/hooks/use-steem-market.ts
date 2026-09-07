"use client";

/**
 * Live-data hooks for the DEX. Every hook polls a local API route that reads
 * the chain through the M0/M1 packages — NO mock data anywhere. Poll intervals
 * are tuned per surface (status 3s, book 5s, fills 12s, wallet 15s).
 */

import { keepPreviousData, useQuery } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types mirroring the API responses (server is the single source of truth)
// ---------------------------------------------------------------------------

export interface MarketTicker {
  latest: string;
  highestBid: string;
  lowestAsk: string;
  percentChange: number;
  steemVolumeSatoshis: number;
  sbdVolumeSatoshis: number;
  steemVolume: string;
  sbdVolume: string;
}

export interface ChainStatus {
  headBlock: number;
  headBlockId: string;
  time: string;
  lagSeconds: number;
  totalVestingFundSatoshis: number;
  totalVestingSharesSatoshis: number;
}

export interface MarketFeedResponse {
  ok: true;
  endpoint: string;
  ticker: MarketTicker;
  chainStatus: ChainStatus;
}

export interface MarketLevel {
  price: string;
  priceNum: number;
  steemSatoshis: number;
  sbdSatoshis: number;
  steemAmount: string;
  sbdAmount: string;
  created: string;
}

export interface OrderBookResponse {
  ok: true;
  asks: MarketLevel[];
  bids: MarketLevel[];
  fetchedAt: string;
}

export interface TradeFill {
  date: string;
  price: number;
  steemSatoshis: number;
  sbdSatoshis: number;
  steemAmount: string;
  sbdAmount: string;
  side: "buy" | "sell";
}

export interface WalletResponse {
  ok: true;
  endpoint: string;
  account: {
    name: string;
    created: string | null;
    balances: {
      liquid: string;
      vestingShares: string;
      debt: string;
    };
    spSatoshis: number;
  };
  rc: { currentMana: string; maxRc: string; percent: number } | null;
  openOrders: Array<{
    orderid: number;
    created: string;
    expiration: string;
    seller: string;
    forSaleSatoshis: number;
    sellingSymbol: string;
    sellingAmount: string;
    receivingSymbol: string;
    receivingAmount: string;
    price: number;
  }>;
  chainStatus: { headBlock: number; time: string };
}

export interface BuildOrderResponse {
  ok: true;
  signingStatus: string;
  side: "buy" | "sell";
  operation: {
    type: string;
    payload: {
      owner: string;
      orderid: number;
      amount_to_sell: string;
      min_to_receive: string;
      fill_or_kill: boolean;
      expiration: string;
    };
  };
  effectivePrice: string;
  unsignedTx: {
    chainId: string;
    refBlockNum: number;
    refBlockPrefix: number;
    txExpiration: string;
    orderExpiration: string;
  };
  serializedHex: string;
  digestHex: string;
  txId: string;
  byteLength: number;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const body = (await res.json()) as T | { ok: false; error: string };
  if (!res.ok || !("ok" in body) || body.ok !== true) {
    throw new Error(("error" in body && body.error) || `request failed (${res.status})`);
  }
  return body;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useMarketFeed() {
  return useQuery({
    queryKey: ["steem", "market"],
    queryFn: () => getJson<MarketFeedResponse>("/api/steem/market"),
    refetchInterval: 4000,
    placeholderData: keepPreviousData,
  });
}

export function useOrderBook(limit = 25) {
  return useQuery({
    queryKey: ["steem", "orderbook", limit],
    queryFn: () => getJson<OrderBookResponse>(`/api/steem/orderbook?limit=${limit}`),
    refetchInterval: 5000,
    placeholderData: keepPreviousData,
  });
}

export function useTradeHistory(limit = 50) {
  return useQuery({
    queryKey: ["steem", "history", limit],
    queryFn: () => getJson<{ ok: true; fills: TradeFill[] }>(`/api/steem/history?limit=${limit}`),
    refetchInterval: 12000,
    placeholderData: keepPreviousData,
  });
}

const ACCOUNT_RE = /^[a-z0-9.\-]{3,16}$/;

export function useWallet(account: string) {
  const name = account.trim().toLowerCase();
  return useQuery({
    queryKey: ["steem", "wallet", name],
    queryFn: () => getJson<WalletResponse>(`/api/steem/wallet?name=${encodeURIComponent(name)}`),
    enabled: ACCOUNT_RE.test(name),
    refetchInterval: 15000,
    placeholderData: keepPreviousData,
  });
}

export async function buildOrder(body: {
  account: string;
  side: "buy" | "sell";
  amount: string;
  price: string;
  fillOrKill: boolean;
  ttlSeconds: number;
}): Promise<BuildOrderResponse> {
  const res = await fetch("/api/steem/trade/build", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const parsed = (await res.json()) as BuildOrderResponse | { ok: false; error: string };
  if (!res.ok || !("ok" in parsed) || parsed.ok !== true) {
    throw new Error(("error" in parsed && parsed.error) || "order build failed");
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Display formatting (client-side, presentation only — the server owns the
// exact integer math; these helpers never feed back into order building)
// ---------------------------------------------------------------------------

export function fmtPrice(p: number): string {
  if (!Number.isFinite(p)) return "—";
  const abs = Math.abs(p);
  const decimals = abs >= 100 ? 3 : abs >= 1 ? 5 : 7;
  return p.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtSat(sat: number, precision: 3 | 6 = 3): string {
  const sign = sat < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(sat));
  const scale = precision === 3 ? 1000 : 1_000_000;
  return `${sign}${Math.floor(abs / scale).toLocaleString("en-US")}.${String(abs % scale).padStart(precision, "0")}`;
}

export function fmtInt(n: number): string {
  return Math.trunc(n).toLocaleString("en-US");
}

export function timeAgo(iso: string, nowMs = Date.now()): string {
  const t = Date.parse(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function fmtClock(iso: string): string {
  const t = Date.parse(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toLocaleTimeString("en-GB", { hour12: false });
}
