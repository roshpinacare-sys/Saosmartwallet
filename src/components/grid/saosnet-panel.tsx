"use client";

/**
 * SaosNetPanel — deep view of our own sovereign chain: engine vitals,
 * the sovereign order book, grid98 pools, signed oracle quotes, wrapped
 * asset coverage, and the delegation map. Every number comes from the
 * daemon-pushed chain state (state.json + grid98-state.json).
 */

import { motion } from "framer-motion";
import { BookOpen, Cpu, Gauge, ScrollText, Sparkles } from "lucide-react";

import { PanelHeader } from "@/components/dex/terminal-furniture";
import { StatCell } from "@/components/grid/eco-bits";
import { fmtAge, fmtCompact, fmtUsd, useEcoSaosNet } from "@/hooks/use-eco";
import { cn } from "@/lib/utils";

export function SaosNetPanel() {
  const { data, isError, isLoading } = useEcoSaosNet();

  if (isLoading) {
    return (
      <section className="glass rounded-lg p-8 text-center">
        <p className="num text-[11px] uppercase tracking-[0.2em] text-muted-foreground">loading sovereign state…</p>
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section className="glass rounded-lg p-8 text-center">
        <p className="num text-[12px] font-bold uppercase tracking-[0.2em] text-[var(--down)]">
          SAOS-NET state unreachable
        </p>
        <p className="mt-2 text-[11px] text-muted-foreground">
          the daemon pushes chain state into the steem repo — the fetch layer reports this honestly instead of faking data
        </p>
      </section>
    );
  }

  const stateAge = data.core.updatedAt ? Math.max(0, (Date.now() - Date.parse(data.core.updatedAt)) / 1000) : null;
  const coverage = (w: { supply: number; locked: number }) =>
    w.locked > 0 ? `${((w.supply / w.locked) * 100).toFixed(1)}%` : w.supply === 0 ? "0 minted" : "—";

  return (
    <div className="flex flex-col gap-4">
      {/* engine vitals */}
      <section className="glass rounded-lg" aria-label="Engine vitals">
        <PanelHeader
          title="SAOS-NET Engine"
          subtitle={`${data.core.netVersion ?? "saos-net"} · genesis ${data.core.genesisHash?.slice(0, 12) ?? "—"}…`}
          icon={<Cpu className="h-4 w-4" />}
          right={
            <span className="num text-[10px] text-muted-foreground">
              state {stateAge !== null ? fmtAge(stateAge) : "—"} old
            </span>
          }
        />
        <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4 xl:grid-cols-6">
          <StatCell label="HEIGHT" value={data.core.height?.toLocaleString("en-US") ?? "—"} sub={`root ${data.core.stateRoot?.slice(0, 10)}…`} />
          <StatCell label="CHECKPOINTS" value={`${data.core.checkpointCount} window`} sub={`${data.core.verifiedCount} verified total`} />
          <StatCell label="BENCH" value={data.engine.bench.txsPerSec ? `${fmtCompact(data.engine.bench.txsPerSec)} tx/s` : "—"} sub="kernel replay on real archive" />
          <StatCell label="CAP / DAY" value={data.engine.bench.capabilityPerDay ? fmtCompact(data.engine.bench.capabilityPerDay) : "—"} sub="mechanism ceiling" />
          <StatCell
            label="TREASURY P&L"
            value={`${fmtCompact(data.engine.treasuryPnlSAOS)} SAOS`}
            sub={`today +${fmtCompact(data.engine.treasuryPnlTodaySAOS ?? 0)}`}
          />
          <StatCell label="VALUE FLOOR" value={data.engine.floor?.toFixed(6) ?? "—"} sub="self-anchored ladder" />
          <StatCell label="TRADES" value={data.engine.tradesTotal?.toLocaleString("en-US") ?? "—"} sub={`${data.engine.tradesToday ?? 0} today`} />
          <StatCell label="TXS" value={data.engine.txsTotal?.toLocaleString("en-US") ?? "—"} sub={`${data.engine.txsToday ?? 0} today`} />
          <StatCell label="TICKS / ROUNDS" value={`${fmtCompact(data.engine.ticks)}/${fmtCompact(data.engine.rounds)}`} />
          <StatCell label="SOV BOOK" value={`${data.sov.orders ?? 0} orders`} sub={`${data.sov.matches ?? 0} matches · ${data.sov.fills ?? 0} fills`} />
          <StatCell label="FLOATS" value={`${data.sov.floats ?? 0}`} sub="sovereign float events" />
          <StatCell label="DELEGATIONS" value={`${data.delegations.length}`} sub="scopes on the book" />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* sovereign book */}
        <section className="glass rounded-lg" aria-label="Sovereign book">
          <PanelHeader title="Sovereign Book" subtitle="SAOS order book on our own chain" icon={<BookOpen className="h-4 w-4" />} />
          <div className="grid grid-cols-2 gap-px">
            <BookSide title="ASKS" rows={[...data.book.asks].reverse().slice(0, 8)} tone="down" />
            <BookSide title="BIDS" rows={data.book.bids.slice(0, 8)} tone="up" />
          </div>
          {data.book.asks.length === 0 && data.book.bids.length === 0 ? (
            <p className="px-4 py-6 text-center text-[11px] text-muted-foreground">book empty in current state…</p>
          ) : null}
        </section>

        {/* oracle */}
        <section className="glass rounded-lg" aria-label="Signed oracle quotes">
          <PanelHeader
            title="Oracle Quotes"
            subtitle="signed hourly · coingecko-sourced (nano-USD scale)"
            icon={<Sparkles className="h-4 w-4" />}
            right={<span className="num text-[10px] text-muted-foreground">{data.oracle.length} assets</span>}
          />
          <div className="scroll-thin max-h-[300px] overflow-y-auto">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-card/95 backdrop-blur">
                <tr className="border-b border-border/60 text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                  <th className="px-4 py-2 font-semibold">Asset</th>
                  <th className="px-4 py-2 text-right font-semibold">USD</th>
                  <th className="px-4 py-2 font-semibold">Source</th>
                  <th className="px-4 py-2 text-right font-semibold">Age</th>
                </tr>
              </thead>
              <tbody>
                {data.oracle.map((q) => (
                  <tr key={q.asset} className="border-b border-border/30">
                    <td className="num px-4 py-2 text-[11px] font-bold text-foreground/90">{q.asset}</td>
                    <td className="num px-4 py-2 text-right text-[11px] text-foreground/85">{fmtUsd(q.pxUsd)}</td>
                    <td className="px-4 py-2 text-[10px] text-muted-foreground">{q.src}</td>
                    <td className="num px-4 py-2 text-right text-[10px] text-muted-foreground">{fmtAge(Math.max(0, (Date.now() - Date.parse(q.at)) / 1000))}</td>
                  </tr>
                ))}
                {data.oracle.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-[11px] text-muted-foreground">no quotes in state…</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        {/* pools */}
        <section className="glass rounded-lg" aria-label="grid98 pools">
          <PanelHeader
            title="grid98 Pools"
            subtitle="resident AMM — reserves & pool price (engine units)"
            icon={<Gauge className="h-4 w-4" />}
            right={<span className="num text-[10px] text-muted-foreground">{data.pools.length} pools</span>}
          />
          <div className="scroll-thin max-h-[300px] overflow-y-auto">
            <table className="w-full min-w-[420px] text-left">
              <thead className="sticky top-0 bg-card/95 backdrop-blur">
                <tr className="border-b border-border/60 text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                  <th className="px-4 py-2 font-semibold">Pair</th>
                  <th className="px-4 py-2 text-right font-semibold">PX</th>
                  <th className="px-4 py-2 text-right font-semibold">Reserves (a / b)</th>
                  <th className="px-4 py-2 text-right font-semibold">LP</th>
                </tr>
              </thead>
              <tbody>
                {data.pools.map((p) => (
                  <tr key={p.pair} className="border-b border-border/30 hover:bg-secondary/40">
                    <td className="num px-4 py-2 text-[11px] font-bold text-foreground/90">{p.pair}</td>
                    <td className="num px-4 py-2 text-right text-[11px] text-foreground/85">{p.px.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                    <td className="num px-4 py-2 text-right text-[10px] text-muted-foreground">{p.baseReserve} / {p.quoteReserve}</td>
                    <td className="num px-4 py-2 text-right text-[10px] text-muted-foreground">{fmtCompact(p.lp)}</td>
                  </tr>
                ))}
                {data.pools.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-[11px] text-muted-foreground">no pools in state…</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        {/* wrapped assets */}
        <section className="glass rounded-lg" aria-label="Wrapped assets">
          <PanelHeader title="Wrapped Assets" subtitle="supply ≤ locked — 1:1 discipline (MINTABLE_1TO1 shield)" icon={<ScrollText className="h-4 w-4" />} />
          <div className="scroll-thin max-h-[300px] overflow-y-auto">
            <table className="w-full min-w-[420px] text-left">
              <thead className="sticky top-0 bg-card/95 backdrop-blur">
                <tr className="border-b border-border/60 text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                  <th className="px-4 py-2 font-semibold">Asset</th>
                  <th className="px-4 py-2 text-right font-semibold">Supply</th>
                  <th className="px-4 py-2 text-right font-semibold">Locked</th>
                  <th className="px-4 py-2 text-right font-semibold">Coverage</th>
                  <th className="px-4 py-2 text-right font-semibold">Holders</th>
                </tr>
              </thead>
              <tbody>
                {data.wrapped.map((w) => (
                  <tr key={w.asset} className="border-b border-border/30 hover:bg-secondary/40">
                    <td className="num px-4 py-2 text-[11px] font-bold text-foreground/90">{w.asset}</td>
                    <td className="num px-4 py-2 text-right text-[11px] text-foreground/85">{w.supply.toLocaleString("en-US", { maximumFractionDigits: 8 })}</td>
                    <td className="num px-4 py-2 text-right text-[11px] text-foreground/85">{w.locked.toLocaleString("en-US", { maximumFractionDigits: 8 })}</td>
                    <td className={cn("num px-4 py-2 text-right text-[10px]", w.supply <= w.locked || w.supply === 0 ? "text-[var(--up)]" : "text-[var(--down)]")}>
                      {coverage(w)}
                    </td>
                    <td className="num px-4 py-2 text-right text-[10px] text-muted-foreground">{w.holders}</td>
                  </tr>
                ))}
                {data.wrapped.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-[11px] text-muted-foreground">no wrapped assets in state…</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* delegations */}
      <section className="glass rounded-lg" aria-label="Delegation map">
        <PanelHeader title="Delegation Map" subtitle="who may do what on the sovereign book (scopes on-chain)" icon={<span aria-hidden className="text-[13px]">⌘</span>} />
        <div className="scroll-thin flex max-h-[200px] flex-wrap gap-2 overflow-y-auto p-3">
          {data.delegations.map((d, i) => (
            <motion.span
              key={d.name}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2, delay: Math.min(i * 0.02, 0.2) }}
              className="num inline-flex items-center gap-2 rounded-md border border-border/60 bg-secondary/40 px-2.5 py-1.5 text-[10px]"
            >
              <span className="font-bold text-foreground/90">@{d.name}</span>
              <span className="text-muted-foreground">{d.scopes.join(" · ")}</span>
            </motion.span>
          ))}
          {data.delegations.length === 0 ? (
            <p className="w-full py-4 text-center text-[11px] text-muted-foreground">no delegations in state…</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function BookSide({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: Array<{ id: number; owner: string; amount: number; price: number }>;
  tone: "up" | "down";
}) {
  return (
    <div className="p-2">
      <p className={cn("px-2 py-1 text-[9px] font-bold uppercase tracking-[0.2em]", tone === "up" ? "text-[var(--up)]" : "text-[var(--down)]")}>
        {title}
      </p>
      <ul className="scroll-thin max-h-[240px] overflow-y-auto">
        {rows.map((o) => (
          <li key={o.id} className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-secondary/40">
            <span className="num text-[10px] text-muted-foreground">#{o.id}</span>
            <span className="num truncate text-[10px] text-foreground/80">@{o.owner}</span>
            <span className="num text-[10px] text-muted-foreground">{o.amount}</span>
            <span className={cn("num text-[11px] font-semibold", tone === "up" ? "text-[var(--up)]" : "text-[var(--down)]")}>
              {o.price.toFixed(6)}
            </span>
          </li>
        ))}
        {rows.length === 0 ? <li className="px-2 py-4 text-center text-[10px] text-muted-foreground">empty side</li> : null}
      </ul>
    </div>
  );
}
