'use client';

// ─── דלת-המטבעות · Door — פקדות TRX/SOL אמת → עוגנים מגובים → סוואפ חי ──
// Task 72 · THE-COIN-DOOR: זהויות-פקדה ריבוניות (נגזרות מהזרע) · אימות-פקדה
// מול-RPC ציבורי · הטבעה-מגובה-אטומית · בריכות-אורקל (מחיר-שוק-אמת-חי) ·
// פדיון גלוי. הכל על הרשת הריבונית — אפס-בורסה-חוץ.

import { useCallback, useEffect, useState } from 'react';
import {
  DoorOpen, Loader2, Copy, Check, ArrowDownToLine, ArrowUpFromLine,
  ShieldCheck, RefreshCw, Droplets, ExternalLink,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { usePoll, dxPost, TokenMedallion, fmtInt, fmtAgoMs } from './common';

// ── engine contract (mirror of /api/dex/door) ──
type PegRow = {
  asset: 'WTRX' | 'WSOL';
  oracleMu: number | null; oracleAtH: number | null; oracleSrc: string | null;
  backingMu: number; extClaimMu: number;
  pool: { key: string; ra: number; rb: number; midMu: number | null } | null;
  spreadBps: number | null;
  verdict: 'NO-POOL' | 'NO-ORACLE' | 'CONVERGED' | 'DRIFT' | 'DIVERGENT' | null;
};
type DoorReport = {
  ok: boolean;
  at: string;
  identities: { tron: string | null; sol: string | null; evm: string | null; note: string };
  custody: { tronSun: number | null; solLamports: number | null; evmWei: number | null; at: number; note: string };
  anchors: {
    tron: { haveSun: number | null; needSun: number; gapSun: number | null; note: string };
    sol: { haveLamports: number | null; needLamports: number; gapLamports: number | null; note: string };
  };
  peg: PegRow[];
  outboundNote: string;
  journal: { h: number; action: string; note: string }[];
  error?: string;
};

const fmtUsd = (mu: number): string => {
  const v = mu / 1e6;
  return v >= 1 ? `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : `$${v.toFixed(4)}`;
};
const verdictStyle: Record<string, string> = {
  CONVERGED: 'text-[color:var(--green)]',
  DRIFT: 'text-[color:var(--amber)]',
  DIVERGENT: 'text-[color:var(--red)]',
  'NO-POOL': 'text-[color:var(--text-3)]',
  'NO-ORACLE': 'text-[color:var(--text-3)]',
};
const verdictLabel: Record<string, string> = {
  CONVERGED: 'מתכנס-לאורקל',
  DRIFT: 'סטייה',
  DIVERGENT: 'סטייה-גדולה',
  'NO-POOL': 'אין-בריכה',
  'NO-ORACLE': 'אין-אורקל',
};

export function DoorView({ onNeedAuth, onNavigate, onDone }: {
  onNeedAuth: () => void; onNavigate: (v: 'swap') => void; onDone: () => void;
}) {
  const [rep, setRep] = useState<DoorReport | null>(null);
  const [txid, setTxid] = useState('');
  const [chain, setChain] = useState<'trx' | 'sol'>('trx');
  const [outAsset, setOutAsset] = useState<'WTRX' | 'WSOL'>('WTRX');
  const [outAmount, setOutAmount] = useState('');
  const [outDest, setOutDest] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const r = await fetch('/saos-dex/api/dex/door', { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      const j = (await r.json()) as DoorReport;
      if (j.ok) { setRep(j); return true; }
      return false;
    } catch { return false; }
  }, []);
  const stale = usePoll(refresh, 15000);

  useEffect(() => { void refresh(); }, [refresh]);

  function copy(addr: string) {
    navigator.clipboard.writeText(addr);
    setCopied(addr);
    setTimeout(() => setCopied(null), 1600);
  }

  async function act(action: string, payload: Record<string, unknown>) {
    // קריאת-ההרשאה: לא-מחובר → דיאלוג-ההתחברות נפתח; מוטציות-הדלת נשארות
    // fail-closed במנוע (x-saos-operator) — הגשר מחזיר 401-כנה וההודעה מוצגת.
    onNeedAuth();
    setBusy(true); setMsg(null);
    const r = await dxPost('door', { action, ...payload });
    setMsg({ ok: !!r.ok, text: String(r.note || r.error || (r.ok ? 'התקבל' : 'נכשל')) });
    setBusy(false);
    await refresh();
    onDone();
  }

  const trxPeg = rep?.peg.find(p => p.asset === 'WTRX');
  const solPeg = rep?.peg.find(p => p.asset === 'WSOL');

  return (
    <div className="max-w-5xl mx-auto space-y-5 pb-6" data-testid="door-view">
      {/* header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <DoorOpen className="w-5 h-5 text-[color:var(--pink)]" />
            דלת-המטבעות — פקדה · אורקל · סוואפ
          </h2>
          <p className="text-[11px] text-[color:var(--text-3)] mt-1 leading-relaxed max-w-2xl">
            שלח TRX/SOL אמת לכתובת-הפקדה הריבונית → הפקדה מאומתת מול-RPC ציבורי → עוגן מגובה 1:1 על השרשרת
            → בריכה במחיר-שוק-אמת-חי → סוואפ. הכול על הרשת שלנו, אפס-בורסה-חוץ.
          </p>
        </div>
        <button
          onClick={() => void act('refresh-oracle', {})}
          disabled={busy}
          className="dx-chip h-9 px-3 text-[11px] flex items-center gap-1.5 disabled:opacity-50"
          data-testid="refresh-oracle"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} /> רענן-אורקל
        </button>
      </div>

      {stale && (
        <div className="dx-chip px-3 py-1.5 text-[10.5px] text-[color:var(--amber)] w-fit" role="status">
          נתוני-הדלת ישנים — הרענון נכשל זמנית
        </div>
      )}

      {/* oracle truth strip */}
      <div className="dx-card p-4" data-testid="oracle-strip">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-[color:var(--green)]" />
          <span className="text-sm font-semibold">נתון-שוק-אמת-חי (אורקל קנוני — בתוך stateRoot)</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {rep?.peg.map(p => (
            <div key={p.asset} className="dx-raised p-2.5" data-testid={`oracle-${p.asset}`}>
              <div className="flex items-center gap-1.5 mb-1">
                <TokenMedallion sym={p.asset} size={18} />
                <span className="text-[10px] font-semibold">{p.asset.replace('W', '')}</span>
              </div>
              <div className="dx-num text-sm font-bold" dir="ltr">{p.oracleMu != null ? fmtUsd(p.oracleMu) : '—'}</div>
              <div className={`text-[9px] mt-0.5 ${verdictStyle[p.verdict ?? ''] ?? ''}`}>
                {p.oracleMu != null ? `${p.oracleSrc ?? ''}` : 'ממתין לפיד'}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* deposit identities */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {[
          { key: 'trx', label: 'TRX (Tron)', addr: rep?.identities.tron ?? null, unit: 'TRX',
            have: rep?.custody.tronSun != null ? (rep.custody.tronSun / 1e6) : null,
            gapVal: rep?.anchors.tron.gapSun != null ? rep.anchors.tron.gapSun / 1e6 : null,
            gapNote: rep?.anchors.tron.note, testid: 'deposit-trx' },
          { key: 'sol', label: 'SOL (Solana)', addr: rep?.identities.sol ?? null, unit: 'SOL',
            have: rep?.custody.solLamports != null ? (rep.custody.solLamports / 1e9) : null,
            gapVal: rep?.anchors.sol.gapLamports != null ? rep.anchors.sol.gapLamports / 1e9 : null,
            gapNote: rep?.anchors.sol.note, testid: 'deposit-sol' },
          { key: 'eth', label: 'ETH (Ethereum)', addr: rep?.identities.evm ?? null, unit: 'ETH',
            have: rep?.custody.evmWei != null ? (rep.custody.evmWei / 1e18) : null,
            gapVal: null, gapNote: 'roast-76: הצי-רוכז אל כתובת-זו (10-txids) — אין-רצפת-שכרות; המשמורת היא דלק-העיגון-עצמו (EIP-1559)', testid: 'deposit-eth' },
        ].map(d => (
          <div key={d.key} className="dx-card p-4" data-testid={d.testid}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold flex items-center gap-2">
                <ArrowDownToLine className="w-4 h-4 text-[color:var(--green)]" /> כתובת-פקדה · {d.label}
              </span>
              {d.have != null && (
                <span className="dx-chip px-2 py-0.5 text-[10px]" dir="ltr">
                  custody {d.have.toLocaleString('en-US', { maximumFractionDigits: 6 })} {d.unit}
                </span>
              )}
            </div>
            {d.addr ? (
              <div className="flex gap-2">
                <Input readOnly value={d.addr} dir="ltr" data-testid={`${d.testid}-addr`}
                  className="bg-[color:var(--raised)] border-[color:var(--line)] font-data text-[11px]" />
                <button onClick={() => copy(d.addr!)} aria-label="העתק כתובת"
                  className="w-10 h-10 shrink-0 rounded-lg dx-chip flex items-center justify-center hover:text-[color:var(--text-1)] transition-colors">
                  {copied === d.addr ? <Check className="w-4 h-4 text-[color:var(--green)]" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            ) : (
              <p className="text-xs text-[color:var(--text-3)]">זהות-הפקדה לא זמינה בסביבה (fail-closed)</p>
            )}
            {d.gapVal != null && d.gapVal > 0 && (
              <p className="text-[10px] text-[color:var(--amber)] mt-2">
                עיגון-הרשת זקוק-לדלק: חסרים {d.gapVal.toFixed(6)} {d.unit} מעל-יתרת-המשמורת ({d.gapNote})
              </p>
            )}
          </div>
        ))}
      </div>

      {/* peg-in form */}
      <div className="dx-card p-4" data-testid="peg-in">
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
          <ArrowDownToLine className="w-4 h-4 text-[color:var(--pink)]" /> אימות-פקדה — הטבעת-עוגן מגובה 1:1
        </h3>
        <p className="text-[10.5px] text-[color:var(--text-3)] mb-3 leading-relaxed">
          שלח את המטבע לכתובת-הפקדה, העתק את ה-txid מהאקספלורר (tronscan / solscan) והדבק כאן.
          האימות נעשה מול-RPC-ציבורי בלבד; ההטבעה אטומית (wrap_mint external + תביעה-חד-פעמית בגרעין).
          1 TRX = 1,000µ WTRX · 1 SOL = 1,000µ WSOL.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-[110px_1fr_auto] gap-2">
          <select value={chain} onChange={e => setChain(e.target.value as 'trx' | 'sol')} aria-label="רשת-הפקדה"
            className="dx-chip h-10 px-3 text-xs bg-transparent outline-none">
            <option value="trx">TRX · Tron</option>
            <option value="sol">SOL · Solana</option>
          </select>
          <Input value={txid} onChange={e => setTxid(e.target.value)} dir="ltr" placeholder="txid מהאקספלורר…"
            data-testid="peg-in-txid" className="bg-[color:var(--raised)] border-[color:var(--line)] font-data text-[11px]" />
          <button onClick={() => void act('peg-in', { chain, txid })} disabled={busy || !txid}
            className="dx-cta h-10 px-4 text-[12px] flex items-center justify-center gap-1.5 disabled:opacity-50"
            data-testid="peg-in-submit">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            אמת-והטבע
          </button>
        </div>
      </div>

      {/* peg pools — live market */}
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
          <Droplets className="w-4 h-4 text-[color:var(--pink)]" /> בריכות-הדלת — מחיר-בריכה מול-שוק-אמת
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[trxPeg, solPeg].map(p => p && (
            <div key={p.asset} className="dx-card p-4" data-testid={`peg-pool-${p.asset}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex -space-x-2" dir="ltr">
                    <TokenMedallion sym={p.asset} size={26} />
                    <TokenMedallion sym="USDS" size={26} />
                  </span>
                  <span className="font-semibold dx-num text-sm">USDS/{p.asset}</span>
                </div>
                <span className={`text-[10px] font-semibold ${verdictStyle[p.verdict ?? ''] ?? ''}`}>
                  {verdictLabel[p.verdict ?? ''] ?? ''}
                  {p.spreadBps != null ? ` · ${(p.spreadBps / 100).toFixed(2)}%` : ''}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                <div className="dx-raised p-2.5">
                  <div className="label-caps text-[10px]">מחיר-שוק-חי</div>
                  <div className="dx-num mt-0.5" dir="ltr">{p.oracleMu != null ? fmtUsd(p.oracleMu) : '—'}</div>
                </div>
                <div className="dx-raised p-2.5">
                  <div className="label-caps text-[10px]">מחיר-בריכה</div>
                  <div className="dx-num mt-0.5" dir="ltr">{p.pool?.midMu ? fmtUsd(p.pool.midMu) : '—'}</div>
                </div>
                <div className="dx-raised p-2.5">
                  <div className="label-caps text-[10px]">גיבוי-מוטבע</div>
                  <div className="dx-num mt-0.5" dir="ltr">{fmtInt(p.backingMu)}µ</div>
                </div>
              </div>
              <p className="text-[10px] text-[color:var(--text-3)] mt-2">
                {p.oracleAtH != null ? `אורקל עודכן בגובה ${fmtInt(p.oracleAtH)}` : 'האורקל ממתין לפיד-הראשון (עד-דקה)'} · גיבוי-פיזי בכתובת-הפקדה
              </p>
              <div className="flex gap-2 mt-3">
                {p.pool ? (
                  <button onClick={() => onNavigate('swap')}
                    className="dx-cta h-9 px-4 text-[12px] flex items-center gap-1.5" data-testid={`swap-${p.asset}`}>
                    סוואפ {p.asset.replace('W', '')} ⇄ USDS <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <button onClick={() => void act('open-pool', { peg: p.asset })} disabled={busy}
                    className="dx-cta h-9 px-4 text-[12px] flex items-center gap-1.5 disabled:opacity-50"
                    data-testid={`open-pool-${p.asset}`}>
                    <Droplets className="w-3.5 h-3.5" /> פתח-בריכה במחיר-אורקל
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* peg-out */}
      <div className="dx-card p-4" data-testid="peg-out">
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
          <ArrowUpFromLine className="w-4 h-4 text-[color:var(--amber)]" /> פדיון — הפרדה-ל-outbox
        </h3>
        <p className="text-[10.5px] text-[color:var(--text-3)] mb-3 leading-relaxed">{rep?.outboundNote}</p>
        <div className="grid grid-cols-1 sm:grid-cols-[110px_120px_1fr_auto] gap-2">
          <select value={outAsset} onChange={e => setOutAsset(e.target.value as 'WTRX' | 'WSOL')} aria-label="נכס-פדיון"
            className="dx-chip h-10 px-3 text-xs bg-transparent outline-none">
            <option value="WTRX">WTRX</option>
            <option value="WSOL">WSOL</option>
          </select>
          <Input value={outAmount} onChange={e => setOutAmount(e.target.value)} dir="ltr" placeholder="µ (שלמים)"
            data-testid="peg-out-amount" className="bg-[color:var(--raised)] border-[color:var(--line)] font-data text-[11px]" />
          <Input value={outDest} onChange={e => setOutDest(e.target.value)} dir="ltr" placeholder="כתובת-יעד-חוץ"
            data-testid="peg-out-dest" className="bg-[color:var(--raised)] border-[color:var(--line)] font-data text-[11px]" />
          <button onClick={() => void act('peg-out', { asset: outAsset, amount: Math.floor(Number(outAmount) || 0), dest: outDest })}
            disabled={busy || !outAmount || !outDest}
            className="dx-cta h-10 px-4 text-[12px] flex items-center justify-center gap-1.5 disabled:opacity-50"
            data-testid="peg-out-submit">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpFromLine className="w-4 h-4" />} פדה
          </button>
        </div>
      </div>

      {/* feedback */}
      {msg && (
        <div className={`dx-chip px-3 py-2 text-[11px] w-fit max-w-full break-words ${msg.ok ? 'text-[color:var(--green)]' : 'text-[color:var(--red)]'}`}
          role="status" data-testid="door-msg">
          {msg.text}
        </div>
      )}

      {/* door journal */}
      <div className="dx-card p-4" data-testid="door-journal">
        <h3 className="text-sm font-semibold mb-3">יומן-הדלת (עדות-חיה מהג'ורנל-הקנוני)</h3>
        {(rep?.journal?.length ?? 0) === 0 ? (
          <p className="text-xs text-[color:var(--text-3)]">עדיין-שקט — הפקדה-הראשונה תירשם כאן עם גובה-הבלוק שלה.</p>
        ) : (
          <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
            {rep!.journal.map((j, i) => (
              <div key={`${j.h}-${i}`} className="dx-raised px-3 py-2 flex items-center gap-3 text-[11px]">
                <span className="dx-num text-[color:var(--text-3)] shrink-0" dir="ltr">#{fmtInt(j.h)}</span>
                <span className="dx-chip px-1.5 py-0.5 text-[9px] shrink-0">{j.action}</span>
                <span className="text-[color:var(--text-2)] break-all">{j.note}</span>
              </div>
            ))}
          </div>
        )}
        {rep && (
          <p className="text-[10px] text-[color:var(--text-3)] mt-2" dir="ltr">
            custody probed {fmtAgoMs(Date.now() - rep.custody.at)} · {rep.identities.note}
          </p>
        )}
      </div>
    </div>
  );
}
