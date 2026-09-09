"use client";

/**
 * SAOS SOVEREIGN VAULT — חוויה קינמטית אחת, בלי מרכז-שליטה, בלי סרגלים, בלי טאבים.
 * העיצוב הוא מה שהתיקיה באמת היא: כספת ריבונית שמתחברת להכל ומוכיחה חיבור אמיתי.
 *
 * מסך-נעילה: חותם-כספת מסתובב (חותמות-מפתח אמיתיות) + שדה אחד → כניסה במפתח-חי.
 * בפנים: גלילה רציפה דרך מה שעשינו בתיקיה — חיבורים חיים, הכספת עם חשיפה
 * מפוענחת-באנימציה, הזרקת מפתח, סוכנים, גשר-פיקוד, ביקורת, מסוף-API ואזור-חירום.
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
  KeyRound, ShieldCheck, LogOut, Copy, Eye, EyeOff, Bot, Send, RefreshCw,
  Loader2, Plus, Trash2, CheckCircle2, XCircle, MinusCircle, Terminal,
  ScrollText, Save, UserCheck, Braces, Lock, Search, Globe, Github, Link2,
  AlertTriangle, ArrowDown, Cpu, Crosshair, Layers, ListChecks, Play,
  Smartphone, Unplug, HeartPulse, Clock, Zap,
} from "lucide-react";

/* ══════════════════════════ auth plumbing ══════════════════════════ */

const TOKEN_KEY = "saos-gate-token";
const DEVICE_KEY = "saos-gate-device"; // the trusted-device token — lives ONLY in this browser
const DEVICE_ID_KEY = "saos-gate-device-id";

function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function setToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* cookie fallback applies */ }
}
function getDeviceToken(): string | null {
  try { return localStorage.getItem(DEVICE_KEY); } catch { return null; }
}
function setDeviceToken(token: string | null, id?: string) {
  try {
    if (token) {
      localStorage.setItem(DEVICE_KEY, token);
      if (id) localStorage.setItem(DEVICE_ID_KEY, id);
    } else {
      localStorage.removeItem(DEVICE_KEY);
      localStorage.removeItem(DEVICE_ID_KEY);
    }
  } catch { /* private mode — device memory unavailable, key login still works */ }
}
function getDeviceId(): string | null {
  try { return localStorage.getItem(DEVICE_ID_KEY); } catch { return null; }
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("Content-Type", "application/json");
  const t = getToken();
  if (t) headers.set("x-gate-token", t);
  return fetch(path, { ...init, headers, cache: "no-store" });
}
async function apiJson<T>(path: string, init?: RequestInit): Promise<T | null> {
  try { return (await (await api(path, init)).json()) as T; } catch { return null; }
}

/* ══════════════════════════ types (real API shapes) ══════════════════════════ */

interface GateStatus {
  ok: boolean; initialized: boolean; unlocked: boolean; hint: string | null;
  unlockedAt: string | null; keySeals: number;
  session: { kind: string; name: string; scopes: string[] } | null;
  counts: { vaultEntries: number; activeAgents: number; messages: number };
}
interface Entry {
  id: string; kind: string; chain: string | null; account: string | null;
  role: string | null; pub: string | null; status: string;
  liveOk: boolean | null; detail: string;
}
interface Inventory {
  ok: boolean; locked: boolean; entries: Entry[];
  summary?: { total: number; verified: number; failed: number; noLive: number };
  chains?: { steemOk: boolean; hiveOk: boolean; githubOk: boolean };
}
interface AgentRow {
  id: string; name: string; memo: string | null; active: boolean;
  createdAt: string; lastSeenAt: string;
  modules?: string[] | null; brain?: string | null; autonomy?: boolean;
}
interface ModuleDef { id: string; name: string; kind: "skill" | "connector" | "actor"; desc: string; args: string; needsVault: boolean }
interface TraceStep { i: number; side: "maker" | "checker"; thought?: string; tool?: string; args?: Record<string, unknown>; ok?: boolean; result?: unknown; error?: string; ms?: number; cached?: boolean; rescued?: boolean; repair?: boolean; at: string }
interface CheckerVerdict { done: boolean; checks: { criterion: string; pass: boolean; evidence: string }[]; gaps: string; notes: string }
interface RunRow { id: string; agentName: string; goal: string; brain: string; checker: string; budget: number; status: string; createdAt: string; finishedAt: string | null; report?: string | null; makerSteps?: number; durationMs?: number | null; tokens?: string | null; origin?: string; attempt?: number; meta?: string | null }
interface RunDetail extends RunRow {
  doneMeans: string[]; modules: string[];
  steps: TraceStep[]; verdict: CheckerVerdict | null; error?: string | null;
  lessons?: string[]; durationMs?: number | null; tokens?: { prompt: number; completion: number } | null;
}
interface AgentStat { agent: string; runs: number; done: number; blocked: number; failed: number; avgSteps: number; avgMs: number | null }
interface DeviceRow { id: string; label: string; createdAt: string; lastUsedAt: string; expiresAt: string; revoked: boolean }
interface Msg { id: string; channel: string; fromKind: string; fromName: string; body: string; createdAt: string }
interface ActionRow { id: string; agentName: string; action: string; params: string; ok: boolean; result: string; createdAt: string }
interface ScheduleRow { id: string; label: string; agentName: string; goal: string; kind: string; everyMs: number | null; hourUtc: number | null; budget: number; maxPerDay: number; dayCount: number; dayKey: string | null; enabled: boolean; lastRunAt: string | null; nextRunAt: string }
interface EventRow { id: string; type: string; payload: { agent?: string; body?: string; goal?: string; gaps?: string; by?: string } | null; source: string; consumed: boolean; createdAt: string }
interface TriggerRow { id: string; on: string; agentName: string; goalTemplate: string; budget: number; cooldownMs: number; maxPerDay: number; dayCount: number; enabled: boolean }
interface PulseRow { startedAt: string; lastTickAt: string; beats: number; enabled: boolean; counters: { dispatched: number; reaped: number; recovered: number; schedulesFired: number; schedulesDeferred: number; triggersFired: number; eventsSeen: number }; loops: Record<string, { lastAt: string; ok: boolean; fired?: number }>; error?: string }
interface HeartData { ok: boolean; pulse: PulseRow | null; counts: { queued: number; running: number }; autonomyEnabled: boolean; schedules: ScheduleRow[]; triggers: TriggerRow[]; events: EventRow[]; agents: { name: string; autonomy: boolean; lastSeenAt: string; brain: string | null }[] }
interface KeyReport {
  kind: string; liveChecked: boolean;
  controls: { chain: string; account: string | null; role: string; pub: string | null }[];
  pubs: string[];
}
interface Ep { method: "GET" | "POST"; path: string; desc: string; auth: "public" | "operator"; body?: string }

const ENDPOINTS: Ep[] = [
  { method: "GET", path: "/api/gate/status", desc: "מצב-השער הריבוני", auth: "public" },
  { method: "GET", path: "/api/gate/inventory", desc: "הכספת + אימות-חי מול השרשרות", auth: "operator" },
  { method: "POST", path: "/api/gate/reveal", desc: "פענוח מפתח-פרטי לפי id", auth: "operator", body: '{ "id": "<entry-id>" }' },
  { method: "POST", path: "/api/gate/key", desc: "זיהוי-חי של מפתח + שמירה מוצפנת", auth: "operator", body: '{ "key": "…", "save": false }' },
  { method: "GET", path: "/api/gate/agents", desc: "הסוכנים המחוברים", auth: "operator" },
  { method: "POST", path: "/api/gate/agents", desc: "צירוף סוכן (טוקן פעם-אחת)", auth: "operator", body: '{ "name": "my-agent" }' },
  { method: "GET", path: "/api/gate/modules", desc: "מחסן-המודולים לחימוש סוכנים", auth: "operator" },
  { method: "POST", path: "/api/gate/run", desc: "הרצת מטרה עם לולאת-חוכמה (מייצר + בודק עצמאי + לקחים)", auth: "operator", body: '{ "agentName": "…", "goal": "…", "doneMeans": ["…"] }' },
  { method: "GET", path: "/api/gate/run", desc: "יומן הרצות + יעילות-צי אמיתית", auth: "operator" },
  { method: "GET", path: "/api/gate/heart", desc: "דופק לב-האוטונומיה: סיורים, טריגרים, אירועים ותור", auth: "operator" },
  { method: "POST", path: "/api/gate/heart", desc: "מתג-הפסק לאוטונומיה (kill-switch)", auth: "operator", body: '{ "autonomyEnabled": false }' },
  { method: "POST", path: "/api/gate/schedule", desc: "קביעת סיור אוטונומי תקופתי", auth: "operator", body: '{ "label": "…", "agentName": "…", "goal": "…", "everyMinutes": 30, "maxPerDay": 8 }' },
  { method: "PATCH", path: "/api/gate/schedule", desc: "השהיה או הפעלה של סיור", auth: "operator", body: '{ "id": "…", "enabled": false }' },
  { method: "POST", path: "/api/gate/device", desc: "חימוש מכשיר-מהימן (זכור אותי בצורה בטוחה)", auth: "operator", body: '{ "label": "Chrome · Windows" }' },
  { method: "POST", path: "/api/gate/device/login", desc: "כניסה חוזרת ממכשיר מוכר — בלי מפתח", auth: "public", body: '{ "deviceToken": "…" }' },
  { method: "GET", path: "/api/gate/device", desc: "רשימת המכשירים-המהימנים", auth: "operator" },
  { method: "POST", path: "/api/gate/messages", desc: "פרסום בגשר-הפיקוד", auth: "operator", body: '{ "body": "…" }' },
  { method: "GET", path: "/api/gate/actions", desc: "יומן-הביקורת", auth: "operator" },
  { method: "POST", path: "/api/gate/lock", desc: "נעילה וניקוי-זיכרון", auth: "public" },
  { method: "GET", path: "/api/system/health", desc: "בריאות-מערכת", auth: "public" },
  { method: "GET", path: "/api/steem/market", desc: "שוק STEEM חי", auth: "public" },
  { method: "GET", path: "/api/steem/wallet?account=headcorner", desc: "ארנק headcorner", auth: "public" },
  { method: "GET", path: "/api/vault/status", desc: "מצב vault ההיסטורי", auth: "public" },
  { method: "GET", path: "/api/vault/keys", desc: "מפתחות vault ההיסטורי", auth: "public" },
  { method: "GET", path: "/api/eco/networks", desc: "רשתות האקו-סיסטם", auth: "public" },
  { method: "GET", path: "/api/saos/fleet-status", desc: "מצב צי SAOS", auth: "public" },
  { method: "GET", path: "/api/bridge/status", desc: "מצב הגשר", auth: "public" },
];

/* ══════════════════════════ motion helpers ══════════════════════════ */

const rise = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-70px" },
  transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const },
};

/** מונה שנספר עד לערך (אנימציית-ספירה). */
function useCountUp(target: number, duration = 1100): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return v;
}

/** פענוח-באנימציה: תווים אקראיים מתייצבים לטקסט האמיתי. */
function Scramble({ text, className }: { text: string; className?: string }) {
  const [out, setOut] = useState("");
  useEffect(() => {
    const glyphs = "0123456789abcdefABCDEFKLMNOPQRSTUVWXYZ";
    let frame = 0;
    const total = Math.min(46, Math.max(20, Math.round(text.length / 2.2)));
    const iv = setInterval(() => {
      frame++;
      const fixed = Math.floor(text.length * (frame / total));
      let s = text.slice(0, fixed);
      for (let i = fixed; i < text.length; i++) {
        s += text[i] === " " ? " " : glyphs[Math.floor(Math.random() * glyphs.length)];
      }
      setOut(s);
      if (frame >= total) { clearInterval(iv); setOut(text); }
    }, 28);
    return () => clearInterval(iv);
  }, [text]);
  return <code className={className} dir="ltr">{out || "…"}</code>;
}

/* ══════════════════════════ the vault seal (SVG) ══════════════════════════ */

function VaultSeal({ seals, state, size = 300 }: { seals: number; state: "locked" | "verifying" | "open"; size?: number }) {
  const notches = Math.max(1, Math.min(16, seals || 1));
  const iconCls = size >= 120 ? "h-10 w-10" : "h-4 w-4";
  const spin = state === "verifying" ? "animate-[spin_2.5s_linear_infinite]" : "animate-[spin_40s_linear_infinite]";
  const spin2 = state === "verifying" ? "animate-[spin_1.6s_linear_infinite_reverse]" : "animate-[spin_28s_linear_infinite_reverse]";
  const color = state === "open" ? "#34d399" : state === "verifying" ? "#fcd34d" : "#a1a1aa";
  return (
    <div className="relative" style={{ width: size, height: size }} aria-hidden>
      <div className="absolute inset-0 rounded-full blur-3xl opacity-30"
        style={{ background: `radial-gradient(circle, ${color}55 0%, transparent 62%)` }} />
      <svg viewBox="0 0 200 200" className={`absolute inset-0 h-full w-full ${spin}`} style={{ filter: `drop-shadow(0 0 14px ${color}66)` }}>
        <circle cx="100" cy="100" r="92" fill="none" stroke={color} strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="4 9" />
      </svg>
      <svg viewBox="0 0 200 200" className={`absolute inset-0 h-full w-full ${spin2}`} style={{ filter: `drop-shadow(0 0 10px ${color}55)` }}>
        <circle cx="100" cy="100" r="78" fill="none" stroke={color} strokeOpacity="0.7" strokeWidth="2.5" strokeDasharray={`${(2 * Math.PI * 78) / (notches * 2)} ${(2 * Math.PI * 78) / (notches * 2)}`} strokeLinecap="round" />
        <circle cx="100" cy="100" r="64" fill="none" stroke={color} strokeOpacity="0.35" strokeWidth="1" strokeDasharray="1 6" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
        <motion.div
          key={state}
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 220, damping: 18 }}
        >
          {state === "open"
            ? <ShieldCheck className={iconCls} style={{ color }} />
            : state === "verifying"
              ? <Loader2 className={iconCls + " animate-spin"} style={{ color }} />
              : <Lock className={iconCls} style={{ color }} />}
        </motion.div>
        {size >= 120 && (
          <>
            <p className="text-[11px] font-mono tracking-widest" style={{ color }}>{notches} SEALS</p>
            <p className="text-[10px] font-mono tracking-[0.3em] text-zinc-500">
              {state === "open" ? "UNLOCKED" : state === "verifying" ? "VERIFYING" : "SEALED"}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════ shared bits ══════════════════════════ */

function SectionHead({ num, title, sub }: { num: string; title: string; sub: string }) {
  return (
    <motion.div {...rise} className="mb-6 flex items-end gap-4">
      <span className="font-mono text-5xl md:text-6xl font-black leading-none text-zinc-800 select-none" aria-hidden>{num}</span>
      <div>
        <h2 className="text-2xl md:text-3xl font-black tracking-tight text-zinc-100">{title}</h2>
        <p className="text-sm text-zinc-500 mt-1">{sub}</p>
      </div>
    </motion.div>
  );
}

function LiveDot({ ok }: { ok: boolean | null }) {
  if (ok === true) return <span className="inline-flex items-center gap-1 text-xs text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> חי</span>;
  if (ok === false) return <span className="inline-flex items-center gap-1 text-xs text-rose-400"><XCircle className="h-3.5 w-3.5" /> נכשל</span>;
  return <span className="inline-flex items-center gap-1 text-xs text-zinc-500"><MinusCircle className="h-3.5 w-3.5" /> ללא בדיקה</span>;
}

function copyText(text: string, label: string) {
  navigator.clipboard.writeText(text).then(() => toast.success("הועתק: " + label)).catch(() => toast.error("ההעתקה נכשלה"));
}

function GlowCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={"rounded-2xl border border-zinc-800/80 bg-zinc-900/40 backdrop-blur-sm " + className}>
      {children}
    </div>
  );
}

/* ══════════════════════════ root ══════════════════════════ */

export default function Page() {
  const [booting, setBooting] = useState(true);
  const [status, setStatus] = useState<GateStatus | null>(null);
  const [sealState, setSealState] = useState<"locked" | "verifying" | "open">("locked");
  const [deviceRemembered, setDeviceRemembered] = useState(false);

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
          }
        } catch { /* network hiccup — the lock screen stays honest */ }
      }
      setBooting(false);
    })();
  }, [refreshStatus]);

  async function logout() {
    setSealState("locked");
    await apiJson("/api/gate/lock", { method: "POST" });
    setToken(null);
    setStatus(null);
    toast("הכספת נאטמה — מפתח-האב נמחק מהזיכרון");
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

  return (
    <div dir="rtl" className={wrapper}>
      <Backdrop />
      <StickyHeader status={status} onLock={logout} />
      <main className="relative z-10 flex-1 w-full max-w-5xl mx-auto px-4 md:px-6">
        <Hero status={status} />
        <Connections />
        <VaultGrid />
        <Agents />
        <Bridge />
        <Audit />
        <ApiConsole />
        <TrustedDevices />
        <EmergencyZone onAfter={refreshStatus} />
        <div className="h-10" />
      </main>
      <footer className="relative z-10 mt-auto border-t border-zinc-900 bg-black/60 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-600">
          <span className="font-mono tracking-widest">SAOS SOVEREIGN VAULT · AES-256-GCM · scrypt(2¹⁵)</span>
          <span>
            מחובר כ-<b className="text-zinc-400">{status.session.name}</b> · {status.keySeals} חותמות-מפתח · סשן 30 יום
            {deviceRemembered && <span className="text-emerald-500/80"> · מכשיר זכור ✓</span>}
          </span>
        </div>
      </footer>
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

/* ══════════════════════════ lock scene ══════════════════════════ */

function LockScene({
  status, state, deviceRemembered, onVerifying, onFail, onIn,
}: {
  status: GateStatus | null;
  state: "locked" | "verifying" | "open";
  deviceRemembered: boolean;
  onVerifying: () => void;
  onFail: () => void;
  onIn: (token: string) => Promise<boolean>;
}) {
  const [keyInput, setKeyInput] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [remember, setRemember] = useState(true);

  async function login() {
    if (!keyInput.trim() || state === "verifying") return;
    setErr(null);
    onVerifying();
    try {
      const r = await fetch("/api/gate/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: keyInput.trim() }),
      }).then((x) => x.json());
      if (r?.ok && r.token) {
        setKeyInput("");
        const okIn = await onIn(r.token as string);
        if (okIn && remember) {
          // arm THIS browser as a trusted device — the raw token lives only here;
          // the server keeps the hash + the master sealed under it (DB alone is inert)
          try {
            const d = await apiJson<{ ok: boolean; device?: { id: string }; deviceToken?: string; error?: string }>("/api/gate/device", {
              method: "POST",
              body: JSON.stringify({}),
            });
            if (d?.ok && d.deviceToken) {
              setDeviceToken(d.deviceToken, d.device?.id);
              toast.success("המכשיר הזה זכור — הכניסה הבאה בלי מפתח (90 יום)");
            } else {
              toast.error(d?.error || "חימוש-המכשיר נכשל — הכניסה במפתח תמיד עובדת");
            }
          } catch { /* device arm is best-effort — session already live */ }
        }
      } else {
        setErr(r?.error || "הכניסה נכשלה");
        onFail();
      }
    } catch {
      setErr("השרת לא נענה — נסה שוב");
      onFail();
    }
  }

  return (
    <div className="relative z-10 flex-1 flex flex-col">
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12 gap-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <VaultSeal seals={status?.keySeals || 0} state={state} size={280} />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.6 }}
          className="w-full max-w-lg text-center"
        >
          <h1 className="text-3xl md:text-5xl font-black tracking-tight">
            SAOS <span className="text-emerald-400">SOVEREIGN</span> VAULT
          </h1>
          <p className="mt-3 text-zinc-400 text-sm md:text-base leading-relaxed">
            מדביקים כל מפתח <span className="font-mono text-zinc-300">@headcorner</span> נוכחי — STEEM או HIVE,
            כל תפקיד — והכספת נפתחת. בלי סיסמה. האימות חי מול השרשרת.
          </p>

          <div className="mt-7 flex flex-col sm:flex-row gap-2.5">
            <label htmlFor="gate-key" className="sr-only">מפתח-פרטי</label>
            <Input
              id="gate-key"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") login(); }}
              placeholder="5K… / K… / L… — הדבק כאן את המפתח"
              className="font-mono text-sm h-12 bg-zinc-950/80 border-zinc-800 focus-visible:ring-emerald-500/40 text-center sm:text-right"
              autoComplete="off" autoCapitalize="off" spellCheck={false} autoFocus
            />
            <Button
              onClick={login}
              disabled={state === "verifying" || !keyInput.trim()}
              className="h-12 px-7 text-base gap-2 bg-emerald-600 hover:bg-emerald-500 text-black font-bold shrink-0"
            >
              {state === "verifying"
                ? <><Loader2 className="h-4 w-4 animate-spin" /> מאמת מול השרשרת…</>
                : <><KeyRound className="h-4 w-4" /> פתח את הכספת</>}
            </Button>
          </div>

          {err && (
            <p role="alert" className="mt-4 text-sm text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-2.5">{err}</p>
          )}

          <div className="mt-4 flex items-center justify-center gap-3">
            <Switch
              checked={remember}
              onCheckedChange={setRemember}
              aria-label="זכור אותי על המכשיר הזה"
              className="data-[state=checked]:bg-emerald-600"
            />
            <span className="text-xs text-zinc-400">
              זכור אותי בצורה בטוחה על המכשיר הזה — <span className="text-zinc-500">כניסה חוזרת בלי מפתח, 90 יום, שלילה בלחיצה</span>
            </span>
          </div>
          {deviceRemembered && (
            <p className="mt-2 text-[11px] font-mono text-amber-300/80">⚠ היה כאן טוקן-מכשיר שנפסל — היכנס במפתח וחמש מכשיר מחדש</p>
          )}

          {status && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
              className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 font-mono text-xs text-zinc-500"
            >
              <span><b className="text-zinc-300">{status.counts.vaultEntries}</b> סודות מוצפנים</span>
              <span className="text-zinc-700">·</span>
              <span><b className="text-zinc-300">{status.keySeals}</b> חותמות-מפתח</span>
              <span className="text-zinc-700">·</span>
              <span><b className="text-zinc-300">{status.counts.activeAgents}</b> סוכנים</span>
              <span className="text-zinc-700">·</span>
              <span>{status.initialized ? "מאותחל" : "לא מאותחל"}</span>
            </motion.div>
          )}
        </motion.div>
      </main>

      <footer className="relative z-10 mt-auto border-t border-zinc-900 bg-black/60 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 py-4 text-center font-mono text-xs text-zinc-600 tracking-widest">
          SEALS CANNOT BE FORGED · GCM REJECTS EVERY WRONG KEY · 30-DAY SESSION
        </div>
      </footer>
    </div>
  );
}

/* ══════════════════════════ sticky header (unlocked) ══════════════════════════ */

function StickyHeader({ status, onLock }: { status: GateStatus; onLock: () => void }) {
  const verified = useCountUp(status.counts.vaultEntries, 1400);
  return (
    <motion.header
      initial={{ y: -60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="sticky top-0 z-30 border-b border-zinc-900 bg-black/70 backdrop-blur-md"
    >
      <div className="max-w-5xl mx-auto px-4 md:px-6 h-14 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <VaultSeal seals={status.keySeals} state="open" size={34} />
          <span className="font-black tracking-tight text-sm md:text-base truncate">
            SOVEREIGN <span className="text-emerald-400">VAULT</span>
          </span>
          <Badge variant="outline" className="hidden sm:inline-flex text-emerald-400 border-emerald-500/40 text-[10px] font-mono">פתוחה</Badge>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden md:block font-mono text-xs text-zinc-500">
            <span className="text-emerald-400 font-bold">{verified}</span>/{status.counts.vaultEntries} סודות
          </span>
          <Button variant="outline" size="sm" onClick={onLock} className="gap-1.5 border-zinc-800 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10">
            <LogOut className="h-3.5 w-3.5" /> אטום
          </Button>
        </div>
      </div>
    </motion.header>
  );
}

/* ══════════════════════════ hero ══════════════════════════ */

function Hero({ status }: { status: GateStatus }) {
  const secrets = useCountUp(status.counts.vaultEntries);
  const seals = useCountUp(status.keySeals);
  const agents = useCountUp(status.counts.activeAgents);
  const msgs = useCountUp(status.counts.messages);
  return (
    <section className="pt-12 pb-8">
      <motion.p {...rise} className="font-mono text-xs tracking-[0.35em] text-emerald-400/80 mb-3">{"// הכספת פתוחה — ברוך שובך"}</motion.p>
      <motion.h2
        initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.6 }}
        className="text-4xl md:text-6xl font-black tracking-tight leading-[1.05]"
      >
        הכול מחובר.<br />
        <span className="text-zinc-500">הכול מאומת.</span>{" "}
        <span className="bg-gradient-to-l from-emerald-300 to-amber-300 bg-clip-text text-transparent">הכול שלך.</span>
      </motion.h2>

      <motion.div {...rise} transition={{ ...rise.transition, delay: 0.15 }} className="mt-9 grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { v: secrets, label: "סודות מוצפנים", unit: "" },
          { v: seals, label: "חותמות-מפתח", unit: "" },
          { v: agents, label: "סוכנים פעילים", unit: "" },
          { v: msgs, label: "הודעות-פיקוד", unit: "" },
        ].map((t) => (
          <GlowCard key={t.label} className="p-5">
            <p className="font-mono text-4xl font-black text-zinc-100">{t.v}</p>
            <p className="mt-1 text-xs text-zinc-500">{t.label}</p>
          </GlowCard>
        ))}
      </motion.div>

      <motion.div {...rise} className="mt-6 flex justify-center">
        <ArrowDown className="h-5 w-5 text-zinc-600 animate-bounce" aria-hidden />
      </motion.div>
    </section>
  );
}

/* ══════════════════════════ 01 · connections ══════════════════════════ */

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
      endpoint: "api.steemit.com", count: (byChain["steem"] || 0) + (byChain["steem-key"] || 0),
    },
    {
      name: "HIVE", icon: <Globe className="h-5 w-5" />, ok: chains?.hiveOk,
      endpoint: "api.hive.blog", count: (byChain["hive"] || 0) + (byChain["hive-key"] || 0),
    },
    {
      name: "GITHUB", icon: <Github className="h-5 w-5" />, ok: chains?.githubOk,
      endpoint: "api.github.com", count: byChain["github"] || 0,
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
      <div className="grid gap-4 md:grid-cols-3">
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
              <p className="text-xs text-zinc-500 mt-1">סודות בכספת</p>
              <p className="mt-3 font-mono text-[10px] text-zinc-600" dir="ltr">{c.endpoint}</p>
            </GlowCard>
          </motion.div>
        ))}
      </div>
      {summary && (
        <motion.p {...rise} className="mt-4 font-mono text-xs text-zinc-500">
          אימות-חי אחרון: <b className="text-emerald-400">{summary.verified}</b> עברו ·{" "}
          {summary.failed > 0 ? <span className="text-rose-400">{summary.failed} נכשלו</span> : <span className="text-zinc-600">0 נכשלו</span>} ·{" "}
          {summary.noLive} ללא-בדיקה-אפשרית
        </motion.p>
      )}
    </section>
  );
}

/* ══════════════════════════ 02 · the vault ══════════════════════════ */

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
  const chainsList = useMemo(() => Array.from(new Set(entries.map((e) => (e.chain || e.kind)))).sort(), [entries]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entries.filter((e) => {
      if (chain !== "*" && (e.chain || e.kind) !== chain) return false;
      if (!needle) return true;
      return [e.account, e.role, e.kind, e.chain, e.pub].some((f) => (f || "").toLowerCase().includes(needle));
    });
  }, [entries, q, chain]);

  return (
    <section className="py-14">
      <SectionHead num="02" title="הכספת — כל המפתחות" sub="לוחצים 'פענח' והמפתח הפרטי מתגלה כאן, מוצפן-עד-הרגע הזה." />

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
          <FilterChip key={c} active={chain === c} onClick={() => setChain(c)} label={`${c} (${entries.filter((e) => (e.chain || e.kind) === c).length})`} />
        ))}
      </motion.div>

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
    </section>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={
        "rounded-full px-4 py-1.5 font-mono text-xs transition-all border " +
        (active
          ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-300"
          : "bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200")
      }
    >
      {label}
    </button>
  );
}

/* ══════════════════════════ 03 · key injection ══════════════════════════ */

function KeyInject() {
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
    <section className="py-14">
      <SectionHead num="03" title="הזרקת מפתח" sub="מדביקים כל מפתח — מזהים אותו חי מול השרשרות, ואפשר לשמור אותו מוצפן בכספת." />
      <motion.div {...rise}>
        <GlowCard className="p-6">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <KeyRound className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-600" aria-hidden />
              <Input
                value={keyInput} onChange={(e) => setKeyInput(e.target.value)}
                placeholder="WIF / hex / מנשק / PAT — הדבק כאן"
                className="pr-9 font-mono text-sm bg-zinc-950/80 border-zinc-800" dir="ltr"
                autoComplete="off" spellCheck={false}
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
                    {report.controls.map((c, i) => (
                      <Badge key={i} variant="outline" className="font-mono text-[10px] border-emerald-500/30 text-emerald-300 ml-1.5">
                        {c.chain}{c.account ? `·${c.account}` : ""}@{c.role}
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
    </section>
  );
}

/* ══════════════════════════ 04 · המחסן — חימוש סוכנים + לולאת-מטרה ══════════════════════════ */

const BRAIN_MAKER_DEFAULT = "nvidia:openai/gpt-oss-20b";
const KIND_META: Record<ModuleDef["kind"], { label: string; cls: string }> = {
  skill: { label: "מיומנות", cls: "text-emerald-300 border-emerald-500/40" },
  connector: { label: "מחבר", cls: "text-sky-300 border-sky-500/40" },
  actor: { label: "מבצע", cls: "text-amber-300 border-amber-500/40" },
};

type ModStats = Record<string, { calls: number; cached: number; failed: number; msTotal: number }>;

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

/* ══════════════════════════ 04 · autonomy heart ══════════════════════════ */

const HEART_TICK_MS_CLIENT = 20000;

function AutonomyCard({ agents }: { agents: AgentRow[] }) {
  const [h, setH] = useState<HeartData | null>(null);
  const [busy, setBusy] = useState(false);

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
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { load(); }, 8000);
    return () => clearInterval(t);
  }, [load]);

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
              <span title="ריצות קרוסות שהשומר החזיר לתור">reaped {c.reaped}</span>
            </span>
          )}
          {h?.pulse?.error && <span className="text-rose-300" dir="ltr">⚠ {h.pulse.error}</span>}
        </div>

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
      <SectionHead num="04" title="מחסן-החימוש" sub="סוכן בלי מודולים הוא טוקן חסר-ידיים. מחברים, חומשים, נותנים מטרה עם קריטריוני-סיום — ובודק עצמאי פוסק. והלב? הסוכנים קמים גם לבד — סיורים, טריגרים והתאוששות-מקריסה, בלי שתלחץ כלום." />

      <AutonomyCard agents={agents} />

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
                    <Badge variant="outline" className={"text-[9px] font-mono shrink-0 " + (r.origin === "schedule" ? "text-sky-300 border-sky-500/40" : "text-amber-300 border-amber-500/40")} dir="ltr">{r.origin === "schedule" ? "⏰ סיור" : "⚡ טריגר"}</Badge>
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

/* ══════════════════════════ 05 · command bridge ══════════════════════════ */

function Bridge() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const r = await apiJson<{ ok: boolean; messages: Msg[] }>("/api/gate/messages");
    if (r?.ok) setMsgs(r.messages || []);
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { load(); }, 5000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [msgs]);

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
      <SectionHead num="05" title="גשר-הפיקוד" sub="אתה, הסוכנים והמערכת — ערוץ אחד. הכול נרשם." />
      <motion.div {...rise}>
        <GlowCard className="flex flex-col h-[480px] overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto scroll-thin px-5 py-4">
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
              <div ref={endRef} />
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

/* ══════════════════════════ 06 · audit ══════════════════════════ */

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
        <SectionHead num="06" title="ביקורת" sub="כל פעולת-סוכן — רשומה. תמיד." />
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

/* ══════════════════════════ 07 · API console ══════════════════════════ */

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
      <SectionHead num="07" title="מסוף-API חי" sub="כל נקודת-קצה שקיימת בקוד — מוכנה להרצה אמיתית. הטוקן מצורף אוטומטית." />
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

/* ══════════════════════════ 08 · trusted devices ══════════════════════════ */

function TrustedDevices() {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await apiJson<{ ok: boolean; devices: DeviceRow[] }>("/api/gate/device");
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
      const r = await apiJson<{ ok: boolean; error?: string }>(`/api/gate/device?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (r?.ok) {
        if (currentId === id) { setDeviceToken(null); setCurrentId(null); }
        toast.success("המכשיר נשלל — הצופן שלו אינרטי מעתה");
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
      toast("המכשיר הזה נשכח — הכניסה הבאה במפתח-חי");
      await load();
    } finally { setBusy(false); }
  }

  async function revokeAll() {
    setBusy(true);
    try {
      const r = await apiJson<{ ok: boolean; error?: string }>("/api/gate/device?all=1", { method: "DELETE" });
      if (r?.ok) {
        setDeviceToken(null);
        setCurrentId(null);
        toast.success("כל המכשירים נשללו — כניסה חוזרת רק במפתח-חי");
        await load();
      } else toast.error(r?.error || "השלילה נכשלה");
    } finally { setBusy(false); }
  }

  const active = devices.filter((d) => !d.revoked);

  return (
    <section className="py-14">
      <SectionHead num="08" title="מכשירים-מהימנים" sub="זכירה-בטוחה של המפעיל: הטוקן חי בדפדפן בלבד, השרת מחזיק hash + מפתח-אב חתום תחתו. ה-DB לבדו אינו מסוגל להיכנס." />
      <motion.div {...rise}>
        <GlowCard className="p-6">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <h3 className="font-bold flex items-center gap-2"><Smartphone className="h-4 w-4 text-emerald-400" /> {active.length} מכשירים פעילים</h3>
            <div className="flex gap-2">
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
              <div key={d.id} className={"rounded-xl border px-3.5 py-3 flex items-center gap-3 flex-wrap " + (d.revoked ? "border-zinc-800/60 bg-black/20 opacity-60" : "border-zinc-800/80 bg-black/40")}>
                <Smartphone className={"h-4 w-4 shrink-0 " + (d.revoked ? "text-zinc-600" : "text-emerald-400")} />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-zinc-200 flex items-center gap-2">
                    {d.label}
                    {d.id === currentId && <Badge variant="outline" className="text-[9px] text-emerald-300 border-emerald-500/40">המכשיר הזה</Badge>}
                    {d.revoked && <Badge variant="outline" className="text-[9px] text-zinc-500 border-zinc-700">נשלל</Badge>}
                  </p>
                  <p className="text-[10px] text-zinc-600 font-mono">
                    נוצר {new Date(d.createdAt).toLocaleDateString("he-IL")} · שימוש אחרון {new Date(d.lastUsedAt).toLocaleString("he-IL")} · פג-תוקף {new Date(d.expiresAt).toLocaleDateString("he-IL")}
                  </p>
                </div>
                {!d.revoked && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-400/80 shrink-0 mr-auto" title="שלילת מכשיר" disabled={busy} onClick={() => revoke(d.id)}>
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
            כלומר גם גניבת-DB מלאה לא מאפשרת כניסה ולא פותחת את הכספת · שלילה הופכת את הצופן לאינרטי מיד · תוקף 90 יום.
          </p>
        </GlowCard>
      </motion.div>
    </section>
  );
}

/* ══════════════════════════ 09 · emergency zone ══════════════════════════ */

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
      <SectionHead num="09" title="אזור-חירום" sub="רק אם איבדת הכול: הוכחת-בעלות חיה משחזרת את הכספת מהמקורות ששרדו. כל המכשירים-המהימנים נשללים אוטומטית — מפתח-אב חדש." />
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
