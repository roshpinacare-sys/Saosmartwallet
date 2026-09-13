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
    rpcUrls: RPC_URLS, // roast r3: the read path is no longer a single point of failure either
    // allowBroadcast intentionally NOT set — fails closed (M0 gate).
    requestTimeoutMs: 8_000, // r45: reads race endpoints concurrently — 8s ceiling, not 3x15s
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
      rpcUrls: RPC_URLS, // roast r3: broadcast no longer dies with one node — transport failover only (chain verdicts still propagate)
      allowBroadcast: true, // explicit opt-in — used ONLY after an operator decision
      requestTimeoutMs: 15_000,
    });
  }
  return broadcastSingleton;
}

/**
 * The live DEX orders of an account — database_api.list_limit_orders
 * (order "by_account", filtered to the exact seller; the listing continues
 * past the account alphabetically, so the filter is required). Verified live
 * 2026-09-09: api.steemit.com does NOT expose this method — the failover list
 * (api.justyy.com does) is what makes this read real.
 */
export async function steemOpenOrders(account: string): Promise<
  Array<{ orderid: number; type: "ask" | "bid"; price: number; amount: string; forSale: string; expiration: string }>
> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "database_api.list_limit_orders",
    params: { start: [account, 0], limit: 100, order: "by_account" },
  });
  const NAI: Record<string, string> = { "@@000000013": "STEEM", "@@000000021": "SBD" };
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
        result?: {
          orders?: Array<{
            seller?: string;
            orderid?: number;
            for_sale?: string | number;
            expiration?: string;
            sell_price?: { base?: { amount?: string; nai?: string }; quote?: { amount?: string; nai?: string } };
          }>;
        };
        error?: { message?: string };
      };
      if (j.error) throw new Error(j.error.message || "rpc error");
      const rows = Array.isArray(j.result?.orders) ? j.result!.orders! : [];
      return rows
        .filter((o) => String(o.seller || "").toLowerCase() === account.toLowerCase())
        .slice(0, 25)
        .map((o) => {
          const baseSym = NAI[String(o.sell_price?.base?.nai || "")] || "?";
          const baseAmt = Number(o.sell_price?.base?.amount || 0);
          const quoteAmt = Number(o.sell_price?.quote?.amount || 0);
          const type: "ask" | "bid" = baseSym === "STEEM" ? "ask" : "bid";
          const price = baseAmt > 0 && quoteAmt > 0 ? Math.round((baseAmt / quoteAmt) * 1e6) / 1e6 : 0;
          return {
            orderid: Number(o.orderid),
            type,
            price,
            amount: `${baseAmt.toFixed(3)} ${baseSym}`,
            forSale: `${(Number(o.for_sale) / 1000).toFixed(3)}`,
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
  if (!marketSingleton) marketSingleton = new SteemMarketClient(RPC_URLS, 8_000, 2_500); // r45: raced reads, 8s ceiling
  return marketSingleton;
}

export const STEEM_ENDPOINT = RPC_URL;
