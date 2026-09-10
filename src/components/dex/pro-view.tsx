'use client';

// ─── מסחר מקצועי · Pro — טרמינל סדרתי על הספר הריבוני ─────────────────────
// גרף חי (lightweight-charts) · ספר-עומק ויזואלי · פקודות לימיט/שוק ·
// ניהול-הזמנות פתוחות עם ביטול · סרט-עסקאות · ארנה (שחקני-עשיית-שוק).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createChart, AreaSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import { Loader2, X, Activity, Swords, Bot, Zap, Timer } from 'lucide-react';
import { TokenMedallion, fmtMu, fmtPrice, fmtInt, dxPost, usePoll, StaleChip, type World, type Market, MU } from './common';

type Side = 'buy' | 'sell';
type OrderKind = 'limit' | 'market';

export function ProView({ world, online, onNeedAuth }: {
  world: World | null; online: boolean; onNeedAuth: () => void;
}) {
  const markets = world?.markets ?? [];
  const [pairKey, setPairKey] = useState('');
  const market: Market | undefined = useMemo(
    () => markets.find(m => m.key === pairKey) ?? markets[0],
    [markets, pairKey],
  );

  const [side, setSide] = useState<Side>('buy');
  const [kind, setKind] = useState<OrderKind>('limit');
  const [priceStr, setPriceStr] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [myOrders, setMyOrders] = useState<Array<{ id: number; base: string; quote: string; side: string; price: number; amount: number; filled: number }>>([]);

  const base = market?.base ?? 'SAOS';
  const quote = market?.quote ?? 'USDS';
  // מחיר-אפקטיבי לטופס — קלט-המשתמש, ואחרת השער-החי (גזירה בלי effect)
  const effectivePrice = priceStr || (market ? String(market.fair / MU) : '');

  const refreshOrders = useCallback(async (): Promise<boolean> => {
    try {
      const r = await fetch('/saos-dex/api/dex/my-orders', { cache: 'no-store' });
      const j = await r.json();
      if (j.ok) { setMyOrders(j.orders || []); return true; }
      return false;
    } catch { return false; }
  }, []);

  // FIX(Roast-65-e4 · F7): לולאת-הפקודות (6ש׳) — השהיה-בהסתרת-טאב + backoff + חיווי-נתונים-ישנים
  const ordersStale = usePoll(refreshOrders, 6000);

  // לימיט-מחיר מאותחל לשער החי בכל החלפת זוג — בלי effect: גזירה ב-render
  // דרך value-המחושב (priceStr ריק ⇒ מוצג השער) ובזמן-הקלדה priceStr שולט.
  async function submit() {
    if (!market) return;
    const amount = Math.floor(parseFloat(amountStr) * MU || 0);
    const price = Math.floor(parseFloat(effectivePrice) * MU || 0);
    if (amount <= 0 || (kind === 'limit' && price <= 0)) {
      setNote({ ok: false, text: 'הזן כמות ומחיר תקינים' });
      return;
    }
    setBusy(true); setNote(null);
    const j = await dxPost('order', {
      action: kind === 'market' ? 'fill' : 'order',
      base, quote, side, price: kind === 'limit' ? price : undefined, amount,
    });
    if (j.ok) {
      setNote({ ok: true, text: 'הוגש לבלוק הבא (≤3 שנ׳)' });
      setAmountStr('');
      setTimeout(refreshOrders, 3500);
    } else {
      const e = String(j.error || '');
      setNote({
        ok: false,
        text: e.includes('auth') || e.includes('unauthorized') ? 'נדרשת התחברות-בעלים' : (j.note || j.error || 'נכשל'),
      });
      if (e.includes('auth') || e.includes('unauthorized')) onNeedAuth();
    }
    setBusy(false);
  }

  async function cancel(id: number) {
    await dxPost('cancel', { orderId: id });
    setTimeout(refreshOrders, 3000);
  }

  const fillPct = myOrders.length ? (myOrders[0].filled / myOrders[0].amount) * 100 : 0;

  return (
    <div dir="ltr" className="grid grid-cols-1 xl:grid-cols-[1fr_300px_320px] gap-3 pb-6" data-testid="pro-view">
      {/* chart + tape column */}
      <div className="space-y-3 min-w-0 order-2 xl:order-1">
        <div className="dx-card p-3">
          <PairHeader market={market} online={online} />
          <PriceChart market={market} />
        </div>
        <TapePanel world={world} />
      </div>

      {/* orderbook */}
      <div className="dx-card p-3 order-1 xl:order-2" data-testid="orderbook">
        <div className="text-[11px] label-caps mb-2">ספר-עומק</div>
        <BookSide rows={market?.asks ?? []} kind="ask" />
        <div className="flex items-center justify-between py-2 my-1 border-y border-[color:var(--line)]">
          <span className="dx-num text-lg font-semibold">{market ? fmtPrice(market.fair) : '—'}</span>
          <span className="dx-num text-[10px] text-[color:var(--text-3)]">
            spread {market ? (market.spreadBps / 100).toFixed(2) + '%' : '—'}
          </span>
        </div>
        <BookSide rows={market?.bids ?? []} kind="bid" />
      </div>

      {/* trading form + orders */}
      <div className="space-y-3 order-3">
        <div className="dx-card p-4" data-testid="trading-form">
          <div className="grid grid-cols-2 gap-1 p-1 rounded-full dx-chip mb-3">
            {(['buy', 'sell'] as Side[]).map(s => (
              <button
                key={s} onClick={() => setSide(s)}
                className={`h-9 rounded-full text-sm font-semibold transition-colors ${side === s
                  ? (s === 'buy' ? 'bg-[color:var(--green)] text-black' : 'bg-[color:var(--red)] text-white')
                  : 'text-[color:var(--text-2)]'}`}
              >
                {s === 'buy' ? 'קנייה' : 'מכירה'}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1 p-1 rounded-full dx-chip mb-3">
            {(['limit', 'market'] as OrderKind[]).map(k => (
              <button key={k} onClick={() => setKind(k)}
                className={`h-8 rounded-full text-xs transition-colors ${kind === k ? 'bg-white/12 text-[color:var(--text-1)]' : 'text-[color:var(--text-2)]'}`}>
                {k === 'limit' ? 'לימיט' : 'שוק'}
              </button>
            ))}
          </div>
          {kind === 'limit' && (
            <label className="block mb-2">
              <span className="text-[11px] label-caps">מחיר ({quote})</span>
              <input
                dir="ltr" inputMode="decimal" value={effectivePrice} onChange={e => setPriceStr(e.target.value.replace(/[^0-9.]/g, ''))}
                className="dx-num w-full mt-1 h-11 px-3 rounded-xl dx-raised text-left outline-none focus:border-[color:var(--line-strong)] border border-[color:var(--line)]"
              />
            </label>
          )}
          <label className="block">
            <span className="text-[11px] label-caps">כמות ({base})</span>
            <input
              dir="ltr" inputMode="decimal" placeholder="0.0" value={amountStr}
              onChange={e => setAmountStr(e.target.value.replace(/[^0-9.]/g, ''))}
              className="dx-num w-full mt-1 h-11 px-3 rounded-xl dx-raised text-left outline-none focus:border-[color:var(--line-strong)] border border-[color:var(--line)]"
              data-testid="pro-amount"
            />
          </label>
          <button
            onClick={submit} disabled={busy}
            className={`w-full h-11 mt-3 rounded-full text-sm font-semibold transition-opacity disabled:opacity-50 ${side === 'buy' ? 'bg-[color:var(--green)] text-black' : 'bg-[color:var(--red)] text-white'}`}
            data-testid="pro-submit"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin-slow inline-block" /> : (side === 'buy' ? 'קנה' : 'מכור')} {base}
          </button>
          {note && (
            <p className={`text-[11px] mt-2 text-center ${note.ok ? 'text-[color:var(--green)]' : 'text-[color:var(--red)]'}`}>
              {note.text}
            </p>
          )}
        </div>

        {/* open orders */}
        <div className="dx-card p-4" data-testid="my-orders">
          <div className="text-[11px] label-caps mb-2">ההזמנות שלי ({myOrders.length})</div>
          {/* FIX(Roast-65-e4 · F7): חיווי-נתונים-ישנים כשהרענון-נכשל */}
          <StaleChip show={ordersStale} className="mb-2" />
          {myOrders.length === 0 && <p className="text-xs text-[color:var(--text-3)] py-3 text-center">אין הזמנות פתוחות</p>}
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {myOrders.map(o => (
              <div key={o.id} className="dx-raised p-2.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold">
                    <span className={o.side === 'buy' ? 'text-[color:var(--green)]' : 'text-[color:var(--red)]'}>{o.side === 'buy' ? 'קנייה' : 'מכירה'}</span>
                    {' '}<span className="dx-num">{fmtMu(o.filled)}/{fmtMu(o.amount)}</span> {o.base}
                  </div>
                  <div className="text-[10px] text-[color:var(--text-3)] dx-num">@ {fmtPrice(o.price)} {o.quote}</div>
                  <div className="h-0.5 rounded-full bg-white/10 mt-1.5 overflow-hidden">
                    <div className="h-full bg-[color:var(--pink)]" style={{ width: `${Math.min(100, (o.filled / o.amount) * 100)}%` }} />
                  </div>
                </div>
                <button onClick={() => cancel(o.id)} aria-label={`ביטול הזמנה ${o.id}`}
                  className="w-7 h-7 shrink-0 rounded-full dx-chip flex items-center justify-center hover:border-[color:var(--red)] hover:text-[color:var(--red)] transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* auto-trading (Task 56): DCA + טריגרים חסרי-קיפרים */}
        <AutoTradePanel market={market} onNeedAuth={onNeedAuth} />

        {/* arena */}
        <ArenaPanel world={world} />
      </div>
    </div>
  );
}

function PairHeader({ market, online }: { market?: Market; online: boolean }) {
  if (!market) return <div className="h-12" />;
  const up = market.fair >= market.refPrice;
  return (
    <div className="flex items-center gap-3 mb-2 flex-wrap" dir="rtl">
      <TokenMedallion sym={market.base} size={30} />
      <div>
        <div className="text-sm font-bold dx-num" dir="ltr">{market.key}</div>
        <div className="flex items-center gap-2 text-[10px] text-[color:var(--text-3)]">
          <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-[color:var(--green)] pulse-ring' : 'bg-[color:var(--red)]'}`} />
          ספר ריבוני חי
        </div>
      </div>
      <div className="mr-auto text-left" dir="ltr">
        <div className={`dx-num text-xl font-bold ${up ? 'text-[color:var(--green)]' : 'text-[color:var(--red)]'}`}>
          {fmtPrice(market.fair)}
        </div>
        <div className="dx-num text-[10px] text-[color:var(--text-3)]">
          TWAP {fmtPrice(market.twap)} · ref {fmtPrice(market.refPrice)}
        </div>
      </div>
    </div>
  );
}

function PriceChart({ market }: { market?: Market }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: 'rgba(255,255,255,0.55)',
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)' },
      timeScale: { borderColor: 'rgba(255,255,255,0.1)', timeVisible: true, secondsVisible: true },
      crosshair: { mode: 0 },
      height: 340,
      autoSize: true,
    });
    const series = chart.addSeries(AreaSeries, {
      lineColor: '#FF37C7',
      topColor: 'rgba(255,55,199,0.32)',
      bottomColor: 'rgba(255,55,199,0.02)',
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 3, minMove: 0.001 },
    });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null; };
  }, []);

  useEffect(() => {
    if (!seriesRef.current || !market) return;
    const pts = (market.chart || [])
      .slice(-400)
      .map(p => ({ time: Math.floor(p.t / 1000) as UTCTimestamp, value: p.p / MU }))
      .filter((x, i, arr) => i === 0 || x.time > arr[i - 1].time);
    if (pts.length) seriesRef.current.setData(pts);
    chartRef.current?.timeScale().fitContent();
  }, [market?.key, market?.chart?.length, market]);

  return <div ref={ref} className="w-full h-[340px]" data-testid="lightweight-charts-container" />;
}

function BookSide({ rows, kind }: { rows: Array<{ price: number; total: number; orders: number }>; kind: 'bid' | 'ask' }) {
  const list = kind === 'ask' ? rows.slice(0, 7) : rows.slice(0, 7);
  const maxTotal = Math.max(...list.map(r => r.total), 1);
  const empty = list.length === 0;
  return (
    <div className={kind === 'ask' ? '' : ''} data-testid={`book-${kind}`}>
      {empty && <p className="text-[10px] text-[color:var(--text-3)] py-2 text-center">אין סדרים בצד הזה</p>}
      {list.map(r => (
        <div key={r.price} className="relative flex items-center justify-between h-[22px] px-2 text-[11px]">
          <div
            className={`absolute inset-y-0 ${kind === 'ask' ? 'right-0 dx-depth-ask' : 'left-0 dx-depth-bid'}`}
            style={{ width: `${(r.total / maxTotal) * 100}%` }}
          />
          <span className={`dx-num relative ${kind === 'ask' ? 'text-[color:var(--red)]' : 'text-[color:var(--green)]'}`}>
            {fmtPrice(r.price)}
          </span>
          <span className="dx-num relative text-[color:var(--text-2)]">{fmtMu(r.total, 0)}</span>
        </div>
      ))}
    </div>
  );
}

function TapePanel({ world }: { world: World | null }) {
  const tape = world?.tape ?? [];
  return (
    <div className="dx-card p-3" data-testid="tape">
      <div className="text-[11px] label-caps mb-2 flex items-center gap-1.5">
        <Activity className="w-3 h-3" /> סרט-עסקאות חי
      </div>
      <div className="max-h-56 overflow-y-auto">
        {tape.map((t, i) => (
          <div key={`${t.h}-${i}`} className="flex items-center justify-between h-[24px] px-1 text-[11px]">
            <span className="dx-num text-[color:var(--text-2)]">{fmtMu(t.amountMu, 1)} {t.base}</span>
            <span className="dx-num">{fmtPrice(t.price)}</span>
            <span className="dx-num text-[color:var(--text-3)]">@{t.h}</span>
          </div>
        ))}
        {tape.length === 0 && <p className="text-xs text-[color:var(--text-3)] py-3 text-center">עדיין אין עסקאות</p>}
      </div>
    </div>
  );
}

function ArenaPanel({ world }: { world: World | null }) {
  const arena = world?.arena;
  if (!arena) return null;
  // FIX(Roast-70 · gas-truth): האמת-על-הדלק — החיילים-היו-מוצגים-עם-PnL-אך-המנוע-דחה-את-הפקודות-שלהם
  // (insufficient-credits). עכשיו: credits-חיים-פר-חייל + דחיות-הבלוק-האחרון + מיכל-הגז. אפס-תיאטרון.
  const creditOf = (name: string): number => world?.wallets.find(w => w.name === name)?.credits ?? 0;
  const rejected = world?.state.rejectedLast;
  const gasFunded = world?.state.gasFundedMu ?? 0;
  return (
    <div className="dx-card p-4" data-testid="arena-panel">
      <div className="text-[11px] label-caps mb-2 flex items-center gap-1.5">
        <Swords className="w-3 h-3" /> ארנת עשיית-השוק · {arena.params.enabled ? 'פעילה' : 'כבויה'}
      </div>
      <div className="space-y-2">
        {arena.soldiers.map(s => {
          const cr = creditOf(s.name);
          const starving = cr < 100;
          return (
            <div key={s.name} className="dx-raised p-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold dx-num">{s.name}</span>
                <span className={`dx-num ${(s.pnl || 0) >= 0 ? 'text-[color:var(--green)]' : 'text-[color:var(--red)]'}`}>
                  {(s.pnl >= 0 ? '+' : '') + fmtMu(s.pnl)}
                </span>
              </div>
              <div className="text-[10px] text-[color:var(--text-3)] dx-num mt-0.5">
                equity {fmtMu(s.equity)} · {s.liveQuotes} quotes ·{' '}
                <span className={starving ? 'text-[color:var(--red)] font-semibold' : 'text-[color:var(--text-3)]'}>
                  gas {fmtInt(cr)} credits{starving ? ' (מוגבל!)' : ''}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {rejected && rejected.count > 0 && (
        <div className="mt-2 rounded-lg border border-[color:var(--amber)]/30 bg-[color:var(--amber)]/10 px-2.5 py-1.5" data-testid="rejections-strip">
          <div className="text-[10px] text-[color:var(--amber)] font-semibold">
            נדחו בבלוק h{fmtInt(rejected.h)}: {fmtInt(rejected.count)} פעולות
          </div>
          {rejected.sample?.[0] && (
            <div className="text-[9.5px] text-[color:var(--text-3)] dx-num truncate" dir="ltr" title={rejected.sample.join(' · ')}>
              {rejected.sample[0]}
            </div>
          )}
        </div>
      )}
      <p className="text-[10px] text-[color:var(--text-3)] mt-2 leading-relaxed">
        {/* FIX(Roast-65-e4 · F8): המספר-חי מ-arena.soldiers.length + תווית-כנה (הארנה = סים) */}
        ארנה-פנימית (סים) — מספקת-נזילות לספר-הסים · {arena.soldiers.length} חיילים · {arena.params.spreadBps}bps{arena.params.requoteBps != null ? ` · requote ${arena.params.requoteBps}bps` : ''}
        {' · '}מיכל-גז: <span className="dx-num">{fmtMu(gasFunded, 0)}µ</span> ממומן
      </p>
    </div>
  );
}

// ─── מסחר-אוטומטי חסר-קיפרים (Task 56) — DCA + טריגרים ──────────────────────
// בונה-הבלוקים הוא ה-keeper: GMX צריך keepers-חוץ בתשלום — אצלנו זו השוואת-
// שלמים-טהורה בגרעין עצמו. הפרוסות והטריגרים מניבים מסחר-אמת שנכנס לעדות-המחיר.

interface DcaRow { id: string; assetIn: string; assetOut: string; perSliceMu: number; remainingMu: number; everyK: number; done: number; slicesMax: number; nextSliceIn: number; progressPct: number }
interface TrigRow { id: string; base: string; quote: string; side: string; triggerPx: number; limitPx: number; amountMu: number; expiresH: number; blocksLeft: number | null }

function AutoTradePanel({ market, onNeedAuth }: { market?: Market; onNeedAuth: () => void }) {
  const [tab, setTab] = useState<'dca' | 'trig'>('dca');
  const [dcaRows, setDcaRows] = useState<DcaRow[]>([]);
  const [trigRows, setTrigRows] = useState<TrigRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  // DCA form
  const [inAsset, setInAsset] = useState('USDS');
  const [outAsset, setOutAsset] = useState('SAOS');
  const [perSlice, setPerSlice] = useState('200');
  const [slices, setSlices] = useState('10');
  const [everyK, setEveryK] = useState('10');
  // Trig form
  const [tSide, setTSide] = useState<'buy' | 'sell'>('sell');
  const [triggerPx, setTriggerPx] = useState('');
  const [tAmount, setTAmount] = useState('');

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/saos-dex/api/dex/program', { cache: 'no-store' });
      const j = await r.json();
      if (j.ok) { setDcaRows(j.dca || []); setTrigRows(j.trig || []); return true; }
      return false;
    } catch { return false; }
  }, []);

  // FIX(Roast-65-e4 · F7): לולאת-התוכניות (6ש׳) — השהיה-בהסתרת-טאב + backoff + חיווי-נתונים-ישנים
  const programStale = usePoll(refresh, 6000);

  async function submit(op: string, payload: Record<string, unknown>) {
    setBusy(true); setNote(null);
    const j = await dxPost('program', { op, ...payload });
    if (j.ok) {
      setNote({ ok: true, text: op.startsWith('dca') ? 'תוכנית-DCA נקלטה — הפריסה מתחילה בבלוק הבא' : 'טריגר הוצב — נסרק כל-בלוק מול המחיר הקנוני' });
      setTimeout(refresh, 4000);
    } else {
      const e = String(j.error || '');
      setNote({ ok: false, text: e.includes('auth') || e.includes('unauthorized') ? 'נדרשת התחברות-בעלים' : (j.note || j.error || 'נכשל') });
      if (e.includes('auth') || e.includes('unauthorized')) onNeedAuth();
    }
    setBusy(false);
  }

  const mid = market ? market.fair / MU : 0;

  return (
    <div className="dx-card p-4" data-testid="auto-trade-panel">
      <div className="text-[11px] label-caps mb-2 flex items-center gap-1.5">
        <Bot className="w-3 h-3 text-[color:var(--pink)]" /> מסחר-אוטומטי · חסר-קיפרים
      </div>
      {/* FIX(Roast-65-e4 · F7): חיווי-נתונים-ישנים כשהרענון-נכשל */}
      <StaleChip show={programStale} className="mb-2" />
      <div className="grid grid-cols-2 gap-1 p-1 rounded-full dx-chip mb-3">
        {(['dca', 'trig'] as const).map(k => (
          <button key={k} onClick={() => setTab(k)}
            className={`h-8 rounded-full text-xs transition-colors ${tab === k ? 'bg-white/12 text-[color:var(--text-1)]' : 'text-[color:var(--text-2)]'}`}>
            {k === 'dca' ? 'DCA פריסה' : 'טריגר stop/take'}
          </button>
        ))}
      </div>

      {tab === 'dca' ? (
        <div className="space-y-2" data-testid="dca-form">
          <p className="text-[9.5px] text-[color:var(--text-3)] leading-relaxed">
            הפקדה-מלאה-מראע → פרוסות-אוטומטיות דרך-הראוטר כל-K-בלוקים (Jupiter DCA — בלי-keeper-חוץ).
          </p>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] label-caps">מ-</span>
              <select value={inAsset} onChange={e => setInAsset(e.target.value)} className="dx-num w-full mt-1 h-9 px-2 rounded-lg dx-raised text-left text-xs border border-[color:var(--line)] outline-none">
                {['USDS', 'SAOS', 'WSTEEM'].map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] label-caps">אל</span>
              <select value={outAsset} onChange={e => setOutAsset(e.target.value)} className="dx-num w-full mt-1 h-9 px-2 rounded-lg dx-raised text-left text-xs border border-[color:var(--line)] outline-none">
                {['SAOS', 'USDS', 'WSTEEM'].map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] label-caps">פרוסה ({inAsset})</span>
              <input dir="ltr" inputMode="decimal" value={perSlice} onChange={e => setPerSlice(e.target.value.replace(/[^0-9.]/g, ''))}
                className="dx-num w-full mt-1 h-9 px-2 rounded-lg dx-raised text-left text-xs border border-[color:var(--line)] outline-none" />
            </label>
            <label className="block">
              <span className="text-[10px] label-caps">מספר-פרוסות</span>
              <input dir="ltr" inputMode="numeric" value={slices} onChange={e => setSlices(e.target.value.replace(/[^0-9]/g, ''))}
                className="dx-num w-full mt-1 h-9 px-2 rounded-lg dx-raised text-left text-xs border border-[color:var(--line)] outline-none" />
            </label>
          </div>
          <label className="block">
            <span className="text-[10px] label-caps">פרוסה-כל-K-בלוקים (בלוק = 3ש׳)</span>
            <input dir="ltr" inputMode="numeric" value={everyK} onChange={e => setEveryK(e.target.value.replace(/[^0-9]/g, ''))}
              className="dx-num w-full mt-1 h-9 px-2 rounded-lg dx-raised text-left text-xs border border-[color:var(--line)] outline-none" />
          </label>
          <button onClick={() => submit('dca_create', {
            assetIn: inAsset, assetOut: outAsset,
            perSlice: Math.floor(parseFloat(perSlice) * MU || 0),
            slicesMax: parseInt(slices) || 0, everyK: parseInt(everyK) || 0,
          })} disabled={busy}
            className="w-full h-10 mt-1 rounded-full text-xs font-semibold bg-[color:var(--pink)] text-white transition-opacity disabled:opacity-50"
            data-testid="dca-submit">
            {busy ? <Loader2 className="w-4 h-4 animate-spin-slow inline-block" /> : 'הפעל תוכנית DCA'}
          </button>
        </div>
      ) : (
        <div className="space-y-2" data-testid="trig-form">
          <p className="text-[9.5px] text-[color:var(--text-3)] leading-relaxed">
            stop-loss / take-profit על המחיר-הקנוני — GMX צריך keepers-חוץ; אצלנו בונה-הבלוקים הוא ה-keeper (אפס-עלות).
          </p>
          <div className="grid grid-cols-2 gap-1 p-1 rounded-full dx-chip">
            {(['buy', 'sell'] as const).map(s => (
              <button key={s} onClick={() => setTSide(s)}
                className={`h-7 rounded-full text-[11px] transition-colors ${tSide === s ? (s === 'buy' ? 'bg-[color:var(--green)] text-black' : 'bg-[color:var(--red)] text-white') : 'text-[color:var(--text-2)]'}`}>
                {s === 'buy' ? 'קנייה-מעל' : 'מכירה-מתחת'}
              </button>
            ))}
          </div>
          <div className="text-[9.5px] text-[color:var(--text-3)]">זוג: <span className="dx-num">{market?.key ?? '—'}</span> · mid <span className="dx-num" dir="ltr">{mid.toFixed(3)}</span></div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] label-caps">מחיר-טריגר ({market?.quote ?? ''})</span>
              <input dir="ltr" inputMode="decimal" placeholder={mid > 0 ? (tSide === 'sell' ? (mid * 0.97).toFixed(3) : (mid * 1.03).toFixed(3)) : '0'} value={triggerPx}
                onChange={e => setTriggerPx(e.target.value.replace(/[^0-9.]/g, ''))}
                className="dx-num w-full mt-1 h-9 px-2 rounded-lg dx-raised text-left text-xs border border-[color:var(--line)] outline-none" />
            </label>
            <label className="block">
              <span className="text-[10px] label-caps">כמות ({market?.base ?? ''})</span>
              <input dir="ltr" inputMode="decimal" value={tAmount} onChange={e => setTAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                className="dx-num w-full mt-1 h-9 px-2 rounded-lg dx-raised text-left text-xs border border-[color:var(--line)] outline-none" />
            </label>
          </div>
          <button onClick={() => market && submit('trig_create', {
            base: market.base, quote: market.quote, side: tSide,
            triggerPx: Math.floor(parseFloat(triggerPx) * MU || 0),
            amount: Math.floor(parseFloat(tAmount) * MU || 0),
          })} disabled={busy || !market}
            className="w-full h-10 mt-1 rounded-full text-xs font-semibold bg-[color:var(--pink)] text-white transition-opacity disabled:opacity-50"
            data-testid="trig-submit">
            {busy ? <Loader2 className="w-4 h-4 animate-spin-slow inline-block" /> : 'הצב טריגר'}
          </button>
        </div>
      )}

      {note && <p className={`text-[10.5px] mt-2 ${note.ok ? 'text-[color:var(--green)]' : 'text-[color:var(--red)]'}`}>{note.text}</p>}

      {/* רשימות-חיות */}
      <div className="mt-3 pt-3 border-t border-[color:var(--line)] space-y-2" data-testid="auto-trade-lists">
        {dcaRows.length > 0 && (
          <div>
            <div className="text-[10px] label-caps mb-1.5 flex items-center gap-1"><Timer className="w-3 h-3" /> תוכניות-DCA ({dcaRows.length})</div>
            {dcaRows.map(p => (
              <div key={p.id} className="dx-raised p-2 mb-1.5 text-[10.5px]">
                <div className="flex items-center justify-between">
                  <span className="dx-num font-semibold" dir="ltr">{p.assetIn}→{p.assetOut}</span>
                  <button onClick={() => submit('dca_cancel', { progId: p.id })} aria-label={`ביטול ${p.id}`}
                    className="w-6 h-6 rounded-full dx-chip flex items-center justify-center hover:border-[color:var(--red)] hover:text-[color:var(--red)]">
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <div className="dx-num text-[color:var(--text-3)] mt-0.5" dir="ltr">
                  {fmtMu(p.perSliceMu, 0)}/slice · every {p.everyK}b · {p.done}/{p.slicesMax} · next in {p.nextSliceIn}b
                </div>
                <div className="h-0.5 rounded-full bg-white/10 mt-1 overflow-hidden">
                  <div className="h-full bg-[color:var(--pink)]" style={{ width: `${Math.min(100, p.progressPct)}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
        {trigRows.length > 0 && (
          <div>
            <div className="text-[10px] label-caps mb-1.5 flex items-center gap-1"><Zap className="w-3 h-3" /> טריגרים חיים ({trigRows.length})</div>
            {trigRows.map(t => (
              <div key={t.id} className="dx-raised p-2 mb-1.5 text-[10.5px] flex items-center justify-between">
                <div>
                  <span className={t.side === 'buy' ? 'text-[color:var(--green)]' : 'text-[color:var(--red)]'}>{t.side === 'buy' ? 'קנייה' : 'מכירה'}</span>
                  {' '}<span className="dx-num">{fmtMu(t.amountMu, 0)} {t.base}</span>
                  <div className="dx-num text-[color:var(--text-3)]" dir="ltr">trigger {fmtPrice(t.triggerPx)}{t.expiresH > 0 ? ` · exp ${t.blocksLeft ?? 0}b` : ''}</div>
                </div>
                <button onClick={() => submit('trig_cancel', { progId: t.id })} aria-label={`ביטול ${t.id}`}
                  className="w-6 h-6 rounded-full dx-chip flex items-center justify-center hover:border-[color:var(--red)] hover:text-[color:var(--red)]">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        {dcaRows.length === 0 && trigRows.length === 0 && (
          <p className="text-[10px] text-[color:var(--text-3)] text-center py-1">אין תוכניות פעילות — הפעל DCA או הצב טריגר</p>
        )}
      </div>
    </div>
  );
}
