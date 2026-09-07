/**
 * Saosmartwallet — Steem internal market client (M1 DEX, read-only)
 * =================================================================
 * Live market data for the STEEM/SBD internal exchange. Response shapes were
 * captured empirically against api.steemit.com (2026-09-07) — no guessing:
 *
 *   condenser_api.get_order_book[limit]
 *     → { asks|bids: [{ created, order_price:{base,quote}, real_price, sbd, steem }] }
 *       · real_price = SBD per 1 STEEM (decimal string, node-computed)
 *       · steem / sbd = integer satoshi amounts (precision 3)
 *       · asks sorted best-first (ascending price); bids best-first (descending)
 *   condenser_api.get_ticker[]
 *     → { highest_bid, latest, lowest_ask, percent_change, sbd_volume, steem_volume }
 *       · percent_change is a decimal fraction (-0.0284 ≙ -2.84%)
 *   condenser_api.get_trade_history[start, stop, limit]
 *     → [{ current_pays, open_pays, date }]  (start=older bound, stop=newer;
 *       direction side: current_pays symbol decides buy/sell of STEEM)
 *   condenser_api.get_open_orders[account]
 *     → [{ orderid, created, expiration, seller, for_sale, sell_price:{base,quote} }]
 *   condenser_api.get_dynamic_global_properties[]
 *     → head_block_number, time, head_block_id, total_vesting_fund_steem,
 *       total_vesting_shares (VESTS→STEEM conversion for SP display)
 *
 * All chain amounts stay integers (satoshis) until display formatting; no
 * float math ever mutates an amount.
 */

import { parseAsset } from "./serializer";
import { validateAccountName } from "./adapter";

export interface MarketLevel {
  /** Price in SBD per 1 STEEM — node-computed decimal string, pass-through. */
  price: string;
  /** Price as JS number (display only — ordering/formatting). */
  priceNum: number;
  /** Order size in satoshis (precision 3). */
  steemSatoshis: number;
  sbdSatoshis: number;
  /** Display strings, integer-computed (never floats). */
  steemAmount: string;
  sbdAmount: string;
  created: string;
}

export interface OrderBookSnapshot {
  asks: MarketLevel[]; // cheapest first
  bids: MarketLevel[]; // highest first
  fetchedAt: string;
}

export interface MarketTicker {
  latest: string;
  highestBid: string;
  lowestAsk: string;
  /** Percent change as a fraction, e.g. -0.0284 = -2.84%. */
  percentChange: number;
  steemVolumeSatoshis: number;
  sbdVolumeSatoshis: number;
  steemVolume: string;
  sbdVolume: string;
}

export interface TradeFill {
  date: string;
  /** SBD per STEEM (display). */
  price: number;
  steemSatoshis: number;
  sbdSatoshis: number;
  steemAmount: string;
  sbdAmount: string;
  /** "buy" = STEEM was bought with SBD; "sell" = STEEM sold for SBD. */
  side: "buy" | "sell";
}

export interface ChainStatus {
  headBlock: number;
  headBlockId: string;
  /** ISO head time (node clock). */
  time: string;
  /** Seconds between node head time and local clock. */
  lagSeconds: number;
  totalVestingFundSatoshis: number; // STEEM satoshis
  totalVestingSharesSatoshis: number; // VESTS satoshis (precision 6)
}

export interface OpenOrder {
  orderid: number;
  created: string;
  expiration: string;
  seller: string;
  /** Satoshis of the currently-for-sale asset. */
  forSaleSatoshis: number;
  sellingSymbol: string;
  sellingAmount: string;
  receivingSymbol: string;
  receivingAmount: string;
  /** Price in SBD per STEEM (display number). */
  price: number;
}

interface RawBookEntry {
  created?: string;
  order_price?: { base?: string; quote?: string };
  real_price?: string;
  sbd?: number;
  steem?: number;
}

/** Integer-safe satoshi → "1.234" (precision 3) / "1.234567" (precision 6). */
export function satoshisToAmountString(sat: number, precision: 3 | 6): string {
  const sign = sat < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(sat));
  const scale = precision === 3 ? 1000 : 1_000_000;
  const int = Math.floor(abs / scale);
  const frac = String(abs % scale).padStart(precision, "0");
  return `${sign}${int}.${frac}`;
}

export class SteemMarketClient {
  constructor(
    private readonly rpcUrl: string,
    private readonly timeoutMs = 12_000,
  ) {}

  private async rpc<T>(method: string, params: unknown): Promise<T> {
    const res = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`RPC HTTP ${res.status} ${res.statusText}`);
    const body = (await res.json()) as { result?: T; error?: { message?: string } };
    if (body.error) throw new Error(`RPC error: ${body.error.message ?? "unknown"}`);
    return body.result as T;
  }

  private static mapLevel(e: RawBookEntry): MarketLevel | null {
    const priceStr = e.real_price;
    const steemSat = e.steem;
    const sbdSat = e.sbd;
    if (typeof priceStr !== "string" || !Number.isFinite(steemSat) || !Number.isFinite(sbdSat)) return null;
    const priceNum = Number(priceStr);
    if (!Number.isFinite(priceNum) || priceNum <= 0) return null;
    return {
      price: priceStr,
      priceNum,
      steemSatoshis: steemSat,
      sbdSatoshis: sbdSat,
      steemAmount: satoshisToAmountString(steemSat, 3),
      sbdAmount: satoshisToAmountString(sbdSat, 3),
      created: e.created ?? "",
    };
  }

  /** STEEM/SBD order book. `limit` is clamped to the node-observed 1..500. */
  async orderBook(limit = 25): Promise<OrderBookSnapshot> {
    const n = Math.min(500, Math.max(1, Math.floor(limit)));
    const raw = await this.rpc<{ bids?: RawBookEntry[]; asks?: RawBookEntry[] }>(
      "condenser_api.get_order_book",
      [n],
    );
    const asks: MarketLevel[] = [];
    const bids: MarketLevel[] = [];
    for (const e of raw.asks ?? []) {
      const lvl = SteemMarketClient.mapLevel(e);
      if (lvl) asks.push(lvl);
    }
    for (const e of raw.bids ?? []) {
      const lvl = SteemMarketClient.mapLevel(e);
      if (lvl) bids.push(lvl);
    }
    asks.sort((a, b) => a.priceNum - b.priceNum); // cheapest ask first
    bids.sort((a, b) => b.priceNum - a.priceNum); // richest bid first
    return { asks, bids, fetchedAt: new Date().toISOString() };
  }

  async ticker(): Promise<MarketTicker> {
    const raw = await this.rpc<{
      latest?: string;
      highest_bid?: string;
      lowest_ask?: string;
      percent_change?: string;
      steem_volume?: string;
      sbd_volume?: string;
    }>("condenser_api.get_ticker", []);
    const steemVol = parseAsset(raw.steem_volume ?? "0.000 STEEM");
    const sbdVol = parseAsset(raw.sbd_volume ?? "0.000 SBD");
    const pct = Number(raw.percent_change ?? "0");
    return {
      latest: raw.latest ?? "0",
      highestBid: raw.highest_bid ?? "0",
      lowestAsk: raw.lowest_ask ?? "0",
      percentChange: Number.isFinite(pct) ? pct : 0,
      steemVolumeSatoshis: Number(steemVol.amount),
      sbdVolumeSatoshis: Number(sbdVol.amount),
      steemVolume: satoshisToAmountString(Number(steemVol.amount), 3),
      sbdVolume: satoshisToAmountString(Number(sbdVol.amount), 3),
    };
  }

  /**
   * Recent fills. Fetches the window [now−windowHours, now+2min] and returns
   * NEWEST-first. Caveat: if the window contains more than `limit` fills the
   * node returns the oldest `limit` — irrelevant for the thin internal market
   * at current volume, re-checked by callers via presence of data.
   */
  async tradeHistory(limit = 50, windowHours = 48): Promise<TradeFill[]> {
    const n = Math.min(1000, Math.max(1, Math.floor(limit)));
    const fmt = (d: Date) => d.toISOString().slice(0, 19);
    const now = Date.now();
    const start = fmt(new Date(now - windowHours * 3_600_000));
    const stop = fmt(new Date(now + 120_000));
    const raw = await this.rpc<Array<{ current_pays?: string; open_pays?: string; date?: string }>>(
      "condenser_api.get_trade_history",
      [start, stop, n],
    );
    const fills: TradeFill[] = [];
    for (const t of raw ?? []) {
      if (typeof t.current_pays !== "string" || typeof t.open_pays !== "string") continue;
      const paid = parseAsset(t.current_pays);
      const received = parseAsset(t.open_pays);
      const side = paid.symbol === "SBD" ? "buy" : "sell";
      const steemSat = Number((side === "buy" ? received : paid).amount);
      const sbdSat = Number((side === "buy" ? paid : received).amount);
      if (steemSat <= 0) continue;
      fills.push({
        date: t.date ?? "",
        price: sbdSat / steemSat,
        steemSatoshis: steemSat,
        sbdSatoshis: sbdSat,
        steemAmount: satoshisToAmountString(steemSat, 3),
        sbdAmount: satoshisToAmountString(sbdSat, 3),
        side,
      });
    }
    return fills.reverse(); // newest first
  }

  async chainStatus(): Promise<ChainStatus> {
    const d = await this.rpc<{
      head_block_number?: number;
      head_block_id?: string;
      time?: string;
      total_vesting_fund_steem?: string;
      total_vesting_shares?: string;
    }>("condenser_api.get_dynamic_global_properties", []);
    const headMs = d.time ? Date.parse(d.time.endsWith("Z") ? d.time : `${d.time}Z`) : NaN;
    const vestingFund = parseAsset(d.total_vesting_fund_steem ?? "0.000 STEEM");
    const vestingShares = parseAsset(d.total_vesting_shares ?? "0.000000 VESTS");
    return {
      headBlock: d.head_block_number ?? 0,
      headBlockId: d.head_block_id ?? "",
      time: d.time ?? "",
      lagSeconds: Number.isFinite(headMs) ? Math.round((Date.now() - headMs) / 1000) : 0,
      totalVestingFundSatoshis: Number(vestingFund.amount),
      totalVestingSharesSatoshis: Number(vestingShares.amount),
    };
  }

  /** Open (unfilled) limit orders of one account, newest-created first. */
  async openOrders(account: string): Promise<OpenOrder[]> {
    validateAccountName(account);
    const raw = await this.rpc<
      Array<{
        orderid?: number;
        created?: string;
        expiration?: string;
        seller?: string;
        for_sale?: number;
        sell_price?: { base?: string; quote?: string };
      }>
    >("condenser_api.get_open_orders", [account]);
    const orders: OpenOrder[] = [];
    for (const o of raw ?? []) {
      if (!o.sell_price?.base || !o.sell_price?.quote) continue;
      const base = parseAsset(o.sell_price.base);
      const quote = parseAsset(o.sell_price.quote);
      const sellingIsSteem = base.symbol === "STEEM";
      const steemSat = Number((sellingIsSteem ? base : quote).amount);
      const sbdSat = Number((sellingIsSteem ? quote : base).amount);
      if (steemSat <= 0) continue;
      orders.push({
        orderid: o.orderid ?? 0,
        created: o.created ?? "",
        expiration: o.expiration ?? "",
        seller: o.seller ?? account,
        forSaleSatoshis: Number(o.for_sale ?? (sellingIsSteem ? base.amount : quote.amount)),
        sellingSymbol: base.symbol,
        sellingAmount: satoshisToAmountString(Number(base.amount), 3),
        receivingSymbol: quote.symbol,
        receivingAmount: satoshisToAmountString(Number(quote.amount), 3),
        price: sbdSat / steemSat,
      });
    }
    orders.sort((a, b) => b.orderid - a.orderid);
    return orders;
  }
}
