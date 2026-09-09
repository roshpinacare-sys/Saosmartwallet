'use client';

// ─── בורסה · Swap — אנטומיה Uniswap מלאה על המנוע הריבוני ──────────────────
// מסלול-חכם (ראוטר אטומי) · מגן-סטייה fail-closed · כנות מלאה (עמלה/מסלול/
// מינימום-קבלה) · מדד-שלמות-ציטוט "המחיר עודכן" · מכונת-מצבים של CTA.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown, ChevronDown, Settings2, Info, RefreshCcw, CheckCircle2,
  XCircle, Layers, ShieldCheck, Search, Loader2,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  type World, type RouteQuote, TOKEN_META, TokenMedallion, DEX_ASSETS,
  fmtMu, fmtPrice, fmtBps, dxPost, routeQuote, walletBal, MU,
} from './common';

type CtaState = 'empty' | 'no-route' | 'review' | 'submitting' | 'queued' | 'error';

const SLIP_PRESETS = [
  { label: 'אוטומטי', value: 0.5 },
  { label: '0.1%', value: 0.1 },
  { label: '0.5%', value: 0.5 },
  { label: '1%', value: 1 },
];

export function SwapView({ world, online, onNeedAuth }: {
  world: World | null; online: boolean; onNeedAuth: () => void;
}) {
  const [assetIn, setAssetIn] = useState<string>('SAOS');
  const [assetOut, setAssetOut] = useState<string>('USDS');
  const [amountStr, setAmountStr] = useState('');
  const [slipPct, setSlipPct] = useState(0.5);
  const [slipAuto, setSlipAuto] = useState(true);
  const [smartRoute, setSmartRoute] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState<'in' | 'out' | null>(null);
  const [pickSearch, setPickSearch] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [quote, setQuote] = useState<RouteQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [cta, setCta] = useState<CtaState>('empty');
  const [errNote, setErrNote] = useState('');
  const [lastQueuedAt, setLastQueuedAt] = useState(0);

  const amountMu = useMemo(() => {
    const n = parseFloat(amountStr.replace(/,/g, ''));
    return Number.isFinite(n) && n > 0 ? Math.floor(n * MU) : 0;
  }, [amountStr]);

  const balIn = world ? walletBal(world, 'operator', assetIn) : 0;
  const balOut = world ? walletBal(world, 'operator', assetOut) : 0;

  // ── live quote (GET, read-only) — כל-ה-setState אחרי מיקרו-משימה ──
  useEffect(() => {
    let alive = true;
    const run = async () => {
      await Promise.resolve();
      if (!alive) return;
      if (!amountMu || assetIn === assetOut) { setQuote(null); setQuoting(false); return; }
      setQuoting(true);
      const j = await routeQuote(assetIn, assetOut, amountMu);
      if (!alive) return;
      setQuoting(false);
      if (j.ok && j.quote && j.quote.amountOutMu > 0) {
        setQuote(j.quote); setCta('review'); setErrNote('');
      } else {
        setQuote(null); setCta('no-route');
      }
    };
    run();
    return () => { alive = false; };
  }, [assetIn, assetOut, amountMu]);

  const minOutMu = quote ? Math.floor((quote.amountOutMu * (100 - slipPct)) / 100) : 0;
  const outPerIn = quote && amountMu ? quote.amountOutMu / amountMu : 0;

  // price difference vs the direct pool mid (honest impact estimate)
  const impactPct = useMemo(() => {
    if (!quote || !amountMu) return null;
    const poolLeg = [...quote.legs].reverse().find(l => l.kind === 'pool');
    if (!poolLeg) return null;
    const pair = poolLeg.venue.slice(5);
    const pool = world?.pools.find(p => p.key === pair);
    if (!pool || !pool.mid) return null;
    const [, b] = pair.split('/');
    const inIsA = poolLeg.from === pool.a;
    const midRatio = inIsA ? pool.mid / MU : (pool.a ? MU / pool.mid : 0); // units of `to` per unit of `from`
    if (!midRatio) return null;
    return (1 - outPerIn / midRatio) * 100;
  }, [quote, amountMu, world, outPerIn]);

  const feeMu = quote ? Math.floor(quote.amountOutMu * 0.003) : 0;

  function flip() {
    setAssetIn(assetOut); setAssetOut(assetIn); setAmountStr('');
  }
  function pickAsset(dir: 'in' | 'out', sym: string) {
    if (dir === 'in') { if (sym === assetOut) setAssetOut(assetIn); setAssetIn(sym); }
    else { if (sym === assetIn) setAssetIn(assetOut); setAssetOut(sym); }
    setPickOpen(null); setPickSearch('');
  }

  async function doConfirm() {
    setReviewOpen(false);
    setCta('submitting'); setErrNote('');
    const payload = smartRoute
      ? { assetIn, assetOut, amount: amountMu, minOut: minOutMu, issuer: 'operator' }
      : null;
    const j = payload
      ? await dxPost('route', payload)
      : await dxPost('swap', { pair: `${assetIn}/${assetOut}`, assetIn, amount: amountMu, minOut: minOutMu });
    if (j.ok) {
      setCta('queued'); setLastQueuedAt(Date.now());
      setTimeout(() => setCta('review'), 6000);
    } else {
      setCta('error');
      setErrNote(
        String(j.error || '').includes('unauthorized') || String(j.error || '').includes('auth')
          ? 'נדרשת התחברות-בעלים כדי לסחור'
          : String(j.note || j.error || 'נכשל'),
      );
      if (String(j.error || '').includes('auth')) onNeedAuth();
    }
  }

  const amountMax = balIn / MU;
  const ctaLabel: Record<CtaState, string> = {
    empty: 'הזן סכום',
    'no-route': 'אין נזילות לזוג הזה',
    review: 'סקירת החלפה',
    submitting: 'שולח…',
    queued: 'הוגש — ייכלל בבלוק הבא',
    error: errNote || 'נכשל — נסה שוב',
  };
  const ctaEnabled = cta === 'review' && !!quote;

  // ── token selector modal ──
  const pickList = DEX_ASSETS.filter(a =>
    !pickSearch || a.toLowerCase().includes(pickSearch.toLowerCase()) || (TOKEN_META[a]?.name || '').toLowerCase().includes(pickSearch.toLowerCase()));

  return (
    <div className="flex flex-col items-center pt-2 md:pt-6" data-testid="swap-view">
      {/* card */}
      <div className="dx-card w-full max-w-[480px] p-4 md:p-5">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-semibold">החלפה</h1>
          <button
            onClick={() => setSettingsOpen(true)}
            aria-label="הגדרות החלפה"
            className="w-9 h-9 rounded-full flex items-center justify-center text-[color:var(--text-2)] hover:text-[color:var(--text-1)] hover:bg-white/6 transition-colors"
          >
            <Settings2 className="w-[18px] h-[18px]" />
          </button>
        </div>

        {/* PAY */}
        <div className="dx-input p-3.5" data-testid="swap-pay">
          <div className="flex items-center justify-between text-xs text-[color:var(--text-2)] mb-2">
            <span>משלמים</span>
            <span className="flex items-center gap-1">יתרה: <span className="dx-num">{fmtMu(balIn)}</span></span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setPickOpen('in'); }}
              className="dx-ghost flex items-center gap-2 pl-2 pr-3 py-2 text-[15px] font-semibold"
              data-testid="token-select-in"
            >
              <TokenMedallion sym={assetIn} />
              {assetIn}
              <ChevronDown className="w-4 h-4 opacity-60" />
            </button>
            <input
              inputMode="decimal" dir="ltr" placeholder="0.0"
              value={amountStr} onChange={e => setAmountStr(e.target.value.replace(/[^0-9.]/g, ''))}
              className="dx-num flex-1 min-w-0 bg-transparent text-right text-[26px] font-medium outline-none placeholder:text-[color:var(--text-3)]"
              data-testid="amount-in"
            />
          </div>
          {amountMax > 0 && (
            <div className="flex justify-start mt-1.5">
              <button onClick={() => setAmountStr(String(amountMax))} className="text-[11px] dx-num px-2 py-0.5 rounded-full dx-chip text-[color:var(--pink)]">
                MAX
              </button>
            </div>
          )}
        </div>

        {/* flip */}
        <div className="relative h-0 flex justify-center -my-1" style={{ zIndex: 5 }}>
          <button
            onClick={flip} aria-label="היפוך כיוון"
            className="w-9 h-9 rounded-full bg-[color:var(--well)] border-4 border-[color:var(--card)] flex items-center justify-center text-[color:var(--text-2)] hover:text-[color:var(--pink)] transition-colors"
          >
            <ArrowDown className="w-4 h-4" />
          </button>
        </div>

        {/* RECEIVE */}
        <div className="dx-input p-3.5 mt-1" data-testid="swap-receive">
          <div className="flex items-center justify-between text-xs text-[color:var(--text-2)] mb-2">
            <span>מקבלים (משוער)</span>
            <span className="flex items-center gap-1">יתרה: <span className="dx-num">{fmtMu(balOut)}</span></span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setPickOpen('out')}
              className="dx-ghost flex items-center gap-2 pl-2 pr-3 py-2 text-[15px] font-semibold"
              data-testid="token-select-out"
            >
              <TokenMedallion sym={assetOut} />
              {assetOut}
              <ChevronDown className="w-4 h-4 opacity-60" />
            </button>
            <div className="flex-1 min-w-0 text-left">
              {quoting ? (
                <Loader2 className="w-5 h-5 animate-spin-slow text-[color:var(--text-3)] inline-block" />
              ) : (
                <span className="dx-num text-[26px] font-medium text-[color:var(--text-1)]" data-testid="amount-out">
                  {quote ? fmtMu(quote.amountOutMu) : '0.0'}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* details — כנות מלאה */}
        {quote && (
          <div className="px-1 mt-3 text-xs" data-testid="swap-details">
            <div className="dx-detail flex items-center justify-between">
              <span className="text-[color:var(--text-2)]">מחיר</span>
              <span className="dx-num text-[color:var(--text-1)]">
                1 {assetIn} = {fmtPrice(outPerIn * MU)} {assetOut}
              </span>
            </div>
            <div className="dx-detail flex items-center justify-between">
              <span className="text-[color:var(--text-2)] flex items-center gap-1">
                הפרש מחיר (עלות-השפעה)
                <Info className="w-3 h-3" />
              </span>
              <span className={`dx-num ${impactPct !== null && impactPct > 2 ? 'text-[color:var(--amber)]' : 'text-[color:var(--text-1)]'}`}>
                {impactPct !== null ? `${impactPct.toFixed(2)}%` : '—'}
              </span>
            </div>
            <div className="dx-detail flex items-center justify-between">
              <span className="text-[color:var(--text-2)] flex items-center gap-1">
                סטייה מרבית מותרת
                <ShieldCheck className="w-3 h-3" />
              </span>
              <span className="dx-num text-[color:var(--text-1)]">{slipAuto ? 'אוטומטי' : ''} {fmtSlip(slipPct)}</span>
            </div>
            <div className="dx-detail flex items-center justify-between">
              <span className="text-[color:var(--text-2)] flex items-center gap-1">
                מקבלים לפחות
                <Info className="w-3 h-3" />
              </span>
              <span className="dx-num text-[color:var(--green)]">{fmtMu(minOutMu)} {assetOut}</span>
            </div>
            <div className="dx-detail flex items-center justify-between">
              <span className="text-[color:var(--text-2)] flex items-center gap-1">
                עמלת רשת (30bps)
                <Info className="w-3 h-3" />
              </span>
              <span className="dx-num text-[color:var(--text-1)]">
                ≈{fmtMu(feeMu)} {assetOut} <span className="text-[color:var(--text-3)]">(70% LP · 30% אוצר)</span>
              </span>
            </div>
            <div className="dx-detail flex items-center justify-between">
              <span className="text-[color:var(--text-2)] flex items-center gap-1">
                מסלול
                <Layers className="w-3 h-3" />
              </span>
              <span className="flex items-center gap-1 flex-wrap justify-end" data-testid="swap-route">
                {quote.legs.map((l, i) => (
                  <span key={i} className="dx-chip px-2 py-0.5 text-[10px] dx-num">
                    {l.kind === 'pool' ? l.venue.slice(5) : `wrap→${l.to}`}
                  </span>
                ))}
              </span>
            </div>
            <div className="dx-detail flex items-center justify-between">
              <span className="text-[color:var(--text-2)]">זמן משוער</span>
              <span className="text-[color:var(--text-1)]">≤ 3 שניות (בלוק הבא)</span>
            </div>
          </div>
        )}

        {/* CTA — state machine */}
        <button
          onClick={() => (ctaEnabled ? setReviewOpen(true) : undefined)}
          disabled={!ctaEnabled || cta === 'submitting' || cta === 'queued'}
          className={`dx-cta w-full h-[52px] mt-4 text-[16px] ${cta === 'queued' ? '!bg-[color:var(--green)]' : ''} ${cta === 'error' ? '!bg-[color:var(--red)]' : ''}`}
          data-testid="swap-cta"
        >
          {cta === 'submitting' && <Loader2 className="w-4 h-4 animate-spin-slow inline-block ml-2" />}
          {cta === 'queued' && <CheckCircle2 className="w-4 h-4 inline-block ml-2" />}
          {cta === 'error' && <XCircle className="w-4 h-4 inline-block ml-2" />}
          {ctaLabel[cta]}
        </button>

        {cta === 'queued' && (
          <p className="text-[11px] text-center text-[color:var(--text-2)] mt-2">
            ההחלפה נכנסה לתור הקונצנזוס — תוצאה תופיע בסרט העסקאות וביתרה בעוד רגע
          </p>
        )}

        {!online && (
          <p className="text-[11px] text-center text-[color:var(--amber)] mt-2">
            המנוע לא מגיב — הציטוט האחרון עשוי להיות מיושן
          </p>
        )}
      </div>

      {/* market strip under the card */}
      <MarketStrip world={world} onPick={(base, q) => { setAssetIn(base); setAssetOut(q); setAmountStr(''); }} />

      {/* settings drawer */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="dx-card max-w-sm border-[color:var(--line)]" dir="rtl">
          <DialogHeader><DialogTitle className="text-base">הגדרות החלפה</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <div className="text-xs font-medium mb-2">סטייה מרבית (Slippage)</div>
              <div className="flex gap-2 flex-wrap">
                {SLIP_PRESETS.map(p => (
                  <button
                    key={p.label}
                    onClick={() => { setSlipPct(p.value); setSlipAuto(p.label === 'אוטומטי'); }}
                    className={`px-3 py-1.5 text-xs rounded-full transition-colors ${slipPct === p.value && slipAuto === (p.label === 'אוטומטי') ? 'dx-chip-active' : 'dx-chip'}`}
                  >
                    {p.label}
                  </button>
                ))}
                <input
                  dir="ltr" placeholder="מותאם %" inputMode="decimal"
                  onChange={e => { const v = parseFloat(e.target.value); if (v > 0 && v <= 50) { setSlipPct(v); setSlipAuto(false); } }}
                  className="w-20 dx-num text-xs px-2 py-1.5 rounded-full dx-chip bg-transparent outline-none text-left"
                />
              </div>
              {slipPct < 0.1 && <p className="text-[11px] text-[color:var(--amber)] mt-2">סטייה נמוכה — העסקה עלולה לא לבצע</p>}
              {slipPct > 5 && <p className="text-[11px] text-[color:var(--red)] mt-2">סטייה גבוהה מאוד — חשוף למחיר גרוע</p>}
            </div>
            <div className="dx-detail pt-3">
              <div className="text-xs font-medium mb-2">מקור ביצוע</div>
              <div className="flex gap-2">
                <button
                  onClick={() => setSmartRoute(true)}
                  className={`px-3 py-1.5 text-xs rounded-full ${smartRoute ? 'dx-chip-active' : 'dx-chip'}`}
                >
                  מסלול-חכם (batch אטומי)
                </button>
                <button
                  onClick={() => setSmartRoute(false)}
                  className={`px-3 py-1.5 text-xs rounded-full ${!smartRoute ? 'dx-chip-active' : 'dx-chip'}`}
                >
                  בריכה ישירה
                </button>
              </div>
              <p className="text-[11px] text-[color:var(--text-2)] mt-2 leading-relaxed">
                מסלול-חכם: הראוטר מפרק לרגליים ומבצע הכל-או-כלום עם minOut לכל-רגל. בריכה ישירה: סוואג' יחיד בבריכת 30bps.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* token picker */}
      <Dialog open={!!pickOpen} onOpenChange={o => !o && setPickOpen(null)}>
        <DialogContent className="dx-card max-w-sm border-[color:var(--line)]" dir="rtl">
          <DialogHeader><DialogTitle className="text-base">בחירת מטבע</DialogTitle></DialogHeader>
          <div className="relative">
            <Search className="w-4 h-4 absolute top-3 right-3 text-[color:var(--text-3)]" />
            <Input
              autoFocus value={pickSearch} onChange={e => setPickSearch(e.target.value)}
              placeholder="חיפוש לפי שם או סימול"
              className="pr-9 bg-[color:var(--raised)] border-[color:var(--line)] text-[color:var(--text-1)] placeholder:text-[color:var(--text-3)]"
            />
          </div>
          <div className="max-h-72 overflow-y-auto -mx-1 px-1 space-y-1" dir="rtl">
            {pickList.map(a => (
              <button
                key={a} onClick={() => pickAsset(pickOpen!, a)}
                className="w-full flex items-center justify-between p-2.5 rounded-2xl hover:bg-white/6 transition-colors"
              >
                <span className="flex items-center gap-3">
                  <TokenMedallion sym={a} size={32} />
                  <span className="text-right">
                    <span className="block text-sm font-semibold">{a}</span>
                    <span className="block text-[11px] text-[color:var(--text-2)]">{TOKEN_META[a]?.name || a}</span>
                  </span>
                </span>
                <span className="dx-num text-sm text-[color:var(--text-2)]">
                  {fmtMu(world ? walletBal(world, 'operator', a) : 0)}
                </span>
              </button>
            ))}
            {pickList.length === 0 && <p className="text-center text-sm text-[color:var(--text-2)] py-6">לא נמצאו תוצאות</p>}
          </div>
        </DialogContent>
      </Dialog>

      {/* review modal — מכונת-האישור של Uniswap */}
      <Dialog open={reviewOpen} onOpenChange={o => !o && setReviewOpen(false)}>
        <DialogContent className="dx-card max-w-sm border-[color:var(--line)]" dir="rtl" data-testid="swap-review">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <RefreshCcw className="w-4 h-4 text-[color:var(--pink)]" />
              סקירת החלפה
            </DialogTitle>
          </DialogHeader>
          <div className="text-center py-3">
            <div className="dx-num text-[28px] font-semibold">{quote ? fmtMu(quote.amountOutMu) : '—'} {assetOut}</div>
            <div className="text-xs text-[color:var(--text-2)] mt-1 dx-num">
              תמורת {amountStr} {assetIn}
            </div>
          </div>
          <div className="text-xs space-y-0">
            <div className="dx-detail flex justify-between"><span className="text-[color:var(--text-2)]">שער</span><span className="dx-num">1 {assetIn} = {fmtPrice(outPerIn * MU)} {assetOut}</span></div>
            <div className="dx-detail flex justify-between"><span className="text-[color:var(--text-2)]">מקבלים לפחות</span><span className="dx-num text-[color:var(--green)]">{fmtMu(minOutMu)} {assetOut}</span></div>
            <div className="dx-detail flex justify-between"><span className="text-[color:var(--text-2)]">מסלול</span><span className="dx-num">{quote?.legs.length} רגליים · {smartRoute ? 'ראוטר אטומי' : 'בריכה ישירה'}</span></div>
            <div className="dx-detail flex justify-between"><span className="text-[color:var(--text-2)]">אחריות</span><span>minOut fail-closed — נדחה אם המחיר זז</span></div>
          </div>
          <button onClick={doConfirm} className="dx-cta w-full h-12 text-[15px]" data-testid="swap-confirm">
            אישור החלפה
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function fmtSlip(v: number): string {
  return `${v}%`;
}

// ── live market strip — פס-השווקים מתחת לכרטיס ──
function MarketStrip({ world, onPick }: { world: World | null; onPick: (base: string, quote: string) => void }) {
  const markets = world?.markets ?? [];
  if (!markets.length) return null;
  return (
    <div className="w-full max-w-[480px] mt-4" data-testid="market-strip">
      <div className="text-[11px] label-caps mb-2 px-1">שווקים חיים</div>
      <div className="grid grid-cols-2 gap-2">
        {markets.map(m => {
          const up = m.fair >= m.refPrice;
          return (
            <button
              key={m.key} onClick={() => onPick(m.base, m.quote)}
              className="dx-raised p-3 text-right hover:border-[color:var(--line-strong)] transition-colors"
            >
              <div className="flex items-center gap-2">
                <TokenMedallion sym={m.base} size={20} />
                <span className="text-xs font-semibold dx-num">{m.base}/{m.quote}</span>
                <span className={`text-[10px] dx-num ${up ? 'text-[color:var(--green)]' : 'text-[color:var(--red)]'}`}>
                  {fmtBps(m.spreadBps)}
                </span>
              </div>
              <div className="dx-num text-sm mt-1.5">{fmtPrice(m.fair)}</div>
              <div className="text-[10px] text-[color:var(--text-3)] dx-num">
                ספר {m.bestBid}/{m.bestAsk} · בריכה {fmtPrice(m.poolMid)}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
