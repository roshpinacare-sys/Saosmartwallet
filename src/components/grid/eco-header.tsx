"use client";

/**
 * EcoHeader — command-strip for the whole ecosystem: brand, UTC clock,
 * a live LED per probed chain, and the STEEM/SBD anchor quote.
 * Data: /api/eco/networks (7s) + /api/steem/market (4s) — zero mock.
 */

import { useEffect, useState } from "react";

import { LiveBadge } from "@/components/dex/terminal-furniture";
import { FlashNumber } from "@/components/dex/terminal-furniture";
import { StatusDot } from "@/components/grid/eco-bits";
import { fmtPrice, useMarketFeed } from "@/hooks/use-steem-market";
import { useEcoNetworks } from "@/hooks/use-eco";
import { cn } from "@/lib/utils";

export function EcoHeader() {
  const { data: net } = useEcoNetworks();
  const { data: market, isError: marketError } = useMarketFeed();
  const [clock, setClock] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setClock(new Date().toISOString().slice(11, 19));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  const chains = net?.chains ?? [];
  const online = chains.filter((c) => c.status === "online").length;
  const ticker = market?.ticker;
  const lag = market?.chainStatus.lagSeconds ?? 0;
  const steemLive = !marketError && lag > 0 && lag < 30;

  return (
    <header className="scanlines sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-5 gap-y-2.5 px-4 py-2.5 sm:px-6">
        {/* brand */}
        <div className="flex items-center gap-3">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-md border border-[var(--up)]/40 bg-[var(--up)]/10 shadow-[0_0_18px_-4px_var(--up)]">
            <span aria-hidden className="text-[15px] font-black text-[var(--up)]">▤</span>
          </div>
          <div className="leading-tight">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold tracking-[0.22em] text-foreground">SAOS&nbsp;GRID</span>
              <span className="num rounded-sm border border-[var(--up)]/40 bg-[var(--up)]/10 px-1.5 py-px text-[9px] font-bold tracking-[0.2em] text-[var(--up)]">
                ECOSYSTEM COMMAND
              </span>
            </div>
            <p className="text-[9px] uppercase tracking-[0.3em] text-muted-foreground">
              8 repos · 5 chains · 1 sovereign economy
            </p>
          </div>
        </div>

        {/* chain LED strip */}
        <nav aria-label="Chain status strip" className="hidden items-center gap-2.5 md:flex">
          {chains.map((c) => (
            <span
              key={c.id}
              title={`${c.name} — ${c.status}${c.headHeight ? ` · #${c.headHeight.toLocaleString("en-US")}` : ""}`}
              className="flex items-center gap-1.5 rounded-sm border border-border/60 bg-secondary/40 px-2 py-1"
            >
              <StatusDot status={c.status} className="h-1.5 w-1.5" />
              <span className="num text-[10px] font-bold tracking-[0.12em] text-foreground/85">{c.name}</span>
            </span>
          ))}
          {chains.length === 0 ? (
            <span className="num text-[10px] text-muted-foreground">probing chains…</span>
          ) : null}
        </nav>

        {/* STEEM/SBD anchor quote */}
        <div className="ml-auto flex items-center gap-4">
          <div className="text-right leading-tight">
            <p className="num text-[11px] font-semibold text-foreground/90">
              {ticker ? (
                <FlashNumber value={Number(ticker.latest)} format={fmtPrice} />
              ) : (
                <span className="text-muted-foreground">—.————</span>
              )}
              <span className="ml-1.5 text-[9px] font-normal tracking-[0.14em] text-muted-foreground">
                STEEM/SBD
              </span>
            </p>
            <p className="num text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
              {clock ? `UTC ${clock}` : "UTC —"}
            </p>
          </div>
          <div className="hidden text-right sm:block">
            <p className="num text-[11px] font-semibold text-foreground/90">
              {online > 0 ? `${online}/${chains.length || 5}` : "—"}
            </p>
            <p className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">CHAINS UP</p>
          </div>
          <LiveBadge active={steemLive} />
        </div>
      </div>
    </header>
  );
}

/** Small helper re-export so tabs can color-match the header chips. */
export function headerTone(up: boolean): string {
  return cn(up ? "text-[var(--up)]" : "text-[var(--down)]");
}
