export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { saosHubCached } from "@/lib/saos-hub";

export const dynamic = "force-dynamic";

/**
 * GET /api/saos/hub — canonical alias for the SAOS sovereign-stack snapshot
 * (same payload as /api/eco/saos-hub): chain core · grid98 engine + honesty
 * gates · soldier roster with live Steem measurements · loop census · pools ·
 * signed oracle · wrapped economy · bridges + live anchors · honest dex-facts.
 */
export async function GET() {
  const payload = await saosHubCached();
  // r45 contract: the payload itself carries ok:false + the reason — never an
  // exposed 5xx (r32 contract: degraded state is DATA, not a server failure).
  const status = 200;
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
