'use client';

// ─── EconomyView — הכלכלה המטורפת: veSAOS · Revenue-Router · Bonds · עמלים-דינמיים
// כל-הנתונים חיים מהמנוע: /saos-dex/api/dex/economy · מוטציות דרך /api/dx (economy)

import { useCallback, useState } from 'react';
import {
  Lock, Flame, Vote, TrendingDown, Percent, Clock, Wallet,
  ShieldCheck, Sparkles, Loader2, Bot, Sprout, Repeat, BarChart3, Landmark,
  BadgeCheck, Link2, Layers, Globe, Scale, Rocket, Crosshair,
} from 'lucide-react';
import { authHeaders } from '@/components/sv/shared';
import { fmtInt, usePoll, StaleChip } from './common';

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

interface AleData {
  ok: boolean;
  height: number;
  policy: { every: number; seedPct: number; maxPerCycleMu: number; minSeedMu: number; floorUsdsMu: number };
  treasury: { usdsFreeMu: number; usdsFreeAboveFloorMu: number; lpValueUsdsMu: number; profitMu: number };
  ale: { lastH: number; cycles: number; seededMu: number; seeds: number; polBaseUsdsMu: number } | null;
  pol: { growthBps: number; weightedPolBps: number };
  flywheel: { feeMeterMu: number; burnedSaosMu: number; revCycles: number; vePaidMu: number; aleSeededMu: number; aleSeeds: number; aleCycles: number };
  autonomy: { arenaFills: number; swapsTotal: number; liveOrders: number; note: string };
  pools: Array<{ key: string; assetA: string; assetB: string; reserveAMu: number; reserveBMu: number; lpTotalMu: number; lpTreasuryMu: number; polShareBps: number; dynFeeBps: number | null; swaps: number }>;
  recentSeeds: Array<{ h: number; soldier: string; action: string; profitMu?: number; note?: string }>;
  vaultFeed: { backingWsteemMu: number; honesty: string };
}

interface CompareData {
  ok: boolean;
  height: number;
  rows: Array<{ metric: string; us: string; usLive: boolean; usValue: string; uniswap: string; curve: string; olympus: string; verdict: string }>;
  methodology: string;
  maximize: string;
}

// ── Task 56 · מנוע-הוכחת-המחיר (price-proof) ──
interface ProofData {
  ok: boolean;
  height: number;
  at: string;
  internal: { saosUsdsMu: number; wsteemUsdsMu: number; wsteemPerSaosBps: number; backingWsteemMu: number };
  external: { steemUsd: number | null; hiveUsd: number | null; hbdUsd: number | null; blurtUsd: number | null; feedOk: boolean; feedStale?: boolean; feedSources?: Partial<Record<string, string>>; feedError?: string };
  derived: { saosUsdMicro: number | null; saosUsdText: string | null; wsteemDivBps: number | null; verdict: 'CONVERGED' | 'DRIFT' | 'DIVERGENT' | 'STALE' | 'NO-FEED' };
  depth: {
    saosUsds: { rows: Array<{ pctOfReserve: number; amountInBaseMu: number; effPriceMu: number; impactBps: number }>; midMu: number } | null;
    wsteemUsds: { rows: Array<{ pctOfReserve: number; amountInBaseMu: number; effPriceMu: number; impactBps: number }>; midMu: number } | null;
    book1pct: { bidMu: number; askMu: number; orders: number };
  };
  treasuryReal: {
    feedsNote: string;
    steemHead: { account: string; steem: number; sbd: number; sp: number } | null;
    hiveFleet: { liquidHive: number; hbd: number; hp: number } | null;
    blurt: { account: string; liquid: number; vested: number } | null;
    usd: { steem: number | null; hbd: number | null; hive: number | null; blurt: number | null; total: number | null };
    honesty: string;
  };
}

// ── Task 57 · מסילת-ההשקות (launchpad) + ProtoRev ──
interface LpadData {
  ok: boolean;
  height: number;
  policy: { feeBps: number; creatorPct: number; gradMinUsdsMu: number; maxRaiseMu: number; lbpBlocks: number; minSupplyMu: number; maxSupplyMu: number; vqDiv: number };
  launches: Array<{
    id: string; owner: string; ticker: string; name: string; code: string; mode: 'curve' | 'lbp';
    priceMu: number; supplyMu: number; circulatingMu: number; raisedMu: number; gradPctBps: number;
    gradTargetMu: number; feesCreatorMu: number; feesPlatformMu: number;
    atH: number; endH: number; blocksLeft: number; graduated: boolean; gradH: number; poolKey: string; status: string;
  }>;
  revAux: { protorevMu: number; launchpadMu: number };
  honesty: string;
}

interface PrvData {
  ok: boolean;
  height: number;
  state: { runs: number; profitMu: number; cycles: number; rejections: number; lastH: number };
  revAux: { protorevMu: number; launchpadMu: number };
  desk: { account: string; credits: number; usdsMu: number; deskFloorMu: number; inventory: Array<{ asset: string; mu: number }> };
  policy: { maxRunsPerBlock: number; minProfitMu: number; maxBaseMu: number; impactPct: number; edgeBps: number };
  spreads: Array<{ key: string; base: string; quote: string; midMu: number; bidMu: number | null; askMu: number | null; edgeBidBps: number | null; edgeAskBps: number | null; actionable: boolean }>;
  recent: Array<{ h: number; action: string; note?: string; profitMu?: number }>;
  honesty: string;
}

export function EconomyView({ onNeedAuth, onDone }: {
  onNeedAuth: () => boolean;
  onDone: () => void;
}) {
  const [eco, setEco] = useState<EconomyData | null>(null);
  const [ale, setAle] = useState<AleData | null>(null);
  const [cmp, setCmp] = useState<CompareData | null>(null);
  const [proof, setProof] = useState<ProofData | null>(null);
  const [lpad, setLpad] = useState<LpadData | null>(null);
  const [prv, setPrv] = useState<PrvData | null>(null);
  const [lockAmt, setLockAmt] = useState('500');
  const [weeks, setWeeks] = useState(52);
  const [bondAmt, setBondAmt] = useState('1000');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [newTicker, setNewTicker] = useState('');
  const [newName, setNewName] = useState('');
  const [newMode, setNewMode] = useState<'curve' | 'lbp'>('curve');
  // FIX(70-a ·3): 13-סקציות בעמוד-אחד = העומס-השני שדיווח המפעיל — חלוקה-לטאבים
  const [tab, setTab] = useState<'overview' | 've' | 'launch' | 'compare'>('overview');

  // ── FIX(Roast-65-e4 · F7): 6-לולאות-הסקירה עברו ל-usePoll משותף — השהיה-בהסתרת-טאב,
  // backoff-עם-jitter בכישלון, ושבב "נתונים-ישנים" במקום catch-שקט (היה ≈88-req/min + נתון-ישן-שנראה-חי).
  const ecoStale = usePoll(useCallback(async (): Promise<boolean> => {
    try {
      const r = await fetch('/saos-dex/api/dex/economy', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      const j = (await r.json()) as EconomyData;
      if (j.ok) { setEco(j); return true; }
      return false;
    } catch { return false; }
  }, []), 3000);

  const aleStale = usePoll(useCallback(async (): Promise<boolean> => {
    try {
      const r = await fetch('/saos-dex/api/dex/ale', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      const j = (await r.json()) as AleData;
      if (j.ok) { setAle(j); return true; }
      return false;
    } catch { return false; }
  }, []), 3000);

  const cmpStale = usePoll(useCallback(async (): Promise<boolean> => {
    try {
      const r = await fetch('/saos-dex/api/dex/compare', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      const j = (await r.json()) as CompareData;
      if (j.ok) { setCmp(j); return true; }
      return false;
    } catch { return false; }
  }, []), 15000);

  const proofStale = usePoll(useCallback(async (): Promise<boolean> => {
    try {
      const r = await fetch('/saos-dex/api/dex/price-proof', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      const j = (await r.json()) as ProofData;
      if (j.ok) { setProof(j); return true; }
      return false;
    } catch { return false; }
  }, []), 15000);

  const lpadStale = usePoll(useCallback(async (): Promise<boolean> => {
    try {
      const r = await fetch('/saos-dex/api/dex/launchpad', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      const j = (await r.json()) as LpadData;
      if (j.ok) { setLpad(j); return true; }
      return false;
    } catch { return false; }
  }, []), 3000);

  const prvStale = usePoll(useCallback(async (): Promise<boolean> => {
    try {
      const r = await fetch('/saos-dex/api/dex/protorev', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      const j = (await r.json()) as PrvData;
      if (j.ok) { setPrv(j); return true; }
      return false;
    } catch { return false; }
  }, []), 3000);

  const pollStale = ecoStale || aleStale || cmpStale || proofStale || lpadStale || prvStale;

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

  const mutateLaunch = useCallback(async (payload: Record<string, unknown>, tag: string) => {
    if (!onNeedAuth()) return;
    setBusy(tag); setMsg(null);
    try {
      const r = await fetch('/api/dx', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ action: 'launchpad', payload }),
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
      {/* FIX(Roast-65-e4 · F7): חיווי-כן כשאחת מ-6-לולאות-הסקירה נכשלה — הנתונים-על-המסך ישנים */}
      <StaleChip show={pollStale} />
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

      {/* FIX(70-a ·3): טאבי-כלכלה — סקירה/ALE · ve-ושריפה-ובונדים · השקות · השוואה */}
      <div className="flex gap-1.5 flex-wrap" role="tablist" aria-label="מקטעי-כלכלה" data-testid="economy-tabs">
        {([['overview', 'סקירה · מנוע-נזילות'], ['ve', 've · שריפה · בונדים'], ['launch', 'השקות'], ['compare', 'השוואה-חיה']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`dx-nav h-9 px-4 text-[12.5px] font-medium ${tab === id ? 'dx-nav-active' : ''}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (<>
      {/* ── מנוע-הוכחת-המחיר (Task 56) — התשובה-ל"מה-המחיר-הזה-אמיתי" ── */}
      <PriceProofPanel proof={proof} />

      {/* ── ALE · מנוע-הנזילות-האוטונומית (Task 55) ── */}
      <section className="dx-card p-5" data-testid="ale-panel">
        <header className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="w-8 h-8 rounded-xl bg-[color:var(--green-soft)] border border-[color:var(--green)]/30 flex items-center justify-center">
            <Bot className="w-4 h-4 text-[color:var(--green)]" />
          </span>
          <div className="flex-1 min-w-[200px]">
            <h2 className="text-[15px] font-bold">ALE — מנוע-הנזילות-האוטונומית</h2>
            <p className="text-[11px] text-[color:var(--text-3)]">
              נזילות שצומחת מעצמה: האוצר זורע חלק-מהעמלות חזרה-לבריכות כל {ale?.policy.every ?? 100} בלוקים — בלי-משתמשים, בלי-הדפסה
            </p>
          </div>
          <span className="text-[10px] rounded-full border border-[color:var(--green)]/40 bg-[color:var(--green-soft)] text-[color:var(--green)] px-2.5 py-1 font-semibold">
            {ale?.ale ? `פעיל · מחזור #${ale.ale.cycles}` : 'ממתין-למחזור-הראשון'}
          </span>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4" data-testid="ale-stats">
          <MiniStat label="POL-משוקלל" value={`${(ale?.pol.weightedPolBps ?? 0) / 100}%`} sub="מה-LP הכולל שלנו" tone="green" />
          <MiniStat label="שווי-עמדות-LP-אוצר" value={`${fmtInt(ale?.treasury.lpValueUsdsMu ?? 0)}µ`} sub="נמדד-מהבריכות-החיות" />
          <MiniStat label="הוזרע-מהעמלים" value={`${fmtInt(ale?.flywheel.aleSeededMu ?? 0)}µ`} sub={`${ale?.flywheel.aleSeeds ?? 0} הזרעות חיות`} tone="pink" />
          <MiniStat label="פילים-אוטונומיים" value={fmtInt(ale?.autonomy.arenaFills ?? 0)} sub="סוחרי-הארנה — אפס-משתמשים" />
        </div>

        {/* הפלאיהול */}
        <div className="rounded-xl border border-[color:var(--line)] bg-black/20 p-4 mb-4">
          <div className="flex items-center gap-2 mb-3 text-[11px] font-semibold">
            <Repeat className="w-3.5 h-3.5 text-[color:var(--green)]" /> הפלאיהול-הסגור — המערכת מפרה את עצמה
          </div>
          <div className="flex items-center gap-1.5 flex-wrap text-[10px]" dir="ltr">
            {['עמלות-אמת', '40% שריפה', '40% קרן-ve', '20% אוצר', 'ALE זורע POL', 'בריכות-עמוקות', 'פגיעה-קטנה → מחזור-גבוה'].map((s, i, arr) => (
              <span key={s} className="flex items-center gap-1.5">
                <span className={`rounded-lg px-2 py-1 border ${i === 4 ? 'border-[color:var(--pink)]/50 bg-[color:var(--pink)]/10 text-[color:var(--pink)] font-bold' : 'border-[color:var(--line)] bg-black/30 text-[color:var(--text-2)]'}`}>{s}</span>
                {i < arr.length - 1 && <span className="text-[color:var(--text-3)]">→</span>}
              </span>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
            <div className="rounded-lg bg-black/30 border border-[color:var(--line)] px-2 py-1.5">
              <div className="text-[9px] text-[color:var(--text-3)]">מד-עמלות-חי</div>
              <div className="dx-num text-[11.5px] font-bold" dir="ltr">{fmtInt(ale?.flywheel.feeMeterMu ?? 0)}µ</div>
            </div>
            <div className="rounded-lg bg-black/30 border border-[color:var(--line)] px-2 py-1.5">
              <div className="text-[9px] text-[color:var(--text-3)]">USDS-חופשי-מעל-הרצפה</div>
              <div className="dx-num text-[11.5px] font-bold" dir="ltr">{fmtInt(ale?.treasury.usdsFreeAboveFloorMu ?? 0)}µ</div>
            </div>
            <div className="rounded-lg bg-black/30 border border-[color:var(--line)] px-2 py-1.5">
              <div className="text-[9px] text-[color:var(--text-3)]">צמיחת-שווי-LP-מאז-בסיס</div>
              <div className={`dx-num text-[11.5px] font-bold ${(ale?.pol.growthBps ?? 0) >= 0 ? 'text-[color:var(--green)]' : 'text-rose-400'}`} dir="ltr">{((ale?.pol.growthBps ?? 0) / 100).toFixed(2)}%</div>
            </div>
            <div className="rounded-lg bg-black/30 border border-[color:var(--line)] px-2 py-1.5">
              <div className="text-[9px] text-[color:var(--text-3)]">גיבוי-כספת-חי (WSTEEM 1:1)</div>
              <div className="dx-num text-[11.5px] font-bold" dir="ltr">{fmtInt(ale?.vaultFeed.backingWsteemMu ?? 0)}µ</div>
            </div>
          </div>
        </div>

        {/* יומן-הזרעות */}
        <div className="space-y-1" data-testid="ale-seeds-log">
          <div className="flex items-center gap-1.5 text-[10px] text-[color:var(--text-3)] mb-1">
            <Sprout className="w-3 h-3 text-[color:var(--green)]" /> יומן-הזרעות-חי (מהיומן-הקנוני-החתום-מרקל)
          </div>
          {(ale?.recentSeeds ?? []).length > 0 ? ale!.recentSeeds.slice(0, 4).map((j, i) => (
            <div key={`${j.h}-${i}`} className="flex items-center justify-between text-[10.5px] rounded-lg bg-black/20 border border-[color:var(--line)] px-2.5 py-1.5">
              <span className="dx-num text-[color:var(--text-3)]" dir="ltr">#{fmtInt(j.h)}</span>
              <span className="dx-num text-[color:var(--text-1)] flex-1 mx-3 truncate" dir="ltr">{j.note}</span>
              <span className="dx-num text-[color:var(--green)]" dir="ltr">{j.action === 'pol_seed' ? 'seed' : 'acquire'}</span>
            </div>
          )) : (
            <div className="text-[10.5px] text-[color:var(--text-3)] rounded-lg bg-black/20 border border-[color:var(--line)] px-2.5 py-2">
              המחזור-הראשון מתוזמן לגובה-בלוק מרובה-{ale?.policy.every ?? 100} — דטרמיניסטי, כמו-הכל-כאן. הפוליסה: {ale?.policy.seedPct ?? 25}% מהחופשי-מעל-הרצפה, תקרה {fmtInt(ale?.policy.maxPerCycleMu ?? 0)}µ למחזור.
            </div>
          )}
        </div>
      </section>

      {/* how it works — שייך-לסקירה: זה-הסיפור-המלא של-הפלאיהול */}
      <section className="dx-card p-5">
        <h2 className="text-[14px] font-bold mb-3 flex items-center gap-2"><Wallet className="w-4 h-4 text-[color:var(--text-2)]" />איך זה מסתדר יחד</h2>
        <div className="grid md:grid-cols-5 gap-3 text-[11.5px] leading-relaxed">
          <Step n="1" title="עמלים זורמים" body="כל סוואפ/מילוי בספר מייצר עמלה-אמת: 70% ל-LP, 30% לאוצר — מדידה חתומה." />
          <Step n="2" title="אוצר מפריש" body={`כל ${eco?.revenue.every ?? 600} בלוקים: 40% קנייה-ושריפה · 40% לקרן-ve · 20% נשאר.`} />
          <Step n="3" title="מצביעים מרוויחים" body={`בכל אפוק (${eco?.epoch.every ?? 1200} בלוקים) הקרן מתחלקת לפי כוח-ve — נשלם ישירות לארנק.`} />
          <Step n="4" title="ההיצע מתכווץ" body="שריפה מורידה ΣSAOS מהמצב-עצמו; בונדים מוסיפים נזילות-אוצר. המעגל מחזק את עצמו." />
          <Step n="5" title="ALE זורע נזילות" body={`כל ${ale?.policy.every ?? 100} בלוקים האוצר רוכש צד-שני וזורע POL מהעמלות — נזילות שצומחת בלי משתמשים.`} />
        </div>
      </section>
      </>)}

      {/* ── מסילת-ההשקות + ProtoRev (Task 57) ── */}
      {tab === 'launch' && (
        <LaunchpadPanel lpad={lpad} prv={prv} newTicker={newTicker} setNewTicker={setNewTicker} newName={newName} setNewName={setNewName} newMode={newMode} setNewMode={setNewMode} mutateLaunch={mutateLaunch} busy={busy} />
      )}

      {tab === 've' && (<div className="grid lg:grid-cols-2 gap-5">
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
      </div>)}

      {/* ── השוואה-חיה מול-העולם (Task 55) ── */}
      {tab === 'compare' && (
      <section className="dx-card p-5" data-testid="compare-panel">
        <header className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="w-8 h-8 rounded-xl bg-[color:var(--pink)]/15 border border-[color:var(--pink)]/30 flex items-center justify-center">
            <BarChart3 className="w-4 h-4 text-[color:var(--pink)]" />
          </span>
          <div className="flex-1 min-w-[200px]">
            <h2 className="text-[15px] font-bold">השוואה-חיה — הרשת שלנו מול הדקסים-המובילים</h2>
            <p className="text-[11px] text-[color:var(--text-3)]">{cmp?.methodology ?? 'העמודה-שלנו=חי-נמדד-מהגרעין · המתחרים=עובדות-ציבוריות-מתועדות'}</p>
          </div>
        </header>
        {cmp?.maximize && (
          <div className="text-[10.5px] text-[color:var(--green)] rounded-lg border border-[color:var(--green)]/30 bg-[color:var(--green-soft)] px-3 py-1.5 mb-3 leading-relaxed">
            {cmp.maximize}
          </div>
        )}
        <div className="space-y-2 max-h-96 overflow-y-auto" data-testid="compare-table">
          {(cmp?.rows ?? []).map(r => (
            <div key={r.metric} className="rounded-xl border border-[color:var(--line)] bg-black/20 p-3">
              <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
                <span className="text-[12px] font-bold">{r.metric}</span>
                <span className="dx-num text-[10px] rounded-full border border-[color:var(--green)]/40 bg-[color:var(--green-soft)] text-[color:var(--green)] px-2 py-0.5 font-bold" dir="ltr">{r.usValue}</span>
              </div>
              <div className="grid md:grid-cols-4 gap-2 text-[10.5px]">
                <div className="rounded-lg border border-[color:var(--green)]/40 bg-[color:var(--green-soft)]/60 p-2">
                  <div className="text-[9px] font-bold text-[color:var(--green)] mb-0.5">אנחנו · חי מהגרעין</div>
                  <div className="text-[color:var(--text-1)] leading-snug">{r.us}</div>
                </div>
                <div className="rounded-lg border border-[color:var(--line)] bg-black/30 p-2">
                  <div className="text-[9px] font-bold text-[color:var(--text-3)] mb-0.5" dir="ltr">Uniswap v3</div>
                  <div className="text-[color:var(--text-2)] leading-snug">{r.uniswap}</div>
                </div>
                <div className="rounded-lg border border-[color:var(--line)] bg-black/30 p-2">
                  <div className="text-[9px] font-bold text-[color:var(--text-3)] mb-0.5" dir="ltr">Curve</div>
                  <div className="text-[color:var(--text-2)] leading-snug">{r.curve}</div>
                </div>
                <div className="rounded-lg border border-[color:var(--line)] bg-black/30 p-2">
                  <div className="text-[9px] font-bold text-[color:var(--text-3)] mb-0.5" dir="ltr">OlympusDAO</div>
                  <div className="text-[color:var(--text-2)] leading-snug">{r.olympus}</div>
                </div>
              </div>
              <div className="text-[10px] text-[color:var(--text-3)] mt-1.5 flex items-start gap-1">
                <Landmark className="w-3 h-3 shrink-0 mt-0.5 text-[color:var(--pink)]" /> {r.verdict}
              </div>
            </div>
          ))}
        </div>
      </section>
      )}
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

// ─── מנוע-הוכחת-המחיר (Task 56) — שרשרת-הוכחה גלויה מקצה-לקצה ───────────────
const VERDICT_META: Record<string, { label: string; cls: string }> = {
  CONVERGED: { label: 'מתכנס עם השוק', cls: 'text-[color:var(--green)] border-[color:var(--green)]/40 bg-[color:var(--green)]/10' },
  DRIFT: { label: 'סטייה-מתונה', cls: 'text-amber-400 border-amber-500/40 bg-amber-500/10' },
  DIVERGENT: { label: 'סטייה-גבוהה', cls: 'text-[color:var(--red)] border-[color:var(--red)]/40 bg-[color:var(--red)]/10' },
  STALE: { label: 'פיד-עמום (נתון-אחרון-טוב, מסומן)', cls: 'text-amber-400 border-amber-500/40 bg-amber-500/10' },
  'NO-FEED': { label: 'אין-פיד-חוץ (כנות)', cls: 'text-[color:var(--text-2)] border-[color:var(--line)] bg-black/20' },
};

function PriceProofPanel({ proof }: { proof: ProofData | null }) {
  if (!proof) return null;
  const v = VERDICT_META[proof.derived.verdict] ?? VERDICT_META['NO-FEED'];
  const fmtUsdNum = (n: number | null, digits = 2) => n === null ? '—' : `$${n.toFixed(digits)}`;
  const rows = proof.depth.saosUsds?.rows ?? [];
  const maxImpact = Math.max(...rows.map(r => r.impactBps), 1);
  return (
    <section className="dx-card p-5" data-testid="price-proof-panel">
      <header className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] text-[color:var(--text-3)] mb-1.5">
            <BadgeCheck className="w-3.5 h-3.5 text-[color:var(--green)]" />
            מנוע-הוכחת-המחיר · שרשרת-נגזרת-גלויה + הצלבת-שווקים + אוצר-אמת
          </div>
          <h2 className="text-[14px] font-bold">מה המחיר האמיתי של SAOS — ואיך זה מוכח</h2>
          <p className="text-[11px] text-[color:var(--text-2)] mt-1 max-w-2xl leading-relaxed">
            אין-כאן-מספר-סמכותי-שאי-אפשר-לבדוק: המחיר נגזר מבריכות-חיות → WSTEEM מגובה-1:1
            ב-STEEM אמת → מחיר-שוק-ציבורי. ואוצר-האמת למטה — כמה יש לנו באמת בשרשראות.
          </p>
        </div>
        <span className={`text-[10.5px] font-bold rounded-full border px-3 py-1.5 ${v.cls}`} data-testid="price-verdict">
          {v.label}{proof.derived.wsteemDivBps !== null ? ` · ${proof.derived.wsteemDivBps > 0 ? '+' : ''}${proof.derived.wsteemDivBps}bps` : ''}
        </span>
      </header>

      {/* שרשרת-הנגזרת */}
      <div className="rounded-xl border border-[color:var(--line)] bg-black/20 p-4 mb-3" data-testid="price-derivation">
        <div className="text-[10px] label-caps mb-3 flex items-center gap-1.5"><Link2 className="w-3 h-3" /> שרשרת-הנגזרת — כל-צעד-ניתן-לאימות</div>
        <div className="flex items-stretch gap-2 flex-wrap text-[11px]">
          <div className="rounded-lg border border-[color:var(--line)] px-3 py-2 min-w-[150px] flex-1">
            <div className="text-[9px] text-[color:var(--text-3)]">בריכה-חיה SAOS/USDS</div>
            <div className="dx-num font-bold" dir="ltr">{(proof.internal.saosUsdsMu / 1000).toFixed(3)} USDS</div>
          </div>
          <div className="self-center text-[color:var(--text-3)]">÷</div>
          <div className="rounded-lg border border-[color:var(--line)] px-3 py-2 min-w-[150px] flex-1">
            <div className="text-[9px] text-[color:var(--text-3)]">בריכה-חיה WSTEEM/USDS</div>
            <div className="dx-num font-bold" dir="ltr">{(proof.internal.wsteemUsdsMu / 1000).toFixed(3)} USDS</div>
          </div>
          <div className="self-center text-[color:var(--text-3)]">=</div>
          <div className="rounded-lg border border-[color:var(--line)] px-3 py-2 min-w-[140px] flex-1">
            <div className="text-[9px] text-[color:var(--text-3)]">SAOS ב-WSTEEM</div>
            <div className="dx-num font-bold" dir="ltr">{(proof.internal.wsteemPerSaosBps / 10000).toFixed(4)}</div>
          </div>
          <div className="self-center text-[color:var(--text-3)]">×</div>
          <div className="rounded-lg border border-[color:var(--green)]/30 px-3 py-2 min-w-[140px] flex-1">
            <div className="text-[9px] text-[color:var(--text-3)]">STEEM · שוק-ציבורי חי</div>
            <div className="dx-num font-bold text-[color:var(--green)]" dir="ltr">{fmtUsdNum(proof.external.steemUsd, 4)}</div>
          </div>
          <div className="self-center text-[color:var(--text-3)]">=</div>
          <div className="rounded-lg border border-[color:var(--pink)]/40 bg-[color:var(--pink)]/10 px-3 py-2 min-w-[150px] flex-1">
            <div className="text-[9px] text-[color:var(--text-3)]">SAOS ב-$-אמת (מעוגן)</div>
            <div className="dx-num font-black text-[color:var(--pink)] text-[13px]" dir="ltr">{proof.derived.saosUsdText ?? '—'}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2.5 text-[9.5px] text-[color:var(--text-3)] flex-wrap">
          <span className="rounded-full dx-chip px-2 py-0.5">גיבוי-WSTEEM אמת: {fmtInt(proof.internal.backingWsteemMu)}µ (1:1 STEEM נעול)</span>
          <span className="rounded-full dx-chip px-2 py-0.5">פיד-חוץ: {proof.external.feedOk ? (proof.external.feedStale ? 'עמום-מסומן' : `חי · ${Object.values(proof.external.feedSources ?? {})[0] ?? 'מקורות-מרובים'}`) : `נפל-בכנות (${proof.external.feedError ?? 'לא-זמין'})`}</span>
          <span className="rounded-full dx-chip px-2 py-0.5">גובה-אימות: h{fmtInt(proof.height)}</span>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {/* עומק-אמת */}
        <div className="rounded-xl border border-[color:var(--line)] bg-black/20 p-4" data-testid="price-depth">
          <div className="text-[10px] label-caps mb-3 flex items-center gap-1.5"><Layers className="w-3 h-3" /> עומק-אמת — פגיעה-במחיר לפי-גודל-מסחרה</div>
          {rows.length === 0 && <p className="text-[11px] text-[color:var(--text-3)]">אין בריכה פעילה</p>}
          <div className="space-y-1.5">
            {rows.map(r => (
              <div key={r.pctOfReserve} className="relative rounded-md overflow-hidden">
                <div className="absolute inset-y-0 left-0 bg-[color:var(--pink)]/15" style={{ width: `${(r.impactBps / maxImpact) * 100}%` }} />
                <div className="relative flex items-center justify-between px-2 py-1.5 text-[10.5px]">
                  <span className="dx-num">{r.pctOfReserve}% מהרזרבה ({(r.amountInBaseMu / 1000).toFixed(0)} SAOS)</span>
                  <span className="dx-num">מחיר {((r.effPriceMu / 1000)).toFixed(3)} · פגיעה {r.impactBps}bps</span>
                </div>
              </div>
            ))}
          </div>
          <div className="text-[9.5px] text-[color:var(--text-3)] mt-2">
            ספר ±1%: bids {fmtInt(proof.depth.book1pct.bidMu)}µ · asks {fmtInt(proof.depth.book1pct.askMu)}µ · {proof.depth.book1pct.orders} פקודות
          </div>
        </div>

        {/* אוצר-האמת */}
        <div className="rounded-xl border border-[color:var(--line)] bg-black/20 p-4" data-testid="treasury-real">
          <div className="text-[10px] label-caps mb-3 flex items-center gap-1.5"><Globe className="w-3 h-3" /> אוצר-האמת — יתרות-השרשראות החיות × מחירי-שוק</div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="dx-num text-xl font-black text-[color:var(--green)]" dir="ltr" data-testid="treasury-real-total">
              {fmtUsdNum(proof.treasuryReal.usd.total, 2)}
            </span>
            <span className="text-[9.5px] text-[color:var(--text-3)]">סה״כ-$-אמת בשרשראות</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 text-[10.5px]">
            <div className="rounded-lg border border-[color:var(--line)] px-2.5 py-1.5">
              <div className="text-[9px] text-[color:var(--text-3)]">STEEM (headcorner)</div>
              <div className="dx-num" dir="ltr">{proof.treasuryReal.steemHead ? `${proof.treasuryReal.steemHead.steem.toFixed(3)} + ${proof.treasuryReal.steemHead.sbd.toFixed(3)} SBD` : '—'}</div>
              <div className="dx-num text-[color:var(--green)]" dir="ltr">{fmtUsdNum(proof.treasuryReal.usd.steem, 2)}</div>
            </div>
            <div className="rounded-lg border border-[color:var(--line)] px-2.5 py-1.5">
              <div className="text-[9px] text-[color:var(--text-3)]">HIVE (צי + ראש)</div>
              <div className="dx-num" dir="ltr">{proof.treasuryReal.hiveFleet ? `${proof.treasuryReal.hiveFleet.liquidHive.toFixed(2)} HIVE + ${proof.treasuryReal.hiveFleet.hbd.toFixed(2)} HBD` : '—'}</div>
              <div className="dx-num text-[color:var(--green)]" dir="ltr">{fmtUsdNum(proof.treasuryReal.usd.hive, 2)}</div>
            </div>
            <div className="rounded-lg border border-[color:var(--line)] px-2.5 py-1.5">
              <div className="text-[9px] text-[color:var(--text-3)]">BLURT (headcorner)</div>
              <div className="dx-num" dir="ltr">{proof.treasuryReal.blurt ? `${proof.treasuryReal.blurt.liquid.toFixed(2)} BLURT` : '—'}</div>
              <div className="dx-num text-[color:var(--green)]" dir="ltr">{fmtUsdNum(proof.treasuryReal.usd.blurt, 2)}</div>
            </div>
            <div className="rounded-lg border border-[color:var(--line)] px-2.5 py-1.5">
              <div className="text-[9px] text-[color:var(--text-3)]">פידי-שוק חיים</div>
              <div className="dx-num" dir="ltr">STEEM {fmtUsdNum(proof.external.steemUsd, 3)} · HIVE {fmtUsdNum(proof.external.hiveUsd, 3)}</div>
              <div className="dx-num" dir="ltr">BLURT {fmtUsdNum(proof.external.blurtUsd, 4)} · HBD {fmtUsdNum(proof.external.hbdUsd, 3)}</div>
            </div>
          </div>
          <p className="text-[9px] text-[color:var(--text-3)] mt-2 leading-relaxed flex items-start gap-1">
            <Scale className="w-3 h-3 shrink-0 mt-0.5" /> {proof.treasuryReal.honesty}
          </p>
        </div>
      </div>
    </section>
  );
}

// ─── Task 57 · מסילת-ההשקות + ProtoRev — פאנל-כפול-חי ───────────────────────────

function LaunchpadPanel({ lpad, prv, newTicker, setNewTicker, newName, setNewName, newMode, setNewMode, mutateLaunch, busy }: {
  lpad: LpadData | null;
  prv: PrvData | null;
  newTicker: string; setNewTicker: (s: string) => void;
  newName: string; setNewName: (s: string) => void;
  newMode: 'curve' | 'lbp'; setNewMode: (m: 'curve' | 'lbp') => void;
  mutateLaunch: (payload: Record<string, unknown>, tag: string) => void;
  busy: string | null;
}) {
  const launches = lpad?.launches ?? [];
  const liveLaunches = launches.filter(l => !l.graduated);
  const gradLaunches = launches.filter(l => l.graduated);
  // FIX(Roast-65-e4 · F14): היצע-ההשקה נגזר-מהמדיניות-החיה (minSupplyMu, חסום-למקס);
  // ברירת-המחדל-הקודמת (200K טוקן) נשארת-רק-כשהמדיניות-חסרה.
  const launchSupplyMu = (() => {
    const pol = lpad?.policy;
    if (pol && pol.minSupplyMu > 0) return Math.min(pol.minSupplyMu, pol.maxSupplyMu > 0 ? pol.maxSupplyMu : pol.minSupplyMu);
    return 200_000_000;
  })();
  return (
    <section className="dx-card p-5" data-testid="launchpad-panel">
      <header className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] text-[color:var(--text-3)] mb-1.5">
            <Rocket className="w-3.5 h-3.5 text-[color:var(--pink)]" />
            מסילת-ההשקות · עקומת-pump.fun + LBP-דצ'י-אוקציה · הגירה-לבריכה-אמת
          </div>
          <h2 className="text-[14px] font-bold">השקות-חיות — טוקן-חדש מהעקומה עד לבריכה</h2>
          <p className="text-[11px] text-[color:var(--text-2)] mt-1 max-w-2xl leading-relaxed">
            טוקן-חדש נסחר על עקומת-מחיר דטרמיניסטית מהבלוק-הראשון; בגיוס {fmtInt(lpad?.policy.gradMinUsdsMu ?? 0)}µ-USDS
            הוא מוגר-אוטומטית לבריכת-AMM אמת עם LP-לאוצר (POL). LBP = מכירה-הולנדית: הזמן מוריד, הקניות מרימות.
          </p>
        </div>
        <span className="text-[10px] rounded-full border border-[color:var(--pink)]/40 bg-[color:var(--pink)]/10 text-[color:var(--pink)] px-2.5 py-1 font-semibold">
          {liveLaunches.length > 0 ? `${liveLaunches.length} חיות` : 'אין-השקות-חיות'} · עמלה {lpad?.policy.feeBps ?? 150}bps
        </span>
      </header>

      {/* טופס-השקה-חדשה */}
      <div className="rounded-xl border border-[color:var(--line)] bg-black/20 p-4 mb-4" data-testid="launch-create">
        <div className="text-[10px] label-caps mb-3">השקה-חדשה — טיקר (2–8 אותיות) + מצב</div>
        <div className="flex gap-2 flex-wrap">
          <input value={newTicker} onChange={e => setNewTicker(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
            className="dx-input font-data h-10 w-32" dir="ltr" placeholder="TICKER" aria-label="טיקר ההשקה" data-testid="launch-ticker" />
          <input value={newName} onChange={e => setNewName(e.target.value.slice(0, 24))}
            className="dx-input h-10 w-44" placeholder="שם (רשות)" aria-label="שם ההשקה" data-testid="launch-name" />
          <div className="flex rounded-xl border border-[color:var(--line)] overflow-hidden" role="group" aria-label="מצב השקה">
            <button onClick={() => setNewMode('curve')} className={`h-10 px-3 text-[11px] font-semibold transition-colors ${newMode === 'curve' ? 'bg-[color:var(--pink)]/20 text-[color:var(--pink)]' : 'text-[color:var(--text-3)] hover:text-[color:var(--text-1)]'}`} data-testid="mode-curve">עקומה</button>
            <button onClick={() => setNewMode('lbp')} className={`h-10 px-3 text-[11px] font-semibold transition-colors border-s border-[color:var(--line)] ${newMode === 'lbp' ? 'bg-[color:var(--pink)]/20 text-[color:var(--pink)]' : 'text-[color:var(--text-3)] hover:text-[color:var(--text-1)]'}`} data-testid="mode-lbp">LBP</button>
          </div>
          <button
            onClick={() => mutateLaunch({ action: 'create', ticker: newTicker, name: newName || newTicker, mode: newMode, supply: launchSupplyMu }, 'lcreate')}
            disabled={busy !== null || newTicker.length < 2}
            className="dx-cta h-10 px-4 text-[12px] flex items-center gap-1.5"
            data-testid="launch-create-btn"
          >
            {busy === 'lcreate' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />} שגר
          </button>
        </div>
        <div className="text-[9.5px] text-[color:var(--text-3)] mt-2">
          {/* FIX(Roast-65-e4 · F14): ההיצע קשור-למדיניות-המסילה (minSupplyMu/maxSupplyMu); ברירת-המחדל רק-כשאין-מדיניות */}
          היצע-השקה: {fmtInt(Math.floor(launchSupplyMu / 1000))} טוקן{lpad?.policy ? ` (לפי-מדיניות-המסילה: ${fmtInt(Math.floor(lpad.policy.minSupplyMu / 1000))}–${fmtInt(Math.floor(lpad.policy.maxSupplyMu / 1000))})` : ' (ברירת-מחדל — מדיניות-המסילה טרם-נטענה)'} · מחיר-פתיחה-שטוח · {newMode === 'lbp' ? `דצ'י-אוקציה ${lpad?.policy.lbpBlocks ?? 1200} בלוקים` : 'עקומה-עולה-עד-הסף'} · היוצר מקבל {lpad?.policy.creatorPct ?? 40}% מהעמלה-חי
        </div>
      </div>

      {/* רשימת-השקות */}
      <div className="space-y-2.5 mb-4 max-h-96 overflow-y-auto" data-testid="launch-list">
        {liveLaunches.length === 0 && (
          <div className="text-[11px] text-[color:var(--text-3)] rounded-lg bg-black/20 border border-[color:var(--line)] px-3 py-3">
            אין-השקות-חיות — שגר-טוקן-ראשון מהטופס-למעלה. כל-ההשקות גלויות-ודטרמיניסטיות: אפס-חברתנות, אפס-rug (הגיוס-נעול-בחשבון-ההשקה).
          </div>
        )}
        {liveLaunches.map(l => (
          <div key={l.id} className="rounded-xl border border-[color:var(--line)] bg-black/20 p-3.5" data-testid={`launch-${l.ticker}`}>
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
              <div className="flex items-center gap-2">
                <span className="dx-num font-black text-[13px] text-[color:var(--pink)]" dir="ltr">${l.ticker}</span>
                <span className="text-[10.5px] text-[color:var(--text-3)]">{l.name}</span>
                <span className={`text-[9px] rounded-full px-1.5 py-0.5 border ${l.mode === 'lbp' ? 'border-amber-500/40 text-amber-400' : 'border-[color:var(--line)] text-[color:var(--text-3)]'}`} dir="ltr">{l.mode.toUpperCase()}</span>
              </div>
              <div className="flex items-center gap-3 text-[10.5px]">
                <span className="dx-num text-[color:var(--text-1)]" dir="ltr">{(l.priceMu / 1000).toFixed(4)} USDS</span>
                <span className="dx-num text-[color:var(--text-3)]" dir="ltr">{fmtInt(l.raisedMu)}µ גויסו</span>
                {l.mode === 'lbp' && l.blocksLeft > 0 && <span className="dx-num text-amber-400" dir="ltr">{l.blocksLeft} בלוקים</span>}
              </div>
            </div>
            {/* התקדמות-לסף-ההגירה */}
            <div className="h-2 rounded-full bg-zinc-800 overflow-hidden mb-1" dir="ltr" aria-label="התקדמות להגירה">
              <div className="h-full bg-gradient-to-r from-[color:var(--pink)] to-[color:var(--green)]" style={{ width: `${Math.max(1.5, l.gradPctBps / 100)}%` }} />
            </div>
            <div className="flex justify-between text-[9.5px] text-[color:var(--text-3)] mb-2.5">
              <span dir="ltr">{(l.gradPctBps / 100).toFixed(1)}% לסף-ההגירה ({fmtInt(l.gradTargetMu)}µ)</span>
              {/* FIX(Roast-65-e4 · F15): זהו שווי-שוק (circulating×price), לא מחזור */}
              <span dir="ltr">שווי-שוק: {fmtInt(l.circulatingMu * (l.priceMu / 1000))}µ</span>
            </div>
            {/* קנייה/מכירה-מהירה */}
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => mutateLaunch({ action: 'buy', ticker: l.ticker, amount: 10_000 }, `lbuy-${l.ticker}`)}
                disabled={busy !== null}
                className="h-8 px-3 rounded-lg border border-[color:var(--green)]/40 bg-[color:var(--green-soft)] text-[color:var(--green)] text-[11px] font-bold hover:brightness-110 transition-all"
                data-testid={`launch-buy-${l.ticker}`}
              >
                {busy === `lbuy-${l.ticker}` ? <Loader2 className="w-3 h-3 animate-spin" /> : 'קנה 10 USDS'}
              </button>
              <button
                onClick={() => mutateLaunch({ action: 'sell', ticker: l.ticker, amount: 10_000 }, `lsell-${l.ticker}`)}
                disabled={busy !== null}
                className="h-8 px-3 rounded-lg border border-[color:var(--line)] text-[color:var(--text-2)] text-[11px] font-bold hover:border-[color:var(--line-strong)] transition-all"
                data-testid={`launch-sell-${l.ticker}`}
              >
                {busy === `lsell-${l.ticker}` ? <Loader2 className="w-3 h-3 animate-spin" /> : 'מכור 10 טוקן'}
              </button>
              {l.feesCreatorMu > 0 && <span className="dx-num text-[9.5px] text-[color:var(--text-3)] self-center" dir="ltr">יוצר: {fmtInt(l.feesCreatorMu)}µ · פלטפורמה: {fmtInt(l.feesPlatformMu)}µ</span>}
            </div>
          </div>
        ))}
        {gradLaunches.length > 0 && (
          <div className="text-[10px] text-[color:var(--text-3)] flex flex-wrap gap-1.5" data-testid="graduated-list">
            {gradLaunches.map(l => (
              <span key={l.id} className="rounded-full border border-[color:var(--green)]/40 bg-[color:var(--green-soft)] text-[color:var(--green)] px-2 py-0.5 font-semibold">
                <BadgeCheck className="w-3 h-3 inline" /> ${l.ticker} הוגר-ל-{l.poolKey} @h{fmtInt(l.gradH)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ProtoRev — הארביטראז'-הפנימי */}
      <div className="rounded-xl border border-[color:var(--line)] bg-black/20 p-4" data-testid="protorev-panel">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="w-7 h-7 rounded-lg bg-[color:var(--green-soft)] border border-[color:var(--green)]/30 flex items-center justify-center">
            <Crosshair className="w-3.5 h-3.5 text-[color:var(--green)]" />
          </span>
          <div className="flex-1 min-w-[180px]">
            <div className="text-[12px] font-bold">ProtoRev — ארביטראז'-פנימי-דטרמיניסטי</div>
            <div className="text-[9.5px] text-[color:var(--text-3)]">Osmosis-ProtoRev על הגרעין: הפרוטוקול צד-סטיות-ספר↔בריכה ומזרים-את-הרווח-לשריפה-ולקרן-ve — בלי-keepers-חוץ</div>
          </div>
          <span className="text-[10px] rounded-full border border-[color:var(--green)]/40 bg-[color:var(--green-soft)] text-[color:var(--green)] px-2.5 py-1 font-bold" dir="ltr">
            {prv?.state.runs ?? 0} הרצות · {fmtInt(prv?.state.profitMu ?? 0)}µ רווח
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          <MiniStat label="רווח-מצטבר" value={`${fmtInt(prv?.state.profitMu ?? 0)}µ`} sub="→ 40% שריפה · 40% ve · 20% אוצר" tone="green" />
          <MiniStat label="מחזורי-בריכות" value={fmtInt(prv?.state.cycles ?? 0)} sub="USDS→a→b→USDS" />
          <MiniStat label="סרבנויות-כנות" value={fmtInt(prv?.state.rejections ?? 0)} sub="מגן-minOut/הון" />
          <MiniStat label="USDS-אוצר (שולחן-הארב)" value={`${fmtInt(prv?.desk.usdsMu ?? 0)}µ`} sub={`רצפת-שולחן ${fmtInt(prv?.desk.deskFloorMu ?? 0)}µ`} />
        </div>
        <div className="space-y-1 max-h-40 overflow-y-auto" data-testid="protorev-spreads">
          {(prv?.spreads ?? []).map(s => (
            <div key={s.key} className="flex items-center justify-between text-[10px] rounded-lg bg-black/30 border border-[color:var(--line)] px-2.5 py-1.5">
              <span className="dx-num font-semibold" dir="ltr">{s.key}</span>
              <span className="flex items-center gap-3 dx-num" dir="ltr">
                <span className="text-[color:var(--text-3)]">mid {(s.midMu / 1000).toFixed(4)}</span>
                {/* FIX(Roast-65-e4 · F13): אדges-null מוצגים '—' — לא-עוד "nullbps" כש-edge חסר-אך-צד-קיים */}
                <span>bid {s.bidMu !== null && s.edgeBidBps != null ? `${s.edgeBidBps > 0 ? '+' : ''}${s.edgeBidBps}bps` : '—'}</span>
                <span>ask {s.askMu !== null && s.edgeAskBps != null ? `${s.edgeAskBps < 0 ? '' : '+'}${s.edgeAskBps}bps` : '—'}</span>
                {s.actionable && <span className="text-[color:var(--green)] font-bold">● ציד-חי</span>}
              </span>
            </div>
          ))}
        </div>
        {(prv?.recent ?? []).length > 0 && (
          <div className="mt-2 space-y-1" data-testid="protorev-log">
            {prv!.recent.slice(0, 3).map((j, i) => (
              <div key={`${j.h}-${i}`} className="text-[9.5px] text-[color:var(--text-3)] flex gap-2 dx-num" dir="ltr">
                <span>#{fmtInt(j.h)}</span><span className="text-[color:var(--text-2)] flex-1 truncate">{j.note}</span>
                {j.action === 'prv_run' && <span className="text-[color:var(--green)] font-bold">+{fmtInt(j.profitMu ?? 0)}µ</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
