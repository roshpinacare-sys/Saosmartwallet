"use client";

/**
 * BridgeMonitor — the cross-chain door. Anchor matrix (registry truth from
 * the scan) + LIVE anchor feed (real txids from SAOS-NET checkpoints via
 * their daemon state) + soldier attestations + TRON bridge pulse.
 */

import { motion } from "framer-motion";
import { ExternalLink, GitBranch, ShieldCheck, Waypoints } from "lucide-react";

import { PanelHeader } from "@/components/dex/terminal-furniture";
import { EcoStatusChip } from "@/components/grid/eco-bits";
import { fmtHeight, useEcoAnchors, useEcoSaosNet } from "@/hooks/use-eco";
import { ECO_BRIDGES } from "@/lib/eco-registry";
import { cn } from "@/lib/utils";

const CHAIN_TONE: Record<string, string> = {
  steem: "text-[var(--up)] border-[var(--up)]/35 bg-[var(--up)]/10",
  hive: "text-[var(--amberterminal)] border-[var(--amberterminal)]/35 bg-[var(--amberterminal)]/10",
  tron: "text-[chart-4] border-[chart-4]/40 bg-[chart-4]/10",
  internal: "text-muted-foreground border-border/70 bg-secondary/40",
};

export function BridgeMonitor() {
  const { data } = useEcoAnchors();
  const { data: saos } = useEcoSaosNet();

  const anchors = data?.anchors ?? [];
  const attests = data?.attests ?? [];
  const tron = saos?.tronBridge;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      {/* anchor matrix */}
      <section className="glass rounded-lg xl:col-span-5" aria-label="Anchor matrix">
        <PanelHeader title="Anchor Matrix" subtitle="per-rail truth (scan + live evidence)" icon={<Waypoints className="h-4 w-4" />} />
        <div className="flex flex-col divide-y divide-border/40 p-2">
          {ECO_BRIDGES.map((b) => (
            <div key={b.id} className="flex flex-col gap-1.5 px-2 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="num flex items-center gap-2 text-[12px] font-bold text-foreground">
                  <GitBranch className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  {b.rail}
                </p>
                <EcoStatusChip status={b.status} />
              </div>
              <p className="text-[10px] leading-snug text-muted-foreground">{b.mechanism}</p>
              <p className="num truncate text-[10px] text-foreground/70" title={b.evidence}>{b.evidence}</p>
            </div>
          ))}
        </div>
      </section>

      {/* live anchor feed */}
      <section className="glass rounded-lg xl:col-span-7" aria-label="Live anchor feed">
        <PanelHeader
          title="Live Anchor Feed"
          subtitle="real txids from SAOS-NET checkpoints (daemon state)"
          icon={<ShieldCheck className="h-4 w-4" />}
          right={<span className="num text-[10px] text-muted-foreground">{anchors.length} recent</span>}
        />
        <div className="scroll-thin max-h-[340px] overflow-y-auto">
          {anchors.length === 0 ? (
            <p className="px-4 py-8 text-center text-[11px] text-muted-foreground">no anchors in current state window…</p>
          ) : (
            <ul className="divide-y divide-border/30">
              {anchors.map((a, i) => (
                <motion.li
                  key={a.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25, delay: Math.min(i * 0.03, 0.3) }}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <span className={cn("num rounded-sm border px-1.5 py-px text-[9px] font-bold tracking-[0.12em]", CHAIN_TONE[a.chain])}>
                    {a.chain.toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] text-foreground/90">{a.detail}</p>
                    <p className="num truncate text-[9px] text-muted-foreground">txid {a.txid}</p>
                  </div>
                  {a.explorer ? (
                    <a
                      href={a.explorer}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:border-[var(--up)]/50 hover:text-[var(--up)]"
                      aria-label="open explorer"
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    </a>
                  ) : null}
                </motion.li>
              ))}
            </ul>
          )}
        </div>
        {tron?.pulse ? (
          <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-2.5">
            <p className="num text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              TRON pulse · live height #{fmtHeight(tron.pulse.tronHeight)}
            </p>
            <p className="num text-[9px] text-muted-foreground">
              last anchor cp#{tron.lastAnchor?.cpHeight ?? "—"} · {tron.anchors ?? 0} total
            </p>
          </div>
        ) : null}
      </section>

      {/* soldier attests */}
      <section className="glass rounded-lg xl:col-span-12" aria-label="Soldier attestations">
        <PanelHeader
          title="Soldier Attestations"
          subtitle="quorum signatures on checkpoints (internal ledger txids)"
          icon={<span aria-hidden className="text-[13px]">✶</span>}
          right={<span className="num text-[10px] text-muted-foreground">{attests.length} shown</span>}
        />
        <div className="scroll-thin flex max-h-[180px] flex-wrap gap-2 overflow-y-auto p-3">
          {attests.length === 0 ? (
            <p className="w-full py-4 text-center text-[11px] text-muted-foreground">no attests in current window…</p>
          ) : (
            attests.map((a) => (
              <span key={a.id} className="num inline-flex items-center gap-2 rounded-md border border-border/60 bg-secondary/40 px-2.5 py-1.5 text-[10px] text-foreground/85">
                <span className="font-bold text-[var(--up)]">{a.detail.split(" ")[0]}</span>
                <span className="text-muted-foreground">{a.txid?.slice(0, 10)}…</span>
              </span>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
