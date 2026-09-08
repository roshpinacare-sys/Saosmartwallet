"use client";

/**
 * MarketStrip — the live band at the top of the MARKETS tab.
 * The external STEEM/SBD internal market (price, volume, spread) next to
 * SAOS-native sovereign-book facts (best bid/ask, floor price). Trading
 * data lives HERE — the landing tab is network identity, not tickers.
 * Every figure is chain/book-sourced; missing renders as honest "—".
 */

import { motion } from "framer-motion";
import { useMemo } from "react";
import { Boxes, Landmark, TrendingUp, Waves } from "lucide-react";

import { Sparkline } from "@/components/terminal/charts";
import { AnimatedNumber, Delta, FlashValue, useRollingHistory } from "@/components/terminal/motion-bits";
import { Skeleton } from "@/components/terminal/primitives";
import { fmtCompact, fmtMicroSaos, useEcoSaosNet } from "@/hooks/use-eco";
import { fmtPrice, useMarketFeed, useOrderBook } from "@/hooks/use-steem-market";

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};
const item = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.4, 0, 0.2, 1] as const } },
};

export function MarketStrip() {
  const { data: market, isLoading: mktLoading } = useMarketFeed();
  const { data: book } = useOrderBook();
  const { data: saos } = useEcoSaosNet();

  const last = market ? Number(market.ticker.latest) : null;
  const change = market ? market.ticker.percentChange : null;
  const priceHist = useRollingHistory("mkt:steemsbd", last, 64);

  const volumeSteem = useMemo(() => {
    if (!market) return null;
    const sat = market.ticker.steemVolumeSatoshis;
    return Number.isFinite(sat) ? sat / 1000 : null;
  }, [market]);

  const spread = useMemo(() => {
    const ask = book?.asks?.[0]?.price ?? null;
    const bid = book?.bids?.[0]?.price ?? null;
    // prices arrive as node-computed decimal strings — subtract numerically
    return ask !== null && bid !== null ? Number(ask) - Number(bid) : null;
  }, [book]);

  const sovBid = saos?.book?.bids?.[0]?.price ?? null;
  const sovAsk = saos?.book?.asks?.[0]?.price ?? null;
  const floor = saos?.engine?.floor ?? null;
  const treasury = saos?.engine?.treasuryPnlSAOS ?? null;

  return (
    <motion.section
      variants={container}
      initial="hidden"
      animate="show"
      aria-label="Market metrics"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"
    >
      {/* STEEM/SBD price */}
      <motion.div variants={item} className="glass glow-card col-span-2 flex flex-col gap-1 p-4 sm:col-span-1 xl:col-span-2">
        <p className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          <TrendingUp className="h-3 w-3 text-[var(--up)]" aria-hidden /> steem/sbd · internal market
        </p>
        {mktLoading || last === null ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <div className="flex items-baseline gap-2">
            <FlashValue value={last} format={fmtPrice} className="text-2xl font-bold leading-none text-foreground" />
            <Delta value={change} />
          </div>
        )}
        <Sparkline points={priceHist} color={change !== null && change < 0 ? "#ef4444" : "#10b981"} height={34} id="mkt-price" />
      </motion.div>

      {/* 24h volume */}
      <motion.div variants={item} className="glass glow-card flex flex-col gap-2 p-4">
        <p className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          <Boxes className="h-3 w-3 text-[var(--info)]" aria-hidden /> 24h volume
        </p>
        {volumeSteem === null ? (
          <Skeleton className="h-7 w-16" />
        ) : (
          <p className="num text-2xl font-bold leading-none text-foreground">
            <AnimatedNumber value={volumeSteem} format={fmtCompact} />
          </p>
        )}
        <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">STEEM settled</p>
      </motion.div>

      {/* internal market spread */}
      <motion.div variants={item} className="glass glow-card flex flex-col gap-2 p-4">
        <p className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          <Waves className="h-3 w-3 text-[var(--info)]" aria-hidden /> book spread
        </p>
        {spread === null ? (
          <Skeleton className="h-7 w-20" />
        ) : (
          <p className="num text-2xl font-bold leading-none text-foreground">{spread.toFixed(6)}</p>
        )}
        <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">STEEM/SBD · live book</p>
      </motion.div>

      {/* sovereign book */}
      <motion.div variants={item} className="glass glow-card flex flex-col gap-2 p-4">
        <p className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          <Landmark className="h-3 w-3 text-[var(--saos)]" aria-hidden /> saos/steem · sovereign book
        </p>
        {sovBid === null || sovAsk === null ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <p className="num text-lg font-bold leading-none">
            <span className="text-[var(--up)]">{sovBid.toFixed(6)}</span>
            <span className="mx-1 text-[var(--text-tertiary)]">/</span>
            <span className="text-[var(--down)]">{sovAsk.toFixed(6)}</span>
          </p>
        )}
        <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">bid / ask · our chain state</p>
      </motion.div>

      {/* floor + treasury */}
      <motion.div variants={item} className="glass glow-card flex flex-col gap-2 p-4">
        <p className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          <Landmark className="h-3 w-3 text-[var(--saos)]" aria-hidden /> saos floor
        </p>
        {floor === null ? (
          <Skeleton className="h-7 w-16" />
        ) : (
          <p className="num text-2xl font-bold leading-none text-foreground">{floor.toFixed(6)}</p>
        )}
        <p className="num text-[10px] text-[var(--text-tertiary)]">
          treasury{" "}
          <span style={{ color: (treasury ?? 0) >= 0 ? "var(--up)" : "var(--down)" }}>
            {treasury !== null ? fmtMicroSaos(treasury) : "—"}
          </span>
        </p>
      </motion.div>
    </motion.section>
  );
}
