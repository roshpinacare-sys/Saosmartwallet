export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { ecoAnchors } from "@/lib/eco-server";

export const dynamic = "force-dynamic";

/**
 * GET /api/eco/anchors — recent cross-chain anchors with real txids
 * (SAOS-NET checkpoints → Steem/Hive/TRON) + soldier attestations.
 */
export async function GET() {
  const payload = await ecoAnchors();
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
