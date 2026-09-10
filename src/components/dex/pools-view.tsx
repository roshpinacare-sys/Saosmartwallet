'use client';

// ─── בריכות · Pools — נזילות AMM עם ניהול-עמדות ────────────────────────
// x·y=k שלמים · עמלה-דינמית (feeBps-חי-מה-API, 70% LP · 30% אוצר) · add פרופורציונלי ·
// remove pro-rata · עמדות-ה-LP שלי מהארנק החי.
// FIX(Roast-70 · pol-truth): כל-בריכה-מציגה-עכשיו את אמת-ה-POL שהמנוע-כבר-מחשב
// (lpYieldBps · lpFeesMu · polShareBps — roast-68) שהייתה-עד-היום בלתי-נראית.

import { useState } from 'react';
import { Droplets, Loader2, Plus, Minus, Info } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TokenMedallion, fmtMu, fmtPrice, fmtInt, fmtBps, dxPost, walletBal, type World, type Pool, MU } from './common';

// FIX(Roast-65-e4 · F4): עמלה-חי-מה-API — feeBps-פר-בריכה; בלי-נתון → '—' (אין-עוד 0.30% מקודד)
const feeLabel = (p?: Pool | null): string => p?.feeBps != null ? `${(p.feeBps / 100).toFixed(2)}%` : '—';

export function PoolsView({ world, onNeedAuth, onDone }: {
  world: World | null; onNeedAuth: () => void; onDone: () => void;
}) {
  const pools = world?.pools ?? [];
  const [addPool, setAddPool] = useState<Pool | null>(null);
  const [rmPool, setRmPool] = useState<Pool | null>(null);

  const myPositions = (() => {
    const bals = world?.wallets.find(w => w.name === 'operator')?.balances ?? {};
    return Object.entries(bals)
      .filter(([k]) => k.startsWith('LP|'))
      .map(([k, v]) => ({ key: k.slice(3), lp: v, pool: pools.find(p => p.key === k.slice(3)) }));
  })();

  const totalPoolValue = pools.length;

  return (
    <div className="max-w-5xl mx-auto space-y-5 pb-6" data-testid="pools-view">
      {/* my positions */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Droplets className="w-5 h-5 text-[color:var(--pink)]" />
            העמדות שלי
          </h2>
          <span className="text-[11px] text-[color:var(--text-3)]">
            {myPositions.length} עמדות פעילות
          </span>
        </div>
        {myPositions.length === 0 ? (
          <div className="dx-card p-8 text-center">
            <p className="text-sm text-[color:var(--text-2)]">אין לך עדיין עמדות נזילות</p>
            {/* FIX(Roast-70): האמת על הבריכות — נזילות-הג'נזיס הוטבעה-כעמדת-POL של האוצר
            (roast-68 · pol-retro-mint): implied=0 לנצח, וכל-LP-חוץ מקבל נתח pro-rata כן מהעמלות */}
            <p className="text-xs text-[color:var(--text-3)] mt-1 max-w-md mx-auto leading-relaxed">
              נזילות-הג'נזיס מוחזקת-ריבונית-בידי-האוצר (POL) — חלק-הפרוטוקול-מוצג-על-כל-בריכה למטה.
              הצטרף לבריכה ותקבל נתח pro-rata כן מהעמלות — התשואה-החיה מוצגת-על-כל-כרטיס.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {myPositions.map(p => {
              const share = p.pool && p.pool.lp > 0 ? (p.lp / p.pool.lp) * 100 : 0;
              return (
                <div key={p.key} className="dx-card p-4" data-testid={`position-${p.key}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex -space-x-2" dir="ltr">
                        <TokenMedallion sym={p.key.split('/')[0]} size={26} />
                        <TokenMedallion sym={p.key.split('/')[1]} size={26} />
                      </span>
                      <span className="font-semibold dx-num text-sm">{p.key}</span>
                    </div>
                    <span className="dx-chip px-2.5 py-1 text-[10px] font-semibold" title="עמלת-הבריכה-החיה (feeBps מה-API)">{feeLabel(p.pool)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                    <div className="dx-raised p-2.5">
                      <div className="label-caps text-[10px]">חלקי מהבריכה</div>
                      <div className="dx-num mt-0.5">{share.toFixed(2)}%</div>
                    </div>
                    <div className="dx-raised p-2.5">
                      <div className="label-caps text-[10px]">יחידות LP שלי</div>
                      <div className="dx-num mt-0.5">{fmtInt(p.lp)}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => setRmPool(p.pool ?? null)}
                    className="dx-ghost w-full h-9 mt-3 text-xs flex items-center justify-center gap-1.5"
                  >
                    <Minus className="w-3.5 h-3.5" /> דילול נזילות
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* all pools */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">בריכות נזילות ({totalPoolValue})</h2>
          <span className="text-[11px] text-[color:var(--text-3)]">AMM שלמים · x·y=k · עמלה-דינמית-חי (feeBps)</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="pool-list">
          {pools.map(p => {
            const myLp = world ? walletBal(world, 'operator', `LP|${p.key}`) : 0;
            return (
              <div key={p.key} className="dx-card p-4" data-testid={`pool-${p.key}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="flex -space-x-2" dir="ltr">
                      <TokenMedallion sym={p.a} size={30} />
                      <TokenMedallion sym={p.b} size={30} />
                    </span>
                    <div>
                      <div className="font-semibold dx-num text-sm">{p.key}</div>
                      <div className="text-[10px] text-[color:var(--text-3)] dx-num">
                        מחיר 1 {p.a} = {fmtPrice(p.mid)} {p.b}
                      </div>
                    </div>
                  </div>
                  {/* FIX(Roast-65-e4 · F4): עמלה-חי-מה-API עם נפילה-כנה ל-'—' */}
                  <span className="dx-chip px-2.5 py-1 text-[10px] font-semibold" title="עמלת-הבריכה-החיה (feeBps מה-API)">{feeLabel(p)}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <div className="dx-raised p-2">
                    <div className="text-[9px] label-caps">יתרה {p.a}</div>
                    <div className="dx-num text-[11px] mt-0.5">{fmtMu(p.ra, 0)}</div>
                  </div>
                  <div className="dx-raised p-2">
                    <div className="text-[9px] label-caps">יתרה {p.b}</div>
                    <div className="dx-num text-[11px] mt-0.5">{fmtMu(p.rb, 0)}</div>
                  </div>
                  <div className="dx-raised p-2">
                    <div className="text-[9px] label-caps">סוואג'ים</div>
                    <div className="dx-num text-[11px] mt-0.5">{fmtInt(p.swaps)}</div>
                  </div>
                </div>
                {/* FIX(Roast-70 · pol-truth): שורת-אמת-ה-LP — תשואת-עמלות-חיה ליחידת-LP, עמלות-שהוטבעו
                לספקי-הנזילות, וחלק-הנזילות-בבעלות-הפרוטוקול. הכל-חי-מה-API; בלי-נתון → '—' */}
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <div className="dx-raised p-2">
                    <div className="text-[9px] label-caps">תשואת-LP (lifetime)</div>
                    <div className="dx-num text-[11px] mt-0.5 text-[color:var(--green)]">
                      {p.lpYieldBps != null ? fmtBps(p.lpYieldBps) : '—'}
                    </div>
                  </div>
                  <div className="dx-raised p-2">
                    <div className="text-[9px] label-caps">עמלות-שהוטבעו ל-LP</div>
                    <div className="dx-num text-[11px] mt-0.5">{p.lpFeesMu != null ? `${fmtMu(p.lpFeesMu, 0)} µ` : '—'}</div>
                  </div>
                  <div className="dx-raised p-2">
                    <div className="text-[9px] label-caps">נזילות-בבעלות-פרוטוקול</div>
                    <div className={`dx-num text-[11px] mt-0.5 ${p.polShareBps != null && p.polShareBps > 5000 ? 'text-[color:var(--pink)]' : ''}`}>
                      {p.polShareBps != null ? fmtBps(p.polShareBps) : '—'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-[10px] text-[color:var(--text-3)] dx-num">
                    עמלות-אוצר שנצברו: {fmtMu(p.feeAccruedTreasury, 0)} µ
                    {myLp > 0 && <> · LP שלי: {fmtInt(myLp)}</>}
                  </span>
                  <button
                    onClick={() => setAddPool(p)}
                    className="dx-ghost px-4 h-8 text-xs flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" /> הוסף נזילות
                  </button>
                </div>
              </div>
            );
          })}
          {pools.length === 0 && (
            <div className="dx-card p-8 text-center md:col-span-2">
              <p className="text-sm text-[color:var(--text-2)]">אין בריכות פעילות כרגע</p>
            </div>
          )}
        </div>
      </div>

      {addPool && (
        <AddLiquidityModal pool={addPool} world={world} onClose={() => setAddPool(null)} onNeedAuth={onNeedAuth} onDone={onDone} />
      )}
      {rmPool && (
        <RemoveLiquidityModal pool={rmPool} world={world} onClose={() => setRmPool(null)} onNeedAuth={onNeedAuth} onDone={onDone} />
      )}
    </div>
  );
}

function AddLiquidityModal({ pool, world, onClose, onNeedAuth, onDone }: {
  pool: Pool; world: World | null; onClose: () => void; onNeedAuth: () => void; onDone: () => void;
}) {
  const [amountStr, setAmountStr] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const amountA = Math.floor(parseFloat(amountStr) * MU || 0);
  const ratio = pool.ra > 0 ? pool.rb / pool.ra : 0;
  const impliedB = amountA * ratio;
  const balA = world ? walletBal(world, 'operator', pool.a) : 0;
  const balB = world ? walletBal(world, 'operator', pool.b) : 0;

  async function submit() {
    if (amountA <= 0) return;
    setBusy(true);
    const j = await dxPost('pool', { action: 'add', pair: pool.key, amountA });
    if (j.ok) { setResult({ ok: true, text: 'הוגש — נזילות תיכנס בבלוק הבא' }); onDone(); setTimeout(onClose, 1600); }
    else {
      const e = String(j.error || '');
      setResult({ ok: false, text: e.includes('auth') || e.includes('unauthorized') ? 'נדרשת התחברות-בעלים' : (j.note || j.error || 'נכשל') });
      if (e.includes('auth') || e.includes('unauthorized')) onNeedAuth();
    }
    setBusy(false);
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="dx-card max-w-sm border-[color:var(--line)]" dir="rtl" data-testid="add-liquidity">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Plus className="w-4 h-4 text-[color:var(--pink)]" />
            הוספת נזילות · <span className="dx-num">{pool.key}</span>
          </DialogTitle>
        </DialogHeader>
        <label className="block">
          <span className="text-[11px] label-caps">כמות {pool.a} <span className="dx-num">(יתרה: {fmtMu(balA)})</span></span>
          <input
            dir="ltr" inputMode="decimal" placeholder="0.0" value={amountStr}
            onChange={e => setAmountStr(e.target.value.replace(/[^0-9.]/g, ''))}
            className="dx-num w-full mt-1 h-12 px-3 rounded-xl dx-raised text-left text-lg outline-none border border-[color:var(--line)] focus:border-[color:var(--line-strong)]"
            data-testid="add-amount"
          />
        </label>
        <div className="dx-raised p-3 text-xs space-y-1.5">
          <div className="flex justify-between">
            <span className="text-[color:var(--text-2)]">תתווסף גם</span>
            <span className="dx-num">{fmtMu(impliedB)} {pool.b} <span className="text-[color:var(--text-3)]">(יתרה: {fmtMu(balB)})</span></span>
          </div>
          <div className="flex justify-between">
            <span className="text-[color:var(--text-2)]">שער הבריכה</span>
            <span className="dx-num">1 {pool.a} = {fmtPrice(pool.mid)} {pool.b}</span>
          </div>
        </div>
        <p className="text-[10px] text-[color:var(--text-3)] flex items-start gap-1.5 leading-relaxed">
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          {/* FIX(Roast-65-e4 · F4): הוסרה הטענה-הקבועה "עמלות של 30bps" */}
          הנזילות נכנסת פרופורציונלית ליחס הבריכה החי. מתחיל לקבל 70% מהעמלות של הסוואג' הבא (השיעור-החי מוצג-בתג-הבריכה).
        </p>
        <button
          onClick={submit} disabled={busy || amountA <= 0 || amountA > balA}
          className="dx-cta w-full h-12 text-[15px]"
          data-testid="add-submit"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin-slow inline-block ml-2" />}
          {amountA > balA ? `יתרת ${pool.a} לא מספיקה` : 'אישור הוספה'}
        </button>
        {result && <p className={`text-[11px] text-center ${result.ok ? 'text-[color:var(--green)]' : 'text-[color:var(--red)]'}`}>{result.text}</p>}
      </DialogContent>
    </Dialog>
  );
}

function RemoveLiquidityModal({ pool, world, onClose, onNeedAuth, onDone }: {
  pool: Pool; world: World | null; onClose: () => void; onNeedAuth: () => void; onDone: () => void;
}) {
  const [pct, setPct] = useState(50);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const myLp = world ? walletBal(world, 'operator', `LP|${pool.key}`) : 0;
  const lpOut = Math.floor((myLp * pct) / 100);
  const share = pool.lp > 0 ? lpOut / pool.lp : 0;
  const outA = pool.ra * share;
  const outB = pool.rb * share;

  async function submit() {
    if (lpOut <= 0) return;
    setBusy(true);
    const j = await dxPost('pool', { action: 'remove', pair: pool.key, lp: lpOut });
    if (j.ok) { setResult({ ok: true, text: 'הוגש — הדילול יבוצע בבלוק הבא' }); onDone(); setTimeout(onClose, 1600); }
    else {
      const e = String(j.error || '');
      setResult({ ok: false, text: e.includes('auth') || e.includes('unauthorized') ? 'נדרשת התחברות-בעלים' : (j.note || j.error || 'נכשל') });
      if (e.includes('auth') || e.includes('unauthorized')) onNeedAuth();
    }
    setBusy(false);
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="dx-card max-w-sm border-[color:var(--line)]" dir="rtl" data-testid="remove-liquidity">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Minus className="w-4 h-4 text-[color:var(--red)]" />
            דילול נזילות · <span className="dx-num">{pool.key}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-between text-sm font-semibold">
          <span>חלק לדלל</span>
          <span className="dx-num text-[color:var(--pink)]">{pct}%</span>
        </div>
        <input
          type="range" min={1} max={100} value={pct} onChange={e => setPct(Number(e.target.value))}
          className="w-full accent-[color:var(--pink)]"
          data-testid="remove-slider"
        />
        <div className="dx-raised p-3 text-xs space-y-1.5">
          <div className="flex justify-between"><span className="text-[color:var(--text-2)]">יחידות LP</span><span className="dx-num">{fmtInt(lpOut)} / {fmtInt(myLp)}</span></div>
          <div className="flex justify-between"><span className="text-[color:var(--text-2)]">תקבל ≈</span><span className="dx-num">{fmtMu(outA)} {pool.a} + {fmtMu(outB)} {pool.b}</span></div>
        </div>
        <p className="text-[10px] text-[color:var(--text-3)] leading-relaxed">
          דילול pro-rata: אתה מקבל חלק יחסי משתי השמורות בדיוק.
        </p>
        <button onClick={submit} disabled={busy || lpOut <= 0} className="dx-cta w-full h-12 text-[15px]" data-testid="remove-submit">
          {busy && <Loader2 className="w-4 h-4 animate-spin-slow inline-block ml-2" />}
          אישור דילול
        </button>
        {result && <p className={`text-[11px] text-center ${result.ok ? 'text-[color:var(--green)]' : 'text-[color:var(--red)]'}`}>{result.text}</p>}
      </DialogContent>
    </Dialog>
  );
}
