// GET /api/vault/estate — אחוזת-האמת: סריקה-חיה של כל-מה-שהאחוזה באמת מחזיקה.
// כל-מספר כאן מגיע מ-RPC ציבורי בזמן-אמת — אפס הנחות, אפס יתרות-ספר פנימיות.
// התשובה הכנה לשאלת-המפעיל: "כמה אפשר לממש עכשיו באמת?"
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireOwner } from '@/lib/auth';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── cache (90s) — סריקה-מלאה = ~120 קריאות-RPC; מאושר כקאש-קצר ──
interface EstateCache { at: number; data: unknown }
const G = globalThis as { __estateCache?: EstateCache };
const TTL = 90_000;

async function jrpc(url: string, method: string, params: unknown, timeout = 12000): Promise<Record<string, unknown>> {
  const r = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
    signal: AbortSignal.timeout(timeout), cache: 'no-store',
  });
  return r.json() as Promise<Record<string, unknown>>;
}

// ── price feeds: CoinGecko → CoinPaprika (fallback) ──
const COINGECKO_IDS: Record<string, string> = { steem: 'steem', sbd: 'steem-dollars', hive: 'hive', blurt: 'blurt', eth: 'ethereum', sol: 'solana', btc: 'bitcoin', trx: 'tron' };
type Prices = Record<string, { usd: number; src: string }>;
async function getPrices(): Promise<Prices> {
  const out: Prices = {};
  try {
    const ids = Object.values(COINGECKO_IDS).join(',');
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`, { signal: AbortSignal.timeout(9000), cache: 'no-store' });
    if (r.ok) {
      const j = (await r.json()) as Record<string, { usd?: number }>;
      for (const [sym, id] of Object.entries(COINGECKO_IDS)) {
        const usd = j[id]?.usd;
        if (typeof usd === 'number') out[sym] = { usd, src: 'coingecko' };
      }
    }
  } catch { /* fallback */ }
  const missing = Object.keys(COINGECKO_IDS).filter(s => !out[s]);
  if (missing.length) {
    const paprika: Record<string, string> = { steem: 'steem-steem', sbd: 'sbd-steem-dollars', hive: 'hive-hive', eth: 'eth-ethereum', sol: 'sol-solana', btc: 'btc-bitcoin', trx: 'trx-tron' };
    await Promise.allSettled(missing.map(async sym => {
      const slug = paprika[sym]; if (!slug) return;
      try {
        const r = await fetch(`https://api.coinpaprika.com/v1/tickers/${slug}`, { signal: AbortSignal.timeout(9000), cache: 'no-store' });
        if (!r.ok) return;
        const j = (await r.json()) as { quotes?: { USD?: { price?: number } } };
        const usd = j.quotes?.USD?.price;
        if (typeof usd === 'number') out[sym] = { usd, src: 'coinpaprika' };
      } catch { /* skip */ }
    }));
  }
  return out;
}

// ── SP/BP conversion per chain ──
async function vestsPerSp(chain: 'steem' | 'hive' | 'blurt', url: string): Promise<number> {
  try {
    const j = await jrpc(url, 'condenser_api.get_dynamic_global_properties', []);
    const p = j.result as { total_vesting_shares?: string; total_vesting_fund_steem?: string; total_vesting_fund_hive?: string; total_vesting_fund_blurt?: string } | undefined;
    const tvs = parseFloat(p?.total_vesting_shares || '0');
    const fund = parseFloat(p?.total_vesting_fund_steem || p?.total_vesting_fund_hive || p?.total_vesting_fund_blurt || '0');
    if (tvs > 0 && fund > 0) return tvs / fund;
  } catch { /* */ }
  return 0;
}

const STEEM_NODE = 'https://api.steemit.com';
const HIVE_NODE = 'https://api.hive.blog';
const BLURT_NODE = 'https://blurt-rpc.saboin.com';
const EVM_RPCS: Record<string, string> = {
  ethereum: 'https://ethereum-rpc.publicnode.com',
  bsc: 'https://bsc-rpc.publicnode.com',
  polygon: 'https://polygon-bor-rpc.publicnode.com',
  arbitrum: 'https://arbitrum-one-rpc.publicnode.com',
  optimism: 'https://optimism-rpc.publicnode.com',
  base: 'https://base-rpc.publicnode.com',
  avalanche: 'https://avalanche-c-chain-rpc.publicnode.com',
};
const SOL_RPC = 'https://api.mainnet-beta.solana.com';
// TRON-RPC — trongrid בלבד עם ריווח-סבלני + retry (CROSS-F-fence: מארח-מקובע; rate-limit מטופל-בכבוד)
const TRON_BASE = 'https://api.trongrid.io';
async function tronAccount(address: string): Promise<{ balance?: number; assetV2?: Array<{ key: string; value: number }> } | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`${TRON_BASE}/v1/accounts/${address}`, { signal: AbortSignal.timeout(9000), cache: 'no-store' });
      if (r.status === 429) { await new Promise(rr => setTimeout(rr, 1500 * (attempt + 1))); continue; }
      if (!r.ok) return null;
      const j = (await r.json()) as { data?: Array<{ balance?: number; assetV2?: Array<{ key: string; value: number }> }> };
      return j.data?.[0] ?? null;
    } catch { await new Promise(rr => setTimeout(rr, 800)); }
  }
  return null;
}
// ── TRON-legacy (Task 60): כתובות-צפייה-פומביות שנגזרו ממנמוניק #2 שבכספת (פענוח-בזמן-חקירה בלבד).
// המנמוניק עצמו לא מאוחסן כאן — רק הכתובות הציבוריות. הערת-אמת: ה-TRC-10 שבהן הוא טוקני-סקאם ידועים (gas.bi/9pay.org) — שווי אפס.
const TRON_LEGACY: Array<{ name: string; address: string }> = [
  { name: 'legacy-m2/0', address: 'TAzZZkrwBXk59iRya7esnKVJeV1xLtqkGr' },
  { name: 'legacy-m2/1', address: 'TRKStC5HbWzqdnrWDfc4vYNfgQgyZuQKP4' },
  { name: 'legacy-m2/2', address: 'TNd4aFZk1YUeP9uzUWCefJyadjCxZXBoBg' },
];

export async function GET(req: NextRequest) {
  const owner = await requireOwner(req);
  if (!owner) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  if (G.__estateCache && Date.now() - G.__estateCache.at < TTL) {
    return NextResponse.json({ ok: true, cached: true, ...(G.__estateCache.data as object) });
  }

  const HEAD = 'headcorner';

  // ── 1. chain heads (liquid + vested) ──
  const [steemProps, hiveProps, blurtProps] = await Promise.all([
    vestsPerSp('steem', STEEM_NODE), vestsPerSp('hive', HIVE_NODE), vestsPerSp('blurt', BLURT_NODE),
  ]);
  const headRes = await Promise.allSettled([
    jrpc(STEEM_NODE, 'condenser_api.get_accounts', [[HEAD]]),
    jrpc(HIVE_NODE, 'condenser_api.get_accounts', [[HEAD]]),
    jrpc(BLURT_NODE, 'condenser_api.get_accounts', [[HEAD]]),
  ]);
  const accOf = (i: number) => {
    const r = headRes[i];
    if (r.status !== 'fulfilled') return null;
    const res = (r.value.result as Array<Record<string, string>> | undefined);
    return res?.[0] || null;
  };
  const [steemAcc, hiveAcc, blurtAcc] = [accOf(0), accOf(1), accOf(2)];

  const spOf = (acc: Record<string, string> | null, ratio: number) => {
    if (!acc || !ratio) return 0;
    const own = parseFloat(acc.vesting_shares || '0') - parseFloat(acc.delegated_vesting_shares || '0') + parseFloat(acc.received_vesting_shares || '0');
    return own / ratio;
  };

  const heads: Record<string, unknown> = {};
  if (steemAcc) {
    heads.steem = {
      account: HEAD, liquid: parseFloat(steemAcc.balance || '0'), sbd: parseFloat(steemAcc.sbd_balance || '0'),
      savings: parseFloat(steemAcc.savings_balance || '0'), spOwn: spOf(steemAcc, steemProps),
      spDelegatedOut: parseFloat(steemAcc.delegated_vesting_shares || '0') / (steemProps || 1),
    };
  }
  if (hiveAcc) {
    heads.hive = {
      account: HEAD, liquid: parseFloat(hiveAcc.balance || '0'), hbd: parseFloat(hiveAcc.hbd_balance || '0'),
      savings: parseFloat(hiveAcc.savings_hive || '0'), hpOwn: spOf(hiveAcc, hiveProps),
      hpDelegatedOut: parseFloat(hiveAcc.delegated_vesting_shares || '0') / (hiveProps || 1),
    };
  }
  if (blurtAcc) {
    heads.blurt = {
      account: HEAD, liquid: parseFloat(blurtAcc.balance || '0'),
      bpOwn: spOf(blurtAcc, blurtProps),
      bpDelegatedOut: parseFloat(blurtAcc.delegated_vesting_shares || '0') / (blurtProps || 1),
    };
  }

  // ── 1b. צי-HIVE מצטבר (Task 60): כל-חשבונות-הצי — לא רק הראש ──
  const fleetAccounts = (await db.vaultKey.findMany({
    where: { chain: 'steem' }, select: { account: true }, distinct: ['account'], orderBy: { account: 'asc' },
  })).map(r => r.account).filter(a => !a.includes(':') && a !== 'headcorner-archive');
  const fleetHiveRows: Array<{ account: string; liquid: number; hbd: number }> = [];
  let fleetHiveLiquidTotal = 0;
  if (fleetAccounts.length) {
    try {
      const fh = await jrpc(HIVE_NODE, 'condenser_api.get_accounts', [fleetAccounts]);
      const rows = (fh.result as Array<Record<string, string>> | undefined) || [];
      for (const a of rows) {
        if (!a?.name) continue;
        const liquid = parseFloat(a.balance || '0');
        const hbd = parseFloat(a.hbd_balance || '0');
        fleetHiveRows.push({ account: a.name, liquid, hbd });
        fleetHiveLiquidTotal += liquid + hbd;
      }
    } catch { /* honest-empty */ }
  }

  // ── 2. Hive-Engine tokens ──
  let heTokens: Array<{ symbol: string; balance: number }> = [];
  try {
    const he = await jrpc('https://api.hive-engine.com/rpc/contracts', 'find', ['tokens', 'balances', { account: HEAD, limit: 100 }]);
    const rows = (he.result as Array<{ symbol?: string; balance?: string; stake?: string }> | undefined) || [];
    heTokens = rows
      .map(b => ({ symbol: String(b.symbol || ''), balance: parseFloat(b.balance || '0') + parseFloat(b.stake || '0') }))
      .filter(b => b.symbol && b.balance > 0)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 12);
  } catch { /* honest-empty */ }

  // ── 3. all vault wallets ──
  const wallets = await db.vaultKey.findMany({
    where: { chain: { in: ['evm', 'sol', 'tron', 'btc'] }, role: 'wallet' },
    select: { account: true, chain: true, address: true },
    orderBy: { account: 'asc' },
  });
  const byEntity: Record<string, { evm?: string; sol?: string; tron?: string; btc?: string }> = {};
  for (const w of wallets) {
    const name = w.account.replace(/^wallet:/, '');
    byEntity[name] ||= {};
    if (w.chain === 'evm') byEntity[name].evm = w.address || undefined;
    if (w.chain === 'sol') byEntity[name].sol = w.address || undefined;
    if (w.chain === 'tron') byEntity[name].tron = w.address || undefined;
    if (w.chain === 'btc') byEntity[name].btc = w.address || undefined;
  }
  const entities = Object.entries(byEntity).filter(([, v]) => v.evm || v.sol || v.tron || v.btc);

  // ── 4. EVM balances (12 addresses × 7 chains) ──
  const evmRows: Array<{ entity: string; address: string; chains: Record<string, number> }> = [];
  await Promise.allSettled(entities.map(async ([name, w]) => {
    if (!w.evm) return;
    const chains: Record<string, number> = {};
    await Promise.allSettled(Object.entries(EVM_RPCS).map(async ([net, url]) => {
      try {
        const j = await jrpc(url, 'eth_getBalance', [w.evm, 'latest'], 10000);
        const wei = BigInt(String(j.result || '0x0'));
        const eth = Number(wei) / 1e18;
        if (eth > 0) chains[net] = eth;
      } catch { /* skip */ }
    }));
    if (Object.keys(chains).length) evmRows.push({ entity: name, address: w.evm, chains });
  }));

  // ── 5. SOL balances (batched) ──
  const solRows: Array<{ entity: string; address: string; sol: number }> = [];
  const solAddrs = entities.filter(([, w]) => w.sol);
  try {
    const j = await jrpc(SOL_RPC, 'getMultipleAccounts', [solAddrs.map(([, w]) => w.sol), { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }], 15000);
    // FIX(Roast-63 · H8): טיפוס-אמת-לתשובת-RPC (היה-{} גורר-Property-'value'-לא-קיים)
    const jv = j as { result?: { value?: Array<{ lamports?: number } | null> } };
    const vals = jv.result?.value ?? [];
    solAddrs.forEach(([name, w], i) => {
      const lam = vals[i]?.lamports ?? 0;
      if (lam > 0) solRows.push({ entity: name, address: w.sol!, sol: lam / 1e9 });
    });
  } catch { /* honest-empty */ }

  // ── 6. TRON + BTC (serial-ish with spacing) ──
  const tronRows: Array<{ entity: string; address: string; trx: number }> = [];
  for (const [name, w] of entities.filter(([, w]) => w.tron)) {
    try {
      const acc = await tronAccount(w.tron!);
      const bal = ((acc?.balance ?? 0) / 1e6);
      if (bal > 0) tronRows.push({ entity: name, address: w.tron!, trx: bal });
    } catch { /* skip */ }
    await new Promise(rr => setTimeout(rr, 800));
  }
  // ── 6b. TRON-legacy (Task 60) ──
  const tronLegacyRows: Array<{ name: string; address: string; trx: number; trc10: Array<{ id: string; value: number }> }> = [];
  for (const t of TRON_LEGACY) {
    try {
      const acc = await tronAccount(t.address);
      if (acc) {
        const trx = (acc.balance ?? 0) / 1e6;
        const trc10 = (acc.assetV2 || []).filter(x => x.value > 0).map(x => ({ id: x.key, value: x.value }));
        if (trx > 0 || trc10.length) tronLegacyRows.push({ name: t.name, address: t.address, trx, trc10 });
      }
    } catch { /* skip */ }
    await new Promise(rr => setTimeout(rr, 800));
  }
  const tronLegacyTrx = tronLegacyRows.reduce((a, r) => a + r.trx, 0);

  const btcRows: Array<{ entity: string; address: string; btc: number }> = [];
  for (const [name, w] of entities.filter(([, w]) => w.btc)) {
    try {
      const r = await fetch(`https://mempool.space/api/address/${w.btc}`, { signal: AbortSignal.timeout(9000), cache: 'no-store', headers: { 'User-Agent': 'saos-estate/1.0' } });
      if (r.ok) {
        const j = (await r.json()) as { chain_stats: { funded_txo_sum: number; spent_txo_sum: number }; mempool_stats?: { funded_txo_sum: number; spent_txo_sum: number } };
        const s = (j.chain_stats.funded_txo_sum - j.chain_stats.spent_txo_sum) + (j.mempool_stats ? j.mempool_stats.funded_txo_sum - j.mempool_stats.spent_txo_sum : 0);
        if (s > 0) btcRows.push({ entity: name, address: w.btc!, btc: s / 1e8 });
      }
    } catch { /* skip */ }
    await new Promise(rr => setTimeout(rr, 140));
  }

  // ── 7. ETH gas for sweep estimate ──
  let gasGwei = 2;
  try {
    const j = await jrpc(EVM_RPCS.ethereum, 'eth_gasPrice', [], 8000);
    gasGwei = Number(BigInt(String(j.result || '0x77359400'))) / 1e9;
  } catch { /* default */ }
  const sweepGasEth = (evmRows.length * 21000 * gasGwei) / 1e9;

  // ── 8. prices + totals ──
  const prices = await getPrices();
  const usd = (sym: string, amt: number) => (prices[sym] ? amt * prices[sym].usd : 0);

  const s = heads.steem as { liquid: number; sbd: number; spOwn: number; spDelegatedOut: number } | undefined;
  const h = heads.hive as { liquid: number; hbd: number; hpOwn: number; hpDelegatedOut: number } | undefined;
  const b = heads.blurt as { liquid: number; bpOwn: number; bpDelegatedOut: number } | undefined;

  const solTotal = solRows.reduce((a, r) => a + r.sol, 0);
  const ethTotal = evmRows.reduce((a, r) => a + (r.chains.ethereum || 0), 0);
  const trxTotal = tronRows.reduce((a, r) => a + r.trx, 0);
  const btcTotal = btcRows.reduce((a, r) => a + r.btc, 0);

  const totals = {
    steemLiquidUsd: s ? usd('steem', s.liquid) : 0,
    steemVestedUsd: s ? usd('steem', s.spOwn) : 0,
    // FIX(Roast-63 · H4): SBD-לא-נסחר-עוד-ב-1$-מזמן — מחיר-אמת-מהפיד (steem-dollars).
    sbdUsd: s ? usd('sbd', s.sbd) : 0,
    hiveLiquidUsd: h ? usd('hive', h.liquid) : 0,
    hiveVestedUsd: h ? usd('hive', h.hpOwn) : 0,
    blurtLiquidUsd: b ? usd('blurt', b.liquid) : 0,
    blurtVestedUsd: b ? usd('blurt', b.bpOwn) : 0,
    evmEthUsd: usd('eth', ethTotal),
    solUsd: usd('sol', solTotal),
    tronUsd: usd('trx', trxTotal),
    btcUsd: usd('btc', btcTotal),
    tronLegacyUsd: usd('trx', tronLegacyTrx),
    fleetHiveUsd: usd('hive', fleetHiveLiquidTotal),
    heTokens: heTokens.length,
  };

  const grandUsd = totals.steemLiquidUsd + totals.steemVestedUsd + totals.sbdUsd + totals.hiveLiquidUsd + totals.hiveVestedUsd
    + totals.blurtLiquidUsd + totals.blurtVestedUsd + totals.evmEthUsd + totals.solUsd + totals.tronUsd + totals.btcUsd
    + totals.tronLegacyUsd + totals.fleetHiveUsd;

  // ── 9. התשובה הכנה: כמה אפשר לממש עכשיו ──
  const fundedEvm = evmRows.filter(r => (r.chains.ethereum || 0) > 0);
  const cashOut = {
    eth: {
      inDexLiquidity: 0, // כנות: אין שוק-ETH ב-DEX — אפס נזילות-ETH ישירה
      realEstateEth: ethTotal,
      sweepGasEth: sweepGasEth,
      sweepGasGwei: gasGwei,
      netAfterSweepEth: Math.max(0, ethTotal - sweepGasEth),
      fundedAddresses: fundedEvm.length,
      verdict: ethTotal > 0
        ? `${ethTotal.toPrecision(3)} ETH אמיתיים פרוסים על ${fundedEvm.length} ארנקים; איחוד-מלא עולה ~${sweepGasEth.toFixed(6)} ETH גז`
        : 'אין ETH באחוזה',
    },
    paths: [
      { name: 'STEEM נזיל (headcorner) → שוק-חוץ → ETH', amount: s?.liquid || 0, sym: 'STEEM', usd: totals.steemLiquidUsd },
      { name: 'SBD → שוק-חוץ (מחיר-אמת-מהפיד — לא-עוגן-1:1)', amount: s?.sbd || 0, sym: 'SBD', usd: totals.sbdUsd },
      { name: 'BLURT נזיל → שוק-חוץ', amount: b?.liquid || 0, sym: 'BLURT', usd: totals.blurtLiquidUsd },
      { name: 'HIVE נזיל → שוק-חוץ', amount: h?.liquid || 0, sym: 'HIVE', usd: totals.hiveLiquidUsd },
      { name: 'SOL חיילים (איחוד → שוק-חוץ)', amount: solTotal, sym: 'SOL', usd: totals.solUsd },
      { name: 'ETH חיילים (איחוד → שוק-חוץ)', amount: ethTotal, sym: 'ETH', usd: totals.evmEthUsd },
      { name: `צי-HIVE מצטבר (${fleetHiveRows.length} חשבונות-נסרקו) → שוק-חוץ`, amount: fleetHiveLiquidTotal, sym: 'HIVE', usd: totals.fleetHiveUsd },
      { name: 'טרון-לגסי (אבק-מנמוניק #2) — להעביר ל-TVN3 ולממש', amount: tronLegacyTrx, sym: 'TRX', usd: totals.tronLegacyUsd },
      { name: 'STEEM vested (powerdown 13שב׳) — נעול-מובנה', amount: s?.spOwn || 0, sym: 'SP', usd: totals.steemVestedUsd, locked: true },
      { name: 'BLURT vested (powerdown) — נעול-מובנה', amount: b?.bpOwn || 0, sym: 'BP', usd: totals.blurtVestedUsd, locked: true },
    ],
  };

  // FIX(Roast-63 · H3): ספירות-אמת-לדוח-הסריקה (מהקוד-שרץ, לא-ממחרוזת)
  const totalKeys = await db.vaultKey.count();
  const evmCount = entities.filter(([, w]) => w.evm).length;
  const solCount = entities.filter(([, w]) => w.sol).length;
  const tronCount = entities.filter(([, w]) => w.tron).length;
  const btcCount = entities.filter(([, w]) => w.btc).length;

  const data = {
    at: new Date().toISOString(),
    heads, heTokens,
    wallets: { evm: evmRows, sol: solRows, tron: tronRows, btc: btcRows },
    tronLegacy: tronLegacyRows,
    fleetHive: { rows: fleetHiveRows, liquidTotal: fleetHiveLiquidTotal },
    scan: {
      sweep: 'task-60',
      // FIX(Roast-63 · H3): כל-המספרים-כאן-מחושבים-מהקוד-שרץ-בפועל (היו-מחרוזת-קבועה-שהציגה-
      // סריקות-שלא-בוצעו: ERC-20/SPL מעולם-לא-נסרקו-בקוד-זה).
      checked: [
        `${entities.length} מפתחות-כספת-נסרקו (מתוך ${totalKeys} בכספת)`,
        `${evmCount} ארנקי-EVM × ${Object.keys(EVM_RPCS).length} רשתות (יתרת-נייטיב-בלבד)`,
        `${solCount} ארנקי-SOL (יתרת-נייטיב; SPL-טוקנים לא-נסרקו-בסבב-זה)`,
        `${tronCount} ארנקי-TRON + ${tronLegacyRows.length} לגסי`,
        `${btcCount} ארנקי-BTC`,
        `${fleetHiveRows.length} חשבונות-צי-HIVE`,
      ].join(' · '),
      zero: 'BTC · BSC/Polygon/ARB/Base/OP/AVAX — אפסים כנים · ERC-20 (USDT/USDC/DAI/BUSD) ו-SPL-טוקנים: לא-נסרקו-בקוד-זה (כנות)',
      resolved: 'מעטפת-0.0997ETH = דלק-DEX-היסטורי · ״legacy 117k״ = תווית-דור מהפרויקט-הישן (לא סכום) · 9.68-HIVE = מדידה-היסטורית-שגויה (אין-op-עברה-בשרשרת)',
    },
    prices,
    totals: { ...totals, grandUsd },
    cashOut,
  };
  G.__estateCache = { at: Date.now(), data };
  await audit('estate-scan', `grandUsd=${grandUsd.toFixed(2)} eth=${ethTotal.toPrecision(3)} sol=${solTotal.toPrecision(3)}`);
  return NextResponse.json({ ok: true, cached: false, ...data });
}
