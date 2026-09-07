"use client";

/**
 * Terminal primitives — shared furniture for the Grid Dashboard.
 * Status LEDs, badges, panel chrome, stat cells, skeletons, and per-chain
 * identity tones. All presentation-only; data flows in through props.
 */

import { cn } from "@/lib/utils";
import type { ChainStatusKind } from "@/hooks/use-eco";

/** Per-chain identity tone (design-token references, not raw hex). */
export const CHAIN_TONE: Record<string, string> = {
  steem: "var(--up)",
  hive: "var(--warning)",
  blurt: "var(--info)",
  tron: "var(--down)",
  "saos-net": "var(--saos)",
  ethereum: "var(--eth)",
  solana: "var(--sol)",
};

export function chainTone(id: string): string {
  return CHAIN_TONE[id] ?? "var(--info)";
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

export function StatusDot({ status, className }: { status: ChainStatusKind; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        status === "online" && "led-live bg-[var(--up)]",
        status === "stale" && "bg-[var(--warning)]",
        status === "offline" && "bg-[var(--down)]",
        className,
      )}
      role="img"
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
        "num inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] font-bold tracking-[0.16em]",
        status === "online" && "border-[var(--up)]/35 bg-[var(--up)]/10 text-[var(--up)]",
        status === "stale" && "border-[var(--warning)]/35 bg-[var(--warning)]/10 text-[var(--warning)]",
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
  active: { border: "border-[var(--info)]/40", bg: "bg-[var(--info)]/10", text: "text-[var(--info)]" },
  sim: { border: "border-[var(--saos)]/40", bg: "bg-[var(--saos)]/10", text: "text-[var(--saos)]" },
  gated: { border: "border-[var(--warning)]/35", bg: "bg-[var(--warning)]/10", text: "text-[var(--warning)]" },
  archive: { border: "border-[var(--border-default)]", bg: "bg-white/[0.04]", text: "text-[var(--text-tertiary)]" },
};

export function EcoChip({ status }: { status: string }) {
  const tone = ECO_TONE[status] ?? ECO_TONE.archive;
  return (
    <span
      className={cn(
        "num inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em]",
        tone.border,
        tone.bg,
        tone.text,
      )}
    >
      {status}
    </span>
  );
}

export function LiveBadge({ active, label = "LIVE" }: { active: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-white/[0.04] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em]">
      <span
        className={cn(
          "inline-block h-1.5 w-1.5 rounded-full",
          active ? "led-live bg-[var(--up)]" : "bg-[var(--down)]",
        )}
      />
      <span className={active ? "text-[var(--up)]" : "text-[var(--down)]"}>{active ? label : "STALE"}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Chrome                                                              */
/* ------------------------------------------------------------------ */

export function PanelHeader({
  title,
  subtitle,
  icon,
  right,
  accent = "up",
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  accent?: "up" | "down" | "warning" | "info" | "saos";
}) {
  const accentClass =
    accent === "up"
      ? "text-[var(--up)]"
      : accent === "down"
        ? "text-[var(--down)]"
        : accent === "warning"
          ? "text-[var(--warning)]"
          : accent === "saos"
            ? "text-[var(--saos)]"
            : "text-[var(--info)]";
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        {icon ? <span className={cn("shrink-0", accentClass)}>{icon}</span> : null}
        <div className="min-w-0">
          <h2 className="truncate text-[12px] font-semibold uppercase tracking-[0.18em] text-foreground/90">
            {title}
          </h2>
          {subtitle ? (
            <p className="truncate text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
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
      <p className="truncate text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">{label}</p>
      <p className="num mt-1 truncate text-[13px] font-semibold text-foreground/90">{value}</p>
      {sub ? <p className="num mt-0.5 truncate text-[10px] text-[var(--text-tertiary)]">{sub}</p> : null}
    </div>
  );
}

/** Rounded chain monogram with per-chain tone. */
export function ChainGlyph({ id, name, size = 32 }: { id: string; name: string; size?: number }) {
  const tone = chainTone(id);
  const letter = name.slice(0, 2).toUpperCase();
  return (
    <span
      aria-hidden
      className="num flex shrink-0 items-center justify-center rounded-lg border font-bold"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.34),
        color: tone,
        borderColor: `color-mix(in srgb, ${tone} 35%, transparent)`,
        background: `color-mix(in srgb, ${tone} 10%, transparent)`,
        boxShadow: `0 0 18px -6px ${tone}`,
      }}
    >
      {letter}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden className={cn("skeleton-shimmer", className)} style={style} />;
}

/** Full-panel skeleton: header bar + content lines. */
export function PanelSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("glass flex flex-col overflow-hidden", className)} aria-busy="true" aria-label="Loading data">
      <div className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] px-4 py-3">
        <Skeleton className="h-4 w-4 rounded" />
        <Skeleton className="h-3 w-36" />
      </div>
      <div className="flex flex-col gap-2.5 p-4">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-3" style={{ width: `${88 - i * 11}%` }} />
        ))}
      </div>
    </div>
  );
}

/** Section-level error note (honest failure display). */
export function ErrorNote({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="mx-4 mb-4 rounded-lg border border-[var(--down)]/30 bg-[var(--down)]/5 px-3 py-2.5 text-[11px] leading-relaxed text-[var(--down)]"
    >
      {message}
    </div>
  );
}
