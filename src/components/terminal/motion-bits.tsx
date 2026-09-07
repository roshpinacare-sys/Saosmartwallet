"use client";

/**
 * Motion bits — the terminal's animated-number layer.
 *
 * AnimatedNumber tweens between values through a Framer Motion motion-value;
 * the formatted string is rendered as a MotionValue child so React never
 * re-renders per animation frame (DOM text updates only).
 *
 * FlashValue replays a green/red flash whenever a polled value ticks
 * (adjust-during-render pattern — zero effects, zero listeners).
 *
 * useRollingHistory keeps an in-memory ring buffer of live polled values so
 * sparklines plot REAL session data sampled from the chain — nothing synthetic.
 */

import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "framer-motion";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* AnimatedNumber                                                      */
/* ------------------------------------------------------------------ */

function defaultFormat(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function AnimatedNumber({
  value,
  format = defaultFormat,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => format(v));

  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: 0.55, ease: [0.4, 0, 0.2, 1] });
    return () => controls.stop();
  }, [value, mv, reduce]);

  return (
    <motion.span className={cn("num", className)} aria-label={format(value)}>
      {text}
    </motion.span>
  );
}

/* ------------------------------------------------------------------ */
/* FlashValue                                                          */
/* ------------------------------------------------------------------ */

export function FlashValue({
  value,
  format,
  className,
}: {
  value: number;
  format?: (v: number) => string;
  className?: string;
}) {
  // Adjust-during-render: on value change bump `tick`, which re-keys the span
  // and replays the CSS flash animation. The animation ends at the base style,
  // so the flash class never needs clearing — no effects needed.
  const [state, setState] = useState({ value, flash: "", tick: 0 });
  if (value !== state.value && Number.isFinite(value)) {
    setState({
      value,
      flash: value > state.value ? "flash-up" : "flash-down",
      tick: state.tick + 1,
    });
  }

  return (
    <span key={state.tick} className={cn("num", state.flash, className)}>
      {format ? format(value) : defaultFormat(value)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Delta — percent change chip                                         */
/* ------------------------------------------------------------------ */

export function Delta({ value, className }: { value: number | null; className?: string }) {
  if (value === null || !Number.isFinite(value)) {
    return <span className={cn("num text-[10px] text-[var(--text-tertiary)]", className)}>—</span>;
  }
  const up = value >= 0;
  return (
    <span
      className={cn("num inline-flex items-center gap-0.5 text-[10px] font-semibold", className)}
      style={{ color: up ? "var(--up)" : "var(--down)" }}
    >
      <span aria-hidden>{up ? "▲" : "▼"}</span>
      {up ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Rolling session history (real polled data → sparklines)             */
/* ------------------------------------------------------------------ */

export interface HistPoint {
  t: number;
  v: number;
}

function createRing(max: number) {
  let points: HistPoint[] = [];
  const listeners = new Set<() => void>();
  return {
    subscribe(l: () => void): () => void {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    get(): HistPoint[] {
      return points;
    },
    push(v: number): void {
      const next = points.length >= max ? points.slice(-(max - 1)) : points.slice();
      next.push({ t: Date.now(), v });
      points = next;
      for (const l of listeners) l();
    },
  };
}

const rings = new Map<string, ReturnType<typeof createRing>>();

/**
 * Appends `value` to a per-key ring buffer whenever the polled value changes
 * and returns the points. The buffer lives in a module-level external store
 * (consumed via useSyncExternalStore) so pushing from an effect never fights
 * React state. Data is REAL — sampled live values over the browser session.
 */
export function useRollingHistory(key: string, value: number | null, max = 48): HistPoint[] {
  const ring = useMemo(() => {
    const existing = rings.get(key);
    if (existing) return existing;
    const fresh = createRing(max);
    rings.set(key, fresh);
    return fresh;
  }, [key, max]);

  const lastPushed = useRef<number | null>(null);
  useEffect(() => {
    if (value === null || !Number.isFinite(value)) return;
    if (lastPushed.current === value) return;
    lastPushed.current = value;
    ring.push(value);
  }, [value, ring]);

  return useSyncExternalStore(ring.subscribe, ring.get, ring.get);
}
