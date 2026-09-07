"use client";

/**
 * TerminalHeader — command strip for the whole ecosystem: brand mark,
 * per-chain live LEDs, the STEEM/SBD anchor quote (flash + delta), a UTC
 * clock, and the chains-up counter.
 * Data: /api/eco/networks (7s) + /api/steem/market (4s) — zero mock.
 */

import { useEffect, useState } from "react";

import { LiveBadge, StatusDot } from "@/components/terminal/primitives";
import { FlashValue } from "@/components/terminal/motion-bits";
import { fmtPrice, useMarketFeed } from "@/hooks/use-steem-market";
import { useEcoNetworks } from "@/hooks/use-eco";

export function TerminalHeader() {
  const { data: net } = useEcoNetworks();
  const { data: market, isError: marketError } = useMarketFeed();
  const [clock, setClock] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setClock(new Date().toISOString().slice(11, 19));
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  const chains = net?.chains ?? [];
  const online = chains.filter((c) => c.status === "online").length;
  const ticker = market?.ticker;
  const lag = market?.chainStatus.lagSeconds ?? 0;
  const steemLive = !marketError && lag > 0 && lag < 30;

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border-default)] bg-[rgba(10,10,10,0.78)] backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-5 gap-y-2.5 px-4 py-2.5 sm:px-6">
        {/* brand */}
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--up)]/40 shadow-[0_0_18px_-4px_var(--up)]"
            style={{ background: "var(--gradient-success)" }}
            aria-hidden
          >
            <span className="text-[15px] font-black text-[#052e22]">▤</span>
          </div>
          <div className="leading-tight">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold tracking-[0.22em] text-foreground">SAOS&nbsp;GRID</span>
              <span className="num hidden rounded-full border border-[var(--up)]/40 bg-[var(--up)]/10 px-2 py-px text-[9px] font-bold tracking-[0.2em] text-[var(--up)] sm:inline">
                ECOSYSTEM COMMAND
              </span>
            </div>
            <p className="text-[9px] uppercase tracking-[0.3em] text-[var(--text-tertiary)]">
              8 repos · 5 chains · 1 sovereign economy
            </p>
          </div>
        </div>

        {/* chain LED strip */}
        <nav aria-label="Chain status strip" className="hidden items-center gap-2 lg:flex">
          {chains.map((c) => (
            <span
              key={c.id}
              title={`${c.name} — ${c.status}${c.headHeight ? ` · #${c.headHeight.toLocaleString("en-US")}` : ""}`}
              className="flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-white/[0.03] px-2 py-1 transition-colors hover:border-[var(--border-strong)]"
            >
              <StatusDot status={c.status} className="h-1.5 w-1.5" />
              <span className="num text-[10px] font-bold tracking-[0.12em] text-foreground/85">{c.name}</span>
            </span>
          ))}
          {chains.length === 0 ? (
            <span className="num text-[10px] text-[var(--text-tertiary)]">probing chains…</span>
          ) : null}
        </nav>

        {/* quote + clock */}
        <div className="ml-auto flex items-center gap-4">
          <div className="text-right leading-tight">
            <p className="text-[11px] font-semibold text-foreground/90">
              {ticker ? (
                <FlashValue value={Number(ticker.latest)} format={fmtPrice} />
              ) : (
                <span className="num text-[var(--text-tertiary)]">—.————</span>
              )}
              <span className="ml-1.5 text-[9px] font-normal tracking-[0.14em] text-[var(--text-tertiary)]">
                STEEM/SBD
              </span>
            </p>
            <p className="num text-[9px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
              {clock ? `UTC ${clock}` : "UTC —:—:—"}
            </p>
          </div>
          <div className="hidden text-right sm:block">
            <p className="num text-[11px] font-semibold text-foreground/90">
              {online > 0 ? `${online}/${chains.length || 5}` : "—"}
            </p>
            <p className="text-[9px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">CHAINS UP</p>
          </div>
          <LiveBadge active={steemLive} />
        </div>
      </div>
    </header>
  );
}
