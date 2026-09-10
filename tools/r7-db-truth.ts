/**
 * ROAST round 7 — DB truth (READ-ONLY).
 * The question r6 deferred to "tomorrow" (i.e. TODAY): does the whole r5/r6
 * doctrine actually hold in live scheduled fires?
 *  - editor v4 single-lane loop fired at its own window (hourUtc=13) today?
 *  - scout periodic contract (2 live numbers) fired without coin-tossing?
 *  - morning daily at 06:00?
 *  - 0 stuck, proposals consistent, messages trail sane.
 */
import { db } from "../src/lib/db";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "never");

async function main() {
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  console.log(`R7 DB TRUTH @ ${now.toISOString()} (dayKey=${todayKey})`);

  // ── 1. schedules: did TODAY's windows fire, in their own hour? ────────────
  const schedules = await db.gateSchedule.findMany({ orderBy: { createdAt: "asc" } });
  console.log(`\n── [1] schedules (${schedules.length}):`);
  for (const s of schedules) {
    if (!s.enabled) continue;
    const firedToday = s.dayKey === todayKey ? s.dayCount : 0;
    const inOwnWindow =
      s.kind === "daily" && s.hourUtc != null
        ? iso(s.lastRunAt).slice(0, 13) === iso(now).slice(0, 13) ||
          (s.lastRunAt ? s.lastRunAt.getUTCHours() === s.hourUtc : false)
        : null;
    console.log(
      `  ${s.kind} h=${s.hourUtc ?? "-"} agent=${s.agentName} day=${s.dayKey === todayKey ? s.dayCount : 0}/${s.maxPerDay} ` +
        `last=${iso(s.lastRunAt)} next=${iso(s.nextRunAt)} ownWindow=${inOwnWindow} :: ${String(s.label || "").slice(0, 30)}`,
    );
  }

  // ── 2. runs since r6 push (13:18Z): the fresh-code era ────────────────────
  const cutoff = Date.parse("2026-09-10T07:00:00Z"); // whole day, pre-r6-code runs included
  const runs = await db.gateRun.findMany({
    where: { createdAt: { gte: new Date(cutoff) } },
    orderBy: { createdAt: "asc" },
  });
  const byStatus = new Map<string, number>();
  for (const r of runs) byStatus.set(r.status, (byStatus.get(r.status) || 0) + 1);
  console.log(`\n── [2] runs since 07:00Z: ${runs.length} → ${[...byStatus.entries()].map(([k, v]) => `${k}=${v}`).join(" · ")}`);
  for (const r of runs) {
    const rep = String(r.report || "").replace(/\n/g, " | ").slice(0, 110);
    const steps = Array.isArray((r as unknown as { steps?: unknown[] }).steps) ? (r as unknown as { steps: unknown[] }).steps.length : "-";
    console.log(`  [${iso(r.createdAt).slice(11, 19)}] ${r.status} ${r.agentName} steps=${steps} :: ${r.goal.slice(0, 60).replace(/\n/g, " ")}`);
    if (r.status === "blocked" || r.status === "done") console.log(`      ↳ report: ${rep}`);
  }

  // ── 3. stuck detection ────────────────────────────────────────────────────
  const stuck = await db.gateRun.findMany({ where: { status: { in: ["running", "leased"] } } });
  const stale = stuck.filter((r) => r.heartbeatAt && now.getTime() - r.heartbeatAt.getTime() > 10 * 60 * 1000);
  console.log(`\n── [3] active=${stuck.length} stale(>10min)=${stale.length}`);
  for (const r of stale) console.log(`  ⚠ STUCK ${r.id} ${r.status} hb=${iso(r.heartbeatAt)} :: ${r.goal.slice(0, 60)}`);

  // ── 4. proposals: any open contradictions? ────────────────────────────────
  const props = await db.gateProposal.findMany({ orderBy: { createdAt: "desc" }, take: 10 });
  const open = props.filter((p) => p.status === "open");
  console.log(`\n── [4] proposals: ${props.length} recent, open=${open.length}`);
  for (const p of open) console.log(`  OPEN ${p.agentName} :: ${p.goal.slice(0, 60)}`);

  // ── 5. messages trail (last 8) ────────────────────────────────────────────
  const msgs = await db.gateMessage.findMany({ orderBy: { createdAt: "desc" }, take: 8 });
  console.log(`\n── [5] messages:`);
  for (const m of msgs) console.log(`  [${iso(m.createdAt).slice(11, 19)}] ${m.fromKind}/${m.fromName} :: ${m.body.slice(0, 110).replace(/\n/g, " | ")}`);

  // ── 6. events consumed? SSE leak? ─────────────────────────────────────────
  const ev = await db.gateEvent.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  const unconsumed = ev.filter((e) => !e.consumed);
  console.log(`\n── [6] events: recent=${ev.length} unconsumed=${unconsumed.length}`);

  await db.$disconnect();
  console.log("\nR7 DB truth done.");
}

main().catch((e) => {
  console.error(String(e).slice(0, 500));
  process.exit(1);
});
