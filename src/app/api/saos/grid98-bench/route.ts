import { NextResponse } from "next/server";

import { grid98Bench } from "@/lib/grid98-bench";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET/POST /api/saos/grid98-bench — Demo 2: LIVE Grid98 benchmark.
 * Spawns the REAL production engine (grid98.cjs --bench) which replays
 * real archive transactions through kernel.applyTx and reports its own
 * measured throughput + honesty-gate counters. Nothing is simulated.
 *
 * Optional body/query: { benchMs?: number } (5s..60s, default 20s).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = Number(url.searchParams.get("benchMs"));
  const payload = await grid98Bench(Number.isFinite(q) && q > 0 ? q : undefined);
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  let benchMs: number | undefined;
  try {
    const body = (await req.json()) as { benchMs?: number };
    benchMs = typeof body?.benchMs === "number" ? body.benchMs : undefined;
  } catch {
    // default bench duration applies
  }
  const payload = await grid98Bench(benchMs);
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
