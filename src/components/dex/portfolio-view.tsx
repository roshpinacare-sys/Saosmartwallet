'use client';

// ─── תיק · Portfolio — שווי חי, ארנקים, העברות ─────────────────────────────
// שווי-ייחוס לפי מחירי-האוצר החיים (state.assets) · LP valuations ·
// שני-ספרים כנים · העברה-חופשית מוגבלת-תקרה.

import { useMemo, useState } from 'react';
import { Wallet, Send, Loader2, Layers } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  TokenMedallion, fmtMu, fmtInt, dxPost, type World, DEX_ASSETS, TOKEN_META, MU,
} from './common';

const WALLET_LABELS: Record<string, string> = {
  operator: 'המפעיל (אתה)',
  treasury: 'האוצר הריבוני',
  arena: 'ארנת עשיית-השוק',
  'portfolio-b': 'תיק ב׳',
};

export function PortfolioView({ world, onNeedAuth, onDone }: {
  world: World | null; onNeedAuth: () => void; onDone: () => void;
}) {
  const [transferOpen, setTransferOpen] = useState(false);

  // מחירי-ייחוס חיים (µ ליחידה) — מה-state של המנוע
  const refPrices = useMemo(() => {
    const out: Record<string, number> = { USDS: 1000 };
    const assets = world?.state.assets as Record<string, { refPrice?: number }> | undefined;
    if (assets) for (const [k, v] of Object.entries(assets)) if (v?.refPrice) out[k] = v.refPrice;
    return out;
  }, [world]);

  const wallets = world?.wallets ?? [];

  const operator = wallets.find(w => w.name === 'operator');
  const myTotalMu = useMemo(() => {
    if (!operator) return 0;
    let sum = 0;
    for (const [asset, bal] of Object.entries(operator.balances)) {
      if (asset.startsWith('LP|')) continue;
      const rp = refPrices[asset];
      if (rp) sum += bal * (rp / MU);
    }
    return Math.floor(sum);
  }, [operator, refPrices]);

  const lpLines = useMemo(() => {
    if (!operator) return [];
    return Object.entries(operator.balances).filter(([k]) => k.startsWith('LP|'));
  }, [operator]);

  return (
    <div className="max-w-5xl mx-auto space-y-4 pb-6" data-testid="portfolio-view">
      {/* hero */}
      <div className="dx-card p-5 md:p-6" data-testid="portfolio-hero">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="text-xs label-caps mb-1.5">שווי התיק שלי · מחירי-ייחוס אוצר חיים</div>
            <div className="dx-num text-4xl font-bold tracking-tight" data-testid="portfolio-total">
              {fmtInt(myTotalMu / MU)} <span className="text-lg text-[color:var(--text-2)]">USDS</span>
            </div>
            <div className="text-[11px] text-[color:var(--text-3)] mt-1.5">
              ארנק operator · גובה שרשרת <span className="dx-num">{world ? fmtInt(world.state.height) : '—'}</span> · שווי-LP נפרד למטה
            </div>
          </div>
          <button onClick={() => setTransferOpen(true)} className="dx-cta h-10 px-5 text-sm flex items-center gap-2">
            <Send className="w-4 h-4" /> העברה פנימית
          </button>
        </div>

        {/* my assets grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mt-5" data-testid="asset-grid">
          {DEX_ASSETS.map(a => {
            const bal = operator?.balances[a] ?? 0;
            const rp = refPrices[a];
            const val = rp ? (bal * (rp / MU)) / MU : null;
            return (
              <div key={a} className="dx-raised p-3">
                <div className="flex items-center gap-2">
                  <TokenMedallion sym={a} size={22} />
                  <span className="text-xs font-semibold">{a}</span>
                </div>
                <div className="dx-num text-sm mt-2">{fmtMu(bal)}</div>
                <div className="text-[10px] text-[color:var(--text-3)] dx-num">
                  {val !== null ? `≈ ${fmtInt(val)} USDS` : TOKEN_META[a]?.name}
                </div>
              </div>
            );
          })}
        </div>

        {lpLines.length > 0 && (
          <div className="dx-raised p-3 mt-3 flex items-center gap-2 flex-wrap" data-testid="lp-lines">
            <Layers className="w-3.5 h-3.5 text-[color:var(--pink)]" />
            <span className="text-[11px] text-[color:var(--text-2)]">עמדות LP:</span>
            {lpLines.map(([k, v]) => (
              <span key={k} className="dx-chip px-2 py-0.5 text-[10px] dx-num">{k.slice(3)}: {fmtInt(v)}</span>
            ))}
          </div>
        )}
      </div>

      {/* all wallets — transparency */}
      <div className="dx-card p-4 md:p-5" data-testid="wallets-table">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Wallet className="w-4 h-4 text-[color:var(--pink)]" />
            ספרי-המערכת · שקיפות מלאה
          </h2>
          <span className="text-[10px] text-[color:var(--text-3)]">{wallets.length} ארנקים חיים</span>
        </div>
        <div className="space-y-2 max-h-[420px] overflow-y-auto">
          {wallets.map(w => (
            <div key={w.name} className="dx-raised p-3">
              <div className="flex items-center justify-between flex-wrap gap-1">
                <span className="text-xs font-semibold">{WALLET_LABELS[w.name] || w.name}</span>
                <span className="text-[10px] text-[color:var(--text-3)] dx-num">credits {fmtInt(w.credits)}</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5" dir="ltr">
                {Object.entries(w.balances).filter(([, v]) => v > 0).map(([a, v]) => (
                  <span key={a} className="text-[11px] dx-num text-[color:var(--text-2)]">
                    <span className="text-[color:var(--text-1)]">{fmtMu(v)}</span> {a.startsWith('LP|') ? a : ''}
                    {!a.startsWith('LP|') && a}
                  </span>
                ))}
              </div>
              {Object.values(w.locked).some(v => v > 0) && (
                <div className="text-[10px] text-[color:var(--amber)] dx-num mt-1" dir="ltr">
                  locked: {Object.entries(w.locked).filter(([, v]) => v > 0).map(([a, v]) => `${fmtMu(v)} ${a}`).join(' · ')}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {transferOpen && (
        <TransferModal world={world} onClose={() => setTransferOpen(false)} onNeedAuth={onNeedAuth} onDone={onDone} />
      )}
    </div>
  );
}

function TransferModal({ world, onClose, onNeedAuth, onDone }: {
  world: World | null; onClose: () => void; onNeedAuth: () => void; onDone: () => void;
}) {
  const [to, setTo] = useState('');
  const [asset, setAsset] = useState('USDS');
  const [amountStr, setAmountStr] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const amountMu = Math.floor((parseFloat(amountStr) || 0) * MU);
  const bal = world?.wallets.find(w => w.name === 'operator')?.balances[asset] ?? 0;

  async function submit() {
    if (!/^[a-z0-9-]+$/.test(to) || amountMu <= 0) {
      setResult({ ok: false, text: 'כתובת יעד [a-z0-9-] וסכום תקין נדרשים' });
      return;
    }
    setBusy(true);
    const j = await dxPost('transfer', { from: 'operator', to, asset, amountMu });
    if (j.ok) { setResult({ ok: true, text: 'הוגש — תיכלל בבלוק הבא' }); onDone(); setTimeout(onClose, 1500); }
    else {
      const e = String(j.error || '');
      setResult({ ok: false, text: e.includes('auth') || e.includes('unauthorized') ? 'נדרשת התחברות-בעלים' : (j.note || j.error || 'נכשל') });
      if (e.includes('auth') || e.includes('unauthorized')) onNeedAuth();
    }
    setBusy(false);
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="dx-card max-w-sm border-[color:var(--line)]" dir="rtl">
        <DialogHeader><DialogTitle className="text-base">העברה פנימית (גז 0)</DialogTitle></DialogHeader>
        <label className="block">
          <span className="text-[11px] label-caps">ארנק יעד</span>
          <input
            dir="ltr" value={to} onChange={e => setTo(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            placeholder="portfolio-b" className="dx-num w-full mt-1 h-11 px-3 rounded-xl dx-raised text-left outline-none border border-[color:var(--line)] focus:border-[color:var(--line-strong)]"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[11px] label-caps">מטבע</span>
            <select
              value={asset} onChange={e => setAsset(e.target.value)}
              className="dx-num w-full mt-1 h-11 px-2 rounded-xl dx-raised outline-none border border-[color:var(--line)] bg-[color:var(--raised)] text-sm"
            >
              {DEX_ASSETS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] label-caps">סכום <span className="dx-num">(יתרה {fmtMu(bal)})</span></span>
            <input
              dir="ltr" inputMode="decimal" value={amountStr}
              onChange={e => setAmountStr(e.target.value.replace(/[^0-9.]/g, ''))}
              className="dx-num w-full mt-1 h-11 px-3 rounded-xl dx-raised text-left outline-none border border-[color:var(--line)] focus:border-[color:var(--line-strong)]"
            />
          </label>
        </div>
        <p className="text-[10px] text-[color:var(--text-3)] leading-relaxed">
          העברה-חופשית בתוך המערכת — מוגבלת בתקרה פר-פקודה, נכללת בבלוק הבא ובפנקס המרקל.
        </p>
        <button onClick={submit} disabled={busy} className="dx-cta w-full h-12 text-[15px]">
          {busy && <Loader2 className="w-4 h-4 animate-spin-slow inline-block ml-2" />}
          שליחה
        </button>
        {result && <p className={`text-[11px] text-center ${result.ok ? 'text-[color:var(--green)]' : 'text-[color:var(--red)]'}`}>{result.text}</p>}
      </DialogContent>
    </Dialog>
  );
}
