'use client';

// ─── overview — bento hero band + KPI grid + chain liveness + activity ─────
// Gold appears exactly ONCE here: the hero liquid totals. Everything else is
// grayscale + emerald (health) + amber (warn).

import { Fingerprint, Bot, ListChecks, ShieldCheck, ShieldAlert, ChevronLeft, RefreshCw, Network } from 'lucide-react';
import { CHAIN_KEYS, CHAIN_META, fmtAgo, fmtNum, perChainTotals } from './shared';
import type { StatusData, AuditRow, TaskT, ChainId } from './shared';
import type { ViewId } from './sidebar';
import { Sigil } from './sigil';

function KpiTile({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: 'emerald' | 'amber' }) {
  return (
    <div className="sv-card p-4 flex flex-col gap-1.5">
      <span className="label-caps">{label}</span>
      <span className={`font-data text-[26px] font-semibold leading-none ${accent === 'amber' ? 'text-amber-300' : accent === 'emerald' ? 'text-emerald-300' : 'text-zinc-100'}`} dir="ltr">{value}</span>
      <span className="text-[11px] text-zinc-600 leading-snug">{sub}</span>
    </div>
  );
}

export function OverviewView({ status, relay, lastSync, auditRows, tasks, onNavigate, verifying, onVerifyAll }: {
  status: StatusData | null;
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
      {/* ── hero band — the single gold moment ── */}
      <section className="sv-hero p-5 md:p-7">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <Sigil size="lg" live={relay} verifying={verifying} />
            <div>
              <div className="label-caps">נכסים חיים בשרשרת · live on-chain</div>
              <div className="text-[13px] text-zinc-500 mt-0.5">
                {lastSync ? `סונכרן ${fmtAgo(new Date(lastSync).toISOString())}` : 'מסנכרן...'}
                {' · '}אימות-אוטומטי כל 5 דק׳
              </div>
            </div>
          </div>
          <button onClick={onVerifyAll} disabled={verifying} className="h-9 px-3.5 rounded-lg border border-[#34343c] bg-[#17171c] hover:bg-[#1d1d22] text-[12px] text-zinc-300 transition-colors inline-flex items-center gap-2 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${verifying ? 'animate-spin' : ''}`} />אמת הכל עכשיו
          </button>
        </div>
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {CHAIN_KEYS.map(c => (
            <div key={c} className="rounded-xl border border-[#26262c] bg-[#0c0c0e]/70 px-4 py-3.5">
              <div className="flex items-center gap-1.5 mb-1">
                <span className={`w-1.5 h-1.5 rounded-full ${CHAIN_META[c].dot}`} />
                <span className="label-caps">{CHAIN_META[c].label}</span>
              </div>
              <div className="font-data text-[30px] md:text-[34px] font-semibold text-[#ecd28b] leading-none drop-shadow-[0_0_14px_rgba(212,169,78,0.25)]" dir="ltr">{fmtNum(totals[c]?.liquid || 0)}</div>
              <div className="font-data text-[10px] text-zinc-600 mt-1.5" dir="ltr">
                {totals[c]?.vests ? `${fmtNum(totals[c].vests, 0)} VESTS` : '—'}{totals[c] && totals[c].savings > 0 ? ` · savings ${fmtNum(totals[c].savings)}` : ''}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── owner-lock honesty strip ── */}
      <div className={`sv-card px-4 py-3 flex items-center gap-3 flex-wrap ${guardLocked ? 'border-emerald-500/20' : 'border-red-500/30'}`}>
        {guardLocked ? <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" /> : <ShieldAlert className="w-5 h-5 text-red-400 shrink-0" />}
        <div className="flex-1 min-w-48 text-[12px]">
          <span className="font-semibold">{guardLocked ? 'owner-lock פעיל' : 'owner-lock כבוי'}</span>
          <span className="text-zinc-600"> — {guardLocked ? 'אסור לשנות מפתחות-owner ללא הנחייתך המפורשת' : 'פעולות-owner חשופות'}</span>
        </div>
        <button onClick={() => onNavigate('settings')} className="text-[11px] text-zinc-500 hover:text-zinc-300 inline-flex items-center gap-1">ניהול <ChevronLeft className="w-3 h-3" /></button>
      </div>

      {/* ── KPI grid ── */}
      <div className="grid gap-3 grid-cols-2 xl:grid-cols-4">
        <div className="sv-card p-4 flex flex-col gap-1.5">
          <span className="label-caps">כספת — אינטגריות</span>
          <span className="font-data text-[26px] font-semibold leading-none text-emerald-300" dir="ltr">{t?.verified ?? '—'}<span className="text-zinc-600 text-[16px]">/{t?.keys ?? '—'}</span></span>
          <div className="h-1 rounded-full bg-[#26262c] overflow-hidden mt-1" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-emerald-500/80 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[11px] text-zinc-600">{pct}% מאומת-חי מול השרשרת</span>
        </div>
        <KpiTile label="ישויות תחת שליטה" value={String(t?.accounts ?? '—')} sub="חשבונות שרשרת + חומר גנזך מוצפן" />
        <div className="sv-card p-4 flex flex-col gap-1.5">
          <span className="label-caps">סוכנים</span>
          <span className="font-data text-[26px] font-semibold leading-none text-zinc-100" dir="ltr">{activeAgents}<span className="text-zinc-600 text-[16px]">/{status?.agents.length || 0}</span></span>
          <span className="text-[11px] text-zinc-600 inline-flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${activeAgents ? 'bg-emerald-400 pulse-ring' : 'bg-zinc-600'}`} />
            {activeAgents ? 'מחוברים ל-relay' : 'אין סוכנים פעילים'}
          </span>
        </div>
        <KpiTile label="תור מבצעים" value={String(tasksOpen)} sub="משימות פתוחות לסוכנים" accent={tasksOpen > 0 ? 'amber' : undefined} />
      </div>

      {/* ── chain liveness ── */}
      <div className="grid gap-3 md:grid-cols-3">
        {perChain.map(({ chain, total, verified, accts }) => (
          <button key={chain} onClick={() => onNavigate('vault')} className="sv-card p-4 text-right hover:border-[#34343c] transition-colors group">
            <div className="flex items-center justify-between mb-2">
              <span className="inline-flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${CHAIN_META[chain as ChainId].dot}`} />
                <span className="font-data text-[12px] font-semibold text-zinc-200" dir="ltr">{CHAIN_META[chain as ChainId].label}</span>
              </span>
              <Network className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400" />
            </div>
            <div className="font-data text-[15px] text-zinc-100" dir="ltr">{verified}<span className="text-zinc-600">/{total}</span> <span className="text-[10px] text-zinc-600">roles live</span></div>
            <div className="text-[11px] text-zinc-600 mt-1">{accts} חשבונות · RPC קהילתי פעיל</div>
          </button>
        ))}
      </div>

      {/* ── activity feed ── */}
      <section className="sv-card">
        <div className="px-4 py-3 border-b border-[#1d1d22] flex items-center justify-between">
          <span className="text-[13px] font-semibold flex items-center gap-2"><Fingerprint className="w-4 h-4 text-zinc-500" />פעילות אחרונה</span>
          <button onClick={() => onNavigate('audit')} className="text-[11px] text-zinc-500 hover:text-zinc-300 inline-flex items-center gap-1">ביקורת מלאה <ChevronLeft className="w-3 h-3" /></button>
        </div>
        <div className="p-2">
          {auditRows.slice(0, 6).map(l => (
            <div key={l.id} className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-[#131317] transition-colors">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${l.action.includes('reject') || l.action.includes('OFF') ? 'bg-red-400' : 'bg-emerald-400/70'}`} />
              <span className="font-data text-[10px] text-emerald-400/80 shrink-0 w-28 truncate" dir="ltr">{l.action}</span>
              <span className="text-[11px] text-zinc-500 truncate flex-1" dir="ltr">{l.detail}</span>
              <span className="font-data text-[10px] text-zinc-600 shrink-0">{fmtAgo(l.createdAt)}</span>
            </div>
          ))}
          {auditRows.length === 0 && (
            <div className="py-5 text-center text-[11px] text-zinc-600">אין פעילות רשומה עדיין</div>
          )}
        </div>
      </section>
    </div>
  );
}
