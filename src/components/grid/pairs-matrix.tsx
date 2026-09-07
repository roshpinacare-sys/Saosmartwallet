"use client";

/**
 * PairsMatrix — every trading venue in the ecosystem on one board:
 *  · STEEM/SBD — real internal-market market: price/volume/spread/depth LIVE
 *  · SAOS/STEEM sovereign book — best bid/ask + last floor from chain state
 *  · grid98 pools — pool price + LP supply from the resident engine state
 * Rows are sortable; each row shows its data source badge. Zero mock data.
 */

import { useMemo, useState } from "react";

import { ArrowDown, ArrowUp } from "lucide-react";

import { PanelHeader } from "@/components/dex/terminal-furniture";
import { EcoStatusChip } from "@/components/grid/eco-bits";
import { fmtCompact, fmtUsd, useEcoSaosNet } from "@/hooks/use-eco";
import { fmtPrice, useMarketFeed, useOrderBook } from "@/hooks/use-steem-market";
import { cn } from "@/lib/utils";

interface Row {
  pair: string;
  venue: string;
  source: "STEEM-IM" | "SAOS-BOOK" | "grid98-AMM";
  price: number | null;
  priceLabel: string;
  spread: string | null;
  depth: string;
  extra: string;
  status: "live" | "sim";
}

type SortKey = "pair" | "venue" | "price" | "spread" | "depth";
type SortDir = "asc" | "desc";

export function PairsMatrix() {
  const { data: market } = useMarketFeed();
  const { data: book } = useOrderBook(25);
  const { data: saos, isError: saosError } = useEcoSaosNet();
  const [sortKey, setSortKey] = useState<SortKey>("venue");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];

    // 1) STEEM/SBD — the real internal market
    const t = market?.ticker;
    if (t) {
      const bid = Number(t.highestBid);
      const ask = Number(t.lowestAsk);
      const spreadPct = Number.isFinite(bid) && Number.isFinite(ask) && ask > 0 ? ((ask - bid) / ask) * 100 : null;
      const topBidUsd = Number.isFinite(bid) ? bid : null;
      out.push({
        pair: "STEEM / SBD",
        venue: "Steem Internal Market",
        source: "STEEM-IM",
        price: Number(t.latest),
        priceLabel: fmtPrice(Number(t.latest)),
        spread: spreadPct !== null ? `${spreadPct.toFixed(2)}%` : null,
        depth: `${(t.steemVolumeSatoshis / 1000).toLocaleString("en-US")} STEEM 24h`,
        extra: `vol ${fmtPrice(Number(t.sbdVolume))} SBD · chg ${(t.percentChange * 100).toFixed(2)}%`,
        status: "live",
      });
      // oracle cross-check: STEEM usd quote from SAOS-NET oracle (if present)
      const steemQuote = saos?.oracle.find((o) => o.asset === "WSTEEM");
      if (steemQuote && topBidUsd !== null) {
        out[out.length - 1].extra += ` · oracle ${fmtUsd(steemQuote.pxUsd)}`;
      }
    }

    // 2) SAOS sovereign book
    if (saos) {
      const bestAsk = saos.book.asks[0];
      const bestBid = saos.book.bids[0];
      const last = bestAsk?.price ?? bestBid?.price ?? null;
      const spread =
        bestAsk && bestBid && bestAsk.price > 0
          ? `${(((bestAsk.price - bestBid.price) / bestAsk.price) * 100).toFixed(2)}%`
          : null;
      out.push({
        pair: "SAOS / STEEM",
        venue: "SAOS-NET Sovereign Book",
        source: "SAOS-BOOK",
        price: last,
        priceLabel: last !== null ? last.toFixed(6) : "—",
        spread,
        depth: `${saos.book.asks.length + saos.book.bids.length} levels · ${saos.sov.fills ?? 0} fills`,
        extra: `floor ${saos.engine.floor?.toFixed(6) ?? "—"} · treasury ${fmtCompact(saos.engine.treasuryPnlSAOS)} SAOS`,
        status: "live",
      });

      // 3) grid98 pools (top by LP)
      for (const p of saos.pools.slice(0, 6)) {
        out.push({
          pair: p.pair,
          venue: "grid98 AMM",
          source: "grid98-AMM",
          price: p.px,
          priceLabel: p.px.toLocaleString("en-US", { maximumFractionDigits: 4 }),
          spread: null,
          depth: `LP ${fmtCompact(p.lp)}`,
          extra: `reserves ${p.baseReserve} / ${p.quoteReserve}`,
          status: "sim",
        });
      }
    }

    return out;
  }, [market, book, saos]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case "pair":
          return a.pair.localeCompare(b.pair) * dir;
        case "venue":
          return a.venue.localeCompare(b.venue) * dir;
        case "price":
          return ((a.price ?? -1) - (b.price ?? -1)) * dir;
        case "spread":
          return ((a.spread ? parseFloat(a.spread) : -1) - (b.spread ? parseFloat(b.spread) : -1)) * dir;
        case "depth":
          return a.depth.localeCompare(b.depth) * dir;
      }
    });
  }, [rows, sortKey, sortDir]);

  function toggle(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return (
    <section className="glass rounded-lg" aria-label="Trading pairs matrix">
      <PanelHeader
        title="Trading Pairs Matrix"
        subtitle="every venue · every source · live"
        icon={<span aria-hidden className="text-[13px]">⇄</span>}
        right={
          <span className="num text-[10px] text-muted-foreground">
            {saosError ? "SAOS-NET state unreachable" : `${rows.length} markets`}
          </span>
        }
      />
      <div className="scroll-thin max-h-[380px] overflow-auto">
        <table className="w-full min-w-[640px] text-left">
          <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur">
            <tr className="border-b border-border/60 text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
              <Th onClick={() => toggle("pair")} active={sortKey === "pair"} dir={sortDir}>Pair</Th>
              <Th onClick={() => toggle("venue")} active={sortKey === "venue"} dir={sortDir}>Venue</Th>
              <Th onClick={() => toggle("price")} active={sortKey === "price"} dir={sortDir} right>Price</Th>
              <Th onClick={() => toggle("spread")} active={sortKey === "spread"} dir={sortDir} right>Spread</Th>
              <Th onClick={() => toggle("depth")} active={sortKey === "depth"} dir={sortDir}>Depth / Vol</Th>
              <th className="px-4 py-2 text-right text-[9px]">Source</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={`${r.pair}-${r.venue}`} className="border-b border-border/30 transition-colors hover:bg-secondary/40">
                <td className="px-4 py-2.5">
                  <span className="num text-[12px] font-bold text-foreground">{r.pair}</span>
                  <span className="ml-2 align-middle">
                    <EcoStatusChip status={r.status} />
                  </span>
                </td>
                <td className="px-4 py-2.5 text-[11px] text-muted-foreground">{r.venue}</td>
                <td className="num px-4 py-2.5 text-right text-[12px] font-semibold text-foreground/90">{r.priceLabel}</td>
                <td className="num px-4 py-2.5 text-right text-[11px] text-muted-foreground">{r.spread ?? "—"}</td>
                <td className="px-4 py-2.5">
                  <p className="num text-[11px] text-foreground/85">{r.depth}</p>
                  <p className="num text-[9px] text-muted-foreground">{r.extra}</p>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <span className="num rounded-sm border border-border/60 bg-secondary/50 px-1.5 py-px text-[9px] font-bold tracking-[0.1em] text-muted-foreground">
                    {r.source}
                  </span>
                </td>
              </tr>
            ))}
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[11px] text-muted-foreground">
                  waiting for first live snapshot…
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Th({
  children,
  onClick,
  active,
  dir,
  right,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  dir: SortDir;
  right?: boolean;
}) {
  return (
    <th className={cn("px-4 py-2 font-semibold", right && "text-right")}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 uppercase tracking-[0.18em] transition-colors hover:text-foreground",
          active && "text-[var(--up)]",
        )}
      >
        {children}
        {active ? dir === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden /> : null}
      </button>
    </th>
  );
}
