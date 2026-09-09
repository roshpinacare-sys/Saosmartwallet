'use client';

// ─── EconomyView — הכלכלה המטורפת: veSAOS · Revenue-Router · Bonds · עמלים-דינמיים
// כל-הנתונים חיים מהמנוע: /saos-dex/api/dex/economy · מוטציות דרך /api/dx (economy)

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Lock, Flame, Vote, TrendingDown, Percent, Clock, Wallet,
  ShieldCheck, Sparkles, Loader2,
} from 'lucide-react';
import { authHeaders } from '@/components/sv/shared';
import { fmtInt } from './common';

interface EconomyData {
  ok: boolean;
  height: number;
  epoch: { index: number; blocksLeft: number; every: number };
  ve: {
    totalPoints: number; vaultMu: number; potMu: number;
    positions: Array<{ who: string; amtMu: number; unlockH: number; weeks: number; vePoints: number; locked: boolean }>;
    votes: Array<{ who: string; pool: string; weight: number }>;
    maxWeeks: number; minWeeks: number;
  };
  revenue: {
    lastH: number; cycles: number; burnedMu: number; vePaidMu: number;
    burnedSaosMu: number; treasuryProfitMu: number;
    every: number; blocksLeft: number; burnPct: number; vePct: number; treasuryPct: number;
    saosSupplyMu: number;
  };
  bonds: {
    soldSaosMu: number; usdsInMu: number; count: number;
    discBps: number; veWeeks: number; minUsds: number; maxUsds: number;
    refPrice: number; bondPrice: number;
  };
  dynamicFees: Array<{ key: string; a: string; b: string; feeBps: number; volBpsEwma: number; swaps: number }>;
}

export function EconomyView({ onNeedAuth, onDone }: {
  onNeedAuth: () => boolean;
  onDone: () => void;
}) {
  const [eco, setEco] = useState<EconomyData | null>(null);
  const [lockAmt, setLockAmt] = useState('500');
  const [weeks, setWeeks] = useState(52);
  const [bondAmt, setBondAmt] = useState('1000');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const r = await fetch('/saos-dex/api/dex/economy', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        const j = (await r.json()) as EconomyData;
        if (aliveRef.current && j.ok) setEco(j);
      } catch { /* offline */ }
      if (aliveRef.current && !stop) timer = setTimeout(poll, 3000);
    };
    poll();
    return () => { aliveRef.current = false; stop = true; clearTimeout(timer); };
  }, []);

  const mutate = useCallback(async (payload: Record<string, unknown>, tag: string) => {
    if (!onNeedAuth()) return;
    setBusy(tag); setMsg(null);
    try {
      const r = await fetch('/api/dx', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ action: 'economy', payload }),
      });
      const j = await r.json();
      setMsg(j.ok
        ? { ok: true, text: 'נשלח לממפול — ייכלל בבלוק הבא (≤3 שניות)' }
        : { ok: false, text: j.error || j.note || 'הפעולה נדחתה' });
      if (j.ok) onDone();
    } catch {
      setMsg({ ok: false, text: 'שגיאת רשת — נסה שוב' });
    }
    setBusy(null);
  }, [onNeedAuth, onDone]);

  const price = eco?.bonds.refPrice ?? 0;
  const bondPrice = eco?.bonds.bondPrice ?? 0;
  const saosOut = price > 0 && Number(bondAmt) > 0
    ? Math.floor((Number(bondAmt) * 1000 * 10000) / (price * (10000 - (eco?.bonds.discBps ?? 300))))
    : 0;

  return (
    <div className="space-y-5" data-testid="economy-view">
      {/* hero */}
      <div className="dx-card p-5 md:p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] text-[color:var(--text-3)] mb-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[color:var(--pink)]" />
              הכלכלה הריבונית · ve(3,3) + Buy-&amp;-Burn + Bonds + עמלים-דינמיים
            </div>
            <h1 className="text-xl md:text-2xl font-extrabold tracking-tight">כלכלה שעובדת בשבילך</h1>
            <p className="text-[12.5px] text-[color:var(--text-2)] mt-1.5 max-w-xl leading-relaxed">
              נעל SAOS → הצבע לבריכות → קבל נתח מקרן התגמולים. כל מחזור האוצר קונה SAOS
              מהשוק החי ושורף אותו — ההיצע רק יורד. כמו Aerodrome ו-Hyperliquid, על הרשת שלנו.
            </p>
          </div>
          <div className="flex gap-2.5 flex-wrap" data-testid="economy-hero-stats">
            <Stat label="אפוק" value={`#${eco?.epoch.index ?? 0}`} sub={`${eco?.epoch.blocksLeft ?? 0} בלוקים`} icon={<Clock className="w-3.5 h-3.5" />} />
            <Stat label="שרוף לנצח" value={`${fmtInt(eco?.revenue.burnedSaosMu ?? 0)}µ`} sub="SAOS מההיצע" icon={<Flame className="w-3.5 h-3.5" />} tone="pink" />
            <Stat label="כוח-ve כולל" value={fmtInt(eco?.ve.totalPoints ?? 0)} sub="veSAOS פעיל" icon={<Vote className="w-3.5 h-3.5" />} />
          </div>
        </div>
        {msg && (
          <div className={`mt-4 text-xs rounded-lg px-3 py-2 border ${msg.ok ? 'bg-[color:var(--green-soft)] text-[color:var(--green)] border-[color:var(--green)]/30' : 'bg-rose-950/40 text-rose-300 border-rose-900/60'}`} role="status" data-testid="economy-msg">
            {msg.text}
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* ── veSAOS ── */}
        <section className="dx-card p-5" data-testid="ve-panel">
          <header className="flex items-center gap-2 mb-4">
            <span className="w-8 h-8 rounded-xl bg-[color:var(--green-soft)] border border-[color:var(--green)]/30 flex items-center justify-center">
              <Lock className="w-4 h-4 text-[color:var(--green)]" />
            </span>
            <div>
              <h2 className="text-[15px] font-bold">veSAOS — הצבע-ותשואה</h2>
              <p className="text-[11px] text-[color:var(--text-3)]">Aerodrome ve(3,3): מצביעים מקבלים את קרן-התגמולים בכל אפוק</p>
            </div>
          </header>

          <div className="grid grid-cols-3 gap-2 mb-4 text-center">
            <MiniStat label="כספת-ve" value={`${fmtInt(eco?.ve.vaultMu ?? 0)}µ`} />
            <MiniStat label="קרן-תגמולים" value={`${fmtInt(eco?.ve.potMu ?? 0)}µ`} tone="green" />
            <MiniStat label="אפוק-כל" value={`${eco?.epoch.every ?? 0} בלוקים`} />
          </div>

          {/* my position */}
          {eco && eco.ve.positions.length > 0 && (
            <div className="rounded-xl border border-[color:var(--line)] bg-black/20 p-3 mb-4" data-testid="my-ve-position">
              <div className="text-[10px] text-[color:var(--text-3)] mb-2">העמדות שלי (operator)</div>
              {eco.ve.positions.slice(0, 3).map(p => (
                <div key={p.who} className="flex items-center justify-between text-[11.5px] py-1">
                  <span className="dx-num" dir="ltr">{fmtInt(p.amtMu)}µ SAOS × {p.weeks}w</span>
                  <span className="flex items-center gap-2">
                    <span className="dx-num text-[color:var(--text-2)]" dir="ltr">ve {fmtInt(p.vePoints)}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-md ${p.locked ? 'bg-[color:var(--green-soft)] text-[color:var(--green)]' : 'bg-amber-950/50 text-amber-400'}`}>
                      {p.locked ? `נעול עד #${fmtInt(p.unlockH)}` : 'פנוי לפריקה'}
                    </span>
                    {!p.locked && (
                      <button onClick={() => mutate({ action: 've_unlock' }, 'unlock')} disabled={busy !== null}
                        className="text-[10px] text-[color:var(--pink)] hover:underline">פרוק</button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* lock form */}
          <div className="space-y-3">
            <div className="flex gap-2">
              <input value={lockAmt} onChange={e => setLockAmt(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric"
                className="dx-input font-data h-10 flex-1" dir="ltr" placeholder="כמות SAOS" aria-label="כמות לנעילה" data-testid="ve-amount" />
              <button
                onClick={() => mutate({ action: 've_lock', amount: Number(lockAmt) * 1000, weeks }, 'lock')}
                disabled={busy !== null || !(Number(lockAmt) > 0)}
                className="dx-cta h-10 px-4 text-[12px] flex items-center gap-1.5 shrink-0"
                data-testid="ve-lock-btn"
              >
                {busy === 'lock' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />} נעל
              </button>
            </div>
            <div>
              <div className="flex justify-between text-[10.5px] text-[color:var(--text-3)] mb-1">
                <span>תקופת-נעילה: <span className="dx-num font-semibold text-[color:var(--text-1)]">{weeks} שבועות</span></span>
                <span dir="ltr">{(weeks / 52).toFixed(2)}y · ve = {(weeks / (eco?.ve.maxWeeks || 208) * 100).toFixed(1)}%</span>
              </div>
              <input type="range" min={1} max={eco?.ve.maxWeeks ?? 208} value={weeks} onChange={e => setWeeks(Number(e.target.value))}
                className="w-full accent-[color:var(--pink)]" aria-label="תקופת נעילה בשבועות" data-testid="ve-weeks-slider" />
              <div className="flex justify-between text-[9.5px] text-[color:var(--text-3)]"><span>1w</span><span>4y (מקסימום כוח)</span></div>
            </div>
            <button
              onClick={() => mutate({ action: 've_vote', pair: 'SAOS/USDS' }, 'vote')}
              disabled={busy !== null}
              className="w-full h-10 rounded-xl border border-[color:var(--line)] hover:border-[color:var(--line-strong)] text-[12px] font-semibold flex items-center justify-center gap-2 transition-colors"
              data-testid="ve-vote-btn"
            >
              <Vote className="w-3.5 h-3.5 text-[color:var(--green)]" /> הצבע ל-SAOS/USDS (גייג' ראשי)
            </button>
            {eco && eco.ve.votes.length > 0 && (
              <div className="text-[10.5px] text-[color:var(--text-3)]" data-testid="ve-votes">
                {eco.ve.votes.map(v => (
                  <div key={v.who} className="flex justify-between py-0.5">
                    <span className="dx-num" dir="ltr">{v.who}</span>
                    <span className="dx-num" dir="ltr">{v.pool} · {fmtInt(v.weight)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ── Revenue Router + Burn ── */}
        <section className="dx-card p-5" data-testid="router-panel">
          <header className="flex items-center gap-2 mb-4">
            <span className="w-8 h-8 rounded-xl bg-[color:var(--pink)]/15 border border-[color:var(--pink)]/30 flex items-center justify-center">
              <Flame className="w-4 h-4 text-[color:var(--pink)]" />
            </span>
            <div>
              <h2 className="text-[15px] font-bold">ראוטר-ההכנסות — קנייה ושריפה</h2>
              <p className="text-[11px] text-[color:var(--text-3)]">Hyperliquid-model: הכנסות אמת → קנייה מהשוק → שריפה</p>
            </div>
          </header>

          {/* split bar */}
          <div className="rounded-xl border border-[color:var(--line)] bg-black/20 p-3 mb-4">
            <div className="h-3 rounded-full overflow-hidden flex" dir="ltr" aria-label="חלוקת הכנסות">
              <div className="bg-[color:var(--pink)]" style={{ width: `${eco?.revenue.burnPct ?? 40}%` }} />
              <div className="bg-[color:var(--green)]" style={{ width: `${eco?.revenue.vePct ?? 40}%` }} />
              <div className="bg-zinc-600" style={{ width: `${eco?.revenue.treasuryPct ?? 20}%` }} />
            </div>
            <div className="flex justify-between mt-2 text-[10px] text-[color:var(--text-3)]">
              <span><Flame className="w-3 h-3 inline text-[color:var(--pink)]" /> {eco?.revenue.burnPct ?? 40}% שריפה</span>
              <span><Vote className="w-3 h-3 inline text-[color:var(--green)]" /> {eco?.revenue.vePct ?? 40}% קרן-ve</span>
              <span>{eco?.revenue.treasuryPct ?? 20}% אוצר</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-4">
            <MiniStat label="מחזורים" value={fmtInt(eco?.revenue.cycles ?? 0)} />
            <MiniStat label="מחזור הבא" value={`${eco?.revenue.blocksLeft ?? 0} בלוקים`} />
            <MiniStat label="רווח-אוצר דחוי" value={`${fmtInt(eco?.revenue.treasuryProfitMu ?? 0)}µ`} />
            <MiniStat label="היצע-SAOS חי" value={`${fmtInt(eco?.revenue.saosSupplyMu ?? 0)}µ`} tone="pink" />
          </div>

          <div className="text-[11px] text-[color:var(--text-2)] leading-relaxed rounded-xl border border-[color:var(--line)] bg-black/20 p-3">
            <TrendingDown className="w-3.5 h-3.5 inline text-[color:var(--pink)]" /> כל מחזור ({eco?.revenue.every ?? 600} בלוקים)
            מתוזמן בגובה-הבלוק עצמו — דטרמיניסטי, חתום-מרקל, משוכפל בכל אימות. השריפה
            מורידה את ΣSAOS מהמצב עצמו — דפלציה שניתנת להוכחה מתמטית.
          </div>
        </section>

        {/* ── Bonds ── */}
        <section className="dx-card p-5" data-testid="bonds-panel">
          <header className="flex items-center gap-2 mb-4">
            <span className="w-8 h-8 rounded-xl bg-amber-950/40 border border-amber-700/40 flex items-center justify-center">
              <Percent className="w-4 h-4 text-amber-400" />
            </span>
            <div>
              <h2 className="text-[15px] font-bold">בונדים — SAOS בהנחת {(((eco?.bonds.discBps ?? 300)) / 100).toFixed(1)}%</h2>
              <p className="text-[11px] text-[color:var(--text-3)]">Olympus-POL בלי מלכודת ההדפסה: נזילות-אוצר שאי אפשר למשוך</p>
            </div>
          </header>

          <div className="grid grid-cols-3 gap-2 mb-4">
            <MiniStat label="מחיר-שוק" value={fmtInt(eco?.bonds.refPrice ?? 0)} sub="µ-USDS/SAOS" />
            <MiniStat label="מחיר-בונד" value={fmtInt(bondPrice)} sub="מיד אחרי-ההנחה" tone="green" />
            <MiniStat label="נמכרו" value={`${fmtInt(eco?.bonds.soldSaosMu ?? 0)}µ`} sub={`${eco?.bonds.count ?? 0} בונדים`} />
          </div>

          <div className="space-y-3">
            <div className="flex gap-2">
              <input value={bondAmt} onChange={e => setBondAmt(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric"
                className="dx-input font-data h-10 flex-1" dir="ltr" placeholder="USDS כניסה (50–2000)" aria-label="סכום USDS לבונד" data-testid="bond-amount" />
              <button
                onClick={() => mutate({ action: 'bond_buy', amount: Number(bondAmt) * 1000 }, 'bond')}
                disabled={busy !== null || !(Number(bondAmt) >= 50 && Number(bondAmt) <= 2000)}
                className="dx-cta h-10 px-4 text-[12px] flex items-center gap-1.5 shrink-0"
                data-testid="bond-buy-btn"
              >
                {busy === 'bond' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />} קנה
              </button>
            </div>
            <div className="text-[11px] rounded-xl border border-[color:var(--line)] bg-black/20 p-3 leading-relaxed">
              {saosOut > 0 ? (
                <>תקבל <span className="dx-num font-bold text-[color:var(--text-1)]" dir="ltr">{fmtInt(saosOut)}µ SAOS</span> (≈{fmtInt(saosOut / 1000)} SAOS)
                  — נעול ve-{eco?.bonds.veWeeks ?? 12} שבועות (≈90 יום). התמורה יורדת לאוצר:
                  עומק-נזילות שנשאר בפרוטוקול לנצח.</>
              ) : (
                <>הזן סכום (50–2000 USDS) לציטוט-בונד חי. ה-SAOS שתקבל נכנס נעול-ve —
                  כך הבונדים בונים נזילות-אוצר בלי להדפיס כלום.</>
              )}
            </div>
          </div>
        </section>

        {/* ── Dynamic fees ── */}
        <section className="dx-card p-5" data-testid="fees-panel">
          <header className="flex items-center gap-2 mb-4">
            <span className="w-8 h-8 rounded-xl bg-[color:var(--green-soft)] border border-[color:var(--green)]/30 flex items-center justify-center">
              <Percent className="w-4 h-4 text-[color:var(--green)]" />
            </span>
            <div>
              <h2 className="text-[15px] font-bold">עמלים-דינמיים — מגן-LP</h2>
              <p className="text-[11px] text-[color:var(--text-3)]">V4-hooks/Bunni am-AMM: העמלה מסתגלת לתנודתיות בזמן-אמת</p>
            </div>
          </header>
          <div className="space-y-2" data-testid="fees-table">
            {(eco?.dynamicFees ?? []).map(p => {
              const pct = Math.min(100, (p.feeBps / 1500) * 100);
              return (
                <div key={p.key} className="rounded-xl border border-[color:var(--line)] bg-black/20 p-3">
                  <div className="flex items-center justify-between text-[12px] mb-1.5">
                    <span className="font-semibold dx-num" dir="ltr">{p.key}</span>
                    <span className="dx-num text-[color:var(--text-1)]" dir="ltr">{p.feeBps} bps</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden" dir="ltr">
                    <div className="h-full bg-gradient-to-r from-[color:var(--green)] to-[color:var(--pink)]" style={{ width: `${Math.max(2, pct)}%` }} />
                  </div>
                  <div className="flex justify-between text-[9.5px] text-[color:var(--text-3)] mt-1">
                    <span dir="ltr">vol-EWMA {p.volBpsEwma}bps</span>
                    <span dir="ltr">{fmtInt(p.swaps)} swaps</span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10.5px] text-[color:var(--text-3)] mt-3 leading-relaxed">
            ככל שהבריכה עוברת פגיעות-מחיר חדות — העמלה עולה (עד 1500bps) ומפצה את
            ספקי-הנזילות על LVR; בשקט — חוזרת לרצפה. ציטוט = ביצוע, תמיד.
          </p>
        </section>
      </div>

      {/* how it works */}
      <section className="dx-card p-5">
        <h2 className="text-[14px] font-bold mb-3 flex items-center gap-2"><Wallet className="w-4 h-4 text-[color:var(--text-2)]" />איך זה מסתדר יחד</h2>
        <div className="grid md:grid-cols-4 gap-3 text-[11.5px] leading-relaxed">
          <Step n="1" title="עמלים זורמים" body="כל סוואפ/מילוי בספר מייצר עמלה-אמת: 70% ל-LP, 30% לאוצר — מדידה חתומה." />
          <Step n="2" title="אוצר מפריש" body={`כל ${eco?.revenue.every ?? 600} בלוקים: 40% קנייה-ושריפה · 40% לקרן-ve · 20% נשאר.`} />
          <Step n="3" title="מצביעים מרוויחים" body={`בכל אפוק (${eco?.epoch.every ?? 1200} בלוקים) הקרן מתחלקת לפי כוח-ve — נשלם ישירות לארנק.`} />
          <Step n="4" title="ההיצע מתכווץ" body="שריפה מורידה ΣSAOS מהמצב-עצמו; בונדים מוסיפים נזילות-אוצר. המעגל מחזק את עצמו." />
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, sub, icon, tone }: { label: string; value: string; sub?: string; icon: React.ReactNode; tone?: 'pink' }) {
  return (
    <div className={`rounded-xl border px-3.5 py-2.5 ${tone === 'pink' ? 'border-[color:var(--pink)]/40 bg-[color:var(--pink)]/10' : 'border-[color:var(--line)] bg-black/20'}`}>
      <div className="flex items-center gap-1.5 text-[10px] text-[color:var(--text-3)]">{icon} {label}</div>
      <div className={`dx-num text-[15px] font-bold ${tone === 'pink' ? 'text-[color:var(--pink)]' : ''}`} dir="ltr">{value}</div>
      {sub && <div className="text-[9.5px] text-[color:var(--text-3)]">{sub}</div>}
    </div>
  );
}

function MiniStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'green' | 'pink' }) {
  return (
    <div className="rounded-lg border border-[color:var(--line)] bg-black/20 px-2.5 py-2">
      <div className="text-[9.5px] text-[color:var(--text-3)]">{label}</div>
      <div className={`dx-num text-[12.5px] font-bold ${tone === 'green' ? 'text-[color:var(--green)]' : tone === 'pink' ? 'text-[color:var(--pink)]' : ''}`} dir="ltr">{value}</div>
      {sub && <div className="text-[9px] text-[color:var(--text-3)]">{sub}</div>}
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-[color:var(--line)] bg-black/20 p-3">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="w-5 h-5 rounded-full bg-[color:var(--pink)]/20 text-[color:var(--pink)] text-[10px] font-black flex items-center justify-center" dir="ltr">{n}</span>
        <span className="font-bold text-[12px]">{title}</span>
      </div>
      <p className="text-[color:var(--text-2)]">{body}</p>
    </div>
  );
}
