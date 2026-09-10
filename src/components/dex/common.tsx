'use client';

// ─── SAOS DEX shared — types · world-state hook · formatters · token meta ──
// כל הנתונים חיים מהמנוע האמיתי: /saos-dex/api/dex/state (long-poll מבוסס-גרסה)
// מוטציות דרך /api/dx (פרוקסי מאובטח — סשן-בעלים בצד-הדפדפן, טוקן-מפעיל בצד-השרת)

import { useCallback, useEffect, useRef, useState } from 'react';
import { authHeaders } from '@/components/sv/shared';

// ── engine types (mirror of the daemon contract) ──
export type MarketBook = { price: number; total: number; orders: number };
export type Market = {
  base: string; quote: string; key: string;
  fair: number; bestBid: number; bestAsk: number; spreadBps: number;
  poolMid: number; refPrice: number; twap: number; twapSamples: number; twapDevBps: number;
  bids: MarketBook[]; asks: MarketBook[];
  chart: Array<{ t: number; p: number }>;
};
export type Pool = {
  key: string; a: string; b: string; ra: number; rb: number; lp: number;
  mid: number; swaps: number; feeAccruedTreasury: number; k: number;
  // FIX(Roast-65-e4 · F4): עמלת-הבריכה-החיה (bps) — אופציונלי עד-שהשרת-מספק; ה-UI מציג '—' כשחסר
  feeBps?: number;
  // FIX(Roast-70 · pol-truth): אמת-ה-POL מהמנוע (roast-68) — עמלות-שהוטבעו-ל-LP,
  // תשואת-עמלות-ליחידת-LP (lifetime, bps) וחלק-הנזילות-בבעלות-הפרוטוקול.
  lpFeesMu?: number; lpYieldBps?: number; polShareBps?: number;
};
export type Wallet = { name: string; credits: number; balances: Record<string, number>; locked: Record<string, number> };
export type Soldier = { name: string; saos: number; usds: number; equity: number; pnl: number; liveQuotes: number; locked: Record<string, number> };
export type ArenaData = {
  params: { enabled: boolean; spreadBps: number; stepBps: number; levels: number; sizeMu: number; maxInventoryMu: number; minEdgeBps: number; noise: boolean; requoteBps?: number };
  soldiers: Soldier[];
};
export type TapeRow = { kind: string; base: string; quote: string; price: number; amountMu: number; taker: string; maker: string; at: number; h: number };
export type Seal = { fromHeight: number; toHeight: number; root: string; stateRoot: string; leaves: number; at: number; digest: string };
export type WorldProofs = { seals: Seal[]; receipts: unknown[]; blockWindow: unknown };
export type ChainState = {
  height: number; tps: number; stateRoot: string; gasUsed: number; opsTotal: number;
  fills: number; swaps: number; liveOrders: number; uptimeSec: number; halted: boolean; haltReason: string | null;
  sealEvery: number; nextSealIn: number; feeMeter: number; treasuryProfit: number; lastBlockAgoMs: number;
  ladder?: { refPrice: number; lifts: number; spentMu: number };
  assets?: Record<string, { refPrice?: number }>;
  backing?: unknown;
  // FIX(Roast-70 · honesty): דחיות-פעולות-אחרונות + מיכל-הגז — האמת-על-מה-המנוע-דחה וכמה-דלק-ממומן.
  gasFundedMu?: number;
  rejectedLast?: { h: number; count: number; sample: string[] };
  // FIX(Roast-70 · income/rail/milestone): הכנסות-האוצר, מסילת-המיקרו ועוגן-אבני-הדרך —
  // כבר-חיים-בטרמינל-המנוע; עכשיו גם ב-UI-האם.
  income?: { poolFeesMu: number; feeMeterMu: number; treasuryProfitMu: number; ladderSpentMu: number; backingWsteemMu: number; hub: string };
  rail?: { enabled: boolean; equityMu: number; fundedMu: number; netMu: number; doses: number; note: string };
  milestone?: { enabled: boolean; started?: boolean; anchored: number; skippedNoRc: number; skippedGap: number; errors: number; lastAnchorAt: number | null; lastNetMu: number | null; lastHeight: number | null; lastTxid: string | null; lastAccount: string | null; lastError: string | null; note: string };
};
export type World = {
  version: number;
  state: ChainState;
  markets: Market[];
  pools: Pool[];
  wallets: Wallet[];
  arena: ArenaData;
  proofs: WorldProofs;
  tape: TapeRow[];
  tick: number;
};

// FIX(Roast-65-e4 · F4): feeBps-פר-רגל — משמש-להצגת-עמלה-אמת בסוואפ כשהשרת מספק אותה
export type RouteLeg = { kind: 'pool' | 'wrap'; venue: string; from: string; to: string; inMu: number; outMu: number; priceMu: number; feeBps?: number };
export type RouteQuote = {
  amountOutMu: number; effPriceMu: number; legs: RouteLeg[];
  alternatives: Array<{ amountOutMu: number; path: string[] }>;
};
export type RoutableEntry = { asset: string; tier: string; note?: string };
export type LpValuation = { key: string; valueMu: number; sharePct?: number };

// FIX(Roast-70 · real-assets): WBLURT (עטיפה-מגובה-1:1 ב-BLURT, roast-66) ו-LB|LA (טוקן-השקה
// שסיים-לבריכה-חיה) היו-נכסי-מנוע-אמת אך-בלתי-נראים-ל-UI — עכשיו סחירים/מוצגים.
export const DEX_ASSETS = ['SAOS', 'USDS', 'WSTEEM', 'ENERGY', 'WSBD', 'PHIVE', 'STEEM', 'WBLURT', 'LB|LA'] as const;
export type DexAsset = (typeof DEX_ASSETS)[number];

// deterministic token identity — pastel medallion + honest label
export const TOKEN_META: Record<string, { name: string; hue: number }> = {
  SAOS: { name: 'SAOS', hue: 316 },      // פינק — המטבע הריבוני
  USDS: { name: 'USDS', hue: 45 },       // זהב — השקל הדיגיטלי
  WSTEEM: { name: 'Wrapped STEEM', hue: 22 },
  STEEM: { name: 'STEEM', hue: 22 },
  WSBD: { name: 'Wrapped SBD', hue: 0 },
  ENERGY: { name: 'ENERGY', hue: 155 },
  PHIVE: { name: 'pHIVE', hue: 40 },
  WBLURT: { name: 'Wrapped BLURT', hue: 210 },   // עטיפה 1:1 מגובה ב-BLURT
  'LB|LA': { name: 'Launch A', hue: 265 },       // טוקן-השקה (launchpad)
};

export function tokenColor(sym: string): string {
  const h = TOKEN_META[sym]?.hue ?? ((sym.charCodeAt(0) * 7) % 360);
  return `hsl(${h} 62% 52%)`;
}

export function TokenMedallion({ sym, size = 28 }: { sym: string; size?: number }) {
  const c = tokenColor(sym);
  return (
    <span
      className="dx-token"
      style={{
        width: size, height: size, fontSize: size * 0.34,
        background: `linear-gradient(135deg, ${c}26, ${c}55)`,
        border: `1px solid ${c}66`, color: c,
      }}
      aria-hidden
    >
      {(TOKEN_META[sym]?.name || sym).slice(0, 1)}
    </span>
  );
}

// ── formatting — µ is the engine's integer unit (1 unit = 1000µ) ──
export const MU = 1000;
export function fmtMu(mu: number, digits = 2): string {
  const v = mu / MU;
  return v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}
export function fmtInt(n: number): string {
  return Math.floor(n).toLocaleString('en-US');
}
export function fmtPrice(mu: number): string {
  return (mu / MU).toLocaleString('en-US', { maximumFractionDigits: 3 });
}
export function fmtBps(bps: number): string {
  return (bps / 100).toFixed(2) + '%';
}
export function fmtAgoMs(ms: number): string {
  if (ms < 1500) return 'עכשיו';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `לפני ${s} שנ׳`;
  return `לפני ${Math.floor(s / 60)} דק׳`;
}

// ── the world-state hook — event long-poll on the live engine ──
export function useDexWorld() {
  const [world, setWorld] = useState<World | null>(null);
  const [online, setOnline] = useState(false);
  const verRef = useRef(0);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const r = await fetch(`/saos-dex/api/dex/state${verRef.current ? `?v=${verRef.current}` : ''}`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(20000),
        });
        const j = (await r.json()) as World & { ok: boolean };
        if (!aliveRef.current) return;
        if (j.ok) {
          setOnline(true);
          setWorld(j);
          verRef.current = j.version;
        }
      } catch {
        if (!aliveRef.current) return;
        setOnline(false);
      }
      if (aliveRef.current) timer = setTimeout(poll, 50);
    };
    poll();
    return () => { aliveRef.current = false; clearTimeout(timer); };
  }, []);

  const refetchNow = useCallback(async () => {
    try {
      const r = await fetch('/saos-dex/api/dex/state', { cache: 'no-store' });
      const j = await r.json();
      if (j.ok) { setWorld(j); verRef.current = j.version; }
    } catch { /* */ }
  }, []);

  return { world, online, refetchNow };
}

// ── FIX(Roast-65-e4 · F7): לולאת-סקירה-מכובדת ──
// השהיה-בהסתרת-טאב (visibilitychange) · backoff-אקספוננציאלי-עם-jitter בכישלון ·
// ודגל "נתונים-ישנים" במקום catch-שקט — הנתון-הישן נשאר-אך-מסומן-ככזה.
// ה-fetcher מחזיר true רק-על-קבלת-נתון-תקין; ה-hook מסמן stale רק-אחרי-הצלחה-ראשונה.
export function usePoll(fetcher: () => Promise<boolean>, periodMs: number): boolean {
  const [stale, setStale] = useState(false);
  const fRef = useRef(fetcher);
  useEffect(() => { fRef.current = fetcher; });
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let backoff = 1;
    let everOk = false;
    const tick = async () => {
      if (!alive) return;
      let hidden = false;
      try { hidden = document.visibilityState === 'hidden'; } catch { /* no DOM */ }
      if (hidden) { timer = setTimeout(tick, periodMs); return; }
      let ok = false;
      try { ok = await fRef.current(); } catch { ok = false; }
      if (!alive) return;
      if (ok) { everOk = true; setStale(false); }
      else if (everOk) setStale(true);
      const delay = ok ? periodMs : Math.min(periodMs * 2 ** backoff, 60_000) + Math.floor(Math.random() * 1_000);
      backoff = ok ? 1 : Math.min(backoff + 1, 5);
      timer = setTimeout(tick, delay);
    };
    const onVis = () => {
      let visible = false;
      try { visible = document.visibilityState === 'visible'; } catch { /* no DOM */ }
      if (visible && alive) { clearTimeout(timer); void tick(); }
    };
    void tick();
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); };
  }, [periodMs]);
  return stale;
}

// FIX(Roast-65-e4 · F7): שבב-"נתונים-ישנים" — חיווי-כן כשהרענון-נכשל והמסך מציג מדידה-קודמת
export function StaleChip({ show = true, className = '' }: { show?: boolean; className?: string }) {
  if (!show) return null;
  return (
    <span role="status" data-testid="stale-chip" className={`inline-flex items-center gap-1.5 rounded-full border border-[color:var(--amber)]/40 bg-[color:var(--amber-soft)] px-2.5 py-1 text-[10.5px] font-semibold text-[color:var(--amber)] ${className}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--amber)]" aria-hidden />
      נתונים-ישנים — הרענון נכשל, מוצגת-המדידה-האחרונה
    </span>
  );
}

// ── wallet balance helper ──
export function walletBal(world: World | null, wallet: string, asset: string): number {
  return world?.wallets.find(w => w.name === wallet)?.balances[asset] ?? 0;
}

// FIX(Roast-70 · lp-valuation): שווי-עמדת-LP — חלק-יחסי משתי-שמורות-הבריכה במחירי-האוצר החיים.
// מגשים-את-ההבטחה "שווי-LP נפרד למטה" שהייתה-עד-היום מילים-בלי-מספר.
// אין-מחיר-אוצר לאחד-הנכסים → null (כנות: לא-ממציאים הערכה).
export function lpValueMu(world: World | null, poolKey: string, lpBal: number): number | null {
  if (!world || lpBal <= 0) return null;
  const p = world.pools.find(x => x.key === poolKey);
  if (!p || p.lp <= 0) return null;
  const ref = (a: string): number => (a === 'USDS' ? MU : world.state.assets?.[a]?.refPrice ?? 0);
  const ra = ref(p.a), rb = ref(p.b);
  if (!ra || !rb) return null;
  const poolValueMu = (p.ra / MU) * ra + (p.rb / MU) * rb;
  return Math.floor((poolValueMu * lpBal) / p.lp);
}

// ── mutations — through the secured bridge ──
export type DxResult = { ok: boolean; error?: string; note?: string; [k: string]: unknown };
export async function dxPost(action: string, payload: Record<string, unknown>): Promise<DxResult> {
  try {
    const r = await fetch('/api/dx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ action, payload }),
    });
    return (await r.json()) as DxResult;
  } catch {
    return { ok: false, error: 'network-error', note: 'שגיאת רשת — נסה שוב' };
  }
}

// public quote (GET — no auth, the engine quote surface is read-only)
export async function routeQuote(assetIn: string, assetOut: string, amount: number): Promise<{ ok: boolean; quote?: RouteQuote | null; routable?: Record<string, RoutableEntry>; lpValuations?: LpValuation[]; error?: string }> {
  try {
    const r = await fetch(`/saos-dex/api/dex/route?assetIn=${assetIn}&assetOut=${assetOut}&amount=${Math.floor(amount)}`, { cache: 'no-store' });
    return await r.json();
  } catch {
    return { ok: false, error: 'network-error' };
  }
}
