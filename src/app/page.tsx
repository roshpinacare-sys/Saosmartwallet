"use client";

/**
 * SAOS GATE — קונסולת-פיקוד חדשה לגמרי.
 * כניסה אחת: מדביקים מפתח headcorner נוכחי (STEEM/HIVE) → עובדים.
 * הכול נגיש מה-UI וממופה 1:1 ל-APIs האמיתיים בקוד (בלי המצאות):
 *   status · inventory(+live verify) · reveal · key(identify/save)
 *   agents(create/list/revoke) · messages · actions(audit) · lock
 * ובנוסף מסוף-API חי שמריץ כל endpoint אמיתי שקיים בקודבייס.
 *
 * אימות: הטוקן שחוזר מההתחברות נשמר בדפדפן ונשלח בכל קריאה בכותרת
 * `x-gate-token` (הקוקי נשאר כגיבוי). זה התיקון לבאג "התחברתי ולא קרה כלום":
 * בתצוגת-התצוגה המקדימה הקוקי נזרק כקוקי-צד-שלישי, ואז כל הקריאות החזירו
 * 400 operator-only מיד אחרי התחברות "מוצלחת".
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  KeyRound, ShieldCheck, LogOut, Copy, Eye, EyeOff, Bot, Send, RefreshCw,
  Loader2, Plus, Trash2, CheckCircle2, XCircle, MinusCircle, Terminal,
  ScrollText, LayoutDashboard, Lock, Save, UserCheck, Braces,
} from "lucide-react";

/* ─────────────────────────── auth plumbing ─────────────────────────── */

const TOKEN_KEY = "saos-gate-token";

function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function setToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage blocked — cookie fallback still applies */ }
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

/* ─────────────────────────── types (real API shapes) ─────────────────────────── */

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
interface ActionRow {
  id: string; agentName: string; action: string; params: string;
  ok: boolean; result: string; createdAt: string;
}
interface KeyReport {
  kind: string; liveChecked: boolean;
  controls: { chain: string; account: string | null; role: string; pub: string | null }[];
  pubs: string[];
}

/* real endpoints that exist in the codebase (rg "export async function" src/app/api) */
interface Ep { method: "GET" | "POST"; path: string; desc: string; auth: "public" | "operator" | "agent"; body?: string }
const ENDPOINTS: Ep[] = [
  { method: "GET", path: "/api/gate/status", desc: "מצב-השער: מאותחל? פתוח? מי מחובר?", auth: "public" },
  { method: "GET", path: "/api/gate/inventory", desc: "מלוא הכספת + אימות-חי מול השרשרות", auth: "operator" },
  { method: "POST", path: "/api/gate/reveal", desc: "צפייה במפתח-פרטי לפי id (מבוקרת)", auth: "operator", body: '{ "id": "<vault-entry-id>" }' },
  { method: "POST", path: "/api/gate/key", desc: "זיהוי-חי של כל מפתח + שמירה מוצפנת לכספת", auth: "operator", body: '{ "key": "…", "save": false }' },
  { method: "GET", path: "/api/gate/agents", desc: "רשימת סוכנים מחוברים", auth: "operator" },
  { method: "POST", path: "/api/gate/agents", desc: "צירוף סוכן (טוקן מוחזר פעם-אחת)", auth: "operator", body: '{ "name": "my-agent", "memo": "…" }' },
  { method: "POST", path: "/api/gate/messages", desc: "פרסום בצ'אט-הפיקוד", auth: "operator", body: '{ "body": "…" }' },
  { method: "GET", path: "/api/gate/actions", desc: "יומן-ביקורת של פעולות-סוכנים", auth: "operator" },
  { method: "POST", path: "/api/gate/lock", desc: "נעילת הכספת וניקוי הזיכרון", auth: "public" },
  { method: "GET", path: "/api/system/health", desc: "בריאות-מערכת", auth: "public" },
  { method: "GET", path: "/api/steem/market", desc: "שוק STEEM חי", auth: "public" },
  { method: "GET", path: "/api/steem/wallet?account=headcorner", desc: "ארנק STEEM של headcorner", auth: "public" },
  { method: "GET", path: "/api/steem/history?account=headcorner&limit=10", desc: "היסטוריית-פעולות STEEM", auth: "public" },
  { method: "GET", path: "/api/vault/status", desc: "מצב כספת ה-vault (המערכת הקודמת)", auth: "public" },
  { method: "GET", path: "/api/vault/keys", desc: "רשימת מפתחות vault", auth: "public" },
  { method: "GET", path: "/api/vault/policy", desc: "מדיניות ה-vault", auth: "public" },
  { method: "GET", path: "/api/eco/networks", desc: "רשתות האקו-סיסטם", auth: "public" },
  { method: "GET", path: "/api/eco/saos-hub", desc: "מצב SAOS-Hub", auth: "public" },
  { method: "GET", path: "/api/saos/fleet-status", desc: "מצב צי הסוכנים (SAOS)", auth: "public" },
  { method: "GET", path: "/api/bridge/status", desc: "מצב הגשר", auth: "public" },
];

/* ─────────────────────────── root ─────────────────────────── */

type Section = "overview" | "keys" | "agents" | "chat" | "audit" | "api";

export default function Page() {
  const [booting, setBooting] = useState(true);
  const [status, setStatus] = useState<GateStatus | null>(null);
  const [section, setSection] = useState<Section>("overview");

  const refreshStatus = useCallback(async (): Promise<boolean> => {
    const s = await apiJson<GateStatus>("/api/gate/status");
    if (s?.ok) { setStatus(s); return Boolean(s.session); }
    return false;
  }, []);

  useEffect(() => {
    (async () => {
      await refreshStatus();
      setBooting(false);
    })();
  }, [refreshStatus]);

  async function logout() {
    await apiJson("/api/gate/lock", { method: "POST" });
    setToken(null);
    setStatus(null);
    toast("ננעלת — מפתח-האב נמחק מהזיכרון");
  }

  /* ─────────────────────────── lock screen ─────────────────────────── */
  if (booting) {
    return (
      <Shell>
        <div className="flex-1 flex items-center justify-center min-h-[80vh]">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-400" aria-label="טוען" />
        </div>
      </Shell>
    );
  }

  if (!status?.session) {
    return (
      <Shell>
        <LockScreen
          status={status}
          onIn={async (token) => {
            setToken(token);
            const ok = await refreshStatus();
            if (ok) { setSection("overview"); toast.success("נכנסת — הכספת פתוחה"); }
            else toast.error("נכנסת אך אימות-הסשן נכשל — נסה שוב");
          }}
        />
      </Shell>
    );
  }

  /* ─────────────────────────── console ─────────────────────────── */
  return (
    <Shell>
      <TopBar right={
        <>
          <span className="hidden md:block text-xs text-zinc-500">
            {status.counts.vaultEntries} סודות · {status.counts.activeAgents} סוכנים · {status.keySeals} חותמות
          </span>
          <Button variant="outline" size="sm" onClick={logout} className="gap-1.5 border-zinc-700 text-rose-400 hover:text-rose-300">
            <LogOut className="h-3.5 w-3.5" /> נעילה
          </Button>
        </>
      } />
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* sidebar — right side in RTL */}
        <nav aria-label="ניווט ראשי" className="lg:w-56 shrink-0 border-b lg:border-b-0 lg:border-l border-zinc-800 bg-zinc-950/95">
          <div className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible p-2 lg:sticky lg:top-14">
            <NavBtn active={section === "overview"} onClick={() => setSection("overview")} icon={<LayoutDashboard className="h-4 w-4" />} label="סקירה" />
            <NavBtn active={section === "keys"} onClick={() => setSection("keys")} icon={<KeyRound className="h-4 w-4" />} label="מפתחות" />
            <NavBtn active={section === "agents"} onClick={() => setSection("agents")} icon={<Bot className="h-4 w-4" />} label="סוכנים" />
            <NavBtn active={section === "chat"} onClick={() => setSection("chat")} icon={<Send className="h-4 w-4" />} label="צ'אט-פיקוד" />
            <NavBtn active={section === "audit"} onClick={() => setSection("audit")} icon={<ScrollText className="h-4 w-4" />} label="ביקורת" />
            <NavBtn active={section === "api"} onClick={() => setSection("api")} icon={<Terminal className="h-4 w-4" />} label="מסוף API" />
          </div>
        </nav>

        <main className="flex-1 min-w-0 p-4 lg:p-6">
          {section === "overview" && <Overview status={status} refreshStatus={refreshStatus} />}
          {section === "keys" && <KeysSection />}
          {section === "agents" && <AgentsSection />}
          {section === "chat" && <ChatSection />}
          {section === "audit" && <AuditSection />}
          {section === "api" && <ApiConsole />}
        </main>
      </div>

      {/* sticky footer */}
      <footer className="mt-auto border-t border-zinc-800 bg-zinc-950">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
          <span className="font-mono">SAOS GATE · AES-256-GCM · scrypt</span>
          <span>מחובר כ-<b className="text-zinc-300">{status.session.name}</b> · סשן 30 יום · {status.keySeals} חותמות-מפתח</span>
        </div>
      </footer>
    </Shell>
  );
}

/* ─────────────────────────── shell + shared ─────────────────────────── */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div dir="rtl" className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100">
      {children}
    </div>
  );
}

function TopBar({ right }: { right?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0" aria-hidden />
          <span className="font-black tracking-tight text-lg">SAOS GATE</span>
          <Badge variant="outline" className="text-emerald-400 border-emerald-500/40 shrink-0">ריבוני</Badge>
        </div>
        <div className="flex items-center gap-2">{right}</div>
      </div>
    </header>
  );
}

function NavBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={
        "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap " +
        (active ? "bg-zinc-800 text-emerald-400" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200")
      }
    >
      {icon}
      {label}
    </button>
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

/* ─────────────────────────── lock screen ─────────────────────────── */

function LockScreen({ status, onIn }: { status: GateStatus | null; onIn: (token: string) => void }) {
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function login() {
    setErr(null); setBusy(true);
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
      }
    } catch {
      setErr("השרת לא נענה — נסה שוב");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopBar right={status ? (
        <span className="text-xs text-zinc-500 hidden sm:block">
          {status.counts.vaultEntries} סודות · {status.counts.activeAgents} סוכנים · {status.keySeals} חותמות
        </span>
      ) : null} />

      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 shadow-2xl">
            <div className="flex flex-col items-center text-center gap-2 mb-6">
              <div className="h-14 w-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
                <KeyRound className="h-7 w-7 text-emerald-400" aria-hidden />
              </div>
              <h1 className="text-2xl font-black tracking-tight">כניסה אחת. זהו.</h1>
              <p className="text-sm text-zinc-400">הדבק כל מפתח-נוכחי של <span className="font-mono">@headcorner</span> — STEEM או HIVE, כל תפקיד. בלי סיסמה, בלי דפים מסובכים.</p>
            </div>

            <label htmlFor="gate-key" className="sr-only">מפתח-פרטי</label>
            <Input
              id="gate-key"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && keyInput.trim() && !busy) login(); }}
              placeholder="5K… / K… / L… — הדבק כאן"
              className="font-mono text-sm h-11 mb-3 bg-zinc-950 border-zinc-800"
              autoComplete="off" autoCapitalize="off" spellCheck={false} autoFocus
            />
            <Button onClick={login} disabled={busy || !keyInput.trim()} className="w-full h-11 text-base gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
              {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> מאמת מול השרשרת…</> : <><KeyRound className="h-4 w-4" /> כניסה</>}
            </Button>

            {err && (
              <p role="alert" className="mt-3 text-sm text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">{err}</p>
            )}

            <p className="mt-5 text-xs text-zinc-500 leading-relaxed text-center">
              האימות חי מול השרשרת · נשארים מחוברים 30 יום · המפתחות גלויים בתוך המערכת בלחיצה.
            </p>
          </div>
        </div>
      </main>

      <footer className="mt-auto border-t border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 py-3 text-xs text-zinc-500 text-center font-mono">SAOS GATE · כניסה במפתח-חי בלבד</div>
      </footer>
    </div>
  );
}

/* ─────────────────────────── overview ─────────────────────────── */

function Overview({ status, refreshStatus }: { status: GateStatus; refreshStatus: () => Promise<boolean> }) {
  const [inv, setInv] = useState<Inventory | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [i, m] = await Promise.all([
      apiJson<Inventory>("/api/gate/inventory"),
      apiJson<{ ok: boolean; messages: Msg[] }>("/api/gate/messages"),
    ]);
    setInv(i);
    if (m?.ok) setMsgs(m.messages || []);
    setLoading(false);
  }, []);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const tiles: { label: string; value: string; tone: string }[] = [
    { label: "מצב כספת", value: status.unlocked ? "פתוחה" : "נעולה", tone: status.unlocked ? "text-emerald-400" : "text-rose-400" },
    { label: "סודות בכספת", value: String(status.counts.vaultEntries), tone: "" },
    { label: "חותמות-מפתח", value: String(status.keySeals), tone: "" },
    { label: "סוכנים פעילים", value: String(status.counts.activeAgents), tone: "" },
    { label: "הודעות-פיקוד", value: String(status.counts.messages), tone: "" },
    {
      label: "אימות-חי אחרון",
      value: inv?.summary ? `${inv.summary.verified}/${inv.summary.total}` : loading ? "…" : "—",
      tone: inv?.summary && inv.summary.failed > 0 ? "text-amber-400" : inv?.summary ? "text-emerald-400" : "",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold">סקירה</h2>
        <Button variant="outline" size="sm" onClick={() => { load(); refreshStatus(); }} className="gap-1.5 border-zinc-700">
          <RefreshCw className={"h-3.5 w-3.5" + (loading ? " animate-spin" : "")} /> רענון
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <p className="text-xs text-zinc-500 mb-1">{t.label}</p>
            <p className={"text-2xl font-black " + t.tone}>{t.value}</p>
          </div>
        ))}
      </div>

      {inv?.chains && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <h3 className="font-semibold mb-3 text-sm">חיבור לשרשרות (אימות-חי)</h3>
          <div className="flex flex-wrap gap-3">
            <ChainPill ok={inv.chains.steemOk} label="STEEM (api.steemit.com)" />
            <ChainPill ok={inv.chains.hiveOk} label="HIVE (api.hive.blog)" />
            <ChainPill ok={inv.chains.githubOk} label="GitHub API" />
          </div>
        </div>
      )}

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <h3 className="font-semibold mb-3 text-sm">פעילות אחרונה</h3>
        <div className="max-h-72 overflow-y-auto scroll-thin">
          <div className="space-y-2">
            {msgs.slice(0, 12).map((m) => (
              <div key={m.id} className="flex items-start gap-2 text-sm">
                <Badge variant="outline" className="shrink-0 text-[10px] border-zinc-700 text-zinc-400">{m.fromKind === "operator" ? "אתה" : m.fromKind === "agent" ? m.fromName : m.fromKind}</Badge>
                <p className="min-w-0 break-words text-zinc-300">{m.body}</p>
                <span className="shrink-0 text-[10px] text-zinc-600">{new Date(m.createdAt).toLocaleString("he-IL")}</span>
              </div>
            ))}
            {!loading && msgs.length === 0 && <p className="text-sm text-zinc-500">אין הודעות</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChainPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={"inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs " + (ok ? "border-emerald-500/40 text-emerald-400" : "border-rose-500/40 text-rose-400")}>
      {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
      <span className="font-mono">{label}</span>
    </span>
  );
}

/* ─────────────────────────── keys ─────────────────────────── */

function KeysSection() {
  const [inv, setInv] = useState<Inventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [revealing, setRevealing] = useState<string | null>(null);

  // add-key form
  const [keyInput, setKeyInput] = useState("");
  const [saveIt, setSaveIt] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [report, setReport] = useState<KeyReport | null>(null);

  const load = useCallback(async () => {
    const i = await apiJson<Inventory>("/api/gate/inventory");
    setInv(i);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(() => { setLoading(true); return load(); }, [load]);

  async function reveal(id: string) {
    if (revealed[id]) { setRevealed((s) => { const n = { ...s }; delete n[id]; return n; }); return; }
    setRevealing(id);
    try {
      const r = await apiJson<{ ok: boolean; priv?: string; error?: string }>("/api/gate/reveal", {
        method: "POST", body: JSON.stringify({ id }),
      });
      if (r?.ok && r.priv) setRevealed((s) => ({ ...s, [id]: r.priv as string }));
      else toast.error(r?.error || "הצפייה נכשלה");
    } finally { setRevealing(null); }
  }

  async function identifySave() {
    if (!keyInput.trim()) return;
    setKeyBusy(true);
    try {
      const r = await apiJson<{ ok: boolean; report?: KeyReport; saved?: { id: string }[]; error?: string }>("/api/gate/key", {
        method: "POST", body: JSON.stringify({ key: keyInput.trim(), save: saveIt }),
      });
      if (r?.ok) {
        setReport(r.report || null);
        setKeyInput("");
        toast.success(saveIt && r.saved?.length ? `נשמר מוצפן (${r.saved.length})` : "זוהה בהצלחה");
        if (saveIt) { setLoading(true); load(); }
      } else toast.error(r?.error || "הזיהוי נכשל");
    } finally { setKeyBusy(false); }
  }

  const entries = inv?.entries || [];
  const verified = entries.filter((e) => e.liveOk === true).length;
  const failed = entries.filter((e) => e.liveOk === false).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">המפתחות שלך</h2>
        <Button variant="outline" size="sm" onClick={refresh} className="gap-1.5 border-zinc-700">
          <RefreshCw className={"h-3.5 w-3.5" + (loading ? " animate-spin" : "")} /> רענון + אימות-חי
        </Button>
      </div>

      {/* identify / save any key */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <h3 className="font-semibold mb-3 text-sm flex items-center gap-2"><Plus className="h-4 w-4 text-emerald-400" /> זיהוי מפתח / הוספה לכספת</h3>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={keyInput} onChange={(e) => setKeyInput(e.target.value)}
            placeholder="הדבק כל מפתח — WIF / hex / מנשק / PAT"
            className="font-mono text-sm bg-zinc-950 border-zinc-800" autoComplete="off" spellCheck={false} dir="ltr"
          />
          <Button onClick={identifySave} disabled={keyBusy || !keyInput.trim()} className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0 gap-1.5">
            {keyBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saveIt ? "זהה ושמור" : "זהה"}
          </Button>
        </div>
        <label className="mt-2 flex items-center gap-2 text-xs text-zinc-400 cursor-pointer w-fit">
          <Switch checked={saveIt} onCheckedChange={setSaveIt} aria-label="שמירה מוצפנת בכספת" />
          שמור מוצפן בכספת (אחרת רק דוח-זיהוי חי)
        </label>
        {report && (
          <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs space-y-1.5">
            <p><span className="text-zinc-500">סוג:</span> <span className="font-mono text-emerald-400">{report.kind}</span> · <span className="text-zinc-500">אימות-חי:</span> {report.liveChecked ? "כן" : "לא"}</p>
            {report.controls.length > 0 && (
              <p className="break-all"><span className="text-zinc-500">שליטה נוכחית:</span> {report.controls.map((c, i) => (
                <span key={i} className="font-mono text-zinc-300">{c.chain}{c.account ? "·" + c.account : ""}@{c.role} </span>
              ))}</p>
            )}
          </div>
        )}
      </div>

      {/* counts */}
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge variant="outline" className="border-zinc-700">סה״כ {entries.length}</Badge>
        <Badge variant="outline" className="text-emerald-400 border-emerald-500/40"><CheckCircle2 className="h-3 w-3 ml-1" /> מאומתים-חי {verified}</Badge>
        {failed > 0 && <Badge variant="outline" className="text-rose-400 border-rose-500/40"><XCircle className="h-3 w-3 ml-1" /> נכשלו {failed}</Badge>}
      </div>

      {/* vault list */}
      {loading && entries.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-10 text-zinc-500 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> טוען ומאמת מול השרשרות…
        </div>
      ) : (
        <ScrollArea className="h-[calc(100vh-430px)] min-h-64 rounded-xl border border-zinc-800">
          <div className="divide-y divide-zinc-800/70">
            {entries.map((e) => {
              const priv = revealed[e.id];
              return (
                <div key={e.id} className="px-4 py-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary" className="font-mono text-xs bg-zinc-800 text-zinc-300">{e.chain || e.kind}</Badge>
                    <span className="font-mono text-sm font-semibold">{e.account || "—"}</span>
                    {e.role && <Badge variant="outline" className="text-xs border-zinc-700 text-zinc-400">{e.role}</Badge>}
                    <LiveDot ok={e.liveOk} />
                    <span className="text-xs text-zinc-600 truncate max-w-52 hidden md:inline" title={e.detail}>{e.detail}</span>
                    <div className="mr-auto flex items-center gap-1.5">
                      {e.pub && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="העתק מפתח-ציבורי" onClick={() => copyText(e.pub!, "מפתח-ציבורי")}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button variant="outline" size="sm" className="gap-1.5 h-8 border-zinc-700" onClick={() => reveal(e.id)} disabled={revealing === e.id}>
                        {revealing === e.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : priv ? <><EyeOff className="h-3.5 w-3.5" /> הסתר</>
                          : <><Eye className="h-3.5 w-3.5" /> הצג מפתח</>}
                      </Button>
                    </div>
                  </div>
                  {e.pub && !priv && <p className="mt-1.5 font-mono text-xs text-zinc-500 truncate" dir="ltr">{e.pub}</p>}
                  {priv && (
                    <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 flex items-start gap-2" dir="ltr">
                      <code className="flex-1 font-mono text-xs break-all whitespace-pre-wrap text-amber-200">{priv}</code>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => copyText(priv, "מפתח פרטי")}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
            {entries.length === 0 && !loading && <p className="text-center text-zinc-500 text-sm py-10">אין רשומות בכספת</p>}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

/* ─────────────────────────── agents ─────────────────────────── */

function AgentsSection() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [tokenOnce, setTokenOnce] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await apiJson<{ ok: boolean; agents: AgentRow[] }>("/api/gate/agents");
    if (r?.ok) setAgents(r.agents || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

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
        toast.success("הסוכן צורף — שמור את הטוקן עכשיו");
        load();
      } else toast.error(r?.error || "יצירת סוכן נכשלה");
    } finally { setBusy(false); }
  }

  async function revoke(n: string) {
    const r = await apiJson<{ ok: boolean }>(`/api/gate/agents?name=${encodeURIComponent(n)}`, { method: "DELETE" });
    if (r?.ok) { setAgents((a) => a.map((x) => (x.name === n ? { ...x, active: false } : x))); toast("הסוכן בוטל"); }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold">סוכנים — חיבור דרך API</h2>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <h3 className="font-semibold mb-3 text-sm flex items-center gap-2"><UserCheck className="h-4 w-4 text-emerald-400" /> צירוף סוכן חדש</h3>
          <div className="space-y-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="שם-סוכן (a-z 0-9 _ -)" className="font-mono text-sm bg-zinc-950 border-zinc-800" dir="ltr" />
            <Input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="תיאור חופשי (לא חובה)" className="text-sm bg-zinc-950 border-zinc-800" />
            <Button onClick={create} disabled={busy || !name.trim()} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} צור סוכן
            </Button>
          </div>
          {tokenOnce && (
            <div className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
              <p className="text-xs text-emerald-400 mb-1.5">טוקן הסוכן — מוצג פעם אחת בלבד, שמור עכשיו:</p>
              <div className="flex items-start gap-2" dir="ltr">
                <code className="flex-1 font-mono text-xs break-all text-emerald-200">{tokenOnce}</code>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => copyText(tokenOnce, "טוקן סוכן")}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
          <div className="mt-4 rounded-lg bg-zinc-950 border border-zinc-800 p-3 text-xs leading-relaxed">
            <p className="font-semibold mb-1.5">הסוכן מדבר עם השער כך (אמיתי):</p>
            <pre className="font-mono text-[11px] whitespace-pre-wrap text-zinc-400" dir="ltr">{`Authorization: Bearer <TOKEN>

POST /api/gate/messages  {"body":"…"}          → לכתוב לצ'אט
POST /api/gate/actions  {"action":"report.status"}   → מצב
POST /api/gate/actions  {"action":"vault.list-pubs"} → זהויות-ציבוריות
POST /api/gate/actions  {"action":"verify.run"}      → אימות-חי
GET  /api/gate/messages                       → לקרוא את הצ'אט`}</pre>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <h3 className="font-semibold mb-3 text-sm">סוכנים ({agents.filter((a) => a.active).length} פעילים)</h3>
          <div className="max-h-96 overflow-y-auto scroll-thin space-y-2">
            {loading && <div className="flex items-center gap-2 text-sm text-zinc-500 py-4 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> טוען…</div>}
            {!loading && agents.map((a) => (
              <div key={a.id} className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 bg-zinc-950">
                <Bot className={"h-4 w-4 shrink-0 " + (a.active ? "text-emerald-400" : "text-zinc-600")} />
                <span className="font-mono text-sm font-medium">{a.name}</span>
                {a.active
                  ? <Badge variant="outline" className="text-emerald-400 border-emerald-500/40 text-xs">פעיל</Badge>
                  : <Badge variant="outline" className="text-zinc-500 border-zinc-700 text-xs">בוטל</Badge>}
                <span className="text-xs text-zinc-600 mr-auto hidden sm:inline">נראה: {new Date(a.lastSeenAt).toLocaleString("he-IL")}</span>
                {a.active && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-400 shrink-0" title="ביטול סוכן" onClick={() => revoke(a.name)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
            {!loading && agents.length === 0 && <p className="text-sm text-zinc-500 py-6 text-center">אין סוכנים עדיין</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── chat ─────────────────────────── */

function ChatSection() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const r = await apiJson<{ ok: boolean; messages: Msg[] }>("/api/gate/messages");
    if (r?.ok) setMsgs(r.messages || []);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!load) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  async function send() {
    const body = input.trim();
    if (!body) return;
    setSending(true); setInput("");
    try {
      const r = await apiJson<{ ok: boolean; error?: string }>("/api/gate/messages", { method: "POST", body: JSON.stringify({ body }) });
      if (r?.ok) await load();
      else toast.error(r?.error || "השליחה נכשלה");
    } finally { setSending(false); }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-190px)] min-h-80 max-w-3xl mx-auto w-full">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-bold">צ'אט-פיקוד</h2>
        <span className="text-xs text-zinc-500">הסוכנים רואים הכל · הכל נשמר בביקורת</span>
      </div>
      <div className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900/50 flex flex-col min-h-0">
        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin px-4 py-3">
          <div className="space-y-2.5">
            {msgs.map((m) => (
              <div key={m.id} className="flex gap-2 items-start">
                <Badge
                  variant="outline"
                  className={"shrink-0 text-xs mt-0.5 " + (m.fromKind === "operator" ? "text-emerald-400 border-emerald-500/40" : m.fromKind === "agent" ? "text-amber-400 border-amber-500/40" : "text-zinc-500 border-zinc-700")}
                >
                  {m.fromKind === "operator" ? "אתה" : m.fromKind === "agent" ? m.fromName : "מערכת"}
                </Badge>
                <div className="min-w-0">
                  <p className="text-sm break-words whitespace-pre-wrap text-zinc-200">{m.body}</p>
                  <p className="text-[10px] text-zinc-600">{new Date(m.createdAt).toLocaleString("he-IL")}</p>
                </div>
              </div>
            ))}
            {msgs.length === 0 && <p className="text-sm text-zinc-500 text-center py-8">אין הודעות — כתוב פקודה ראשונה</p>}
            <div ref={endRef} />
          </div>
        </div>
        <div className="border-t border-zinc-800 p-3 flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && input.trim() && !sending) send(); }}
            placeholder="כתוב לצ'אט-הפיקוד…"
            className="bg-zinc-950 border-zinc-800"
            aria-label="הודעה לצ'אט-הפיקוד"
          />
          <Button onClick={send} disabled={sending || !input.trim()} className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0" aria-label="שלח">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── audit ─────────────────────────── */

function AuditSection() {
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
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold">יומן-ביקורת — פעולות סוכנים</h2>
        <Button variant="outline" size="sm" onClick={refresh} className="gap-1.5 border-zinc-700">
          <RefreshCw className={"h-3.5 w-3.5" + (loading ? " animate-spin" : "")} /> רענון
        </Button>
      </div>
      {loading && actions.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-10 text-zinc-500 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> טוען…</div>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 max-h-[calc(100vh-240px)] overflow-y-auto scroll-thin">
          <div className="divide-y divide-zinc-800/70">
            {actions.map((a) => (
              <div key={a.id} className="px-4 py-2.5 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className={"text-xs " + (a.ok ? "text-emerald-400 border-emerald-500/40" : "text-rose-400 border-rose-500/40")}>{a.ok ? "הצלחה" : "נכשל"}</Badge>
                  <span className="font-mono font-semibold">{a.agentName}</span>
                  <span className="font-mono text-zinc-300">{a.action}</span>
                  <span className="text-[10px] text-zinc-600 mr-auto">{new Date(a.createdAt).toLocaleString("he-IL")}</span>
                </div>
                <details className="mt-1">
                  <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-300">פרטים</summary>
                  <pre className="mt-1 font-mono text-[11px] text-zinc-400 break-all whitespace-pre-wrap bg-zinc-950 border border-zinc-800 rounded-lg p-2" dir="ltr">
{`params: ${a.params}
result: ${a.result}`}
                  </pre>
                </details>
              </div>
            ))}
            {actions.length === 0 && <p className="text-center text-zinc-500 text-sm py-10">אין פעולות סוכנים עדיין</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── API console ─────────────────────────── */

function ApiConsole() {
  const [sel, setSel] = useState<Ep>(ENDPOINTS[0]);
  const [body, setBody] = useState("");
  const [out, setOut] = useState<string | null>(null);
  const [meta, setMeta] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function pick(e: Ep) {
    setSel(e);
    setBody(e.body || "");
    setOut(null); setMeta(null);
  }

  async function run() {
    setBusy(true); setOut(null); setMeta(null);
    try {
      const res = await api(sel.path, sel.method === "POST" ? { method: "POST", body: body || "{}" } : {});
      const text = await res.text();
      setMeta(`${res.status} ${res.statusText}`);
      try { setOut(JSON.stringify(JSON.parse(text), null, 2)); } catch { setOut(text); }
    } catch (e) {
      setMeta("שגיאת רשת");
      setOut(String((e as Error).message));
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-bold">מסוף API חי</h2>
        <Badge variant="outline" className="text-xs border-zinc-700 text-zinc-400">{ENDPOINTS.length} endpoints אמיתיים</Badge>
      </div>
      <p className="text-sm text-zinc-500">כל הנקודות שקיימות בפועל בקוד. לחיצה מריצה באמת — טוקן המפעיל מצורף אוטומטית ל-endpoints מוגנים.</p>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-2 rounded-xl border border-zinc-800 bg-zinc-900/50 p-2 max-h-[70vh] overflow-y-auto scroll-thin">
          <div className="space-y-1">
            {ENDPOINTS.map((e) => (
              <button
                key={e.method + e.path}
                onClick={() => pick(e)}
                className={"w-full text-right rounded-lg px-3 py-2 transition-colors " + (sel === e ? "bg-zinc-800" : "hover:bg-zinc-900")}
              >
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={"font-mono text-[10px] " + (e.method === "GET" ? "text-emerald-400 border-emerald-500/40" : "text-amber-400 border-amber-500/40")}>{e.method}</Badge>
                  <span className="font-mono text-xs truncate" dir="ltr">{e.path}</span>
                  {e.auth !== "public" && <Lock className="h-3 w-3 text-zinc-600 shrink-0" aria-label="מוגן" />}
                </div>
                <p className="text-xs text-zinc-500 mt-0.5 truncate">{e.desc}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="font-mono text-amber-400 border-amber-500/40">{sel.method}</Badge>
            <code className="font-mono text-sm" dir="ltr">{sel.path}</code>
          </div>
          {sel.method === "POST" && (
            <div>
              <label htmlFor="ep-body" className="text-xs text-zinc-500 mb-1 block">גוף הבקשה (JSON)</label>
              <Textarea id="ep-body" value={body} onChange={(e) => setBody(e.target.value)} dir="ltr" className="font-mono text-xs bg-zinc-950 border-zinc-800 min-h-24" />
            </div>
          )}
          <Button onClick={run} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Braces className="h-4 w-4" />} הרץ
          </Button>
          {meta && <p className="text-xs text-zinc-500">תשובה: <span className="font-mono text-zinc-300">{meta}</span></p>}
          {out && (
            <pre className="rounded-lg bg-zinc-950 border border-zinc-800 p-3 font-mono text-[11px] text-zinc-300 overflow-auto max-h-[50vh] scroll-thin" dir="ltr">{out}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
