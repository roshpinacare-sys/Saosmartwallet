/**
 * ROAST round 7 — the editor's first-ever on-window-style live validation.
 * The v4 single-lane editor loop has never actually run: r2 blocked it,
 * r4 designed v4, r5/r6 windows were burned by boot catch-up (and r7 proved
 * the early-fire hole that let it happen). This tool enqueues the EXACT
 * schedule recipe (goal/doneMeans/modules from the live editor: row) as a
 * queued run — the running server's heart claims and processes it through
 * the real production path. Honest-labeled in meta. The feed is clean, so
 * the expected outcome: audit → 0 mutable findings → done with "nothing to
 * edit is full success". NO code path here broadcasts anything by itself.
 */
import { db } from "../src/lib/db";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "never");

async function main() {
  const sched = await db.gateSchedule.findFirst({ where: { label: { startsWith: "editor:" }, enabled: true } });
  if (!sched) throw new Error("editor schedule row missing");
  console.log(`editor row: agent=${sched.agentName} brain=${sched.brain} budget=${sched.budget}`);
  console.log(`modules: ${sched.modules}`);

  // no double-fire: if the agent is already working, wait it out
  const busy = await db.gateRun.count({ where: { agentName: sched.agentName, status: { in: ["queued", "running"] } } });
  if (busy > 0) throw new Error(`${sched.agentName} already has an active run — retry later`);

  const goal = String(sched.goal || "").slice(0, 600);
  const run = await db.gateRun.create({
    data: {
      agentName: sched.agentName,
      goal,
      doneMeans: String(sched.doneMeans || "[]"),
      modules: String(sched.modules || JSON.stringify(["social.audit", "steem.edit", "chat.report"])),
      brain: sched.brain || "zai:default",
      checker: "zai:default",
      budget: Math.min(Math.max(sched.budget || 8, 1), 8),
      status: "queued",
      origin: "schedule",
      meta: JSON.stringify({
        scheduleId: sched.id,
        scheduleLabel: sched.label,
        validationNote: "roast-r7: live validation of the v4 editor loop — window was burned off-window by legacy boot; operator-side single validation run",
      }),
    },
  });
  console.log(`run enqueued: ${run.id} — waiting for the heart to claim it (max 9 min)…`);

  const started = Date.now();
  let done: typeof run | null = null;
  while (Date.now() - started < 9 * 60_000) {
    await new Promise((r) => setTimeout(r, 15_000));
    const cur = await db.gateRun.findUnique({ where: { id: run.id } });
    if (!cur) throw new Error("run vanished");
    process.stdout.write(`  [${Math.round((Date.now() - started) / 1000)}s] status=${cur.status}\n`);
    if (["done", "blocked", "failed", "cancelled"].includes(cur.status)) {
      done = cur;
      break;
    }
  }
  if (!done) {
    console.log("TIMEOUT — still running after 9 min (the 5-min root-post pacing can stretch a healthy run; check later)");
    await db.$disconnect();
    return;
  }
  console.log(`\nFINAL: ${done.status}`);
  console.log(`report: ${String(done.report || "(empty)").replace(/\n/g, " | ").slice(0, 900)}`);
  if (done.error) console.log(`error: ${String(done.error).slice(0, 400)}`);

  // chain side-effect check: census must still be 0, feed unchanged
  await db.$disconnect();
  console.log("\nR7 editor-live done (verify census/feed separately).");
}

main().catch((e) => {
  console.error(String(e).slice(0, 600));
  process.exit(1);
});
