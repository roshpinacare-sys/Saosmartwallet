import { NextResponse } from "next/server";

import { fleetStatusCached } from "@/lib/fleet-status";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/saos/fleet-status — Demo 3: the 13-soldier Steem army, live.
 * SP/VP/RC measured with steemd formulas + each soldier's newest on-chain
 * operation from account_history. 8s micro-cache, no mock, honest nulls.
 */
export async function GET() {
  const payload = await fleetStatusCached();
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
