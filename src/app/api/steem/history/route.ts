/**
 * GET /api/steem/history?limit=50 — recent STEEM/SBD fills (newest first).
 */

import { NextResponse } from "next/server";

import { steemMarket } from "@/lib/steem-server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.floor(limitParam)) : 50;
  try {
    // get_trade_history only iterates ascending (verified live 2026-09-08), so
    // with >limit fills in the window it returns the OLDEST — fetch the full
    // upstream window (node max 1,000) and serve the newest tail ourselves.
    const UPSTREAM_MAX = 1000;
    const fills = await steemMarket().tradeHistory(Math.min(UPSTREAM_MAX, Math.max(limit, 400)), 48);
    return NextResponse.json(
      { ok: true, fills: fills.slice(0, Math.min(limit, UPSTREAM_MAX)) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "trade history unavailable" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
