'use client';

// ─── RevenueView (roast-80) — מנוע-ההרווח הריבוני ════════════════════════════
// מטריצת-אמת אחת: מה-יש-ביד → מה-מרוויח-עכשיו → מה-זרם → מה-חסום-בכנות.
// הכל חי מ-/api/saos/revenue (המנוע :3010 + המושל-הכלכלי :3005) — אפס-הדמיה.

import { useCallback, useState } from 'react';
import {
  TrendingUp, Lock, Vote, Flame, Repeat, Bot, ShieldAlert, Wallet,
  Activity, Timer, BadgeCheck, Ban, Sparkles, Gauge,
} from 'lucide-react';
import { fmtInt, usePoll, StaleChip } from './common';

interface RevenueData {
  ok: boolean;
  ts: number;
  chain: { height: number; halted: number; runwayHours: number | null; runwayLevel: string | null; burnPerBlock: number | null };
  streams: Array<{
    id: string; title: string; status: string; detail: string; flow: string;
    evidence: Record<string, unknown>;
  }>;
  holdings: {
    treasuryCredits: number;
    balances: Record<string, number>;
    lpRows: Array<{ pair: string; amountMu: number; priceMu: number; valueUsdsMu: number }>;
    coreValueUsdsMu: number;
    note: string;
  };
  governor: {
    online: boolean;
    uptimeSec?: number; ticks?: number; lastErr?: string;
    veLockMu?: number; votePool?: string; lastPotMu?: number; lastEpoch?: number;
    reports?: Array<Record<string, unknown>>;
    actions?: Array<{ ts: number; kind: string; text: string }>;
    note?: string;
  };
  blocked: Array<{ rail: string; reason: string; custody: string; gap: string; unlock: string }>;
  note: string;
}

const MU = 1_000_000;

function mu(n: number): string {
  return fmtInt(Math.floor(n / 1000)) + 'kµ';
}

function fmtAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}ש׳`;
  if (s < 3600) return `${Math.floor(s / 60)}ד׳`;
  return `${Math.floor(s / 3600)}ש׳`;
}

const STATUS_STYLE: Record<string, { cls: string; label: string }> = {
  armed: { cls: 'text-[color:var(--green)] border-[color:var(--green)]', label: 'חמוש' },
  earning: { cls: 'text-[color:var(--green)] border-[color:var(--green)]', label: 'מרוויח' },
  idle: { cls: 'text-[color:var(--amber)] border-[color:var(--amber)]', label: 'ממתין' },
};

const STREAM_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  've-pot': Vote,
  protorev: Bot,
  'fee-flywheel': Repeat,
  'router-burn': Flame,
};

export function RevenueView() {
  const [data, setData] = useState<RevenueData | null>(null);
  const fetcher = useCallback(async (): Promise<boolean> => {
    try {
      const r = await fetch('/api/saos/revenue', { cache: 'no-store' });
      const j = (await r.json()) as RevenueData;
      if (j.ok) { setData(j); return true; }
      return false;
    } catch { return false; }
  }, []);
  const stale = usePoll(fetcher, 20_000);

  const d = data;
  if (!d) {
    return (
      <div className="flex items-center justify-center py-16 text-sm opacity-60">
        <Activity className="w-4 h-4 ml-2 animate-pulse" />
        טוען את מטריצת-ההרווח מהמנוע החי…
      </div>
    );
  }

  const gov = d.governor;
  const epochLeft = Number((d.streams.find((s) => s.id === 've-pot')?.evidence?.epochLeft as number) ?? 0);
  const potMu = Number((d.streams.find((s) => s.id === 've-pot')?.evidence?.potMu as number) ?? 0);
  const nonLp = Object.entries(d.holdings.balances)
    .filter(([k, v]) => !k.startsWith('LP|') && Number(v) > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div dir="rtl" className="max-w-5xl mx-auto space-y-4">
      {/* ── כותרת + קצב-חיים ── */}
      <div className="dx-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-[color:var(--green)]" />
            <h2 className="text-lg font-bold">מנוע-ההרווח הריבוני</h2>
            <span className="text-xs opacity-60">roast-80 · איך מה שיש לנו באמת מרוויח</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {stale && <StaleChip />}
            <span className="rounded-lg bg-black/30 border border-[color:var(--line)] px-2 py-1">
              h{fmtInt(d.chain.height)} · {d.chain.halted ? '⚠ halt' : 'חי'}
            </span>
            <span className={`rounded-lg bg-black/30 border border-[color:var(--line)] px-2 py-1 ${d.chain.runwayLevel === 'crit' ? 'text-[color:var(--amber)]' : ''}`}>
              <Gauge className="w-3 h-3 inline ml-1" />
              ראנוויי {d.chain.runwayHours !== null ? `${d.chain.runwayHours}ש׳` : '—'} ({d.chain.runwayLevel ?? '—'})
            </span>
          </div>
        </div>
        <div className="text-xs opacity-70 leading-relaxed">
          {d.note}
        </div>
      </div>

      {/* ── זרמי-ההכנסה ── */}
      <div className="grid gap-3 md:grid-cols-2">
        {d.streams.map((s) => {
          const Icon = STREAM_ICON[s.id] ?? Sparkles;
          const st = STATUS_STYLE[s.status] ?? STATUS_STYLE.idle;
          return (
            <div key={s.id} className="dx-card p-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-[color:var(--pink)]" />
                  <span className="font-semibold text-sm">{s.title}</span>
                </div>
                <span className={`text-[10px] border rounded-full px-2 py-0.5 ${st.cls}`}>{st.label}</span>
              </div>
              <div className="text-xs opacity-85 leading-relaxed mb-1.5">{s.detail}</div>
              <div className="text-[11px] opacity-55 leading-relaxed">{s.flow}</div>
              {s.id === 've-pot' && (
                <div className="mt-2 text-[11px] rounded-lg bg-black/30 border border-[color:var(--line)] px-2 py-1.5 flex items-center gap-1.5">
                  <Timer className="w-3 h-3" />
                  קציר-הבא בעוד ~{fmtInt(epochLeft)} בלוקים (~{Math.ceil((epochLeft * 3) / 60)} דק') · קרן-חיה {mu(potMu)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── המושל האוטונומי ── */}
      <div className="dx-card p-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-[color:var(--green)]" />
            <span className="font-semibold text-sm">המושל-הכלכלי (revenue-governor :3005)</span>
          </div>
          <span className={`text-[10px] border rounded-full px-2 py-0.5 ${gov.online ? 'text-[color:var(--green)] border-[color:var(--green)]' : 'text-[color:var(--amber)] border-[color:var(--amber)]'}`}>
            {gov.online ? `חי · ${fmtInt(gov.ticks ?? 0)} מחזורים` : 'לא-מגיב'}
          </span>
        </div>
        {gov.online ? (
          <div className="grid gap-2 md:grid-cols-2">
            <div className="text-xs opacity-75 leading-relaxed">
              <div>נעילת-יעד: {mu(gov.veLockMu ?? 0)} SAOS × 208שב' → {gov.votePool}</div>
              <div>קרן-אחרונה-שנצפתה: {mu(gov.lastPotMu ?? 0)} · אפוק #{gov.lastEpoch ?? '—'}</div>
              {gov.lastErr ? <div className="text-[color:var(--amber)]">שגיאה-אחרונה: {gov.lastErr}</div> : <div>ללא-שגיאות</div>}
            </div>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-[color:var(--line)] bg-black/30 p-2 space-y-1">
              {(gov.actions ?? []).slice(0, 8).map((a, i) => (
                <div key={i} className="text-[11px] flex gap-1.5">
                  <BadgeCheck className="w-3 h-3 shrink-0 mt-0.5 text-[color:var(--green)]" />
                  <span className="opacity-55 shrink-0">{fmtAgo(a.ts)}</span>
                  <span className="opacity-85">{a.text}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-xs opacity-60">{gov.note}</div>
        )}
      </div>

      {/* ── מה יש ביד ── */}
      <div className="dx-card p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-[color:var(--pink)]" />
            <span className="font-semibold text-sm">מה-יש-ביד (אוצר · הכל על השרשרת שלנו)</span>
          </div>
          <span className="text-xs rounded-lg bg-black/30 border border-[color:var(--line)] px-2 py-1">
            ערך-ליבה ≈ {mu(d.holdings.coreValueUsdsMu)} USDS
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <div className="text-[11px] uppercase tracking-wide opacity-50 mb-1.5">ארנק-האוצר · דלק {fmtInt(d.holdings.treasuryCredits)}µ</div>
            <div className="max-h-44 overflow-y-auto rounded-lg border border-[color:var(--line)] bg-black/30 divide-y divide-[color:var(--line)]">
              {nonLp.map(([k, v]) => (
                <div key={k} className="flex justify-between px-2 py-1.5 text-xs">
                  <span className="font-mono">{k}</span>
                  <span className="font-mono opacity-75">{fmtInt(v)}µ</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide opacity-50 mb-1.5">עמדות-נזילות-אוצר (POL — מרוויחות-עמלה-מכל-סוואפ)</div>
            <div className="max-h-44 overflow-y-auto rounded-lg border border-[color:var(--line)] bg-black/30 divide-y divide-[color:var(--line)]">
              {d.holdings.lpRows.map((r) => (
                <div key={r.pair} className="flex justify-between px-2 py-1.5 text-xs">
                  <span className="font-mono">{r.pair}</span>
                  <span className="font-mono opacity-75">{fmtInt(r.amountMu / MU)} LP ≈ {mu(r.valueUsdsMu)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── חסום-בכנות ── */}
      <div className="dx-card p-4">
        <div className="flex items-center gap-2 mb-2">
          <Ban className="w-4 h-4 text-[color:var(--amber)]" />
          <span className="font-semibold text-sm">חסום-בכנות (לא-מדומה — עם-הסיבה והפתיחה)</span>
        </div>
        {d.blocked.length === 0 ? (
          <div className="text-xs opacity-60">הכל-פתוח — אין-מסילות-חסומות</div>
        ) : (
          <div className="grid gap-2 md:grid-cols-3">
            {d.blocked.map((b) => (
              <div key={b.rail} className="rounded-lg border border-[color:var(--line)] bg-black/30 p-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <ShieldAlert className="w-3.5 h-3.5 text-[color:var(--amber)]" />
                  <span className="font-mono text-xs font-bold">{b.rail}</span>
                </div>
                <div className="text-[11px] opacity-75 leading-relaxed">{b.reason}</div>
                <div className="text-[10px] opacity-50 mt-1">משמורת: {b.custody}</div>
                <div className="text-[10px] opacity-50">פתיחה: {b.unlock}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── לוק-ההצבעה (הוכחת-הציוד) ── */}
      <div className="dx-card p-4">
        <div className="flex items-center gap-2 mb-2">
          <Lock className="w-4 h-4 text-[color:var(--green)]" />
          <span className="font-semibold text-sm">הוכחת-הציוד — עמדת-ה-ve של האוצר (על-השרשרת)</span>
        </div>
        <div className="text-xs opacity-75 leading-relaxed">
          הקציר-עצמו מתרחש-בגרעין (epochFlip — קנוני, דטרמיניסטי): הקרן-מתחלקת-פרופורציונלית-לכוח-ההצבעה.
          כמצביע-היחיד-כיום, 100%-מהקרן-זורם-לאוצר-בכל-אפוק — גם-אם-המושל-דולק, גם-אם-הקונסולה-כבויה.
          המושל-מוודא-שהעמדה-חיה-ושההצבעה-מוצבת, ומשדר-דוח-קציר-לכל-הסוכנים-בכל-אפוק.
        </div>
      </div>
    </div>
  );
}
