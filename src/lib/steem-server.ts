/**
 * Saosmartwallet — server-side Steem singletons (M1)
 * ==================================================
 * Wires the M0 packages into Next.js API routes. Read-only by construction:
 * the adapter here is created WITHOUT allowBroadcast — an M1 terminal can
 * build and preview transactions, but no route can broadcast anything.
 */

import { SteemAdapter } from "../../packages/chains/steem/src/adapter";
import { SteemMarketClient } from "../../packages/chains/steem/src/market";

const RPC_URL = process.env.STEEM_RPC_URL ?? "https://api.steemit.com";

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
  if (!marketSingleton) marketSingleton = new SteemMarketClient(RPC_URL, 15_000);
  return marketSingleton;
}

export const STEEM_ENDPOINT = RPC_URL;
