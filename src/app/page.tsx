'use client';

// ─── מרכז-השליטה הריבוני — Sovereign Ledger redesign ───────────────────────
// Light paper canvas · deep-emerald hero · white ledger cards.
// All logic preserved 1:1: smart login (any key × 3 chains) · AES-256-GCM
// vault · live on-chain verification · owner-lock · agent API · realtime
// chat/tasks · audit log · the five SAOS towers (anchor foundry).
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Copy, KeyRound } from 'lucide-react';
import { Sigil } from '@/components/sv/sigil';
import { Sidebar, MobileNav, MobileTopbar } from '@/components/sv/sidebar';
import { LoginDialog } from '@/components/sv/login-dialog';
import { OverviewView } from '@/components/sv/overview';
import { VaultView } from '@/components/sv/vault-view';
import { TowersView } from '@/components/sv/towers-view';
import { OpsView } from '@/components/sv/ops-view';
import { AuditView } from '@/components/sv/audit-view';
import { SettingsView } from '@/components/sv/settings-view';
import { getToken, storeToken, authHeaders, fmtAgo } from '@/components/sv/shared';
import type { StatusData, ChatMsg, TaskT, AuditRow, SaosStatus } from '@/components/sv/shared';
import type { ViewId } from '@/components/sv/sidebar';

export default function SovereignCenter() {
  const [booted, setBooted] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [status, setStatus] = useState<StatusData | null>(null);
  const [saos, setSaos] = useState<SaosStatus | null>(null);
  const [relay, setRelay] = useState(false);
  const [view, setView] = useState<ViewId>('overview');
  const [lastSync, setLastSync] = useState<number | null>(null);

  const [loginMsg, setLoginMsg] = useState<{ ok: boolean; text: string; roles?: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [tasks, setTasks] = useState<TaskT[]>([]);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [newToken, setNewToken] = useState<string | null>(null);

  const refreshSaos = useCallback(async () => {
    try {
      const r = await fetch('/api/saos/status', { cache: 'no-store' });
      const j = await r.json();
      if (j.ok) setSaos(j);
    } catch { /* offline */ }
  }, []);

  // Personal system: everything is readable WITHOUT login; mutations need a
  // session. If a mutation is attempted while logged out → open the login menu.
  const needAuth = useCallback(() => {
    if (getToken()) return false;
    setLoginOpen(true);
    setLoginMsg({ ok: false, text: 'התחבר דרך התפריט כדי לבצע פעולות — הצפייה פתוחה תמיד.' });
    return true;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/vault/status', { cache: 'no-store', headers: authHeaders() });
      if (!r.ok) { setBooted(true); return; }
      const j = await r.json();
      if (j.ok) {
        setStatus(j);
        setLastSync(Date.now());
        const nowAuthed = !!j.me;
        setAuthed(nowAuthed);
        if (!nowAuthed && getToken()) {
          setLoginMsg({ ok: false, text: 'תוקף החיבור פג או בוטל — התחבר שוב עם כל מפתח. הכספת נשמרת מוצפנת ושלמה.' });
          setLoginOpen(true);
        }
      }
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
    const boot = setTimeout(() => { refresh(); refreshChat(); refreshTasks(); refreshAudit(); refreshSaos(); }, 0);
    const sock = io('/?XTransformPort=3003', { transports: ['websocket', 'polling'], reconnection: true, reconnectionAttempts: 8, timeout: 8000 });
    sock.on('connect', () => setRelay(true));
    sock.on('disconnect', () => setRelay(false));
    sock.on('chat', (m: ChatMsg) => setMessages(prev => (prev.some(x => x.id === m.id) ? prev : [...prev, m])));
    sock.on('vault', () => refresh());
    sock.on('task', () => refreshTasks());
    sock.on('agent', () => refresh());
    sock.on('guard', () => refresh());
    return () => { clearTimeout(boot); sock.close(); };
  }, [refresh, refreshTasks, refreshSaos]);

  useEffect(() => {
    if (!authed) return;
    // fallback polling — keeps chat/tasks fresh even when the relay socket is unreachable
    const t = setInterval(() => { refresh(); refreshChat(); refreshTasks(); }, 8000);
    const v = setInterval(() => { fetch('/api/vault/verify', { method: 'POST', headers: authHeaders() }).then(() => refresh()).catch(() => { }); }, 300000);
    return () => { clearInterval(t); clearInterval(v); };
  }, [authed, refresh, refreshChat, refreshTasks]);

  // ── actions ──
  async function doLogin(account: string, chain: string, wif: string) {
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
        setLoginOpen(false);
        await refresh(); await refreshChat(); await refreshTasks(); await refreshAudit();
      } else {
        setLoginMsg({ ok: false, text: j.error || 'התחברות נכשלה' });
      }
    } catch {
      setLoginMsg({ ok: false, text: 'שגיאת רשת — ודא שהפלטפורמה נגישה ונסה שוב' });
    }
    setBusy(false);
  }

  async function verifyAll() {
    if (needAuth()) return;
    setVerifying(true);
    try { await fetch('/api/vault/verify', { method: 'POST', headers: authHeaders() }); await refresh(); } catch { /* */ }
    setVerifying(false);
  }

  function doLogout() {
    storeToken('');
    setAuthed(false); setStatus(s => (s ? { ...s, me: null } : s));
    setLoginMsg(null);
  }

  async function toggleLock(enable: boolean) {
    if (needAuth()) return;
    let confirm = '';
    if (!enable) { confirm = 'אני הבעלים ואני מאשר ביטול נעילת-owner'; }
    const r = await fetch('/api/guard', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ enable, confirm }) });
    const j = await r.json();
    if (!j.ok) alert(j.error || 'נכשל');
    await refresh();
  }

  async function sendChat(content: string) {
    if (needAuth()) return;
    await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ content }) });
    refreshChat();
  }

  async function createTask(title: string, assignedTo: string) {
    if (needAuth()) return;
    await fetch('/api/task', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ title, assignedTo }) });
    refreshTasks();
  }

  async function registerAgent(name: string, caps: string) {
    if (needAuth()) return;
    const r = await fetch('/api/agent/register', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ name, capabilities: caps }) });
    const j = await r.json();
    if (j.ok) { setNewToken(j.token); await refresh(); }
    else alert(j.error || 'נכשל');
  }

  // ── boot guard ──
  if (!booted) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-h-screen gap-4">
        <Sigil size="lg" live />
        <div className="text-zinc-500 text-[13px]">מאתחל את מרכז-השליטה...</div>
        <div className="font-data text-[10px] text-zinc-400" dir="ltr">AES-256-GCM VAULT · LIVE CHAIN VERIFY</div>
      </div>
    );
  }

  // ── dashboard — תמיד גלוי (שימוש אישי); ההתחברות דרך התפריט ──
  return (
    <div className="flex-1 flex flex-col md:flex-row min-h-screen">
      <Sidebar view={view} onNavigate={setView} status={status} relay={relay} authed={authed} onLogin={() => { setLoginMsg(null); setLoginOpen(true); }} onLogout={doLogout} />

      <div className="flex-1 flex flex-col min-w-0">
        <MobileTopbar status={status} relay={relay} authed={authed} onLogin={() => { setLoginMsg(null); setLoginOpen(true); }} onLogout={doLogout} />

        <main key={view} className="flex-1 w-full max-w-[1440px] mx-auto px-4 md:px-7 py-5 md:py-7 space-y-4 pb-28 md:pb-10 animate-rise">
          {view === 'overview' && (
            <OverviewView status={status} saos={saos} relay={relay} lastSync={lastSync} auditRows={auditRows} tasks={tasks} onNavigate={setView} verifying={verifying} onVerifyAll={verifyAll} />
          )}
          {view === 'vault' && (
            <VaultView status={status} verifying={verifying} onVerifyAll={verifyAll} />
          )}
          {view === 'towers' && (
            <TowersView saos={saos} onSaosRefresh={refreshSaos} />
          )}
          {view === 'ops' && (
            <OpsView status={status} authed={authed} messages={messages} onSend={sendChat} tasks={tasks} onCreateTask={createTask} onRegisterAgent={registerAgent} />
          )}
          {view === 'audit' && (
            <AuditView rows={auditRows} />
          )}
          {view === 'settings' && (
            <SettingsView status={status} authed={authed} verifying={verifying} onToggleLock={toggleLock} onVerifyAll={verifyAll} onLogout={doLogout} />
          )}
        </main>

        <footer className="hidden md:block mt-auto border-t border-[#e8e8e3] bg-white px-7 py-3.5">
          <div className="max-w-[1440px] mx-auto flex items-center justify-between flex-wrap gap-2 text-[11px] text-zinc-400">
            <span>מרכז-השליטה הריבוני · כספת AES-256-GCM · אימות-חי מול השרשרת · חמשת מגדלי SAOS · relay בזמן-אמת</span>
            <span className="font-data" dir="ltr">
              {status?.totals.verified}/{status?.totals.keys} VERIFIED{lastSync ? ` · SYNC ${fmtAgo(new Date(lastSync).toISOString())}` : ''}
            </span>
          </div>
        </footer>
      </div>

      <MobileNav view={view} onNavigate={setView} />

      {/* new agent token dialog */}
      <Dialog open={!!newToken} onOpenChange={o => !o && setNewToken(null)}>
        <DialogContent className="bg-white border-[#e8e8e3] max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base text-zinc-900"><KeyRound className="w-4 h-4 text-emerald-600" />טוקן הסוכן — מוצג פעם אחת!</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-zinc-500 leading-relaxed">העבר את הטוקן לסוכן. לא ניתן לצפות בו שוב (נשמר רק hash).</p>
            <div className="flex gap-2">
              <Input readOnly value={newToken || ''} className="bg-zinc-50 border-emerald-200 font-data text-xs" dir="ltr" />
              <button
                onClick={() => navigator.clipboard.writeText(newToken || '')}
                aria-label="העתק טוקן"
                className="w-10 h-10 shrink-0 rounded-lg border border-[#e0e0da] bg-white hover:bg-zinc-50 flex items-center justify-center text-zinc-500 hover:text-zinc-800 transition-colors"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* login dialog — הכניסה בתפריט, בלי חוסם */}
      <LoginDialog open={loginOpen} onOpenChange={o => { setLoginOpen(o); if (!o) setLoginMsg(null); }} msg={loginMsg} busy={busy} onLogin={doLogin} />
    </div>
  );
}
