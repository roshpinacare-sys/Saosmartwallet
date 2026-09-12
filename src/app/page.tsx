"use client";

/**
 * SAOS SOVEREIGN VAULT — קונסולת-פיקוד ריבונית (r38 · סדר-הקונסולה).
 *
 * r38: סוף עידן דף-הנחיתה. העמוד הוא עתה קונסולה מסודרת:
 *  · סרגל-ניווט (דסקטופ: סרגל-צד דביק · מובייל: שורת-צ'יפים גוללת)
 *  · 00 סקירה — לוח-פיקוד אמיתי במקום Hero (KPIs, לב, כסף, דלת, עוגנים, ארגון)
 *  · 05 ערוץ — מישור-ההבנה במלואו + טיוטת-תשובה עם העתקה (פער-ר38)
 *  · הזרקת-מפתח חוזרת להיות מוצגת בסעיף-הכספת (היה קוד-מת-שלא-רונדר — פער-ר38)
 *  · מסך-הנעילה וכל המישורים הקיימים נשמרו כמות-שהם — אפס פגיעה בפונקציונליות.
 *
 * כל הנתונים מה-APIs האמיתיים של src/app/api/gate · אפס דמו.
 * אימות: טוקן-סשן בכותרת x-gate-token (עמיד ל-iframe) + קוקי כגיבוי.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  KeyRound, LogOut, Globe, Github, Lock, Bot, HeartPulse, RadioTower, Radio,
  LayoutDashboard, History, Terminal, Smartphone, AlertTriangle,
  ShieldCheck, ShieldAlert, Loader2, RefreshCw, Copy, Eye, EyeOff, CheckCircle2,
  XCircle, MinusCircle, Search, Save, Send, UserCheck, Cpu, Crosshair, Layers,
  ListChecks, Play, Plus, Trash2, Unplug, Clock, Zap, Lightbulb, Brain, Hand,
  Activity, Wallet, Braces, ScrollText, ArrowDown, Link2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  VaultSeal, SectionHead, LiveDot, copyText, GlowCard, FilterChip, Scramble,
  api, apiJson, ENDPOINTS, rise, setToken, getDeviceToken, setDeviceToken, getDeviceId,
} from "@/components/console/kit";
import type {
  GateStatus, Entry, Inventory, AgentRow, ModuleDef, TraceStep, CheckerVerdict,
  RunRow, RunDetail, AgentStat, DeviceRow, Msg, ActionRow, ScheduleRow, EventRow,
  TriggerRow, ProposalRow, ProposalPolicyRow, CheckerStatsRow, MemoryRow, PulseRow,
  HeartData, OrderRow, OrdersData, TreasuryRow, TreasuryRail, TreasurySnapshot,
  SituationData, DigestData, KeyReport, DrillResult, ModStats, Ep,
} from "@/components/console/types";
import { LockScene } from "@/components/console/lock-scene";
import { Overview } from "@/components/console/overview";
import { Channel } from "@/components/console/channel";

/* ══════════════════════════ console navigation (r38) ══════════════════════════ */

type SectionId =
  | "overview" | "connections" | "vault" | "agents" | "autonomy"
  | "channel" | "bridge" | "audit" | "console" | "devices" | "emergency";

const SECTIONS: Array<{ id: SectionId; label: string; icon: LucideIcon; num: string }> = [
  { id: "overview", label: "סקירה", icon: LayoutDashboard, num: "00" },
  { id: "connections", label: "חיבורים", icon: Globe, num: "01" },
  { id: "vault", label: "כספת", icon: Lock, num: "02" },
  { id: "agents", label: "סוכנים", icon: Bot, num: "03" },
  { id: "autonomy", label: "אוטונומיה", icon: HeartPulse, num: "04" },
  { id: "channel", label: "ערוץ", icon: RadioTower, num: "05" },
  { id: "bridge", label: "פיקוד", icon: Radio, num: "06" },
  { id: "audit", label: "ביקורת", icon: History, num: "07" },
  { id: "console", label: "מסוף", icon: Terminal, num: "08" },
  { id: "devices", label: "מכשירים", icon: Smartphone, num: "09" },
  { id: "emergency", label: "חירום", icon: AlertTriangle, num: "10" },
];

/* ══════════════════════════ root ══════════════════════════ */

export default function Page() {
  const [booting, setBooting] = useState(true);
  const [status, setStatus] = useState<GateStatus | null>(null);
  const [sealState, setSealState] = useState<"locked" | "verifying" | "open">("locked");
  const [deviceRemembered, setDeviceRemembered] = useState(false);
  // ROAST r9 gap-38: the old amber warning ("היה כאן טוקן-מכשיר שנפסל") was
  // DEAD CODE — it rendered off `deviceRemembered`, the very state the failure
  // path cleared. Rejection now has its own flag; the warning actually shows.
  const [deviceRejected, setDeviceRejected] = useState(false);
  // r38 — the active console section (sidebar / chips navigation)
  const [active, setActive] = useState<SectionId>("overview");

  const refreshStatus = useCallback(async (): Promise<boolean> => {
    const s = await apiJson<GateStatus>("/api/gate/status");
    if (s?.ok) {
      setStatus(s);
      setSealState(s.session ? "open" : "locked");
      return Boolean(s.session);
    }
    return false;
  }, []);

  useEffect(() => {
    (async () => {
      let okIn = await refreshStatus();
      // secure "remember me": no live session but this browser holds a trusted
      // device token → re-open the vault without ever pasting a key again
      if (!okIn && getDeviceToken()) {
        setDeviceRemembered(true);
        try {
          const r = await fetch("/api/gate/device/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deviceToken: getDeviceToken() }),
          }).then((x) => x.json());
          if (r?.ok && r.token) {
            setToken(r.token as string);
            okIn = await refreshStatus();
            if (okIn) toast.success("חזרת בביטחון ממכשיר מוכר — בלי להדביק מפתח");
          } else {
            // the device was revoked/expired — clear the inert token, honest state
            setDeviceToken(null);
            setDeviceRemembered(false);
            setDeviceRejected(true); // r9 gap-38: the warning must actually render
            toast.warning("טוקן-המכשיר של הדפדפן הזה נשלל או פג-תוקף (הצופן נמחק מה-DB) — הכניסה הבאה במפתח תחמש מכשיר חדש");
          }
        } catch { /* network hiccup — the lock screen stays honest */ }
      }
      // open gate: token-only entry (operator policy — "זה רק אני ואתה").
      // The server re-lights the vault from its own lifeline token; no key needed.
      if (!okIn) {
        try {
          const s = await fetch("/api/gate/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((x) => x.json());
          if (s?.ok && s?.in && s?.token) {
            setToken(s.token as string);
            okIn = await refreshStatus();
            if (okIn) toast.success("השער נפתח בטוקן — בלי להדביק מפתח");
          }
        } catch { /* the lock screen stays honest */ }
      }
      setBooting(false);
    })();
  }, [refreshStatus]);

  async function logout() {
    setSealState("locked");
    await apiJson("/api/gate/lock", { method: "POST" });
    setToken(null);
    setStatus(null);
    setActive("overview");
    toast("הכספת נאטמה — מפתח-האב נמחק מהזיכרון");
  }

  // r38 — section switching scrolls back to the top of the console
  function go(id: SectionId) {
    setActive(id);
    requestAnimationFrame(() => window.scrollTo({ top: 0 }));
  }

  const wrapper = "min-h-screen flex flex-col bg-[#050505] text-zinc-100 relative overflow-x-hidden";

  if (booting) {
    return (
      <div dir="rtl" className={wrapper}>
        <div className="flex-1 flex items-center justify-center">
          <VaultSeal seals={status?.keySeals || 8} state="verifying" size={220} />
        </div>
      </div>
    );
  }

  if (!status?.session) {
    return (
      <div dir="rtl" className={wrapper}>
        <Backdrop />
        <LockScene
          status={status}
          state={sealState}
          deviceRemembered={deviceRemembered}
          deviceRejected={deviceRejected}
          onVerifying={() => setSealState("verifying")}
          onFail={() => setSealState("locked")}
          onIn={async (token) => {
            setToken(token);
            const okIn = await refreshStatus();
            if (okIn) toast.success("הכספת נפתחה — כל המפתחות בפנים");
            else { setSealState("locked"); toast.error("האימות השתבש — נסה שוב"); }
            return okIn;
          }}
        />
      </div>
    );
  }

  const activeMeta = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];

  return (
    <div dir="rtl" className={wrapper}>
      <Backdrop />
      <div className="relative z-10 flex-1 flex flex-row">
        {/* ── sidebar — desktop (RTL: renders on the right) ── */}
        <aside className="hidden lg:flex flex-col w-60 shrink-0 sticky top-0 h-screen border-l border-zinc-900 bg-black/60 backdrop-blur-md">
          <div className="px-5 py-3.5 border-b border-zinc-900 flex items-center gap-2.5">
            <VaultSeal seals={status.keySeals} state="open" size={36} />
            <div className="min-w-0">
              <p className="font-black tracking-tight text-sm leading-tight">SOVEREIGN <span className="text-emerald-400">VAULT</span></p>
              <p className="text-[10px] font-mono text-emerald-400/90">פתוחה · {status.keySeals} חותמות</p>
            </div>
          </div>
          <nav aria-label="ניווט-הקונסולה" className="flex-1 overflow-y-auto scroll-thin px-3 py-3 space-y-1">
            {SECTIONS.map((s) => {
              const on = active === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => go(s.id)}
                  aria-current={on ? "page" : undefined}
                  className={
                    "w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-all border " +
                    (on
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200 font-bold"
                      : "border-transparent text-zinc-400 hover:bg-zinc-900/70 hover:text-zinc-200")
                  }
                >
                  <s.icon className={"h-4 w-4 shrink-0 " + (on ? "text-emerald-400" : "text-zinc-500")} aria-hidden />
                  <span className="flex-1 text-right">{s.label}</span>
                  <span className={"font-mono text-[9px] " + (on ? "text-emerald-400/70" : "text-zinc-700")}>{s.num}</span>
                </button>
              );
            })}
          </nav>
          <div className="px-4 py-3.5 border-t border-zinc-900 space-y-2">
            <p className="text-[10px] text-zinc-500 leading-relaxed">
              מחובר כ-<b className="text-zinc-300">{status.session.name}</b> · סשן 30 יום
              {deviceRemembered && <span className="text-emerald-500/80"> · מכשיר זכור ✓</span>}
            </p>
            <Button variant="outline" size="sm" onClick={logout} className="w-full gap-1.5 border-zinc-800 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10">
              <LogOut className="h-3.5 w-3.5" /> אטום את הכספת
            </Button>
          </div>
        </aside>

        {/* ── content column ── */}
        <div className="flex-1 min-w-0 flex flex-col">
          <header className="sticky top-0 z-30 border-b border-zinc-900 bg-black/70 backdrop-blur-md">
            <div className="max-w-6xl mx-auto px-4 md:px-6 h-14 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 lg:hidden min-w-0">
                <VaultSeal seals={status.keySeals} state="open" size={30} />
                <span className="font-black tracking-tight text-sm truncate">SOVEREIGN <span className="text-emerald-400">VAULT</span></span>
              </div>
              <div className="hidden lg:flex items-center gap-2.5 font-mono text-[11px] text-zinc-500" dir="ltr">
                <span className="text-emerald-400 font-bold">{activeMeta.num}</span>
                <span className="text-zinc-300 font-sans font-bold" dir="rtl">{activeMeta.label}</span>
                <span className="text-zinc-700">·</span>
                <span>secrets <b className="text-zinc-300">{status.counts.vaultEntries}</b></span>
                <span>agents <b className="text-zinc-300">{status.counts.activeAgents}</b></span>
                <span>msgs <b className="text-zinc-300">{status.counts.messages}</b></span>
              </div>
              <Button variant="outline" size="sm" onClick={logout} className="lg:hidden gap-1.5 border-zinc-800 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10">
                <LogOut className="h-3.5 w-3.5" /> אטום
              </Button>
            </div>
            {/* mobile chips — sections within thumb reach */}
            <div className="lg:hidden border-t border-zinc-900/70 bg-black/60">
              <div role="tablist" aria-label="סעיפי-הקונסולה" className="flex gap-1.5 overflow-x-auto scroll-thin px-3 py-2">
                {SECTIONS.map((s) => {
                  const on = active === s.id;
                  return (
                    <button
                      key={s.id}
                      role="tab"
                      aria-selected={on}
                      onClick={() => go(s.id)}
                      className={
                        "shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-mono transition-all " +
                        (on
                          ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-300"
                          : "bg-zinc-900/60 border-zinc-800 text-zinc-400")
                      }
                    >
                      <s.icon className="h-3 w-3" aria-hidden /> {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </header>

          <main className="flex-1 w-full max-w-6xl mx-auto px-4 md:px-6">
            {active === "overview" && <Overview status={status} />}
            {active === "connections" && <Connections />}
            {active === "vault" && <VaultGrid />}
            {active === "agents" && <Agents />}
            {active === "autonomy" && <AutonomySection />}
            {active === "channel" && <Channel />}
            {active === "bridge" && <Bridge />}
            {active === "audit" && <Audit />}
            {active === "console" && <ApiConsole />}
            {active === "devices" && <TrustedDevices />}
            {active === "emergency" && <EmergencyZone onAfter={refreshStatus} />}
            <div className="h-8" />
          </main>

          <footer className="mt-auto border-t border-zinc-900 bg-black/60 backdrop-blur">
            <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-600">
              <span className="font-mono tracking-widest">SAOS SOVEREIGN VAULT · AES-256-GCM · scrypt(2¹⁵) · r38-console</span>
              <span>
                מחובר כ-<b className="text-zinc-400">{status.session.name}</b> · {status.keySeals} חותמות-מפתח · סשן 30 יום
                {deviceRemembered && <span className="text-emerald-500/80"> · מכשיר זכור ✓</span>}
              </span>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════ backdrop ══════════════════════════ */

function Backdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
      <div className="absolute inset-0 opacity-[0.13]"
        style={{ backgroundImage: "linear-gradient(#18181b 1px, transparent 1px), linear-gradient(90deg, #18181b 1px, transparent 1px)", backgroundSize: "56px 56px" }} />
      <div className="absolute -top-40 right-1/4 h-96 w-96 rounded-full bg-emerald-500/10 blur-[130px]" />
      <div className="absolute top-1/3 -left-32 h-80 w-80 rounded-full bg-amber-500/8 blur-[120px]" />
      <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-emerald-400/6 blur-[110px]" />
    </div>
  );
}


function Connections() {
  const [inv, setInv] = useState<Inventory | null>(null);
  const [busy, setBusy] = useState(true);

  const load = useCallback(async () => {
    const i = await apiJson<Inventory>("/api/gate/inventory");
    setInv(i);
    setBusy(false);
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  const verifyAll = useCallback(() => { setBusy(true); return load(); }, [load]);

  const chains = inv?.chains;
  const summary = inv?.summary;
  const byChain = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of inv?.entries || []) {
      const c = (e.chain || e.kind).toLowerCase();
      m[c] = (m[c] || 0) + 1;
    }
    return m;
  }, [inv]);

  const cards = [
    {
      name: "STEEM", icon: <Globe className="h-5 w-5" />, ok: chains?.steemOk,
      endpoint: "api.steemit.com", count: summary?.rails?.steem ?? 0, secrets: byChain["steem"] || 0,
    },
    {
      name: "HIVE", icon: <Globe className="h-5 w-5" />, ok: chains?.hiveOk,
      endpoint: "api.hive.blog", count: summary?.rails?.hive ?? 0, secrets: byChain["hive"] || 0,
    },
    {
      name: "BLURT", icon: <Globe className="h-5 w-5" />, ok: chains?.blurtOk,
      endpoint: "blurt-rpc.saboin.com", count: summary?.rails?.blurt ?? 0, secrets: byChain["blurt"] || 0,
    },
    {
      name: "GITHUB", icon: <Github className="h-5 w-5" />, ok: chains?.githubOk,
      endpoint: "api.github.com", count: summary?.rails?.github ?? 0, secrets: byChain["github"] || 0,
    },
  ];

  return (
    <section className="py-14">
      <SectionHead num="01" title="החיבורים — הוכחה חיה" sub="כל שרשרת נבדקת מול הרשת בפועל, עכשיו. אין מצב-מדומה." />
      <motion.div {...rise} className="flex justify-end mb-4">
        <Button variant="outline" size="sm" onClick={verifyAll} className="gap-1.5 border-zinc-800 hover:border-emerald-500/40">
          <RefreshCw className={"h-3.5 w-3.5" + (busy ? " animate-spin" : "")} /> אמת הכל עכשיו
        </Button>
      </motion.div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {cards.map((c, i) => (
          <motion.div key={c.name} {...rise} transition={{ ...rise.transition, delay: i * 0.08 }}>
            <GlowCard className={"p-6 h-full relative overflow-hidden " + (c.ok === true ? "border-emerald-500/30" : c.ok === false ? "border-rose-500/30" : "")}>
              {c.ok === true && <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-l from-transparent via-emerald-400/70 to-transparent" />}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 text-zinc-200">{c.icon}<span className="font-mono font-bold tracking-wider">{c.name}</span></div>
                {c.ok === true
                  ? <span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" /></span>
                  : c.ok === false
                    ? <span className="h-3 w-3 rounded-full bg-rose-500" />
                    : <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />}
              </div>
              <p className="mt-4 font-mono text-3xl font-black">{busy && !inv ? "…" : c.count}</p>
              <p className="text-xs text-emerald-500/90 mt-1">מפתחות עם סמכות-חיה ברשת</p>
              <p className="text-xs text-zinc-500 mt-0.5">{c.secrets} סודות בכספת</p>
              <p className="mt-3 font-mono text-[10px] text-zinc-600" dir="ltr">{c.endpoint}</p>
            </GlowCard>
          </motion.div>
        ))}
      </div>
      {summary && (
        <motion.p {...rise} className="mt-4 font-mono text-xs text-zinc-500">
          אימות-חי אחרון: <b className="text-emerald-400">{summary.verified}</b> עברו ·{" "}
          {(() => {
            // r19 — rotated-out rows are history by design (their keys left the
            // chain on purpose); counting them as "failures" was a living lie
            const realFailed = summary.failed - (summary.rotatedOut ?? 0);
            return (
              <>
                {realFailed > 0 ? <span className="text-rose-400">{realFailed} נכשלו</span> : <span className="text-zinc-600">0 נכשלו</span>}
                {(summary.rotatedOut ?? 0) > 0 && <span className="text-zinc-500"> · {summary.rotatedOut} rotated-out (היסטוריה-מכוונת)</span>}
              </>
            );
          })()}{" "}
          {summary.noLive} ללא-בדיקה-אפשרית
          {summary.rails && (
            <> · סמכויות-חיה: steem {summary.rails.steem ?? 0} · hive {summary.rails.hive ?? 0} · blurt {summary.rails.blurt ?? 0} · ETH {summary.rails.ethereum ?? 0} · TRX {summary.rails.tron ?? 0} · SOL {summary.rails.solana ?? 0} · BTC {summary.rails.bitcoin ?? 0}</>
          )}
        </motion.p>
      )}
    </section>
  );
}


/* ═════════════════ r16 — SOVEREIGN ROTATION PANEL (gap-58) ═════════════════
   "לחבר את כולם": the operator pastes each account's current owner key →
   live-verified against the chain in the same call → sealed → and rotation
   (account_update) sets all four steem authorities to the D1 roots the vault
   already holds (unified with hive+blurt). Operator-only plane — agents have
   no path here. Every verdict is the chain's answer, never an assumption. */
function RotationPanel({ inv, onDone }: { inv: Inventory | null; onDone: () => void }) {
  const rot = inv?.rotation || null;
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [verdicts, setVerdicts] = useState<Array<{ account: string; ok: boolean; detail: string }> | null>(null);
  const [rotated, setRotated] = useState<Record<string, { txId: string; verified: boolean; detail: string }>>({});
  const targets = rot?.targets || [];

  const doImport = async () => {
    const items = paste.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
      const m = /^([a-z0-9.\-]+)[=:\s]+(\S+)$/i.exec(line);
      return m ? { account: m[1].toLowerCase(), wif: m[2] } : null;
    }).filter(Boolean) as Array<{ account: string; wif: string }>;
    if (!items.length) { toast.error("הדבק שורות בפורמט: חשבון=מפתח-owner"); return; }
    setBusy("import");
    try {
      const res = await apiJson<{ ok: boolean; verdicts: Array<{ account: string; ok: boolean; detail: string }>; sealed: number }>(
        "/api/gate/rotation",
        { method: "POST", body: JSON.stringify({ action: "import", items }) },
      );
      if (res?.ok) {
        setVerdicts(res.verdicts || []);
        toast.success(`ייבוא הושלם — ${res.sealed || 0} מפתחות נאטמו (כל אימות מול השרשרת)`);
        onDone();
      } else toast.error("הייבוא נכשל — בדוק את ההרשאות");
    } catch { toast.error("שגיאת רשת בייבוא"); }
    setBusy(null);
  };

  const doRotate = async (account: string) => {
    if (!window.confirm(`לחתום ולשדר account_update עבור ${account}? כל ארבעת ה-authorities יוצבו לשורשי-D1 (account_auths נשמרים). זו פעולת-שרשרת שלא ניתן לבטל.`)) return;
    setBusy(account);
    try {
      const res = await apiJson<{ ok: boolean; txId?: string; verified?: boolean; detail?: string; error?: string }>(
        "/api/gate/rotation",
        { method: "POST", body: JSON.stringify({ action: "rotate", account }) },
      );
      if (res?.ok && res.txId) {
        setRotated((s) => ({ ...s, [account]: { txId: res.txId || "", verified: Boolean(res.verified), detail: res.detail || "" } }));
        toast.success(res.verified ? `${account}: אומת live — כל ארבעת ה-authorities נושאים את שורשי-D1` : `${account}: שודר (${(res.txId || "").slice(0, 12)}…) — האימות-חי יושלם בסריקה`);
        onDone();
      } else toast.error(res?.error || `הרוטציה של ${account} נכשלה`);
    } catch { toast.error(`שגיאת רשת ברוטציה של ${account}`); }
    setBusy(null);
  };

  if (!rot) return null;
  return (
    <motion.div {...rise} className="mb-5">
      <GlowCard className="p-4 border-lime-500/30 bg-lime-500/5">
        <div className="flex items-start gap-3">
          <KeyRound className="h-5 w-5 text-lime-400 shrink-0 mt-0.5" aria-hidden />
          <div className="text-sm leading-relaxed w-full">
            <p className="font-semibold text-lime-300">חיבור-steem — מישור הרוטציה הריבוני (רק-מפעיל)</p>
            <p className="text-zinc-400 mt-1">
              הכספת חותמת רק כאן, בהחלטה-מפורשת שלך. שורשי-D1 כבר נאטמו והוכחו חי על hive+blurt — הרוטציה מאחדת את steem על אותו שורש.
              חשבונות-מוכנים: <b className="text-lime-300">{rot.readyCount}/{targets.length}</b>.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 max-h-40 overflow-y-auto scroll-thin">
              {targets.map((t) => (
                <div key={t.account} className="flex items-center gap-2 text-[12px] px-2 py-1.5 rounded-md bg-zinc-950/60 border border-zinc-800/80">
                  <span className="font-mono text-zinc-300">{t.account}</span>
                  <span className={"text-[10px] " + (t.hasOwnerKey ? "text-emerald-400" : "text-zinc-600")}>owner{t.hasOwnerKey ? "✓" : "✗"}</span>
                  <span className={"text-[10px] " + (t.hasP5Root ? "text-emerald-400" : "text-zinc-600")}>P5{t.hasP5Root ? "✓" : "✗"}</span>
                  {rotated[t.account] ? (
                    <span className={"text-[10px] ml-auto " + (rotated[t.account].verified ? "text-emerald-300" : "text-amber-300")}>
                      {rotated[t.account].verified ? "אומת" : "שודר"}
                    </span>
                  ) : (
                    <Button size="sm" variant="outline" disabled={!t.ready || busy !== null} onClick={() => doRotate(t.account)}
                      className="ml-auto h-6 px-2 text-[10px] border-lime-500/40 text-lime-300 hover:bg-lime-500/10">
                      {busy === t.account ? <Loader2 className="h-3 w-3 animate-spin" /> : "התחל רוטציה"}
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3">
              <Textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={3} dir="ltr"
                placeholder={"cashmachine=5J...…\nharan=5K...…  (owner WIF per line — verified live before sealing)"}
                className="bg-zinc-950/80 border-zinc-800 font-mono text-[11px]" aria-label="הדבקת מפתחי-owner" />
              <div className="flex items-center gap-2 mt-2">
                <Button size="sm" variant="outline" disabled={busy !== null || !paste.trim()} onClick={doImport}
                  className="gap-1.5 border-lime-500/40 text-lime-300 hover:bg-lime-500/10">
                  {busy === "import" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                  אמת-חי ואטום
                </Button>
                <span className="text-[11px] text-zinc-500">מפתח שאינו ב-authority ה-owner החי — נדחה ולא נאטם (fail-closed).</span>
              </div>
            </div>
            {verdicts && (
              <div className="mt-3 max-h-36 overflow-y-auto scroll-thin divide-y divide-zinc-800/60 border border-zinc-800/60 rounded-md">
                {verdicts.map((v, i) => (
                  <div key={i} className="flex items-start gap-2 px-2.5 py-1.5 text-[12px]">
                    {v.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" /> : <XCircle className="h-3.5 w-3.5 text-rose-400 mt-0.5 shrink-0" />}
                    <span className="font-mono text-zinc-300">{v.account}</span>
                    <span className={v.ok ? "text-zinc-400" : "text-rose-300/90"}>{v.detail}</span>
                  </div>
                ))}
              </div>
            )}
            {Object.values(rotated).length > 0 && (
              <div className="mt-3 space-y-1.5">
                {Object.entries(rotated).map(([acct, r]) => (
                  <div key={acct} className="text-[12px] px-2.5 py-1.5 rounded-md bg-zinc-950/60 border border-zinc-800/80">
                    <span className="font-mono text-zinc-300">{acct}</span>
                    {" — "}tx <span className="font-mono text-[10px] text-emerald-300/90" dir="ltr">{r.txId.slice(0, 18)}…</span>
                    {" · "}<span className={r.verified ? "text-emerald-300" : "text-amber-300"}>{r.detail}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </GlowCard>
    </motion.div>
  );
}

function VaultGrid() {
  const [inv, setInv] = useState<Inventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [revealing, setRevealing] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [chain, setChain] = useState<string>("*");

  const load = useCallback(async () => {
    const i = await apiJson<Inventory>("/api/gate/inventory");
    setInv(i);
    setLoading(false);
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  const refresh = useCallback(() => { setLoading(true); return load(); }, [load]);

  async function reveal(id: string) {
    if (revealed[id]) { setRevealed((s) => { const n = { ...s }; delete n[id]; return n; }); return; }
    setRevealing(id);
    try {
      const r = await apiJson<{ ok: boolean; priv?: string; error?: string }>("/api/gate/reveal", {
        method: "POST", body: JSON.stringify({ id }),
      });
      if (r?.ok && r.priv) setRevealed((s) => ({ ...s, [id]: r.priv as string }));
      else toast.error(r?.error || "הפענוח נכשל");
    } finally { setRevealing(null); }
  }

  const entries = inv?.entries || [];
  // r11 — rewards-level control truth, computed live from the sweep, not a claim:
  // a soldier's steem-key row counts as "steem-controlled" only when the live
  // authorities contain it ON STEEM. Rows live on hive/blurt but rotated off
  // steem surface in the custody banner below.
  const controlMatrix = useMemo(() => {
    const soldiers = ["cashmachine","haran","israelnews","lsa","macrame","siq","tov","wic","wog","woq","ynet"];
    const rows = soldiers.map((name) => {
      const steemRows = entries.filter((e) => e.kind === "steem-key" && e.account === name);
      const onSteem = steemRows.some((e) => (e.chains || []).includes("steem") && e.liveOk === true);
      const rails = new Set(steemRows.flatMap((e) => e.chains || []));
      return { name, onSteem, rails: [...rails] };
    });
    return rows;
  }, [entries]);
  const steemOrphans = controlMatrix.filter((r) => !r.onSteem);
  const chainsList = useMemo(
    () => Array.from(new Set(entries.flatMap((e) => [(e.chain || e.kind), ...(e.chains || [])]))).sort(),
    [entries],
  );
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entries.filter((e) => {
      // r10: a graphene key rules multiple rails — filter matches the stored
      // label AND every rail the live sweep proved authority on
      if (chain !== "*" && (e.chain || e.kind) !== chain && !(e.chains || []).includes(chain)) return false;
      if (!needle) return true;
      return [e.account, e.role, e.kind, e.chain, e.pub, ...(e.chains || [])].some((f) => (f || "").toLowerCase().includes(needle));
    });
  }, [entries, q, chain]);

  return (
    <section className="py-14">
      <SectionHead num="02" title="הכספת — כל המפתחות" sub="לוחצים 'פענח' והמפתח הפרטי מתגלה כאן, מוצפן-עד-הרגע הזה. הזרקת-מפתח מעל — זיהוי-חי לפני שמירה." />

      <KeyInjectCard />

      <motion.div {...rise} className="flex flex-col md:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-600" aria-hidden />
          <Input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="חיפוש: חשבון / תפקיד / מפתח-ציבורי…"
            className="pr-9 bg-zinc-950/80 border-zinc-800"
            aria-label="חיפוש בכספת"
          />
        </div>
        <Button variant="outline" size="sm" onClick={refresh} className="gap-1.5 border-zinc-800 shrink-0">
          <RefreshCw className={"h-3.5 w-3.5" + (loading ? " animate-spin" : "")} /> אמת-חי
        </Button>
      </motion.div>

      <motion.div {...rise} className="flex flex-wrap gap-2 mb-5">
        <FilterChip active={chain === "*"} onClick={() => setChain("*")} label={`הכול (${entries.length})`} />
        {chainsList.map((c) => (
          <FilterChip key={c} active={chain === c} onClick={() => setChain(c)} label={`${c} (${entries.filter((e) => (e.chain || e.kind) === c || (e.chains || []).includes(c)).length})`} />
        ))}
      </motion.div>

      {steemOrphans.length > 0 && (
        <motion.div {...rise} className="mb-5">
          <GlowCard className="p-4 border-amber-500/30 bg-amber-500/5">
            <div className="flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" aria-hidden />
              <div className="text-sm leading-relaxed">
                <p className="font-semibold text-amber-300">שליטת-הרשת — האמת החיה ({controlMatrix.length} נבדקו on-chain)</p>
                <p className="text-zinc-400 mt-1">
                  <b className="text-emerald-400">r19 — האמת המדודה (chain-proven, חי-מה-API):</b>{" "}
                  {(() => {
                    // gap-54 doctrine: the banner describes the era the CHAIN is in —
                    // computed live from rotationStatus's rotated flags, never a stored era
                    const rot = inv?.rotation;
                    const rotatedCount = rot?.rotatedCount ?? rot?.targets.filter((t) => t.rotated).length ?? 0;
                    if (rotatedCount >= 11) return (
                      <>
                        הצי מאוחד על שורש-אחד: <b className="text-lime-300">11/11 חשבונות-steem נושאים שורשי-D1 בכל-ארבעת-ה-authorities</b> (owner+active+posting+memo — רוטציה מאושרת-שרשרת, double-proven מצומת-עצמאי); ועל hive ו-blurt השורש זהה מאז-r12.
                        <b className="text-amber-300"> החריג היחיד: ynet@steem</b> — המפתחות-החיים שלו (FULL-4 מ-09-04) אצל המפעיל.
                      </>
                    );
                    if (rotatedCount > 0) return (
                      <>מעבר-עידנים בעיצומו: <b className="text-lime-300">{rotatedCount}/11</b> מאוחדים-על-D1, היתר עוד-על-גזירת-ROT1 — האמת-החיה מהשרשרת, לא-זיכרון.</>
                    );
                    return <>הצי על steem תחת גזירת-ROT1 (עידן-r17) — הרוטציה-ל-D1 טרם-בוצעה.</>;
                  })()}
                </p>
                <p className="text-zinc-400 mt-1">
                  דלתות-פרסום חוץ-מיושנות (steemauto, שירות צד-שלישי 2017) נמדדו חי: על steem — רק ynet (חסות-מפעיל); על hive — 9 חשבונות: {(() => {
                    const s = inv?.steemautoProposal;
                    if (!s) return <span className="text-zinc-400">אין כרגע הצעה פתוחה לסגירתן.</span>;
                    if (s.status === "pending") return <span className="text-amber-300">המשאבים (HP/RC) חסרים בחשבונות-היעד — השרשרת עצמה דוחה (r19, מדוד): נדרשת הזרמת-משאבים ואז הפעלה-חוזרת של הסגירה (הכלי מוכן, fail-closed).</span>;
                    if (s.status === "launched") {
                      // gap-57 — the claim follows the RUN's real state, not the proposal's optimism
                      if (s.runStatus === "queued" || s.runStatus === "running") return <span className="text-emerald-300">הריצה לסגירתן חיה כרגע.</span>;
                      if (s.runStatus === "done") return <span className="text-emerald-300">הריצה הסתיימה — הדלתות נסגרו.</span>;
                      if (s.runStatus === "blocked" || s.runStatus === "failed") return <span className="text-rose-300">הריצה נעצרה כנה — הכלים קיימים (r19); החסם-הנוכחי: משאבי-RC בחשבונות-היעד (נדרשת הזרמה).</span>;
                      return <span className="text-emerald-300">הריצה הוזנקה על-ידי המפעיל.</span>;
                    }
                    if (s.status === "adopted") return <span className="text-lime-300">ההצעה אומצה כסיור-קבוע.</span>;
                    if (s.status === "rejected") return <span className="text-zinc-400">הוצא מסדר-היום בהוראת-המפעיל (r20) — לא על סדר-היום יותר; הדלתות נשארות מתועדות-מדוד (hive: חסומות-כלכלה RC · steem: חסות-מפעיל).</span>;
                    return <span className="text-zinc-400">ההצעה פגתה במדיניות — דורשת הגשה-מחדש.</span>;
                  })()}
                  {(() => {
                    // r19 — the rotation plane reports its state live (the era is decided)
                    const rot = inv?.rotation;
                    if (!rot) return null;
                    const rotatedCount = rot.rotatedCount ?? rot.targets.filter((t) => t.rotated).length;
                    return (
                      <span className="block mt-1">
                        <b className="text-lime-300">מישור-רוטציית account_update (רק-מפעיל):</b> הרוטציה לשורשי-D1 <b className="text-lime-300">בוצעה ואומתה-שרשרת ({rotatedCount}/11)</b> — המפתחות-החיים הם עכשיו שורשי-D1 הנאטמים; אין-צורך ברוטציה-נוספת. ה-ROT1 ומפתחות-2018 מוגדרים rotated-out (היסטוריה-אטומה, נשמרת).
                      </span>
                    );
                  })()}
                  {(() => {
                    // r20 — the anchor line is LIVE: per-rail chain-verified anchors
                    // from /api/gate/inventory (get_transaction → get_block scan),
                    // never a stored era. gap-54 doctrine applies here too.
                    const an = inv?.anchors ?? [];
                    if (!an.length) return (
                      <span className="text-zinc-400">עוגני-האמת על-השרשרת: אין עוגנים מדודים כרגע — האמת תחושב כשהמדידה תרוץ.</span>
                    );
                    const digests = [...new Set(an.flatMap((a) => (a.digest ? [a.digest] : [])))];
                    const unity = an.filter((a) => a.onChain).length >= 2 && digests.length === 1;
                    return (
                      <span className="block mt-1">
                        עוגני-האמת על-השרשרת ({an.length} מסילות, אמת-חי):
                        {an.map((a) => (
                          <span key={a.chain} className="font-mono text-[11px] text-emerald-300/90" dir="ltr">{" "}{a.chain}{a.onChain ? " ✓" : " ?"} · blk {a.blockNum ?? "—"} · {a.txId.slice(0, 10)}…{a.round ? ` · ${a.round}` : ""} ·</span>
                        ))}
                        {digests.length === 1 && <span className="font-mono text-[11px] text-lime-300" dir="ltr">{" "}digest {digests[0].slice(0, 16)}…</span>}
                        {unity && <b className="text-lime-300"> · אחדות-עוגן רבת-מסילה ✓ (דיגסט אחד, שרשרות עצמאיות)</b>}
                        {!an.some((a) => a.chain === "hive") && <span className="text-zinc-500"> · hive: חסום-כלכלה RC (מדוד-חי) — ממתין להזרמת-HP</span>}
                      </span>
                    );
                  })()}
                </p>
              </div>
            </div>
          </GlowCard>
        </motion.div>
      )}

      <RotationPanel inv={inv} onDone={() => refresh()} />

            {loading && entries.length === 0 ? (
        <GlowCard className="p-12 flex items-center justify-center gap-2 text-zinc-500 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> מאמת {entries.length || ""} סודות מול השרשרות…
        </GlowCard>
      ) : (
        <motion.div {...rise}>
          <GlowCard className="divide-y divide-zinc-800/60 max-h-[560px] overflow-y-auto scroll-thin">
            {filtered.map((e) => {
              const priv = revealed[e.id];
              return (
                <div key={e.id} className="px-4 py-3.5 transition-colors hover:bg-zinc-900/40">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <Badge variant="secondary" className="font-mono text-[10px] bg-zinc-800/80 text-amber-300/90 border border-amber-500/20">{e.chain || e.kind}</Badge>
                    {(e.chains || []).filter((c) => c !== (e.chain || e.kind)).map((c) => (
                      <Badge key={c} variant="secondary" className="font-mono text-[10px] bg-emerald-500/10 text-emerald-300/90 border border-emerald-500/20">+{c}</Badge>
                    ))}
                    <span className="font-mono text-sm font-bold">{e.account || "—"}</span>
                    {e.role && <span className="font-mono text-[10px] text-zinc-500">@{e.role}</span>}
                    <LiveDot ok={e.liveOk} />
                    <div className="mr-auto flex items-center gap-1.5">
                      {e.pub && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-500" title="העתק מפתח-ציבורי" onClick={() => copyText(e.pub!, "מפתח-ציבורי")}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="outline" size="sm"
                        className="gap-1.5 h-8 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300 font-mono text-xs"
                        onClick={() => reveal(e.id)} disabled={revealing === e.id}
                      >
                        {revealing === e.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : priv ? <><EyeOff className="h-3.5 w-3.5" /> הסתר</>
                          : <><Eye className="h-3.5 w-3.5" /> פענח</>}
                      </Button>
                    </div>
                  </div>
                  {e.pub && !priv && <p className="mt-1.5 font-mono text-[10px] text-zinc-600 truncate" dir="ltr">{e.pub}</p>}
                  <AnimatePresence>
                    {priv && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="mt-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-2.5" dir="ltr">
                          <Scramble text={priv} className="flex-1 font-mono text-xs break-all whitespace-pre-wrap text-amber-200 leading-relaxed" />
                          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-amber-300" onClick={() => copyText(priv, "מפתח פרטי")}>
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
            {filtered.length === 0 && <p className="text-center text-zinc-500 text-sm py-10">אין התאמות</p>}
          </GlowCard>
        </motion.div>
      )}
      <RestoreDrillCard />
    </section>
  );
}

/* ══════════════════════════ key injection — r38 gap fix ══════════════════════════
   היה רכיב-מלא שמעולם לא רונדר (קוד-מת: KeyInject הוגדר ולא נקרא אף-פעם ב-Page).
   עתה: כרטיס-קומפקטי בראש-סעיף-הכספת — מזהה חי כל מפתח ושומר מוצפן. */

function KeyInjectCard() {
  const [keyInput, setKeyInput] = useState("");
  const [saveIt, setSaveIt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<KeyReport | null>(null);

  async function run() {
    if (!keyInput.trim()) return;
    setBusy(true);
    try {
      const r = await apiJson<{ ok: boolean; report?: KeyReport; saved?: { id: string }[]; error?: string }>("/api/gate/key", {
        method: "POST", body: JSON.stringify({ key: keyInput.trim(), save: saveIt }),
      });
      if (r?.ok) {
        setReport(r.report || null);
        setKeyInput("");
        toast.success(saveIt && r.saved?.length ? `נשמר מוצפן בכספת (${r.saved.length})` : "זוהה חי — דוח מוצג");
      } else toast.error(r?.error || "הזיהוי נכשל");
    } finally { setBusy(false); }
  }

  return (
    <motion.div {...rise} className="mb-6">
      <GlowCard className="p-5">
        <div className="flex items-center gap-2 mb-1.5">
          <KeyRound className="h-4 w-4 text-emerald-400" aria-hidden />
          <h3 className="font-bold text-sm">הזרקת מפתח — זיהוי-חי ושמירה מוצפנת</h3>
          <span className="text-[10px] text-zinc-600">מזהה WIF / hex / מנשק / PAT מול השרשרות — לפני שהוא נוגע בכספת</span>
        </div>
        <div className="flex flex-col md:flex-row gap-3 mt-3">
          <div className="relative flex-1">
            <KeyRound className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-600" aria-hidden />
            <Input
              value={keyInput} onChange={(e) => setKeyInput(e.target.value)}
              placeholder="WIF / hex / מנשק / PAT — הדבק כאן"
              className="pr-9 font-mono text-sm bg-zinc-950/80 border-zinc-800" dir="ltr"
              autoComplete="off" spellCheck={false}
              aria-label="מפתח לזיהוי"
            />
          </div>
          <Button onClick={run} disabled={busy || !keyInput.trim()} className="gap-2 bg-emerald-600 hover:bg-emerald-500 text-black font-bold shrink-0">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saveIt ? "זהה ושמור" : "זהה חי"}
          </Button>
        </div>
        <label className="mt-3 flex items-center gap-2.5 text-xs text-zinc-400 cursor-pointer w-fit">
          <Switch checked={saveIt} onCheckedChange={setSaveIt} aria-label="שמירה מוצפנת בכספת" />
          שמור מוצפן בכספת (בלי זה — רק דוח-זיהוי)
        </label>
        <AnimatePresence>
          {report && (
            <motion.div
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 text-xs space-y-2"
            >
              <p><span className="text-zinc-500">סוג:</span> <span className="font-mono text-emerald-400 font-bold">{report.kind}</span>
                <span className="text-zinc-600"> · אימות-חי: {report.liveChecked ? "כן ✓" : "לא"}</span></p>
              {report.controls.length > 0 && (
                <p className="break-all leading-relaxed">
                  <span className="text-zinc-500">שליטה נוכחית:</span>{" "}
                  {report.controls.map((ctrl, i) => (
                    <Badge key={i} variant="outline" className="font-mono text-[10px] border-emerald-500/30 text-emerald-300 ml-1.5">
                      {ctrl.chain}{ctrl.account ? `·${ctrl.account}` : ""}@{ctrl.role}
                    </Badge>
                  ))}
                </p>
              )}
              {report.pubs.length > 0 && <p className="font-mono text-[10px] text-zinc-600 break-all" dir="ltr">pub: {report.pubs[0]}</p>}
            </motion.div>
          )}
        </AnimatePresence>
      </GlowCard>
    </motion.div>
  );
}

function RestoreDrillCard() {
  const [last, setLast] = useState<DrillResult | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await apiJson<{ ok: boolean; last: DrillResult | null }>("/api/gate/restore-drill");
    if (r?.ok) setLast(r.last);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function run() {
    if (busy) return;
    setBusy(true);
    try {
      // POST returns the drill result spread onto {ok:true,...} (the ok() helper shape)
      const r = await apiJson<DrillResult & { ok: boolean; error?: string; code?: string }>("/api/gate/restore-drill", { method: "POST" });
      if (r?.ok && r?.verdict) {
        setLast(r);
        if (r.verdict === "pass") toast.success(`תרגיל-שחזור עבר — ${r.restored}/${r.total} סודות נפתחו בפועל`);
        else toast.error(`תרגיל-שחזור נכשל — ${r.failed} הצפנות לא נפתחו`);
      } else if (r?.code === "vault-locked") toast.error("הכספת נעולה — היכנס כדי להדליק את מפתח-האב");
      else toast.error(r?.error || "התרגיל נכשל");
    } finally { setBusy(false); }
  }

  return (
    <motion.div {...rise} className="mt-5">
      <GlowCard className="p-4 sm:p-5 border-emerald-500/15">
        <div className="flex items-start gap-3 flex-wrap">
          <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" aria-hidden />
          <div className="flex-1 min-w-[240px]">
            <p className="font-bold text-sm">תרגיל-שחזור — ההוכחה-העומדת שהכספת משיבה את כל המפתחות</p>
            <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
              התרגיל פותח בפועל את כל ההצפנות מול מפתח-האב וסופר מה באמת נפתח · אפס-סודות בפלט — ספירה, תווית ופסק בלבד.
            </p>
            {last && (
              <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px]">
                <Badge variant="outline" className={last.verdict === "pass" ? "text-emerald-300 border-emerald-500/40" : "text-rose-300 border-rose-500/40"}>
                  {last.verdict === "pass" ? "עבר" : "נכשל"}
                </Badge>
                <Badge variant="outline" className="text-zinc-300 border-zinc-700">{last.restored}/{last.total} נפתחו</Badge>
                {last.placeholders ? <Badge variant="outline" className="text-zinc-400 border-zinc-700">{last.placeholders} פנויות</Badge> : null}
                {last.failed > 0 && <Badge variant="outline" className="text-rose-300 border-rose-500/40">{last.failed} כשלים</Badge>}
                {last.seals?.operatorPrimary && <Badge variant="outline" className="text-emerald-300 border-emerald-500/40">חותמת-מפעיל ראשית</Badge>}
                <span className="text-zinc-600 font-mono">{new Date(last.at).toLocaleString("he-IL")}</span>
              </div>
            )}
            {last?.meaning && <p className="text-[11px] text-zinc-500 mt-2 leading-relaxed">{last.meaning}</p>}
          </div>
          <Button variant="outline" size="sm" onClick={run} disabled={busy} className="gap-1.5 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 shrink-0">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} הרץ תרגיל עכשיו
          </Button>
        </div>
      </GlowCard>
    </motion.div>
  );
}

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
  useEffect(() => {
    const t = setInterval(() => { load(); loadMem(); loadOrders(); loadTreasury(); loadSituation(); loadDigest(); }, 8000);
    return () => clearInterval(t);
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
                        <p className="text-[10px] font-mono text-emerald-300">🚪 דלת-קדמית — {digest.door.incoming} דופק/ים ב-broadcasts/ שלנו (r26 · טביעת-אצבע r27 · אמת-מסלול r29 · תעלה-נקייה r35)</p>
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
                    <span className="text-zinc-200">{situation.vault.ok ? `${situation.vault.total} · ${situation.vault.verified} verified` : "כשל כן"}</span>
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
              signed {orders?.signedToday ?? 0}/{orders?.rails.maxSignedPerDay ?? 6} today · ≤{orders?.rails.maxNotionalSteem ?? 100} per order · חשבון-הפקודה: מפתח-active מאומת מהכספת
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

function AutonomySection() {
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

function Agents() {
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

function Bridge() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [live, setLive] = useState(false); // SSE connected — push beats polling
  const viewportRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const r = await apiJson<{ ok: boolean; messages: Msg[] }>("/api/gate/messages");
    if (r?.ok) setMsgs((r.messages || []).slice(-100));
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  useEffect(() => {
    // BRIDGE-ENGINE: one live stream instead of blind 5s polling. On any
    // failure the old poller takes over — the bridge never goes dark.
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    const startPoll = () => {
      if (!poll) poll = setInterval(() => { load(); }, 5000);
    };
    try {
      es = new EventSource("/api/gate/stream");
      es.addEventListener("hello", () => { setLive(true); if (poll) { clearInterval(poll); poll = null; } });
      es.addEventListener("messages", (ev) => {
        try {
          const arr = JSON.parse((ev as MessageEvent).data) as Msg[];
          setMsgs((prev) => {
            const seen = new Set(prev.map((m) => m.id));
            const fresh = arr.filter((m) => !seen.has(m.id));
            return fresh.length ? [...prev, ...fresh].slice(-100) : prev;
          });
        } catch { /* malformed frame — the next poller tick repairs */ }
      });
      es.onerror = () => { setLive(false); startPoll(); };
    } catch {
      startPoll();
    }
    return () => {
      es?.close();
      if (poll) clearInterval(poll);
    };
  }, [load]);
  // Chat etiquette: follow fresh messages ONLY when the reader is already at
  // the bottom of the bridge AND the bridge is on-screen. We scroll the INNER
  // container (scrollTop) — which by construction can never drag the page —
  // instead of scrollIntoView, which yanked the whole window down to §05 on
  // every SSE push (user-reported: "הגשר כל הזמן מושך את הדף").
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || typeof window === "undefined") return;
    const rect = vp.getBoundingClientRect();
    const onScreen = rect.top < window.innerHeight && rect.bottom > 0;
    const atBottom = vp.scrollHeight - vp.scrollTop - vp.clientHeight < 140;
    if (onScreen && atBottom) vp.scrollTop = vp.scrollHeight;
  }, [msgs]);

  async function send() {
    const body = input.trim();
    if (!body || sending) return;
    setSending(true); setInput("");
    try {
      const r = await apiJson<{ ok: boolean; error?: string }>("/api/gate/messages", { method: "POST", body: JSON.stringify({ body }) });
      if (r?.ok) await load();
      else toast.error(r?.error || "השליחה נכשלה");
    } finally { setSending(false); }
  }

  return (
    <section className="py-14">
      <SectionHead num="06" title="גשר-הפיקוד" sub="אתה, הסוכנים והמערכת — ערוץ אחד. הכול נרשם." />
      <motion.div {...rise}>
        <GlowCard className="flex flex-col h-[480px] overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-3">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-zinc-500" dir="ltr">
              <Radio className={"h-3 w-3 " + (live ? "text-emerald-400 animate-pulse" : "text-zinc-600")} aria-hidden />
              {live ? "live stream" : "polling"}
            </span>
          </div>
          <div ref={viewportRef} className="flex-1 min-h-0 overflow-y-auto scroll-thin px-5 py-4">
            <div className="space-y-3">
              {msgs.map((m) => (
                <div key={m.id} className={"flex gap-2.5 items-start " + (m.fromKind === "operator" ? "flex-row-reverse" : "")}>
                  <Badge
                    variant="outline"
                    className={
                      "shrink-0 text-[10px] mt-0.5 font-mono " +
                      (m.fromKind === "operator" ? "text-emerald-400 border-emerald-500/40"
                        : m.fromKind === "agent" ? "text-amber-300 border-amber-500/40"
                        : "text-zinc-500 border-zinc-700")
                    }
                  >
                    {m.fromKind === "operator" ? "אתה" : m.fromKind === "agent" ? m.fromName : "SYS"}
                  </Badge>
                  <div className={"max-w-[78%] rounded-2xl px-4 py-2.5 " + (m.fromKind === "operator" ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-zinc-900/70 border border-zinc-800")}>
                    <p className="text-sm break-words whitespace-pre-wrap leading-relaxed text-zinc-200">{m.body}</p>
                    <p className="text-[9px] text-zinc-600 mt-1 font-mono">{new Date(m.createdAt).toLocaleString("he-IL")}</p>
                  </div>
                </div>
              ))}
              {msgs.length === 0 && <p className="text-sm text-zinc-500 text-center py-10">הערוץ ריק — כתוב פקודה ראשונה</p>}
            </div>
          </div>
          <div className="border-t border-zinc-800/80 p-3.5 flex gap-2 bg-black/40">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !sending) send(); }}
              placeholder="פקודה או הודעה…"
              className="bg-zinc-950/80 border-zinc-800"
              aria-label="הודעה לגשר-הפיקוד"
            />
            <Button onClick={send} disabled={sending || !input.trim()} className="bg-emerald-600 hover:bg-emerald-500 text-black shrink-0" aria-label="שלח">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </GlowCard>
      </motion.div>
    </section>
  );
}

function Audit() {
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const r = await apiJson<{ ok: boolean; actions: ActionRow[] }>("/api/gate/actions");
    if (r?.ok) setActions(r.actions || []);
    setLoading(false);
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  const refresh = useCallback(() => { setLoading(true); return load(); }, [load]);

  return (
    <section className="py-14">
      <div className="flex items-end justify-between">
        <SectionHead num="07" title="ביקורת" sub="כל פעולת-סוכן — רשומה. תמיד." />
        <Button variant="ghost" size="sm" onClick={refresh} className="gap-1.5 text-zinc-500 mb-6">
          <RefreshCw className={"h-3.5 w-3.5" + (loading ? " animate-spin" : "")} />
        </Button>
      </div>
      <motion.div {...rise}>
        <GlowCard className="p-2 max-h-96 overflow-y-auto scroll-thin">
          <div className="divide-y divide-zinc-800/50">
            {loading && actions.length === 0 && (
              <div className="flex items-center justify-center gap-2 py-10 text-zinc-500 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> טוען…</div>
            )}
            {actions.map((a) => (
              <details key={a.id} className="px-4 py-3 group">
                <summary className="flex items-center gap-2.5 flex-wrap cursor-pointer list-none">
                  <span className={"h-2 w-2 rounded-full shrink-0 " + (a.ok ? "bg-emerald-500" : "bg-rose-500")} />
                  <span className="font-mono text-sm font-bold">{a.agentName}</span>
                  <span className="font-mono text-xs text-amber-300/80">{a.action}</span>
                  <span className="text-[10px] text-zinc-600 mr-auto font-mono">{new Date(a.createdAt).toLocaleString("he-IL")}</span>
                </summary>
                <pre className="mt-2 font-mono text-[10px] text-zinc-500 break-all whitespace-pre-wrap bg-black/60 border border-zinc-800/70 rounded-lg p-2.5 leading-relaxed" dir="ltr">
{`params: ${a.params}
result: ${a.result}`}
                </pre>
              </details>
            ))}
            {!loading && actions.length === 0 && <p className="text-center text-zinc-500 text-sm py-10">אין פעולות עדיין</p>}
          </div>
        </GlowCard>
      </motion.div>
    </section>
  );
}

function ApiConsole() {
  const [sel, setSel] = useState<Ep>(ENDPOINTS[0]);
  const [body, setBody] = useState("");
  const [out, setOut] = useState<string | null>(null);
  const [meta, setMeta] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function pick(e: Ep) { setSel(e); setBody(e.body || ""); setOut(null); setMeta(null); }

  async function run() {
    setBusy(true); setOut(null); setMeta(null);
    try {
      const res = await api(sel.path, sel.method === "POST" ? { method: "POST", body: body || "{}" } : {});
      const text = await res.text();
      setMeta(`${res.status} ${res.statusText}`);
      try { setOut(JSON.stringify(JSON.parse(text), null, 2)); } catch { setOut(text); }
    } catch (e) {
      setMeta("שגיאת-רשת");
      setOut(String((e as Error).message));
    } finally { setBusy(false); }
  }

  return (
    <section className="py-14">
      <SectionHead num="08" title="מסוף-API חי" sub="כל נקודת-קצה שקיימת בקוד — מוכנה להרצה אמיתית. הטוקן מצורף אוטומטית." />
      <div className="grid gap-4 lg:grid-cols-5">
        <motion.div {...rise} className="lg:col-span-2">
          <GlowCard className="p-2 max-h-[60vh] overflow-y-auto scroll-thin">
            <div className="space-y-1">
              {ENDPOINTS.map((e) => (
                <button
                  key={e.method + e.path}
                  onClick={() => pick(e)}
                  className={"w-full text-right rounded-xl px-3.5 py-2.5 transition-all " + (sel === e ? "bg-emerald-500/10 border border-emerald-500/30" : "hover:bg-zinc-900/60 border border-transparent")}
                >
                  <div className="flex items-center gap-2">
                    <span className={"font-mono text-[9px] font-black px-1.5 py-0.5 rounded " + (e.method === "GET" ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-300")}>{e.method}</span>
                    <span className="font-mono text-xs truncate" dir="ltr">{e.path}</span>
                    {e.auth === "operator" && <Lock className="h-3 w-3 text-zinc-600 shrink-0" aria-label="מוגן" />}
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-0.5 truncate">{e.desc}</p>
                </button>
              ))}
            </div>
          </GlowCard>
        </motion.div>

        <motion.div {...rise} transition={{ ...rise.transition, delay: 0.1 }} className="lg:col-span-3">
          <GlowCard className="p-5 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={"font-mono text-[10px] font-black px-2 py-1 rounded " + (sel.method === "GET" ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-300")}>{sel.method}</span>
              <code className="font-mono text-sm text-zinc-200 break-all" dir="ltr">{sel.path}</code>
            </div>
            {sel.method === "POST" && (
              <div>
                <label htmlFor="ep-body" className="text-xs text-zinc-500 mb-1.5 block">גוף (JSON)</label>
                <Textarea id="ep-body" value={body} onChange={(e) => setBody(e.target.value)} dir="ltr" className="font-mono text-xs bg-zinc-950/80 border-zinc-800 min-h-24" />
              </div>
            )}
            <Button onClick={run} disabled={busy} className="gap-2 bg-emerald-600 hover:bg-emerald-500 text-black font-bold">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Braces className="h-4 w-4" />} הרץ עכשיו
            </Button>
            {meta && <p className="font-mono text-xs text-zinc-500">↩ {meta}</p>}
            <AnimatePresence>
              {out && (
                <motion.pre
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl bg-black/70 border border-zinc-800 p-3.5 font-mono text-[11px] text-emerald-200/90 overflow-auto max-h-[46vh] scroll-thin leading-relaxed"
                  dir="ltr"
                >{out}</motion.pre>
              )}
            </AnimatePresence>
          </GlowCard>
        </motion.div>
      </div>
    </section>
  );
}

function TrustedDevices() {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await apiJson<{ ok: boolean; devices: DeviceRow[]; liveCount?: number; expiringSoon?: number; cap?: number }>("/api/gate/device");
    if (r?.ok) setDevices(r.devices || []);
    setLoading(false);
  }, []);
  useEffect(() => {
    setCurrentId(getDeviceId());
    void Promise.resolve().then(load);
  }, [load]);

  async function revoke(id: string) {
    setBusy(true);
    try {
      const r = await apiJson<{ ok: boolean; error?: string; sessionsKilled?: number }>(`/api/gate/device?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (r?.ok) {
        if (currentId === id) { setDeviceToken(null); setCurrentId(null); }
        toast.success(`המכשיר נשלל — הצופן נמחק מה-DB${r.sessionsKilled ? ` · ${r.sessionsKilled} סשנים שנפתחו דרכו נסגרו` : ""}`);
        await load();
      } else toast.error(r?.error || "השלילה נכשלה");
    } finally { setBusy(false); }
  }

  async function forgetThis() {
    setBusy(true);
    try {
      const dt = getDeviceToken();
      if (dt) {
        await fetch("/api/gate/device/forget", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceToken: dt }) });
      }
      setDeviceToken(null);
      setCurrentId(null);
      toast("המכשיר הזה נשכח והצופן נמחק מה-DB — הכניסה הבאה במפתח-חי");
      await load();
    } finally { setBusy(false); }
  }

  async function revokeAll() {
    setBusy(true);
    try {
      const r = await apiJson<{ ok: boolean; error?: string; revoked?: number; sessionsKilled?: number }>("/api/gate/device?all=1", { method: "DELETE" });
      if (r?.ok) {
        setDeviceToken(null);
        setCurrentId(null);
        toast.success(`כל מכשירי-הזכירה נשללו (${r.revoked ?? 0}) — הצופנים נמחקו מה-DB${r.sessionsKilled ? ` · ${r.sessionsKilled} סשנים נסגרו` : ""} · כניסת-מכשיר חסומה (שער-האופרטור נשאר לפי מדיניותו)`);
        await load();
      } else toast.error(r?.error || "השלילה נכשלה");
    } finally { setBusy(false); }
  }

  // ROAST r9 gap-34 — the renewal path: rotating the CURRENT device in place
  // (same row, new token, fresh 90 days) instead of waiting for silent death.
  async function rearmCurrent() {
    setBusy(true);
    try {
      const dt = getDeviceToken();
      if (!dt) { toast.error("אין טוקן-מכשיר בדפדפן הזה — אין מה לחדש"); return; }
      const r = await apiJson<{ ok: boolean; device?: { id: string; label: string }; deviceToken?: string; error?: string }>("/api/gate/device", {
        method: "POST", body: JSON.stringify({ deviceToken: dt }),
      });
      if (r?.ok && r.deviceToken && r.device) {
        setDeviceToken(r.deviceToken, r.device.id);
        setCurrentId(r.device.id);
        toast.success("המכשיר חודש ברוטציה — טוקן חדש, תוקף עוד 90 יום");
        await load();
      } else toast.error(r?.error || "החידוש נכשל");
    } finally { setBusy(false); }
  }

  // ROAST r9 gap-30 — "פעילים" finally means LIVE: not revoked, not expired,
  // ciphertext still in place. Expired rows are shown as what they are.
  const active = devices.filter((d) => d.live);
  const currentRow = devices.find((d) => d.id === currentId);
  const canRearm = Boolean(currentRow?.live && currentRow.expiringSoon && getDeviceToken());

  return (
    <section className="py-14">
      <SectionHead num="09" title="מכשירים-מהימנים" sub="זכירה-בטוחה של המפעיל: הטוקן חי בדפדפן בלבד, השרת מחזיק hash + מפתח-אב חתום תחתו. ה-DB לבדו אינו מסוגל להיכנס. הלב גורע פגי-תוקף ומתריע לפני פקיעה." />
      <motion.div {...rise}>
        <GlowCard className="p-6">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <h3 className="font-bold flex items-center gap-2"><Smartphone className="h-4 w-4 text-emerald-400" /> {active.length} מכשירים פעילים {devices.some((d) => !d.revoked && !d.live) && <span className="text-[10px] text-amber-400/80 font-normal">(+ פגי-תוקף שייגרעו)</span>}</h3>
            <div className="flex gap-2">
              {canRearm && (
                <Button variant="outline" size="sm" disabled={busy} onClick={rearmCurrent} className="h-8 text-[11px] gap-1 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10">
                  <RefreshCw className="h-3 w-3" /> חמש מכשיר זה מחדש
                </Button>
              )}
              {currentId && (
                <Button variant="outline" size="sm" disabled={busy} onClick={forgetThis} className="h-8 text-[11px] gap-1 border-zinc-800 text-zinc-300 hover:bg-zinc-800/60">
                  <Unplug className="h-3 w-3" /> שכח מכשיר זה
                </Button>
              )}
              {active.length > 0 && (
                <Button variant="outline" size="sm" disabled={busy} onClick={revokeAll} className="h-8 text-[11px] gap-1 border-rose-500/40 text-rose-300 hover:bg-rose-500/10">
                  <Trash2 className="h-3 w-3" /> שלול הכול
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-2 max-h-72 overflow-y-auto scroll-thin">
            {loading && <div className="flex items-center gap-2 text-sm text-zinc-500 py-4 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> טוען…</div>}
            {!loading && devices.map((d) => (
              <div key={d.id} className={"rounded-xl border px-3.5 py-3 flex items-center gap-3 flex-wrap " + (d.revoked || !d.live ? "border-zinc-800/60 bg-black/20 opacity-60" : "border-zinc-800/80 bg-black/40")}>
                <Smartphone className={"h-4 w-4 shrink-0 " + (d.revoked || !d.live ? "text-zinc-600" : "text-emerald-400")} />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-zinc-200 flex items-center gap-2 flex-wrap">
                    {d.label}
                    {d.id === currentId && <Badge variant="outline" className="text-[9px] text-emerald-300 border-emerald-500/40">המכשיר הזה</Badge>}
                    {d.revoked && <Badge variant="outline" className="text-[9px] text-zinc-500 border-zinc-700">נשלל · צופן נמחק</Badge>}
                    {!d.revoked && !d.live && <Badge variant="outline" className="text-[9px] text-amber-300 border-amber-500/40">פג-תוקף — ייגרע עם הצופן</Badge>}
                    {!d.revoked && d.live && d.expiringSoon && <Badge variant="outline" className="text-[9px] text-amber-300 border-amber-500/40">יפוג בעוד {d.daysLeft} יום</Badge>}
                  </p>
                  <p className="text-[10px] text-zinc-600 font-mono">
                    נוצר {new Date(d.createdAt).toLocaleDateString("he-IL")} · שימוש אחרון {new Date(d.lastUsedAt).toLocaleString("he-IL")} · פג-תוקף {new Date(d.expiresAt).toLocaleDateString("he-IL")}
                  </p>
                </div>
                {!d.revoked && d.live && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-400/80 shrink-0 mr-auto" title="שלילת מכשיר (הצופן נמחק + סשנים שנפתחו דרכו נסגרים)" disabled={busy} onClick={() => revoke(d.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
            {!loading && devices.length === 0 && (
              <p className="text-sm text-zinc-500 py-6 text-center">אין מכשירים-מהימנים — היכנס במפתח עם &quot;זכור אותי&quot; והמכשיר ייחרש כאן</p>
            )}
          </div>
          <p className="mt-4 text-[11px] text-zinc-600 leading-relaxed">
            איך זה בטוח: טוקן-המכשיר (256 סיביות) נולד בהתחברות וחי רק בדפדפן הזה · השרת מחזיק את ה-hash שלו בלבד, ואת מפתח-האב חתום תחת scrypt(טוקן) —
            כלומר גם גניבת-DB מלאה לא מאפשרת כניסה ולא פותחת את הכספת · שלילה מוחקת את הצופן עצמו מה-DB (לא רק דגל) וסוגרת את הסשנים שהמכשיר פתח —
            חוץ מהסשן שלך כאן · תוקף 90 יום, ניתן לחידוש ברוטציה, והלב מתריע 7 ימים לפני פקיעה · השער-האוטומטי של האופרטור (מדיניות "זה רק אני ואתה") הוא מישור נפרד ומתועד.
          </p>
        </GlowCard>
      </motion.div>
    </section>
  );
}

function EmergencyZone({ onAfter }: { onAfter: () => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function reset() {
    if (confirm !== "איפוס" || busy) return;
    setBusy(true);
    try {
      const r = await apiJson<{ ok: boolean; token?: string; imported?: number; keySeals?: unknown[]; error?: string }>("/api/gate/reset", {
        method: "POST", body: JSON.stringify({ key: key.trim(), newPassphrase: pass }),
      });
      if (r?.ok) {
        if (r.token) setToken(r.token);
        toast.success(`שחזור-חירום הושלם — ${r.imported} סודות ייובאו מחדש`);
        setKey(""); setPass(""); setConfirm(""); setOpen(false);
        await onAfter();
      } else toast.error(r?.error || "האיפוס נדחה");
    } finally { setBusy(false); }
  }

  return (
    <section className="py-14">
      <SectionHead num="10" title="אזור-חירום" sub="רק אם איבדת הכול: הוכחת-בעלות חיה משחזרת את הכספת מהמקורות ששרדו. כל המכשירים-המהימנים נשללים אוטומטית — מפתח-אב חדש." />
      <motion.div {...rise}>
        <GlowCard className="border-rose-500/20">
          <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 px-6 py-4 text-right" aria-expanded={open}>
            <AlertTriangle className="h-5 w-5 text-rose-400 shrink-0" />
            <div className="flex-1">
              <p className="font-bold text-sm">שחזור-חירום — בנייה מחדש של הכספת</p>
              <p className="text-xs text-zinc-500 mt-0.5">מוחק את ההצפנה הנוכחית ובונה מחדש מהמקורות · דורש מפתח owner/active חי</p>
            </div>
            <span className="font-mono text-zinc-500">{open ? "−" : "+"}</span>
          </button>
          <AnimatePresence>
            {open && (
              <motion.div
                initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="px-6 pb-6 space-y-3">
                  <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="מפתח owner/active של headcorner (מאומת חי)" className="font-mono text-sm bg-zinc-950/80 border-zinc-800" dir="ltr" autoComplete="off" spellCheck={false} />
                  <Input value={pass} onChange={(e) => setPass(e.target.value)} placeholder="סיסמה חדשה (8+ תווים, אופציונלית בפועל)" className="bg-zinc-950/80 border-zinc-800" type="password" />
                  <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder='הקלד "איפוס" כדי לאשר' className="bg-zinc-950/80 border-rose-500/30" />
                  <Button onClick={reset} disabled={busy || confirm !== "איפוס" || !key.trim() || pass.length < 8} variant="destructive" className="gap-2 w-full">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />} בצע שחזור-חירום
                  </Button>
                  <p className="text-[11px] text-zinc-600 leading-relaxed">
                    הפעולה מוכיחה בעלות מול השרשרת בלייב, מייבאת מחדש את כל המקורות ששרדו, ואוטמת מפתח-אב חדש תחת הסיסמה
                    ותחת כל מפתח-headcorner נוכחי. נוצר גיבוי מוצפן מקומי.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </GlowCard>
      </motion.div>
    </section>
  );
}
