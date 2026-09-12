export const runtime = "nodejs";

/**
 * GET /api/steem/market — header ticker + chain status feed (live RPC).
 * No mock data: everything comes from api.steemit.com through the M1 client.
 */

import { NextResponse } from "next/server";

import { STEEM_ENDPOINT, steemMarket } from "@/lib/steem-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const market = steemMarket();
  try {
    const [ticker, chainStatus] = await Promise.all([market.ticker(), market.chainStatus()]);
    return NextResponse.json(
      { ok: true, endpoint: STEEM_ENDPOINT, ticker, chainStatus },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "market feed unavailable" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
