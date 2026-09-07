"use client";

/**
 * SaosNetPanel — the sovereign chain deep view.
 * Core vitals, engine output, soldier leaderboard, the sovereign order book
 * as a real depth chart, signed oracle quotes, grid98 pools, wrapped assets
 * and delegation scopes. Everything from the daemon-pushed chain state via
 * /api/eco/saosnet. Book sides are sorted defensively (best price first).
 */

import { motion } from "framer-motion";
import { BookLock, Boxes, Cpu, ScrollText, Trophy } from "lucide-react";
import { useMemo } from "react";

import { DepthChart } from "@/components/terminal/charts";
import { AnimatedNumber, FlashValue } from "@/components/terminal/motion-bits";
import { EcoChip, PanelHeader, PanelSkeleton, StatCell } from "@/components/terminal/primitives";
import { fmtAge, fmtMicroSaos, fmtUsd, useEcoSaosNet } from "@/hooks/use-eco";
import { cn } from "@/lib/utils";

export function SaosNetPanel() {
  const { data, isLoading, isError, error } = useEcoSaosNet();

  const book = useMemo(() => {
    if (!data?.stateAvailable) return { asks: [], bids: [], bestBid: null as number | null, bestAsk: null as number | null };
    const asks = [...data.book.asks].sort((a, b) => a.price - b.price);
    const bids = [...data.book.bids].sort((a, b) => b.price - a.price);
    return {
      asks,
      bids,
      bestAsk: asks[0]?.price ?? null,
      bestBid: bids[0]?.price ?? null,
    };
  }, [data]);

  if (isLoading) {
    return <PanelSkeleton rows={8} />;
  }

  if (isError || !data) {
    return (
      <div role="alert" className="glass p-6 text-center text-sm text-[var(--down)]">
        SAOS-NET state unavailable — {error instanceof Error ? error.message : "unknown error"}
      </div>
    );
  }

  const core = data.core;
  const engine = data.engine;
  const mid = book.bestBid !== null && book.bestAsk !== null ? (book.bestBid + book.bestAsk) / 2 : null;
  const spread =
    book.bestBid !== null && book.bestAsk !== null && book.bestAsk > 0
      ? ((book.bestAsk - book.bestBid) / ((book.bestAsk + book.bestBid) / 2)) * 100
      : null;
  const maxPnl = Math.max(1, ...engine.leaderboard.map((l) => Math.abs(l.pnlMicro)));

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      {/* vitals row */}
      <div className="grid grid-cols-1 gap-4 md:gap-6 xl:grid-cols-3">
        <section className="glass overflow-hidden" aria-label="SAOS-NET core">
          <PanelHeader
            title="Chain Core"
            subtitle="deterministic · 3s pulse"
            icon={<Cpu className="h-4 w-4" />}
            accent="saos"
            right={<EcoChip status={data.stateAvailable ? "live" : "gated"} />}
          />
          <div className="grid grid-cols-2 gap-4 p-5">
            <StatCell
              label="height"
              value={core.height !== null ? <AnimatedNumber value={core.height} className="text-[15px] text-[var(--saos)]" /> : "—"}
              sub={core.updatedAt ? `${fmtAge(secondsSince(core.updatedAt))} since block` : undefined}
            />
            <StatCell label="checkpoints" value={core.checkpointCount.toLocaleString("en-US")} sub={`${core.verifiedCount.toLocaleString("en-US")} verified`} />
            <StatCell label="net version" value={core.netVersion ?? "—"} />
            <StatCell label="genesis" value={core.genesisHash ? `${core.genesisHash.slice(0, 12)}…` : "—"} />
          </div>
          <div className="border-t border-[var(--border-subtle)] px-5 py-2.5">
            <p className="num truncate text-[10px] text-[var(--text-tertiary)]">
              state root <span className="text-foreground/80">{core.stateRoot ? `${core.stateRoot.slice(0, 24)}…` : "—"}</span>
            </p>
          </div>
        </section>

        <section className="glass overflow-hidden" aria-label="grid98 engine">
          <PanelHeader
            title="grid98 Engine"
            subtitle="resident-state market engine"
            icon={<BookLock className="h-4 w-4" />}
            accent="saos"
          />
          <div className="grid grid-cols-3 gap-4 p-5">
            <StatCell label="trades today" value={engine.tradesToday !== null ? engine.tradesToday.toLocaleString("en-US") : "—"} />
            <StatCell label="txs today" value={engine.txsToday !== null ? engine.txsToday.toLocaleString("en-US") : "—"} />
            <StatCell label="ticks" value={engine.ticks !== null ? engine.ticks.toLocaleString("en-US") : "—"} />
            <StatCell
              label="treasury p&l"
              value={
                engine.treasuryPnlSAOS !== null ? (
                  <span style={{ color: engine.treasuryPnlSAOS >= 0 ? "var(--up)" : "var(--down)" }}>
                    {fmtMicroSaos(engine.treasuryPnlSAOS)}
                  </span>
                ) : (
                  "—"
                )
              }
              sub="cumulative"
            />
            <StatCell label="floor" value={engine.floor !== null ? fmtUsd(engine.floor) : "—"} />
            <StatCell label="bench" value={engine.bench.txsPerSec !== null ? `${engine.bench.txsPerSec.toLocaleString("en-US")} tx/s` : "—"} />
          </div>
        </section>

        <section className="glass overflow-hidden" aria-label="Soldier leaderboard">
          <PanelHeader
            title="Leaderboard"
            subtitle="soldier pnl · micro-saos"
            icon={<Trophy className="h-4 w-4" />}
            accent="warning"
          />
          <div className="flex flex-col gap-2.5 p-5">
            {engine.leaderboard.slice(0, 6).map((l, i) => {
              const up = l.pnlMicro >= 0;
              return (
                <div key={l.name} className="flex items-center gap-3">
                  <span className="num w-4 shrink-0 text-[10px] text-[var(--text-tertiary)]">{i + 1}</span>
                  <span className="num w-28 shrink-0 truncate text-[11px] text-foreground/85">{l.name}</span>
                  <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${(Math.abs(l.pnlMicro) / maxPnl) * 100}%` }}
                      transition={{ duration: 0.7, ease: [0.4, 0, 0.2, 1], delay: i * 0.05 }}
                      className="h-full rounded-full"
                      style={{ background: up ? "var(--gradient-success)" : "var(--gradient-danger)" }}
                    />
                  </div>
                  <span className="num w-20 shrink-0 text-right text-[10px]" style={{ color: up ? "var(--up)" : "var(--down)" }}>
                    {fmtMicroSaos(l.pnlMicro)}
                  </span>
                </div>
              );
            })}
            {engine.leaderboard.length === 0 ? (
              <p className="text-center text-[11px] text-[var(--text-tertiary)]">no soldiers on the board yet</p>
            ) : null}
          </div>
        </section>
      </div>

      {/* sovereign book */}
      <section className="glass overflow-hidden" aria-label="SAOS-NET sovereign order book">
        <PanelHeader
          title="Sovereign Book — SAOS/STEEM"
          subtitle="deterministic escrow orderbook"
          icon={<BookLock className="h-4 w-4" />}
          accent="saos"
          right={
            <div className="flex items-center gap-3">
              <span className="num text-[10px] text-[var(--text-tertiary)]">
                spread <span className="text-foreground/85">{spread !== null ? `${spread.toFixed(3)}%` : "—"}</span>
              </span>
              {mid !== null ? <FlashValue value={mid} format={(v) => v.toFixed(4)} className="text-[13px] font-bold text-[var(--saos)]" /> : null}
            </div>
          }
        />
        <div className="p-5">
          <DepthChart
            bids={book.bids.map((b) => ({ priceNum: b.price, amount: b.amount }))}
            asks={book.asks.map((a) => ({ priceNum: a.price, amount: a.amount }))}
            height={220}
            priceDecimals={4}
            unit="SAOS"
          />
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCell label="best bid" value={book.bestBid !== null ? book.bestBid.toFixed(4) : "—"} />
            <StatCell label="best ask" value={book.bestAsk !== null ? book.bestAsk.toFixed(4) : "—"} />
            <StatCell label="orders" value={data.sov.orders !== null ? data.sov.orders.toLocaleString("en-US") : "—"} />
            <StatCell label="fills" value={data.sov.fills !== null ? data.sov.fills.toLocaleString("en-US") : "—"} />
          </div>
        </div>
      </section>

      {/* oracle + pools + wrapped */}
      <div className="grid grid-cols-1 gap-4 md:gap-6 xl:grid-cols-2">
        <section className="glass overflow-hidden" aria-label="Signed oracle quotes">
          <PanelHeader
            title="Oracle Quotes"
            subtitle="signed hourly · nano-usd"
            icon={<ScrollText className="h-4 w-4" />}
            accent="warning"
          />
          <div className="scroll-thin max-h-80 overflow-y-auto">
            <table className="w-full border-collapse text-[11.5px]">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-[9px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                  <th className="px-4 py-2 text-left font-medium">asset</th>
                  <th className="px-4 py-2 text-right font-medium">price usd</th>
                  <th className="px-4 py-2 text-right font-medium">age</th>
                </tr>
              </thead>
              <tbody>
                {data.oracle.map((q) => (
                  <tr key={q.asset} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-white/[0.02]">
                    <td className="num px-4 py-2 font-semibold text-foreground/90">{q.asset}</td>
                    <td className="num px-4 py-2 text-right text-foreground/85">{fmtUsd(q.pxUsd, { maxDecimals: 6 })}</td>
                    <td className="num px-4 py-2 text-right text-[var(--text-tertiary)]">{fmtAge(secondsSince(q.at))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.oracle.length === 0 ? (
              <p className="px-4 py-6 text-center text-[11px] text-[var(--text-tertiary)]">no quotes in current state</p>
            ) : null}
          </div>
        </section>

        <section className="glass overflow-hidden" aria-label="grid98 pools">
          <PanelHeader
            title="grid98 Pools"
            subtitle="amm · 30 bps · oracle-rebalanced"
            icon={<Boxes className="h-4 w-4" />}
            accent="saos"
          />
          <div className="scroll-thin max-h-80 overflow-y-auto">
            <table className="w-full border-collapse text-[11.5px]">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-[9px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                  <th className="px-4 py-2 text-left font-medium">pair</th>
                  <th className="px-4 py-2 text-right font-medium">price</th>
                  <th className="px-4 py-2 text-right font-medium">lp</th>
                </tr>
              </thead>
              <tbody>
                {data.pools.map((p) => (
                  <tr key={p.pair} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-white/[0.02]">
                    <td className="num px-4 py-2 font-semibold text-foreground/90">{p.pair}</td>
                    <td className="num px-4 py-2 text-right text-foreground/85">{p.px > 0 ? p.px.toPrecision(6) : "—"}</td>
                    <td className="num px-4 py-2 text-right text-[var(--text-tertiary)]">
                      {p.lp > 0 ? p.lp.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.pools.length === 0 ? (
              <p className="px-4 py-6 text-center text-[11px] text-[var(--text-tertiary)]">no pools in current state</p>
            ) : null}
          </div>
        </section>
      </div>

      {/* wrapped + delegations */}
      <div className="grid grid-cols-1 gap-4 md:gap-6 xl:grid-cols-3">
        <section className="glass overflow-hidden xl:col-span-2" aria-label="Wrapped assets">
          <PanelHeader
            title="Wrapped Assets"
            subtitle="mintable 1:1 · measured coverage"
            icon={<Boxes className="h-4 w-4" />}
            accent="info"
          />
          <div className="scroll-thin max-h-80 overflow-y-auto">
            <table className="w-full border-collapse text-[11.5px]">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-[9px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                  <th className="px-4 py-2 text-left font-medium">asset</th>
                  <th className="px-4 py-2 text-right font-medium">supply</th>
                  <th className="px-4 py-2 text-right font-medium">locked</th>
                  <th className="px-4 py-2 text-right font-medium">holders</th>
                  <th className="px-4 py-2 text-left font-medium">origin</th>
                </tr>
              </thead>
              <tbody>
                {data.wrapped.map((w) => (
                  <tr key={w.asset} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-white/[0.02]">
                    <td className="num px-4 py-2 font-semibold text-foreground/90">{w.asset}</td>
                    <td className="num px-4 py-2 text-right text-foreground/85">{w.supply.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                    <td className="num px-4 py-2 text-right text-foreground/85">{w.locked.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                    <td className="num px-4 py-2 text-right text-[var(--text-tertiary)]">{w.holders}</td>
                    <td className="px-4 py-2 text-[10px] text-[var(--text-tertiary)]">
                      {data.assetMeta[w.asset]?.chain ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.wrapped.length === 0 ? (
              <p className="px-4 py-6 text-center text-[11px] text-[var(--text-tertiary)]">no wrapped assets in state</p>
            ) : null}
          </div>
        </section>

        <section className="glass overflow-hidden" aria-label="Delegated scopes">
          <PanelHeader
            title="Delegations"
            subtitle="account → sovereign scopes"
            icon={<Cpu className="h-4 w-4" />}
          />
          <div className="scroll-thin flex max-h-80 flex-col gap-2.5 overflow-y-auto p-5">
            {data.delegations.map((d) => (
              <div key={d.name} className="rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] p-3">
                <p className="num text-[11.5px] font-semibold text-foreground/90">@{d.name}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {d.scopes.map((s) => (
                    <span
                      key={s}
                      className={cn(
                        "num rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.12em]",
                        "border-[var(--saos)]/30 bg-[var(--saos)]/10 text-[var(--saos)]",
                      )}
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {data.delegations.length === 0 ? (
              <p className="text-center text-[11px] text-[var(--text-tertiary)]">no delegations in state</p>
            ) : null}
          </div>
        </section>
      </div>

    </div>
  );
}

function secondsSince(iso: string): number {
  const t = Date.parse(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
  return Number.isFinite(t) ? Math.max(0, (Date.now() - t) / 1000) : NaN;
}
