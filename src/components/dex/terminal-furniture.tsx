"use client";

/**
 * Terminal furniture: flashing quote numbers + panel chrome.
 */

import { useState } from "react";

import { cn } from "@/lib/utils";

export function FlashNumber({
  value,
  className,
  format,
}: {
  value: number;
  className?: string;
  format?: (v: number) => string;
}) {
  // Adjust-during-render pattern: on value change we bump `tick`, which re-keys
  // the span and replays the CSS flash animation. The animation ends at the
  // base style, so the flash class never needs clearing — zero effects.
  const [state, setState] = useState({ value, flash: "", tick: 0 });
  if (value !== state.value) {
    setState({
      value,
      flash: value > state.value ? "flash-up" : "flash-down",
      tick: state.tick + 1,
    });
  }

  return (
    <span key={state.tick} className={cn(state.flash, className)}>
      {format ? format(value) : value.toLocaleString("en-US")}
    </span>
  );
}

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
  accent?: "up" | "down" | "amber";
}) {
  const accentClass = accent === "up" ? "text-[var(--up)]" : accent === "down" ? "text-[var(--down)]" : "text-[var(--amberterminal)]";
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        {icon ? <span className={cn("shrink-0", accentClass)}>{icon}</span> : null}
        <div className="min-w-0">
          <h2 className="truncate text-[12px] font-semibold uppercase tracking-[0.18em] text-foreground/90">
            {title}
          </h2>
          {subtitle ? (
            <p className="truncate text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

export function LiveBadge({ active, label = "LIVE" }: { active: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-secondary/50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em]">
      <span
        className={cn(
          "inline-block h-1.5 w-1.5 rounded-full",
          active ? "led-live bg-[var(--up)]" : "bg-[var(--down)]",
        )}
      />
      <span className={active ? "text-[var(--up)]" : "text-muted-foreground"}>{active ? label : "STALE"}</span>
    </span>
  );
}
