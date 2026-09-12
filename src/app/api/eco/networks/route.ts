export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { ecoNetworks } from "@/lib/eco-server";

export const dynamic = "force-dynamic";

/**
 * GET /api/eco/networks — live health probe for every ecosystem chain.
 * A dead chain is data (status: offline), never a 500.
 */
export async function GET() {
  const payload = await ecoNetworks();
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
