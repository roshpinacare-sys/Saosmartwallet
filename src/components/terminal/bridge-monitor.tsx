"use client";

/**
 * BridgeMonitor — cross-chain rails + live anchor evidence.
 * Rail cards merge TWO layers honestly: the live /api/bridge/status feed
 * (status + evidence + last activity, 45s poll) overlays the static registry
 * metadata (mechanism copy); when the live feed is unavailable the card says
 * so instead of silently posing as fresh. Bottom: live anchor feed with REAL
 * txids + the TRON bridge pulse from the daemon-pushed SAOS-NET state.
 * Zero mock — missing data renders "—".
 */

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Cable, Radio, ShieldCheck, Waypoints } from "lucide-react";
import { useMemo } from "react";

import { AnimatedNumber } from "@/components/terminal/motion-bits";
import { EcoChip, ErrorNote, PanelHeader, PanelSkeleton, StatCell } from "@/components/terminal/primitives";
import { fmtAge, fmtCompact, fmtUsd, useBridgeStatus, useEcoAnchors, useEcoSaosNet } from "@/hooks/use-eco";
import { ECO_BRIDGES } from "@/lib/eco-registry";
import { cn } from "@/lib/utils";

export function BridgeMonitor() {
  const { data, isLoading, isError, error } = useEcoAnchors();
  const { data: saos } = useEcoSaosNet();
  const { data: bridgeStatus, isError: statusError } = useBridgeStatus();

  // live status overlays the static registry by rail id; the registry copy
  // (mechanism) remains the fallback when the feed is down
  const liveById = useMemo(() => {
    const m = new Map<string, { status: "live" | "gated" | "offline"; evidence: string; lastActivityAt: string | null }>();
    for (const s of bridgeStatus?.statuses ?? []) {
      m.set(s.id, { status: s.status, evidence: s.evidence, lastActivityAt: s.lastActivityAt });
    }
    return m;
  }, [bridgeStatus]);

  const feed = useMemo(() => {
    if (!data) return [];
    return [...data.anchors, ...data.attests]
      .slice()
      .sort((a, b) => b.cpHeight - a.cpHeight)
      .slice(0, 24);
  }, [data]);

  const tron = saos?.tronBridge ?? null;
  const cp = data?.lastCheckpoint ?? null;

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      {/* rails */}
      <section aria-label="Bridge rails" className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4 md:gap-6">
        {ECO_BRIDGES.map((b, i) => {
          const live = liveById.get(b.id);
          const status = live?.status ?? b.status;
          return (
          <motion.article
            key={b.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06, duration: 0.3 }}
            className="glass glow-card flex flex-col gap-3 p-5"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Waypoints className="h-4 w-4 text-[var(--info)]" aria-hidden />
                <h3 className="num text-[13px] font-bold tracking-wide text-foreground">{b.rail}</h3>
              </div>
              <EcoChip status={status} />
            </div>

            {/* animated rail */}
            <svg viewBox="0 0 200 12" className="h-3 w-full" aria-hidden>
              <line
                x1="4"
                y1="6"
                x2="196"
                y2="6"
                stroke={status === "live" ? "var(--up)" : "var(--warning)"}
                strokeOpacity="0.5"
                strokeWidth="1.5"
                className={status === "live" ? "flow-line" : undefined}
              />
              <circle cx="4" cy="6" r="3" fill={status === "live" ? "var(--up)" : "var(--warning)"} />
              <circle cx="196" cy="6" r="3" fill="var(--text-tertiary)" />
            </svg>

            <div>
              <p className="text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">mechanism</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-foreground/85">{b.mechanism}</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
                evidence · live feed {live?.lastActivityAt ? `· ${fmtAge(secondsSince(live.lastActivityAt))} ago` : ""}
              </p>
              <p className="num mt-1 text-[11px] leading-relaxed text-foreground/70">{live?.evidence ?? b.evidence}</p>
            </div>
          </motion.article>
          );
        })}
        {statusError ? (
          <p className="text-[10px] text-[var(--warning)]">live rail-status feed unavailable — cards fall back to registry copy</p>
        ) : null}
      </section>

      {/* last checkpoint + tron pulse */}
      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
        <section className="glass overflow-hidden" aria-label="Last checkpoint">
          <PanelHeader
            title="Last Checkpoint"
            subtitle="sealed state lineage"
            icon={<ShieldCheck className="h-4 w-4" />}
            right={cp ? <EcoChip status="live" /> : null}
          />
          <div className="grid grid-cols-3 gap-4 p-5">
            <StatCell label="cp height" value={<AnimatedNumber value={cp?.height ?? 0} />} />
            <StatCell label="checkpoint hash" value={cp?.checkpointHash ? `${cp.checkpointHash.slice(0, 14)}…` : "—"} />
            <StatCell label="state root" value={cp?.stateRoot ? `${cp.stateRoot.slice(0, 14)}…` : "—"} />
          </div>
        </section>

        <section className="glass overflow-hidden" aria-label="TRON bridge pulse">
          <PanelHeader
            title="TRON Pulse"
            subtitle="zero-fee anchor rail"
            icon={<Radio className="h-4 w-4" />}
            accent="down"
            right={tron?.lastAnchor?.at ? <span className="num text-[10px] text-[var(--text-tertiary)]">{fmtAge(secondsSince(tron.lastAnchor.at))} ago</span> : null}
          />
          <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
            <StatCell label="tron height" value={tron?.pulse?.tronHeight !== null && tron?.pulse?.tronHeight !== undefined ? <AnimatedNumber value={tron.pulse.tronHeight} /> : "—"} />
            <StatCell label="anchors" value={tron?.anchors !== null && tron?.anchors !== undefined ? tron.anchors : "—"} />
            <StatCell label="last cp" value={tron?.lastAnchor?.cpHeight ?? "—"} />
            <StatCell label="usdt vault" value={tron?.usdtTotal !== null && tron?.usdtTotal !== undefined ? fmtUsd(tron.usdtTotal) : "—"} />
          </div>
          {tron?.lastAnchor?.txid ? (
            <div className="border-t border-[var(--border-subtle)] px-5 py-2.5">
              <p className="num truncate text-[10px] text-[var(--text-tertiary)]">
                last txid <span className="text-foreground/80">{tron.lastAnchor.txid}</span>
              </p>
            </div>
          ) : null}
        </section>
      </div>

      {/* live anchor feed */}
      <section className="glass overflow-hidden" aria-label="Live anchor feed">
        <PanelHeader
          title="Live Anchor Feed"
          subtitle="real txids · checkpoints + attestations"
          icon={<Cable className="h-4 w-4" />}
          right={
            <span className="num text-[10px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
              {feed.length} records
            </span>
          }
        />
        {isLoading ? (
          <PanelSkeleton rows={5} className="border-0" />
        ) : isError || !data ? (
          <ErrorNote message={`anchor feed unavailable — ${error instanceof Error ? error.message : "unknown error"}`} />
        ) : (
          <div className="scroll-thin max-h-96 overflow-y-auto">
            <AnimatePresence initial={false}>
              {feed.map((a) => (
                <motion.div
                  key={a.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.22 }}
                  className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-2.5 transition-colors last:border-0 hover:bg-white/[0.02]"
                >
                  <span
                    className={cn(
                      "num shrink-0 rounded border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.14em]",
                      a.chain === "steem" && "border-[var(--up)]/35 bg-[var(--up)]/10 text-[var(--up)]",
                      a.chain === "hive" && "border-[var(--warning)]/35 bg-[var(--warning)]/10 text-[var(--warning)]",
                      a.chain === "tron" && "border-[var(--down)]/35 bg-[var(--down)]/10 text-[var(--down)]",
                      a.chain === "internal" && "border-[var(--saos)]/35 bg-[var(--saos)]/10 text-[var(--saos)]",
                    )}
                  >
                    {a.chain}
                  </span>
                  <span className="num shrink-0 text-[11px] font-semibold text-foreground/90">
                    #{a.cpHeight.toLocaleString("en-US")}
                  </span>
                  <span className="num min-w-0 flex-1 truncate text-[11px] text-foreground/70" title={a.detail}>
                    {a.txid ?? a.detail}
                  </span>
                  {a.txid && a.explorer ? (
                    <a
                      href={a.explorer}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-[var(--info)] transition-colors hover:text-foreground"
                      aria-label={`View transaction ${a.txid} in explorer`}
                    >
                      tx <ArrowRight className="inline h-3 w-3" aria-hidden />
                    </a>
                  ) : null}
                  <span className="num hidden shrink-0 text-[10px] text-[var(--text-tertiary)] sm:inline">
                    cp {fmtCompact(a.cpHeight)}
                  </span>
                </motion.div>
              ))}
            </AnimatePresence>
            {feed.length === 0 ? (
              <p className="px-4 py-8 text-center text-[11px] text-[var(--text-tertiary)]">
                no anchors recorded yet — the queue anchors when the next checkpoint seals
              </p>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

function secondsSince(iso: string): number {
  const t = Date.parse(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
  return Number.isFinite(t) ? Math.max(0, (Date.now() - t) / 1000) : NaN;
}
