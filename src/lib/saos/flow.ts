/**
 * flow.ts — מנוע-הזרימה הריבוני (Task 71-flow) · איך מה שיש לנו באמת מייצר זרימה
 * ═════════════════════════════════════════════════════════════════════════════
 * אפס-המצאה: כל-מספר חי-ממקור-אמת — condenser RPC (STEEM/HIVE), TronGrid (TRON),
 * הכספת (זהויות), מנוע-הדקס (שוק-STEEM האמיתי), CoinGecko (מחירים).
 * לולאות-הזרימה (בלי-משתמשים · טווח-בינוני):
 *   A. grid-steem     — ספר-STEEM הפנימי (מייקר/ספרד) — מנוע-הדקס החי
 *   B. powerdown-drip — HP פנוי → STEEM נזיל (13 שבועות) → מזין-את-הספר
 *   C. curation       — HP שלנו מצביע-על-פוסטים-חיים → תגמולי-קיוריישן
 *   D. hbd-savings    — HBD → חיסכון 15% APR (פרמטר-שרשרת)
 *   E. trx-energize   — ארנק-המערכת האטום → אנרגיה+הצבעה ~4.5% APR (ממתין-הפקדה)
 */
import { db } from '@/lib/db';
import { getAccount, getGlobalProps, vestsToChainVests, condenser } from '@/lib/saos/steem-ops';
import { treasuryWallet, doorWallet, tronAccount } from '@/lib/saos/trx-ops';
import { planEnergize } from '@/lib/saos/tron-energize';

const HBD_SAVINGS_APR = 15; // hive DHF — פרמטר-שרשרת נוכחי
const CURATION_APR_EST = [0.5, 2.0]; // הערכה-כנה (תלוי-שותפויות-הצבעה) — מתויג-כהערכה
const TRX_VOTE_APR_EST = 4.5; // SR voting — הערכה-כנה

type CacheEntry = { at: number; data: unknown };
const CACHE = new Map<string, CacheEntry>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
  const v = await fn();
  CACHE.set(key, { at: Date.now(), data: v });
  return v;
}

export interface FlowLoop {
  id: string; title: string; engine: string;
  status: 'live' | 'armed' | 'waiting-deposit' | 'blocked';
  statusLabel: string;
  numbers: Array<{ k: string; v: string; hint?: string }>;
  verdict: string;
  actions: string[];
}

export interface FlowOverview {
  ok: true; ts: number;
  wallet: { sealed: boolean; address: string | null; fp: string | null; verified: boolean; source: string | null; note: string };
  treasury: {
    rows: Array<{ chain: string; label: string; items: Array<{ k: string; v: string }>; usd: number | null; ok: boolean }>;
    totalUsd: number | null; note: string;
  };
  loops: FlowLoop[];
  ledger: Array<{ id: string; action: string; detail: string; createdAt: string }>;
  note: string;
}

async function pricesUsd(): Promise<Record<string, number> | null> {
  return cached('cg-prices', 300_000, async () => {
    try {
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=steem,hive,blurt,tron&vs_currencies=usd', { signal: AbortSignal.timeout(12000) });
      if (!r.ok) return null;
      const j = (await r.json()) as Record<string, { usd?: number }>;
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(j)) if (typeof v.usd === 'number') out[k] = v.usd;
      return Object.keys(out).length ? out : null;
    } catch { return null; }
  });
}

async function dexGridSnapshot(): Promise<Record<string, unknown> | null> {
  return cached('dex-grid', 30_000, async () => {
    try {
      const r = await fetch('http://127.0.0.1:3010/saos-dex/api/dex/realmarket', { signal: AbortSignal.timeout(6000) });
      if (!r.ok) return null;
      return (await r.json()) as Record<string, unknown>;
    } catch { return null; }
  });
}

function fmt(n: number, d = 3): string { return n.toLocaleString('en-US', { maximumFractionDigits: d }); }

export async function flowOverview(): Promise<FlowOverview> {
  const [steemAcc, hiveAcc, props, prices, grid, treasury, door, blurtAcc] = await Promise.all([
    cached('steem-acc', 60_000, () => getAccount('steem').catch(() => null)),
    cached('hive-acc', 60_000, () => getAccount('hive').catch(() => null)),
    cached('steem-props', 60_000, () => getGlobalProps('steem').catch(() => null)),
    pricesUsd(),
    dexGridSnapshot(),
    treasuryWallet().catch(() => null),
    doorWallet().catch(() => null),
    cached('blurt-acc', 60_000, async () => {
      for (const url of ['https://rpc.blurt.world', 'https://rpc.blurtworld.com']) {
        try { return await condenser(url, 'condenser_api.get_accounts', [['headcorner']]); } catch { /* next */ }
      }
      return null;
    }),
  ]);
  const [doorInfo, treasuryInfo] = await Promise.all([
    door?.address ? cached(`tron-door-${door.address}`, 60_000, () => tronAccount(door.address!).catch(() => null)) : Promise.resolve(null),
    treasury?.address ? cached(`tron-treasury-${treasury.address}`, 60_000, () => tronAccount(treasury.address!).catch(() => null)) : Promise.resolve(null),
  ]);

  /* ── אוצר ── */
  const spPrice = prices?.steem ?? null;
  const hivePrice = prices?.hive ?? null;
  const blurtPrice = prices?.blurt ?? null;
  const trxPrice = prices?.tron ?? null;

  const steemVests = parseFloat(String(steemAcc?.vesting_shares ?? '0'));
  const steemDelegated = parseFloat(String(steemAcc?.delegated_vesting_shares ?? '0'));
  const steemReceived = parseFloat(String(steemAcc?.received_vesting_shares ?? '0'));
  const steemOwnVests = Math.max(0, steemVests - steemDelegated);
  const steemTotalVp = props ? vestsToChainVests(steemVests, props) : 0;
  const steemOwnVp = props ? vestsToChainVests(steemOwnVests, props) : 0;
  const steemLiquid = parseFloat(String(steemAcc?.balance ?? '0'));
  const steemSbd = parseFloat(String(steemAcc?.sbd_balance ?? '0'));
  const pdRate = parseFloat(String(steemAcc?.vesting_withdraw_rate ?? '0'));
  const pdRemaining = Number(steemAcc?.to_withdraw ?? 0) - Number(steemAcc?.withdrawn ?? 0);

  const hiveVests = parseFloat(String(hiveAcc?.vesting_shares ?? '0'));
  const hiveLiquid = parseFloat(String(hiveAcc?.balance ?? '0'));
  const hiveHbd = parseFloat(String(hiveAcc?.hbd_balance ?? '0'));
  const hiveHbdSavings = parseFloat(String(hiveAcc?.hbd_savings_balance ?? '0'));
  const hiveHsp = props ? hiveVests * (parseFloat(String(props.total_vesting_fund_steem)) / parseFloat(String(props.total_vesting_shares))) : 0;

  const blurtLiquid = blurtAcc?.[0] ? parseFloat(String(blurtAcc[0].balance ?? '0')) : null;

  const treasuryRows: FlowOverview['treasury']['rows'] = [
    {
      chain: 'STEEM', label: 'STEEM · headcorner', ok: !!steemAcc,
      usd: spPrice !== null ? steemLiquid * spPrice + steemSbd * spPrice : null,
      items: [
        { k: 'נזיל', v: `${fmt(steemLiquid)} STEEM` },
        { k: 'SBD', v: `${fmt(steemSbd)} SBD` },
        { k: 'SP כולל', v: `${fmt(steemTotalVp, 1)}` },
        { k: 'SP פנוי (לא-מואצל)', v: `${fmt(steemOwnVp, 1)}`, hint: `${fmt(steemDelegated / 1e6, 1)}M VESTS מואצלים לצי-ה-RC` },
        { k: 'פאוורדאון', v: pdRate > 0 ? `פעיל — ${fmt(pdRemaining / 1e13)} SP נותרו` : 'כבוי', hint: 'op: withdraw_vesting' },
      ],
    },
    {
      chain: 'HIVE', label: 'HIVE · headcorner', ok: !!hiveAcc,
      usd: hivePrice !== null ? hiveLiquid * hivePrice + hiveHbd * hivePrice : null,
      items: [
        { k: 'נזיל', v: `${fmt(hiveLiquid)} HIVE` },
        { k: 'HBD', v: `${fmt(hiveHbd)} HBD` },
        { k: 'HP', v: `${fmt(hiveHsp, 1)}` },
        { k: 'חיסכון-HBD', v: `${fmt(hiveHbdSavings)} HBD` },
      ],
    },
    {
      chain: 'BLURT', label: 'BLURT · headcorner', ok: blurtLiquid !== null,
      usd: blurtPrice !== null && blurtLiquid !== null ? blurtLiquid * blurtPrice : null,
      items: [{ k: 'RPC', v: blurtLiquid !== null ? 'חי' : 'לא-נגיש מהסנדבוקס (כנות)' }, ...(blurtLiquid !== null ? [{ k: 'נזיל', v: `${fmt(blurtLiquid)} BLURT` }] : [])],
    },
    {
      chain: 'TRON-DOOR', label: 'TRX · זהות-הדלת', ok: !!door,
      usd: trxPrice !== null && doorInfo ? doorInfo.balance * trxPrice : null,
      items: [
        { k: 'כתובת', v: door?.address ?? '—' },
        { k: 'יתרה', v: doorInfo ? `${fmt(doorInfo.balance, 4)} TRX` : 'לא-מדוד', hint: doorInfo && !doorInfo.active ? 'מעולם-לא-הייתה-פעילה בשרשרת' : undefined },
      ],
    },
    {
      chain: 'TRON-TREASURY', label: 'TRX · ארנק-המערכת (אטום)', ok: !!treasury,
      usd: trxPrice !== null && treasuryInfo ? treasuryInfo.balance * trxPrice : null,
      items: [
        { k: 'כתובת', v: treasury?.address ?? '—' },
        { k: 'יתרה', v: treasuryInfo ? `${fmt(treasuryInfo.balance, 4)} TRX` : 'לא-מדוד' },
        { k: 'מומש', v: treasuryInfo?.frozenV2.length ? treasuryInfo.frozenV2.map((f) => `${fmt(f.amount)} ${f.type}`).join(', ') : '0' },
      ],
    },
  ];
  const totalUsd = treasuryRows.every((r) => r.usd === null) ? null : treasuryRows.reduce((s, r) => s + (r.usd ?? 0), 0);

  /* ── לולאות ── */
  const loops: FlowLoop[] = [];

  // A. grid-steem
  const gridVerdict = String(grid?.verdict ?? grid?.status ?? '');
  const gridOrder = grid?.order ?? grid?.activeOrder ?? null;
  loops.push({
    id: 'grid-steem', title: 'שוק-STEEM הפנימי (מייקר-גריד)', engine: 'dex · realmarket',
    status: gridVerdict.includes('LIVE') ? 'live' : grid ? 'armed' : 'blocked',
    statusLabel: gridVerdict.includes('LIVE') ? 'חי' : grid ? 'חמוש' : 'מנוע-לא-נגיש',
    numbers: [
      { k: 'verdict', v: gridVerdict || 'אין-תשובה' },
      { k: 'הזמנה-חיה', v: gridOrder ? 'פעילה' : '—' },
      { k: 'מלאי-מסחר', v: `${fmt(steemLiquid)} STEEM + ${fmt(steemSbd)} SBD` },
    ],
    verdict: gridVerdict.includes('LIVE')
      ? 'מנוע-הספר האמיתי חי — הזמנות-מייקר על ספר-STEEM קולטות-ספרד. המלאי-הנזיל הוא-המגבלה (מיקרו-מנה). שליטה-מלאה בטאב בורסה/מסחר.'
      : grid ? 'המנוע-מגיב אך-ה-verdict לא-מאשר LIVE — בדיקה.' : 'מנוע-הדקס לא-נגיש מהסנדבוקס כרגע (כנות).',
    actions: [],
  });

  // B. powerdown-drip
  const powerdownableVp = steemOwnVp;
  const weekly = powerdownableVp / 13;
  loops.push({
    id: 'powerdown-drip', title: 'פאוורדאון-מנוע (HP פנוי → נזיל)', engine: 'steem · withdraw_vesting',
    status: pdRate > 0 ? 'live' : 'armed',
    statusLabel: pdRate > 0 ? 'מטפטף' : 'חמוש',
    numbers: [
      { k: 'SP פנוי', v: fmt(powerdownableVp, 1) },
      { k: 'טפטוף-אם-מופעל', v: `${fmt(weekly)} SP/שבוע × 13 שבועות`, hint: '~$' + (spPrice ? (weekly * 13 * spPrice).toFixed(2) : '—') + ' סה״כ' },
      { k: 'מצב-נוכחי', v: pdRate > 0 ? `${fmt(pdRemaining / 1e13)} SP בשחרור` : 'כבוי — החלטת-מפעיל' },
    ],
    verdict: pdRate > 0
      ? 'הטפטוף פעיל — STEEM נזיל זורם מדי-שבוע לחשבון.'
      : 'HP פנוי יושב-מנוצל. הפעלת-פאוורדאון מזרימה ~' + fmt(weekly) + ' SP/שבוע למלאי-הספר (עלות: ויתור-קיוריישן חלקי על החלק-הזה).',
    actions: ['steem_powerdown'],
  });

  // C. curation
  const lastVote = null; // מהפקדה — למטה מה-ledger
  loops.push({
    id: 'curation', title: 'קיוריישן (HP מצביע)', engine: 'steem · vote',
    status: steemOwnVp > 100 ? 'armed' : 'blocked',
    statusLabel: steemOwnVp > 100 ? 'חמוש' : 'אין-מסה',
    numbers: [
      { k: 'SP פנוי', v: fmt(steemOwnVp, 1) },
      { k: 'הערכת-תשואה', v: `${CURATION_APR_EST[0]}–${CURATION_APR_EST[1]}% APR (הערכה-כנה)`, hint: 'תלוי-מקורות-הצבעה' },
      { k: 'פעולה-אחרונה', v: lastVote ?? 'מהיומן למטה' },
    ],
    verdict: 'ה-HP הפנוי מצביע-על-פוסטים-חיים (1–18 שעות) — תגמולי-קיוריישן זורמים כ-VESTS. הצבעה-ראשונה תניב-ראיה-בשרשרת.',
    actions: ['steem_vote', 'autovote_pick'],
  });

  // D. hbd-savings
  loops.push({
    id: 'hbd-savings', title: 'חיסכון HBD', engine: 'hive · transfer_to_savings',
    status: hiveHbd >= 1 ? 'armed' : 'blocked',
    statusLabel: hiveHbd >= 1 ? 'חמוש' : 'מתחת-לרצפה',
    numbers: [
      { k: 'HBD זמין', v: fmt(hiveHbd) },
      { k: 'רצפה', v: '1 HBD' },
      { k: 'תשואה', v: `${HBD_SAVINGS_APR}% APR (פרמטר-שרשרת)` },
    ],
    verdict: hiveHbd >= 1
      ? `הפקדת ${fmt(hiveHbd)} HBD לחיסכון = ${HBD_SAVINGS_APR}% APR סטבילי, אפס-תחזוקה.`
      : 'יתרת HBD זעירה — הלולאה נטענת אוטומטית כשהיתרה תגדל (מסילת-HIVE חיה).',
    actions: hiveHbd >= 1 ? ['hive_savings_sweep'] : [],
  });

  // E. trx-energize
  const doorBal = doorInfo?.balance ?? 0;
  const treBal = treasuryInfo?.balance ?? 0;
  const funded = Math.max(doorBal, treBal);
  const plan = planEnergize({ trxStaked: Math.max(0, funded - 1.1), txsPerDayWanted: 4, trxPriceUsd: trxPrice });
  loops.push({
    id: 'trx-energize', title: 'אנרגיז-TRX (ארנק-המערכת)', engine: 'tron · freezeBalanceV2',
    status: funded >= 2 ? 'armed' : 'waiting-deposit',
    statusLabel: funded >= 2 ? 'חמוש' : 'ממתין-הפקדה',
    numbers: [
      { k: 'ארנק-מערכת', v: `${fmt(treBal, 4)} TRX` },
      { k: 'זהות-דלת', v: `${fmt(doorBal, 4)} TRX` },
      { k: 'תשואת-הצבעה', v: `~${TRX_VOTE_APR_EST}% APR (הערכה)` },
      { k: 'אנרגיה-אם-ממומש', v: `${plan.dailyEnergy.toLocaleString()} אנרגיה/יום`, hint: 'יישובי-USDT חינם' },
    ],
    verdict: funded >= 2
      ? 'הארנק ממומן — הימור-אנרגיה + הצבעת-SR ניתנים לביצוע-אמת עכשיו.'
      : 'הארנק אטום-ומאושר אך-ריק (כנות). הפקדה של TRX אל כתובת-המערכת תנעיל את לולאת-האנרגיה+התשואה אוטומטית.',
    actions: funded >= 2 ? ['trx_energize'] : [],
  });

  /* ── פקדה ── */
  const ledger = await db.auditLog.findMany({
    where: { action: { in: ['flow-vote', 'flow-powerdown', 'flow-savings', 'flow-energize', 'flow-claim', 'wallet-sealed-trx', 'wallet-address-corrected'] } },
    orderBy: { createdAt: 'desc' }, take: 12,
  });

  return {
    ok: true,
    ts: Date.now(),
    wallet: {
      sealed: !!treasury,
      address: treasury?.address ?? null,
      fp: treasury?.fingerprint ?? null,
      verified: false,
      source: 'upload-71-konami',
      note: 'ארנק-המערכת אטום-בהסכם (24 מילים · m/44\'/195\'/0\'/0/0) — המפעיל אישר שימוש להתחלת-זרימה',
    },
    treasury: {
      rows: treasuryRows,
      totalUsd: totalUsd !== null ? Number(totalUsd.toFixed(2)) : null,
      note: 'הכל-חי מ-RPC-ציבורי/כספת — מחירים מ-CoinGecko (null כשה-API נופל)',
    },
    loops,
    ledger: ledger.map((l) => ({ id: l.id, action: l.action, detail: l.detail.slice(0, 220), createdAt: l.createdAt.toISOString() })),
    note: 'מנוע-הזרימה: לולאות-בלי-משתמשים. כל-פעולה = dry-run ברירת-מחדל; ביצוע-אמת דורש-סשן-מפעיל + נרשם-בביקורת.',
  };
}
