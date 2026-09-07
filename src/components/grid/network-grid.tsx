"use client";

/**
 * NetworkGrid — one card per ecosystem chain, each carrying its live probe
 * result. Clicking a card opens a drill-down sheet with every measured
 * detail + the adapter/status truth from the scan. Offline chains render
 * honestly (red LED + reason) — never hidden, never faked.
 */

import { useMemo, useState } from "react";

import { motion } from "framer-motion";
import { Activity, ArrowUpRight, Clock3, Database, ShieldCheck, Terminal } from "lucide-react";

import { PanelHeader } from "@/components/dex/terminal-furniture";
import { EcoStatusChip, StatCell, StatusBadge } from "@/components/grid/eco-bits";
import { fmtAge, fmtCompact, fmtHeight, type EcoChain, useEcoNetworks } from "@/hooks/use-eco";
import { ECO_NETWORKS } from "@/lib/eco-registry";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const CHAIN_GLYPH: Record<string, string> = {
  steem: "S",
  hive: "H",
  blurt: "B",
  tron: "T",
  "saos-net": "Σ",
};

export function NetworkGrid() {
  const { data, isLoading, isError } = useEcoNetworks();
  const [selected, setSelected] = useState<EcoChain | null>(null);

  const byId = useMemo(() => {
    const map = new Map<string, EcoChain>();
    for (const c of data?.chains ?? []) map.set(c.id, c);
    return map;
  }, [data]);

  return (
    <section className="glass rounded-lg" aria-label="Network grid">
      <PanelHeader
        title="Network Grid"
        subtitle="all chains probed live — click for drill-down"
        icon={<Database className="h-4 w-4" />}
        right={
          <span className="num text-[10px] text-muted-foreground">
            {isLoading ? "probing…" : isError ? "probe route error" : `${data?.chains.length ?? 0} chains`}
          </span>
        }
      />
      <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 xl:grid-cols-5">
        {ECO_NETWORKS.map((info, i) => {
          const live = byId.get(info.id);
          const status = live?.status ?? "offline";
          return (
            <motion.button
              key={info.id}
              type="button"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.05 }}
              onClick={() => live && setSelected(live)}
              disabled={!live}
              className={cn(
                "group relative flex flex-col gap-2.5 rounded-lg border border-border/60 bg-card/40 p-4 text-left transition-all",
                "hover:border-[var(--up)]/40 hover:bg-card/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ring)]",
                "disabled:cursor-wait",
              )}
              aria-label={`${info.name} details`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="num flex h-7 w-7 items-center justify-center rounded-md border border-border/70 bg-secondary/60 text-[12px] font-black text-foreground/90">
                    {CHAIN_GLYPH[info.id] ?? "?"}
                  </span>
                  <div className="leading-tight">
                    <p className="text-[12px] font-bold tracking-[0.14em] text-foreground">{info.name}</p>
                    <p className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{info.family}</p>
                  </div>
                </div>
                <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-[var(--up)]" aria-hidden />
              </div>

              <div className="flex items-center justify-between gap-2">
                <StatusBadge status={status} />
                <span className="num text-[11px] font-semibold text-foreground/85">
                  {live?.headHeight ? `#${fmtHeight(live.headHeight)}` : "—"}
                </span>
              </div>

              <p className="line-clamp-2 min-h-[28px] text-[10px] leading-snug text-muted-foreground">{info.role}</p>

              <div className="flex items-center justify-between border-t border-border/50 pt-2 text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                <span className="num">
                  {live?.lagSeconds != null ? `lag ${live.lagSeconds}s` : live?.stateAgeSeconds != null ? `state ${fmtAge(live.stateAgeSeconds)} old` : status === "offline" ? "no signal" : "—"}
                </span>
                <span className="truncate">{info.kind}</span>
              </div>
            </motion.button>
          );
        })}
      </div>

      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="right" className="scroll-thin w-full overflow-y-auto border-border/70 bg-background/95 sm:max-w-md">
          {selected ? <ChainDrill chain={selected} /> : null}
        </SheetContent>
      </Sheet>
    </section>
  );
}

function ChainDrill({ chain }: { chain: EcoChain }) {
  const info = ECO_NETWORKS.find((n) => n.id === chain.id);
  return (
    <div className="p-2">
      <SheetHeader className="p-0">
        <SheetTitle className="flex items-center gap-3 text-left">
          <span className="num flex h-8 w-8 items-center justify-center rounded-md border border-[var(--up)]/40 bg-[var(--up)]/10 text-[13px] font-black text-[var(--up)]">
            {CHAIN_GLYPH[chain.id] ?? "?"}
          </span>
          <span className="tracking-[0.14em]">{chain.name}</span>
          <StatusBadge status={chain.status} />
        </SheetTitle>
        <SheetDescription className="text-left text-[11px] leading-relaxed text-muted-foreground">
          {info?.role ?? chain.kind}
        </SheetDescription>
      </SheetHeader>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <StatCell label="HEAD HEIGHT" value={fmtHeight(chain.headHeight)} />
        <StatCell label="HEAD ID" value={<span className="truncate">{chain.headId ?? "—"}</span>} />
        <StatCell label="LAG" value={chain.lagSeconds != null ? `${chain.lagSeconds}s` : "—"} />
        <StatCell label="STATE AGE" value={fmtAge(chain.stateAgeSeconds)} />
        <StatCell label="VERSION" value={chain.version ?? "—"} />
        <StatCell label="PROBED AT" value={<span className="text-[10px]">{new Date(chain.probedAt).toISOString().slice(11, 19)}Z</span>} />
      </div>

      <div className="mt-4 rounded-md border border-border/60 bg-secondary/30 p-3">
        <p className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <Activity className="h-3 w-3" aria-hidden /> Evidence
        </p>
        <p className="num mt-1 text-[11px] leading-relaxed text-foreground/85">{chain.note}</p>
      </div>

      <div className="mt-3 rounded-md border border-border/60 bg-secondary/30 p-3">
        <p className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <ShieldCheck className="h-3 w-3" aria-hidden /> Adapter status
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-foreground/85">{info?.adapterStatus ?? "—"}</p>
      </div>

      <div className="mt-3 rounded-md border border-border/60 bg-secondary/30 p-3">
        <p className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <Terminal className="h-3 w-3" aria-hidden /> Role in the grid
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-foreground/85">{chain.kind}</p>
        <div className="mt-2">
          <EcoStatusChip status={chain.status === "online" ? "live" : chain.status === "stale" ? "gated" : "gated"} />
        </div>
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
        <Clock3 className="h-3 w-3" aria-hidden /> refresh ~7s · server TTL 6s
      </p>
    </div>
  );
}

export function fmtBench(n: number | null | undefined): string {
  return fmtCompact(n);
}
