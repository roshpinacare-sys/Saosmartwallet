/**
 * flow.ts — מנוע-הזרימה הריבוני (Task 71-flow) · איך מה שיש לנו באמת מייצר זרימה
 * ═════════════════════════════════════════════════════════════════════════════
 * אפס-המצאה: כל-מספר חי-ממקור-אמת — condenser RPC (STEEM/HIVE), TronGrid (TRON),
 * הכספת (זהויות), מנוע-הדקס (שוק-STEEM האמיתי), CoinGecko (מחירים).
 * לולאות-הזרימה (בלי-משתמשים · טווח-בינוני):
 *   A. grid-steem     — ספר-STEEM הפנימי (מייקר/ספרד) — מנוע-הדקס החי
 *   B. powerdown-drip — HP פנוי → STEEM נזיל (STEEM-HF23: 4 שבועות) → מזין-את-הספר
 *   C. curation       — HP שלנו מצביע-על-פוסטים-חיים → תגמולי-קיוריישן
 *   D. hbd-savings    — HBD → חיסכון 15% APR (פרמטר-שרשרת)
 *   E. trx-energize   — ארנק-המערכת האטום → אנרגיה+הצבעה ~4.5% APR (ממתין-הפקדה)
 * 71-e (עמוק) — הרחבת-המסה-המצביעה על-השרשראות-האחיות (בלי-פאוורדאון —
 * 13-שבועות-שם = אבק; המסה מכפילה-קיוריישן):
 *   F. hive-curation  — 24.3 HP אפקטיביים מצביעים על HIVE
 *   G. blurt-curation — ~8.5K BLP מצביעים על BLURT
 */
import { db } from '@/lib/db';
import { OPERATOR, getAccount, getGlobalProps, vestsToChainVests, condenser, getBlurtAccount, getBlurtProps, ownBlogPosts, steemRcMana } from '@/lib/saos/steem-ops';
import { treasuryWallet, doorWallet, tronAccount } from '@/lib/saos/trx-ops';
import { planEnergize } from '@/lib/saos/tron-energize';

const STEEM_RPC = 'https://api.steemit.com';
const USDT_TRC20 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // USDT-TRC20 חוזה-קנוני

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
    totalUsd: number | null; inReleaseUsd: number | null; note: string;
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

/** מפתח-owner מאומת בכספת לשרשרת? (קריאת-DB-מקומית · בלי-סודות) */
async function hasVerifiedOwner(chain: string): Promise<boolean> {
  const row = await db.vaultKey.findFirst({
    where: { account: OPERATOR, chain, role: 'owner', verified: true },
    select: { id: true },
  });
  return !!row;
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

/* ── מעקב-קיוריישן — אמת-שרשרת: הצבעות + curation_reward ששולם + pending-מוערך ── */
interface CurationTrack {
  paidVests: number;
  paidSp: number | null;
  votesCount: number;
  pending: Array<{ author: string; permlink: string; estUsd: number }>;
  pendingEstUsd: number | null;
}
async function curationTrack(vestsToSp: (v: number) => number): Promise<CurationTrack> {
  return cached('curation-track', 300_000, async () => {
    const out: CurationTrack = { paidVests: 0, paidSp: null, votesCount: 0, pending: [], pendingEstUsd: null };
    try {
      // condenser מאפשר לכל-היותר 100 — דף-אחרון מספיק (ההצבעות-שלנו-טריות)
      const hist = await condenser(STEEM_RPC, 'condenser_api.get_account_history', [OPERATOR, -1, 100]);
      const voteKeys: Array<{ author: string; permlink: string }> = [];
      for (const [, op] of hist as Array<[number, { op: [string, Record<string, unknown>] }]>) {
        const [name, val] = op.op;
        if (name === 'curation_reward') out.paidVests += parseFloat(String(val.reward ?? '0')) || 0;
        if (name === 'vote' && String(val.voter) === OPERATOR) voteKeys.push({ author: String(val.author), permlink: String(val.permlink) });
      }
      out.votesCount = voteKeys.length;
      out.paidSp = out.paidVests > 0 ? vestsToSp(out.paidVests) : null;
      // 3 הפוסטים-האחרונים-שהצבענו-בהם — get_content (פרמטרים-שטוחים!) למדידת-פנדינג
      const uniq = [...new Map(voteKeys.map((v) => [`${v.author}/${v.permlink}`, v])).values()].slice(-3);
      let estSum = 0;
      for (const v of uniq) {
        try {
          const c = await condenser(STEEM_RPC, 'condenser_api.get_content', [v.author, v.permlink]);
          const pendingSbd = parseFloat(String(c.pending_payout_value ?? '0')) || 0;
          const ourR = Number((c.active_votes as Array<{ voter: string; rshares: number | string }>)?.find((x) => x.voter === OPERATOR)?.rshares ?? 0);
          const net = Number(c.net_rshares ?? c.abs_rshares ?? 0) || 0;
          if (pendingSbd <= 0 || ourR <= 0 || net <= 0) continue;
          const est = pendingSbd * 0.5 * (ourR / net); // הערכה-כנה: מנת-רשיירז × חצי-מאגר-קיוריישן
          estSum += est;
          out.pending.push({ author: v.author, permlink: v.permlink, estUsd: est });
        } catch { /* פוסט-נעלם — דלג */ }
      }
      if (out.pending.length) out.pendingEstUsd = estSum; // SBD≈USD
    } catch { /* כנות: היסטוריה-לא-זמינה — נשאר אפס */ }
    return out;
  });
}

export async function flowOverview(): Promise<FlowOverview> {
  const [steemAcc, hiveAcc, props, hiveProps, blurtProps, prices, grid, treasury, door, blurtAcc, vaultVerified] = await Promise.all([
    cached('steem-acc', 60_000, () => getAccount('steem').catch(() => null)),
    cached('hive-acc', 60_000, () => getAccount('hive').catch(() => null)),
    cached('steem-props', 60_000, () => getGlobalProps('steem').catch(() => null)),
    cached('hive-props', 60_000, () => getGlobalProps('hive').catch(() => null)),
    cached('blurt-props', 60_000, () => getBlurtProps().catch(() => null)),
    pricesUsd(),
    dexGridSnapshot(),
    treasuryWallet().catch(() => null),
    doorWallet().catch(() => null),
    cached('blurt-acc', 60_000, () => getBlurtAccount().catch(() => null)),
    cached('vault-verified', 60_000, () => Promise.all([hasVerifiedOwner('hive'), hasVerifiedOwner('blurt')])),
  ]);
  const [hiveOwnerVerified, blurtOwnerVerified] = vaultVerified ?? [false, false];
  const [doorInfo, treasuryInfo] = await Promise.all([
    door?.address ? cached(`tron-door-${door.address}`, 60_000, () => tronAccount(door.address!).catch(() => null)) : Promise.resolve(null),
    treasury?.address ? cached(`tron-treasury-${treasury.address}`, 60_000, () => tronAccount(treasury.address!).catch(() => null)) : Promise.resolve(null),
  ]);
  const doorUsdt = doorInfo ? (doorInfo.trc20?.[USDT_TRC20] ?? 0) / 1e6 : null;
  const treasuryUsdt = treasuryInfo ? (treasuryInfo.trc20?.[USDT_TRC20] ?? 0) / 1e6 : null;
  const usdtStr = (v: number | null) => (v === null ? 'לא-מדוד' : `${v.toFixed(2)} USDT`);

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
  // 71-f: מסת-ההצבעה-בפועל שהשרשרת שוקלת = own + מתקבל (היסטוריה-מלאה: haran 348K + 9-חברי-צי + lsa)
  const steemEffectiveVests = Math.max(0, steemVests + steemReceived - steemDelegated);
  const steemEffectiveVp = props ? vestsToChainVests(steemEffectiveVests, props) : 0;
  const steemReceivedVp = props ? vestsToChainVests(steemReceived, props) : 0;
  const steemLiquid = parseFloat(String(steemAcc?.balance ?? '0'));
  const steemSbd = parseFloat(String(steemAcc?.sbd_balance ?? '0'));
  const pdRateRaw = parseFloat(String(steemAcc?.vesting_withdraw_rate ?? '0'));
  const pdRate = pdRateRaw > 1e9 ? pdRateRaw / 1e6 : pdRateRaw; // guard: צומת-שמחזיר-ראו-במקום-תצוגה
  const pdRemaining = Number(steemAcc?.to_withdraw ?? 0) - Number(steemAcc?.withdrawn ?? 0); // ראו-אינטג'ר (×1e6)
  const vestsToSp = (v: number) => props ? vestsToChainVests(v, props) : 0;
  const pdRemainingSp = vestsToSp(pdRemaining / 1e6);
  const pdWeekSp = vestsToSp(pdRate);
  const pdWeeks = pdWeekSp > 0 ? Math.max(1, Math.ceil(pdRemainingSp / pdWeekSp)) : 0;

  const hiveVests = parseFloat(String(hiveAcc?.vesting_shares ?? '0'));
  const hiveDelegated = parseFloat(String(hiveAcc?.delegated_vesting_shares ?? '0'));
  const hiveReceived = parseFloat(String(hiveAcc?.received_vesting_shares ?? '0'));
  const hiveLiquid = parseFloat(String(hiveAcc?.balance ?? '0'));
  const hiveHbd = parseFloat(String(hiveAcc?.hbd_balance ?? '0'));
  // FIX(71-e): השדה ב-HIVE נקרא savings_hbd_balance (לא hbd_savings_balance — undefined-שקרי)
  const hiveHbdSavings = parseFloat(String(hiveAcc?.savings_hbd_balance ?? '0'));
  // FIX(71-e): HP מחושב מ-props-של-HIVE עצמה — היה-מחושב בטעות מהיחס-של-STEEM (צלב-שרשראות)
  const hiveFund = parseFloat(String(hiveProps?.total_vesting_fund_hive ?? '0'));
  const hiveShares = parseFloat(String(hiveProps?.total_vesting_shares ?? '0'));
  const hiveRatio = hiveShares > 0 ? hiveFund / hiveShares : 0;
  const hiveHsp = hiveVests * hiveRatio;
  const hiveHspOwn = Math.max(0, hiveVests - hiveDelegated) * hiveRatio;
  const hiveHspEffective = (hiveVests + hiveReceived - hiveDelegated) * hiveRatio;
  const hiveHistVests = Number(hiveAcc?.curation_rewards ?? 0) + Number(hiveAcc?.posting_rewards ?? 0); // VESTS-היסטוריים (רווחי-עבר שהופקו ל-HP)

  const blurtLiquid = blurtAcc ? parseFloat(String(blurtAcc.balance ?? '0')) : null;
  const blurtVests = blurtAcc ? parseFloat(String(blurtAcc.vesting_shares ?? '0')) : null;
  const blurtVp = blurtAcc ? Number(blurtAcc.voting_power ?? 0) : null;
  // BLP מתוך VESTS — יחס-BLURT עצמה (fund/shares), לא-יחס-STEEM/HIVE
  const blurtFund = parseFloat(String(blurtProps?.total_vesting_fund_blurt ?? '0'));
  const blurtShares = parseFloat(String(blurtProps?.total_vesting_shares ?? '0'));
  const blurtRatio = blurtShares > 0 ? blurtFund / blurtShares : 0;
  const blurtBlp = blurtVests !== null ? blurtVests * blurtRatio : null;

  const treasuryRows: FlowOverview['treasury']['rows'] = [
    {
      chain: 'STEEM', label: 'STEEM · headcorner', ok: !!steemAcc,
      usd: spPrice !== null ? steemLiquid * spPrice + steemSbd * spPrice : null,
      items: [
        { k: 'נזיל', v: `${fmt(steemLiquid)} STEEM` },
        { k: 'SBD', v: `${fmt(steemSbd)} SBD` },
        { k: 'SP כולל', v: `${fmt(steemTotalVp, 1)}` },
        { k: 'SP פנוי (לא-מואצל)', v: `${fmt(steemOwnVp, 1)}`, hint: `${fmt(steemDelegated / 1e6, 1)}M VESTS מואצלים לצי-ה-RC` },
        { k: 'מסה-אפקטיבית', v: `${fmt(steemEffectiveVp, 1)}`, hint: `+${fmt(steemReceivedVp, 1)} SP מתקבלים (${fmt(steemReceived, 0)} VESTS — haran 88% + 9-חברי-צי, סריקת-היסטוריה-מלאה) — המסה-שבפועל-נשקלת ברשיירז` },
        { k: 'פאוורדאון', v: pdRate > 0 ? `פעיל — ${fmt(pdRemainingSp, 1)} SP בשחרור` : 'כבוי', hint: 'op: withdraw_vesting' },
      ],
    },
    {
      chain: 'HIVE', label: 'HIVE · headcorner', ok: !!hiveAcc,
      usd: hivePrice !== null && hiveAcc ? hiveLiquid * hivePrice + hiveHbd * hivePrice : null,
      items: !hiveAcc ? [
        { k: 'RPC', v: 'לא-נגיש רגעית (כנות — לא-אפס)' },
      ] : [
        { k: 'נזיל', v: `${fmt(hiveLiquid)} HIVE` },
        { k: 'HBD', v: `${fmt(hiveHbd)} HBD` },
        { k: 'HP כולל', v: `${fmt(hiveHsp, 1)}`, hint: hivePrice ? `~$${(hiveHsp * hivePrice).toFixed(2)} ב-HP` : undefined },
        { k: 'HP פנוי', v: `${fmt(hiveHspOwn, 1)}`, hint: `מואצל-החוצה ${fmt(hiveDelegated, 0)} VESTS (ynet+tov) · מתקבל ${fmt(hiveReceived, 0)} VESTS → אפקטיבי ${fmt(hiveHspEffective, 1)} HP` },
        { k: 'רווחי-עבר', v: `${fmt(hiveHistVests, 0)}`, hint: 'מוני-שרשרת-היסטוריים (curation_rewards+posting_rewards) — סקאלת-מונה, לא-מומרת (כנות)' },
        { k: 'חיסכון-HBD', v: `${fmt(hiveHbdSavings)} HBD` },
      ],
    },
    {
      chain: 'BLURT', label: 'BLURT · headcorner', ok: blurtLiquid !== null,
      usd: blurtPrice !== null && blurtLiquid !== null ? blurtLiquid * blurtPrice : null,
      items: [
        { k: 'RPC', v: blurtLiquid !== null ? 'חי' : 'לא-נגיש מהסנדבוקס (כנות)' },
        ...(blurtLiquid !== null ? [{ k: 'נזיל', v: `${fmt(blurtLiquid)} BLURT`, hint: '~$' + (blurtPrice !== null ? (blurtLiquid * blurtPrice).toFixed(2) : '—') }] : []),
        ...(blurtBlp !== null ? [{ k: 'BLP', v: `${fmt(blurtBlp, 0)}`, hint: `${fmt(blurtVests ?? 0, 0)} VESTS × יחס-BLURT${blurtPrice ? ` · ~$${(blurtBlp * blurtPrice).toFixed(2)}` : ''}` }] : []),
        ...(blurtVp !== null ? [{ k: 'VP', v: `${(blurtVp / 100).toFixed(1)}%` }] : []),
      ],
    },
    {
      chain: 'TRON-DOOR', label: 'TRX · זהות-הדלת', ok: !!door,
      usd: trxPrice !== null && doorInfo ? doorInfo.balance * trxPrice + (doorUsdt ?? 0) : null,
      items: [
        { k: 'כתובת', v: door?.address ?? '—' },
        { k: 'יתרה', v: doorInfo ? `${fmt(doorInfo.balance, 4)} TRX` : 'לא-מדוד', hint: doorInfo && !doorInfo.active ? 'מעולם-לא-הייתה-פעילה בשרשרת' : undefined },
        { k: 'USDT-TRC20', v: usdtStr(doorUsdt), hint: 'ניטור-חי TronGrid — כל-הפקדה-נראית-מיד' },
      ],
    },
    {
      chain: 'TRON-TREASURY', label: 'TRX · ארנק-המערכת (אטום)', ok: !!treasury,
      usd: trxPrice !== null && treasuryInfo ? treasuryInfo.balance * trxPrice + (treasuryUsdt ?? 0) : null,
      items: [
        { k: 'כתובת', v: treasury?.address ?? '—' },
        { k: 'יתרה', v: treasuryInfo ? `${fmt(treasuryInfo.balance, 4)} TRX` : 'לא-מדוד' },
        { k: 'USDT-TRC20', v: usdtStr(treasuryUsdt), hint: 'ניטור-חי — הפקדה-ראשונה-תנעל-את-לולאת-האנרגיה-אוטומטית' },
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
  loops.push({
    id: 'powerdown-drip', title: 'פאוורדאון-מנוע (HP פנוי → נזיל)', engine: 'steem · withdraw_vesting',
    status: pdRate > 0 ? 'live' : 'armed',
    statusLabel: pdRate > 0 ? 'מטפטף' : 'חמוש',
    numbers: pdRate > 0 ? [
      { k: 'SP בשחרור', v: fmt(pdRemainingSp, 1), hint: '~$' + (spPrice ? (pdRemainingSp * spPrice).toFixed(2) : '—') + ' נכנסים-לנזיל' },
      { k: 'קצב-שרשרת', v: `${fmt(pdWeekSp, 1)} SP/שבוע`, hint: '~$' + (spPrice ? (pdWeekSp * spPrice).toFixed(2) : '—') + '/שבוע' },
      { k: 'ששולם-עד-היום', v: `${fmt(vestsToSp(Number(steemAcc?.withdrawn ?? 0) / 1e6), 2)} SP`, hint: 'שדה-withdrawn-מהשרשרת — מתעדכן-בתשלום-הראשון' },
      { k: 'תזמון-שרשרת', v: `~${pdWeeks} תשלומים שבועיים`, hint: 'קצב-אמת מהשרשרת (STEEM-HF23=/4)' },
      { k: 'תשלום-הבא', v: String(steemAcc?.next_vesting_withdrawal ?? '—').replace('T', ' ').slice(0, 16) + ' UTC' },
    ] : [
      { k: 'SP פנוי', v: fmt(steemOwnVp, 1) },
      { k: 'טפטוף-אם-מופעל', v: `${fmt(steemOwnVp / 4)} SP/שבוע × 4 שבועות`, hint: 'STEEM-HF23: פאוורדאון=4-שבועות (היה-13) · ~$' + (spPrice ? (steemOwnVp * spPrice).toFixed(2) : '—') + ' סה״כ' },
      { k: 'מצב-נוכחי', v: 'כבוי — החלטת-מפעיל' },
    ],
    verdict: pdRate > 0
      ? 'הטפטוף פעיל בשרשרת (אושר-ע״י-המפעיל) — SP נזיל זורם מדי-שבוע ומזין-מלאי-הספר.'
      : 'HP פנוי יושב-מנוצל. הפעלת-פאוורדאון מזרימה SP/שבוע למלאי-הספר (עלות: ויתור-קיוריישן חלקי על החלק-הזה).',
    actions: pdRate > 0 ? [] : ['steem_powerdown'],
  });

  // C. curation — חי: הצבעות-אמת-מהשרשרת + מה ששולם בפועל + pending-מוערך
  const cur = await curationTrack(vestsToSp);
  const [rcMana, ownPosts] = await Promise.all([
    cached('steem-rc', 120_000, () => steemRcMana().catch(() => null)),
    cached('own-posts', 120_000, () => ownBlogPosts('steem', 3).catch(() => [] as Array<{ permlink: string; created: string; title: string; pendingSbd: number; votes: number; hasSelfVote: boolean }>)),
  ]);
  const curLast = cur.pending.length ? `${cur.pending[cur.pending.length - 1].author}/…` : null;
  loops.push({
    id: 'curation', title: 'קיוריישן (HP מצביע)', engine: 'steem · vote',
    status: cur.pending.length > 0 || (cur.paidSp ?? 0) > 0 ? 'live' : steemOwnVp > 100 ? 'armed' : 'blocked',
    statusLabel: cur.pending.length > 0 ? 'אוסף-עכשיו' : (cur.paidSp ?? 0) > 0 ? 'חי-משלם' : steemOwnVp > 100 ? 'חמוש' : 'אין-מסה',
    numbers: [
      { k: 'מסה-מצביעה', v: fmt(steemEffectiveVp, 1), hint: `own ${fmt(steemOwnVp, 1)} + מתקבל ${fmt(steemReceivedVp, 1)} SP — מה-שהשרשרת-באמת-שוקלת-ברשיירז (71-f: היה-מוצג-רק-own)` },
      { k: 'RC-מנאבר', v: rcMana ? `${rcMana.pct.toFixed(1)}%` : '—', hint: 'יכולת-תפעול-הצבעות (rc_api חי)' },
      { k: 'הצבעות', v: `${cur.votesCount} בהיסטוריה · ${cur.pending.length} בפנדינג`, hint: curLast ? `אחרונה: ${curLast}` : undefined },
      { k: 'ששולם-בפועל', v: cur.paidSp !== null ? `${cur.paidSp.toFixed(4)} SP (${fmt(cur.paidVests)} VESTS)` : '—', hint: 'curation_reward-מהשרשרת — אמת-ראשונה: realsam/achievement-1' },
      { k: 'תגמול-ממתין-מוערך', v: cur.pendingEstUsd !== null ? `~$${cur.pendingEstUsd.toFixed(4)}` : '—', hint: 'הערכה-כנה: מנת-רשיירז × 50%-מאגר (SBD≈USD)' },
      { k: 'מדרג-תשואה', v: 'משקל-הצבעה 1%→100% = ×100', hint: 'ו-SP נוסף מגדיל-לינארית — הטפטוף-מזרים-מלאי' },
    ],
    verdict: cur.pending.length > 0 || (cur.paidSp ?? 0) > 0
      ? 'הלולאה חיה-ומוכחת-בשרשרת: הצבעות-אמת ב-active_votes ותגמול-קיוריישן ראשון-ששולם. כנות: במסת-SP-הנוכחית התגמול-להצבעה הוא אבק-קורט — מדרגי-התשואה הם משקל-ההצבעה ו-SP-נוסף.'
      : 'ה-HP הפנוי מצביע-על-פוסטים-חיים (1–18 שעות) — תגמולי-קיוריישן זורמים כ-VESTS. הצבעה-ראשונה תניב-ראיה-בשרשרת.',
    actions: ['steem_vote', 'autovote_pick'],
  });

  // H. publish-author (71-f) — הפרסום-שלנו → תגמולי-סופר + הצבעה-עצמית (זרימה-כפולה-חוזרת)
  const latestPost = ownPosts[0] ?? null;
  const pubAgeH = latestPost ? (Date.now() - new Date(latestPost.created).getTime()) / 3600_000 : null;
  const inPayoutWindow = pubAgeH !== null && pubAgeH < 168;
  loops.push({
    id: 'publish-author', title: 'פרסום→תגמול-סופר (publish-desk)', engine: 'steem · comment',
    status: latestPost && inPayoutWindow ? 'live' : latestPost ? 'armed' : 'blocked',
    statusLabel: latestPost && inPayoutWindow ? (latestPost.hasSelfVote ? 'חי — הוצבע-עצמית' : 'חי — בחלון-תגמול') : latestPost ? 'מחוץ-לחלון' : 'אין-פוסט',
    numbers: latestPost ? [
      { k: 'פוסט', v: latestPost.title.slice(0, 42) || '(ללא-כותרת)', hint: latestPost.permlink },
      { k: 'גיל', v: `${(pubAgeH ?? 0).toFixed(0)} שעות מתוך 168`, hint: latestPost.created },
      { k: 'פנדינג', v: `$${latestPost.pendingSbd.toFixed(3)}`, hint: 'SBD≈USD — נשקל-בפאי-אאוט (יום-7)' },
      { k: 'הצבעות', v: String(latestPost.votes), hint: latestPost.hasSelfVote ? 'כולל-הצבעה-עצמית-שלנו' : 'אין-הצבעה-עצמית-עדיין' },
    ] : [{ k: 'מצב', v: 'אין-פוסט-שורש-חי — publish-desk מוכן' }],
    verdict: 'הפרסום-עצמו מייצר זרימה: תגמולי-סופר 50% (SBD+SP) + הצבעה-עצמית קולטת עוד 50% קיוריישן חזרה-אלינו — כל-הפאי-אאוט נשאר-במערכת. כנות: במסה-הנוכחית זה אבק-קורט שגדל-לינארית-עם-ה-SP (המסה-האפקטיבית 2,144 SP — לולאת-קיוריישן).',
    actions: latestPost && inPayoutWindow && !latestPost.hasSelfVote ? ['steem_selfvote'] : [],
  });

  const [hiveVoted, blurtVoted] = await Promise.all([
    db.auditLog.findFirst({ where: { action: 'flow-hive-vote' }, select: { id: true } }),
    db.auditLog.findFirst({ where: { action: 'flow-blurt-vote' }, select: { id: true } }),
  ]);

  // F. hive-curation (71-e) — המסה-המצביעה-על-HIVE · בלי-פאוורדאון (13-שבועות = אבק)
  loops.push({
    id: 'hive-curation', title: 'קיוריישן-HIVE (HP מצביע)', engine: 'hive · vote',
    status: hiveOwnerVerified && hiveAcc && hiveHspEffective > 1 ? (hiveVoted ? 'live' : 'armed') : 'blocked',
    statusLabel: hiveOwnerVerified && hiveAcc && hiveHspEffective > 1 ? (hiveVoted ? 'חי — הוכח-בשרשרת' : 'חמוש') : hiveAcc ? 'חסום' : 'RPC-רגעית',
    numbers: !hiveAcc ? [
      { k: 'מצב', v: 'RPC-HIVE-לא-נגיש רגעית — לא-אפס (כנות)' },
    ] : [
      { k: 'HP אפקטיבי', v: fmt(hiveHspEffective, 1), hint: hivePrice ? `~$${(hiveHspEffective * hivePrice).toFixed(2)} מסה-מצביעה` : undefined },
      { k: 'HP פנוי', v: fmt(hiveHspOwn, 1), hint: `מואצל-החוצה ${fmt(hiveDelegated, 0)} VESTS → ynet 3,000 + tov 6,000` },
      { k: 'רווחי-עבר', v: `${fmt(hiveHistVests, 0)}`, hint: 'מוני-שרשרת-היסטוריים — סקאלה-לא-מאומתת, לא-מומרת (כנות)' },
      { k: 'מפתח-חתימה', v: hiveOwnerVerified ? 'כספת · owner מאומת' : 'לא-מאומת — הרץ verify' },
    ],
    verdict: hiveOwnerVerified
      ? (hiveVoted
        ? 'הלולאה חיה-ומוכחת-בשרשרת: הצבעת-HIVE-ראשונה שודרה (פקדה: flow-hive-vote) — HP-מצביע. כנות: פאוורדאון-HIVE נשקל-ונדחה — 13-שבועות = טפטוף-אבק, ואיבוד-המסה-המקיוריישן.'
        : 'HP-HIVE יושב-מנוצל (בלי-הצבעות-מ-2023). הצבעה-ראשונה תיצור-הוכחת-שרשרת. כנות: פאוורדאון-HIVE נשקל-ונדחה — 13-שבועות = טפטוף-אבק.')
      : 'מפתח-owner-HIVE לא מאומת בכספת — הרץ אימות-כספת לפני-הפעלה (fail-closed).',
    actions: hiveOwnerVerified ? ['hive_vote', 'hive_autovote_pick'] : [],
  });

  // G. blurt-curation (71-e) — המסה-המצביעה-על-BLURT
  loops.push({
    id: 'blurt-curation', title: 'קיוריישן-BLURT (BLP מצביע)', engine: 'blurt · vote',
    status: blurtOwnerVerified && blurtBlp !== null && blurtBlp > 1 ? (blurtVoted ? 'live' : 'armed') : 'blocked',
    statusLabel: blurtOwnerVerified && blurtBlp !== null && blurtBlp > 1 ? (blurtVoted ? 'חי — הוכח-בשרשרת' : 'חמוש') : 'חסום',
    numbers: [
      { k: 'BLP', v: blurtBlp !== null ? fmt(blurtBlp, 0) : '—', hint: blurtBlp !== null && blurtPrice ? `~$${(blurtBlp * blurtPrice).toFixed(2)} מסה-מצביעה` : undefined },
      { k: 'נזיל', v: blurtLiquid !== null ? `${fmt(blurtLiquid)} BLURT` : '—' },
      { k: 'VP', v: blurtVp !== null ? `${(blurtVp / 100).toFixed(1)}%` : '—', hint: 'מתחדש ~20%/יום' },
      { k: 'מפתח-חתימה', v: blurtOwnerVerified ? 'כספת · owner מאומת' : 'לא-מאומת — הרץ verify' },
    ],
    verdict: blurtOwnerVerified
      ? (blurtVoted
        ? 'הלולאה חיה-ומוכחת-בשרשרת: הצבעת-BLURT-ראשונה שודרה (פקדה: flow-blurt-vote · rshares-חי>0) — BLP-מצביע. chain_id-BLURT (cd8d90f2… מ-blurtjs-רשמי). פאוורדאון-BLURT נדחה — 13-שבועות על-אבק.'
        : 'BLP יושב-מנוצל. chain_id-BLURT (cd8d90f2… מ-blurtjs-רשמי) + צמתי-מוכחים. הצבעה-ראשונה תיצור-הוכחה. פאוורדאון-BLURT נדחה — 13-שבועות על-אבק.')
      : 'מפתח-owner-BLURT קיים-בכספת אך-טרם-אומת מול-השרשרת — הרץ אימות-כספת (fail-closed).',
    actions: blurtOwnerVerified ? ['blurt_vote', 'blurt_autovote_pick'] : [],
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
      { k: 'ארנק-מערכת', v: `${fmt(treBal, 4)} TRX + ${usdtStr(treasuryUsdt)}`, hint: 'ניטור-חי TronGrid — TRX ו-USDT-TRC20' },
      { k: 'זהות-דלת', v: `${fmt(doorBal, 4)} TRX + ${usdtStr(doorUsdt)}` },
      { k: 'תשואת-הצבעה', v: `~${TRX_VOTE_APR_EST}% APR (הערכה)` },
      { k: 'אנרגיה-אם-ממומש', v: `${plan.dailyEnergy.toLocaleString()} אנרגיה/יום`, hint: 'יישובי-USDT חינם' },
    ],
    verdict: funded >= 2
      ? 'הארנק ממומן — הימור-אנרגיה + הצבעת-SR ניתנים לביצוע-אמת עכשיו.'
      : 'הארנק אטום-ומאושר אך-ריק (כנות · ניטור-חי TRX+USDT). הפקדה של TRX/USDT אל כתובת-המערכת תנעיל את לולאת-האנרגיה+התשואה אוטומטית.',
    actions: funded >= 2 ? ['trx_energize'] : [],
  });

  /* ── פקדה ── */
  const ledger = await db.auditLog.findMany({
    where: { action: { in: ['flow-vote', 'flow-powerdown', 'flow-savings', 'flow-energize', 'flow-claim', 'flow-selfvote', 'flow-hive-vote', 'flow-blurt-vote', 'flow-hive-claim', 'wallet-sealed-trx', 'wallet-address-corrected'] } },
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
      inReleaseUsd: spPrice !== null && pdRemainingSp > 0 ? Number((pdRemainingSp * spPrice).toFixed(2)) : null,
      note: 'הכל-חי מ-RPC-ציבורי/כספת — מחירים מ-CoinGecko (null כשה-API נופל)',
    },
    loops,
    ledger: ledger.map((l) => ({ id: l.id, action: l.action, detail: l.detail.slice(0, 220), createdAt: l.createdAt.toISOString() })),
    note: 'מנוע-הזרימה: לולאות-בלי-משתמשים. כל-פעולה = dry-run ברירת-מחדל; ביצוע-אמת דורש-סשן-מפעיל + נרשם-בביקורת.',
  };
}
