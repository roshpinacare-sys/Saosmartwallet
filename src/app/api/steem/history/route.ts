/**
 * GET /api/steem/history?limit=50 — recent STEEM/SBD fills (newest first).
 */

import { NextResponse } from "next/server";

import { steemMarket } from "@/lib/steem-server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitParam) ? limitParam : 50;
  try {
    const fills = await steemMarket().tradeHistory(limit, 48);
    return NextResponse.json({ ok: true, fills }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "trade history unavailable" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
