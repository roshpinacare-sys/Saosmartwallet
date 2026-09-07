"use client";

/**
 * Charts — Recharts wrappers tuned for the terminal aesthetic.
 *
 * Sparkline   — micro area-chart for network cards / KPI tiles (session data).
 * DepthChart  — cumulative bid/ask depth from a REAL order book; bids fill
 *               left of mid (green), asks right of mid (red), shared x axis.
 *
 * All inputs are precomputed native-unit points from chain data — this module
 * owns zero data logic and never invents values.
 */

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Sparkline                                                           */
/* ------------------------------------------------------------------ */

export interface SparkPoint {
  v: number;
}

export function Sparkline({
  points,
  color,
  height = 40,
  id,
  className,
}: {
  points: SparkPoint[];
  color: string;
  height?: number;
  /** unique id for the gradient def (avoid collisions across cards) */
  id: string;
  className?: string;
}) {
  if (points.length < 2) {
    return (
      <div
        style={{ height }}
        className={cn(
          "flex items-center justify-center rounded-md bg-white/[0.02] text-[9px] uppercase tracking-[0.22em] text-[var(--text-tertiary)]",
          className,
        )}
      >
        sampling…
      </div>
    );
  }
  return (
    <div style={{ height }} className={className} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#spark-${id})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Depth chart                                                         */
/* ------------------------------------------------------------------ */

export interface DepthLevel {
  priceNum: number;
  /** size in native units (STEEM / SAOS / …) */
  amount: number;
}

interface DepthRow {
  price: number;
  bid: number | null;
  ask: number | null;
}

export function DepthChart({
  bids,
  asks,
  height = 200,
  priceDecimals = 4,
  unit = "STEEM",
  className,
}: {
  /** best-first (index 0 = best bid) */
  bids: DepthLevel[];
  /** best-first (index 0 = best ask) */
  asks: DepthLevel[];
  height?: number;
  priceDecimals?: number;
  unit?: string;
  className?: string;
}) {
  const data = useMemo<DepthRow[]>(() => {
    const bidPts: DepthRow[] = [];
    let accBid = 0;
    for (const l of bids.slice(0, 14)) {
      accBid += l.amount;
      bidPts.push({ price: l.priceNum, bid: accBid, ask: null });
    }
    // bids arrive best-first (highest price first) → reverse for ascending x
    bidPts.reverse();

    const askPts: DepthRow[] = [];
    let accAsk = 0;
    for (const l of asks.slice(0, 14)) {
      accAsk += l.amount;
      askPts.push({ price: l.priceNum, bid: null, ask: accAsk });
    }
    return [...bidPts, ...askPts];
  }, [bids, asks]);

  if (data.length < 2) {
    return (
      <div
        style={{ height }}
        className={cn(
          "flex items-center justify-center rounded-md bg-white/[0.02] text-[9px] uppercase tracking-[0.22em] text-[var(--text-tertiary)]",
          className,
        )}
      >
        depth unavailable
      </div>
    );
  }

  return (
    <div style={{ height }} className={className} aria-label={`Order depth chart (${unit})`} role="img">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="depth-bid" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="depth-ask" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#ef4444" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis
            dataKey="price"
            tick={{ fill: "#737373", fontSize: 9, fontFamily: "var(--font-jetbrains)" }}
            tickLine={false}
            axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
            minTickGap={48}
            tickFormatter={(v: number) => v.toFixed(priceDecimals)}
          />
          <YAxis hide />
          <Tooltip
            cursor={{ stroke: "rgba(255,255,255,0.25)", strokeDasharray: "3 3" }}
            contentStyle={{
              background: "rgba(23,23,23,0.95)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 8,
              fontSize: 11,
              fontFamily: "var(--font-jetbrains)",
              padding: "6px 10px",
            }}
            labelStyle={{ color: "#fafafa", fontWeight: 600 }}
            labelFormatter={(v) => `price ${Number(v).toFixed(priceDecimals)}`}
            formatter={(value, name) => [
              `${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${unit}`,
              name === "bid" ? "bid depth" : "ask depth",
            ]}
          />
          <Area
            type="monotone"
            dataKey="bid"
            stroke="#10b981"
            strokeWidth={1.5}
            fill="url(#depth-bid)"
            connectNulls={false}
            isAnimationActive={false}
            dot={false}
          />
          <Area
            type="monotone"
            dataKey="ask"
            stroke="#ef4444"
            strokeWidth={1.5}
            fill="url(#depth-ask)"
            connectNulls={false}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
