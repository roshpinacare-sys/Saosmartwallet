/**
 * SOVEREIGN GATE — agent harness · loop (לולאת-המטרה, גרסה מחודדת).
 *
 * Course mapping (Lectures 13 · "loop engineering" + 8/9/11):
 *  · Goal-based loop    → goal + verification method + stopping condition.
 *  · Feature-list pass  → doneMeans[] is the explicit pass-gate: a run may
 *    only move to "done" when EVERY criterion passes WITH tool evidence
 *    recorded in the trace ("evidence of success is recorded").
 *  · Generator/evaluator separation → the maker brain never grades its own
 *    work; an independent checker brain (different provider/model) rules.
 *  · External state     → the loop's memory lives in GateRun (system of
 *    record), not in the context window; each step is persisted as it happens.
 *  · Leases + recovery  → every run is claimed with an atomic lease that is
 *    renewed after each persisted step; a crash stops the renewal, the heart's
 *    reaper returns the run to the queue, and the maker RESUMES from the
 *    persisted evidence trace instead of starting over (the trace IS the
 *    checkpoint — TITAI durable-engine pattern, made real).
 *  · Autonomy lineage   → runs carry origin (manual | schedule | trigger) and
 *    terminal states emit events the heart may consume into bounded follow-ups.
 *  · Cross-run memory   → lessons distilled from the agent's PAST runs are
 *    injected into the maker's first prompt and stored on the run row —
 *    the agent stops repeating yesterday's mistakes.
 *  · Critic loop        → after a "not proven" verdict, the checker's gaps
 *    go BACK to the maker for one bounded repair round, then a re-check.
 *    The pass-gate still rules — the maker never grades itself.
 *  · Budget hygiene     → a protocol-garbage reply costs the maker ZERO
 *    budget (one free corrective re-ask, max 2 per run); honest recovery
 *    is observable in the trace, budget stays the token-blowout guard.
 *  · Observability      → per-step wall-clock ms, total durationMs and real
 *    brain token usage recorded on the run — efficiency is measured, and
 *    unknown usage stays null (never faked).
 *  · Tool cache         → read-only modules memoize identical calls inside
 *    one run: no duplicate network hits, "cached" is visible in the trace.
 */
import { db } from "@/lib/db";
import { GateError } from "@/lib/gate/crypto";
import { brainChat, parseBrain, pickCheckerBrain, type ChatMsg } from "./brain";
import { getModule, modulesForPrompt, type ModuleCtx } from "./modules";
import { workerId, claimRun, stillMine, renewLease, LEASE_MS, LEASE_CLEAR } from "./lease";
import { emitEvent } from "./events";

export interface TraceStep {
  i: number;
  side: "maker" | "checker";
  thought?: string;
  tool?: string;
  args?: Record<string, unknown>;
  ok?: boolean;
  result?: unknown;
  error?: string;
  ms?: number; // wall-clock of this step (brain + tool) — real measurement
  cached?: boolean; // served from the run's tool cache (no duplicate network)
  rescued?: boolean; // protocol garbage re-asked for free — budget NOT burned
  repair?: boolean; // step executed inside the post-verdict repair round
  at: string;
}

export interface CheckerVerdict {
  done: boolean;
  checks: { criterion: string; pass: boolean; evidence: string }[];
  gaps: string;
  notes: string;
  rescues?: number; // r30: how many free protocol re-asks the checker needed
}

const MAX_BUDGET = 8;
const RESULT_CLAMP = 1400;
const FREE_RESQUE_LIMIT = 2; // protocol-garbage re-asks that cost zero budget
const REPAIR_STEPS = 2; // bounded critic-loop: gaps → maker → re-check

function clampResult(r: unknown): unknown {
  try {
    const s = JSON.stringify(r);
    if (s && s.length > RESULT_CLAMP) return { _clamped: true, head: s.slice(0, RESULT_CLAMP) + "…" };
    return r;
  } catch {
    return String(r);
  }
}

/** Robust JSON extraction — models occasionally wrap JSON in prose/fences. */
function extractJson<T>(raw: string): T {
  const t = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(t) as T;
  } catch { /* fall through */ }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1)) as T;
    } catch { /* fall through */ }
  }
  throw new GateError("bad-brain-json", "המוח לא החזיר JSON תקין");
}

function makerSystemPrompt(goal: string, doneMeans: string[], modules: string[], lessons: string[] = [], fleetFacts: string[] = []): string {
  const lines = [
    "You are the MAKER inside a goal-loop harness (SAOS SOVEREIGN GATE).",
    "You act ONLY through tools; you NEVER claim a result without a tool observation proving it.",
    "",
    "GOAL: " + goal,
    "DONE-MEANS (the pass-gate — every line must be proven):",
    ...doneMeans.map((d, i) => `${i + 1}. ${d}`),
    "",
    "YOUR MODULES:",
    modulesForPrompt(modules) || "(none armed — report that honestly)",
  ];
  if (fleetFacts.length) {
    lines.push(
      "",
      "FLEET MEMORY — what the fleet ALREADY proved (final findings; do NOT re-research these, use memory.read for the full bank):",
      ...fleetFacts.slice(0, 3).map((f, i) => `${i + 1}. ${f}`),
    );
  }
  if (lessons.length) {
    lines.push(
      "",
      "LESSONS FROM YOUR PAST RUNS (external memory — do NOT repeat these mistakes):",
      ...lessons.slice(0, 5).map((l, i) => `${i + 1}. ${l}`),
    );
  }
  lines.push(
    "",
    "PROTOCOL — reply with ONLY compact JSON, no markdown, no prose:",
    '{"thought":"one sentence: what you know, what you still need","tool":"<module-id> | finish","args":{...}}',
    'When you believe the goal is met, use "finish" and put the Hebrew final report inside args.report.',
    "Rules: one tool call per turn · prefer vault.verify/chain.steem for hard evidence · keep failures in mind and adapt · never invent data — if a module errors, read the error and try differently.",
  );
  return lines.join("\n");
}

function checkerSystemPrompt(goal: string, doneMeans: string[]): string {
  return [
    "You are the CHECKER — an independent evaluator. You did NOT do the work and you are NOT on the maker's team.",
    '"Someone in your crew must not believe the maker." Verify, never assume.',
    "",
    "GOAL under evaluation: " + goal,
    "DONE-MEANS contract:",
    ...doneMeans.map((d, i) => `${i + 1}. ${d}`),
    "",
    "You receive the maker's evidence trace (tool calls + real observations).",
    "Grade ONLY against the trace: a criterion passes ONLY if a tool observation directly proves it.",
    "Reply with ONLY compact JSON:",
    '{"done":true|false,"checks":[{"criterion":"...","pass":true|false,"evidence":"quote the trace observation that proves it, or what is missing"}],"gaps":"what is still missing (empty if done)","notes":"one-line overall judgment"}',
  ].join("\n");
}

/** The error text of a failed step — r29: a failed step must NEVER render as
 * "ERROR: undefined". Live-caught pathology: the treasurer's claim SUCCEEDED
 * on-chain (real txId), the follow-up honest nothing-to-claim replies rendered
 * as "ERROR: undefined", and the checker graded a harvest as a failure. The
 * truth lives in s.error OR inside result.payload.error — both are read here. */
function stepErrorText(s: TraceStep): string {
  if (typeof s.error === "string" && s.error.trim()) return s.error;
  const r = s.result as { error?: unknown } | undefined;
  if (r && typeof r.error === "string" && r.error.trim()) return r.error;
  return "unknown error (no message recorded)";
}

function traceToTranscript(steps: TraceStep[]): string {
  return steps
    .map((s) => {
      if (s.side === "checker") return `[checker] done=${(s.result as CheckerVerdict | undefined)?.done} — gaps: ${(s.result as CheckerVerdict | undefined)?.gaps || "-"}`;
      const body = s.ok ? JSON.stringify(s.result) : `ERROR: ${stepErrorText(s)}`;
      return `[step ${s.i}] thought: ${s.thought || "-"}\n  → ${s.tool}(${JSON.stringify(s.args || {})})\n  ⇐ ${String(body).slice(0, 600)}`;
    })
    .join("\n");
}

/**
 * Smart ratchet for long loops: the last RECENT_FULL steps stay verbatim,
 * older ones are compacted (args dropped, results clamped) — the maker keeps
 * the thread of the story without mid-JSON truncation or prompt bloat.
 */
function ratchetedTranscript(steps: TraceStep[], recentFull = 2): string {
  if (steps.length <= recentFull) return traceToTranscript(steps);
  const older = steps.slice(0, steps.length - recentFull);
  const recent = steps.slice(-recentFull);
  const compact = older
    .map((s) => {
      if (s.side === "checker") return `[checker] done=${(s.result as CheckerVerdict | undefined)?.done}`;
      const body = s.ok ? JSON.stringify(s.result) : `ERROR: ${stepErrorText(s)}`;
      return `[step ${s.i}] ${s.tool} ⇐ ${String(body).slice(0, 240)}`;
    })
    .join("\n");
  return compact + "\n" + traceToTranscript(recent);
}

/**
 * Persist-and-continue helper — external state is written BEFORE the next step runs.
 * A live run renews its lease on every save (heartbeat); a terminal save clears it.
 */
async function saveRun(id: string, data: { status?: string; steps?: TraceStep[]; verdict?: CheckerVerdict | null; report?: string | null; error?: string | null; finishedAt?: Date | null; durationMs?: number | null; tokens?: { prompt: number; completion: number } | null }) {
  const terminal = data.status !== undefined && ["done", "blocked", "failed"].includes(data.status);
  await db.gateRun.update({
    where: { id },
    data: {
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.steps !== undefined ? { steps: JSON.stringify(data.steps) } : {}),
      ...(data.verdict !== undefined ? { verdict: JSON.stringify(data.verdict) } : {}),
      ...(data.report !== undefined ? { report: data.report } : {}),
      ...(data.error !== undefined ? { error: data.error } : {}),
      ...(data.finishedAt !== undefined ? { finishedAt: data.finishedAt } : {}),
      ...(data.durationMs !== undefined ? { durationMs: data.durationMs } : {}),
      ...(data.tokens !== undefined ? { tokens: JSON.stringify(data.tokens) } : {}),
      ...(terminal
        ? LEASE_CLEAR
        : { heartbeatAt: new Date(), leaseExpiresAt: new Date(Date.now() + LEASE_MS) }),
    },
  });
}

async function audit(agentName: string, action: string, params: unknown, okB: boolean, result: unknown) {
  try {
    await db.gateAction.create({
      data: {
        agentName,
        action,
        params: JSON.stringify(params || {}).slice(0, 2000),
        ok: okB,
        result: JSON.stringify(result || {}).slice(0, 4000),
      },
    });
  } catch { /* audit must never break the loop */ }
}

/** Execute one module call for a run, with audit + per-run cache for read-only modules. */
export async function execModule(
  modId: string,
  args: Record<string, unknown>,
  ctx: ModuleCtx,
  cache?: Map<string, unknown>,
): Promise<{ ok: boolean; result: unknown; cached?: boolean }> {
  const m = getModule(modId);
  if (!m) return { ok: false, result: `unknown module "${modId}"` };
  // Canonical key: a module with defaulted args normalizes its own key, so
  // `{}` and `{"username":"headcorner"}` are ONE probe — not two paid calls.
  const canonical = m.cacheKeyOf ? m.cacheKeyOf(args || {}) : JSON.stringify(args || {});
  const cacheKey = m.cacheable ? `${modId}:${canonical}` : "";
  if (cache && cacheKey && cache.has(cacheKey)) {
    void bumpModuleStats(modId, "cache");
    return { ok: true, result: cache.get(cacheKey), cached: true };
  }
  const t0 = Date.now();
  try {
    const result = await m.exec(args || {}, ctx);
    if (cache && cacheKey) cache.set(cacheKey, result);
    await audit(ctx.agentName, `harness.${modId}`, args, true, result);
    void bumpModuleStats(modId, "call", Date.now() - t0); // tool-only ms — real latency, no brain time
    return { ok: true, result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await audit(ctx.agentName, `harness.${modId}`, args, false, { error: msg });
    void bumpModuleStats(modId, "fail", Date.now() - t0);
    return { ok: false, result: { error: msg } };
  }
}

/**
 * Module effectiveness — real counters persisted across reboots (GateState).
 * "יעילות היא נתון": every armory chip eventually shows what its module REALLY
 * did — calls, cache-hit share, honest failures, tool-only average ms.
 * Fire-and-forget: telemetry must never break a run.
 */
export interface ModStat { calls: number; cached: number; failed: number; msTotal: number }
export async function bumpModuleStats(modId: string, kind: "call" | "cache" | "fail", ms = 0): Promise<void> {
  try {
    const row = await db.gateState.findUnique({ where: { key: "modstats" } });
    let stats: Record<string, ModStat> = {};
    try { stats = row ? JSON.parse(row.value) : {}; } catch { stats = {}; }
    const s = stats[modId] || { calls: 0, cached: 0, failed: 0, msTotal: 0 };
    if (kind === "call") { s.calls += 1; s.msTotal += ms; }
    else if (kind === "cache") { s.calls += 1; s.cached += 1; }
    else { s.failed += 1; }
    stats[modId] = s;
    await db.gateState.upsert({
      where: { key: "modstats" },
      create: { key: "modstats", value: JSON.stringify(stats) },
      update: { value: JSON.stringify(stats) },
    });
  } catch { /* telemetry must never break the loop */ }
}

/** The independent checker — generator/evaluator separation made code.
 *
 * r30 — the checker gets the same free protocol-rescue the maker always had
 * (FREE_RESQUE_LIMIT = 2). Live-caught (r30): three runs whose maker steps
 * were ALL proven (e.g. the 05:40 scout — 4/4 ok) were graded blocked because
 * the checker brain's SINGLE reply was protocol garbage — extractJson threw,
 * verdict stayed null, and the repair round never even ran. One flaky reply
 * voided real, evidenced work. The rescue costs zero budget (temperature 0,
 * strict re-ask) and never fabricates a pass — if every attempt is garbage
 * the original honest throw stands. */
const CHECKER_RESCUE_LIMIT = 2;
async function runChecker(opts: {
  checkerSpec: string;
  goal: string;
  doneMeans: string[];
  steps: TraceStep[];
}): Promise<CheckerVerdict> {
  const transcript = traceToTranscript(opts.steps.filter((s) => s.side === "maker"));
  const messages: ChatMsg[] = [
    { role: "system", content: checkerSystemPrompt(opts.goal, opts.doneMeans) },
    { role: "user", content: `EVIDENCE TRACE:\n${transcript.slice(0, 12000)}\n\nGrade the pass-gate now.` },
  ];
  const reply = await brainChat(parseBrain(opts.checkerSpec), messages, { maxTokens: 900, temperature: 0 });
  let v: CheckerVerdict | null = null;
  let rescues = 0;
  try {
    v = extractJson<CheckerVerdict>(reply.content);
  } catch (firstErr) {
    let lastErr: unknown = firstErr;
    for (; rescues < CHECKER_RESCUE_LIMIT; rescues++) {
      const reply2 = await brainChat(
        parseBrain(opts.checkerSpec),
        [...messages, { role: "user", content: "Your previous reply was NOT valid protocol JSON. Reply AGAIN — ONLY the compact JSON verdict object, nothing else." }],
        { maxTokens: 900, temperature: 0 },
      );
      try {
        v = extractJson<CheckerVerdict>(reply2.content);
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!v) throw lastErr; // every attempt was garbage — the honest throw stands
  }
  const checks = Array.isArray(v.checks) ? v.checks.slice(0, 12) : [];
  // Pass-gate is CONJUNCTIVE — enforced in code, not left to the model's mood:
  // one failed criterion ⇒ done=false, even if the checker's own "done" says true.
  const anyFail = checks.some((c) => c && c.pass === false);
  return {
    done: Boolean(v.done) && !anyFail,
    checks,
    gaps: String(v.gaps || ""),
    notes: String(v.notes || ""),
    ...(rescues ? { rescues } : {}),
  };
}

interface MakerCall { thought?: string; tool?: string; args?: Record<string, unknown> }

/**
 * The goal loop. Fire-and-forget (the API route returns the run id;
 * the operator watches the trace build step-by-step).
 *
 * Two entry paths, one claim discipline:
 *  · manual (API route) → claims its own lease here;
 *  · heart dispatch     → already claimed, arrives with {claimed:true}.
 * A crashed run is re-claimed later with attempt>1 → RECOVERY mode: the
 * persisted trace is reloaded and the maker resumes from the evidence.
 */
export async function processRun(runId: string, opts: { claimed?: boolean; workerId?: string } = {}): Promise<void> {
  if (!opts.claimed) {
    const won = await claimRun(runId);
    if (!won) return; // someone else owns it — never double-run
  }
  const run = await db.gateRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== "running") return;
  // ROAST r4: a non-null alias for closures below — TS narrowing of `run`
  // does not survive into `makerTurn`/`execModule` closures, and "it compiles
  // anyway" was hiding a real null-hole at the heart of the loop.
  const rec = run;
  const attempt = run.attempt;
  if (attempt > run.maxAttempts) {
    // ROAST r8 — this path used to die MUTE (error set, report NULL). A run
    // that exhausted its attempts must confess in Hebrew like every other
    // terminal failure — the bridge reads REPORTS, not error columns.
    const msg = `watchdog: חריגה מ-${run.maxAttempts} ניסיונות — נכשל בכנות`;
    await db.gateRun.update({
      where: { id: runId },
      data: {
        status: "failed",
        error: msg,
        report: `🛑 הריצה חרגה ממכסת-הניסיונות (${run.maxAttempts}) ונכשלה סופית. מטרה: ${String(run.goal).slice(0, 200)}. זו כשל-כנה — אין דוח-תוצרים כי העבודה לא הושלמה.`,
        finishedAt: new Date(),
        ...LEASE_CLEAR,
      },
    });
    await emitEvent("run.failed", { agent: run.agentName, goal: run.goal, gaps: "" }, "harness");
    await db.gateMessage.create({
      data: { channel: "command", fromKind: "system", fromName: "harness", body: `🛑 הרצת-מטרה של ${run.agentName} חרגה ממכסת-הניסיונות ונכשלה — וידוי כן נכתב לדוח שלה`, meta: JSON.stringify({ runId }) },
    }).catch(() => {});
    return;
  }
  const recovering = attempt > 1;

  const doneMeans = JSON.parse(run.doneMeans) as string[];
  const modules = JSON.parse(run.modules) as string[];
  let lessons: string[] = [];
  try { lessons = JSON.parse(run.lessons || "[]"); } catch { lessons = []; }
  // recovery: the trace persisted before the crash is the checkpoint — reload it
  let steps: TraceStep[] = [];
  if (recovering) {
    try { steps = JSON.parse(run.steps || "[]"); } catch { steps = []; }
  }
  // fleet memory — the shared bank, injected into the maker's FIRST prompt:
  // what the fleet already proved is not worth another paid probe.
  let fleetFacts: string[] = [];
  try {
    const mem = await db.gateMemory.findMany({ orderBy: { updatedAt: "desc" }, take: 3 });
    fleetFacts = mem.map((r) => `${r.key} — ${r.body.slice(0, 220)}`);
    if (mem.length) {
      void db.gateMemory.updateMany({ where: { id: { in: mem.map((r) => r.id) } }, data: { refCount: { increment: 1 } } }).catch(() => {});
    }
  } catch { /* empty bank is fine */ }
  const toolCache = new Map<string, unknown>();
  const startedAt = Date.now();
  let tokPrompt = 0;
  let tokCompletion = 0;
  let usageKnown = false;
  let freeRescues = 0;
  let repairRan = false;
  let leaseLost = false;

  await saveRun(runId, { status: "running" });
  await db.gateAgent.updateMany({ where: { name: run.agentName }, data: { lastSeenAt: new Date() } });

  try {
    // r14 — brain failover on recovery: a run that crashed once usually died
    // to its brain's ENVIRONMENT, not its plan (proven live: the zai:default
    // fleet starved on sustained 429 windows — 18 failed — while nvidia
    // delivered 37 done; and a re-queued anchor-agent run died to the SAME
    // 429 wall on attempt 2 — retrying on the starved brain is deterministic
    // failure). A recovered run (attempt ≥ 2) now flips its maker to a
    // different brain by a deterministic map, recomputes the checker when the
    // stored one would collide with the effective maker (generator/evaluator
    // separation must survive the switch), and records the switch honestly in
    // meta + a lesson that rides into the maker's own prompt.
    const baseSpec = parseBrain(run.brain);
    const FAILOVER_MAKER: Record<string, string> = {
      "zai:default": "nvidia:openai/gpt-oss-20b",
      "nvidia:openai/gpt-oss-20b": "nvidia:deepseek-ai/deepseek-v4-flash-0731",
      "nvidia:deepseek-ai/deepseek-v4-flash-0731": "nvidia:openai/gpt-oss-20b",
    };
    let makerSpec: ReturnType<typeof parseBrain> = baseSpec;
    let checkerSpec = run.checker;
    let brainFailoverNote: string | null = null;
    if (recovering) {
      const fromKey = `${baseSpec.provider}:${baseSpec.model}`;
      const to = FAILOVER_MAKER[fromKey];
      if (to && to !== fromKey) {
        makerSpec = parseBrain(to);
        const cb = parseBrain(run.checker);
        if (cb.provider === makerSpec.provider && cb.model === makerSpec.model) {
          checkerSpec = pickCheckerBrain(to);
        }
        const fromMeta = (() => { try { return JSON.parse(run.meta || "{}") as Record<string, unknown>; } catch { return {} as Record<string, unknown>; } })();
        fromMeta.brainFailover = { from: fromKey, to, attempt };
        await db.gateRun.update({ where: { id: runId }, data: { meta: JSON.stringify(fromMeta), checker: checkerSpec } }).catch(() => {});
        lessons.push(`brain-failover: attempt ${attempt} runs on ${to} instead of ${fromKey} — the original brain failed in its environment (usually a sustained 429 window), not in its plan`);
        brainFailoverNote = `🧠 החלפת-מוח (failover): attempt ${attempt} רץ על ${to} במקום ${fromKey} — המוח-המקורי נכשל בסביבתו, לא בתוכנית`;
      }
    }

    /** One maker turn (brain call), with the free protocol-rescue. Returns null after unrecoverable garbage. */
    async function makerTurn(userContent: string): Promise<{ call: MakerCall | null; rescued: boolean }> {
      const base: ChatMsg[] = [
        { role: "system", content: makerSystemPrompt(rec.goal, doneMeans, modules, lessons, fleetFacts) },
        { role: "user", content: userContent },
      ];
      const reply = await brainChat(makerSpec, base, { maxTokens: 800, temperature: 0.2 });
      if (reply.usage && (reply.usage.prompt || reply.usage.completion)) {
        usageKnown = true;
        tokPrompt += reply.usage.prompt;
        tokCompletion += reply.usage.completion;
      }
      try {
        return { call: extractJson<MakerCall>(reply.content), rescued: false };
      } catch {
        if (freeRescues >= FREE_RESQUE_LIMIT) return { call: null, rescued: false };
        freeRescues++;
        const reply2 = await brainChat(
          makerSpec,
          [...base, { role: "user", content: "Your previous reply was NOT valid protocol JSON. Reply AGAIN — ONLY the compact JSON object, nothing else." }],
          { maxTokens: 800, temperature: 0 },
        );
        if (reply2.usage && (reply2.usage.prompt || reply2.usage.completion)) {
          usageKnown = true;
          tokPrompt += reply2.usage.prompt;
          tokCompletion += reply2.usage.completion;
        }
        try {
          return { call: extractJson<MakerCall>(reply2.content), rescued: true };
        } catch {
          return { call: null, rescued: true };
        }
      }
    }

    /** Execute one maker step end-to-end (brain → tool → trace) and persist it. */
    async function makerStep(i: number, userContent: string, opts: { repair?: boolean } = {}): Promise<{ finished: boolean; report: string | null }> {
      const t0 = Date.now();
      const { call, rescued } = await makerTurn(userContent);
      if (!call) {
        steps.push({ i, side: "maker", ok: false, error: "protocol-garbage after free re-ask", rescued: true, ms: Date.now() - t0, ...(opts.repair ? { repair: true } : {}), at: new Date().toISOString() });
        await saveRun(runId, { steps });
        return { finished: false, report: null };
      }
      const tool = String(call.tool || "").trim();

      if (tool === "finish" || tool === "done") {
        steps.push({ i, side: "maker", thought: call.thought, tool: "finish", args: call.args, ok: true, result: { report: call.args?.report || null }, ms: Date.now() - t0, ...(rescued ? { rescued: true } : {}), ...(opts.repair ? { repair: true } : {}), at: new Date().toISOString() });
        await saveRun(runId, { steps });
        return { finished: true, report: (call.args?.report as string | undefined) || null };
      }

      if (!getModule(tool)) {
        steps.push({ i, side: "maker", thought: call.thought, tool, args: call.args, ok: false, error: `module not armed: "${tool}" — armed: ${modules.join(", ")}`, ms: Date.now() - t0, ...(rescued ? { rescued: true } : {}), ...(opts.repair ? { repair: true } : {}), at: new Date().toISOString() });
        await saveRun(runId, { steps });
        return { finished: false, report: null };
      }

      const out = await execModule(tool, call.args || {}, { agentName: rec.agentName, runId }, toolCache);
      // r29: a failed module step must carry its real message in `error` —
      // execModule wraps failures as {error: msg} INSIDE result, and the
      // transcript renders s.error — without this lift the checker (and the
      // maker's own ratchet) saw "ERROR: undefined" instead of the truth.
      const failMsg = out.ok
        ? undefined
        : typeof (out.result as { error?: unknown } | null | undefined)?.error === "string"
          ? (out.result as { error: string }).error
          : String(out.result);
      steps.push({
        i, side: "maker", thought: call.thought, tool, args: call.args,
        ok: out.ok, result: out.ok ? clampResult(out.result) : out.result,
        ...(failMsg !== undefined ? { error: failMsg } : {}),
        ms: Date.now() - t0,
        ...(out.cached ? { cached: true } : {}),
        ...(rescued ? { rescued: true } : {}),
        ...(opts.repair ? { repair: true } : {}),
        at: new Date().toISOString(),
      });
      await saveRun(runId, { steps });
      return { finished: false, report: null };
    }

    /* ── main loop — the budget is the hard token-blowout guard ── */
    let finished = false;
    let finalReport: string | null = null;

    for (let i = 1; i <= run.budget && !finished; i++) {
      if (!(await stillMine(runId))) { leaseLost = true; break; } // a reaper/another worker took over — leave the row alone
      await renewLease(runId);
      /* ── anti-stall guard: identical call ≥2× IN A ROW proves nothing new ──
       * Live-caught pathology: a maker looped chain.ethereum 8× (all cache
       * hits — zero network cost, but budget turns burned) and never reached
       * the other armed modules. The cache keeps it cheap; this nudge keeps
       * it MOVING. Prompt-level only — no behavior is ever refused. */
      const makerSoFar = steps.filter((s) => s.side === "maker" && s.tool && s.tool !== "finish");
      const sigOf = (s: { tool?: string; args?: Record<string, unknown> | undefined }) => `${s.tool}:${JSON.stringify(s.args || {})}`;
      let sameRun = 0;
      if (makerSoFar.length) {
        const last = sigOf(makerSoFar[makerSoFar.length - 1]);
        for (let k = makerSoFar.length - 1; k >= 0; k--) { if (sigOf(makerSoFar[k]) === last) sameRun++; else break; }
      }
      const stallNudge = sameRun >= 2
        ? `\n\n⏸️ ANTI-STALL: you already called ${makerSoFar[makerSoFar.length - 1].tool} ${sameRun}× in a row and received the SAME (cached) answer every time. Repeating it proves nothing and burns budget. Either call a DIFFERENT module you still need, or finish with your Hebrew report if the evidence is complete.`
        : "";
      const userContent = i === 1
        ? (recovering
          ? `RECOVERED (attempt ${attempt}/${run.maxAttempts}) — ההרצה קרסה באמצע והוחזרה על-ידי השומר. עקבות שנשמרו לפני הקריסה:\n${ratchetedTranscript(steps.filter((s) => s.side === "maker")).slice(-4000)}\n\nהמשך בדיוק מאיפה שנעצרת — אל תחזור על צעדים שכבר הוכיחו ראיות.`
          : `GOAL RECEIVED. Begin. Progress is empty — you are at step 1 of ${run.budget}.`)
        : `PROGRESS SO FAR (ratchet — do not repeat completed work):\n${ratchetedTranscript(steps.filter((s) => s.side === "maker")).slice(-5000)}\n\nContinue toward the goal. Step ${i} of ${run.budget}.${stallNudge}`;
      const r = await makerStep(i, userContent);
      finished = r.finished;
      if (r.report) finalReport = r.report;
    }

    if (leaseLost) return; // silent handoff — the new owner owns the row now

    /* ── independent verdict (ALWAYS — the maker can't grade itself) ── */
    let verdict: CheckerVerdict | null = null;
    try {
      verdict = await runChecker({ checkerSpec, goal: run.goal, doneMeans, steps });
      steps.push({ i: steps.length + 1, side: "checker", ok: verdict.done, result: verdict, at: new Date().toISOString() });
      await saveRun(runId, { steps, verdict });
    } catch (e) {
      steps.push({ i: steps.length + 1, side: "checker", ok: false, error: e instanceof Error ? e.message : String(e), at: new Date().toISOString() });
      await saveRun(runId, { steps });
      void bumpCheckerStats("error");
    }

    /* ── bounded critic-loop: gaps go BACK to the maker, then one re-check ── */
    if (verdict && !verdict.done) {
      repairRan = true;
      // gaps may come empty — synthesize them from the failed criteria (real evidence demands)
      const failedChecks = verdict.checks.filter((c) => !c.pass).map((c) => `${c.criterion} — ${c.evidence || "no tool evidence recorded"}`).join("; ");
      const gapsText = (verdict.gaps || failedChecks || "the pass-gate was not proven").slice(0, 1200);
      const gapMsg = `REPAIR ROUND — the independent checker REJECTED the work. Its verdict: "${verdict.notes}". Gaps that must still be proven: ${gapsText}. You have ${REPAIR_STEPS} steps to close the gaps with real tool evidence (or finish with an honest Hebrew report about what remains).`;
      for (let j = 1; j <= REPAIR_STEPS && !finished; j++) {
        if (!(await stillMine(runId))) { leaseLost = true; return; }
        await renewLease(runId);
        const progress = steps.filter((s) => s.side === "maker");
        const r = await makerStep(run.budget + j, `${gapMsg}\n\nEVIDENCE SO FAR:\n${ratchetedTranscript(progress).slice(-4500)}`, { repair: true });
        finished = r.finished;
        if (r.report) finalReport = r.report;
      }
      if (leaseLost) return;
      try {
        const verdict2 = await runChecker({ checkerSpec, goal: run.goal, doneMeans, steps });
        steps.push({ i: steps.length + 1, side: "checker", ok: verdict2.done, result: verdict2, at: new Date().toISOString() });
        verdict = verdict2;
        await saveRun(runId, { steps, verdict });
        void bumpCheckerStats(verdict2.done ? "repair-pass" : "blocked");
      } catch (e) {
        steps.push({ i: steps.length + 1, side: "checker", ok: false, error: e instanceof Error ? e.message : String(e), at: new Date().toISOString() });
        await saveRun(runId, { steps });
        void bumpCheckerStats("error");
      }
    } else if (verdict) {
      void bumpCheckerStats(verdict.done ? "first-pass" : "blocked");
    }

    /* ── status: the (final) pass-gate rules, not the maker ── */
    const status = verdict ? (verdict.done ? "done" : "blocked") : "blocked";

    /* ── final Hebrew report → bridge (clean-state handoff) ── */
    const makerSteps = steps.filter((s) => s.side === "maker").length;
    const durS = Math.round((Date.now() - startedAt) / 100) / 10;
    const lines: string[] = [
      `🏁 הרצת-מטרה הסתיימה — סוכן ${run.agentName}`,
      `🎯 מטרה: ${run.goal}`,
    ];
    if (run.origin !== "manual") {
      const originText = run.origin === "schedule" ? "⏰ סיור מתוכנן (לב-האוטונומיה)" : run.origin === "proposal" ? "💡 יוזמת-יעד (הסוכן הציע — הגבול אישר)" : run.origin === "idle" ? "🌿 תעסוקה-עצמית (הלב שיגר כשהצי פנוי)" : "⚡ טריגר אירוע";
      lines.push(`🧬 מקור: ${originText}${recovering ? " · התאוששות מקריסה" : ""}`);
    } else if (recovering) {
      lines.push("🫀 התאוששות-מקריסה — העקבות חודשו מה-DB");
    }
    if (brainFailoverNote) lines.push(brainFailoverNote);
    lines.push(`⚖️ פסיקת בודק עצמאי (${checkerSpec}): ${verdict ? (verdict.done ? "עבר את שער-המעבר — כל הקריטריונים הוכחו" : "לא הוכח — פתוח") : "הבודק לא ענה"}`);
    if (verdict?.checks?.length) {
      lines.push(...verdict.checks.map((c) => `${c.pass ? "✅" : "❌"} ${c.criterion}${c.evidence ? " — " + c.evidence.slice(0, 160) : ""}`));
    }
    if (verdict && !verdict.done && verdict.gaps) lines.push(`⚠️ פערים: ${verdict.gaps.slice(0, 300)}`);
    if (repairRan) lines.push(`🔧 סבב-תיקון רץ אחרי הפסיקה הראשונה — הפערים הוחזרו למייצר ונבדקו שוב`);
    if (freeRescues) lines.push(`🛟 ${freeRescues} חילוצי-פרוטוקול בחינם — התקציב לא נשרף`);
    if (verdict?.rescues) lines.push(`⚖️🛟 הבודק חולץ ${verdict.rescues}× מפרוטוקול-גרביים בחינם — פסיקה אמיתית במקום "הבודק לא ענה" (r30)`);
    lines.push(`🧾 עקבות: ${makerSteps} צעדי-מייצר (תקציב ${run.budget}) · ⏱ ${durS}s${usageKnown ? ` · טוקנים: ${tokPrompt}→${tokCompletion}` : ""} · ביקורת מלאה ביומן`);

    const report = lines.join("\n");
    await db.gateMessage.create({
      data: { channel: "command", fromKind: "system", fromName: "harness", body: report.slice(0, 3800), meta: JSON.stringify({ runId }) },
    });

    await saveRun(runId, {
      status, report, finishedAt: new Date(),
      durationMs: Date.now() - startedAt,
      tokens: usageKnown ? { prompt: tokPrompt, completion: tokCompletion } : null,
    });

    /* ── fleet memory: a final finding recorded here teaches every future run ── */
    await harvestFleetMemory(run.agentName, runId, steps);

    /* ── emit the terminal event — the nervous system may react (bounded) ── */
    await emitEvent(
      status === "done" ? "run.done" : "run.blocked",
      { agent: run.agentName, goal: run.goal, gaps: verdict && !verdict.done ? String(verdict.gaps || "").slice(0, 600) : "" },
      "harness",
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    steps.push({ i: steps.length + 1, side: "maker", ok: false, error: msg, at: new Date().toISOString() });
    // ROAST r7: a failed run used to die MUTE — error set, report empty. The
    // bridge and the operator read the REPORT, not the error column; a failed
    // run must confess in Hebrew what it was trying to do and where it fell.
    await saveRun(runId, {
      status: "failed", steps,
      error: msg,
      report:
        `🛑 הריצה נפלה לפני סיום (לא באשמת המודולים — בסביבה או בפרוטוקול): ${msg.slice(0, 300)}. ` +
        `מטרה: ${String(run.goal).slice(0, 200)}. צעדים שהושלמו: ${steps.filter((s) => s.side === "maker" && s.ok).length}. ` +
        `זו כשל-כנה — אין דוח-תוצרים כי העבודה לא הושלמה.`,
      finishedAt: new Date(),
      durationMs: Date.now() - startedAt,
      tokens: usageKnown ? { prompt: tokPrompt, completion: tokCompletion } : null,
    });
    await emitEvent("run.failed", { agent: run.agentName, goal: run.goal, gaps: "" }, "harness");
    await db.gateMessage.create({
      data: { channel: "command", fromKind: "system", fromName: "harness", body: `🛑 הרצת-מטרה של ${run.agentName} נפלה: ${msg.slice(0, 400)}`, meta: JSON.stringify({ runId }) },
    }).catch(() => {});
  }
}

/**
 * Fleet-memory auto-harvest: when a run produces a FINAL finding the whole
 * fleet must know (today: identity.anchor drift), the harness records it ONCE
 * under a canonical key — no agent pays for that probe again. Fire-safe:
 * memory must never break the loop.
 */
async function harvestFleetMemory(agentName: string, runId: string, steps: TraceStep[]): Promise<void> {
  try {
    for (const s of steps) {
      if (s.side !== "maker" || !s.ok || s.tool !== "identity.anchor") continue;
      const r = s.result as { drift?: boolean; username?: string; finding?: string } | undefined;
      if (!r?.drift) continue;
      const user = String(r.username || "headcorner").toLowerCase();
      const body = String(r.finding || "סטיית-authority מאומתת — המפתח-הפעיל החי נגזר לכתובת אחרת מהעיגון").slice(0, 500);
      await db.gateMemory.upsert({
        where: { key: `drift:${user}` },
        create: { key: `drift:${user}`, kind: "drift", body, source: agentName, runId },
        update: { body, source: agentName, runId },
      });
    }
  } catch { /* memory must never break the loop */ }
}

/**
 * Checker telemetry — the verdicts are a cost center too (audit #3 in the
 * roadmap): how often the independent checker passes runs first-try, how
 * often a repair round saves them, how often runs end blocked, how often the
 * checker itself errors. "Is the gate precise or over-strict" becomes data.
 */
export interface CheckerStats { verdicts: number; firstPass: number; repairPass: number; blocked: number; errors: number }
export async function bumpCheckerStats(kind: "first-pass" | "repair-pass" | "blocked" | "error"): Promise<void> {
  try {
    const row = await db.gateState.findUnique({ where: { key: "checkerstats" } });
    let s: CheckerStats = { verdicts: 0, firstPass: 0, repairPass: 0, blocked: 0, errors: 0 };
    try { if (row) s = { ...s, ...(JSON.parse(row.value) as Partial<CheckerStats>) }; } catch { /* fresh */ }
    s.verdicts++;
    if (kind === "first-pass") s.firstPass++;
    else if (kind === "repair-pass") s.repairPass++;
    else if (kind === "blocked") s.blocked++;
    else s.errors++;
    await db.gateState.upsert({
      where: { key: "checkerstats" },
      create: { key: "checkerstats", value: JSON.stringify(s) },
      update: { value: JSON.stringify(s) },
    });
  } catch { /* telemetry must never break the loop */ }
}

/** Distill cross-run lessons from this agent's past runs — external memory, real data. */
export async function buildLessons(agentName: string, excludeRunId?: string): Promise<string[]> {
  const past = await db.gateRun.findMany({
    where: { agentName, status: { in: ["done", "blocked", "failed"] }, ...(excludeRunId ? { id: { not: excludeRunId } } : {}) },
    orderBy: { createdAt: "desc" },
    take: 8,
  });
  const lessons: string[] = [];
  const gapHits = new Map<string, number>(); // repeated-gap detector: the same gap twice is a PLAN problem
  for (const r of past) {
    let verdict: CheckerVerdict | null = null;
    let steps: TraceStep[] = [];
    try { verdict = JSON.parse(r.verdict || "null"); } catch { verdict = null; }
    try { steps = JSON.parse(r.steps || "[]"); } catch { steps = []; }
    const provenTools = [...new Set(steps.filter((s) => s.side === "maker" && s.ok && s.tool && s.tool !== "finish").map((s) => s.tool as string))].slice(0, 3).join(", ");
    const makerSteps = steps.filter((s) => s.side === "maker").length;
    const secs = r.durationMs ? Math.round(r.durationMs / 1000) : null;
    if (r.status === "done") {
      lessons.push(`הריצה ב-${r.createdAt.toISOString().slice(0, 10)} עברה${secs ? ` ב-${secs}s` : ""}${makerSteps ? ` עם ${makerSteps} צעדים מתוך תקציב ${r.budget}` : ""} — הכלים שהוכיחו ראיות: ${provenTools || "-"} · שמור על אותו סדר-פעולות יעיל`);
    } else if (r.status === "blocked") {
      const gaps = String(verdict?.gaps || "");
      lessons.push(`הריצה ב-${r.createdAt.toISOString().slice(0, 10)} נחסמה${gaps ? ` — הפערים שנשארו: ${gaps.slice(0, 220)}` : ""} · סגור את הפערים האלה עם ראיות-כלים כבר בתחילת העבודה`);
      for (const g of gaps.split(/[;,\n]+/).map((x) => x.trim().toLowerCase()).filter((x) => x.length >= 8)) gapHits.set(g, (gapHits.get(g) || 0) + 1);
    } else if (r.status === "failed" && r.error) {
      lessons.push(`הריצה ב-${r.createdAt.toISOString().slice(0, 10)} נפלה — השגיאה: ${r.error.slice(0, 180)} · הימנע מהקריאה שגרמה לזה`);
    }
  }
  // repeated-gap detector — the same gap twice means plan differently from step one
  const repeated = [...gapHits.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 2);
  for (const [gap, n] of repeated) {
    lessons.unshift(`⚠️ פער-חוזר (${n} ריצות): ${gap.slice(0, 160)} — זו כבר תבנית; תכנן את הצעד-הראשון במפורש מולו`);
  }
  return lessons.slice(0, 8);
}
