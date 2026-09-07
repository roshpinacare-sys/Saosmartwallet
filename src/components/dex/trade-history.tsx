"use client";

/**
 * TradeHistory — the tape. Recent STEEM/SBD fills, newest first, colored by
 * aggressor side. Data: /api/steem/history (12s) → get_trade_history.
 */

import { AnimatePresence, motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, History, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { LiveBadge, PanelHeader } from "@/components/dex/terminal-furniture";
import { fmtPrice, timeAgo, useTradeHistory } from "@/hooks/use-steem-market";
import { cn } from "@/lib/utils";

export function TradeHistory() {
  const { data, isFetching, isError, error } = useTradeHistory(50);
  const [, setClock] = useState(0);

  // relative-time ticker
  useEffect(() => {
    const t = setInterval(() => setClock((c) => c + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const fills = data?.fills.slice(0, 40) ?? [];

  return (
    <section className="glass flex flex-col overflow-hidden rounded-xl" aria-label="Recent trades">
      <PanelHeader
        title="Trade History"
        subtitle="RECENT FILLS · NEWEST FIRST"
        icon={<History className="h-4 w-4" />}
        accent="amber"
        right={
          <div className="flex items-center gap-2">
            {isFetching ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-hidden /> : null}
            <LiveBadge active={!isError} />
          </div>
        }
      />

      <div className="grid grid-cols-[64px_1fr_1fr_44px] gap-1 border-b border-border/50 px-3 py-1.5 text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
        <span>Time</span>
        <span className="text-right">Price (SBD)</span>
        <span className="text-right">Amount (STEEM)</span>
        <span className="text-right">Side</span>
      </div>

      {isError ? (
        <div className="px-4 py-10 text-center text-xs text-muted-foreground">
          tape unavailable — {error instanceof Error ? error.message : "rpc error"}
        </div>
      ) : fills.length === 0 ? (
        <div className="flex min-h-[420px] flex-1 flex-col items-center justify-center gap-2 px-4 py-10 text-center">
          <History className="h-6 w-6 text-muted-foreground/50" aria-hidden />
          <p className="text-xs text-muted-foreground">
            no fills in the last 48h — the internal market is quiet
          </p>
        </div>
      ) : (
        <div className="num scroll-thin max-h-[420px] min-h-[420px] flex-1 overflow-y-auto text-[11px]">
          <AnimatePresence initial={false}>
            {fills.map((f, idx) => (
              <motion.div
                key={`${f.date}-${f.steemSatoshis}-${f.sbdSatoshis}-${idx}`}
                initial={{ opacity: 0, y: -8, backgroundColor: "color-mix(in oklab, var(--amberterminal) 12%, transparent)" }}
                animate={{ opacity: 1, y: 0, backgroundColor: "transparent" }}
                transition={{ duration: 0.4 }}
                className={cn(
                  "grid grid-cols-[64px_1fr_1fr_44px] items-center gap-1 px-3 py-[5px]",
                  idx % 2 === 1 && "bg-foreground/[0.025]",
                )}
              >
                <span className="text-muted-foreground" title={f.date}>
                  {timeAgo(f.date)}
                </span>
                <span className={cn("text-right font-semibold", f.side === "buy" ? "text-[var(--up)]" : "text-[var(--down)]")}>
                  {fmtPrice(f.price)}
                </span>
                <span className="text-right text-foreground/85">{f.steemAmount}</span>
                <span className="flex justify-end">
                  {f.side === "buy" ? (
                    <ArrowUpRight className="h-3.5 w-3.5 text-[var(--up)]" aria-label="buy" />
                  ) : (
                    <ArrowDownRight className="h-3.5 w-3.5 text-[var(--down)]" aria-label="sell" />
                  )}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <div className="border-t border-border/60 px-3 py-2 text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
        window: 48h · aggressor side colored
      </div>
    </section>
  );
}
