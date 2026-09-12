export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { saosHubCached } from "@/lib/saos-hub";

export const dynamic = "force-dynamic";

/**
 * GET /api/eco/saos-hub — the SAOS sovereign stack in one honest snapshot:
 * chain core · grid98 engine + floor ladder + profitability gates · soldier
 * roster with live Steem measurements (SP/VP/RC) · loop census with sizes as
 * evidence · pools · signed oracle quotes · wrapped economy · bridges +
 * live checkpoint anchors · honest dex-facts with public refs.
 */
export async function GET() {
  const payload = await saosHubCached();
  const status = payload.ok ? 200 : 503;
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
