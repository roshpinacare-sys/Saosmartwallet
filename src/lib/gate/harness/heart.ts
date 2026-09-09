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
import { db } from "@/lib/db";
import { masterReady } from "@/lib/gate/crypto";
import { processRun, buildLessons } from "./loop";
import { parseBrain, pickCheckerBrain } from "./brain";
import { workerId, claimRun, LEASE_MS } from "./lease";

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
  counters: { dispatched: number; reaped: number; recovered: number; schedulesFired: number; schedulesDeferred: number; triggersFired: number; proposalsFired: number; eventsSeen: number };
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
  origin: "schedule" | "trigger" | "proposal";
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
  if (parsed.provider === "nvidia" && !masterReady()) {
    brain = "zai:default";
    meta.brainNote = "הכספת חתומה — המוח הוחלף ל-zai (מפתח-NIM חתום בכספת, לא נחשף)";
  }

  const brainStr = `${parsed.provider}:${parsed.model}`;
  const run = await db.gateRun.create({
    data: {
      agentName: agent.name,
      goal: opts.goal.slice(0, 600),
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
  const originIcon = opts.origin === "schedule" ? "⏰" : opts.origin === "proposal" ? "💡" : "⚡";
  const originText = opts.origin === "schedule" ? "סיור מתוכנן" : opts.origin === "proposal" ? "יוזמת-יעד" : "טריגר אירוע";
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
  // runs that keep dying: past their last allowed attempt → honest failure
  const exhausted = await db.gateRun.updateMany({
    where: { status: "queued", attempt: { gte: 2 }, maxAttempts: { lte: 2 } },
    data: {
      status: "failed",
      error: "watchdog: הרצה קרסה יותר מדי פעמים — הוחזרה לתור ונכשלה בכנות",
      finishedAt: now,
    },
  });
  p.counters.reaped += reaped.count;
  if (reaped.count || exhausted.count) {
    p.loops.reaper = { lastAt: now.toISOString(), ok: true, fired: reaped.count };
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

async function stageSchedules(p: HeartPulse): Promise<void> {
  const now = Date.now();
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
      if (count >= s.maxPerDay) {
        // cap reached — honestly push to tomorrow-ish (next interval), no silent lies
        await db.gateSchedule.update({
          where: { id: s.id },
          data: { nextRunAt: new Date(now + (s.kind === "daily" ? DAY_MS : Math.max(s.everyMs || MIN_SCHEDULE_EVERY_MS, MIN_SCHEDULE_EVERY_MS))), dayKey: dk, dayCount: count },
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
    } catch {
      // a broken schedule must not stall the fleet — push it one cadence away
      await db.gateSchedule.update({
        where: { id: s.id },
        data: { nextRunAt: new Date(now + Math.max(s.everyMs || MIN_SCHEDULE_EVERY_MS, MIN_SCHEDULE_EVERY_MS)) },
      }).catch(() => {});
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
    : await db.gateProposal.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" }, take: 3 });
  const cand = pend.find((x) => x.budget <= policy.maxBudget);
  if (!cand) {
    p.loops.initiative = loops();
    return;
  }
  try {
    const agent = await db.gateAgent.findFirst({ where: { name: cand.agentName, active: true, autonomy: true } });
    if (!agent) {
      await db.gateProposal.update({ where: { id: cand.id }, data: { status: "expired", decidedBy: "policy", decidedAt: new Date() } });
      p.loops.initiative = loops();
      return;
    }
    const busy = await db.gateRun.count({ where: { agentName: cand.agentName, status: { in: ["queued", "running"] } } });
    if (busy > 0) {
      p.loops.initiative = loops(); // idle-only — never stack a proposal on a working agent
      return;
    }
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
    // a broken proposal is rejected honestly, not retried forever
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
    counters: { dispatched: 0, reaped: 0, recovered: 0, schedulesFired: 0, schedulesDeferred: 0, triggersFired: 0, proposalsFired: 0, eventsSeen: 0 },
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
  }
  p.lastTickAt = new Date().toISOString();
  p.beats++;
  try {
    p.enabled = await readAutonomyEnabled();
    if (p.enabled) {
      await ensureTriggerPolicy().catch(() => { /* policy sync must never stall the beat */ });
      const stages: [string, () => Promise<void>][] = [
        ["reaper", () => stageReap(p)],
        ["scheduler", () => stageSchedules(p)],
        ["triggers", () => stageTriggers(p)],
        ["initiative", () => stageProposals(p)],
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
}

async function seedDefaults(): Promise<void> {
  if (seeded) return;
  const armed = await armedAgentsList();
  if (!armed.length) return; // no armed fleet yet — retry next tick
  await ensureTriggerPolicy();
  const scheduleCount = await db.gateSchedule.count();
  if (scheduleCount === 0) {
    const patrolMeans = JSON.stringify([
      "vault.stats הוחזר עם נתונים אמיתיים מהשער",
      "chain.steem health/יתרות הוחזרו חי מהשרשרת",
      "דוח עברית נשלח לגשר-הפיקוד",
    ]);
    const first = armed[0];
    await db.gateSchedule.create({
      data: {
        label: "סיור-שער תקופתי",
        agentName: first.name,
        goal: "סיור אוטונומי של השער: בדוק את מצב השער (vault.stats), אמת שהשרשרת חיה (chain.steem health או יתרות headcorner), ודווח לגשר בעברית בקצרה. אם הכול תקין — שורה-אחת בלבד, אל תנפח.",
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
