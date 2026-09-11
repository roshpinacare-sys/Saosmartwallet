/**
 * r28 — write-mission budget recalibration, driven by measured truth:
 * 49 blocked runs audited — 34 are harness-rider TEST runs (deliberately
 * impossible goals: the checker honestly refused = system working). Of the 15
 * real blocks, the dominant pattern is WRITE missions (editor/treasurer):
 * reads + one retry consume the budget and the final WRITE step never happens
 * ("no steem.post call in trace"). Root causes fixed in code this round:
 *  · enqueueRun clamped ALL budgets to ≤8 (loop.ts doctrine) — raised to 12.
 *  · vault-gate in the scheduler: needsVault missions no longer enqueue while
 *    the vault is sealed (they deferred honestly, quota untouched).
 * This script recalibrates the SCHEDULE budgets to match the mission shape:
 *  · editor 8→10  (audit + N edits + report + 1-retry margin)
 *  · treasurer 7→9 (rewards + N claims + report + 1-retry margin)
 *  · builders 6→8 (real multi-step work end-to-end)
 *  · guardians 5→6 (bounded patrol, +1 margin)
 * Read-only patrols (pulse/presence/governance/engagement at 2-4) stay —
 * they succeed as-is; budget is a guard, not a target.
 */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

const PLAN: Array<{ label: string; from: number; to: number }> = [
  { label: "editor:anchor-agent", from: 8, to: 10 },
  { label: "treasurer:anchor-agent", from: 7, to: 9 },
  { label: "builder:anchor-agent", from: 6, to: 8 },
  { label: "builder:zai-code", from: 6, to: 8 },
  { label: "builder:verifier-agent", from: 6, to: 8 },
  { label: "builder:ui-test-agent", from: 6, to: 8 },
  { label: "builder:harness-rider", from: 6, to: 8 },
  { label: "guardian:anchor-agent", from: 5, to: 6 },
  { label: "guardian:zai-code", from: 5, to: 6 },
  { label: "guardian:verifier-agent", from: 5, to: 6 },
  { label: "guardian:ui-test-agent", from: 5, to: 6 },
  { label: "guardian:harness-rider", from: 5, to: 6 },
];

async function main() {
  for (const p of PLAN) {
    const row = await db.gateSchedule.findFirst({ where: { label: p.label }, select: { id: true, budget: true, enabled: true } });
    if (!row) {
      console.log(`? ${p.label}: schedule not found — skipped`);
      continue;
    }
    if (row.budget !== p.from) {
      console.log(`! ${p.label}: budget ${row.budget} ≠ expected ${p.from} — skipped (no blind writes)`);
      continue;
    }
    await db.gateSchedule.update({ where: { id: row.id }, data: { budget: p.to } });
    console.log(`✓ ${p.label}: budget ${p.from} → ${p.to} (enabled=${row.enabled})`);
  }
  const after = await db.gateSchedule.findMany({ where: { enabled: true }, select: { label: true, budget: true }, orderBy: { label: "asc" } });
  console.log("\nFINAL enabled schedules:");
  for (const r of after) console.log(`  budget=${String(r.budget).padStart(2)} ${r.label}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("r28-budgets failed:", e);
    process.exit(1);
  });
