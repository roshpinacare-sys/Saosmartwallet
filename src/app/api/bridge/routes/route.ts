/**
 * GET /api/bridge/routes — cross-network path finding (M3)
 * ========================================================
 * ?from=steem&to=ethereum&asset=STEEM&amount=100
 *
 * Returns BridgePath[] with REAL fee quotes (live ETH gas via adapter,
 * Solana protocol constants) and honest readiness gates. No route found =
 * empty array, never a fabricated path.
 */

import { NextResponse } from "next/server";

import { findPaths } from "../../../../../packages/bridges/router";
import type { BridgeNetworkId } from "../../../../../packages/bridges/types";

export const dynamic = "force-dynamic";

const NETWORKS = new Set<BridgeNetworkId>([
  "steem",
  "hive",
  "blurt",
  "tron",
  "saos-net",
  "ethereum",
  "solana",
]);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const asset = url.searchParams.get("asset") ?? "";
  const amount = url.searchParams.get("amount") ?? "";

  if (!NETWORKS.has(from as BridgeNetworkId) || !NETWORKS.has(to as BridgeNetworkId)) {
    return NextResponse.json(
      { ok: false, error: "from/to must be known network ids (steem, hive, blurt, tron, saos-net, ethereum, solana)" },
      { status: 400 },
    );
  }

  try {
    const paths = await findPaths({
      source: from as BridgeNetworkId,
      target: to as BridgeNetworkId,
      asset,
      amount,
    });
    return NextResponse.json(
      { ok: true, from, to, asset, amount, paths, quotedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "path finding failed" },
      { status: 500 },
    );
  }
}
