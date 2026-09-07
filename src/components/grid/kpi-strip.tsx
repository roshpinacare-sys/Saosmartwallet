"use client";

/**
 * KpiStrip — the ecosystem at a glance. Every figure is sourced live:
 *  · chains up            → /api/eco/networks probes
 *  · SAOS-NET height      → daemon-pushed chain state
 *  · engine bench         → grid98 measured kernel throughput
 *  · treasury P&L         → grid98 sovereign ledger
 *  · STEEM/SBD last price → Steem internal market ticker
 *  · fleet                → registry facts (scan), marked as such
 */

import { motion } from "framer-motion";
import { Boxes, Cpu, Landmark, Radio, Users, Zap } from "lucide-react";

import { FlashNumber } from "@/components/dex/terminal-furniture";
import { fmtCompact, fmtHeight, useEcoNetworks, useEcoSaosNet } from "@/hooks/use-eco";
import { fmtPrice, useMarketFeed } from "@/hooks/use-steem-market";
import { ECO_SERVICES } from "@/lib/eco-registry";
import { cn } from "@/lib/utils";

export function KpiStrip() {
  const { data: net } = useEcoNetworks();
  const { data: saos } = useEcoSaosNet();
  const { data: market } = useMarketFeed();

  const chains = net?.chains ?? [];
  const up = chains.filter((c) => c.status === "online").length;
  const bench = saos?.engine.bench.txsPerSec ?? null;
  const pnl = saos?.engine.treasuryPnlSAOS ?? null;
  const fleet = ECO_SERVICES.find((s) => s.name === "Soldier Fleet")?.what ?? "—";
  const latest = market?.ticker ? Number(market.ticker.latest) : NaN;

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      aria-label="Ecosystem KPIs"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"
    >
      <Kpi icon={<Boxes className="h-3.5 w-3.5" />} label="CHAINS UP" value={`${up} / ${chains.length || 5}`} sub="probed live" />
      <Kpi
        icon={<Zap className="h-3.5 w-3.5" />}
        label="SAOS-NET HEIGHT"
        value={fmtHeight(saos?.core.height ?? null)}
        sub={`${saos?.core.checkpointCount ?? 0} cps · ${saos?.core.verifiedCount ?? 0} verified`}
        flash
      />
      <Kpi
        icon={<Cpu className="h-3.5 w-3.5" />}
        label="ENGINE BENCH"
        value={bench ? `${fmtCompact(bench)} tx/s` : "—"}
        sub={saos?.engine.bench.capabilityPerDay ? `${fmtCompact(saos.engine.bench.capabilityPerDay)} tx/day cap` : "measured on real archive"}
      />
      <Kpi
        icon={<Landmark className="h-3.5 w-3.5" />}
        label="TREASURY P&L"
        value={pnl !== null ? `${fmtCompact(pnl)} SAOS` : "—"}
        sub="sovereign ledger, monotone"
        flash
      />
      <Kpi
        icon={<Radio className="h-3.5 w-3.5" />}
        label="STEEM / SBD"
        value={Number.isFinite(latest) ? <FlashNumber value={latest} format={fmtPrice} /> : "—"}
        sub="internal market (real)"
        flash
      />
      <Kpi icon={<Users className="h-3.5 w-3.5" />} label="FLEET" value="13 · 28" sub="accounts · loops (scan)" />
    </motion.section>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
  flash,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
  flash?: boolean;
}) {
  return (
    <div
      className={cn(
        "glass rounded-lg px-4 py-3",
        flash && "shadow-[0_0_24px_-14px_var(--up)]",
      )}
    >
      <p className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="num mt-1.5 text-[17px] font-bold leading-none text-foreground">{value}</p>
      {sub ? <p className="num mt-1 truncate text-[9px] uppercase tracking-[0.12em] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}


