"use client";

/**
 * NetworkGrid — every chain in the ecosystem as a live card.
 * Card anatomy: identity row (glyph · name · family · status) → hero head
 * height (animated) with a real session sparkline → 2×2 metric grid (lag,
 * version, head id, probe age) → optional market row for STEEM.
 * Click opens a drill-down Sheet with role, adapter status and notes.
 * Responsive: auto-fit grid ≥320px per card. Zero mock: offline chains show
 * their failure honestly.
 */

import { motion } from "framer-motion";
import { Boxes, Clock3, Layers, Network, ShieldHalf, Zap } from "lucide-react";
import { useState } from "react";

import { Sparkline } from "@/components/terminal/charts";
import { AnimatedNumber, Delta, FlashValue, useRollingHistory } from "@/components/terminal/motion-bits";
import {
  ChainGlyph,
  PanelSkeleton,
  StatCell,
  StatusBadge,
  chainTone,
} from "@/components/terminal/primitives";
import {
  fmtAge,
  fmtHeight,
  useEcoNetworks,
  type EcoChain,
} from "@/hooks/use-eco";
import { fmtPrice, useMarketFeed } from "@/hooks/use-steem-market";
import { ECO_NETWORKS } from "@/lib/eco-registry";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export function NetworkGrid() {
  const { data, isLoading, isError, error } = useEcoNetworks();
  const [selected, setSelected] = useState<EcoChain | null>(null);

  if (isLoading) {
    return (
      <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-4 md:gap-6">
        {[0, 1, 2].map((i) => (
          <PanelSkeleton key={i} rows={5} />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div role="alert" className="glass p-6 text-center text-sm text-[var(--down)]">
        network probe failed — {error instanceof Error ? error.message : "unknown error"}
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-4 md:gap-6">
        {data.chains.map((chain, i) => (
          <NetworkCard key={chain.id} chain={chain} index={i} onOpen={() => setSelected(chain)} />
        ))}
      </div>

      <Sheet open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent
          side="right"
          className="glass w-full overflow-y-auto border-[var(--border-default)] sm:max-w-md"
        >
          {selected ? <NetworkDetail chain={selected} /> : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

/* ------------------------------------------------------------------ */

function NetworkCard({ chain, index, onOpen }: { chain: EcoChain; index: number; onOpen: () => void }) {
  const tone = chainTone(chain.id);
  const hist = useRollingHistory(`chain:${chain.id}`, chain.headHeight, 48);
  const { data: market } = useMarketFeed();
  const registry = ECO_NETWORKS.find((n) => n.id === chain.id);
  const isSteem = chain.id === "steem";

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
      whileTap={{ scale: 0.985 }}
      aria-label={`${chain.name} network card — open details`}
      className={cn(
        "glass glow-card cursor-pointer p-5 text-left outline-none",
        chain.status === "offline" && "border-[var(--down)]/30",
      )}
    >
      {/* identity row */}
      <div className="flex items-center gap-3">
        <ChainGlyph id={chain.id} name={chain.name} />
        <div className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold tracking-wide text-foreground">{chain.name}</span>
          <p className="truncate text-[10px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
            {chain.family} · {chain.kind}
          </p>
        </div>
        <StatusBadge status={chain.status} />
      </div>

      {/* hero height + sparkline */}
      <div className="mt-5">
        <p className="text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">head block</p>
        <div className="mt-1 flex items-end justify-between gap-2">
          {chain.headHeight !== null ? (
            <span className="num text-2xl font-bold leading-none" style={{ color: tone }}>
              <AnimatedNumber value={chain.headHeight} />
            </span>
          ) : (
            <span className="num text-2xl font-bold leading-none text-[var(--down)]">—</span>
          )}
          {chain.lagSeconds !== null ? (
            <span className="num text-[10px] text-[var(--text-tertiary)]">lag {fmtAge(chain.lagSeconds)}</span>
          ) : null}
        </div>
        <Sparkline points={hist} color={tone} height={38} id={`net-${chain.id}`} className="mt-2" />
      </div>

      {/* metrics */}
      <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 border-t border-[var(--border-subtle)] pt-4">
        <StatCell label="version" value={chain.version ?? "—"} />
        <StatCell label="head id" value={chain.headId ? `${chain.headId.slice(0, 10)}…` : "—"} />
        <StatCell label="state age" value={fmtAge(chain.stateAgeSeconds)} />
        <StatCell label="probed" value={fmtAge(secondsSince(chain.probedAt))} />
      </div>

      {/* market row for the host chain */}
      {isSteem && market ? (
        <div className="mt-4 flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] px-3 py-2">
          <span className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
            <Boxes className="h-3 w-3" aria-hidden /> internal market
          </span>
          <span className="flex items-baseline gap-2">
            <FlashValue value={Number(market.ticker.latest)} format={fmtPrice} className="text-[13px] font-bold" />
            <Delta value={market.ticker.percentChange} />
          </span>
        </div>
      ) : null}

      {/* note (honest) */}
      <p className="mt-4 line-clamp-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">{chain.note}</p>
    </motion.button>
  );
}

/* ------------------------------------------------------------------ */

function NetworkDetail({ chain }: { chain: EcoChain }) {
  const tone = chainTone(chain.id);
  const registry = ECO_NETWORKS.find((n) => n.id === chain.id);
  return (
    <div className="flex flex-col gap-5 p-1">
      <SheetHeader className="p-0 text-left">
        <div className="flex items-center gap-3">
          <ChainGlyph id={chain.id} name={chain.name} size={40} />
          <div>
            <SheetTitle className="text-lg font-bold tracking-wide">{chain.name}</SheetTitle>
            <SheetDescription className="text-[10px] uppercase tracking-[0.2em]">
              {chain.family} · {chain.kind}
            </SheetDescription>
          </div>
          <div className="ml-auto">
            <StatusBadge status={chain.status} />
          </div>
        </div>
      </SheetHeader>

      <div className="grid grid-cols-2 gap-4">
        <StatCell label="head height" value={fmtHeight(chain.headHeight)} />
        <StatCell label="lag" value={fmtAge(chain.lagSeconds)} />
        <StatCell label="version" value={chain.version ?? "—"} />
        <StatCell label="probe age" value={fmtAge(secondsSince(chain.probedAt))} />
      </div>

      <div className="rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] p-3">
        <p className="mb-1 text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">head id</p>
        <p className="num break-all text-[11px] text-foreground/80">{chain.headId ?? "—"}</p>
      </div>

      <DetailRow icon={<Network className="h-3.5 w-3.5" />} tone={tone} label="role" value={registry?.role ?? "—"} />
      <DetailRow
        icon={<ShieldHalf className="h-3.5 w-3.5" />}
        tone={tone}
        label="adapter status"
        value={registry?.adapterStatus ?? "—"}
      />

      <div className="rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] p-3">
        <p className="mb-1 flex items-center gap-1.5 text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          <Zap className="h-3 w-3" aria-hidden /> probe note
        </p>
        <p className="text-[11.5px] leading-relaxed text-foreground/80">{chain.note}</p>
      </div>

      <p className="num flex items-center gap-1.5 text-[9px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
        <Clock3 className="h-3 w-3" aria-hidden /> probed {chain.probedAt}
      </p>
      <p className="num flex items-center gap-1.5 text-[9px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
        <Layers className="h-3 w-3" aria-hidden /> source: live RPC probe via /api/eco/networks
      </p>
    </div>
  );
}

function DetailRow({
  icon,
  tone,
  label,
  value,
}: {
  icon: React.ReactNode;
  tone: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span style={{ color: tone }} className="mt-0.5 shrink-0">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">{label}</p>
        <p className="text-[12px] leading-relaxed text-foreground/85">{value}</p>
      </div>
    </div>
  );
}

function secondsSince(iso: string): number {
  const t = Date.parse(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
  return Number.isFinite(t) ? Math.max(0, (Date.now() - t) / 1000) : NaN;
}
