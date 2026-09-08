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

export function steemAdapter(): SteemAdapter {
  if (!adapterSingleton) adapterSingleton = buildAdapter();
  return adapterSingleton;
}

export function steemMarket(): SteemMarketClient {
  if (!marketSingleton) marketSingleton = new SteemMarketClient(RPC_URLS, 15_000, 2_500);
  return marketSingleton;
}

export const STEEM_ENDPOINT = RPC_URL;
