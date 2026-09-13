export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { saosNetSnapshot } from "@/lib/eco-server";

export const dynamic = "force-dynamic";

/**
 * GET /api/eco/saosnet — SAOS-NET sovereign chain snapshot: engine vitals,
 * sovereign book, grid98 pools, signed oracle quotes, wrapped assets,
 * TRON bridge pulse. All fields come from the daemon-pushed chain state.
 */
export async function GET() {
  const payload = await saosNetSnapshot();
  // r45 contract: the payload itself carries ok:false + the reason — never an
  // exposed 5xx (r32 contract: degraded state is DATA, not a server failure).
  const status = 200;
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
