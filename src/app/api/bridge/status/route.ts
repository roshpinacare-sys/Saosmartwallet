export const runtime = "nodejs";

/**
 * GET /api/bridge/status — live rail statuses + analytics (M3)
 * ============================================================
 * Feeds the pure bridge monitor with the live SAOS-NET anchor state
 * (eco-server) — every number is chain/repo-sourced, nulls where
 * unmeasurable, never invented.
 */

import { NextResponse } from "next/server";

import { ecoAnchors, ecoNetworks, saosNetSnapshot } from "@/lib/eco-server";
import { bridgeAnalytics, railStatuses } from "../../../../../packages/bridges/monitor";

export const dynamic = "force-dynamic";

export async function GET() {
  const [anchors, saosnet, networks] = await Promise.all([ecoAnchors(), saosNetSnapshot(), ecoNetworks()]);
  const input = {
    anchors,
    saosnet,
    chains: networks.chains.map((c) => ({ id: c.id, status: c.status, note: c.note })),
  };
  const statuses = railStatuses(input);
  const analytics = bridgeAnalytics(input);
  return NextResponse.json(
    { ok: true, statuses, analytics, fetchedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
