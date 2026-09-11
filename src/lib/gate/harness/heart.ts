/**
 * SOVEREIGN GATE — the Gate Heart (לב-האוטונומיה).
 *
 * Hard engineering for autonomy, distilled from the studied sources:
 *  · steem agent army  — one daemon hosts many loops with interval+threshold
 *    triggers, a shared heartbeat, watermarks, daily caps and --once proof mode.
 *  · TITAI durable engine — lease-claimed jobs, heartbeat-renewed leases,
 *    bounded pull-based worker passes.
 *  · ECOS diamond heartbeat — fail-closed observe→decide→act beats that never
 *    crash the server; the "missing beat" lesson: a pulse that doesn't
 *    dispatch/govern is decorative, so this heart DOES the work.
 *  · workspace TCP — reapExpiredClaims returns crashed work to the queue.
 *
 * The heart lives INSIDE the Next.js node process (instrumentation.ts boots
 * it) — no extra port, no separate daemon. Every beat is a bounded pass:
 *   1. kill-switch check (GateConfig.autonomyEnabled — clean stop when off)
 *   2. REAP expired leases → crashed runs return to the queue (or fail honestly)
 *   3. SCHEDULES due → enqueue patrol runs (daily caps, skip-honest when busy)
 *   4. TRIGGERS ← fresh events → enqueue reactive runs (cooldown + daily caps)
 *   5. DISPATCH queued runs → claim with lease → processRun (bounded, capped)
 *   6. PULSE → write the heart's own status record (self-observability)
 *
 * Everything is real: schedules hit real chains, triggers fire on real
 * messages, leases guard real rows. Zero mock. Fail-closed everywhere —
 * a beat that errors writes the error into its pulse and lives on.
 */
import { execSync } from "child_process";
import { db } from "@/lib/db";
import { masterReady } from "@/lib/gate/crypto";
import { processRun, buildLessons } from "./loop";
import { parseBrain, pickCheckerBrain } from "./brain";
import { revokeDeviceRows, DEVICE_WARN_DAYS } from "@/lib/gate/device";
import { workerId, claimRun, LEASE_MS } from "./lease";
import { expireStaleOrders } from "./orders";
import { steemMarket } from "@/lib/steem-server";
import { MODULES } from "./modules";

/* ── tuned constants (fleet discipline — the army must never stampede) ── */
export const HEART_TICK_MS = 20_000; // one bounded pass every 20s
const REAP_STALE_MS = 10 * 60_000; // legacy running rows with no lease at all → orphaned by definition
const EVENT_FRESH_MS = 15 * 60_000; // older unconsumed events are stale — consumed silently
const MAX_CONCURRENT_RUNS = 2; // global fleet cap
const MAX_DISPATCH_PER_TICK = 2; // bounded pass (TITAI maxJobsPerPass)
const MAX_SCHEDULES_PER_TICK = 3;
const MIN_SCHEDULE_EVERY_MS = 60_000; // no runaway cadences
const DAY_MS = 86_400_000;

interface HeartPulse {
  startedAt: string;
  lastTickAt: string;
  beats: number;
  enabled: boolean;
  // ROAST r8 — live code identity: the fleet once ran for hours on a process
  // booted BEFORE a fix landed in the tree (14:08/14:10Z mute failures were
  // processed by pre-r7 code — the 6.1s ladder duration proved it). "The code
  // is fixed" is not "the running process runs the fix". This stamp is
  // process-local (never carried across restarts) so the operator can SEE
  // which code the heart actually executes, right now.
  boot?: { pid: number; bootedAt: string; codeSha: string };
  counters: { dispatched: number; reaped: number; recovered: number; schedulesFired: number; schedulesDeferred: number; triggersFired: number; proposalsFired: number; eventsSeen: number; ordersExpired: number; marketMoves: number; idleFired: number };
  // r15 — idle self-employment observability: what the fleet does with its
  // free time, and which rotation slot it is on (visible to the operator).
  // ROAST r9 gap-37 — the heart now SEES the trust surface it manages:
  // live trusted devices, ones nearing expiry, and what hygiene did this beat.
  devices?: { live: number; expiringSoon: number; reaped: number; warned: number };
  loops: Record<string, { lastAt: string; ok: boolean; fired?: number }>;
  error?: string;
}

const PULSE_KEY = "heart";

/* ══════════════════ run factory for autonomy ══════════════════ */

/**
 * Create a run from a schedule/trigger. Sovereignty-preserving brain choice:
 * NVIDIA brains need the vault master in memory (the NIM key is sealed there) —
 * when the vault is sealed (fresh boot, no operator session) the heart swaps
 * to zai and SAYS SO in the meta. No master ever leaks to make autonomy work.
 */
async function enqueueRun(opts: {
  agentName: string;
  goal: string;
  doneMeans: string[];
  modules: string[] | null;
  brain: string | null;
  budget: number;
  origin: "schedule" | "trigger" | "proposal" | "idle";
  meta: Record<string, unknown>;
}): Promise<string> {
  const agent = await db.gateAgent.findFirst({ where: { name: opts.agentName, active: true } });
  if (!agent) throw new Error(`הסוכן ${opts.agentName} לא פעיל`);
  let armed: string[] = [];
  try { armed = JSON.parse(agent.modules || "[]"); if (!Array.isArray(armed)) armed = []; } catch { armed = []; }
  const modules = (opts.modules && opts.modules.length ? opts.modules : armed).filter(Boolean);
  if (!modules.length) throw new Error(`הסוכן ${opts.agentName} לא חמוש באף מודול — אוטונומיה בלי ידיים היא בזבוז; חמש אותו קודם`);

  const meta: Record<string, unknown> = { ...opts.meta };
  let brain = opts.brain || agent.brain || "zai:default";
  const parsed = parseBrain(brain);
  // r27 efficiency plane: downgrade to zai ONLY when the vault is sealed AND no
  // runtime env key exists. Measured live (r27): nvidia 91.5% vs zai 34.5% run
  // success — every silent downgrade during a locked window burned run budget.
  // Env is runtime-only (never in git) → the zero-secrets-in-git law holds.
  const envNim = !!process.env.NVIDIA_API_KEY?.trim();
  if (parsed.provider === "nvidia" && !masterReady() && !envNim) {
    brain = "zai:default";
    meta.brainNote = "הכספת חתומה — המוח הוחלף ל-zai (מפתח-NIM חתום בכספת, לא נחשף)";
  } else if (parsed.provider === "nvidia" && !masterReady() && envNim) {
    meta.brainNote = "הכספת חתומה — המוח נשאר nvidia על-מפתח-סביבה (זמן-ריצה-בלבד, אפס-סודות-בגיט)";
  }

  const brainStr = `${parsed.provider}:${parsed.model}`;
  const run = await db.gateRun.create({
    data: {
      agentName: agent.name,
      // ROAST r7: the editor-v4 goal is ~950 chars — the flat 600 clamp cut it
      // mid-instruction ("(3) chat.report…" invisible), so the brain ran a
      // goal it never fully read. Operator-curated schedule goals get a wider
      // lane; trigger/proposal goals stay bounded.
      goal: opts.goal.slice(0, opts.origin === "schedule" ? 1200 : 600),
      doneMeans: JSON.stringify(opts.doneMeans.filter((d) => typeof d === "string" && d.trim()).slice(0, 8)),
      modules: JSON.stringify(modules),
      brain,
      checker: pickCheckerBrain(brainStr),
      budget: Math.min(Math.max(opts.budget || 5, 1), 8),
      status: "queued",
      origin: opts.origin,
      meta: JSON.stringify(meta),
    },
  });
  const lessons = await buildLessons(agent.name, run.id);
  if (lessons.length) {
    await db.gateRun.update({ where: { id: run.id }, data: { lessons: JSON.stringify(lessons) } });
  }
  void run;
  const originIcon = opts.origin === "schedule" ? "⏰" : opts.origin === "proposal" ? "💡" : opts.origin === "idle" ? "🌿" : "⚡";
  const originText = opts.origin === "schedule" ? "סיור מתוכנן" : opts.origin === "proposal" ? "יוזמת-יעד" : opts.origin === "idle" ? "תעסוקה-עצמית" : "טריגר אירוע";
  const note = typeof meta.brainNote === "string" ? ` · ${meta.brainNote}` : "";
  await db.gateMessage.create({
    data: {
      channel: "command",
      fromKind: "system",
      fromName: "harness",
      body: `${originIcon} יעד אוטונומי (${originText}) → ${agent.name}: "${opts.goal.slice(0, 180)}" · מוח: ${brain} · תקציב: ${run.budget}${note}`,
      meta: JSON.stringify({ runId: run.id }),
    },
  }).catch(() => {});
  return run.id;
}

/* ══════════════════ beat stages ══════════════════ */

async function stageReap(p: HeartPulse): Promise<void> {
  const now = new Date();
  const staleLegacy = new Date(now.getTime() - REAP_STALE_MS);
  // crashed mid-lease (lease expired) or legacy orphans (no lease, old updatedAt)
  const reaped = await db.gateRun.updateMany({
    where: {
      status: "running",
      OR: [
        { leaseExpiresAt: { lt: now } },
        { heartbeatAt: null, createdAt: { lt: staleLegacy }, attempt: 0 },
      ],
    },
    data: { status: "queued", leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null },
  });
  // runs that keep dying: past their last allowed attempt → honest failure.
  // ROAST r8 — this path used to die MUTE: error set, report NULL, no bridge
  // message. Live proof: run cmtvmw5v (14:40Z) — crashed twice off-process
  // (sandbox reaper), the exhausted-reaper marked it failed, and the bridge
  // showed NOTHING. r7's "no run dies mute" only covered the in-process
  // catch. Every terminal failure path must confess in Hebrew.
  const exhaustedRows = await db.gateRun.findMany({
    where: { status: "queued", attempt: { gte: 2 }, maxAttempts: { lte: 2 } },
    select: { id: true, agentName: true, goal: true, error: true, attempt: true },
    take: 20,
  });
  let exhausted = 0;
  for (const run of exhaustedRows) {
    const prevSteps = await db.gateRun.findUnique({ where: { id: run.id }, select: { steps: true } }).then((r) => {
      try { return r?.steps ? (JSON.parse(r.steps) as unknown[]) : []; } catch { return []; }
    });
    const makerDone = prevSteps.filter((s) => (s as { side?: string; ok?: boolean }).side === "maker" && (s as { side?: string; ok?: boolean }).ok).length;
    await db.gateRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        error: "watchdog: הרצה קרסה יותר מדי פעמים — הוחזרה לתור ונכשלה בכנות",
        report:
          `🛑 הריצה קרסה ${run.attempt} פעמים והשומר הכריז עליה כישלון סופי. ` +
          `מטרה: ${String(run.goal).slice(0, 200)}. צעדים שהוכחו לפני הקריסות: ${makerDone}. ` +
          `השגיאה האחרונה: ${String(run.error || "לא דווח").slice(0, 220)}. ` +
          `זו כשל-כנה של הסביבה או הפרוטוקול — לא דוח-תוצרים, כי העבודה לא הושלמה.`,
        finishedAt: new Date(),
      },
    });
    exhausted++;
    await db.gateMessage.create({
      data: { channel: "command", fromKind: "system", fromName: "harness", body: `🫀 ריצת-מטרה של ${run.agentName} קרסה ${run.attempt} פעמים ונכשלה סופית — וידוי כן נכתב לדוח שלה`, meta: JSON.stringify({ runId: run.id }) },
    }).catch(() => {});
  }
  p.counters.reaped += reaped.count;
  if (reaped.count || exhausted > 0) {
    p.loops.reaper = { lastAt: now.toISOString(), ok: true, fired: reaped.count + exhausted };
    if (reaped.count) {
      await db.gateMessage.create({
        data: { channel: "command", fromKind: "system", fromName: "harness", body: `🫀 השומר החזיר ${reaped.count} ריצה/ות קרוסות לתור — יוכרו מחדש עם עקבותיהן (התאוששות-מקריסה)`, meta: "{}" },
      }).catch(() => {});
    }
  }
}

function dayKeyNow(): string {
  return new Date().toISOString().slice(0, 10);
}

/* ══════════════════ device hygiene — the trust surface manages itself (r9) ══════════════════
 *
 * gap-30: expired devices used to sit in the DB forever as "פעילים" — counted
 * by the UI, rejected by deviceMaster, never cleaned. gap-34: the 90-day
 * contract expired silently — no warning, no renewal nudge. Now every beat:
 *   1. REAP expired devices → revoked + SCRUBBED (ciphertext leaves the DB)
 *   2. WARN ≤7 days before expiry → once per device per day (GateState watermark)
 * Bounded, fail-closed, Hebrew-confessing — like every heart stage.
 */
const DEVICE_HYGIENE_KEY = "device-hygiene";

export async function runDeviceHygiene(): Promise<{ reaped: number; warned: number; live: number; expiringSoon: number }> {
  const now = new Date();
  // 1. reap expired — the same scrub path the API uses (inert by data, not flag)
  const expired = await db.gateDevice.findMany({
    where: { revoked: false, expiresAt: { lt: now } },
    select: { id: true, label: true },
    take: 20,
  });
  let reaped = 0;
  for (const d of expired) {
    const r = await revokeDeviceRows({ id: d.id }, null, "פג-תוקף — נגרע אוטומטית עם הצופן");
    reaped += r.devices;
  }

  // 2. warn before expiry — one message per device per day, bounded
  const horizon = new Date(now.getTime() + DEVICE_WARN_DAYS * 86_400_000);
  const expiring = await db.gateDevice.findMany({
    where: { revoked: false, encMaster: { not: null }, expiresAt: { gte: now, lte: horizon } },
    select: { id: true, label: true, expiresAt: true },
    orderBy: { expiresAt: "asc" },
    take: 20,
  });
  let warned = 0;
  if (expiring.length) {
    const stateRow = await db.gateState.findUnique({ where: { key: DEVICE_HYGIENE_KEY } });
    let marks: Record<string, string> = {};
    try { marks = stateRow ? (JSON.parse(stateRow.value) as Record<string, string>) : {}; } catch { marks = {}; }
    let dirty = false;
    for (const d of expiring) {
      const last = marks[d.id] ? Date.parse(marks[d.id]) : 0;
      if (now.getTime() - last < 86_400_000) continue; // one nudge per day
      const days = Math.max(0, Math.ceil((d.expiresAt.getTime() - now.getTime()) / 86_400_000));
      await db.gateMessage.create({
        data: { channel: "command", fromKind: "system", fromName: "harness", body: `⏳ מכשיר-מהימן "${d.label}" יפוג בעוד ${days} יום/ימים — היכנס בו וחמש מכשיר חדש (רוטציה), או שלול אם אינו בשימוש` },
      }).catch(() => {});
      marks[d.id] = now.toISOString();
      dirty = true;
      warned++;
    }
    if (dirty) {
      const value = JSON.stringify(marks);
      await db.gateState.upsert({ where: { key: DEVICE_HYGIENE_KEY }, create: { key: DEVICE_HYGIENE_KEY, value }, update: { value } });
    }
  }

  const live = await db.gateDevice.count({ where: { revoked: false, encMaster: { not: null }, expiresAt: { gt: now } } });
  const expiringSoon = await db.gateDevice.count({ where: { revoked: false, encMaster: { not: null }, expiresAt: { gte: now, lte: horizon } } });
  return { reaped, warned, live, expiringSoon };
}

async function stageDeviceHygiene(p: HeartPulse): Promise<void> {
  const r = await runDeviceHygiene();
  p.devices = { live: r.live, expiringSoon: r.expiringSoon, reaped: (p.devices?.reaped ?? 0) + r.reaped, warned: (p.devices?.warned ?? 0) + r.warned };
  if (r.reaped > 0) {
    p.loops.hygiene = { lastAt: new Date().toISOString(), ok: true, fired: r.reaped };
    await db.gateMessage.create({
      data: { channel: "command", fromKind: "system", fromName: "harness", body: `🧹 היגיינת-מכשירים: ${r.reaped} מכשירים פגי-תוקף נשללו והצופנים שלהם נמחקו מה-DB` },
    }).catch(() => {});
  }
}

async function stageSchedules(p: HeartPulse): Promise<void> {
  const now = Date.now();
  // ROAST r5: a daily schedule whose window passed long ago (boot catch-up at
  // 03:00 Israel) must NOT fire — the staggered-hours doctrine exists so the
  // fleet reads like a living community, and the boot-fire also consumed the
  // day quota, silently cancelling that day's real window.
  const DAILY_GRACE_MS = 2 * 60 * 60_000;
  const due = await db.gateSchedule.findMany({
    where: { enabled: true, nextRunAt: { lte: new Date(now) } },
    orderBy: { nextRunAt: "asc" },
    take: MAX_SCHEDULES_PER_TICK,
  });
  let fired = 0;
  for (const s of due) {
    try {
      const dk = dayKeyNow();
      const count = s.dayKey === dk ? s.dayCount : 0;
      if (s.kind === "daily" && typeof s.hourUtc === "number") {
        const win = new Date();
        win.setUTCHours(s.hourUtc, 0, 0, 0);
        if (now - win.getTime() > DAILY_GRACE_MS) {
          // window long gone — defer to TOMORROW's window, quota untouched
          await db.gateSchedule.update({
            where: { id: s.id },
            data: { nextRunAt: new Date(win.getTime() + DAY_MS), dayKey: dk, dayCount: count },
          });
          p.counters.schedulesDeferred++;
          continue;
        }
        // ROAST r7 — EARLY-fire clamp: r5 only blocked LATE fires. If the row
        // came due BEFORE today's window (legacy boot rows, or a crash between
        // enqueue and update), the negative (now − win) sailed through and the
        // order fired hours early, burning the day's quota. A daily order may
        // only EVER fire inside [win, win + grace] — hold it at the window.
        if (now < win.getTime()) {
          await db.gateSchedule.update({
            where: { id: s.id },
            data: { nextRunAt: win, dayKey: dk, dayCount: count },
          });
          p.counters.schedulesDeferred++;
          continue;
        }
      }
      if (count >= s.maxPerDay) {
        // cap reached — honestly push to TOMORROW'S WINDOW (r7: now+24h drifted
        // dailies off-window — the burn at 01:54Z proved the drift is real),
        // no silent lies
        let nextCap = new Date(now + Math.max(s.everyMs || MIN_SCHEDULE_EVERY_MS, MIN_SCHEDULE_EVERY_MS));
        if (s.kind === "daily" && typeof s.hourUtc === "number") {
          const d = new Date();
          d.setUTCHours(s.hourUtc, 0, 0, 0);
          if (d.getTime() <= now) d.setUTCDate(d.getUTCDate() + 1);
          nextCap = d;
        }
        await db.gateSchedule.update({
          where: { id: s.id },
          data: { nextRunAt: nextCap, dayKey: dk, dayCount: count },
        });
        continue;
      }
      const agent = await db.gateAgent.findFirst({ where: { name: s.agentName, active: true, autonomy: true } });
      if (!agent) {
        await db.gateSchedule.update({ where: { id: s.id }, data: { nextRunAt: new Date(now + Math.max(s.everyMs || MIN_SCHEDULE_EVERY_MS, MIN_SCHEDULE_EVERY_MS)) } });
        continue;
      }
      const busy = await db.gateRun.count({ where: { agentName: s.agentName, status: { in: ["queued", "running"] } } });
      const cadence = Math.max(s.everyMs || MIN_SCHEDULE_EVERY_MS, MIN_SCHEDULE_EVERY_MS);
      if (busy > 0) {
        // skip-honest: agent already working — defer one minute, count it
        await db.gateSchedule.update({ where: { id: s.id }, data: { nextRunAt: new Date(now + 60_000), dayKey: dk, dayCount: count } });
        p.counters.schedulesDeferred++;
        continue;
      }
      let next: Date;
      if (s.kind === "daily" && typeof s.hourUtc === "number") {
        const d = new Date();
        d.setUTCHours(s.hourUtc, 0, 0, 0);
        if (d.getTime() <= now) d.setUTCDate(d.getUTCDate() + 1);
        next = d;
      } else {
        next = new Date(now + cadence);
      }
      await enqueueRun({
        agentName: s.agentName,
        goal: s.goal,
        doneMeans: JSON.parse(s.doneMeans || "[]"),
        modules: s.modules ? JSON.parse(s.modules) : null,
        brain: s.brain,
        budget: s.budget,
        origin: "schedule",
        meta: { scheduleId: s.id, scheduleLabel: s.label },
      });
      await db.gateSchedule.update({
        where: { id: s.id },
        data: { lastRunAt: new Date(now), nextRunAt: next, dayKey: dk, dayCount: count + 1 },
      });
      p.counters.schedulesFired++;
      fired++;
    } catch (e) {
      // a broken schedule must not stall the fleet — push it one cadence away
      // (r7: dailies go to their NEXT WINDOW, not now+cadence off-window)
      const msg = e instanceof Error ? e.message : String(e);
      const fallEvery = Math.max(s.everyMs || MIN_SCHEDULE_EVERY_MS, MIN_SCHEDULE_EVERY_MS);
      let fallNext = new Date(now + fallEvery);
      if (s.kind === "daily" && typeof s.hourUtc === "number") {
        const d = new Date();
        d.setUTCHours(s.hourUtc, 0, 0, 0);
        if (d.getTime() <= now) d.setUTCDate(d.getUTCDate() + 1);
        fallNext = d;
      }
      await db.gateSchedule.update({
        where: { id: s.id },
        data: { nextRunAt: fallNext },
      }).catch(() => { console.error("[heart] schedule fall-behind failed:", msg); });
    }
  }
  p.loops.scheduler = { lastAt: new Date().toISOString(), ok: true, fired };
}

function fillTemplate(tpl: string, p: Record<string, unknown>): string {
  return String(tpl || "")
    .replaceAll("{body}", String(p.body ?? ""))
    .replaceAll("{goal}", String(p.goal ?? ""))
    .replaceAll("{gaps}", String(p.gaps ?? ""))
    .replaceAll("{agent}", String(p.agent ?? ""))
    .replaceAll("{price}", String(p.price ?? ""))
    .replaceAll("{prev}", String(p.prev ?? ""))
    .replaceAll("{pct}", String(p.pct ?? ""))
    .trim();
}

async function stageTriggers(p: HeartPulse): Promise<void> {
  const now = new Date();
  const fresh = new Date(now.getTime() - EVENT_FRESH_MS);
  const events = await db.gateEvent.findMany({
    where: { consumed: false, createdAt: { gte: fresh } },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  const stale = await db.gateEvent.updateMany({ where: { consumed: false, createdAt: { lt: fresh } }, data: { consumed: true } });
  p.counters.eventsSeen += events.length + stale.count;
  if (!events.length) {
    p.loops.triggers = { lastAt: now.toISOString(), ok: true, fired: 0 };
    return;
  }
  const triggers = await db.gateTrigger.findMany({ where: { enabled: true } });
  let fired = 0;
  for (const ev of events) {
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(ev.payload || "{}"); } catch { payload = {}; }
    const agentInEvent = String(payload.agent || "");
    const trig = triggers.find((t) => {
      if (t.on !== ev.type) return false;
      return t.agentName === "@self" ? Boolean(agentInEvent) : t.agentName === agentInEvent;
    });
    // consume regardless — events are stimuli, not queues of record
    await db.gateEvent.update({ where: { id: ev.id }, data: { consumed: true } }).catch(() => {});
    if (!trig) continue;
    const dk = dayKeyNow();
    const tCount = trig.dayKey === dk ? trig.dayCount : 0;
    const cooled = !trig.lastFiredAt || now.getTime() - trig.lastFiredAt.getTime() >= trig.cooldownMs;
    if (!cooled || tCount >= trig.maxPerDay) continue;
    try {
      const target = trig.agentName === "@self" ? agentInEvent : trig.agentName;
      await enqueueRun({
        agentName: target,
        goal: fillTemplate(trig.goalTemplate, payload) || String(payload.body || payload.goal || "אירוע דורש טיפול"),
        doneMeans: JSON.parse(trig.doneMeans || "[]"),
        modules: null, // the agent's armed set rules
        brain: null,
        budget: trig.budget,
        origin: "trigger",
        meta: { triggerId: trig.id, eventId: ev.id, eventSource: ev.source },
      });
      await db.gateTrigger.update({
        where: { id: trig.id },
        data: { lastFiredAt: new Date(now), dayKey: dk, dayCount: tCount + 1 },
      });
      p.counters.triggersFired++;
      fired++;
    } catch { /* trigger fire failed — event already consumed; bounded, honest */ }
  }
  p.loops.triggers = { lastAt: now.toISOString(), ok: true, fired };
}

/* ══════════════════ goal-initiative policy (the boundary decides) ══════════════════ */

const PROPOSAL_POLICY_KEY = "proposal-policy";

export interface ProposalPolicy {
  autoApprove: boolean; // may the heart launch proposals on its own?
  maxAutoPerDay: number; // fleet-wide policy-approved proposals per day
  maxBudget: number; // a proposal asking for more steps waits for the operator
}

/** Bounded initiative is ON by default — small, capped, fully visible. */
export async function readProposalPolicy(): Promise<ProposalPolicy> {
  const row = await db.gateState.findUnique({ where: { key: PROPOSAL_POLICY_KEY } });
  const dflt: ProposalPolicy = { autoApprove: true, maxAutoPerDay: 2, maxBudget: 4 };
  try { if (row) return { ...dflt, ...(JSON.parse(row.value) as Partial<ProposalPolicy>) }; } catch { /* fresh */ }
  return dflt;
}

export async function writeProposalPolicy(p: ProposalPolicy): Promise<void> {
  await db.gateState.upsert({
    where: { key: PROPOSAL_POLICY_KEY },
    create: { key: PROPOSAL_POLICY_KEY, value: JSON.stringify(p) },
    update: { value: JSON.stringify(p) },
  });
}

/**
 * stageProposals — goal initiative, made real but BOUNDED: an armed agent
 * proposed a goal (goal.propose module); the heart launches it only when the
 * policy allows: daily fleet cap, budget cap, armed+autonomous+idle agent.
 * One proposal per beat max — initiative must never stampede the fleet.
 */
async function stageProposals(p: HeartPulse): Promise<void> {
  const policy = await readProposalPolicy();
  const loops = () => ({ lastAt: new Date().toISOString(), ok: true, fired: 0 });
  if (!policy.autoApprove) {
    p.loops.initiative = loops();
    return;
  }
  const dayStart = new Date(`${dayKeyNow()}T00:00:00.000Z`);
  const todayCount = await db.gateProposal.count({
    where: { status: "launched", decidedBy: "policy", decidedAt: { gte: dayStart } },
  });
  const pend = todayCount >= policy.maxAutoPerDay
    ? []
    : await db.gateProposal.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" }, take: 8 });
  // gap-54 — the initiative engine used to EXECUTE a verdict on the first
  // candidate it could not launch: an unknown agent name got auto-"expired"
  // by policy 16 seconds after filing, which silently killed a sovereign
  // operator-decision item (the steemauto door-closure) before the operator
  // ever saw it. The doctrine is the opposite: the policy engine may LAUNCH
  // what it is allowed to launch — it may never DECIDE what it cannot.
  // Candidates it cannot launch are SKIPPED (stay pending for the operator),
  // never stamped. An over-budget proposal is the DESIGNED sovereign gate
  // ("a proposal asking for more steps waits for the operator") — so
  // operator-only items should file with budget > maxBudget.
  // r15 — schedule-create proposals are skipped by KIND, not by budget: a
  // recurring patrol is structural employment, and structure is the
  // operator's sovereign decision (the agents design, the operator adopts).
  let cand: (typeof pend)[number] | undefined;
  for (const x of pend) {
    if (x.kind && x.kind !== "run") continue; // structural proposals ⇒ operator-only, forever if needed
    if (x.budget > policy.maxBudget) continue; // above-cap ⇒ operator-only — waits, forever if needed
    const agent = await db.gateAgent.findFirst({ where: { name: x.agentName, active: true, autonomy: true } });
    if (!agent) continue; // unknown/inactive agent ⇒ the operator's call — stays pending
    const busy = await db.gateRun.count({ where: { agentName: x.agentName, status: { in: ["queued", "running"] } } });
    if (busy > 0) continue; // idle-only — never stack a proposal on a working agent (skip, don't block the queue)
    cand = x;
    break;
  }
  if (!cand) {
    p.loops.initiative = loops();
    return;
  }
  try {
    const runId = await enqueueRun({
      agentName: cand.agentName,
      goal: cand.goal,
      doneMeans: JSON.parse(cand.doneMeans || "[]"),
      modules: null, // the agent's armed set rules
      brain: null,
      budget: Math.min(cand.budget, policy.maxBudget),
      origin: "proposal",
      meta: { proposalId: cand.id, note: `יוזמת-יעד אושרה במדיניות (${todayCount + 1}/${policy.maxAutoPerDay} היום)` },
    });
    await db.gateProposal.update({
      where: { id: cand.id },
      data: { status: "launched", decidedBy: "policy", decidedAt: new Date(), runId },
    });
    p.counters.proposalsFired++;
    p.loops.initiative = { lastAt: new Date().toISOString(), ok: true, fired: 1 };
  } catch {
    // a broken enqueue is rejected honestly, not retried forever — but only
    // AFTER the policy engine verified it may launch this candidate at all
    await db.gateProposal.update({ where: { id: cand.id }, data: { status: "rejected", decidedBy: "policy", decidedAt: new Date() } }).catch(() => {});
    p.loops.initiative = loops();
  }
}

/**
 * Operator/policy approval — launch a proposal as a REAL run (origin=proposal).
 * Used by the proposals API (operator decision) and by the policy path.
 * The run is QUEUED here; the heart's dispatch stage claims it within one beat.
 */
export async function launchProposal(proposalId: string, decidedBy: "operator" | "policy"): Promise<string> {
  const p = await db.gateProposal.findUnique({ where: { id: proposalId } });
  if (!p) throw new Error("אין הצעה כזו");
  if (p.status !== "pending") throw new Error(`ההצעה כבר הוכרעה (${p.status})`);
  const agent = await db.gateAgent.findFirst({ where: { name: p.agentName, active: true } });
  if (!agent) throw new Error("הסוכן אינו פעיל — לא ניתן להזניק");
  const runId = await enqueueRun({
    agentName: p.agentName,
    goal: p.goal,
    doneMeans: JSON.parse(p.doneMeans || "[]"),
    modules: null, // the agent's armed set rules
    brain: null,
    budget: p.budget,
    origin: "proposal",
    meta: { proposalId: p.id, note: decidedBy === "operator" ? "אושרה ידנית על-ידי המפעיל" : "אושרה במדיניות המרוסנת" },
  });
  await db.gateProposal.update({
    where: { id: proposalId },
    data: { status: "launched", decidedBy, decidedAt: new Date(), runId },
  });
  return runId;
}

/**
 * r15 — the operator ADOPTS an agent-designed patrol (kind=schedule-create):
 * the proposal's payload becomes a REAL GateSchedule and the proposal closes
 * as "adopted". Structural employment is sovereign — this is called only
 * from the operator's approve path, never from the policy engine. Every
 * spec field is re-validated against the same hard bounds the proposer
 * faced (cadence floor, budget clamp, module registry) — the DB never
 * trusts a payload it hasn't re-checked.
 */
export async function adoptScheduleProposal(proposalId: string): Promise<{ scheduleId: string; label: string }> {
  const p = await db.gateProposal.findUnique({ where: { id: proposalId } });
  if (!p) throw new Error("אין הצעה כזו");
  if (p.status !== "pending") throw new Error(`ההצעה כבר הוכרעה (${p.status})`);
  if ((p.kind || "run") !== "schedule-create") throw new Error("זו אינה הצעת-סיור — השתמש בהזנקה רגילה");
  let payload: {
    label?: string; kind?: string; hourUtc?: number | null; everyMs?: number | null;
    budget?: number; maxPerDay?: number; modules?: string[] | null;
  } = {};
  try { payload = JSON.parse(p.payload || "{}"); } catch { payload = {}; }
  const label = String(payload.label || "").trim();
  const kind = payload.kind === "interval" ? "interval" : payload.kind === "daily" ? "daily" : "";
  const goal = String(p.goal || "").trim().slice(0, 1200);
  const doneMeans = (() => { try { return JSON.parse(p.doneMeans || "[]"); } catch { return []; } })();
  const budget = Math.min(Math.max(Number(payload.budget) || 3, 1), 8);
  const maxPerDay = Math.min(Math.max(Number(payload.maxPerDay) || 4, 1), 12);
  const hourUtc = payload.hourUtc === null || payload.hourUtc === undefined ? null : Math.min(Math.max(Number(payload.hourUtc), 0), 23);
  const everyMs = payload.everyMs === null || payload.everyMs === undefined ? null : Math.max(Number(payload.everyMs), MIN_SCHEDULE_EVERY_MS);
  if (!label || label.length < 3 || label.length > 60) throw new Error("שם-הסיור בפיילוד לא תקין");
  if (!kind) throw new Error("סוג-הקצב בפיילוד לא תקין");
  if (kind === "daily" && hourUtc === null) throw new Error("daily דורש hourUtc תקין");
  if (kind === "interval" && !everyMs) throw new Error("interval דורש everyMs תקין");
  if (!Array.isArray(doneMeans) || !doneMeans.length) throw new Error("ההצעה ללא שער-מעבר — אין לאמץ");
  // armed-set re-check: every module id must exist in the registry, or the
  // schedule would arm a patrol with phantom hands
  const mods = Array.isArray(payload.modules) ? payload.modules.filter((m) => typeof m === "string" && MODULES.some((x) => x.id === m)) : null;
  if (Array.isArray(payload.modules) && mods!.length !== payload.modules.length) {
    throw new Error("הפיילוד מציין מודולים שאינם במחסן — נדחה");
  }
  const dup = await db.gateSchedule.findFirst({ where: { label } });
  if (dup) throw new Error(`קיים כבר סיור בשם "${label}"`);
  const next =
    kind === "daily"
      ? (() => { const d = new Date(); d.setUTCHours(hourUtc!, 0, 0, 0); if (d.getTime() <= Date.now()) d.setUTCDate(d.getUTCDate() + 1); return d; })()
      : new Date(Date.now() + everyMs!);
  const s = await db.gateSchedule.create({
    data: {
      label,
      agentName: p.agentName,
      goal,
      doneMeans: JSON.stringify(doneMeans),
      modules: mods ? JSON.stringify(mods) : null,
      brain: null, // the agent's own brain rules (enqueueRun re-checks)
      budget,
      kind,
      everyMs: kind === "interval" ? everyMs : null,
      hourUtc: kind === "daily" ? hourUtc : null,
      maxPerDay,
      enabled: true,
      nextRunAt: next,
    },
  });
  await db.gateProposal.update({
    where: { id: proposalId },
    data: { status: "adopted", decidedBy: "operator", decidedAt: new Date() },
  });
  await db.gateMessage.create({
    data: {
      channel: "command",
      fromKind: "system",
      fromName: "harness",
      body: `🌸 המפעיל אימץ את סיור-הרשת "${label}" שעיצב ${p.agentName} — תעסוקה קבועה חדשה נרשמה (ההזנקה הראשונה: ${next.toISOString().slice(0, 16).replace("T", " ")} UTC)`,
      meta: JSON.stringify({ proposalId, scheduleId: s.id }),
    },
  }).catch(() => {});
  return { scheduleId: s.id, label };
}

/* ════════════════ idle self-employment (r15) ════════════════
 * gap-56: when the queue is empty and no schedule is due, the fleet IDLED —
 * proven brains, armed modules, and zero work. "עוד תעסוקה שתקדם אותנו ואת
 * הרשת" is now a heartbeat stage: every 12th beat (~4min), if the WHOLE
 * fleet is idle (queue empty, nothing running, both dispatch slots free),
 * the heart enqueues ONE light network-presence mission from a rotating
 * roster to a rotating agent — budget 2, fleet-wide cap 6/day, honest meta.
 * Bounded initiative doctrine applies unchanged: the heart only LAUNCHES
 * what it is allowed to launch (light, public, capped), and the rotation
 * watermark lives in GateState so restarts don't reset the day's quota.
 */
const IDLE_KEY = "idle-employment";
const IDLE_EVERY_BEATS = 12; // ~4min between idle craft opportunities
const IDLE_MAX_PER_DAY = 6; // fleet-wide self-employment cap
const IDLE_BUDGET = 2;
const IDLE_ROSTER: { module: string; goal: string; doneMeans: string[] }[] = [
  {
    module: "chain.pulse",
    goal: "תעסוקה-עצמית (דופק): הפעל chain.pulse והוכח מכנית אילו מסילות מייצרות בלוקים עכשיו. דווח לגשר בעברית בשורה-אחת.",
    doneMeans: ["chain.pulse הופעל והחזיר דלתא-בלוקים לכל מסילה שנענתה", "שורת-דיווח עברית נכתבה לגשר עם המספרים שנמדדו"],
  },
  {
    module: "fleet.presence",
    goal: "תעסוקה-עצמית (נוכחות): הפעל fleet.presence ומדוד איפה הצי נמצא בשלוש-המסילות. דווח לגשר בעברית בשורה-אחת.",
    doneMeans: ["fleet.presence הופעל והחזיר ספירת-חשבונות לכל מסילה שנענתה", "שורת-דיווח עברית נכתבה לגשר"],
  },
  {
    module: "social.engagement",
    goal: "תעסוקה-עצמית (הד): הפעל social.engagement ומדוד האם הפוסטים-האחרונים מקבלים הצבעות/תגובות. דווח לגשר בעברית.",
    doneMeans: ["social.engagement הופעל ומדד הצבעות/תגובות לפוסטי-המפקד", "שורת-דיווח עברית נכתבה לגשר"],
  },
  {
    module: "governance.scan",
    goal: "תעסוקה-עצמית (ממשל): הפעל governance.scan ומפה למי הצי מצביע-עדים ומי שותק. דווח לגשר בעברית.",
    doneMeans: ["governance.scan הופעל והחזיר ספירת-מצביעים/נציגויות/שותקים", "שורת-דיווח עברית נכתבה לגשר"],
  },
  {
    module: "steem.trends",
    goal: "תעסוקה-עצמית (מכ\"ם): הפעל steem.trends וראה מה הרשת קוראת עכשיו — מועמדויות-נושא לפרסום הבא. דווח לגשר בעברית.",
    doneMeans: ["steem.trends הופעל והחזיר תגיות/דיונים-חמים חיים", "שורת-דיווח עברית עם מועמדות-נושא אחת לפחות"],
  },
  {
    module: "market.watch",
    goal: "תעסוקה-עצמית (שוק): הפעל market.watch עם depth 5 ומדוד את מצב ה-DEX עכשיו. דווח לגשר בעברית.",
    doneMeans: ["market.watch הופעל והחזיר טיקר/ספר-הזמנות חיים", "שורת-דיווח עברית עם המחיר שנמדד"],
  },
];

async function stageIdle(p: HeartPulse): Promise<void> {
  const loops = () => ({ lastAt: new Date().toISOString(), ok: true, fired: 0 });
  if (p.beats % IDLE_EVERY_BEATS !== 0) {
    if (!p.loops.idleCraft) p.loops.idleCraft = loops();
    return;
  }
  const queued = await db.gateRun.count({ where: { status: "queued" } });
  const running = await db.gateRun.count({ where: { status: "running" } });
  if (queued > 0 || running >= MAX_CONCURRENT_RUNS) {
    p.loops.idleCraft = loops();
    return; // the fleet is busy — self-employment never displaces real work
  }
  const state = await db.gateState.findUnique({ where: { key: IDLE_KEY } });
  let marks: { dayKey?: string; count?: number; idx?: number } = {};
  try { if (state) marks = JSON.parse(state.value) as typeof marks; } catch { /* fresh */ }
  const dk = dayKeyNow();
  const count = marks.dayKey === dk ? marks.count ?? 0 : 0;
  if (count >= IDLE_MAX_PER_DAY) {
    p.loops.idleCraft = loops();
    return;
  }
  const idx = ((marks.idx ?? -1) + 1) % IDLE_ROSTER.length;
  const roster = IDLE_ROSTER[idx];
  // rotate across active, autonomous, currently-idle agents — self-employment
  // is spread across the fleet, never stacked on one worker
  const agents = await db.gateAgent.findMany({ where: { active: true, autonomy: true }, orderBy: { name: "asc" } });
  const pool: string[] = [];
  for (const a of agents) {
    const busy = await db.gateRun.count({ where: { agentName: a.name, status: { in: ["queued", "running"] } } });
    if (busy === 0) pool.push(a.name);
  }
  if (!pool.length) {
    p.loops.idleCraft = loops();
    return;
  }
  const agentName = pool[idx % pool.length];
  try {
    await enqueueRun({
      agentName,
      goal: roster.goal,
      doneMeans: roster.doneMeans,
      modules: [roster.module, "chat.report"],
      brain: null,
      budget: IDLE_BUDGET,
      origin: "idle",
      meta: { selfEmployment: true, roster: roster.module, rotation: `${idx}/${IDLE_ROSTER.length}`, count: `${count + 1}/${IDLE_MAX_PER_DAY}` },
    });
    p.counters.idleFired = (p.counters.idleFired || 0) + 1;
    p.loops.idleCraft = { lastAt: new Date().toISOString(), ok: true, fired: 1 };
    const value = JSON.stringify({ dayKey: dk, count: count + 1, idx });
    await db.gateState.upsert({ where: { key: IDLE_KEY }, create: { key: IDLE_KEY, value }, update: { value } });
  } catch (e) {
    // rotation index advances anyway — a broken roster slot must not loop forever
    const value = JSON.stringify({ dayKey: dk, count, idx });
    await db.gateState.upsert({ where: { key: IDLE_KEY }, create: { key: IDLE_KEY, value }, update: { value } }).catch(() => {});
    p.loops.idleCraft = { lastAt: new Date().toISOString(), ok: false, fired: 0 };
    console.error("eart] idle-craft failed:", e instanceof Error ? e.message : e);
  }
}

async function stageDispatch(p: HeartPulse): Promise<void> {
  const running = await db.gateRun.count({ where: { status: "running" } });
  let slots = Math.max(0, MAX_CONCURRENT_RUNS - running);
  let fired = 0;
  if (slots > 0) {
    const queued = await db.gateRun.findMany({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
      take: MAX_DISPATCH_PER_TICK + 2,
    });
    for (const r of queued) {
      if (fired >= MAX_DISPATCH_PER_TICK || slots <= 0) break;
      const busy = await db.gateRun.count({ where: { agentName: r.agentName, status: "running" } });
      if (busy > 0) continue; // one goal at a time per agent (steem fleetPace)
      const won = await claimRun(r.id);
      if (!won) continue; // someone else (manual path) claimed it
      p.counters.dispatched++;
      if ((r.attempt ?? 0) + 1 > 1) p.counters.recovered++;
      slots--;
      fired++;
      void processRun(r.id, { claimed: true, workerId: workerId() }).catch(() => { /* self-reports into GateRun.error */ });
    }
  }
  p.loops.dispatch = { lastAt: new Date().toISOString(), ok: true, fired };
}

/* ══════════════════ sovereign-hand watchman + market pulse ══════════════════ */

/**
 * stageOrders — the signing queue's watchman: a pending order nobody decided
 * on dies honestly after its TTL. The heart NEVER signs — the vault signs
 * only on an explicit operator decision (SOVEREIGN-HAND contract).
 */
async function stageOrders(p: HeartPulse): Promise<void> {
  const expired = await expireStaleOrders();
  p.counters.ordersExpired += expired;
  p.loops.orders = { lastAt: new Date().toISOString(), ok: true, fired: expired };
}

const PRICE_WATCH_KEY = "pricewatch";
const PRICE_MOVE_PCT = 0.03; // a ≥3% move against the last NOTIFIED price is worth waking the fleet
const PRICE_NOTIFY_COOLDOWN_MS = 30 * 60_000; // at most one market alarm per 30min
const PRICE_WATCH_EVERY_BEATS = 6; // every 6th beat ≈ 2min — one cheap failover read

interface PriceWatchState { last: number; lastAt: string; notifiedAt?: string; notifiedPrice?: number }

/**
 * stageMarket — the network REACTS to the real market: every 6th beat the
 * heart reads the live DEX ticker (cheap, failover client) and keeps a
 * watermark. A ≥3% move (vs the last notified price, cooldown-bounded) emits
 * a `market.move` event — the existing trigger machinery wakes the agents
 * armed with market.watch. A probe failure is recorded, never crashes a beat.
 */
async function stageMarket(p: HeartPulse): Promise<void> {
  const loops = () => ({ lastAt: new Date().toISOString(), ok: true, fired: 0 });
  if (p.beats % PRICE_WATCH_EVERY_BEATS !== 0) {
    if (!p.loops.market) p.loops.market = loops();
    return;
  }
  let row = await db.gateState.findUnique({ where: { key: PRICE_WATCH_KEY } });
  let st: PriceWatchState = { last: 0, lastAt: "" };
  try { if (row) st = { ...st, ...(JSON.parse(row.value) as PriceWatchState) }; } catch { /* fresh */ }
  try {
    const t = await steemMarket().ticker();
    const price = Number(t.latest);
    if (!Number.isFinite(price) || price <= 0) {
      p.loops.market = { lastAt: new Date().toISOString(), ok: false, fired: 0 };
      return;
    }
    const prev = st.last;
    const movedPct = prev > 0 ? Math.abs(price - prev) / prev : 0;
    const notifiedAgo = st.notifiedAt ? Date.now() - Date.parse(st.notifiedAt) : Infinity;
    if (prev > 0 && movedPct >= PRICE_MOVE_PCT && notifiedAgo >= PRICE_NOTIFY_COOLDOWN_MS) {
      const pct = Math.round(movedPct * 1000) / 10;
      const { emitEvent } = await import("./events");
      await emitEvent("market.move", { price, prev, pct, direction: price > prev ? "up" : "down" }, "heart");
      await db.gateMessage.create({
        data: {
          channel: "command",
          fromKind: "system",
          fromName: "harness",
          body: `${price > prev ? "📈" : "📉"} תזוזת-שוק ${pct}%: STEEM ${prev.toFixed(4)} → ${price.toFixed(4)} SBD — אירוע market.move נפלט, הצי החמוש ב-market.watch עשוי לקום`,
          meta: "{}",
        },
      }).catch(() => {});
      st.notifiedAt = new Date().toISOString();
      st.notifiedPrice = price;
      p.counters.marketMoves++;
      p.loops.market = { lastAt: new Date().toISOString(), ok: true, fired: 1 };
    } else {
      p.loops.market = loops();
    }
    st.last = price;
    st.lastAt = new Date().toISOString();
    await db.gateState.upsert({
      where: { key: PRICE_WATCH_KEY },
      create: { key: PRICE_WATCH_KEY, value: JSON.stringify(st) },
      update: { value: JSON.stringify(st) },
    });
  } catch {
    p.loops.market = { lastAt: new Date().toISOString(), ok: false, fired: 0 };
  }
}

async function readAutonomyEnabled(): Promise<boolean> {
  const cfg = await db.gateConfig.findUnique({ where: { id: "gate" }, select: { autonomyEnabled: true } });
  return cfg?.autonomyEnabled !== false; // default-on; only an explicit OFF stops the fleet
}

async function writePulse(p: HeartPulse): Promise<void> {
  const value = JSON.stringify(p);
  await db.gateState.upsert({
    where: { key: PULSE_KEY },
    create: { key: PULSE_KEY, value },
    update: { value },
  });
}

export async function readPulse(): Promise<HeartPulse | null> {
  const row = await db.gateState.findUnique({ where: { key: PULSE_KEY } });
  if (!row) return null;
  try { return JSON.parse(row.value) as HeartPulse; } catch { return null; }
}

/* ══════════════════ the beat ══════════════════ */

export async function tickOnce(): Promise<HeartPulse> {
  const g = (globalThis as typeof globalThis & { __gatePulse?: HeartPulse }).__gatePulse;
  let p: HeartPulse = g || {
    startedAt: new Date().toISOString(),
    lastTickAt: "",
    beats: 0,
    enabled: true,
    counters: { dispatched: 0, reaped: 0, recovered: 0, schedulesFired: 0, schedulesDeferred: 0, triggersFired: 0, proposalsFired: 0, eventsSeen: 0, ordersExpired: 0, marketMoves: 0, idleFired: 0 },
    loops: {},
  };
  if (!g) {
    // process (re)boot — carry the CUMULATIVE counters forward from the last pulse
    // record so efficiency stays honest across restarts (beats stay process-local)
    try {
      const prev = await readPulse();
      if (prev?.counters) p.counters = { ...p.counters, ...prev.counters };
      if (prev?.startedAt) p.startedAt = prev.startedAt;
    } catch { /* fresh start is acceptable */ }
    // ROAST r8 — live code identity (process-local, never carried across boots):
    // the operator must always be able to answer "WHICH code is the running
    // heart executing?" — the mute failures at 14:08/14:10Z happened because
    // nothing could answer that question.
    let codeSha = "unknown";
    try { codeSha = execSync("git rev-parse --short HEAD", { cwd: process.cwd(), timeout: 4_000 }).toString().trim() || "unknown"; } catch { /* sandbox without git — stamp stays "unknown" */ }
    p.boot = { pid: process.pid, bootedAt: new Date().toISOString(), codeSha };
  }
  p.lastTickAt = new Date().toISOString();
  p.beats++;
  try {
    p.enabled = await readAutonomyEnabled();
    if (p.enabled) {
      await ensureTriggerPolicy().catch((e) => { console.error("[heart] ensureTriggerPolicy failed:", e?.message ?? e); /* policy sync must never stall the beat */ });
      const stages: [string, () => Promise<void>][] = [
        ["reaper", () => stageReap(p)],
        ["hygiene", () => stageDeviceHygiene(p)],
        ["scheduler", () => stageSchedules(p)],
        ["triggers", () => stageTriggers(p)],
        ["initiative", () => stageProposals(p)],
        ["orders", () => stageOrders(p)],
        ["market", () => stageMarket(p)],
        ["idleCraft", () => stageIdle(p)],
        ["dispatch", () => stageDispatch(p)],
      ];
      for (const [name, fn] of stages) {
        if (!p.loops[name]) p.loops[name] = { lastAt: "", ok: true };
        try {
          await fn();
        } catch (e) {
          p.loops[name] = { lastAt: new Date().toISOString(), ok: false };
          p.error = `${name}: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
    }
  } catch (e) {
    p.error = e instanceof Error ? e.message : String(e);
  }
  (globalThis as typeof globalThis & { __gatePulse?: HeartPulse }).__gatePulse = p;
  await writePulse(p).catch(() => {});
  return p;
}

/* ══════════════════ policy seeding — self-healing, idempotent ══════════════════ */

let seeded = false;

async function armedAgentsList() {
  return db.gateAgent.findMany({
    where: { active: true, autonomy: true, modules: { not: null } },
    orderBy: { createdAt: "asc" },
  }).then((rows) => rows.filter((a) => { try { return (JSON.parse(a.modules || "[]") as string[]).length > 0; } catch { return false; } }));
}

/**
 * Trigger policy re-syncs EVERY beat: an agent armed later gets its mention
 * trigger automatically, so the nervous system never loses an ear. Cheap
 * (one findMany) and bounded (creates only what's missing).
 */
async function ensureTriggerPolicy(): Promise<void> {
  const armed = await armedAgentsList();
  if (!armed.length) return;
  /* ── ARSENAL SYNC — every beat, idempotent, self-healing ──
   * Live roast finding (2026-09-10): all 5 agents were still armed with the
   * ORIGINAL 24 modules while the arsenal grew to 30 — the daily editor/
   * treasurer duties told agents to use tools (steem.edit, social.audit,
   * steem.trends, steem.rewards, steem.claim) that were NEVER in their hands:
   * doctrine on paper, hands that can't reach it. Now the arsenal is a
   * fleet-wide right: any module registered later auto-reaches every active
   * agent on the next beat. Cheap (5 rows × 30 ids) and honest by design. */
  const allIds = MODULES.map((m) => m.id);
  for (const a of await db.gateAgent.findMany({ where: { active: true }, select: { id: true, modules: true } })) {
    let cur: string[] = [];
    try { cur = JSON.parse(a.modules || "[]"); if (!Array.isArray(cur)) cur = []; } catch { cur = []; }
    const missing = allIds.filter((id) => !cur.includes(id));
    if (missing.length) {
      await db.gateAgent
        .update({ where: { id: a.id }, data: { modules: JSON.stringify([...cur, ...missing]) } })
        .catch(() => {});
    }
  }
  /* ── builder/guardian cadence — the fleet doesn't just patrol, it BUILDS ──
   * One daily builder goal per armed agent: pick ONE real improvement and
   * execute it (publish value to the chain via steem.post, write a proven
   * fact to fleet memory, propose a goal, or prepare a DEX order) — plus one
   * daily guardian sweep (vault + networks + fleet security, honest report).
   * Re-synced every beat like the triggers: created only when missing,
   * staggered hourUtc so the fleet never fires in a stampede. */
  const builderLabels = new Set(
    (await db.gateSchedule.findMany({ where: { label: { startsWith: "builder:" } }, select: { agentName: true } })).map((s) => s.agentName),
  );
  const guardianLabels = new Set(
    (await db.gateSchedule.findMany({ where: { label: { startsWith: "guardian:" } }, select: { agentName: true } })).map((s) => s.agentName),
  );
  const builderMeans = JSON.stringify([
    "פעולה אמיתית אחת לפחות בוצעה והוכחה בראיה: פרסום חי (steem.post עם txId), או memory.write עם ממצא מנומק, או goal.propose מוצדק, או הצעת-פקודת DEX (steem.order.build)",
    "דוח עברית נשלח לגשר-הפיקוד עם הראיה",
  ]);
  const guardianMeans = JSON.stringify([
    "vault.verify או net.health הוחזרו חי, וכל חריגה נבדקה",
    "fleet.status חי — מי מחובר, מי נופל מ-RC",
    "דוח אבטחה כן בעברית לגשר (או ״הכל תקין״ עם המספרים)",
  ]);
  for (let idx = 0; idx < armed.length; idx++) {
    const a = armed[idx];
    if (!builderLabels.has(a.name)) {
      await db.gateSchedule.create({
        data: {
          label: `builder:${a.name}`,
          agentName: a.name,
          goal:
            "תור-הבונה היומי: בחר שיפור אמיתי אחד לרשת ובצע אותו מקצה-לקצה — הערך הגבוה ביותר קודם: (1) פרסם לשרשרת תוכן בעל-ערך (steem.post — דוח/ממצא/ניתוח), או (2) רשום ממצא מוכח חדש לזיכרון-הצי (memory.write), או (3) הצע יעד מוצדק (goal.propose), או (4) הכן הצעת-פקודת DEX מושכלת (steem.order.build — רחוקה מהספר, ממתינה לאישור-מפעיל). בצע אחד היטב — לא ארבעה במקרה.",
          doneMeans: builderMeans,
          budget: 6,
          kind: "daily",
          hourUtc: 8 + (idx % 12), // staggered — the fleet builds across the whole day
          maxPerDay: 1,
        },
      });
    }
    if (!guardianLabels.has(a.name)) {
      await db.gateSchedule.create({
        data: {
          label: `guardian:${a.name}`,
          agentName: a.name,
          goal:
            "סיור-שומר יומי: vault.verify (או vault.stats אם הכספת נעולה), net.health, fleet.status — ודווח דוח-אבטחה כן לגשר: מה חי, מה חריג, מה דורש תשומת-לב. אתה המשגיח-הריבוני של הרשת היום.",
          doneMeans: guardianMeans,
          budget: 5,
          kind: "daily",
          hourUtc: 20 + (idx % 4), // evening sweep — covers the day's drift
          maxPerDay: 1,
        },
      });
    }
  }
  /* ── PUBLISH-DESK v2 — the exposure policy reaches the EXISTING schedules ──
   * Live finding (2026-09-10): the fleet published internal protocol specs,
   * fleet reports and infrastructure details to the public chain — 5
   * near-duplicate posts on one account. Builder goals older than the
   * policy are REFRESHED in place (marker-based, idempotent): publishing is
   * now exposure-gated, audit-first, duplicate-aware. */
  const POLICY_MARKER = "מדיניות-חשיפה";
  const LANG_MARKER = "ניתוב-שפה";
  const builderV3 =
    "תור-הבונה היומי (v3): בחר שיפור אמיתי אחד לרשת ובצע אותו מקצה-לקצה. " +
    "steem.trends — מכ\"ם-נושאים חי: ראה מה הרשת קוראת עכשיו (תגיות לפי תשלום, דיונים חמים) ובחר נושא שיש עליו ביקוש אמיתי. " +
    "ניתוב-שפה: כל תוכן שיוצא החוצה (פוסטים, תגובות) נכתב באנגלית — הקהל ברשת דובר-אנגלית; עברית נשארת בפנים בלבד (דוחות לגשר, זיכרון). " +
    "לפני כל פרסום: social.audit — מה כבר פורסם ומה מדוגל; אל תשכפל תוכן קיים (תוכן כפול פוגע בחשבון וב-SEO). " +
    "מדיניות-חשיפה מוכתבת: אסור לפרסם סודות, מפתחות, נתיבים/תשתית, שמות-קוד פנימיים, תוכניות-מוצר שלא יצאו לאור ודוחות מבצעיים — הקלפים נשארים בבית; " +
    "טיוטה חשופה תיחסם על-ידי השער — אל תנסה לעקוף, תקן והגש שוב. " +
    "בחר אחת: (1) פרסום ערך ציבורי נקי באנגלית (steem.post — rail=steem או rail=hive), (2) תיקון פוסט מדוגל (steem.edit לפי social.audit), " +
    "(3) memory.write עם ממצא מוכח, (4) goal.propose מוצדק. אחד היטב — לא ארבעה במקרה.";
  const staleBuilders = await db.gateSchedule.findMany({
    where: { label: { startsWith: "builder:" }, goal: { not: { contains: LANG_MARKER } } },
    select: { id: true },
  });
  for (const s of staleBuilders) {
    await db.gateSchedule.update({ where: { id: s.id }, data: { goal: builderV3 } }).catch(() => {});
  }
  /* ── the editor — one daily AUDIT+REMEDIATE duty, single-lane ──
   * roast-2026-09-10: v3 gave the editor 4 jobs and 6 modules — EVERY editor
   * run ended blocked (the maker burned its budget in analysis loops and
   * never posted). The proven recipe from the live E2E runs: FEW modules,
   * ONE lane, action every step. The editor audits and remediates; the
   * PUBLISHING lane belongs to the builders (no new posts here). */
  const editorLabels = new Set(
    (await db.gateSchedule.findMany({ where: { label: { startsWith: "editor:" } }, select: { agentName: true } })).map((s) => s.agentName),
  );
  const editorMeans = JSON.stringify([
    "social.audit חי נקרא (מספר פוסטים + מדוגלים) — ראייה: צעד social.audit עם ok=true",
    "לכל פוסט מדוגל: steem.edit בוצע עם כותרת+גוף+תגיות באנגלית נקייה ו-txId אמיתי — או נימוק כן מדוע לא נתוקן; אם אין מדוגלים בכלל — זו הצלחה מלאה, לא כשל",
    "דוח עברית קצר לגשר-הפיקוד עם ה-permlinks וה-txIds",
  ]);
  const EDITOR_V4_MARKER = "מסלול-יחיד";
  const editorV4 =
    "תור-העורך היומי (v4, מסלול-יחיד): אתה הדובר של הרשת — פעולה אחת בכל צעד, אין לולאות-ניתוח. " +
    "(1) social.audit — סרוק את הפיד החי של החשבונות על steem ו-hive. " +
    "(2) לכל פוסט מדוגל (עברית/סודות/שמות-קוד/דוחות-פנימיים/הזמנת-השקעה): steem.edit — כותרת+גוף+תגיות מוחלפים באנגלית ציבורית נקייה " +
    "(ניתוב-שפה: אנגלית החוצה; עברית נשארת בפנים; פוסט-תיקון מסביר באנגלית שהתוכן הקודם הוחלף ושהעדכונים הציבוריים ממשיכים כאן). " +
    "אם עריכת-hive נחסמת על ידי תקציב-משאבים של השרשרת — תעד זאת בכנות ועבור הלאה. " +
    "(3) chat.report — דוח עברית: מה סרקת, מה תיקנת (permlinks+txIds), מה נותר ולמה. " +
    "אין פרסום-חדש בתור-העורך — הבונים מפרסמים. אל תקרא מודול פעמיים עם אותם ארגומנטים.";
  const EDITOR_MODULES_V4 = ["social.audit", "steem.edit", "chat.report"];
  const staleEditors = await db.gateSchedule.findMany({
    where: { label: { startsWith: "editor:" }, OR: [{ goal: { not: { contains: EDITOR_V4_MARKER } } }, { modules: null }] },
    select: { id: true },
  });
  for (const s of staleEditors) {
    await db.gateSchedule
      .update({ where: { id: s.id }, data: { goal: editorV4, doneMeans: editorMeans, modules: JSON.stringify(EDITOR_MODULES_V4) } })
      .catch((e) => { console.error("[heart] editor refresh failed:", e?.message ?? e); });
  }
  if (armed.length && !editorLabels.has(armed[0].name)) {
    await db.gateSchedule.create({
      data: {
        label: `editor:${armed[0].name}`,
        agentName: armed[0].name,
        goal: editorV4,
        doneMeans: editorMeans,
        modules: JSON.stringify(EDITOR_MODULES_V4), // defense-in-depth: the duty carries its own hands
        budget: 8,
        kind: "daily",
        hourUtc: 13, // 16:00 Israel — prime publishing hours
        maxPerDay: 1,
      },
    });
  }
  /* ── the treasurer — one daily REWARDS duty, full autonomy ──
   * The fleet must harvest what it EARNED: pending rewards sit stuck in the
   * wallet until a signed claim_reward_balance moves them (the exact reason
   * "יש תגמול בארנק ואי אפשר לממש אותו"). Census first, claim per account
   * with live pending, honest report. Bounded 1/day. */
  const treasurerLabels = new Set(
    (await db.gateSchedule.findMany({ where: { label: { startsWith: "treasurer:" } }, select: { agentName: true } })).map((s) => s.agentName),
  );
  const treasurerMeans = JSON.stringify([
    "steem.rewards חי נקרא — הסקר החוזר על כל הצי (כמה חשבונות, כמה ממתין בכל אחד) — ראייה: צעד steem.rewards עם ok=true",
    "לכל חשבון עם ממתינים ומפתח בכספת: steem.claim בוצע עם txId אמיתי — או נימוק כן מדוע לא (אין מפתח / אין ממתינים). שים-לב, בודק: אם אין ממתינים בכלל — זו הצלחה מלאה, לא כשל; הדוח עם מספרי-היתרות הוא הראיה",
    "דוח עברית קצר לגשר-הפיקוד: סה״כ נקצר היום + txIds, ומה נשאר תקוע ולמה",
  ]);
  const TREASURER_MARKER = "זו הצלחה מלאה";
  const staleTreasurers = await db.gateSchedule.findMany({
    where: { label: { startsWith: "treasurer:" }, OR: [{ doneMeans: { not: { contains: TREASURER_MARKER } } }, { goal: { not: { contains: "סקר-צי שלם" } } }] },
    select: { id: true },
  });
  for (const s of staleTreasurers) {
    await db.gateSchedule
      .update({
        where: { id: s.id },
        data: {
          doneMeans: treasurerMeans,
          modules: JSON.stringify(["steem.rewards", "steem.claim", "chat.report"]),
          // roast-2026-09-10: the live gap was "steem.rewards called without
          // account list" — the census module needs NO arguments; it reads the
          // fleet itself. The goal now says so explicitly (single-lane).
          goal:
            "תור-הגזבר היומי (v2, מסלול-יחיד): אתה האוצר של הרשת היום — פעולה אחת בכל צעד. " +
            "(1) steem.rewards עם ארגומנטים ריקים {} — זהו סקר-צי שלם: המודול קורא בעצמו את כל החשבונות ומחזיר מי עם ממתינים; אין להזין רשימות חשבונות. " +
            "(2) לכל חשבון שהסקר החזיר עם ממתינים: steem.claim עם פרטי הממתינים כפי שהמודול החזיר (בלי להמציא סכומים). " +
            "(3) chat.report — דוח עברית: יתרות, מה נקצר (txIds), או 'אין ממתינים — הצלחה מלאה'. " +
            "הערה-מדיניות: תביעה מזיזה תגמול ליתרות בפועל — היא לא מוכרת ולא מזיזה כספים בין חשבונות (זו סמכות-active, לא שלך).",
        },
      })
      .catch((e) => { console.error("[heart] treasurer refresh failed:", e?.message ?? e); });
  }
  if (armed.length && !treasurerLabels.has(armed[0].name)) {
    await db.gateSchedule.create({
      data: {
        label: `treasurer:${armed[0].name}`,
        agentName: armed[0].name,
        goal:
          "תור-הגזבר היומי: אתה האוצר של הרשת היום. (1) steem.rewards — סקר חי של התגמולים הממתינים בכל חשבונות-הצי. " +
          "(2) לכל חשבון שיש לו תגמולים ממתינים ומפתח-posting בכספת — בצע steem.claim (החשבון המבוקש בפרמטר account); " +
          "אל תנסה חשבון שאין לו מפתח או שאין לו ממתינים — קבל את התשובה הכנה ועבור הלאה. " +
          "(3) דווח לגשר בעברית: כמה נקצר (STEEM/SBD/VESTS לכל חשבון), ה-txIds, ומה נשאר. " +
          "הערה-מדיניות: תביעה מזיזה את התגמול ליתרות בפועל — היא לא מוכרת ולא מזיזה כספים בין חשבונות (זו סמכות-active, לא שלך).",
        doneMeans: treasurerMeans,
        modules: JSON.stringify(["steem.rewards", "steem.claim", "chat.report"]), // defense-in-depth: the duty carries its own hands
        budget: 7,
        kind: "daily",
        hourUtc: 5, // early sweep — the day's earnings from yesterday get harvested first
        maxPerDay: 1,
      },
    });
  }
  /* ── the anchor-watch — one daily SEAL/VERIFY duty (r20) ──
   * The fleet's newest sovereign employment: check the multi-rail anchor
   * (steem+hive+blurt, r20 plane) and seal again ONLY on drift — bounded by
   * the module's own 1/day cap. The seal is the fleet's act; the drift
   * decision belongs to the measurement, never to enthusiasm. */
  const anchorWatchLabels = new Set(
    (await db.gateSchedule.findMany({ where: { label: { startsWith: "anchor-watch:" } }, select: { agentName: true } })).map((s) => s.agentName),
  );
  const anchorWatchMeans = JSON.stringify([
    "anchor.integrity חי נקרא — כל המסילות נבדקו, עוגן-חי/כשל-כן לכל-אחת (ראייה: צעד anchor.integrity עם ok=true)",
    "רק אם drift=true: anchor.seal בוצע והעוגן החדש חי על השרשרת — או תשובה כנה (תקרה-יומית / כספת-נעולה); אין סטייה? אין שידור — זו הצלחה מלאה",
    "דוח עברית קצר לגשר-הפיקוד: מה חי, אחדות-דיגסט/סטייה, מה נחתם",
  ]);
  if (armed.some((a) => a.name === "anchor-agent") && !anchorWatchLabels.has("anchor-agent")) {
    await db.gateSchedule.create({
      data: {
        label: "anchor-watch:anchor-agent",
        agentName: "anchor-agent",
        goal:
          "תור-שומר-העוגן היומי (r20, מסלול-יחיד): אתה שומר-ההאטימה של הרשת — פעולה אחת בכל צעד. " +
          "(1) anchor.integrity — אמת-חי של העוגנים בכל המסילות + אחדות-דיגסט בין-המסילות + סטייה מהדיגסט-הנוכחי. " +
          "(2) רק אם drift=true: anchor.seal — איטום-חדש; התקרה-היומית של המודול תאכוף את עצמה. אין סטייה? אין שידור — זו הצלחה המלאה, לא כשל. " +
          "(3) chat.report — דוח עברית קצר: מה חי על כל מסילה, אחדות/סטייה, מה נחתם (txIds). אל תקרא מודול פעמיים עם אותם ארגומנטים.",
        doneMeans: anchorWatchMeans,
        modules: JSON.stringify(["anchor.integrity", "anchor.seal", "chat.report"]), // defense-in-depth: the duty carries its own hands
        budget: 4,
        kind: "daily",
        hourUtc: 21, // 00:00 Israel — the custody day closes with a seal check
        maxPerDay: 1,
      },
    });
  }
  const existing = await db.gateTrigger.findMany({ where: { on: "message.mentions" }, select: { agentName: true } });
  const have = new Set(existing.map((t) => t.agentName));
  const mentionMeans = JSON.stringify([
    "הבקשה של המפעיל בוצעה והוכחה בכלי-עבודה אמיתי (ראיות בעקבות)",
    "דוח עברית נשלח לגשר-הפיקוד",
  ]);
  for (const a of armed) {
    if (!have.has(a.name)) {
      await db.gateTrigger.create({
        data: {
          on: "message.mentions",
          agentName: a.name,
          goalTemplate: "{body}",
          doneMeans: mentionMeans,
          budget: 5,
          cooldownMs: 120_000,
          maxPerDay: 12,
        },
      });
    }
  }
  // the blocked-run repair chase must always exist — bounded self-improvement
  const blockedExists = await db.gateTrigger.count({ where: { on: "run.blocked" } });
  if (!blockedExists) {
    const repairMeans = JSON.stringify([
      "כל פער שדווח נסגר עם ראיה מכלי-עבודה, או הוסבר בכנות בדוח מדוע אינו ניתן לסגירה",
      "דוח עברית נשלח לגשר-הפיקוד",
    ]);
    await db.gateTrigger.create({
      data: {
        on: "run.blocked",
        agentName: "@self",
        goalTemplate: "הריצה הקודמת שלך נחסמה על-ידי הבודק העצמאי. המטרה המקורית: {goal}. הפערים שנותרו: {gaps}. סגור את הפערים עם ראיות-כלים אמיתיות — או דווח בכנות למה אי אפשר.",
        doneMeans: repairMeans,
        budget: 4,
        cooldownMs: 300_000,
        maxPerDay: 2,
      },
    });
  }
  // market-reactive autonomy: an agent armed with market.watch hears the
  // heart's market.move alarm — bounded (cooldown 30min is enforced by the
  // emitter itself; the trigger adds its own daily cap on top)
  const marketArmed = armed.filter((a) => {
    try { return (JSON.parse(a.modules || "[]") as string[]).includes("market.watch"); } catch { return false; }
  });
  const marketExisting = await db.gateTrigger.findMany({ where: { on: "market.move" }, select: { agentName: true } });
  const marketHave = new Set(marketExisting.map((t) => t.agentName));
  const marketMeans = JSON.stringify([
    "מחיר-השוק החי נקרא מה-DEX (market.watch) והושווה למחיר שהדליק את האזעקה",
    "מסקנה מעשית אחת (או ״אין פעולה משתלמת״) נשלחה לגשר בעברית",
  ]);
  for (const a of marketArmed) {
    if (!marketHave.has(a.name)) {
      await db.gateTrigger.create({
        data: {
          on: "market.move",
          agentName: a.name,
          goalTemplate: "אזעקת-שוק: המחיר זז ב-{pct}% ({prev} → {price} SBD ל-STEEM). קרא את השוק החי (market.watch) ואת ההזמנות-הפתוחות, והחלט אם יש פעולה משתלמת — דווח מסקנה אחת לגשר.",
          doneMeans: marketMeans,
          budget: 4,
          cooldownMs: 900_000,
          maxPerDay: 4,
        },
      });
    }
  }
}

async function seedDefaults(): Promise<void> {
  if (seeded) return;
  const armed = await armedAgentsList();
  if (!armed.length) return; // no armed fleet yet — retry next tick
  await ensureTriggerPolicy();
  const scheduleCount = await db.gateSchedule.count();
  if (scheduleCount === 0) {
    // ROAST r5: the patrol's old contract was self-contradictory — the goal
    // demanded "one bare line" while doneMeans demanded "real data", so the
    // checker flip-flopped on identical runs (06:52 done vs 06:21 blocked).
    // The report must now CARRY the two live numbers — self-evident proof,
    // nothing left for the checker to judge by taste.
    const patrolMeans = JSON.stringify([
      "הדוח לגשר כולל את ספירת-הסודות האמיתית כפי שהוחזרה ב-trace של vault.stats",
      "הדוח לגשר כולל מספר-בלוק חי כפי שהוחזר ב-trace של chain.steem",
      "דוח עברית נשלח לגשר-הפיקוד",
    ]);
    const first = armed[0];
    await db.gateSchedule.create({
      data: {
        label: "סיור-שער תקופתי",
        agentName: first.name,
        goal: "סיור אוטונומי של השער: (1) vault.stats — מצב השער; (2) chain.steem — בריאות השרשרת. דווח לגשר בעברית בשורה-אחת קומפקטית שחייבת לכלול את שני המספרים-החיים מה-trace: ספירת-הסודות מ-vault.stats ומספר-הבלוק החי מ-chain.steem. בלי המספרים — הדוח לא נחשב.",
        doneMeans: patrolMeans,
        budget: 4,
        kind: "interval",
        everyMs: 30 * 60_000,
        maxPerDay: 24,
        nextRunAt: new Date(Date.now() + 60_000),
      },
    });
    await db.gateSchedule.create({
      data: {
        label: "סקירה-יומית של הצי",
        agentName: first.name,
        goal: "סקירה יומית: אמת את מצב השער (vault.stats) ואת בריאות השרשרת (chain.steem health), וכתוב לגשר דוח עברית קצר: מה חי, מה נכשל, מה שווה עין המפעיל היום.",
        doneMeans: patrolMeans,
        budget: 5,
        kind: "daily",
        hourUtc: 6, // 09:00 Israel (UTC+3)
        maxPerDay: 1,
        nextRunAt: nextDaily(6),
      },
    });
  }
  seeded = true;
}

function nextDaily(hourUtc: number): Date {
  const d = new Date();
  d.setUTCHours(hourUtc, 0, 0, 0);
  if (d.getTime() <= Date.now()) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/* ══════════════════ boot — globalThis-pinned singleton ══════════════════ */

export function startHeart(): void {
  const g = globalThis as typeof globalThis & { __gateHeart?: ReturnType<typeof setInterval> };
  if (g.__gateHeart) return; // HMR / double-register guard
  g.__gateHeart = setInterval(() => {
    void tickOnce().catch(() => { /* fail-closed: the next beat tries again */ });
  }, HEART_TICK_MS);
  // first beat ASAP + policy seeding (idempotent)
  void Promise.resolve()
    .then(() => seedDefaults())
    .then(() => tickOnce())
    .catch(() => {});
}

export const HEART_CONSTANTS = {
  HEART_TICK_MS,
  LEASE_MS,
  MAX_CONCURRENT_RUNS,
  MAX_DISPATCH_PER_TICK,
};
