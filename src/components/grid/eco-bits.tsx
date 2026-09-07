"use client";

/**
 * Grid furniture — shared bits for the ecosystem dashboard:
 * status LEDs, status badges, and small stat cells.
 */

import { cn } from "@/lib/utils";
import type { ChainStatusKind } from "@/hooks/use-eco";

export function StatusDot({ status, className }: { status: ChainStatusKind; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        status === "online" && "led-live bg-[var(--up)]",
        status === "stale" && "bg-[var(--amberterminal)]",
        status === "offline" && "bg-[var(--down)]",
        className,
      )}
      aria-label={status}
    />
  );
}

const STATUS_LABEL: Record<ChainStatusKind, string> = {
  online: "ONLINE",
  stale: "STALE",
  offline: "OFFLINE",
};

export function StatusBadge({ status }: { status: ChainStatusKind }) {
  return (
    <span
      className={cn(
        "num inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-px text-[9px] font-bold tracking-[0.16em]",
        status === "online" && "border-[var(--up)]/35 bg-[var(--up)]/10 text-[var(--up)]",
        status === "stale" && "border-[var(--amberterminal)]/35 bg-[var(--amberterminal)]/10 text-[var(--amberterminal)]",
        status === "offline" && "border-[var(--down)]/35 bg-[var(--down)]/10 text-[var(--down)]",
      )}
    >
      <StatusDot status={status} className="h-1.5 w-1.5" />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Eco status of registry entries (live/active/sim/gated/archive). */
const ECO_TONE: Record<string, { border: string; bg: string; text: string }> = {
  live: { border: "border-[var(--up)]/35", bg: "bg-[var(--up)]/10", text: "text-[var(--up)]" },
  active: { border: "border-[var(--amberterminal)]/35", bg: "bg-[var(--amberterminal)]/10", text: "text-[var(--amberterminal)]" },
  sim: { border: "border-[chart-4]/40", bg: "bg-[chart-4]/10", text: "text-[chart-4]" },
  gated: { border: "border-[var(--amberterminal)]/35", bg: "bg-[var(--amberterminal)]/10", text: "text-[var(--amberterminal)]" },
  archive: { border: "border-border/70", bg: "bg-secondary/40", text: "text-muted-foreground" },
};

export function EcoStatusChip({ status }: { status: string }) {
  const tone = ECO_TONE[status] ?? ECO_TONE.archive;
  return (
    <span
      className={cn(
        "num inline-flex items-center rounded-sm border px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.14em]",
        tone.border,
        tone.bg,
        tone.text,
      )}
    >
      {status}
    </span>
  );
}

export function StatCell({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="truncate text-[9px] uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className="num mt-0.5 truncate text-[13px] font-semibold text-foreground/90">{value}</p>
      {sub ? <p className="num mt-0.5 truncate text-[10px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("num", className)}>{children}</span>;
}
