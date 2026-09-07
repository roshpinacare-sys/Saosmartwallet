/**
 * GET /api/steem/orderbook?limit=25 — live STEEM/SBD order book.
 */

import { NextResponse } from "next/server";

import { steemMarket } from "@/lib/steem-server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get("limit") ?? "25");
  const limit = Number.isFinite(limitParam) ? limitParam : 25;
  try {
    const book = await steemMarket().orderBook(limit);
    return NextResponse.json({ ok: true, ...book }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "order book unavailable" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
