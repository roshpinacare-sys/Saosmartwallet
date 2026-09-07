"use client";

/**
 * OrderBook — live STEEM/SBD depth ladder.
 * Asks stack worst→best (top to bottom), the mid/spread row sits between the
 * sides, bids best→worst below. Depth bars scale against the largest level in
 * view. Clicking a level prefills the trading terminal price.
 * Data: /api/steem/orderbook (5s) → get_order_book via the M1 client.
 */

import { AnimatePresence, motion } from "framer-motion";
import { BookOpenText, Loader2 } from "lucide-react";
import { useMemo } from "react";

import { LiveBadge, PanelHeader } from "@/components/dex/terminal-furniture";
import { fmtPrice, useMarketFeed, useOrderBook, type MarketLevel } from "@/hooks/use-steem-market";
import { cn } from "@/lib/utils";

const VIEW_ROWS = 9;

export function OrderBook({ onPickPrice }: { onPickPrice: (price: string, sideHint: "bid" | "ask") => void }) {
  const { data, isFetching, isError, error } = useOrderBook(25);
  const { data: feed } = useMarketFeed();

  const { asksView, bidsView, maxTotal } = useMemo(() => {
    const asks = data?.asks.slice(0, VIEW_ROWS) ?? [];
    const bids = data?.bids.slice(0, VIEW_ROWS) ?? [];
    const max = Math.max(1, ...asks.map((l) => l.steemSatoshis), ...bids.map((l) => l.steemSatoshis));
    return { asksView: asks, bidsView: bids, maxTotal: max };
  }, [data]);

  const last = Number(feed?.ticker.latest ?? 0);
  const bestAsk = asksView.length > 0 ? asksView[asksView.length - 1].priceNum : NaN;
  const bestBid = bidsView.length > 0 ? bidsView[0].priceNum : NaN;
  const mid = Number.isFinite(bestAsk) && Number.isFinite(bestBid) ? (bestAsk + bestBid) / 2 : last;

  return (
    <section className="glass flex flex-col overflow-hidden rounded-xl" aria-label="Order book">
      <PanelHeader
        title="Order Book"
        subtitle="STEEM/SBD · LIVE DEPTH"
        icon={<BookOpenText className="h-4 w-4" />}
        right={
          <div className="flex items-center gap-2">
            {isFetching ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-hidden /> : null}
            <LiveBadge active={!isError} />
          </div>
        }
      />

      {/* column heads */}
      <div className="grid grid-cols-[1.15fr_1fr_1fr] gap-1 border-b border-border/50 px-3 py-1.5 text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
        <span>Price (SBD)</span>
        <span className="text-right">Size (STEEM)</span>
        <span className="text-right">Total (SBD)</span>
      </div>

      {isError ? (
        <div className="px-4 py-10 text-center text-xs text-muted-foreground">
          order book unavailable — {error instanceof Error ? error.message : "rpc error"}
        </div>
      ) : (
        <div className="num relative min-h-[420px] flex-1 text-[11px]">
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
          <div className="sticky top-1/2 z-10 flex items-center justify-between border-y border-border/60 bg-secondary/60 px-3 py-2 backdrop-blur-sm">
            <span className="num text-sm font-bold text-foreground">{fmtPrice(mid)}</span>
            <span className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
              {bidsView.length + asksView.length} levels · {data?.asks.length ?? 0}+/{data?.bids.length ?? 0}-
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

      <div className="border-t border-border/60 px-3 py-2 text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
        showing best {VIEW_ROWS} levels per side · click a price to prefill the terminal
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
        "hover:bg-foreground/5 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--ring)]",
      )}
      aria-label={`${isAsk ? "Ask" : "Bid"} ${level.price} SBD per STEEM, size ${level.steemAmount} STEEM`}
    >
      {/* depth bar */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-[1px] right-0 -z-0 rounded-sm transition-[width] duration-500",
          isAsk
            ? "bg-[var(--down)]/[0.13]"
            : "bg-[var(--up)]/[0.13]",
        )}
        style={{ width }}
      />
      <span className={cn("relative z-10 text-left font-semibold", isAsk ? "text-[var(--down)]" : "text-[var(--up)]")}>
        {fmtPrice(level.priceNum)}
      </span>
      <span className="relative z-10 text-foreground/85">{level.steemAmount}</span>
      <span className="relative z-10 text-muted-foreground">{level.sbdAmount}</span>
    </motion.button>
  );
}
