'use client';

// ─── overview — emerald hero band + KPI grid + chain liveness + activity ──
// The deep-emerald hero is the single saturated moment. Everything else is
// calm paper: white cards, hairlines, emerald for live/verified.

import { Fingerprint, ListChecks, ShieldCheck, ShieldAlert, ChevronLeft, RefreshCw, Network, Landmark, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';
import { CHAIN_KEYS, CHAIN_META, fmtAgo, fmtNum, perChainTotals } from './shared';
import type { StatusData, AuditRow, TaskT, ChainId, SaosStatus } from './shared';
import type { ViewId } from './sidebar';
import { Sigil } from './sigil';

const CHAIN_BALANCE_META: Record<string, { sym: string; tone: string; chipBg: string; chipText: string }> = {
  STEEM: { sym: 'STEEM', tone: 'text-emerald-300', chipBg: 'bg-emerald-400/15 border-emerald-300/25', chipText: 'text-emerald-200' },
  HIVE: { sym: 'HIVE', tone: 'text-amber-200', chipBg: 'bg-amber-400/15 border-amber-300/25', chipText: 'text-amber-200' },
  BLURT: { sym: 'BLURT', tone: 'text-rose-200', chipBg: 'bg-rose-400/15 border-rose-300/25', chipText: 'text-rose-200' },
};

function KpiTile({ label, value, sub, accent, icon: Icon }: { label: string; value: string; sub: string; accent?: 'emerald' | 'amber'; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="sv-card p-4 flex flex-col gap-1.5">
      <span className="label-caps flex items-center gap-1.5">{Icon && <Icon className="w-3 h-3 text-zinc-400" />}{label}</span>
      <span className={`font-data text-[26px] font-semibold leading-none ${accent === 'amber' ? 'text-amber-600' : accent === 'emerald' ? 'text-emerald-600' : 'text-zinc-900'}`} dir="ltr">{value}</span>
      <span className="text-[11px] text-zinc-500 leading-snug">{sub}</span>
    </div>
  );
}

const MATRIX_STATE: Record<string, { label: string; cls: string; dot: string }> = {
  anchored: { label: 'עוגן', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  gated: { label: 'סורג', cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  transit: { label: 'במעבר', cls: 'bg-zinc-100 text-zinc-600 border-zinc-200', dot: 'bg-zinc-400' },
};

export function OverviewView({ status, saos, relay, lastSync, auditRows, tasks, onNavigate, verifying, onVerifyAll }: {
  status: StatusData | null;
  saos: SaosStatus | null;
  relay: boolean;
  lastSync: number | null;
  auditRows: AuditRow[];
  tasks: TaskT[];
  onNavigate: (v: ViewId) => void;
  verifying: boolean;
  onVerifyAll: () => void;
}) {
  const totals = perChainTotals(status?.balances);
  const t = status?.totals;
  const pct = t && t.keys > 0 ? Math.round((t.verified / t.keys) * 100) : 0;
  const activeAgents = status?.agents.filter(a => a.status === 'active').length || 0;
  const tasksOpen = status?.tasksOpen ?? tasks.filter(t => t.status === 'pending' || t.status === 'claimed').length;

  const perChain = CHAIN_KEYS.map(c => {
    let total = 0, verified = 0;
    for (const chains of Object.values(status?.byAccount || {})) {
      for (const [key, k] of Object.entries(chains)) {
        if (key.startsWith(`${c}:`)) { total++; if (k.verified) verified++; }
      }
    }
    const accts = Object.keys(status?.byAccount || {}).filter(a => Object.keys(status?.byAccount?.[a] || {}).some(k => k.startsWith(`${c}:`))).length;
    return { chain: c, total, verified, accts };
  });

  const guardLocked = status?.guard.ownerLock;

  return (
    <div className="space-y-4">
      {/* ── hero band — the single saturated moment ── */}
      <section className="sv-hero p-5 md:p-7">
        <div className="relative z-10 flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <Sigil size="lg" live={relay} verifying={verifying} />
            <div>
              <div className="label-caps-onbrand">נכסים חיים בשרשרת · live on-chain</div>
              <div className="text-[13px] text-emerald-100/80 mt-0.5">
                {lastSync ? `סונכרן ${fmtAgo(new Date(lastSync).toISOString())}` : 'מסנכרן...'}
                {' · '}אימות-אוטומטי כל 5 דק׳
              </div>
            </div>
          </div>
          <button onClick={onVerifyAll} disabled={verifying} className="h-9 px-3.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/15 backdrop-blur text-[12px] text-emerald-50 transition-colors inline-flex items-center gap-2 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${verifying ? 'animate-spin' : ''}`} />אמת הכל עכשיו
          </button>
        </div>
        <div className="relative z-10 mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {CHAIN_KEYS.map(c => {
            const m = CHAIN_BALANCE_META[CHAIN_META[c].label] || { sym: CHAIN_META[c].label, tone: 'text-emerald-100', chipBg: 'bg-white/10 border-white/15', chipText: 'text-emerald-100' };
            return (
              <div key={c} className="rounded-2xl border border-white/10 bg-white/[0.07] backdrop-blur-sm px-4 py-3.5">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${CHAIN_META[c].dot} ${relay ? 'pulse-ring' : ''}`} />
                  <span className={`text-[10.5px] tracking-[0.1em] font-bold font-data ${m.chipText}`}>{m.sym}</span>
                </div>
                <div className="font-data text-[30px] md:text-[34px] font-semibold text-white leading-none">{fmtNum(totals[c]?.liquid || 0)}</div>
                <div className="font-data text-[10px] text-emerald-100/60 mt-1.5" dir="ltr">
                  {totals[c]?.vests ? `${fmtNum(totals[c].vests, 0)} VESTS` : '—'}{totals[c] && totals[c].savings > 0 ? ` · savings ${fmtNum(totals[c].savings)}` : ''}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── owner-lock honesty strip ── */}
      <div className={`sv-card px-4 py-3 flex items-center gap-3 flex-wrap ${guardLocked ? 'border-emerald-200' : 'border-rose-200'}`}>
        {guardLocked ? <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" /> : <ShieldAlert className="w-5 h-5 text-rose-500 shrink-0" />}
        <div className="flex-1 min-w-48 text-[12px]">
          <span className="font-semibold text-zinc-800">{guardLocked ? 'owner-lock פעיל' : 'owner-lock כבוי'}</span>
          <span className="text-zinc-500"> — {guardLocked ? 'אסור לשנות מפתחות-owner ללא הנחייתך המפורשת' : 'פעולות-owner חשופות'}</span>
        </div>
        <button onClick={() => onNavigate('settings')} className="text-[11px] text-zinc-500 hover:text-zinc-800 inline-flex items-center gap-1">ניהול <ChevronLeft className="w-3 h-3" /></button>
      </div>

      {/* ── KPI grid ── */}
      <div className="grid gap-3 grid-cols-2 xl:grid-cols-4">
        <div className="sv-card p-4 flex flex-col gap-1.5">
          <span className="label-caps">כספת — אינטגריות</span>
          <span className="font-data text-[26px] font-semibold leading-none text-emerald-600" dir="ltr">{t?.verified ?? '—'}<span className="text-zinc-400 text-[16px]">/{t?.keys ?? '—'}</span></span>
          <div className="h-1.5 rounded-full bg-zinc-100 overflow-hidden mt-1" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-gradient-to-l from-emerald-500 to-emerald-600 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[11px] text-zinc-500">{pct}% מאומת-חי מול השרשרת</span>
        </div>
        <KpiTile label="ישויות תחת שליטה" value={String(t?.accounts ?? '—')} sub="חשבונות שרשרת + חומר גנזך מוצפן" icon={Fingerprint} />
        <div className="sv-card p-4 flex flex-col gap-1.5">
          <span className="label-caps">סוכנים</span>
          <span className="font-data text-[26px] font-semibold leading-none text-zinc-900" dir="ltr">{activeAgents}<span className="text-zinc-400 text-[16px]">/{status?.agents.length || 0}</span></span>
          <span className="text-[11px] text-zinc-500 inline-flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${activeAgents ? 'bg-emerald-500 pulse-ring' : 'bg-zinc-300'}`} />
            {activeAgents ? 'מחוברים ל-relay' : 'אין סוכנים פעילים'}
          </span>
        </div>
        <KpiTile label="תור מבצעים" value={String(tasksOpen)} sub="משימות פתוחות לסוכנים" accent={tasksOpen > 0 ? 'amber' : undefined} icon={ListChecks} />
      </div>

      {/* ── anchor matrix preview (מגדל-הפיקוח) ── */}
      <section className="sv-card">
        <div className="px-4 py-3 border-b border-[#eeeeea] flex items-center justify-between flex-wrap gap-2">
          <span className="text-[13px] font-semibold flex items-center gap-2"><Landmark className="w-4 h-4 text-emerald-600" />מטריצת-העגינה — ארבע הרשתות</span>
          <button onClick={() => onNavigate('towers')} className="text-[11px] text-zinc-500 hover:text-zinc-800 inline-flex items-center gap-1">אל המגדלים <ChevronLeft className="w-3 h-3" /></button>
        </div>
        <div className="p-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {(saos?.matrix || []).map(row => {
            const st = MATRIX_STATE[row.status] || MATRIX_STATE.transit;
            return (
              <div key={row.network} className="sv-well p-3 flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-data text-[11px] font-bold text-zinc-800" dir="ltr">{row.network}</span>
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{st.label}
                  </span>
                </div>
                <p className="text-[10.5px] text-zinc-500 leading-relaxed line-clamp-2">{row.detail}</p>
                {row.gate && <p className="font-data text-[9.5px] text-amber-700" dir="ltr">{row.gate}</p>}
              </div>
            );
          })}
          {!saos && <div className="col-span-full py-4 text-center text-[11px] text-zinc-400">טוען מטריצת-עגינה...</div>}
        </div>
      </section>

      {/* ── chain liveness ── */}
      <div className="grid gap-3 md:grid-cols-3">
        {perChain.map(({ chain, total, verified, accts }) => (
          <button key={chain} onClick={() => onNavigate('vault')} className="sv-card p-4 text-right hover:border-[#d8d8d1] hover:shadow-[0_2px_4px_rgba(24,24,27,0.05),0_10px_28px_-8px_rgba(24,24,27,0.1)] transition-all group">
            <div className="flex items-center justify-between mb-2">
              <span className="inline-flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${CHAIN_META[chain as ChainId].dot}`} />
                <span className="font-data text-[12px] font-semibold text-zinc-800" dir="ltr">{CHAIN_META[chain as ChainId].label}</span>
              </span>
              <Network className="w-3.5 h-3.5 text-zinc-300 group-hover:text-emerald-600 transition-colors" />
            </div>
            <div className="font-data text-[15px] text-zinc-900" dir="ltr">{verified}<span className="text-zinc-400">/{total}</span> <span className="text-[10px] text-zinc-400">roles live</span></div>
            <div className="text-[11px] text-zinc-500 mt-1">{accts} חשבונות · RPC קהילתי פעיל</div>
          </button>
        ))}
      </div>

      {/* ── activity feed ── */}
      <section className="sv-card">
        <div className="px-4 py-3 border-b border-[#eeeeea] flex items-center justify-between">
          <span className="text-[13px] font-semibold flex items-center gap-2"><ArrowUpCircle className="w-4 h-4 text-zinc-400" />פעילות אחרונה</span>
          <button onClick={() => onNavigate('audit')} className="text-[11px] text-zinc-500 hover:text-zinc-800 inline-flex items-center gap-1">ביקורת מלאה <ChevronLeft className="w-3 h-3" /></button>
        </div>
        <div className="p-2">
          {auditRows.slice(0, 6).map(l => {
            const bad = l.action.includes('reject') || l.action.includes('OFF');
            return (
              <div key={l.id} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-zinc-50 transition-colors">
                {bad ? <ArrowDownCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" /> : <ArrowUpCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                <span className="font-data text-[10px] text-emerald-700 shrink-0 w-28 truncate" dir="ltr">{l.action}</span>
                <span className="text-[11px] text-zinc-500 truncate flex-1" dir="ltr">{l.detail}</span>
                <span className="font-data text-[10px] text-zinc-400 shrink-0">{fmtAgo(l.createdAt)}</span>
              </div>
            );
          })}
          {auditRows.length === 0 && (
            <div className="py-5 text-center text-[11px] text-zinc-400">אין פעילות רשומה עדיין</div>
          )}
        </div>
      </section>
    </div>
  );
}
