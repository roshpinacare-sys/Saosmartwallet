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
  AlertTriangle, ArrowDown,
} from "lucide-react";

/* ══════════════════════════ auth plumbing ══════════════════════════ */

const TOKEN_KEY = "saos-gate-token";

function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function setToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* cookie fallback applies */ }
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
}
interface Msg { id: string; channel: string; fromKind: string; fromName: string; body: string; createdAt: string }
interface ActionRow { id: string; agentName: string; action: string; params: string; ok: boolean; result: string; createdAt: string }
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
    (async () => { await refreshStatus(); setBooting(false); })();
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
          onVerifying={() => setSealState("verifying")}
          onFail={() => setSealState("locked")}
          onIn={async (token) => {
            setToken(token);
            const okIn = await refreshStatus();
            if (okIn) toast.success("הכספת נפתחה — כל המפתחות בפנים");
            else { setSealState("locked"); toast.error("האימות השתבש — נסה שוב"); }
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
        <EmergencyZone onAfter={refreshStatus} />
        <div className="h-10" />
      </main>
      <footer className="relative z-10 mt-auto border-t border-zinc-900 bg-black/60 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-600">
          <span className="font-mono tracking-widest">SAOS SOVEREIGN VAULT · AES-256-GCM · scrypt(2¹⁵)</span>
          <span>מחובר כ-<b className="text-zinc-400">{status.session.name}</b> · {status.keySeals} חותמות-מפתח · סשן 30 יום</span>
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
  status, state, onVerifying, onFail, onIn,
}: {
  status: GateStatus | null;
  state: "locked" | "verifying" | "open";
  onVerifying: () => void;
  onFail: () => void;
  onIn: (token: string) => void;
}) {
  const [keyInput, setKeyInput] = useState("");
  const [err, setErr] = useState<string | null>(null);

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
        onIn(r.token as string);
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

/* ══════════════════════════ 04 · agents ══════════════════════════ */

function Agents() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [tokenOnce, setTokenOnce] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await apiJson<{ ok: boolean; agents: AgentRow[] }>("/api/gate/agents");
    if (r?.ok) setAgents(r.agents || []);
    setLoading(false);
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await apiJson<{ ok: boolean; token?: string; error?: string }>("/api/gate/agents", {
        method: "POST", body: JSON.stringify({ name: name.trim(), memo: memo.trim() || undefined }),
      });
      if (r?.ok && r.token) {
        setTokenOnce(r.token);
        setName(""); setMemo("");
        toast.success("הסוכן חובר — שמור את הטוקן עכשיו");
        load();
      } else toast.error(r?.error || "יצירת סוכן נכשלה");
    } finally { setBusy(false); }
  }

  async function revoke(n: string) {
    const r = await apiJson<{ ok: boolean }>(`/api/gate/agents?name=${encodeURIComponent(n)}`, { method: "DELETE" });
    if (r?.ok) { setAgents((a) => a.map((x) => (x.name === n ? { ...x, active: false } : x))); toast("הסוכן נשלל"); }
  }

  return (
    <section className="py-14">
      <SectionHead num="04" title="הסוכנים" sub="כל agent חיצוני מקבל טוקן אחד וכותב ומבצע דרך API — הכל מבוקר." />
      <div className="grid gap-4 lg:grid-cols-2">
        <motion.div {...rise}>
          <GlowCard className="p-6 h-full">
            <h3 className="font-bold flex items-center gap-2 mb-4"><UserCheck className="h-4 w-4 text-emerald-400" /> חיבור סוכן חדש</h3>
            <div className="space-y-2.5">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="שם-סוכן (a-z 0-9 _ -)" className="font-mono text-sm bg-zinc-950/80 border-zinc-800" dir="ltr" />
              <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="תיאור חופשי (לא חובה)" className="text-sm bg-zinc-950/80 border-zinc-800" />
              <Button onClick={create} disabled={busy || !name.trim()} className="w-full gap-2 bg-emerald-600 hover:bg-emerald-500 text-black font-bold">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} חבר סוכן
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
            <div className="mt-5 rounded-xl bg-black/60 border border-zinc-800/80 p-3.5">
              <p className="font-semibold text-xs mb-2 text-zinc-300">הסוכן מדבר עם הכספת כך:</p>
              <pre className="font-mono text-[11px] whitespace-pre-wrap text-zinc-500 leading-relaxed" dir="ltr">{`Authorization: Bearer <TOKEN>

POST /api/gate/messages  {"body":"…"}
POST /api/gate/actions   {"action":"report.status"}
POST /api/gate/actions   {"action":"vault.list-pubs"}
POST /api/gate/actions   {"action":"verify.run"}`}</pre>
            </div>
          </GlowCard>
        </motion.div>

        <motion.div {...rise} transition={{ ...rise.transition, delay: 0.1 }}>
          <GlowCard className="p-6 h-full">
            <h3 className="font-bold mb-4">הצי ({agents.filter((a) => a.active).length} פעילים)</h3>
            <div className="max-h-80 overflow-y-auto scroll-thin space-y-2">
              {loading && <div className="flex items-center gap-2 text-sm text-zinc-500 py-4 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> טוען…</div>}
              {!loading && agents.map((a) => (
                <div key={a.id} className="flex items-center gap-2.5 rounded-xl border border-zinc-800/80 bg-black/40 px-3.5 py-2.5">
                  <Bot className={"h-4 w-4 shrink-0 " + (a.active ? "text-emerald-400" : "text-zinc-600")} />
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-bold truncate">{a.name}</p>
                    {a.memo && <p className="text-[10px] text-zinc-600 truncate">{a.memo}</p>}
                  </div>
                  {a.active
                    ? <Badge variant="outline" className="text-emerald-400 border-emerald-500/40 text-[10px] shrink-0">פעיל</Badge>
                    : <Badge variant="outline" className="text-zinc-600 border-zinc-800 text-[10px] shrink-0">נשלל</Badge>}
                  <span className="hidden xl:block text-[10px] text-zinc-600 mr-auto shrink-0">{new Date(a.lastSeenAt).toLocaleString("he-IL")}</span>
                  {a.active && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-400/80 shrink-0" title="שלילת סוכן" onClick={() => revoke(a.name)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
              {!loading && agents.length === 0 && <p className="text-sm text-zinc-500 py-6 text-center">אין סוכנים עדיין</p>}
            </div>
          </GlowCard>
        </motion.div>
      </div>
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

/* ══════════════════════════ 08 · emergency zone ══════════════════════════ */

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
      <SectionHead num="08" title="אזור-חירום" sub="רק אם איבדת הכול: הוכחת-בעלות חיה משחזרת את הכספת מהמקורות ששרדו." />
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
