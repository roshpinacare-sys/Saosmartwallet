export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/developer/usage — honest usage analytics over the metering ledger.
 * Series = last 24 UTC hours, hourly buckets of executed product calls.
 * Zero calls ⇒ zeros (measured emptiness, never invented data).
 * roast r6: admin-gated — this was anonymously readable (usage patterns are
 * operational intelligence; the console is admin-only, so is this).
 */
export async function GET(req: Request) {
  const adminGate = await requireAdmin(req);
  if (adminGate) return adminGate;
  const since = new Date(Date.now() - 24 * 3600 * 1000);

  const [keys, totalCalls, todayRecords, sinceRecords] = await Promise.all([
    db.apiKey.count(),
    db.usageRecord.count(),
    db.usageRecord.count({ where: { createdAt: { gte: new Date(new Date().setUTCHours(0, 0, 0, 0)) } } }),
    db.usageRecord.findMany({ where: { createdAt: { gte: since } }, select: { outcome: true, latencyMs: true, createdAt: true } }),
  ]);

  const proven = sinceRecords.filter((r) => r.outcome === "PROVEN").length;
  const failed = sinceRecords.filter((r) => r.outcome === "FAILED").length;
  const errored = sinceRecords.filter((r) => r.outcome === "ERROR").length;
  const avgLatencyMs =
    sinceRecords.length > 0 ? Math.round(sinceRecords.reduce((s, r) => s + r.latencyMs, 0) / sinceRecords.length) : 0;

  // 24 hourly buckets, oldest → newest, labeled by UTC hour.
  // Bucket key MUST include day+hour — Date.UTC(y,m,h) would collide across days.
  const buckets = new Map<number, number>();
  const nowHour = new Date();
  for (let i = 23; i >= 0; i--) {
    const h = new Date(nowHour.getTime() - i * 3600 * 1000);
    buckets.set(Date.UTC(h.getUTCFullYear(), h.getUTCMonth(), h.getUTCDate(), h.getUTCHours()), 0);
  }
  for (const r of sinceRecords) {
    const key = Date.UTC(
      r.createdAt.getUTCFullYear(),
      r.createdAt.getUTCMonth(),
      r.createdAt.getUTCDate(),
      r.createdAt.getUTCHours(),
    );
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const series = Array.from(buckets.entries()).map(([utcHour, calls]) => ({
    utcHour: new Date(utcHour).toISOString(),
    calls,
  }));

  return NextResponse.json(
    {
      ok: true,
      totals: { apiKeys: keys, callsAllTime: totalCalls, callsToday: todayRecords },
      last24h: { total: sinceRecords.length, proven, failed, errored, avgLatencyMs },
      series,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
