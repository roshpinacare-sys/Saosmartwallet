import { NextResponse } from "next/server";

import { grid98Bench } from "@/lib/grid98-bench";
import { clientIpOf, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET/POST /api/saos/grid98-bench — Demo 2: LIVE Grid98 benchmark.
 * Spawns the REAL production engine (grid98.cjs --bench) which replays
 * real archive transactions through kernel.applyTx and reports its own
 * measured throughput + honesty-gate counters. Nothing is simulated.
 *
 * Optional body/query: { benchMs?: number } (5s..60s, default 20s).
 *
 * SECURITY: this route spawns a CPU-heavy engine run for up to 60s —
 * per-IP rate limit (3/min) so a bursty client cannot turn a public
 * endpoint into a compute-exhaustion vector. GET and POST share one
 * budget per IP.
 */
function benchGate(req: Request): NextResponse | null {
  const rl = rateLimit(`grid98-bench:${clientIpOf(req)}`, 3, 60_000);
  if (rl.ok) return null;
  return NextResponse.json(
    {
      ok: false,
      error: `bench is expensive — max 3 runs/min, retry in ${rl.retryAfterSeconds}s`,
      code: "RATE_LIMITED",
    },
    { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(rl.retryAfterSeconds) } },
  );
}

export async function GET(req: Request) {
  const denied = benchGate(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const q = Number(url.searchParams.get("benchMs"));
  const payload = await grid98Bench(Number.isFinite(q) && q > 0 ? q : undefined);
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const denied = benchGate(req);
  if (denied) return denied;
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
