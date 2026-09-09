/**
 * SOVEREIGN GATE — agent harness · loop (לולאת-המטרה).
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
 *  · Observability      → full append-only trace + audit row per tool call.
 *  · Token-blowout guard→ hard budget on maker steps; "never stop" iron rule
 *    applies to the maker's effort, never to the budget.
 *
 * The maker speaks a strict JSON tool-protocol; every tool result is the
 * real output of a real module (zero-mock). The final report is Hebrew,
 * written to the command bridge so the operator wakes up to findings,
 * not to process.
 */
import { db } from "@/lib/db";
import { GateError } from "@/lib/gate/crypto";
import { brainChat, parseBrain, type ChatMsg } from "./brain";
import { getModule, modulesForPrompt, type ModuleCtx } from "./modules";

export interface TraceStep {
  i: number;
  side: "maker" | "checker";
  thought?: string;
  tool?: string;
  args?: Record<string, unknown>;
  ok?: boolean;
  result?: unknown;
  error?: string;
  at: string;
}

export interface CheckerVerdict {
  done: boolean;
  checks: { criterion: string; pass: boolean; evidence: string }[];
  gaps: string;
  notes: string;
}

const MAX_BUDGET = 8;
const RESULT_CLAMP = 1400;

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

function makerSystemPrompt(goal: string, doneMeans: string[], modules: string[]): string {
  return [
    "You are the MAKER inside a goal-loop harness (SAOS SOVEREIGN GATE).",
    "You act ONLY through tools; you NEVER claim a result without a tool observation proving it.",
    "",
    "GOAL: " + goal,
    "DONE-MEANS (the pass-gate — every line must be proven):",
    ...doneMeans.map((d, i) => `${i + 1}. ${d}`),
    "",
    "YOUR MODULES:",
    modulesForPrompt(modules) || "(none armed — report that honestly)",
    "",
    "PROTOCOL — reply with ONLY compact JSON, no markdown, no prose:",
    '{"thought":"one sentence: what you know, what you still need","tool":"<module-id> | finish","args":{...}}',
    'When you believe the goal is met, use "finish" and put the Hebrew final report inside args.report.',
    "Rules: one tool call per turn · prefer vault.verify/chain.steem for hard evidence · keep failures in mind and adapt · never invent data — if a module errors, read the error and try differently.",
  ].join("\n");
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

function traceToTranscript(steps: TraceStep[]): string {
  return steps
    .map((s) => {
      if (s.side === "checker") return `[checker] done=${(s.result as CheckerVerdict | undefined)?.done} — gaps: ${(s.result as CheckerVerdict | undefined)?.gaps || "-"}`;
      const body = s.ok ? JSON.stringify(s.result) : `ERROR: ${s.error}`;
      return `[step ${s.i}] thought: ${s.thought || "-"}\n  → ${s.tool}(${JSON.stringify(s.args || {})})\n  ⇐ ${String(body).slice(0, 600)}`;
    })
    .join("\n");
}

/** Persist-and-continue helper — external state is written BEFORE the next step runs. */
async function saveRun(id: string, data: { status?: string; steps?: TraceStep[]; verdict?: CheckerVerdict | null; report?: string | null; error?: string | null; finishedAt?: Date | null }) {
  await db.gateRun.update({
    where: { id },
    data: {
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.steps !== undefined ? { steps: JSON.stringify(data.steps) } : {}),
      ...(data.verdict !== undefined ? { verdict: JSON.stringify(data.verdict) } : {}),
      ...(data.report !== undefined ? { report: data.report } : {}),
      ...(data.error !== undefined ? { error: data.error } : {}),
      ...(data.finishedAt !== undefined ? { finishedAt: data.finishedAt } : {}),
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

/** Execute one module call for a run, with audit. */
export async function execModule(modId: string, args: Record<string, unknown>, ctx: ModuleCtx): Promise<{ ok: boolean; result: unknown }> {
  const m = getModule(modId);
  if (!m) return { ok: false, result: `unknown module "${modId}"` };
  try {
    const result = await m.exec(args || {}, ctx);
    await audit(ctx.agentName, `harness.${modId}`, args, true, result);
    return { ok: true, result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await audit(ctx.agentName, `harness.${modId}`, args, false, { error: msg });
    return { ok: false, result: { error: msg } };
  }
}

/** The independent checker — generator/evaluator separation made code. */
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
  const v = extractJson<CheckerVerdict>(reply.content);
  return {
    done: Boolean(v.done),
    checks: Array.isArray(v.checks) ? v.checks.slice(0, 12) : [],
    gaps: String(v.gaps || ""),
    notes: String(v.notes || ""),
  };
}

/**
 * The goal loop. Fire-and-forget (the API route returns the run id;
 * the operator watches the trace build step-by-step).
 */
export async function processRun(runId: string): Promise<void> {
  const run = await db.gateRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== "queued") return;

  const doneMeans = JSON.parse(run.doneMeans) as string[];
  const modules = JSON.parse(run.modules) as string[];
  const steps: TraceStep[] = [];

  await saveRun(runId, { status: "running" });
  await db.gateAgent.updateMany({ where: { name: run.agentName }, data: { lastSeenAt: new Date() } });

  try {
    const makerSpec = parseBrain(run.brain);
    let firstUser = true;

    for (let i = 1; i <= run.budget; i++) {
      /* ── maker turn ── */
      const userContent = firstUser
        ? `GOAL RECEIVED. Begin. Progress is empty — you are at step 1 of ${run.budget}.`
        : `PROGRESS SO FAR (ratchet — do not repeat completed work):\n${traceToTranscript(steps).slice(-5000)}\n\nContinue toward the goal. Step ${i} of ${run.budget}.`;
      firstUser = false;

      const messages: ChatMsg[] = [
        { role: "system", content: makerSystemPrompt(run.goal, doneMeans, modules) },
        { role: "user", content: userContent },
      ];
      const reply = await brainChat(makerSpec, messages, { maxTokens: 800, temperature: 0.2 });
      const call = extractJson<{ thought?: string; tool?: string; args?: Record<string, unknown> }>(reply.content);
      const tool = String(call.tool || "").trim();

      if (tool === "finish" || tool === "done") {
        steps.push({ i, side: "maker", thought: call.thought, tool: "finish", args: call.args, ok: true, result: { report: call.args?.report || null }, at: new Date().toISOString() });
        await saveRun(runId, { steps });
        break;
      }

      if (!getModule(tool)) {
        steps.push({ i, side: "maker", thought: call.thought, tool, args: call.args, ok: false, error: `module not armed: "${tool}" — armed: ${modules.join(", ")}`, at: new Date().toISOString() });
        await saveRun(runId, { steps });
        continue; // the observation teaches the maker to correct itself
      }

      const out = await execModule(tool, call.args || {}, { agentName: run.agentName, runId });
      steps.push({
        i, side: "maker", thought: call.thought, tool, args: call.args,
        ok: out.ok, result: out.ok ? clampResult(out.result) : out.result,
        at: new Date().toISOString(),
      });
      await saveRun(runId, { steps });
    }

    /* ── independent verdict (ALWAYS, even after finish — the maker can't grade itself) ── */
    let verdict: CheckerVerdict | null = null;
    try {
      verdict = await runChecker({ checkerSpec: run.checker, goal: run.goal, doneMeans, steps });
      steps.push({ i: steps.length + 1, side: "checker", ok: verdict.done, result: verdict, at: new Date().toISOString() });
    } catch (e) {
      steps.push({ i: steps.length + 1, side: "checker", ok: false, error: e instanceof Error ? e.message : String(e), at: new Date().toISOString() });
    }
    await saveRun(runId, { steps, verdict });

    /* ── status: the pass-gate rules, not the maker ── */
    const status = verdict ? (verdict.done ? "done" : run.status === "running" ? "blocked" : "blocked") : "blocked";

    /* ── final Hebrew report → bridge (clean-state handoff) ── */
    const lines: string[] = [
      `🏁 הרצת-מטרה הסתיימה — סוכן ${run.agentName}`,
      `🎯 מטרה: ${run.goal}`,
      `⚖️ פסיקת בודק עצמאי (${run.checker}): ${verdict ? (verdict.done ? "עבר את שער-המעבר — כל הקריטריונים הוכחו" : "לא הוכח — פתוח") : "הבודק לא ענה"}`,
    ];
    if (verdict?.checks?.length) {
      lines.push(...verdict.checks.map((c) => `${c.pass ? "✅" : "❌"} ${c.criterion}${c.evidence ? " — " + c.evidence.slice(0, 160) : ""}`));
    }
    if (verdict && !verdict.done && verdict.gaps) lines.push(`⚠️ פערים: ${verdict.gaps.slice(0, 300)}`);
    lines.push(`🧾 עקבות: ${steps.filter((s) => s.side === "maker").length} צעדי-מייצר · ביקורת מלאה ביומן`);

    const report = lines.join("\n");
    await db.gateMessage.create({
      data: { channel: "command", fromKind: "system", fromName: "harness", body: report.slice(0, 3800), meta: JSON.stringify({ runId }) },
    });

    await saveRun(runId, { status, report, finishedAt: new Date() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    steps.push({ i: steps.length + 1, side: "maker", ok: false, error: msg, at: new Date().toISOString() });
    await saveRun(runId, { status: "failed", steps, error: msg, finishedAt: new Date() });
    await db.gateMessage.create({
      data: { channel: "command", fromKind: "system", fromName: "harness", body: `🛑 הרצת-מטרה של ${run.agentName} נפלה: ${msg.slice(0, 400)}`, meta: JSON.stringify({ runId }) },
    }).catch(() => {});
  }
}
