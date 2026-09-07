"use client";

/**
 * DexHeader — Bloomberg-style quote strip. Live price with tick flashing,
 * 24h change/volume, spread, and chain vitals (head block, lag, endpoint).
 * Data: /api/steem/market (polled every 4s) → M1 client → api.steemit.com.
 */

import { motion } from "framer-motion";
import { Activity, Cable, Cpu, Layers, Radio, TrendingDown, TrendingUp } from "lucide-react";

import { FlashNumber, LiveBadge } from "@/components/dex/terminal-furniture";
import { fmtPrice, useMarketFeed } from "@/hooks/use-steem-market";
import { cn } from "@/lib/utils";

export function DexHeader() {
  const { data, isError, isLoading } = useMarketFeed();

  const ticker = data?.ticker;
  const change = ticker?.percentChange ?? 0;
  const changePct = change * 100;
  const up = change >= 0;
  const bid = ticker ? Number(ticker.highestBid) : NaN;
  const ask = ticker ? Number(ticker.lowestAsk) : NaN;
  const spread = Number.isFinite(bid) && Number.isFinite(ask) ? ask - bid : NaN;
  const spreadPct = Number.isFinite(spread) && ask > 0 ? (spread / ask) * 100 : NaN;
  const lag = data?.chainStatus.lagSeconds ?? 0;
  const live = !isError && lag > 0 && lag < 30;

  return (
    <header className="scanlines sticky top-0 z-40 border-b border-border/70 bg-background/78 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-2.5 sm:px-6">
        {/* brand */}
        <div className="flex items-center gap-3">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-md border border-[var(--up)]/40 bg-[var(--up)]/10 shadow-[0_0_18px_-4px_var(--up)]">
            <Cpu className="h-4.5 w-4.5 text-[var(--up)]" aria-hidden />
          </div>
          <div className="leading-tight">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold tracking-[0.22em] text-foreground">SAOSMART</span>
              <span className="num rounded-sm border border-[var(--up)]/40 bg-[var(--up)]/10 px-1.5 py-px text-[9px] font-bold tracking-[0.2em] text-[var(--up)]">
                M1·DEX
              </span>
            </div>
            <p className="text-[9px] uppercase tracking-[0.3em] text-muted-foreground">
              Internal Market Terminal
            </p>
          </div>
        </div>

        {/* pair + quote */}
        <div className="flex items-baseline gap-3">
          <div className="leading-none">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground/85">
              <Layers className="h-3 w-3 text-muted-foreground" aria-hidden />
              STEEM / SBD
            </div>
            <p className="mt-1 text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Internal Market</p>
          </div>
          {isLoading ? (
            <span className="num text-2xl text-muted-foreground">—.————</span>
          ) : (
            <FlashNumber
              value={Number(ticker?.latest ?? 0)}
              format={fmtPrice}
              className="num text-2xl font-bold text-foreground"
            />
          )}
          <span
            className={cn(
              "num inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-bold",
              up
                ? "border-[var(--up)]/35 bg-[var(--up)]/10 text-[var(--up)]"
                : "border-[var(--down)]/35 bg-[var(--down)]/10 text-[var(--down)]",
            )}
          >
            {up ? <TrendingUp className="h-3.5 w-3.5" aria-hidden /> : <TrendingDown className="h-3.5 w-3.5" aria-hidden />}
            {up ? "+" : ""}
            {changePct.toFixed(2)}%
          </span>
        </div>

        {/* vitals */}
        <div className="hidden items-center gap-5 lg:flex">
          <Vital icon={<Activity className="h-3 w-3" />} label="24H VOL" mono={`${ticker?.steemVolume ?? "—"} STEEM`} />
          <Vital icon={<Radio className="h-3 w-3" />} label="SPREAD" mono={Number.isFinite(spreadPct) ? `${spreadPct.toFixed(2)}%` : "—"} />
          <Vital
            icon={<Cable className="h-3 w-3" />}
            label="BID / ASK"
            mono={
              ticker ? (
                <>
                  <span className="text-[var(--up)]">{fmtPrice(bid)}</span>
                  <span className="text-muted-foreground"> / </span>
                  <span className="text-[var(--down)]">{fmtPrice(ask)}</span>
                </>
              ) : (
                "—"
              )
            }
          />
        </div>

        {/* chain status */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="ml-auto flex items-center gap-3"
          aria-live="polite"
        >
          <div className="hidden text-right sm:block">
            <p className="num text-[11px] font-semibold text-foreground/90">
              #{data?.chainStatus.headBlock.toLocaleString("en-US") ?? "—"}
            </p>
            <p className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
              HEAD · LAG {lag}s
            </p>
          </div>
          <LiveBadge active={live} />
        </motion.div>
      </div>
    </header>
  );
}

function Vital({ icon, label, mono }: { icon: React.ReactNode; label: string; mono: React.ReactNode }) {
  return (
    <div className="leading-tight">
      <p className="flex items-center gap-1 text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="num mt-0.5 text-[12px] font-semibold text-foreground/90">{mono}</p>
    </div>
  );
}
