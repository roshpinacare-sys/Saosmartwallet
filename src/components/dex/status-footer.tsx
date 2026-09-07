"use client";

/**
 * StatusFooter — terminal status bar. Sticks to the bottom of the viewport on
 * short pages and is pushed down naturally when content overflows (the root
 * uses min-h-screen flex-col + mt-auto here).
 */

import { useEffect, useState } from "react";

import { useMarketFeed } from "@/hooks/use-steem-market";

export function StatusFooter() {
  const { data } = useMarketFeed();
  const [utc, setUtc] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setUtc(new Date().toISOString().slice(11, 19));
    // first paint right after mount (async — keeps set-state lint happy)
    const t0 = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
    };
  }, []);

  const endpoint = (() => {
    try {
      return data ? new URL(data.endpoint).host : "api.steemit.com";
    } catch {
      return "api.steemit.com";
    }
  })();

  return (
    <footer className="mt-auto border-t border-border/70 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2 text-[9px] uppercase tracking-[0.18em] text-muted-foreground sm:px-6">
        <span className="flex items-center gap-1.5">
          <span className="led-live inline-block h-1.5 w-1.5 rounded-full bg-[var(--up)]" aria-hidden />
          READ-ONLY MODE
        </span>
        <span className="hidden sm:inline">BROADCAST GATED · M0</span>
        <span>SERIALIZER: BIT-EXACT ORACLE 27/27</span>
        <span className="num">NODE {endpoint}</span>
        <span className="num hidden md:inline">
          HEAD #{data?.chainStatus.headBlock.toLocaleString("en-US") ?? "—"}
        </span>
        <span className="num hidden md:inline">LAG {data?.chainStatus.lagSeconds ?? "—"}s</span>
        <span className="num ml-auto flex items-center gap-2">
          <span aria-hidden className="h-1 w-1 rounded-full bg-[var(--amberterminal)]" />
          BUILD GRID·M1 · {utc ?? "--:--:--"} UTC
        </span>
      </div>
    </footer>
  );
}
