"use client";

/**
 * PairsMatrix — the trading-pairs table for the whole grid.
 * Live rows are enriched from chain probes only:
 *   · STEEM/SBD   → internal-market ticker + real order-book spread
 *   · SAOS/STEEM  → sovereign book best bid/ask (SAOS-NET state)
 *   · wrap pools  → oracle-driven pool prices from SAOS-NET state
 * Anything the chains don't publish renders as "—" (never invented).
 * Sortable columns + search + staggered row entrance + price flash.
 */

import { motion } from "framer-motion";
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { FlashValue } from "@/components/terminal/motion-bits";
import { EcoChip, PanelSkeleton } from "@/components/terminal/primitives";
import { fmtCompact } from "@/hooks/use-eco";
import { fmtPrice, useMarketFeed, useOrderBook } from "@/hooks/use-steem-market";
import { useEcoSaosNet } from "@/hooks/use-eco";
import { ECO_PAIRS } from "@/lib/eco-registry";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

type SortKey = "pair" | "price" | "change" | "volume" | "spread";
type SortDir = "asc" | "desc";

export interface PairRow {
  pair: string;
  venue: string;
  status: string;
  price: number | null;
  change: number | null;
  volume: number | null;
  volumeUnit: string;
  spread: number | null;
  jump?: "saosnet";
  note: string;
}

export function PairsMatrix({ onJump }: { onJump: (target: "saosnet") => void }) {
  const { data: market, isLoading: mktLoading } = useMarketFeed();
  const { data: book } = useOrderBook(10);
  const { data: saos, isLoading: saosLoading } = useEcoSaosNet();

  const [sortKey, setSortKey] = useState<SortKey>("pair");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [query, setQuery] = useState("");

  const rows = useMemo<PairRow[]>(() => {
    const out: PairRow[] = [];

    // STEEM/SBD — the real market
    if (market) {
      const bestBid = book?.bids[0]?.priceNum ?? null;
      const bestAsk = book?.asks[0]?.priceNum ?? null;
      const spread =
        bestBid !== null && bestAsk !== null && bestAsk > 0
          ? ((bestAsk - bestBid) / ((bestAsk + bestBid) / 2)) * 100
          : null;
      const volSat = market.ticker.steemVolumeSatoshis;
      out.push({
        pair: "STEEM/SBD",
        venue: "Steem Internal Market",
        status: "live",
        price: Number(market.ticker.latest),
        change: market.ticker.percentChange,
        volume: Number.isFinite(volSat) ? volSat / 1000 : null,
        volumeUnit: "STEEM",
        spread,
        note: "THE real market — full order book & tape right below (this tab)",
      });
    }

    // SAOS/STEEM — sovereign book
    if (saos?.stateAvailable) {
      const bestBid = saos.book.bids[0]?.price ?? null;
      const bestAsk = saos.book.asks[0]?.price ?? null;
      const spread =
        bestBid !== null && bestAsk !== null && bestAsk > 0
          ? ((bestAsk - bestBid) / ((bestAsk + bestBid) / 2)) * 100
          : null;
      out.push({
        pair: "SAOS/STEEM",
        venue: "SAOS-NET sovereign book",
        status: "live",
        price: bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null,
        change: null,
        volume: null,
        volumeUnit: "SAOS",
        spread,
        jump: "saosnet",
        note: "Deterministic order book on our own chain",
      });

      // wrap pools — oracle-driven px
      for (const p of saos.pools) {
        out.push({
          pair: p.pair,
          venue: "grid98 AMM",
          status: "sim",
          price: Number.isFinite(p.px) ? p.px : null,
          change: null,
          volume: p.lp > 0 ? p.lp : null,
          volumeUnit: "LP",
          spread: null,
          note: "Bridge pool — oracle-rebalanced hourly",
        });
      }
    }

    // catalog rows not covered above (honest gaps)
    for (const p of ECO_PAIRS) {
      if (out.some((r) => r.pair === p.pair)) continue;
      out.push({
        pair: p.pair,
        venue: p.venue,
        status: p.status,
        price: null,
        change: null,
        volume: null,
        volumeUnit: "",
        spread: null,
        note: p.note,
      });
    }

    return out;
  }, [market, book, saos]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? rows.filter((r) => r.pair.toLowerCase().includes(q) || r.venue.toLowerCase().includes(q))
      : rows;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...base].sort((a, b) => {
      if (sortKey === "pair") return a.pair.localeCompare(b.pair) * dir;
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null && bv === null) return 0;
      if (av === null) return 1; // nulls last regardless of direction
      if (bv === null) return -1;
      return (Number(av) - Number(bv)) * dir;
    });
  }, [rows, query, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const liveCount = rows.filter((r) => r.status === "live").length;

  const columns: Array<{ key: SortKey; label: string; align?: "right" }> = [
    { key: "pair", label: "Pair" },
    { key: "price", label: "Price", align: "right" },
    { key: "change", label: "24h", align: "right" },
    { key: "volume", label: "Volume", align: "right" },
    { key: "spread", label: "Spread", align: "right" },
  ];

  return (
    <section className="glass overflow-hidden" aria-label="Trading pairs matrix">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.18em] text-foreground/90">
            Trading Pairs
          </h2>
          <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
            {rows.length} markets · {liveCount} live · chain-sourced
          </p>
        </div>
        <div className="relative w-full max-w-56 sm:w-56">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-tertiary)]"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="filter pairs…"
            aria-label="Filter trading pairs"
            className="num h-8 border-[var(--border-subtle)] bg-white/[0.03] pl-8 text-[12px]"
          />
        </div>
      </div>

      {mktLoading || saosLoading ? (
        <PanelSkeleton rows={6} className="border-0" />
      ) : (
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-[9px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                {columns.map((c) => (
                  <th key={c.key} className={cn("px-4 py-2.5 font-medium", c.align === "right" ? "text-right" : "text-left")}>
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className={cn(
                        "inline-flex items-center gap-1 uppercase tracking-[0.18em] transition-colors hover:text-foreground",
                        sortKey === c.key && "text-foreground",
                      )}
                      aria-label={`Sort by ${c.label}`}
                    >
                      {c.label}
                      {sortKey === c.key ? (
                        sortDir === "asc" ? (
                          <ArrowUp className="h-3 w-3" aria-hidden />
                        ) : (
                          <ArrowDown className="h-3 w-3" aria-hidden />
                        )
                      ) : (
                        <ArrowUpDown className="h-2.5 w-2.5 opacity-40" aria-hidden />
                      )}
                    </button>
                  </th>
                ))}
                <th className="px-4 py-2.5 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <motion.tr
                  key={row.pair}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.4), duration: 0.25 }}
                  onClick={() => row.jump && onJump(row.jump)}
                  onKeyDown={(e) => {
                    if (row.jump && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      onJump(row.jump);
                    }
                  }}
                  tabIndex={row.jump ? 0 : undefined}
                  aria-label={row.jump ? `${row.pair} — open SAOS-NET view` : row.pair}
                  className={cn(
                    "border-b border-[var(--border-subtle)] transition-colors last:border-0",
                    row.jump && "cursor-pointer hover:bg-white/[0.03]",
                  )}
                >
                  <td className="px-4 py-3">
                    <div className="flex flex-col">
                      <span className="num font-semibold text-foreground">{row.pair}</span>
                      <span className="truncate text-[10px] text-[var(--text-tertiary)]" title={row.note}>
                        {row.venue}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.price !== null ? (
                      <FlashValue
                        value={row.price}
                        format={(v) => fmtPrice(v)}
                        className="font-semibold text-foreground"
                      />
                    ) : (
                      <span className="num text-[var(--text-tertiary)]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.change !== null ? (
                      <span
                        className="num font-semibold"
                        style={{ color: row.change >= 0 ? "var(--up)" : "var(--down)" }}
                      >
                        {row.change >= 0 ? "+" : ""}
                        {row.change.toFixed(2)}%
                      </span>
                    ) : (
                      <span className="num text-[var(--text-tertiary)]">—</span>
                    )}
                  </td>
                  <td className="num px-4 py-3 text-right text-foreground/80">
                    {row.volume !== null ? (
                      <>
                        {fmtCompact(row.volume)}
                        {row.volumeUnit ? <span className="ml-1 text-[9px] text-[var(--text-tertiary)]">{row.volumeUnit}</span> : null}
                      </>
                    ) : (
                      <span className="text-[var(--text-tertiary)]">—</span>
                    )}
                  </td>
                  <td className="num px-4 py-3 text-right text-foreground/80">
                    {row.spread !== null ? `${row.spread.toFixed(4)}%` : <span className="text-[var(--text-tertiary)]">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <EcoChip status={row.status} />
                  </td>
                </motion.tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[11px] text-[var(--text-tertiary)]">
                    no pairs match “{query}”
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
