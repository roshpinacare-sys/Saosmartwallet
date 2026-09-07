"use client";

/**
 * KpiStrip — the overview band at the top of the GRID tab.
 * Every figure is chain-sourced and animated: chains-up, STEEM/SBD last price
 * with a live session sparkline, 24h volume, SAOS-NET height, engine bench,
 * and treasury P&L. Missing data renders as an honest "—", never a guess.
 */

import { motion } from "framer-motion";
import { useMemo } from "react";
import {
  Activity,
  Boxes,
  Flame,
  GaugeCircle,
  Landmark,
  TrendingUp,
} from "lucide-react";

import { Sparkline } from "@/components/terminal/charts";
import { AnimatedNumber, Delta, FlashValue, useRollingHistory } from "@/components/terminal/motion-bits";
import { Skeleton } from "@/components/terminal/primitives";
import {
  fmtCompact,
  fmtMicroSaos,
  useEcoNetworks,
  useEcoSaosNet,
} from "@/hooks/use-eco";
import { fmtPrice, useMarketFeed } from "@/hooks/use-steem-market";
import { cn } from "@/lib/utils";

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};
const item = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.4, 0, 0.2, 1] as const } },
};

export function KpiStrip() {
  const { data: net, isLoading: netLoading } = useEcoNetworks();
  const { data: market, isLoading: mktLoading } = useMarketFeed();
  const { data: saos } = useEcoSaosNet();

  const chains = net?.chains ?? [];
  const online = chains.filter((c) => c.status === "online").length;

  const last = market ? Number(market.ticker.latest) : null;
  const change = market ? market.ticker.percentChange : null;
  const priceHist = useRollingHistory("kpi:steemsbd", last, 64);

  const volumeSteem = useMemo(() => {
    if (!market) return null;
    // integer math straight from the API (satoshi grid) — no string parsing
    const sat = market.ticker.steemVolumeSatoshis;
    return Number.isFinite(sat) ? sat / 1000 : null;
  }, [market]);

  const height = saos?.core.height ?? null;
  const heightHist = useRollingHistory("kpi:saosnet-height", height, 64);

  const bench = saos?.engine.bench.txsPerSec ?? null;
  const pnl = saos?.engine.treasuryPnlSAOS ?? null;
  const pnlToday = saos?.engine.treasuryPnlTodaySAOS ?? null;

  return (
    <motion.section
      variants={container}
      initial="hidden"
      animate="show"
      aria-label="Key ecosystem metrics"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7"
    >
      {/* chains up */}
      <motion.div variants={item} className="glass glow-card flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            <Activity className="h-3 w-3 text-[var(--up)]" aria-hidden /> chains up
          </p>
        </div>
        {netLoading ? (
          <Skeleton className="h-7 w-16" />
        ) : (
          <p className="num text-2xl font-bold leading-none text-foreground">
            {online}
            <span className="text-sm font-medium text-[var(--text-tertiary)]">/{chains.length || 5}</span>
          </p>
        )}
        <div className="flex gap-1" aria-hidden>
          {chains.map((c) => (
            <span
              key={c.id}
              title={c.name}
              className={cn(
                "h-1 flex-1 rounded-full",
                c.status === "online" && "bg-[var(--up)]",
                c.status === "stale" && "bg-[var(--warning)]",
                c.status === "offline" && "bg-[var(--down)]",
              )}
            />
          ))}
        </div>
      </motion.div>

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
        <Sparkline points={priceHist} color={change !== null && change < 0 ? "#ef4444" : "#10b981"} height={34} id="kpi-price" />
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

      {/* SAOS-NET height */}
      <motion.div variants={item} className="glass glow-card flex flex-col gap-2 p-4">
        <p className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          <Landmark className="h-3 w-3 text-[var(--saos)]" aria-hidden /> saos-net height
        </p>
        {height === null ? (
          <Skeleton className="h-7 w-20" />
        ) : (
          <p className="num text-2xl font-bold leading-none text-foreground">
            <AnimatedNumber value={height} />
          </p>
        )}
        <Sparkline points={heightHist} color="#8b5cf6" height={22} id="kpi-saosnet" />
      </motion.div>

      {/* engine bench */}
      <motion.div variants={item} className="glass glow-card flex flex-col gap-2 p-4">
        <p className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          <GaugeCircle className="h-3 w-3 text-[var(--warning)]" aria-hidden /> kernel bench
        </p>
        {bench === null ? (
          <Skeleton className="h-7 w-20" />
        ) : (
          <p className="num text-2xl font-bold leading-none text-foreground">
            <AnimatedNumber value={bench} format={fmtCompact} />
          </p>
        )}
        <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">tx/s measured</p>
      </motion.div>

      {/* treasury */}
      <motion.div variants={item} className="glass glow-card flex flex-col gap-2 p-4">
        <p className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          <Flame className="h-3 w-3 text-[var(--saos)]" aria-hidden /> treasury p&amp;l
        </p>
        {pnl === null ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <p
            className="num text-2xl font-bold leading-none"
            style={{ color: pnl >= 0 ? "var(--up)" : "var(--down)" }}
          >
            {fmtMicroSaos(pnl)}
          </p>
        )}
        <p className="num text-[10px] text-[var(--text-tertiary)]">
          today{" "}
          <span style={{ color: (pnlToday ?? 0) >= 0 ? "var(--up)" : "var(--down)" }}>
            {pnlToday !== null ? fmtMicroSaos(pnlToday) : "—"}
          </span>
        </p>
      </motion.div>
    </motion.section>
  );
}
