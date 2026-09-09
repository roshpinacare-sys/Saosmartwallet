'use client';

// ─── מרכז-השליטה הריבוני ─────────────────────────────────────────────────────
// התחברות חכמה עם כל מפתח · כספת מוצפנת · אימות-חי מול השרשרת · owner-lock
// · צירוף סוכנים דרך API · צ'אט ומשימות בזמן-אמת · יומן-ביקורת
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ShieldCheck, ShieldAlert, KeyRound, Users, MessageSquare, ListChecks, RefreshCw, Lock, ChevronDown, Radio, Fingerprint, Trash2, LogIn, LogOut, Copy, Bot, Eye, EyeOff } from 'lucide-react';

type RoleKey = { role: string; verified: boolean; lastVerifiedAt: string | null; pubKey: string | null; fingerprint: string; source: string; lastError: string | null };
type StatusData = {
  me: string;
  totals: { keys: number; verified: number; accounts: number };
  byAccount: Record<string, Record<string, RoleKey>>;
  balances: Record<string, Record<string, string>>;
  guard: { ownerLock: boolean; note: string; updatedAt: string | null };
  agents: Array<{ name: string; capabilities: string; status: string; lastSeenAt: string | null }>;
  sessions: number; tasksOpen: number;
};
type ChatMsg = { id: string; author: string; role: string; content: string; createdAt: string };
type TaskT = { id: string; title: string; detail: string; createdBy: string; assignedTo: string; status: string; result: string; createdAt: string };
type AuditRow = { id: string; action: string; detail: string; createdAt: string };

const ROLES = ['owner', 'active', 'posting', 'memo'] as const;

// ── session persistence (dual-carrier) ─────────────────────────────────────
// The token lives BOTH in an httpOnly cookie (server-set) AND in localStorage
// (sent as Bearer on every request). Cross-origin iframe previews block
// third-party cookies — the Bearer carrier is what keeps you logged in there.
// זה התיקון ל"הכל נעלם": ההתחברות כבר לא תלויה ב-cookies.
const TOKEN_KEY = 'sv_session_token';
function getToken(): string { try { return window.localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } }
function storeToken(t: string) { try { if (t) window.localStorage.setItem(TOKEN_KEY, t); else window.localStorage.removeItem(TOKEN_KEY); } catch { /* */ } }
function authHeaders(): Record<string, string> { const t = getToken(); return t ? { Authorization: `Bearer ${t}` } : {}; }

function BalLine({ b }: { b?: Record<string, string> }) {
  if (!b || !b.liquid) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-mono text-zinc-500 border-t border-zinc-800/60 pt-1.5" dir="ltr">
      <span className="text-emerald-400/70">{b.liquid}</span>
      {b.debt && b.debt !== '0.000 SBD' && b.debt !== '0.000 HBD' && <span className="text-amber-400/70">{b.debt}</span>}
      {b.vests && <span>{Number(b.vests.replace(' VESTS', '')).toLocaleString('en-US', { maximumFractionDigits: 0 })} VESTS</span>}
      {b.savings && b.savings !== '0.000 STEEM' && b.savings !== '0.000 HIVE' && <span>savings: {b.savings}</span>}
    </div>
  );
}

function RoleChip({ k, chain }: { k: RoleKey; chain: string }) {
  const isChain = chain === 'steem' || chain === 'hive';
  const cls = !isChain
    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
    : k.verified
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
      : 'bg-red-500/15 text-red-300 border-red-500/30';
  return (
    <Badge variant="outline" className={`${cls} font-mono text-[10px] px-1.5`} title={`${k.fingerprint} · ${k.lastError || (isChain ? (k.verified ? 'חי מול השרשרת' : 'לא חי') : 'חומר מוצפן')}`}>
      {chain}:{k.role}{isChain ? (k.verified ? ' ✓' : ' ✗') : ''}
    </Badge>
  );
}

export default function SovereignCenter() {
  const [booted, setBooted] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [status, setStatus] = useState<StatusData | null>(null);
  const [relay, setRelay] = useState(false);

  // login form
  const [account, setAccount] = useState('headcorner');
  const [chain, setChain] = useState('steem');
  const [wif, setWif] = useState('');
  const [showWif, setShowWif] = useState(false);
  const [loginMsg, setLoginMsg] = useState<{ ok: boolean; text: string; roles?: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  // panels
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [tasks, setTasks] = useState<TaskT[]>([]);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskAgent, setTaskAgent] = useState('');
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [agentName, setAgentName] = useState('');
  const [agentCaps, setAgentCaps] = useState('chat,task');
  const [newToken, setNewToken] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/vault/status', { cache: 'no-store', headers: authHeaders() });
      if (r.status === 401) {
        setAuthed(false); setBooted(true);
        if (getToken()) setLoginMsg({ ok: false, text: 'תוקף החיבור פג או בוטל — התחבר שוב עם כל מפתח. הכספת נשמרת מוצפנת ושלמה.' });
        return;
      }
      const j = await r.json();
      if (j.ok) { setStatus(j); setAuthed(true); }
    } catch { /* offline */ }
    setBooted(true);
  }, []);

  const refreshChat = useCallback(async () => {
    try {
      const r = await fetch('/api/chat', { cache: 'no-store', headers: authHeaders() });
      if (r.ok) { const j = await r.json(); if (j.ok) setMessages(j.messages); }
    } catch { /* */ }
  }, []);

  const refreshTasks = useCallback(async () => {
    try {
      const r = await fetch('/api/task', { cache: 'no-store', headers: authHeaders() });
      if (r.ok) { const j = await r.json(); if (j.ok) setTasks(j.tasks); }
    } catch { /* */ }
  }, []);

  const refreshAudit = useCallback(async () => {
    try {
      const r = await fetch('/api/audit', { cache: 'no-store', headers: authHeaders() });
      if (r.ok) { const j = await r.json(); if (j.ok) setAuditRows(j.logs); }
    } catch { /* */ }
  }, []);

  // boot + socket + intervals
  useEffect(() => {
    const boot = setTimeout(() => refresh(), 0);
    const sock = io('/?XTransformPort=3003', { transports: ['websocket', 'polling'], reconnection: true, reconnectionAttempts: 8, timeout: 8000 });
    sock.on('connect', () => setRelay(true));
    sock.on('disconnect', () => setRelay(false));
    sock.on('chat', (m: ChatMsg) => setMessages(prev => (prev.some(x => x.id === m.id) ? prev : [...prev, m])));
    sock.on('vault', () => refresh());
    sock.on('task', () => refreshTasks());
    sock.on('agent', () => refresh());
    sock.on('guard', () => refresh());
    return () => { clearTimeout(boot); sock.close(); };
  }, [refresh, refreshTasks]);

  useEffect(() => {
    if (!authed) return;
    const boot = setTimeout(() => { refreshChat(); refreshTasks(); refreshAudit(); }, 0);
    // fallback polling — keeps chat/tasks fresh even when the relay socket is unreachable
    const t = setInterval(() => { refresh(); refreshChat(); refreshTasks(); }, 8000);
    const v = setInterval(() => { fetch('/api/vault/verify', { method: 'POST', headers: authHeaders() }).then(() => refresh()).catch(() => { }); }, 300000);
    return () => { clearTimeout(boot); clearInterval(t); clearInterval(v); };
  }, [authed, refresh, refreshChat, refreshTasks, refreshAudit]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  // ── actions ──
  async function doLogin() {
    setBusy(true); setLoginMsg(null);
    try {
      const r = await fetch('/api/vault/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account, chain, wif }),
      });
      const j = await r.json();
      if (j.ok) {
        storeToken(j.token || ''); // Bearer carrier — ההתחברות שורדת רענון-עמוד וסגירת-טאב
        setLoginMsg({ ok: true, text: j.message, roles: j.roles });
        setWif('');
        await refresh(); await refreshChat();
      } else {
        setLoginMsg({ ok: false, text: j.error || 'התחברות נכשלה' });
      }
    } catch (e) {
      setLoginMsg({ ok: false, text: 'שגיאת רשת' });
    }
    setBusy(false);
  }

  async function verifyAll() {
    setVerifying(true);
    try { await fetch('/api/vault/verify', { method: 'POST', headers: authHeaders() }); await refresh(); } catch { /* */ }
    setVerifying(false);
  }

  function doLogout() {
    storeToken('');
    setAuthed(false); setStatus(null);
    setLoginMsg(null); setWif('');
  }

  async function toggleLock(enable: boolean) {
    let confirm = '';
    if (!enable) { confirm = 'אני הבעלים ואני מאשר ביטול נעילת-owner'; }
    const r = await fetch('/api/guard', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ enable, confirm }) });
    const j = await r.json();
    if (!j.ok) alert(j.error || 'נכשל');
    await refresh();
  }

  async function sendChat() {
    const content = chatInput.trim();
    if (!content) return;
    setChatInput('');
    await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ content }) });
    refreshChat();
  }

  async function createTask() {
    const title = taskTitle.trim();
    if (!title) return;
    setTaskTitle('');
    await fetch('/api/task', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ title, assignedTo: taskAgent }) });
    refreshTasks();
  }

  async function registerAgent() {
    const name = agentName.trim();
    if (!name) return;
    const r = await fetch('/api/agent/register', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ name, capabilities: agentCaps }) });
    const j = await r.json();
    if (j.ok) { setNewToken(j.token); setAgentName(''); await refresh(); }
    else alert(j.error || 'נכשל');
  }

  const accounts = status ? Object.entries(status.byAccount) : [];
  const chainAccounts = accounts.filter(([a]) => !a.includes(':') && !a.includes('archive') && !['saos-rot1', 'sovereign', 'tron', 'tron-legacy'].includes(a));
  const materialAccounts = accounts.filter(([a]) => a.includes(':') || ['saos-rot1', 'sovereign', 'tron', 'tron-legacy'].includes(a));
  const archiveAccounts = accounts.filter(([a]) => a.includes('archive'));

  // ── boot guard ──
  if (!booted) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-screen">
        <div className="animate-pulse text-zinc-500 font-mono text-sm">...מאתחל את מרכז-השליטה</div>
      </div>
    );
  }

  // ── login screen ──
  if (!authed) {
    return (
      <div className="flex-1 flex flex-col min-h-screen bg-zinc-950">
        <main className="flex-1 flex items-center justify-center p-4">
          <Card className="w-full max-w-md border-zinc-800 bg-zinc-900/60 shadow-2xl">
            <CardHeader className="text-center">
              <div className="mx-auto w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mb-2">
                <ShieldCheck className="w-7 h-7 text-emerald-400" />
              </div>
              <CardTitle className="text-xl">מרכז-השליטה הריבוני</CardTitle>
              <CardDescription>התחבר עם כל מפתח — owner / active / posting / memo · STEEM או HIVE. המפתח מאומת חי מול השרשרת לפני כניסה.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-zinc-400">חשבון</label>
                  <Input value={account} onChange={e => setAccount(e.target.value)} placeholder="headcorner" className="bg-zinc-950 border-zinc-800 font-mono" dir="ltr" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-zinc-400">שרשרת</label>
                  <Select value={chain} onValueChange={setChain}>
                    <SelectTrigger className="bg-zinc-950 border-zinc-800"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="steem">STEEM</SelectItem>
                      <SelectItem value="hive">HIVE</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-zinc-400">מפתח-פרטי (WIF)</label>
                <div className="relative">
                  <Input type={showWif ? 'text' : 'password'} value={wif} onChange={e => setWif(e.target.value)} placeholder="5K... / L... / K..." className="bg-zinc-950 border-zinc-800 font-mono pl-10" dir="ltr" />
                  <button type="button" onClick={() => setShowWif(!showWif)} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300" aria-label="הצג/הסתר">
                    {showWif ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {loginMsg && (
                <div className={`text-xs rounded-lg px-3 py-2 border ${loginMsg.ok ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30'}`}>
                  {loginMsg.text}
                </div>
              )}
              <Button onClick={doLogin} disabled={busy || !account || !wif} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold" size="lg">
                <LogIn className="w-4 h-4 ml-2" />{busy ? '...מאמת מול השרשרת' : 'התחבר ואמת'}
              </Button>
              <p className="text-[11px] text-zinc-500 text-center leading-relaxed">
                המפתח נשמר מוצפן (AES-256-GCM) בכספת המקומית בלבד. לעולם לא נשלח החוצה. אימות = גזירת מפתח-ציבורי והשוואה מול ה-authorities על השרשרת.
              </p>
            </CardContent>
          </Card>
        </main>
        <footer className="mt-auto border-t border-zinc-800/60 bg-zinc-950 px-4 py-3 text-center text-[11px] text-zinc-600">
          מרכז-השליטה הריבוני · כספת מוצפנת · owner-lock פעיל · יומן-ביקורת מלא
        </footer>
      </div>
    );
  }

  // ── dashboard ──
  return (
    <div className="flex-1 flex flex-col min-h-screen bg-zinc-950">
      {/* header */}
      <header className="sticky top-0 z-40 border-b border-zinc-800/60 bg-zinc-950/90 backdrop-blur supports-[backdrop-filter]:bg-zinc-950/75">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <div className="font-bold text-sm leading-tight">מרכז-השליטה הריבוני</div>
              <div className="text-[10px] text-zinc-500 font-mono" dir="ltr">sovereign control center</div>
            </div>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
            <Badge variant="outline" className="bg-emerald-500/10 border-emerald-500/30 text-emerald-300 font-mono"><Fingerprint className="w-3 h-3 ml-1" />{status?.me || ''}</Badge>
            <Badge variant="outline" className="bg-zinc-900 border-zinc-700 text-zinc-300 font-mono"><KeyRound className="w-3 h-3 ml-1" />{status?.totals.verified}/{status?.totals.keys} מאומתים</Badge>
            <Badge variant="outline" className={status?.guard.ownerLock ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-red-500/10 border-red-500/30 text-red-300'}>
              <Lock className="w-3 h-3 ml-1" />owner-lock {status?.guard.ownerLock ? 'פעיל' : 'כבוי!'}
            </Badge>
            <Badge variant="outline" className="bg-zinc-900 border-zinc-700 text-zinc-300 font-mono"><Users className="w-3 h-3 ml-1" />{status?.agents.filter(a => a.status === 'active').length || 0} סוכנים</Badge>
            <Badge variant="outline" className={relay ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-300'}>
              <Radio className="w-3 h-3 ml-1" />relay {relay ? 'חי' : 'polling'}
            </Badge>
            <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200" onClick={doLogout}>
              <LogOut className="w-3 h-3 ml-1" />התנתק
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-5 space-y-5">
        {/* ── vault matrix ── */}
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="text-base flex items-center gap-2"><Fingerprint className="w-4 h-4 text-emerald-400" />כספת המפתחות — מטריצת שליטה חיה</CardTitle>
                <CardDescription>{status?.totals.accounts} ישויות · {status?.totals.verified} מאומתות-חי מול השרשרת · אימות-אוטומטי כל 5 דקות</CardDescription>
              </div>
              <Button onClick={verifyAll} disabled={verifying} size="sm" variant="outline" className="border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10">
                <RefreshCw className={`w-3.5 h-3.5 ml-1 ${verifying ? 'animate-spin' : ''}`} />אמת הכל עכשיו
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {chainAccounts.map(([acct, chains]) => (
                <div key={acct} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono font-bold text-sm text-zinc-100" dir="ltr">{acct}</span>
                    <Badge variant="outline" className="bg-emerald-500/10 border-emerald-500/30 text-emerald-300 text-[10px]">בשליטה מלאה</Badge>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(['steem', 'hive'] as const).map(c => ROLES.map(r => {
                      const k = chains[`${c}:${r}`];
                      return k ? <RoleChip key={`${c}:${r}`} k={k} chain={c} /> : null;
                    }))}
                  </div>
                  <BalLine b={status?.balances?.[`${acct}@steem`]} />
                  <BalLine b={status?.balances?.[`${acct}@hive`]} />
                </div>
              ))}
            </div>
            <Collapsible className="mt-3">
              <CollapsibleTrigger className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">
                <ChevronDown className="w-3.5 h-3.5" />חומר נוסף בכספת ({materialAccounts.length + archiveAccounts.length})
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {materialAccounts.map(([acct, chains]) => (
                    <div key={acct} className="rounded-lg border border-zinc-800/70 bg-zinc-950/40 p-2.5">
                      <div className="font-mono text-xs text-zinc-300 mb-1.5" dir="ltr">{acct}</div>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(chains).map(([key, k]) => {
                          const [c] = key.split(':');
                          return <RoleChip key={key} k={k} chain={c} />;
                        })}
                      </div>
                    </div>
                  ))}
                  {archiveAccounts.map(([acct, chains]) => (
                    <div key={acct} className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
                      <div className="font-mono text-xs text-amber-300/80 mb-1.5" dir="ltr">{acct}</div>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(chains).map(([key, k]) => {
                          const [c] = key.split(':');
                          return <RoleChip key={key} k={k} chain={c} />;
                        })}
                      </div>
                      <div className="text-[10px] text-amber-400/60 mt-1">מפתחות-היסטוריה (recent-owner-authority)</div>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>

        {/* ── guard ── */}
        <Card className={`border ${status?.guard.ownerLock ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/40 bg-red-500/5'}`}>
          <CardContent className="py-4 flex items-center gap-3 flex-wrap">
            {status?.guard.ownerLock
              ? <ShieldCheck className="w-6 h-6 text-emerald-400" />
              : <ShieldAlert className="w-6 h-6 text-red-400" />}
            <div className="flex-1 min-w-56">
              <div className="font-bold text-sm">owner-lock — {status?.guard.ownerLock ? 'פעיל: אסור לשנות מפתחות-owner ללא הנחייתך המפורשת' : 'כבוי — פעולות-owner חשופות!'}</div>
              <div className="text-[11px] text-zinc-500">{status?.guard.note}</div>
            </div>
            {status?.guard.ownerLock ? (
              <Button size="sm" variant="outline" className="border-red-500/40 text-red-300 hover:bg-red-500/10" onClick={() => { if (confirm('לבטל את נעילת-owner? פעולה מסוכנת.')) toggleLock(false); }}>
                <Lock className="w-3.5 h-3.5 ml-1" />בטל נעילה
              </Button>
            ) : (
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white" onClick={() => toggleLock(true)}>
                <ShieldCheck className="w-3.5 h-3.5 ml-1" />הפעל נעילה
              </Button>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* ── agents hub ── */}
          <Card className="border-zinc-800 bg-zinc-900/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Bot className="w-4 h-4 text-emerald-400" />צירוף סוכנים דרך API</CardTitle>
              <CardDescription>צור סוכן → קבל טוקן → הסוכן כותב לנו ומבצע משימות דרך HTTP</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input value={agentName} onChange={e => setAgentName(e.target.value)} placeholder="שם הסוכן (למשל: worker-1)" className="bg-zinc-950 border-zinc-800 font-mono" dir="ltr" />
                <Button onClick={registerAgent} disabled={!agentName.trim()} className="bg-emerald-600 hover:bg-emerald-500 text-white whitespace-nowrap">צור סוכן</Button>
              </div>
              <Input value={agentCaps} onChange={e => setAgentCaps(e.target.value)} className="bg-zinc-950 border-zinc-800 font-mono text-xs" dir="ltr" placeholder="chat,task" />
              {status && status.agents.length > 0 && (
                <ScrollArea className="max-h-32">
                  <div className="space-y-1.5">
                    {status.agents.map(a => (
                      <div key={a.name} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                        <span className="font-mono text-xs" dir="ltr">{a.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-zinc-500 font-mono" dir="ltr">{a.capabilities}</span>
                          <Badge variant="outline" className={`text-[10px] ${a.status === 'active' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-red-500/10 border-red-500/30 text-red-300'}`}>{a.status}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
              <Collapsible>
                <CollapsibleTrigger className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300"><ChevronDown className="w-3.5 h-3.5" />מדריך API לסוכן</CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="mt-2 rounded-lg bg-zinc-950 border border-zinc-800 p-3 text-[10px] leading-relaxed font-mono text-zinc-400 overflow-x-auto" dir="ltr">
{`# 1) הבעלים יוצר סוכן ב-UI ומקבל TOKEN
# 2) הסוכן כותב לצ'אט:
curl -X POST <origin>/api/agent/message \\
  -H "Authorization: Bearer TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"content":"היי, אני מחובר!"}'

# 3) הסוכן רואה משימות פתוחות:
curl <origin>/api/agent/task -H "Authorization: Bearer TOKEN"

# 4) הסוכן תובע ומדווח:
curl -X POST <origin>/api/agent/task \\
  -H "Authorization: Bearer TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"action":"claim","taskId":"..."}'
curl -X POST <origin>/api/agent/task \\
  -H "Authorization: Bearer TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"action":"result","taskId":"...","status":"done","result":"..."}'`}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>

          {/* ── tasks ── */}
          <Card className="border-zinc-800 bg-zinc-900/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><ListChecks className="w-4 h-4 text-emerald-400" />משימות לסוכנים</CardTitle>
              <CardDescription>{status?.tasksOpen || 0} פתוחות</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="משימה חדשה..." className="bg-zinc-950 border-zinc-800" onKeyDown={e => e.key === 'Enter' && createTask()} />
                <Select value={taskAgent} onValueChange={setTaskAgent}>
                  <SelectTrigger className="w-40 bg-zinc-950 border-zinc-800"><SelectValue placeholder="סוכן" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">פתוח לכולם</SelectItem>
                    {status?.agents.map(a => <SelectItem key={a.name} value={a.name}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button onClick={createTask} disabled={!taskTitle.trim()} className="bg-emerald-600 hover:bg-emerald-500 text-white whitespace-nowrap">שייך</Button>
              </div>
              <ScrollArea className="max-h-56">
                <div className="space-y-1.5">
                  {tasks.map(t => (
                    <div key={t.id} className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-zinc-200">{t.title}</span>
                        <Badge variant="outline" className={`text-[10px] ${t.status === 'done' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : t.status === 'failed' ? 'bg-red-500/10 border-red-500/30 text-red-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-300'}`}>{t.status}{t.assignedTo ? ` → ${t.assignedTo}` : ''}</Badge>
                      </div>
                      {t.result && <div className="text-[10px] text-zinc-500 mt-1 whitespace-pre-wrap">{t.result}</div>}
                    </div>
                  ))}
                  {tasks.length === 0 && <div className="text-xs text-zinc-600 text-center py-4">אין משימות</div>}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* ── chat ── */}
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><MessageSquare className="w-4 h-4 text-emerald-400" />צ'אט משותף — בעלים ⇄ סוכנים</CardTitle>
            <CardDescription>בזמן-אמת דרך relay · הסוכנים כותבים דרך API</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ScrollArea className="max-h-64 border border-zinc-800/70 rounded-lg bg-zinc-950/60 p-3">
              <div className="space-y-2">
                {messages.map(m => (
                  <div key={m.id} className={`flex flex-col ${m.role === 'owner' ? 'items-start' : 'items-end'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed ${m.role === 'owner' ? 'bg-emerald-600/20 border border-emerald-500/30 text-emerald-100' : m.role === 'system' ? 'bg-zinc-800/60 text-zinc-400 mx-auto text-center text-[10px]' : 'bg-zinc-800/80 border border-zinc-700 text-zinc-200'}`}>
                      {m.role !== 'system' && <div className="text-[9px] font-mono text-zinc-500 mb-0.5" dir="ltr">{m.author}</div>}
                      {m.content}
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            </ScrollArea>
            <div className="flex gap-2">
              <Input value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="כתוב לסוכנים..." className="bg-zinc-950 border-zinc-800" onKeyDown={e => e.key === 'Enter' && sendChat()} />
              <Button onClick={sendChat} disabled={!chatInput.trim()} className="bg-emerald-600 hover:bg-emerald-500 text-white">שלח</Button>
            </div>
          </CardContent>
        </Card>

        {/* ── audit ── */}
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Eye className="w-4 h-4 text-emerald-400" />יומן-ביקורת — שלא יקרה שוב</CardTitle>
            <CardDescription>כל פעולה רגישה נרשמת כאן</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-48">
              <div className="space-y-1 font-mono text-[10px]">
                {auditRows.map(l => (
                  <div key={l.id} className="flex gap-2 text-zinc-500 border-b border-zinc-900 pb-1">
                    <span className="text-zinc-600 shrink-0">{new Date(l.createdAt).toLocaleString('he-IL')}</span>
                    <span className={l.action.includes('reject') || l.action.includes('OFF') ? 'text-red-400' : 'text-emerald-400/80'}>{l.action}</span>
                    <span className="text-zinc-600 truncate" dir="ltr">{l.detail}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </main>

      <footer className="mt-auto border-t border-zinc-800/60 bg-zinc-950 px-4 py-3 text-center text-[11px] text-zinc-600">
        מרכז-השליטה הריבוני · כספת AES-256-GCM · owner-lock פעיל · relay חי · כל המפתחות מאומתים מול השרשרת
      </footer>

      {/* new agent token dialog */}
      <Dialog open={!!newToken} onOpenChange={o => !o && setNewToken(null)}>
        <DialogContent className="bg-zinc-900 border-zinc-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><KeyRound className="w-4 h-4 text-emerald-400" />טוקן הסוכן — מוצג פעם אחת!</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-zinc-400">העבר את הטוקן לסוכן. לא ניתן לצפות בו שוב (נשמר רק hash).</p>
            <div className="flex gap-2">
              <Input readOnly value={newToken || ''} className="bg-zinc-950 border-emerald-500/40 font-mono text-xs" dir="ltr" />
              <Button size="icon" variant="outline" className="border-zinc-700" onClick={() => navigator.clipboard.writeText(newToken || '')}><Copy className="w-4 h-4" /></Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
