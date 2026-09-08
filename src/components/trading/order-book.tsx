"use client";

/**
 * OrderBook — live STEEM/SBD depth: cumulative depth chart on top (real
 * cumulative bids/asks), ladder below. Asks stack worst→best, mid/spread row
 * between the sides, bids best→worst. Clicking a level prefills the terminal.
 * Data: /api/steem/orderbook (5s) — zero mock.
 */

import { AnimatePresence, motion } from "framer-motion";
import { BookOpenText, Loader2 } from "lucide-react";
import { useMemo } from "react";

import { DepthChart } from "@/components/terminal/charts";
import { FlashValue } from "@/components/terminal/motion-bits";
import { LiveBadge, PanelHeader } from "@/components/terminal/primitives";
import { fmtPrice, useMarketFeed, useOrderBook, type MarketLevel } from "@/hooks/use-steem-market";
import { cn } from "@/lib/utils";

const LADDER_ROWS = 8;

const POLL_MS = 5_000;

export function OrderBook({ onPickPrice }: { onPickPrice: (price: string, sideHint: "bid" | "ask") => void }) {
  const { data, isFetching, isError, error, dataUpdatedAt } = useOrderBook(25);
  const { data: feed } = useMarketFeed();

  const { asksView, bidsView, maxTotal } = useMemo(() => {
    const asks = data?.asks.slice(0, LADDER_ROWS) ?? [];
    const bids = data?.bids.slice(0, LADDER_ROWS) ?? [];
    const max = Math.max(1, ...asks.map((l) => l.steemSatoshis), ...bids.map((l) => l.steemSatoshis));
    return { asksView: asks, bidsView: bids, maxTotal: max };
  }, [data]);

  // Depth chart amounts in STEEM: satoshis here are precision-3 (1 STEEM = 1e3 sats).
  const depth = useMemo(
    () => ({
      asks: (data?.asks ?? []).slice(0, 14).map((l) => ({ priceNum: l.priceNum, amount: l.steemSatoshis / 1e3 })),
      bids: (data?.bids ?? []).slice(0, 14).map((l) => ({ priceNum: l.priceNum, amount: l.steemSatoshis / 1e3 })),
    }),
    [data],
  );

  const last = feed ? Number(feed.ticker.latest) : null;
  // asks are sorted cheapest-first — index 0 is the BEST ask
  const bestAsk = asksView.length > 0 ? asksView[0].priceNum : NaN;
  const bestBid = bidsView.length > 0 ? bidsView[0].priceNum : NaN;
  const mid = Number.isFinite(bestAsk) && Number.isFinite(bestBid) ? (bestAsk + bestBid) / 2 : NaN;

  // honesty: the badge must reflect data AGE, not just fetch success
  const bookAge = dataUpdatedAt > 0 ? Math.max(0, Date.now() - dataUpdatedAt) : Infinity;
  const stale = bookAge > POLL_MS * 2;
  const ageLabel = bookAge === Infinity ? "—" : bookAge < 60_000 ? `${Math.round(bookAge / 1000)}s` : `${Math.floor(bookAge / 60_000)}m`;

  return (
    <section className="glass flex flex-col overflow-hidden" aria-label="Order book">
      <PanelHeader
        title="Order Book"
        subtitle="STEEM/SBD · live depth"
        icon={<BookOpenText className="h-4 w-4" />}
        right={
          <div className="flex items-center gap-2">
            {isFetching ? <Loader2 className="h-3 w-3 animate-spin text-[var(--text-tertiary)]" aria-hidden /> : null}
            <span className="num text-[9px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">book {ageLabel} old</span>
            <LiveBadge active={!isError && !stale} />
          </div>
        }
      />

      {/* cumulative depth chart — real book */}
      <div className="border-b border-[var(--border-subtle)] p-3">
        <DepthChart bids={depth.bids} asks={depth.asks} height={150} priceDecimals={4} unit="STEEM" />
      </div>

      {isError ? (
        <div className="px-4 py-10 text-center text-xs text-[var(--text-tertiary)]">
          order book unavailable — {error instanceof Error ? error.message : "rpc error"}
        </div>
      ) : (
        <div className="num relative min-h-[380px] flex-1 text-[11px]">
          {/* column heads */}
          <div className="grid grid-cols-[1.15fr_1fr_1fr] gap-1 border-b border-[var(--border-subtle)] px-3 py-1.5 text-[9px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
            <span>Price (SBD)</span>
            <span className="text-right">Size (STEEM)</span>
            <span className="text-right">Total (SBD)</span>
          </div>

          {/* asks — reversed so the best ask touches the mid row */}
          <div className="flex flex-col-reverse">
            <AnimatePresence initial={false}>
              {asksView.map((lvl, idx) => (
                <BookRow
                  key={`a-${idx}-${lvl.price}-${lvl.created}`}
                  level={lvl}
                  maxTotal={maxTotal}
                  side="ask"
                  onPick={onPickPrice}
                />
              ))}
            </AnimatePresence>
          </div>

          {/* mid / last */}
          <div className="sticky top-1/2 z-10 flex items-center justify-between border-y border-[var(--border-default)] bg-[rgba(23,23,23,0.85)] px-3 py-2 backdrop-blur-sm">
            <span className="text-sm font-bold text-foreground">
              {Number.isFinite(mid) ? (
                <FlashValue value={mid} format={fmtPrice} />
              ) : (
                last !== null ? fmtPrice(last) : "—"
              )}
            </span>
            <span className="text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
              {bidsView.length + asksView.length} levels · {data?.asks.length ?? 0}+/{data?.bids.length ?? 0}−
            </span>
          </div>

          {/* bids */}
          <div>
            <AnimatePresence initial={false}>
              {bidsView.map((lvl, idx) => (
                <BookRow
                  key={`b-${idx}-${lvl.price}-${lvl.created}`}
                  level={lvl}
                  maxTotal={maxTotal}
                  side="bid"
                  onPick={onPickPrice}
                />
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      <div className="border-t border-[var(--border-subtle)] px-3 py-2 text-[9px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
        best {LADDER_ROWS} levels per side · click a price to prefill the terminal
      </div>
    </section>
  );
}

function BookRow({
  level,
  maxTotal,
  side,
  onPick,
}: {
  level: MarketLevel;
  maxTotal: number;
  side: "bid" | "ask";
  onPick: (price: string, sideHint: "bid" | "ask") => void;
}) {
  const isAsk = side === "ask";
  const width = `${Math.min(100, (level.steemSatoshis / maxTotal) * 100).toFixed(1)}%`;
  return (
    <motion.button
      layout
      initial={{ opacity: 0, x: isAsk ? 10 : -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
      onClick={() => onPick(level.price, side)}
      className={cn(
        "relative grid w-full grid-cols-[1.15fr_1fr_1fr] items-center gap-1 px-3 py-[5px] text-right transition-colors",
        "hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--ring)]",
      )}
      aria-label={`${isAsk ? "Ask" : "Bid"} ${level.price} SBD per STEEM, size ${level.steemAmount} STEEM`}
    >
      {/* depth bar */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-[1px] right-0 -z-0 rounded-sm transition-[width] duration-500",
          isAsk ? "bg-[var(--down)]/[0.14]" : "bg-[var(--up)]/[0.14]",
        )}
        style={{ width }}
      />
      <span className={cn("relative z-10 text-left font-semibold", isAsk ? "text-[var(--down)]" : "text-[var(--up)]")}>
        {fmtPrice(level.priceNum)}
      </span>
      <span className="relative z-10 text-foreground/85">{level.steemAmount}</span>
      <span className="relative z-10 text-[var(--text-tertiary)]">{level.sbdAmount}</span>
    </motion.button>
  );
}
