/**
 * Saosmartwallet — server-side Steem singletons (M1)
 * ==================================================
 * Wires the M0 packages into Next.js API routes. Read-only by construction:
 * the adapter here is created WITHOUT allowBroadcast — an M1 terminal can
 * build and preview transactions, but no route can broadcast anything.
 */

import { SteemAdapter } from "../../packages/chains/steem/src/adapter";
import { SteemMarketClient } from "../../packages/chains/steem/src/market";

/** Write-path (adapter) endpoint — single, consistent ref-block source. */
const RPC_URL = process.env.STEEM_RPC_URL ?? "https://api.steemit.com";

/**
 * Read-path (market data) endpoints — ordered failover list, primary first.
 * Candidates verified live 2026-09-08 (condenser_api.get_dynamic_global_properties):
 * api.steemit.com ✓ · api.justyy.com ✓ (200/0.75s) · api.steemitdev.com ✓ (200/0.9s).
 * (api.steem.fan was suggested in earlier notes but measured DEAD — never hardcode
 * unverified endpoints.)
 */
const RPC_URLS: string[] = (
  process.env.STEEM_RPC_URLS ?? `${RPC_URL},https://api.justyy.com,https://api.steemitdev.com`
)
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);

function buildAdapter(): SteemAdapter {
  return new SteemAdapter({
    rpcUrl: RPC_URL,
    // allowBroadcast intentionally NOT set — fails closed (M0 gate).
    requestTimeoutMs: 15_000,
  });
}

let adapterSingleton: SteemAdapter | null = null;
let marketSingleton: SteemMarketClient | null = null;
let broadcastSingleton: SteemAdapter | null = null;

export function steemAdapter(): SteemAdapter {
  if (!adapterSingleton) adapterSingleton = buildAdapter();
  return adapterSingleton;
}

/**
 * SOVEREIGN-HAND write path — a SEPARATE adapter with broadcast explicitly
 * enabled (the M0 gate is an explicit constructor opt-in, never implicit).
 * Only the operator-approved signing pipeline (gate/harness/orders.ts) ever
 * touches this; every read path in the app keeps the broadcast-free adapter.
 */
export function steemBroadcastAdapter(): SteemAdapter {
  if (!broadcastSingleton) {
    broadcastSingleton = new SteemAdapter({
      rpcUrl: RPC_URL,
      allowBroadcast: true, // explicit opt-in — used ONLY after an operator decision
      requestTimeoutMs: 15_000,
    });
  }
  return broadcastSingleton;
}

/**
 * condenser_api.get_open_orders — the live DEX orders of an account.
 * Read-path with the same verified failover list as the market client.
 */
export async function steemOpenOrders(account: string): Promise<
  Array<{ orderid: number; type: "ask" | "bid"; price: number; amount: string; expiration: string }>
> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "condenser_api.get_open_orders", params: [[account]] });
  let lastErr: unknown = null;
  for (const url of RPC_URLS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as {
        result?: Array<{ orderid: number; sell_price?: { base?: string; quote?: string }; for_sale?: number; expiration?: string }>;
      };
      const rows = Array.isArray(j.result) ? j.result : [];
      return rows.slice(0, 25).map((o) => {
        const base = o.sell_price?.base || "";
        const quote = o.sell_price?.quote || "";
        // ask = selling STEEM for SBD (base "X STEEM"); bid = buying STEEM (base "X SBD")
        const type: "ask" | "bid" = base.includes("STEEM") ? "ask" : "bid";
        const p = base.match(/([\d.]+)\s+\w+/);
        const q = quote.match(/([\d.]+)\s+\w+/);
        const price = p && q && Number(q[1]) > 0 ? Number(p[1]) / Number(q[1]) : 0;
        return {
          orderid: Number(o.orderid),
          type,
          price: Math.round(price * 1e6) / 1e6,
          amount: base,
          expiration: o.expiration || "",
        };
      });
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`open-orders probe failed on all endpoints: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

export function steemMarket(): SteemMarketClient {
  if (!marketSingleton) marketSingleton = new SteemMarketClient(RPC_URLS, 15_000, 2_500);
  return marketSingleton;
}

export const STEEM_ENDPOINT = RPC_URL;
