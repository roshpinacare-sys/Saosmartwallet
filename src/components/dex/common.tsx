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
};
export type Wallet = { name: string; credits: number; balances: Record<string, number>; locked: Record<string, number> };
export type Soldier = { name: string; saos: number; usds: number; equity: number; pnl: number; liveQuotes: number; locked: Record<string, number> };
export type ArenaData = {
  params: { enabled: boolean; spreadBps: number; stepBps: number; levels: number; sizeMu: number; maxInventoryMu: number; minEdgeBps: number; noise: boolean };
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

export type RouteLeg = { kind: 'pool' | 'wrap'; venue: string; from: string; to: string; inMu: number; outMu: number; priceMu: number };
export type RouteQuote = {
  amountOutMu: number; effPriceMu: number; legs: RouteLeg[];
  alternatives: Array<{ amountOutMu: number; path: string[] }>;
};
export type RoutableEntry = { asset: string; tier: string; note?: string };
export type LpValuation = { key: string; valueMu: number; sharePct?: number };

export const DEX_ASSETS = ['SAOS', 'USDS', 'WSTEEM', 'ENERGY', 'WSBD', 'PHIVE', 'STEEM'] as const;
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

// ── wallet balance helper ──
export function walletBal(world: World | null, wallet: string, asset: string): number {
  return world?.wallets.find(w => w.name === wallet)?.balances[asset] ?? 0;
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
