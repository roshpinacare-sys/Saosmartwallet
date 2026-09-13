"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Activity, Brain, Clock, Hand, HeartPulse, Lightbulb, Loader2, Plus, Trash2, Wallet, Zap,
} from "lucide-react";
import { apiJson, GlowCard, rise, SectionHead } from "@/components/console/kit";
import type {
  AgentRow, DigestData, GateStatus, HeartData, MemoryRow, OrdersData, ScheduleRow,
  SituationData, TreasurySnapshot,
} from "@/components/console/types";

const HEART_TICK_MS_CLIENT = 20000;

/* ══════════════════════════ employment strip (r18) ══════════════════════════ */

/** Fleet employment health — live from /api/gate/status (aggregated 24h,
 *  public data only). Not a claim: done/blocked/failed are measured, and the
 *  blocked taxonomy says WHY (fair-block = the checker said no; vault-locked;
 *  429 rate window; watchdog). A hardcoded version of this died once already
 *  (gap-54) — this one is computed every render. */
function EmploymentStrip() {
  const [emp, setEmp] = useState<GateStatus["employment"] | null>(null);
  useEffect(() => {
    let dead = false;
    apiJson<GateStatus>("/api/gate/status")
      .then((s) => { if (!dead) setEmp(s?.employment ?? null); })
      .catch(() => {});
    return () => { dead = true; };
  }, []);
  if (!emp || emp.runs24h === 0) return null;
  const rate = emp.doneRate;
  const rateColor = rate === null ? "text-zinc-500" : rate >= 70 ? "text-emerald-400" : rate >= 40 ? "text-amber-400" : "text-rose-400";
  const t = emp.blockedTaxonomy;
  const taxTotal = t.fair + t.vaultLocked + t.rate429 + t.watchdog + t.other;
  return (
    <div className="mt-1 rounded-xl border border-zinc-800 bg-black/30 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
        <p className="text-[11px] text-zinc-400 flex items-center gap-1.5"><Activity className="h-3.5 w-3.5 text-lime-300" /> תעסוקת-הצי · 24h</p>
        <span className={"font-mono text-xs font-bold " + rateColor}>{rate === null ? "–" : `${rate}%`} הצלחה</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap font-mono text-[10px]" dir="ltr">
        <span className="rounded-md border border-emerald-500/30 text-emerald-300 px-1.5 py-0.5">done {emp.done}</span>
        <span className="rounded-md border border-zinc-700 text-zinc-300 px-1.5 py-0.5">blocked {emp.blocked}</span>
        <span className="rounded-md border border-rose-500/30 text-rose-300 px-1.5 py-0.5">failed {emp.failed}</span>
        <span className="rounded-md border border-zinc-800 text-zinc-400 px-1.5 py-0.5">running {emp.running}</span>
        <span className="rounded-md border border-lime-500/30 text-lime-300 px-1.5 py-0.5">idle {emp.idleRuns24h}</span>
      </div>
      {taxTotal > 0 && (
        <p className="mt-1.5 text-[10px] text-zinc-500 leading-relaxed">
          חסימות וכשלים לפי סיבה (חי): <span className="font-mono text-zinc-400" dir="ltr">fair {t.fair} · vault-locked {t.vaultLocked} · 429 {t.rate429} · watchdog {t.watchdog} · other {t.other}</span>
          {" "}— r29: צעד-כושל מציג-עתה את-הודעתו-האמיתית לבודק (חסימה-כנה כבר לא נראית כמו "undefined")
          {" "}— {t.vaultLocked > 0 ? "ריצות שמתו על כספת-נעולה כנות-אך-מיותרות: הנפילה-ל-zai מזעירה אותן" : "אין-מיתות-כספת-נעולה — הנפילה-ל-zai עובדת"}
        </p>
      )}
    </div>
  );
}

function AutonomyCard({ agents }: { agents: AgentRow[] }) {
  const [h, setH] = useState<HeartData | null>(null);
  const [busy, setBusy] = useState(false);
  const [mem, setMem] = useState<MemoryRow[]>([]);
  const [orders, setOrders] = useState<OrdersData | null>(null);
  const [treasury, setTreasury] = useState<TreasurySnapshot | null>(null);
  const [situation, setSituation] = useState<SituationData | null>(null);
  const [digest, setDigest] = useState<DigestData | null>(null);

  /* patrol form */
  const [label, setLabel] = useState("");
  const [pAgent, setPAgent] = useState("");
  const [pGoal, setPGoal] = useState("");
  const [everyMin, setEveryMin] = useState(30);
  const [maxDay, setMaxDay] = useState(8);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    const r = await apiJson<HeartData>("/api/gate/heart");
    if (r?.ok) setH(r);
  }, []);
  const loadMem = useCallback(async () => {
    const r = await apiJson<{ ok: boolean; facts?: MemoryRow[] }>("/api/gate/memory");
    if (r?.ok) setMem(r.facts || []);
  }, []);
  const loadOrders = useCallback(async () => {
    const r = await apiJson<OrdersData>("/api/gate/orders");
    if (r?.ok) setOrders(r);
  }, []);
  const loadTreasury = useCallback(async () => {
    const r = await apiJson<TreasurySnapshot & { ok: boolean }>("/api/gate/treasury");
    if (r?.ok) setTreasury(r);
  }, []);
  const loadSituation = useCallback(async () => {
    const r = await apiJson<SituationData & { ok: boolean }>("/api/gate/situation");
    if (r?.ok) setSituation(r);
  }, []);
  const loadDigest = useCallback(async () => {
    const r = await apiJson<DigestData & { ok: boolean }>("/api/gate/digest");
    if (r?.ok) setDigest(r);
  }, []);
  useEffect(() => { void Promise.resolve().then(load); void Promise.resolve().then(loadMem); void Promise.resolve().then(loadOrders); void Promise.resolve().then(loadTreasury); void Promise.resolve().then(loadSituation); void Promise.resolve().then(loadDigest); }, [load, loadMem, loadOrders, loadTreasury, loadSituation, loadDigest]);
  /* r41 BUG-HUNT (user: "קפיצות כל שנייה — קופץ נופל"): this section used to
   * hammer SIX endpoints every 8s. In dev each request can take 7-14s
   * (on-demand webpack compile), so requests piled up, the server's heap blew
   * past its threshold, next-dev restarted itself, the browser's HMR socket
   * reconnected and did a FULL page reload — measured as three CLS=1.0 (whole
   * page replacement) events inside 75 seconds. That restart→reload loop was
   * the "jumps every second". The fleet data moves on minutes, not seconds:
   * heart (cheap) stays at 20s; the five heavy feeds now refresh every 60s,
   * staggered 5s apart so they never fire together. Compile pressure drops
   * ~10x and the server stops restarting. */
  useEffect(() => {
    const timers: Array<ReturnType<typeof setInterval>> = [];
    timers.push(setInterval(() => { void load(); }, 20000));
    const heavy: Array<[() => Promise<void>, number]> = [
      [loadMem, 0], [loadOrders, 5000], [loadTreasury, 10000], [loadSituation, 15000], [loadDigest, 20000],
    ];
    for (const [fn, offset] of heavy) {
      timers.push(setInterval(() => { void fn(); }, 60000 + offset));
    }
    return () => { for (const t of timers) clearInterval(t); };
  }, [load, loadMem, loadOrders, loadTreasury, loadSituation, loadDigest]);

  async function toggleAutonomy(v: boolean) {
    setBusy(true);
    try {
      const r = await apiJson<{ ok: boolean; error?: string }>("/api/gate/heart", { method: "POST", body: JSON.stringify({ autonomyEnabled: v }) });
      if (r?.ok) { toast.success(v ? "לב-האוטונומיה הופעל" : "האוטונומיה נעצרה — ניקוי נקי"); await load(); }
      else toast.error(r?.error || "המתג נכשל");
    } finally { setBusy(false); }
  }

  async function createSchedule() {
    if (!label.trim() || !pAgent || pGoal.trim().length < 12) { toast.error("שם-סיור, סוכן ומטרה (12+ תווים)"); return; }
    setBusy(true);
    try {
      const r = await apiJson<{ ok: boolean; error?: string }>("/api/gate/schedule", {
        method: "POST",
        body: JSON.stringify({ label: label.trim(), agentName: pAgent, goal: pGoal.trim(), everyMinutes: everyMin, maxPerDay: maxDay }),
      });
      if (r?.ok) {
        toast.success("הסיור נקבע — הפעימה הראשונה תוך דקה, בלי לחיצה שלך");
        setLabel(""); setPGoal(""); setFormOpen(false);
        await load();
      } else toast.error(r?.error || "יצירת הסיור נכשלה");
    } finally { setBusy(false); }
  }

  async function toggleSched(s: ScheduleRow) {
    setBusy(true);
    try {
      const r = await apiJson<{ ok: boolean; error?: string }>("/api/gate/schedule", { method: "PATCH", body: JSON.stringify({ id: s.id, enabled: !s.enabled }) });
      if (r?.ok) await load(); else toast.error(r?.error || "העדכון נכשל");
    } finally { setBusy(false); }
  }

  async function delSched(id: string) {
    setBusy(true);
    try {
      const r = await apiJson<{ ok: boolean; error?: string }>(`/api/gate/schedule?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (r?.ok) { toast("הסיור נמחק — ההיסטוריה שלו נשארת ביומן"); await load(); }
      else toast.error(r?.error || "המחיקה נכשלה");
    } finally { setBusy(false); }
  }

  async function decideProposal(id: string, decision: "approve" | "reject") {
    setBusy(true);
    try {
      const r = await apiJson<{ ok: boolean; runId?: string; error?: string }>("/api/gate/proposals", { method: "PATCH", body: JSON.stringify({ id, decision }) });
      if (r?.ok) {
        toast.success(decision === "approve" ? "ההצעה אושרה — ריצת-יעד אמיתית מזנקת" : "ההצעה נדחתה — הסוכן רואה זאת בגשר");
        await load();
      } else toast.error(r?.error || "ההכרעה נכשלה");
    } finally { setBusy(false); }
  }

  async function togglePolicy(v: boolean) {
    setBusy(true);
    try {
      const r = await apiJson<{ ok: boolean; error?: string }>("/api/gate/proposals", { method: "PUT", body: JSON.stringify({ autoApprove: v }) });
      if (r?.ok) { toast.success(v ? "יוזמות אוטומטיות מרוסנות הופעלו" : "יוזמות ממתינות לאישור שלך בלבד"); await load(); }
      else toast.error(r?.error || "עדכון המדיניות נכשל");
    } finally { setBusy(false); }
  }

  async function decideOrder(id: string, decision: "approve" | "reject") {
    setBusy(true);
    try {
      const r = await apiJson<{ ok: boolean; broadcastId?: string; error?: string }>("/api/gate/orders", { method: "PATCH", body: JSON.stringify({ id, decision }) });
      if (r?.ok) {
        toast.success(decision === "approve" ? `הכספת חתמה והשידור עבר — txId ${String(r.broadcastId).slice(0, 14)}…` : "הפקודה נדחתה — לא נחתמה");
        await loadOrders();
      } else toast.error(r?.error || "ההכרעה נכשלה");
    } finally { setBusy(false); }
  }

  const beatAgeS = h?.pulse?.lastTickAt ? Math.max(0, Math.round((Date.now() - new Date(h.pulse.lastTickAt).getTime()) / 1000)) : null;
  const beatState = !h?.pulse ? "dark" : beatAgeS !== null && beatAgeS <= HEART_TICK_MS_CLIENT / 1000 * 3 ? "ok" : beatAgeS !== null && beatAgeS <= 120 ? "warn" : "stall";
  const c = h?.pulse?.counters;
  const activeAgents = agents.filter((a) => a.active);

  return (
    <motion.div {...rise} className="mt-6">
      <GlowCard className="p-6">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h3 className="font-bold flex items-center gap-2">
            <HeartPulse className={"h-4 w-4 " + (beatState === "ok" ? "text-emerald-400" : beatState === "warn" ? "text-amber-400" : beatState === "stall" ? "text-rose-400" : "text-zinc-600")} />
            לב-האוטונומיה
          </h3>
          <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
            <Switch checked={h ? h.autonomyEnabled : false} disabled={busy || !h} onCheckedChange={toggleAutonomy} aria-label="מתג אוטונומיה" />
            {h ? (h.autonomyEnabled ? "אוטונומיה פעילה" : "אוטונומיה כבויה") : "…"}
          </label>
        </div>
        <p className="text-[11px] text-zinc-500 leading-relaxed mb-4">
          הסוכנים קמים לבד: סיורים מתוכננים (קצב אמיתי שנשמר ב-DB) · טריגרים שמגיבים לאירועים בגשר ולריצות שנחסמו ·
          אזעקות-שוק — הלב צופה במחיר ה-DEX החי ומפיק market.move על תזוזה של ≥3% ·
          יוזמות-יעד מרוסנות — הסוכן מציע, הגבול מחליט · זיכרון-צי משותף — ממצא סופי נרשם פעם-אחת ומלמד את כל הצי ·
          יד-ריבונית — הסוכן מכין פקודת-DEX אמיתית, הכספת חותמת עם המפתח-הפעיל רק באישורך המפורש ·
          חוזי-חכירה שמשיבים ריצות קרוסות מהעקבות שנשמרו · והכול מרוסן — תקציב-צעדים, מקסימום-יומי, קירור בין-הפעלות, ומוח-בודק שונה.
        </p>

        {/* pulse line */}
        <div className="flex items-center gap-2.5 flex-wrap mb-4 font-mono text-[11px]" dir="ltr">
          <span className={"inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 " + (beatState === "ok" ? "border-emerald-500/40 text-emerald-300" : beatState === "warn" ? "border-amber-500/40 text-amber-300" : beatState === "stall" ? "border-rose-500/40 text-rose-300" : "border-zinc-800 text-zinc-600")}>
            <span className={"h-2 w-2 rounded-full " + (beatState === "ok" ? "bg-emerald-400 animate-pulse" : beatState === "warn" ? "bg-amber-400" : beatState === "stall" ? "bg-rose-400" : "bg-zinc-700")} aria-hidden />
            beat {h?.pulse?.beats ?? 0}{beatAgeS !== null ? ` · ${beatAgeS}s ago` : ""}
          </span>
          <span className="rounded-lg border border-zinc-800 px-2 py-1 text-zinc-400">queued {h?.counts.queued ?? "–"}</span>
          <span className="rounded-lg border border-zinc-800 px-2 py-1 text-zinc-400">running {h?.counts.running ?? "–"}</span>
          {c && (
            <span className="text-zinc-500 flex gap-2 flex-wrap">
              <span title="ריצות שהלב שיגר מהתור">dispatched {c.dispatched}</span>
              <span className="text-emerald-400/80" title="ריצות שהתאוששו מקריסה">recovered {c.recovered}</span>
              <span title="סיורים שהוזנקו מתוכננים">patrols {c.schedulesFired}</span>
              <span title="ריצות שהוזנקו מטריגרי-אירוע">triggers {c.triggersFired}</span>
              <span title="יוזמות-יעד שהוזנקו מהצעות סוכנים">initiatives {c.proposalsFired}</span>
              <span className="text-lime-300/80" title="תעסוקה-עצמית: משימות-רשת קלות שהלב שיגר כשהצי פנוי לגמרה">self-employed {c.idleFired ?? 0}</span>
              <span title="פקודות-DEX ממתינות שפגו ללא הכרעה">orders-expired {c.ordersExpired ?? 0}</span>
              <span title="אזעקות-שוק שהלב הפיק על תזוזת מחיר אמתית">market-alarms {c.marketMoves ?? 0}</span>
              <span title="ריצות קרוסות שהשומר החזיר לתור">reaped {c.reaped}</span>
            </span>
          )}
          {h?.pulse?.error && <span className="text-rose-300" dir="ltr">⚠ {h.pulse.error}</span>}
        </div>

        <EmploymentStrip />

        {/* schedules + form */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-zinc-400 flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-emerald-400" /> סיורים מתוכננים ({h?.schedules.length ?? 0})</p>
              <Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1 text-emerald-300 hover:bg-emerald-500/10" onClick={() => setFormOpen(!formOpen)}>
                <Plus className="h-3 w-3" /> קבע סיור
              </Button>
            </div>
            <div className="max-h-56 overflow-y-auto scroll-thin space-y-2 pl-1">
              {h && h.schedules.map((s) => (
                <div key={s.id} className={"rounded-xl border px-3 py-2.5 flex items-center gap-2.5 flex-wrap " + (s.enabled ? "border-zinc-800 bg-black/40" : "border-zinc-800/60 bg-black/20 opacity-60")}>
                  <Clock className={"h-3.5 w-3.5 shrink-0 " + (s.enabled ? "text-emerald-400" : "text-zinc-600")} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-zinc-200 truncate">{s.label}</p>
                    <p className="text-[10px] text-zinc-500 font-mono" dir="ltr">
                      {s.agentName} · {s.kind === "daily" ? `daily ${String(s.hourUtc).padStart(2, "0")}:00 UTC` : `every ${Math.round((s.everyMs || 0) / 60000)}m`} · {s.dayCount}/{s.maxPerDay} today
                    </p>
                    <p className="text-[10px] text-zinc-600 truncate">{s.goal}</p>
                  </div>
                  <span className="text-[9px] text-zinc-600 font-mono shrink-0" title="הפעימה הבאה" dir="ltr">
                    next {new Date(s.nextRunAt).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <Switch checked={s.enabled} disabled={busy} onCheckedChange={() => toggleSched(s)} aria-label={`הפעל/השהה ${s.label}`} />
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-rose-400/70" aria-label="מחק סיור" onClick={() => delSched(s.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              {h && h.schedules.length === 0 && <p className="text-xs text-zinc-600 py-4 text-center">אין סיורים — הסוכנים רק מחכים לפקודה שלך</p>}
              {!h && <p className="text-xs text-zinc-600 py-4 text-center">טוען דופק…</p>}
            </div>
          </div>

          <div>
            <p className="text-xs text-zinc-400 flex items-center gap-1.5 mb-2"><Zap className="h-3.5 w-3.5 text-amber-300" /> אירועים וטריגרים</p>
            <div className="max-h-56 overflow-y-auto scroll-thin space-y-1.5 pl-1 mb-3">
              {h && h.events.slice(0, 8).map((e) => (
                <div key={e.id} className="rounded-lg border border-zinc-800/80 bg-black/40 px-2.5 py-1.5 flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className={"text-[9px] font-mono " + (e.consumed ? "text-zinc-500 border-zinc-800" : "text-amber-300 border-amber-500/40 animate-pulse")} dir="ltr">{e.type}</Badge>
                  <span className="text-[10px] text-zinc-400 truncate flex-1" dir="ltr">
                    {e.payload?.agent ? `@${e.payload.agent}` : ""}{e.payload?.body ? ` "${e.payload.body.slice(0, 60)}"` : ""}{e.payload?.goal ? ` "${e.payload.goal.slice(0, 50)}"` : ""}
                  </span>
                  <span className="text-[9px] text-zinc-600 font-mono shrink-0">{new Date(e.createdAt).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              ))}
              {h && h.events.length === 0 && <p className="text-xs text-zinc-600 py-2 text-center">אין אירועים — הגשר שקט</p>}
            </div>
            <div className="rounded-xl border border-zinc-800/60 bg-black/20 p-2.5">
              <p className="text-[10px] text-zinc-500 mb-1.5">מדיניות-טריגרים (מוזרעת אוטומטית, מרוסנת):</p>
              <div className="space-y-1">
                {h && h.triggers.map((t) => (
                  <p key={t.id} className="text-[10px] font-mono text-zinc-500" dir="ltr">
                    {t.enabled ? "✓" : "✗"} {t.on} → {t.agentName} · budget {t.budget} · cooldown {Math.round(t.cooldownMs / 1000)}s · {t.dayCount}/{t.maxPerDay} today
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* goal initiative (proposals) + fleet memory */}
        <div className="grid gap-4 lg:grid-cols-2 mt-4">
          <div>
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <p className="text-xs text-zinc-400 flex items-center gap-1.5">
                <Lightbulb className="h-3.5 w-3.5 text-amber-300" />
                יוזמות-יעד מהסוכנים ({h?.proposals?.filter((p) => p.status === "pending").length ?? 0} ממתינות)
              </p>
              <label className="flex items-center gap-1.5 text-[10px] text-zinc-400 cursor-pointer">
                <Switch checked={h?.proposalPolicy?.autoApprove ?? false} disabled={busy || !h} onCheckedChange={togglePolicy} aria-label="מתג אישור-אוטומטי ליוזמות" />
                {h?.proposalPolicy
                  ? h.proposalPolicy.autoApprove
                    ? `אוטומטי מרוסן · ${h.proposalPolicy.maxAutoPerDay}/יום · תקציב ≤${h.proposalPolicy.maxBudget}`
                    : "רק באישור שלך"
                  : "…"}
              </label>
            </div>
            <div className="max-h-56 overflow-y-auto scroll-thin space-y-2 pl-1">
              {h && h.proposals && h.proposals.map((p) => (
                <div key={p.id} className={"rounded-xl border px-3 py-2.5 " + (p.status === "pending" ? "border-amber-500/30 bg-amber-500/5" : "border-zinc-800 bg-black/40")}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className={"text-[9px] font-mono shrink-0 " + (p.status === "pending" ? "text-amber-300 border-amber-500/40" : p.status === "launched" ? "text-emerald-300 border-emerald-500/40" : p.status === "adopted" ? "text-lime-300 border-lime-500/40" : "text-zinc-500 border-zinc-800")} dir="ltr">{p.status}{p.kind && p.kind !== "run" ? " · סיור" : ""}</Badge>
                    {p.kind && p.kind !== "run" && <span className="text-[9px] text-lime-300/80 shrink-0" title="הצעת-תעסוקה חוזרת — אישור ייצור סיור קבוע אמיתי">🌸 אדריכל-תעסוקה</span>}
                    <span className="text-[11px] font-mono text-zinc-400 shrink-0">{p.agentName}</span>
                    <span className="text-[10px] text-zinc-600 font-mono shrink-0" dir="ltr">budget {p.budget}</span>
                    {p.decidedBy && <span className="text-[9px] text-zinc-600 shrink-0">הוכרע ע&quot;י {p.decidedBy === "operator" ? "המפעיל" : "המדיניות"}</span>}
                    {p.status === "pending" && (
                      <span className="mr-auto flex gap-1.5">
                        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-emerald-300 hover:bg-emerald-500/10" disabled={busy} onClick={() => decideProposal(p.id, "approve")}>אישור</Button>
                        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-rose-300 hover:bg-rose-500/10" disabled={busy} onClick={() => decideProposal(p.id, "reject")}>דחייה</Button>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-300 mt-1.5 leading-snug">&quot;{p.goal}&quot;</p>
                  {p.rationale && <p className="text-[10px] text-zinc-500 mt-1">נימוק: {p.rationale}</p>}
                  {p.runId && <p className="text-[9px] font-mono text-zinc-600 mt-1" dir="ltr">run {p.runId.slice(0, 12)}…</p>}
                </div>
              ))}
              {h && (!h.proposals || h.proposals.length === 0) && (
                <p className="text-xs text-zinc-600 py-4 text-center">אין הצעות — סוכן חמוש ב-goal.propose יכול להציע מטרה מיוזמתו, והגבול מחליט</p>
              )}
              {!h && <p className="text-xs text-zinc-600 py-4 text-center">טוען יוזמות…</p>}
            </div>
          </div>

          <div>
            <p className="text-xs text-zinc-400 flex items-center gap-1.5 mb-2">
              <Brain className="h-3.5 w-3.5 text-purple-300" />
              זיכרון-הצי ({mem.length} ממצאים סופיים)
            </p>
            <div className="max-h-56 overflow-y-auto scroll-thin space-y-1.5 pl-1">
              {mem.map((f) => (
                <div key={f.id} className="rounded-lg border border-zinc-800/80 bg-black/40 px-2.5 py-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className={"text-[9px] font-mono shrink-0 " + (f.kind === "drift" ? "text-amber-300 border-amber-500/40" : "text-zinc-500 border-zinc-800")} dir="ltr">{f.key}</Badge>
                    <span className="text-[9px] text-zinc-600">by {f.source}</span>
                    {f.refCount > 0 && <span className="text-[9px] text-emerald-400/70">{f.refCount} קריאות</span>}
                    <span className="text-[9px] text-zinc-600 font-mono mr-auto shrink-0">{new Date(f.updatedAt).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <p className="text-[10px] text-zinc-400 mt-1 leading-snug">{f.body}</p>
                </div>
              ))}
              {mem.length === 0 && <p className="text-xs text-zinc-600 py-4 text-center">הבנק ריק — ממצא סופי ראשון יירשם כשסוכן יגלה אותו, ואז כל הצי ייהנה ממנו</p>}
            </div>
            {h?.checkerStats && h.checkerStats.verdicts > 0 && (
              <p className="text-[10px] text-zinc-500 mt-2 font-mono" dir="ltr">
                checker gate: {h.checkerStats.verdicts} verdicts · {Math.round(((h.checkerStats.firstPass + h.checkerStats.repairPass) / h.checkerStats.verdicts) * 100)}% pass ({h.checkerStats.firstPass} first-try · {h.checkerStats.repairPass} repaired) · {h.checkerStats.blocked} blocked{h.checkerStats.errors ? ` · ${h.checkerStats.errors} errors` : ""}
              </p>
            )}
          </div>
        </div>

        {/* treasury truth — the fleet's money, measured live (r21) */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <p className="text-xs text-zinc-400 flex items-center gap-1.5">
              <Wallet className="h-3.5 w-3.5 text-emerald-300" />
              אמת-הכיס — הכסף במערכת, נמדד חי ({treasury?.cached === false ? "טרי" : "מטמון 30s"})
            </p>
            {treasury && <span className="text-[10px] text-zinc-600 font-mono" dir="ltr">{new Date(treasury.measuredAt).toLocaleTimeString("he-IL")}</span>}
          </div>
          {!treasury && <p className="text-xs text-zinc-600 py-3 text-center">מודד את הכיס של הצי על שלוש-המסילות…</p>}
          {treasury && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {treasury.rails.map((r) => (
                <div key={r.rail} className={"rounded-xl border px-3 py-2.5 " + (r.ok ? "border-zinc-800 bg-black/40" : "border-rose-500/25 bg-rose-500/5")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-mono text-zinc-300" dir="ltr">{r.rail.toUpperCase()}</span>
                    <Badge variant="outline" className={"text-[9px] font-mono " + (r.ok ? "text-emerald-300 border-emerald-500/40" : "text-rose-300 border-rose-500/40")}>{r.ok ? "live" : "שגיאה"}</Badge>
                  </div>
                  {r.ok ? (
                    <>
                      <p className="text-sm font-mono text-emerald-300 mt-1" dir="ltr">{r.totals.liquid.toLocaleString("en-US", { maximumFractionDigits: 3 })} <span className="text-[10px] text-zinc-500">{r.liquidSymbol}</span></p>
                      <p className="text-xs font-mono text-amber-300/90" dir="ltr">{r.totals.debt.toLocaleString("en-US", { maximumFractionDigits: 3 })} <span className="text-[10px] text-zinc-500">{r.debtSymbol}</span></p>
                      <p className="text-[10px] text-zinc-500 mt-1">{r.accounts.length} חשבונות · חשבונות-על: {treasury.fleet?.[r.rail] ?? r.accounts.length}</p>
                      <div className="mt-1.5 max-h-24 overflow-y-auto scroll-thin">
                        {r.accounts.filter((a) => a.liquidNum > 0 || a.debtNum > 0).map((a) => (
                          <div key={a.account} className="flex items-center justify-between text-[10px] font-mono text-zinc-400 py-0.5" dir="ltr">
                            <span className="truncate max-w-[45%]">{a.account}</span>
                            <span className="text-zinc-300">{a.liquidNum.toLocaleString("en-US")} · <span className={a.debtNum > 0 ? "text-amber-300/90" : "text-zinc-600"}>{a.debtNum.toLocaleString("en-US")}</span></span>
                          </div>
                        ))}
                        {r.accounts.every((a) => a.liquidNum === 0 && a.debtNum === 0) && <p className="text-[10px] text-zinc-600 py-1">אין יתרות נזילות/חוב במסילה זו</p>}
                      </div>
                    </>
                  ) : (
                    <p className="text-[10px] text-rose-300/80 mt-1 break-all" dir="ltr">{r.error ?? "מדידה נכשלה"}</p>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-zinc-600 mt-1.5">מישור-ההמרות: לימיט-קנייה/מכירה + המרת-מדין על steem/hive — חשבון-הפקודה נבחר מתוך מפתחות-ה-active המאומתים בכספת · blurt מוצא כנות מחוץ למישור (ספר-BBD לא נמדד)</p>
        </div>

        {/* situation plane — everything in one place, zero-load (r22) */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <p className="text-xs text-zinc-400 flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-sky-300" />
              מצב-העניינים — הכל במקום אחד ({situation?.cached ? "מטמון 60s" : "טרי"})
            </p>
            {situation && <span className="text-[10px] text-zinc-600 font-mono" dir="ltr">{new Date(situation.measuredAt).toLocaleTimeString("he-IL")}</span>}
          </div>
          {!situation && <p className="text-xs text-zinc-600 py-3 text-center">מרכיב את התמונה המלאה — כסף, עיניים, ריפו-הארגון, כספת וצי…</p>}
          {situation && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* money + eyes */}
              <div className="rounded-xl border border-zinc-800 bg-black/40 px-3 py-2.5">
                <p className="text-[11px] font-mono text-zinc-300 mb-1.5">💰 היד הכלכלית</p>
                <div className="space-y-1">
                  {situation.treasury.rails.map((r) => (
                    <div key={r.rail} className="flex items-center justify-between text-[10px] font-mono" dir="ltr">
                      <span className={r.ok ? "text-zinc-400" : "text-rose-300/80"}>{r.rail.toUpperCase()}</span>
                      <span className={r.ok ? "text-emerald-300" : "text-rose-300/80"}>{r.ok ? `${r.totals.liquid.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${r.liquidSymbol}${r.totals.debt > 0 ? ` · ${r.totals.debt.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${r.debtSymbol}` : ""}` : "כשל כן"}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between text-[10px] font-mono" dir="ltr">
                    <span className={situation.evm.ethereum.ok ? "text-zinc-400" : "text-rose-300/80"}>ETH</span>
                    <span className={situation.evm.ethereum.ok ? "text-emerald-300" : "text-rose-300/80"}>{situation.evm.ethereum.ok ? `${situation.evm.ethereum.total} · ${situation.evm.ethereum.okWallets}/${situation.evm.ethereum.wallets} ארנקים` : "כשל כן"}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-mono" dir="ltr">
                    <span className={situation.evm.solana.ok ? "text-zinc-400" : "text-rose-300/80"}>SOL</span>
                    <span className={situation.evm.solana.ok ? "text-emerald-300" : "text-rose-300/80"}>{situation.evm.solana.ok ? `${situation.evm.solana.total} · ${situation.evm.solana.okWallets}/${situation.evm.solana.wallets} ארנקים` : "כשל כן"}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-mono pt-1 border-t border-zinc-800/60" dir="ltr">
                    <span className={situation.rewards.ok ? "text-zinc-400" : "text-rose-300/80"}>תגמולים-ממתינים</span>
                    {situation.rewards.ok ? (
                      situation.rewards.totalPendingSteemEquiv > 0 ? (
                        <span className="text-amber-300">{situation.rewards.totalPendingSteemEquiv.toFixed(4)} STEEM-equiv · {situation.rewards.pendingAccounts.length} חשבונות</span>
                      ) : (
                        <span className="text-zinc-500">אפס — הכל נתבע; הקציר גדל עם תעסוקת-התוכן</span>
                      )
                    ) : <span className="text-rose-300/80">כשל כן</span>}
                  </div>
                </div>
              </div>
              {/* org repos — what is happening in the OTHER repos */}
              <div className="rounded-xl border border-zinc-800 bg-black/40 px-3 py-2.5">
                <div className="flex items-center justify-between mb-1.5 gap-1 flex-wrap">
                  <p className="text-[11px] font-mono text-zinc-300">🛰️ ריפו-הארגון ({situation.repos.org})</p>
                  {situation.repos.ok && <Badge variant="outline" className={"text-[9px] font-mono " + (situation.repos.freshCount > 0 ? "text-amber-300 border-amber-500/40" : "text-zinc-500 border-zinc-700")}>{situation.repos.count} מאגרים · {situation.repos.freshCount} פעילים-עכשיו</Badge>}
                </div>
                {!situation.repos.ok && <p className="text-[10px] text-rose-300/80">{situation.repos.error ?? "סריקת-הארגון נכשלה כנה"}</p>}
                {situation.repos.ok && (
                  <div className="max-h-32 overflow-y-auto scroll-thin space-y-0.5">
                    {situation.repos.repos.map((r) => (
                      <div key={r.name} className="flex items-center justify-between text-[10px] font-mono py-0.5" dir="ltr">
                        <span className={"truncate max-w-[60%] " + (r.ours ? "text-sky-300 font-semibold" : r.fresh ? "text-amber-200/90" : "text-zinc-400")}>{r.ours ? "★ " : ""}{r.name}</span>
                        <span className="flex items-center gap-1 text-zinc-500">
                          {r.fresh && <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" aria-label="פעיל עכשיו" />}
                          {r.pushedMinutesAgo !== null ? (r.pushedMinutesAgo < 60 ? `${r.pushedMinutesAgo} דק׳` : r.pushedMinutesAgo < 1440 ? `${Math.floor(r.pushedMinutesAgo / 60)} שע׳` : `${Math.floor(r.pushedMinutesAgo / 1440)} ימ׳`) : "?"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {situation.repos.ok && (situation.repos.broadcastTotal ?? 0) > 0 && (
                  <div className="mt-1.5 pt-1.5 border-t border-zinc-800/80">
                    <p className="text-[10px] font-mono text-emerald-300/90 mb-0.5">📡 שידורים-נכנסים ({situation.repos.broadcastTotal}) — ערוץ הדדי</p>
                    <div className="space-y-0.5 max-h-16 overflow-y-auto scroll-thin">
                      {(situation.repos.broadcasts ?? []).filter((b) => b.count > 0).map((b) => (
                        <div key={b.repo} className="flex items-center justify-between gap-2 text-[9px] font-mono" dir="ltr">
                          <span className={(b.ours ? "text-sky-300 font-semibold" : "text-emerald-200/90") + " truncate max-w-[45%]"}>{b.ours ? "★ " : ""}{b.repo}</span>
                          <span className="text-zinc-500 truncate max-w-[50%]" title={b.latest ?? ""}>{b.latest} ×{b.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {digest && !digest.error && digest.scannedRepos > 0 && (
                  <div className="mt-1 pt-1 border-t border-zinc-800/60">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-[10px] font-mono text-sky-300/90">🧠 מישור-ההבנה — הכספת קוראת</p>
                      <span className="text-[9px] font-mono text-zinc-500" dir="ltr">{digest.fetched}/{digest.scannedRepos} נקראו · {digest.echoesOfOurs} הדים-שלנו · דלת {digest.door?.incoming ?? 0}</span>
                    </div>
                    {digest.door && digest.door.checked && digest.door.incoming > 0 && (
                      <div className="mt-1 rounded-lg border border-emerald-900/60 bg-emerald-950/20 px-2 py-1.5">
                        <p className="text-[10px] font-mono text-emerald-300">🚪 דלת-קדמית — {digest.door.incoming} דופק/ים ב-broadcasts/ שלנו (r26 · טביעת-אצבע r27 · אמת-מסלול r29 · תעלה-נקייה r35){digest.door.voices.length < digest.door.incoming && <span className="text-zinc-500"> · להלן דגימת {digest.door.voices.length} (חלון-קריאה מוגבל, שאר הדופקים נספרים אך לא נשלפים — חוק-האפס-עומס)</span>}</p>
                        {digest.door.voices.filter((v) => v.ok && !v.selfEcho).map((v) => (
                          <div key={v.file} className="mt-0.5 text-[9px] font-mono" dir="ltr">
                            <span className={v.isNew ? "text-amber-300 font-semibold" : "text-emerald-200/90"}>{v.isNew ? "NEW " : ""}[{v.kind}] {v.file}</span>
                            <span className="text-zinc-500"> — {v.headline.slice(0, 52)}</span>
                            {v.asks.slice(0, 2).map((a, k) => (
                              <div key={k} className="text-amber-200/70 truncate max-w-[95%]" title={a}>? {a.slice(0, 66)}</div>
                            ))}
                          </div>
                        ))}
                        {(digest.door.selfEchoVoices ?? 0) > 0 && <p className="text-[9px] font-mono text-zinc-500" dir="rtl">🪞 {digest.door.selfEchoVoices} רישום-שידור-שלנו על-הדלת — זוהה בטביעת-אצבע (תוכן-זהה למסמך-שחיברנו), לא דופק (r27)</p>}
                        {digest.door.voices.some((v) => !v.ok) && <p className="text-[9px] text-rose-300/70 mt-0.5">דופק-שלא-נקרא: {digest.door.voices.filter((v) => !v.ok).length} תוכן-לא-הושג (כנות)</p>}
                      </div>
                    )}
                    {digest.door && digest.door.error && <p className="text-[9px] text-rose-300/70 mt-0.5">🚪 {digest.door.error}</p>}
                    {digest.rootVoices && digest.rootVoices.checked && digest.rootVoices.voices.length > 0 && (
                      <div className="mt-0.5 pt-0.5 border-t border-zinc-800/50">
                        <p className="text-[10px] font-mono text-amber-300/90">🪓 קולות-שורש — {digest.rootVoices.voices.length} דוחות-שותף בשורש-הריפו (עקפו-את-הערוץ)</p>
                        <div className="space-y-0.5 max-h-16 overflow-y-auto scroll-thin">
                          {digest.rootVoices.voices.map((v) => (
                            <div key={v.file} className="text-[9px] font-mono" dir="ltr">
                              <span className={v.isNew ? "text-amber-300 font-semibold" : "text-amber-200/80"}>{v.isNew ? "NEW " : ""}{v.file}</span>
                              <span className="text-zinc-500"> — {v.headline.slice(0, 48)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {digest.partnerVoices > 0 && (
                      <div className="mt-0.5 space-y-0.5 max-h-20 overflow-y-auto scroll-thin">
                        {digest.items.filter((i) => i.ok && !i.ours && !i.echo).map((i) => (
                          <div key={i.repo} className="text-[9px] font-mono" dir="ltr">
                            <span className={i.isNew ? "text-amber-300 font-semibold" : "text-emerald-200/90"}>{i.isNew ? "NEW " : ""}[{i.kind}] {i.repo}</span>
                            <span className="text-zinc-500"> — {i.headline.slice(0, 55)}</span>
                            {i.asks.slice(0, 2).map((a, k) => (
                              <div key={k} className="text-amber-200/70 truncate max-w-[95%]" title={a}>? {a.slice(0, 68)}</div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                    {digest.suggestedResponse.needed ? (
                      <div className="mt-0.5">
                        <p className="text-[9px] text-sky-300/80">✍️ טיוטת-תשובה מוכנה עבור {digest.suggestedResponse.toRepo} — השליחה החלטת-מפעיל/סוכן (fleet.digest)</p>
                        {digest.suggestedResponse.draft && (
                          <div className="mt-0.5 space-y-0.5 max-h-14 overflow-y-auto scroll-thin">
                            {digest.suggestedResponse.draft.slice(0, 4).map((d, k) => (
                              <p key={k} className="text-[9px] text-sky-200/60 truncate" title={d} dir="rtl">↳ {d.slice(0, 90)}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-[9px] text-zinc-600 mt-0.5">{digest.suggestedResponse.reason}</p>
                    )}
                  </div>
                )}
                {digest?.error && <p className="text-[9px] text-rose-300/70 mt-1">🧠 קריאת-השידורים: {digest.error}</p>}
                <p className="text-[9px] text-zinc-600 mt-1.5">★ = הריפו שלנו · עדכון-חי על 10 דק׳ · נקודה-כתומה = סוכן-אחר דחף עכשיו · 📡 ערוץ-הדדי (r24) + 🧠 קריאה (r25) + 🚪 דלת-קדמית וקולות-שורש (r26) — הכספת שומעת, מבינה, וגם רואה מי-דופק-בדלת-שלה</p>
              </div>
              {/* vault + fleet + anchors */}
              <div className="rounded-xl border border-zinc-800 bg-black/40 px-3 py-2.5">
                <p className="text-[11px] font-mono text-zinc-300 mb-1.5">🔐 הכספת והצי</p>
                <div className="space-y-1 text-[10px] font-mono">
                  <div className="flex items-center justify-between" dir="ltr">
                    <span className="text-zinc-400">vault</span>
                    <span className="text-zinc-200">{situation.vault.ok ? `${situation.vault.total} · ${situation.vault.verified} verified (status-col)` : "כשל כן"}</span>
                  </div>
                  <div className="flex items-center justify-between" dir="ltr">
                    <span className="text-zinc-400">fleet</span>
                    <span className={situation.fleet.ok ? "text-zinc-200" : "text-rose-300/80"}>{situation.fleet.ok ? `${situation.fleet.agents} סוכנים (${situation.fleet.autonomous} אוטונומיים) · ${situation.fleet.activeRuns} ריצות-חיות` : "כשל כן"}</span>
                  </div>
                  <div className="flex items-center justify-between" dir="ltr">
                    <span className="text-zinc-400">anchors</span>
                    <span className="text-zinc-200">{situation.anchors.ok ? `${situation.anchors.count} רשומים · עדכני: ${situation.anchors.latest[0] ? `${situation.anchors.latest[0].chain} blk ${situation.anchors.latest[0].blockNum ?? "?"}` : "—"}` : "כשל כן"}</span>
                  </div>
                  <div className="flex items-center justify-between" dir="ltr">
                    <span className="text-zinc-400">chains</span>
                    <span className="text-zinc-500 truncate max-w-[65%]">{Object.entries(situation.vault.chains).map(([c, n]) => `${c}:${n}`).join(" · ")}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
          <p className="text-[10px] text-zinc-600 mt-1.5">העיקרון (r22): הכספת רואה את כל היד — מה יש, מה אין, מה קורה בכל מקום (כולל שאר-הריפו של הארגון) — בקריאה אחת בלי עומס. הסוכנים קוראים את אותה-אמת דרך fleet.situation</p>
        </div>

        {/* sovereign hand — the controlled signing queue */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <p className="text-xs text-zinc-400 flex items-center gap-1.5">
              <Hand className="h-3.5 w-3.5 text-orange-300" />
              יד-ריבונית — תור-החתימות ({orders?.orders?.filter((o) => o.status === "pending").length ?? 0} ממתינות)
            </p>
            <span className="text-[10px] text-zinc-500 font-mono" dir="ltr">
              signed {orders?.signedToday ?? 0}/{orders?.rails.maxSignedPerDay ?? 6} today · ≤{orders?.rails.maxNotionalSteem ?? 100} per order · חשבון-הפקודה: מפתח-active מאומת מהכספת · r39: סוכן בדרגת auto חותם-לבד בתוך-התקרות שלו
            </span>
          </div>
          {orders && !orders.vaultOpen && (orders?.orders?.some((o) => o.status === "pending") ?? false) && (
            <p className="text-[10px] text-amber-300/90 mb-2">הכספת נעולה — פתח אותה כדי לחתום על פקודות ממתינות (אישור על כספת-סגורה נדחה בכנות)</p>
          )}
          <div className="max-h-56 overflow-y-auto scroll-thin space-y-2 pl-1">
            {orders?.orders?.map((o) => {
              let pv: { side?: string; amount?: string; price?: string; total?: string; orderid?: number; note?: string; rail?: string } = {};
              try { pv = JSON.parse(o.preview || "{}"); } catch { /* dim row */ }
              const railChip = (pv.rail && pv.rail !== "steem") ? <Badge variant="outline" className="text-[9px] font-mono shrink-0 text-sky-300 border-sky-500/40" dir="ltr">{pv.rail}</Badge> : null;
              const what = o.op === "limit_order_cancel"
                ? `ביטול הזמנה #${pv.orderid ?? "?"}`
                : o.op === "convert"
                  ? `המרת-מדין ${pv.amount ?? "?"}`
                  : `${pv.side === "buy" ? "קניית" : "מכירת"} ${pv.amount ?? "?"} @ ${pv.price ?? "?"}`;
              return (
                <div key={o.id} className={"rounded-xl border px-3 py-2.5 " + (o.status === "pending" ? "border-orange-500/30 bg-orange-500/5" : o.status === "signed" ? "border-emerald-500/25 bg-emerald-500/5" : "border-zinc-800 bg-black/40 opacity-70")}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className={"text-[9px] font-mono shrink-0 " + (o.status === "pending" ? "text-orange-300 border-orange-500/40" : o.status === "signed" ? "text-emerald-300 border-emerald-500/40" : "text-zinc-500 border-zinc-800")} dir="ltr">{o.status}</Badge>
                    <span className="text-[11px] font-mono text-zinc-400 shrink-0">{o.agentName}</span>
                    {o.status === "pending" && orders?.tiers?.[o.agentName] && (
                      <Badge variant="outline" className={"text-[9px] font-mono shrink-0 " + (orders.tiers[o.agentName].finTier === "autonomous-limited" ? "text-amber-300 border-amber-500/40" : "text-zinc-500 border-zinc-800")} dir="ltr">
                        fin:{orders.tiers[o.agentName].finTier === "autonomous-limited" ? `auto≤${orders.tiers[o.agentName].finCaps?.maxNotionalPerOrder ?? 0.5}` : orders.tiers[o.agentName].finTier}
                      </Badge>
                    )}
                    <span className="text-[11px] font-mono text-zinc-500 shrink-0" dir="ltr">@{o.account}{pv.rail ? `·${pv.rail}` : ""}</span>
                    {railChip}
                    <span className="text-[10px] text-zinc-300">{what}</span>
                    <span className="text-[9px] text-zinc-600 font-mono shrink-0" dir="ltr">#{pv.orderid ?? "—"}</span>
                    {o.decidedBy && <span className="text-[9px] text-zinc-600 shrink-0">הוכרע ע"י {o.decidedBy === "operator" ? "המפעיל" : o.decidedBy}</span>}
                    {o.status === "pending" && (
                      <span className="mr-auto flex gap-1.5">
                        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-emerald-300 hover:bg-emerald-500/10" disabled={busy} onClick={() => decideOrder(o.id, "approve")}>חתום ושדר</Button>
                        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-rose-300 hover:bg-rose-500/10" disabled={busy} onClick={() => decideOrder(o.id, "reject")}>דחייה</Button>
                      </span>
                    )}
                  </div>
                  {o.status === "signed" && o.broadcastId && (
                    <p className="text-[10px] font-mono text-emerald-400/80 mt-1.5 break-all" dir="ltr">tx {o.broadcastId}{o.blockNum ? ` · block ${o.blockNum}` : ""}</p>
                  )}
                  {o.error && <p className="text-[10px] text-rose-300/70 mt-1.5">{o.error}</p>}
                  {o.status === "pending" && <p className="text-[9px] text-zinc-600 mt-1">{pv.note ?? "הפקודה אינה חתומה — הכספת תחתום רק באישורך"}</p>}
                </div>
              );
            })}
            {orders && orders.orders.length === 0 && (
              <p className="text-xs text-zinc-600 py-4 text-center">אין פקודות — סוכן חמוש ב-steem.order.build מכין פקודת-המרה אמתית (בכל חשבון-צי ושתי-המסילות), ואתה חותם (או לא)</p>
            )}
            {!orders && <p className="text-xs text-zinc-600 py-4 text-center">טוען תור-חתימות…</p>}
          </div>
        </div>

        {/* create patrol form */}
        <AnimatePresence>
          {formOpen && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="mt-4 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4 space-y-2.5">
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="שם-הסיור (לדוגמה: בדיקת-שרשרת תקופתית)" className="text-sm bg-zinc-950/80 border-zinc-800" />
                  <select value={pAgent} onChange={(e) => setPAgent(e.target.value)} className="w-full rounded-md border border-zinc-800 bg-zinc-950/80 px-3 py-2 text-sm font-mono text-zinc-200" dir="ltr" aria-label="סוכן לסיור">
                    <option value="">— בחר סוכן —</option>
                    {activeAgents.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
                  </select>
                </div>
                <Textarea value={pGoal} onChange={(e) => setPGoal(e.target.value)} placeholder="מה הסוכן עושה בכל סבב? לדוגמה: בדוק את בריאות השרשרת ואת יתרות headcorner, ודווח לגשר בעברית בשורה-אחת" className="min-h-[64px] text-sm bg-zinc-950/80 border-zinc-800" />
                <div className="flex items-center gap-3 flex-wrap text-xs text-zinc-400">
                  <span className="flex items-center gap-1.5">קצב:
                    <select value={everyMin} onChange={(e) => setEveryMin(Number(e.target.value))} className="rounded-md border border-zinc-800 bg-zinc-950/80 px-2 py-1 text-xs font-mono text-zinc-200" dir="ltr" aria-label="קצב הסיור בדקות">
                      {[15, 30, 60, 180, 480, 1440].map((m) => <option key={m} value={m}>{m >= 1440 ? "24h" : m >= 60 ? `${m / 60}h` : `${m}m`}</option>)}
                    </select>
                  </span>
                  <span className="flex items-center gap-1.5">מקס/יום:
                    <Input type="number" min={1} max={48} value={maxDay} onChange={(e) => setMaxDay(Math.max(1, Math.min(48, Number(e.target.value) || 1)))} className="w-16 h-8 text-xs bg-zinc-950/80 border-zinc-800" dir="ltr" />
                  </span>
                  <span className="text-[10px] text-zinc-600">קריטריוני-סיום ברירת-מחדל: כלים חיים + דוח עברית לגשר</span>
                </div>
                <Button onClick={createSchedule} disabled={busy || !label.trim() || !pAgent || pGoal.trim().length < 12} className="w-full gap-2 bg-emerald-600 hover:bg-emerald-500 text-black font-bold">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />} קבע סיור אוטונומי
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </GlowCard>
    </motion.div>
  );
}

/* ══════════════════════════ 04 · autonomy plane (r38) ══════════════════════════
   סעיף-עצמאי בקונסולה: לב-האוטונומיה עם כל הבקרה. נשלף מתוך סעיף-הסוכנים
   כדי שלכל מישור תהיה כתובת אחת ברורה בניווט. */

export function AutonomySection() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  useEffect(() => {
    apiJson<{ ok: boolean; agents: AgentRow[] }>("/api/gate/agents").then((r) => {
      if (r?.ok) setAgents(r.agents || []);
    });
  }, []);
  return (
    <section className="py-10">
      <SectionHead
        num="04"
        title="לב-האוטונומיה"
        sub="הסוכנים קמים לבד: סיורים מתוכננים, טריגרים, יוזמות-מרוסנות, זיכרון-צי, יד-ריבונית על תור-החתימות — והכול עם kill-switch אחד שלך."
      />
      <AutonomyCard agents={agents} />
    </section>
  );
}
