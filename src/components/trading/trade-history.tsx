"use client";

/**
 * TradeHistory — the live tape: real fills from the internal market,
 * newest first, buy/sell colored, animated entry. Data: /api/steem/history
 * (12s) — zero mock.
 */

import { AnimatePresence, motion } from "framer-motion";
import { History } from "lucide-react";

import { LiveBadge, PanelHeader } from "@/components/terminal/primitives";
import { fmtClock, fmtPrice, useTradeHistory } from "@/hooks/use-steem-market";
import { cn } from "@/lib/utils";

export function TradeHistory() {
  const { data, isFetching, isError, error, dataUpdatedAt } = useTradeHistory(40);

  const fills = data?.fills ?? [];
  // honesty: the tape must reflect data AGE, not just fetch success
  const POLL_MS = 12_000;
  const tapeAge = dataUpdatedAt > 0 ? Math.max(0, Date.now() - dataUpdatedAt) : Infinity;
  const stale = tapeAge > POLL_MS * 2;

  return (
    <section className="glass flex flex-col overflow-hidden" aria-label="Trade history">
      <PanelHeader
        title="Trade History"
        subtitle="internal market · tape"
        icon={<History className="h-4 w-4" />}
        accent="info"
        right={
          <div className="flex items-center gap-2">
            {isFetching ? (
              <span className="num text-[9px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">syncing</span>
            ) : null}
            <span className="num text-[9px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
              tape {tapeAge === Infinity ? "—" : `${Math.round(tapeAge / 1000)}s`} old
            </span>
            <LiveBadge active={!isError && !stale} />
          </div>
        }
      />

      {isError ? (
        <div className="px-4 py-10 text-center text-xs text-[var(--text-tertiary)]">
          tape unavailable — {error instanceof Error ? error.message : "rpc error"}
        </div>
      ) : (
        <>
          {/* column heads */}
          <div className="grid grid-cols-[64px_1fr_1fr_1fr] gap-2 border-b border-[var(--border-subtle)] px-4 py-2 text-[9px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
            <span>Time</span>
            <span className="text-right">Price (SBD)</span>
            <span className="text-right">STEEM</span>
            <span className="text-right">SBD</span>
          </div>
          <div className="num scroll-thin max-h-[560px] min-h-[380px] flex-1 overflow-y-auto text-[11px]" aria-live="polite">
            <AnimatePresence initial={false}>
              {fills.map((f, i) => (
                <motion.div
                  key={`${f.date}-${i}`}
                  initial={{ opacity: 0, y: -6, backgroundColor: f.side === "buy" ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)" }}
                  animate={{ opacity: 1, y: 0, backgroundColor: "rgba(0,0,0,0)" }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.35 }}
                  className="grid grid-cols-[64px_1fr_1fr_1fr] items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-[6px] last:border-0 hover:bg-white/[0.02]"
                >
                  <span className="text-[var(--text-tertiary)]">{fmtClock(f.date)}</span>
                  <span className={cn("text-right font-semibold", f.side === "buy" ? "text-[var(--up)]" : "text-[var(--down)]")}>
                    {fmtPrice(f.price)}
                  </span>
                  <span className="text-right text-foreground/85">{f.steemAmount}</span>
                  <span className="text-right text-[var(--text-tertiary)]">{f.sbdAmount}</span>
                </motion.div>
              ))}
            </AnimatePresence>
            {fills.length === 0 ? (
              <p className="px-4 py-10 text-center text-[11px] text-[var(--text-tertiary)]">no recent fills on the tape</p>
            ) : null}
          </div>
          <div className="border-t border-[var(--border-subtle)] px-4 py-2 text-[9px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
            {fills.length} fills · window ends {fills.length > 0 ? fmtClock(fills[0].date) : "—"}
          </div>
        </>
      )}
    </section>
  );
}
