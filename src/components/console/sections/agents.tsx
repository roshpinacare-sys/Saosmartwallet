"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Bot, CheckCircle2, Copy, Cpu, Crosshair, Layers, ListChecks, Loader2, MinusCircle, Play,
  Plus, ScrollText, ShieldCheck, Trash2, UserCheck,
} from "lucide-react";
import { apiJson, copyText, GlowCard, rise, Scramble, SectionHead } from "@/components/console/kit";
import type {
  AgentRow, AgentStat, CheckerVerdict, ModStats, ModuleDef, RunDetail, RunRow, TraceStep,
} from "@/components/console/types";

const BRAIN_MAKER_DEFAULT = "nvidia:openai/gpt-oss-20b";
const KIND_META: Record<ModuleDef["kind"], { label: string; cls: string }> = {
  skill: { label: "מיומנות", cls: "text-emerald-300 border-emerald-500/40" },
  connector: { label: "מחבר", cls: "text-sky-300 border-sky-500/40" },
  actor: { label: "מבצע", cls: "text-amber-300 border-amber-500/40" },
};

function ModuleChip({
  m, on, onClick, stats,
}: { m: ModuleDef; on: boolean; onClick?: () => void; stats?: ModStats }) {
  const meta = KIND_META[m.kind];
  const st = stats?.[m.id];
  const cachePct = st && st.calls ? Math.round((st.cached / st.calls) * 100) : 0;
  const avgMs = st && st.calls - st.cached ? Math.round(st.msTotal / (st.calls - st.cached)) : null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={
        "text-right rounded-xl border px-3 py-2 transition-all w-full " +
        (on ? "border-emerald-500/60 bg-emerald-500/10" : "border-zinc-800 bg-black/40 hover:border-zinc-600") +
        (onClick ? " cursor-pointer" : " cursor-default")
      }
    >
      <span className="flex items-center gap-2 flex-wrap">
        <span className={"font-mono text-xs font-bold " + (on ? "text-emerald-300" : "text-zinc-300")} dir="ltr">{m.id}</span>
        <Badge variant="outline" className={"text-[9px] px-1.5 py-0 " + meta.cls}>{meta.label}</Badge>
        {m.needsVault && <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-rose-300 border-rose-500/40">כספת</Badge>}
        {on && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 mr-auto" />}
      </span>
      <span className="block mt-1 text-[11px] leading-snug text-zinc-500">{m.desc}</span>
      {st && st.calls > 0 && (
        <span className="block mt-1.5 text-[10px] font-mono text-zinc-400" dir="ltr">
          <span className="text-zinc-500">נמדד:</span> {st.calls} calls
          {st.cached > 0 && <span className="text-emerald-400"> · cache {cachePct}%</span>}
          {avgMs !== null && <span className="text-sky-300"> · ~{avgMs}ms</span>}
          {st.failed > 0 && <span className="text-rose-400"> · {st.failed} fail</span>}
        </span>
      )}
    </button>
  );
}

function TraceStepView({ s }: { s: TraceStep }) {
  if (s.side === "checker") {
    const v = s.result as CheckerVerdict | undefined;
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5">
        <p className="font-bold text-sm text-amber-300 flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> פסיקת הבודק העצמאי{s.ms ? <span className="font-mono text-[10px] text-zinc-500">· {(s.ms / 1000).toFixed(1)}s</span> : null}</p>
        {v && (
          <div className="mt-2 space-y-1.5">
            <p className="text-xs text-zinc-300">{v.notes}</p>
            {v.checks.map((c, i) => (
              <p key={i} className={"text-xs " + (c.pass ? "text-emerald-300" : "text-rose-300")}>
                {c.pass ? "✅" : "❌"} {c.criterion}{c.evidence ? <span className="text-zinc-500"> — {c.evidence}</span> : null}
              </p>
            ))}
            {!v.done && v.gaps && <p className="text-xs text-amber-200/90">פערים: {v.gaps}</p>}
          </div>
        )}
        {s.error && <p className="text-xs text-rose-300 mt-2">הבודק נפל: {s.error}</p>}
      </div>
    );
  }
  return (
    <div className={"rounded-xl border p-3 " + (s.ok === false ? "border-rose-500/30 bg-rose-500/5" : "border-zinc-800 bg-black/40")}>
      {s.thought && <p className="text-xs italic text-zinc-400 mb-1.5">💭 {s.thought}</p>}
      <p className="font-mono text-[11px] flex items-center gap-2 flex-wrap" dir="ltr">
        <span className="text-zinc-600">step {s.i}</span>
        <span className={"font-bold " + (s.tool === "finish" ? "text-amber-300" : "text-sky-300")}>{s.tool || "?"}</span>
        {s.args && Object.keys(s.args).length > 0 && (
          <span className="text-zinc-500 truncate max-w-full">{JSON.stringify(s.args).slice(0, 120)}</span>
        )}
        {typeof s.ms === "number" && <span className="text-zinc-600">· {(s.ms / 1000).toFixed(1)}s</span>}
        {s.cached && <span className="text-[9px] px-1.5 py-0 rounded bg-sky-500/15 text-sky-300 font-black">CACHE</span>}
        {s.rescued && <span className="text-[9px] px-1.5 py-0 rounded bg-emerald-500/15 text-emerald-300 font-black">RESCUED</span>}
        {s.repair && <span className="text-[9px] px-1.5 py-0 rounded bg-amber-500/15 text-amber-300 font-black">REPAIR</span>}
      </p>
      {s.ok === false && s.error && <p className="text-[11px] text-rose-300 mt-1.5 font-mono break-all" dir="ltr">{s.error}</p>}
      {s.ok !== false && s.result !== undefined && s.tool !== "finish" && (
        <details className="mt-1.5">
          <summary className="text-[11px] text-zinc-500 cursor-pointer hover:text-zinc-300">תוצאת-כלי (ראיה)</summary>
          <pre className="mt-1 max-h-40 overflow-y-auto scroll-thin text-[10px] font-mono text-emerald-200/80 whitespace-pre-wrap break-all bg-black/60 rounded-lg p-2" dir="ltr">
            {typeof s.result === "string" ? s.result : JSON.stringify(s.result, null, 1)}
          </pre>
        </details>
      )}
    </div>
  );
}

export function Agents() {
  /* ── data ── */
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [mods, setMods] = useState<ModuleDef[]>([]);
  const [modStats, setModStats] = useState<ModStats>({});
  const [brains, setBrains] = useState<{ maker: string[]; checker: string[] }>({ maker: [], checker: [] });
  const [nv, setNv] = useState<{ keySealed: boolean; source: string } | null>(null);
  const [loading, setLoading] = useState(true);

  /* ── attach form ── */
  const [name, setName] = useState("");
  const [memo, setMemo] = useState("");
  const [sel, setSel] = useState<string[]>(["vault.map", "vault.verify", "chain.steem"]);
  const [brainSel, setBrainSel] = useState(BRAIN_MAKER_DEFAULT);
  const [busy, setBusy] = useState(false);
  const [tokenOnce, setTokenOnce] = useState<string | null>(null);

  /* ── run bay ── */
  const [runAgent, setRunAgent] = useState("");
  const [goal, setGoal] = useState("");
  const [criteria, setCriteria] = useState<string[]>([""]);
  const [budget, setBudget] = useState(5);
  const [launching, setLaunching] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<RunDetail | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [stats, setStats] = useState<AgentStat[]>([]);

  const armedAgents = agents.filter((a) => a.active && (a.modules?.length || 0) > 0);

  const load = useCallback(async () => {
    const [ar, mo] = await Promise.all([
      apiJson<{ ok: boolean; agents: AgentRow[] }>("/api/gate/agents"),
      apiJson<{ ok: boolean; modules: ModuleDef[]; brains: { maker: string[]; checker: string[] }; nvidia: { keySealed: boolean; source: string }; stats?: ModStats }>("/api/gate/modules"),
    ]);
    if (ar?.ok) setAgents(ar.agents || []);
    if (mo?.ok) { setMods(mo.modules || []); setBrains(mo.brains || { maker: [], checker: [] }); setNv(mo.nvidia || null); setModStats(mo.stats || {}); }
    const rs = await apiJson<{ ok: boolean; runs: RunRow[]; stats?: AgentStat[] }>("/api/gate/run");
    if (rs?.ok) { setRuns(rs.runs || []); setStats(rs.stats || []); }
    setLoading(false);
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  /* live trace polling while a run is in flight (external state, polled) */
  useEffect(() => {
    if (!activeRunId) return;
    let stop = false;
    async function tick() {
      const r = await apiJson<{ ok: boolean; run: RunDetail }>(`/api/gate/run?id=${encodeURIComponent(activeRunId || "")}`);
      if (r?.ok && !stop) {
        setActiveRun(r.run);
        if (["queued", "running"].includes(r.run.status)) setTimeout(tick, 2500);
        else load();
      }
    }
    void Promise.resolve().then(tick);
    return () => { stop = true; };
  }, [activeRunId, load]);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await apiJson<{ ok: boolean; token?: string; error?: string }>("/api/gate/agents", {
        method: "POST", body: JSON.stringify({ name: name.trim(), memo: memo.trim() || undefined, modules: sel, brain: brainSel }),
      });
      if (r?.ok && r.token) {
        setTokenOnce(r.token);
        setName(""); setMemo("");
        toast.success(`הסוכן חובר וחומש ב-${sel.length} מודולים — שמור את הטוקן`);
        load();
      } else toast.error(r?.error || "יצירת סוכן נכשלה");
    } finally { setBusy(false); }
  }

  async function rearm(a: AgentRow, modules: string[], brain?: string) {
    const r = await apiJson<{ ok: boolean; error?: string }>("/api/gate/agents", {
      method: "PATCH", body: JSON.stringify({ name: a.name, modules, brain }),
    });
    if (r?.ok) { toast.success(`"${a.name}" חומש מחדש`); load(); }
    else toast.error(r?.error || "החימוש נכשל");
  }

  // r39 — the financial permission ladder, one click per agent (operator only)
  const FIN_TIER_LABEL: Record<string, string> = {
    none: "סגור — בלי ידיים",
    build: "בונה — הכספת חותמת רק באישורך",
    "autonomous-limited": "אוטונומי-חסום — הכספת חותמת לבד בתוך-תקרות",
  };
  async function setFinTier(a: AgentRow, tier: string) {
    const r = await apiJson<{ ok: boolean; error?: string }>("/api/gate/agents", {
      method: "PATCH", body: JSON.stringify({ name: a.name, finTier: tier }),
    });
    if (r?.ok) {
      setAgents((arr) => arr.map((x) => (x.name === a.name ? { ...x, finTier: tier } : x)));
      toast.success(`דרגת-הכסף של ${a.name}: ${FIN_TIER_LABEL[tier] ?? tier}`);
    } else toast.error(r?.error || "השינוי נכשל");
  }

  async function revoke(n: string) {
    const r = await apiJson<{ ok: boolean }>(`/api/gate/agents?name=${encodeURIComponent(n)}`, { method: "DELETE" });
    if (r?.ok) { setAgents((arr) => arr.map((x) => (x.name === n ? { ...x, active: false } : x))); toast("הסוכן נשלל"); }
  }

  async function launch() {
    const c = criteria.map((x) => x.trim()).filter(Boolean);
    if (!runAgent || !goal.trim() || !c.length) { toast.error("בחר סוכן חמוש, כתוב מטרה ולפחות קריטריון-סיום אחד"); return; }
    setLaunching(true);
    try {
      const r = await apiJson<{ ok: boolean; run?: { id: string }; error?: string }>("/api/gate/run", {
        method: "POST", body: JSON.stringify({ agentName: runAgent, goal: goal.trim(), doneMeans: c, budget }),
      });
      if (r?.ok && r.run) {
        setActiveRun(null);
        setActiveRunId(r.run.id);
        setGoal(""); setCriteria([""]);
        toast.success("המטרה הוזנקה — העקבות נבנים חי");
      } else toast.error(r?.error || "ההזנקה נכשלה");
    } finally { setLaunching(false); }
  }

  const runRunning = activeRun && ["queued", "running"].includes(activeRun.status);

  return (
    <section className="py-14">
      <SectionHead num="03" title="מחסן-החימוש" sub="סוכן בלי מודולים הוא טוקן חסר-ידיים. מחברים, חומשים, נותנים מטרה עם קריטריוני-סיום — ובודק עצמאי פוסק. לב-האוטונומיה והבקרה עליו — בסעיף הבא בניווט." />

      {/* attach + module rack */}
      <div className="grid gap-4 lg:grid-cols-2">
        <motion.div {...rise}>
          <GlowCard className="p-6 h-full">
            <h3 className="font-bold flex items-center gap-2 mb-4"><UserCheck className="h-4 w-4 text-emerald-400" /> חיבור סוכן חמוש</h3>
            <div className="space-y-2.5">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="שם-סוכן (a-z 0-9 _ -)" className="font-mono text-sm bg-zinc-950/80 border-zinc-800" dir="ltr" />
              <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="תיאור חופשי (לא חובה)" className="text-sm bg-zinc-950/80 border-zinc-800" />
              <label className="text-xs text-zinc-400 flex items-center gap-2"><Cpu className="h-3.5 w-3.5 text-emerald-400" /> מוח-המייצר (checker תמיד שונה — אכיפה אוטומטית)</label>
              <select
                value={brainSel} onChange={(e) => setBrainSel(e.target.value)}
                className="w-full rounded-md border border-zinc-800 bg-zinc-950/80 px-3 py-2 text-sm font-mono text-zinc-200 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" dir="ltr"
                aria-label="מוח הסוכן"
              >
                {(brains.maker.length ? brains.maker : [BRAIN_MAKER_DEFAULT, "zai:default"]).map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              {nv && (
                <p className="text-[10px] text-zinc-500 font-mono" dir="ltr">
                  nvidia key: {nv.keySealed ? "sealed ✓" : "missing ✗"} ({nv.source})
                </p>
              )}
              <Button onClick={create} disabled={busy || !name.trim()} className="w-full gap-2 bg-emerald-600 hover:bg-emerald-500 text-black font-bold">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} חבר וחמש
              </Button>
            </div>
            <AnimatePresence>
              {tokenOnce && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/8 p-4"
                >
                  <p className="text-xs text-emerald-300 mb-2">הטוקן — מוצג פעם אחת ביקום הזה. שמור עכשיו:</p>
                  <div className="flex items-start gap-2" dir="ltr">
                    <Scramble text={tokenOnce} className="flex-1 font-mono text-xs break-all text-emerald-200 leading-relaxed" />
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-emerald-300" onClick={() => copyText(tokenOnce, "טוקן סוכן")}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </GlowCard>
        </motion.div>

        <motion.div {...rise} transition={{ ...rise.transition, delay: 0.08 }}>
          <GlowCard className="p-6 h-full">
            <h3 className="font-bold flex items-center gap-2 mb-1"><Layers className="h-4 w-4 text-emerald-400" /> מדף-המודולים ({mods.length})</h3>
            <p className="text-[11px] text-zinc-500 mb-3">המודולים הם הידיים: מיומנויות-כספת, מחברים חיים לשרשרת ולרשת, ומבצע לגשר. ההרכב המסומן = חימוש לסוכן-החדש.</p>
            <div className="max-h-72 overflow-y-auto scroll-thin space-y-2 pl-1">
              {loading && <div className="flex items-center gap-2 text-sm text-zinc-500 py-4 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> טוען מדף…</div>}
              {!loading && mods.map((m) => (
                <ModuleChip key={m.id} m={m} stats={modStats} on={sel.includes(m.id)} onClick={() => setSel((s) => (s.includes(m.id) ? s.filter((x) => x !== m.id) : [...s, m.id]))} />
              ))}
              {!loading && mods.length === 0 && <p className="text-sm text-zinc-500 py-6 text-center">המדף ריק</p>}
            </div>
          </GlowCard>
        </motion.div>
      </div>

      {/* fleet with re-arm */}
      <motion.div {...rise} className="mt-4">
        <GlowCard className="p-6">
          <h3 className="font-bold mb-4 flex items-center gap-2"><Bot className="h-4 w-4 text-emerald-400" /> הצי ({agents.filter((a) => a.active).length} פעילים) — לחיצה על מודול = חימוש/פריקה מיידית</h3>
          <div className="max-h-96 overflow-y-auto scroll-thin space-y-3">
            {loading && <div className="flex items-center gap-2 text-sm text-zinc-500 py-4 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> טוען…</div>}
            {!loading && agents.map((a) => {
              const armed = a.modules || [];
              const st = stats.find((s) => s.agent === a.name);
              return (
                <div key={a.id} className="rounded-xl border border-zinc-800/80 bg-black/40 p-3.5">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <Bot className={"h-4 w-4 shrink-0 " + (a.active ? "text-emerald-400" : "text-zinc-600")} />
                    <p className="font-mono text-sm font-bold" dir="ltr">{a.name}</p>
                    {a.active
                      ? <Badge variant="outline" className="text-emerald-400 border-emerald-500/40 text-[10px]">פעיל</Badge>
                      : <Badge variant="outline" className="text-zinc-600 border-zinc-800 text-[10px]">נשלל</Badge>}
                    {a.brain && <Badge variant="outline" className="text-sky-300 border-sky-500/40 text-[10px] font-mono" dir="ltr"><Cpu className="h-3 w-3 ml-1 inline" />{a.brain}</Badge>}
                    {a.active && (
                      <select
                        value={a.finTier || "build"}
                        onChange={(e) => setFinTier(a, e.target.value)}
                        className={"rounded-md border bg-zinc-950/80 px-1.5 py-0.5 text-[10px] font-mono " + ((a.finTier || "build") === "autonomous-limited" ? "border-amber-500/50 text-amber-300" : (a.finTier || "build") === "none" ? "border-zinc-800 text-zinc-500" : "border-emerald-500/40 text-emerald-300")}
                        dir="ltr" aria-label={`דרגת-כסף של ${a.name}`} title={`דרגת-כסף: ${FIN_TIER_LABEL[a.finTier || "build"] ?? ""}${(a.finTier || "build") === "autonomous-limited" ? " · תקרות: ≤" + (a.finCaps?.maxNotionalPerOrder ?? 0.5) + "/פקודה · ≤" + (a.finCaps?.maxNotionalPerDay ?? 1) + "/יום · ≤" + (a.finCaps?.maxSignedPerDay ?? 2) + " חתימות/יום" : ""}`}
                      >
                        <option value="none">fin:none</option>
                        <option value="build">fin:build</option>
                        <option value="autonomous-limited">fin:auto≤{(a.finCaps?.maxNotionalPerOrder ?? 0.5).toString()}</option>
                      </select>
                    )}
                    {st && st.runs > 0 && (
                      <span className="font-mono text-[10px] text-zinc-500" dir="ltr" title="יעילות אמיתית מהריצות">
                        {st.runs} ריצות · {Math.round((st.done / st.runs) * 100)}% עברו · ממוצע {st.avgSteps} צעדים{st.avgMs ? ` · ${Math.round(st.avgMs / 100) / 10}s` : ""}
                      </span>
                    )}
                    <span className="text-[10px] text-zinc-600 mr-auto">{new Date(a.lastSeenAt).toLocaleString("he-IL")}</span>
                    {a.active && armed.length > 0 && (
                      <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
                        onClick={() => { setRunAgent(a.name); document.getElementById("run-goal-input")?.focus(); }}>
                        <Crosshair className="h-3 w-3" /> מטרה
                      </Button>
                    )}
                    {a.active && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-400/80 shrink-0" title="שלילת סוכן" onClick={() => revoke(a.name)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  {a.active && (
                    <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                      {mods.map((m) => (
                        <ModuleChip key={m.id} m={m} stats={modStats} on={armed.includes(m.id)} onClick={() => rearm(a, armed.includes(m.id) ? armed.filter((x) => x !== m.id) : [...armed, m.id])} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {!loading && agents.length === 0 && <p className="text-sm text-zinc-500 py-6 text-center">אין סוכנים עדיין — חבר את הראשון</p>}
          </div>
        </GlowCard>
      </motion.div>

      {/* goal loop run bay */}
      <motion.div {...rise} className="mt-4">
        <GlowCard className="p-6">
          <h3 className="font-bold flex items-center gap-2 mb-1"><Crosshair className="h-4 w-4 text-emerald-400" /> מפעילת-המטרות (לולאה סגורה)</h3>
          <p className="text-[11px] text-zinc-500 mb-4">
            מייצר פועל דרך מודולים אמיתיים · בודק עצמאי עם מוח <b className="text-zinc-400">אחר</b> פוסק לפי קריטריונים עם ראיות מהעקבות · פערים חוזרים למייצר לסבב-תיקון אחד · לקחים מריצות-עבר מוזרקים אוטומטית · תקציב לא נשרף על זבל-פרוטוקול.
          </p>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-2.5">
              <label className="text-xs text-zinc-400">סוכן חמוש</label>
              <select
                value={runAgent} onChange={(e) => setRunAgent(e.target.value)}
                className="w-full rounded-md border border-zinc-800 bg-zinc-950/80 px-3 py-2 text-sm font-mono text-zinc-200 focus:outline-none focus:ring-1 focus:ring-emerald-500/40" dir="ltr"
                aria-label="בחירת סוכן"
              >
                <option value="">— בחר סוכן —</option>
                {armedAgents.map((a) => <option key={a.id} value={a.name}>{a.name} · {a.modules?.length} מודולים</option>)}
              </select>
              <label className="text-xs text-zinc-400">המטרה</label>
              <Textarea
                id="run-goal-input" value={goal} onChange={(e) => setGoal(e.target.value)}
                placeholder='לדוגמה: "בדוק את מצב הכספת, דווח לגשר מה חי ומה נכשל, ואמת את יתרת headcorner ב-STEEM"'
                className="min-h-[72px] text-sm bg-zinc-950/80 border-zinc-800"
              />
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-zinc-400">תקציב-צעדים:</span>
                {[3, 5, 8].map((b) => (
                  <button key={b} type="button" onClick={() => setBudget(b)}
                    className={"rounded-lg border px-2.5 py-1 text-xs font-mono " + (budget === b ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300" : "border-zinc-800 text-zinc-500 hover:border-zinc-600")}
                    aria-pressed={budget === b}>{b}</button>
                ))}
              </div>
            </div>
            <div className="space-y-2.5">
              <label className="text-xs text-zinc-400 flex items-center gap-2"><ListChecks className="h-3.5 w-3.5 text-emerald-400" /> קריטריוני-סיום (שער-המעבר — כל אחד חייב הוכחה)</label>
              {criteria.map((c, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={c} onChange={(e) => setCriteria((arr) => arr.map((x, j) => (j === i ? e.target.value : x)))}
                    placeholder={`קריטריון ${i + 1} — לדוגמה: "vault.verify הוחזר עם steemOk=true"`}
                    className="text-sm bg-zinc-950/80 border-zinc-800" />
                  {criteria.length > 1 && (
                    <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-zinc-500" aria-label="מחק קריטריון" onClick={() => setCriteria((arr) => arr.filter((_, j) => j !== i))}>
                      <MinusCircle className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button variant="ghost" size="sm" className="text-xs text-zinc-400 gap-1" onClick={() => setCriteria((arr) => [...arr, ""])}>
                <Plus className="h-3.5 w-3.5" /> הוסף קריטריון
              </Button>
              <Button onClick={launch} disabled={launching || !runAgent || !goal.trim()} className="w-full gap-2 bg-emerald-600 hover:bg-emerald-500 text-black font-bold">
                {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} הזנק מטרה
              </Button>
            </div>
          </div>

          {/* live trace */}
          {activeRun && (
            <div className="mt-5 rounded-2xl border border-zinc-800 bg-black/50 p-4">
              <div className="flex items-center gap-2 flex-wrap mb-3">
                <span className="font-mono text-xs text-zinc-500" dir="ltr">{activeRun.id.slice(0, 10)}…</span>
                <Badge variant="outline" className={"text-[10px] font-mono " + (runRunning ? "text-emerald-300 border-emerald-500/40" : activeRun.status === "done" ? "text-emerald-300 border-emerald-500/40" : activeRun.status === "blocked" ? "text-amber-300 border-amber-500/40" : "text-rose-300 border-rose-500/40")}>
                  {activeRun.status}
                </Badge>
                <span className="text-[11px] text-zinc-500" dir="ltr">maker: {activeRun.brain} · checker: {activeRun.checker}</span>
                {runRunning && <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400 mr-auto" />}
              </div>
              <p className="text-sm text-zinc-300 mb-2">🎯 {activeRun.goal}</p>
              {(activeRun.durationMs || activeRun.tokens || (activeRun.lessons && activeRun.lessons.length > 0)) && (
                <div className="flex items-center gap-2 flex-wrap mb-2 text-[10px] font-mono">
                  {activeRun.durationMs ? <span className="text-zinc-500">⏱ {(activeRun.durationMs / 1000).toFixed(1)}s</span> : null}
                  {activeRun.tokens ? <span className="text-zinc-500" dir="ltr">tokens: {activeRun.tokens.prompt}→{activeRun.tokens.completion}</span> : null}
                  {activeRun.lessons && activeRun.lessons.length > 0 && (
                    <span className="text-emerald-300/80" title={activeRun.lessons.join("\n")}>🧠 {activeRun.lessons.length} לקחים מריצות-עבר</span>
                  )}
                </div>
              )}
              <div className="space-y-2 max-h-96 overflow-y-auto scroll-thin">
                {activeRun.steps.map((s, i) => <TraceStepView key={i} s={s} />)}
                {activeRun.steps.length === 0 && <p className="text-xs text-zinc-500 py-3 text-center">ממתין לצעד הראשון…</p>}
              </div>
              {activeRun.error && <p className="mt-2 text-xs text-rose-300">🛑 {activeRun.error}</p>}
              {activeRun.report && (
                <pre className="mt-3 whitespace-pre-wrap rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-100/90 leading-relaxed">{activeRun.report}</pre>
              )}
            </div>
          )}

          {/* runs log */}
          <div className="mt-4">
            <p className="text-xs text-zinc-500 mb-2 flex items-center gap-1.5"><ScrollText className="h-3.5 w-3.5" /> יומן הרצות ({runs.length}) — לחיצה פותחת עקבות</p>
            <div className="max-h-56 overflow-y-auto scroll-thin space-y-1.5">
              {runs.map((r) => (
                <button key={r.id} type="button" onClick={() => { setActiveRunId(r.id); setActiveRun(null); }}
                  className="w-full text-right rounded-xl border border-zinc-800/80 bg-black/40 px-3 py-2 flex items-center gap-2 flex-wrap hover:border-zinc-600 transition-colors">
                  <span className={"h-2 w-2 rounded-full shrink-0 " + (r.status === "done" ? "bg-emerald-400" : r.status === "blocked" ? "bg-amber-400" : r.status === "failed" ? "bg-rose-400" : "bg-zinc-500 animate-pulse")} aria-hidden />
                  <span className="font-mono text-xs text-zinc-300" dir="ltr">{r.agentName}</span>
                  {r.origin && r.origin !== "manual" && (
                    <Badge variant="outline" className={"text-[9px] font-mono shrink-0 " + (r.origin === "schedule" ? "text-sky-300 border-sky-500/40" : r.origin === "proposal" ? "text-purple-300 border-purple-500/40" : r.origin === "idle" ? "text-lime-300 border-lime-500/40" : "text-amber-300 border-amber-500/40")} dir="ltr">{r.origin === "schedule" ? "⏰ סיור" : r.origin === "proposal" ? "💡 יוזמה" : r.origin === "idle" ? "🌿 עצמית" : "⚡ טריגר"}</Badge>
                  )}
                  {(r.attempt ?? 0) > 1 && <Badge variant="outline" className="text-[9px] font-mono text-emerald-300 border-emerald-500/40 shrink-0" dir="ltr">🫀 התאושש</Badge>}
                  <span className="text-xs text-zinc-500 truncate max-w-[40%]">{r.goal}</span>
                  {typeof r.makerSteps === "number" && (
                    <span className="font-mono text-[10px] text-zinc-600" dir="ltr">
                      {r.makerSteps}/{r.budget} צעדים{r.durationMs ? ` · ${(r.durationMs / 1000).toFixed(1)}s` : ""}
                    </span>
                  )}
                  <Badge variant="outline" className="text-[9px] font-mono text-zinc-500 border-zinc-700 mr-auto" dir="ltr">{r.status}</Badge>
                </button>
              ))}
              {runs.length === 0 && <p className="text-xs text-zinc-600 py-3 text-center">עדיין אין הרצות — הזנק מטרה ראשונה</p>}
            </div>
          </div>
        </GlowCard>
      </motion.div>
    </section>
  );
}
