/** ROAST round 6 — DB truth (READ-ONLY): schedules, arsenal, stuck runs, editor queue markers. */
import { db } from "../src/lib/db";

async function main() {
  const now = Date.now();

  // ── agents & arsenal ──────────────────────────────────────────────────────
  const agents = await db.gateAgent.findMany({ orderBy: { name: "asc" } });
  let arsenalOk = 0;
  let arsenalBad: string[] = [];
  for (const a of agents) {
    let mods: string[] = [];
    try {
      mods = JSON.parse(String(a.modules || "[]")) as string[];
    } catch {
      /* unparseable */
    }
    if (a.active && mods.length >= 30) arsenalOk++;
    else if (a.active) arsenalBad.push(`${a.name}:${mods.length}`);
  }
  console.log(`agents: ${agents.length} · armed-with-30: ${arsenalOk} · under-armed: ${arsenalBad.join(",") || "none"}`);

  // ── schedules: markers, hours, quotas, last-fire ─────────────────────────
  const schedules = await db.gateSchedule.findMany({ orderBy: [{ enabled: "desc" }, { hourUtc: "asc" }] });
  console.log(`\nschedules: ${schedules.length} (enabled: ${schedules.filter((s) => s.enabled).length})`);
  for (const s of schedules) {
    const goal = String(s.goal || "");
    const markers = [
      /מסלול-יחיד|single-lane/i.test(goal) ? "single-lane" : null,
      /ארגומנטים ריקים|empty-args/i.test(goal) ? "empty-args" : null,
      /ניתוב-שפה/i.test(goal) ? "lang-routing" : null,
    ].filter(Boolean);
    const lastFire = s.lastRunAt ? s.lastRunAt.toISOString().slice(5, 16) : "never";
    console.log(
      `  ${s.enabled ? "▶" : "·"} ${s.agentName}/${s.kind} h=${s.hourUtc ?? "-"} cap=${s.maxPerDay} day=${String(s.dayKey || "-").slice(5)}x${s.dayCount} last=${lastFire} ${markers.join("+")} :: ${goal.slice(0, 70).replace(/\n/g, " ")}`,
    );
  }

  // ── runs: status counts + stuck detection ────────────────────────────────
  const runs = await db.gateRun.findMany({ orderBy: { createdAt: "desc" }, take: 400 });
  const byStatus = new Map<string, number>();
  for (const r of runs) byStatus.set(r.status, (byStatus.get(r.status) || 0) + 1);
  console.log(`\nruns (last ${runs.length}): ${[...byStatus.entries()].map(([k, v]) => `${k}=${v}`).join(" · ")}`);
  const stuck = runs.filter(
    (r) => (r.status === "running" || r.status === "leased") && r.heartbeatAt && now - r.heartbeatAt.getTime() > 10 * 60 * 1000,
  );
  console.log(`stuck (running/leased, heartbeat >10min old): ${stuck.length}`);
  for (const r of stuck.slice(0, 5)) {
    console.log(`  ⚠ ${r.id} ${r.status} hb=${r.heartbeatAt?.toISOString()} agent=${r.agentName} :: ${r.goal.slice(0, 60)}`);
  }

  // ── messages: latest 6 (context) ─────────────────────────────────────────
  const msgs = await db.gateMessage.findMany({ orderBy: { createdAt: "desc" }, take: 6 });
  console.log(`\nlatest messages:`);
  for (const m of msgs) {
    console.log(`  [${m.createdAt.toISOString().slice(11, 16)}] ${m.fromKind}/${m.fromName} :: ${m.body.slice(0, 100).replace(/\n/g, " | ")}`);
  }

  // ── editor queue: the v4 single-lane marker in DB rows ───────────────────
  const editor = schedules.find((s) => s.agentName?.includes("editor") || /editor/i.test(String(s.label || "")) || /מסלול-יחיד/i.test(String(s.goal || "")));
  console.log(`\neditor queue present: ${Boolean(editor)} · modules: ${editor?.modules ?? "-"}`);

  await db.$disconnect();
  console.log("\nR6 DB truth done.");
}

main().catch((e) => {
  console.error(String(e).slice(0, 400));
  process.exit(1);
});
