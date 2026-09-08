"use client";

/**
 * TerminalHeader — SAOS-first command strip: the sovereign brand mark,
 * anchored-rails LED strip (live probed public chains), and the SAOS-NET
 * headline vitals (height + checkpoints verified, chains-up counter, UTC
 * clock). STEEM/SBD market data deliberately lives in the MARKETS tab —
 * the header speaks for OUR network, not an external pair.
 * Data: /api/eco/networks (7s) + /api/eco/saosnet (30s) — zero mock.
 */

import { useEffect, useState } from "react";

import { LiveBadge, StatusDot } from "@/components/terminal/primitives";
import { useEcoNetworks, useEcoSaosNet } from "@/hooks/use-eco";

function fresh(updatedAt: string | null): boolean {
  if (!updatedAt) return false;
  const t = Date.parse(updatedAt.endsWith("Z") || updatedAt.includes("+") ? updatedAt : `${updatedAt}Z`);
  return Number.isFinite(t) ? Date.now() - t < 20 * 60 * 1000 : false;
}

export function TerminalHeader() {
  const { data: net } = useEcoNetworks();
  const { data: saos } = useEcoSaosNet();
  const [clock, setClock] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setClock(new Date().toISOString().slice(11, 19));
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  const chains = net?.chains ?? [];
  const online = chains.filter((c) => c.status === "online").length;
  const height = saos?.core.height ?? null;
  const core = saos?.core ?? null;
  const saosLive = fresh(core?.updatedAt ?? null);

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border-default)] bg-[rgba(10,10,10,0.78)] backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-5 gap-y-2.5 px-4 py-2.5 sm:px-6">
        {/* brand — SAOS unambiguous */}
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--saos)]/50 shadow-[0_0_18px_-4px_var(--saos)]"
            style={{ background: "var(--gradient-saos)" }}
            aria-hidden
          >
            <span className="text-[15px] font-black text-white">◈</span>
          </div>
          <div className="leading-tight">
            <div className="flex items-center gap-2">
              <span className="text-sm font-black tracking-[0.26em] text-foreground">SAOS</span>
              <span className="num hidden rounded-full border border-[var(--saos)]/40 bg-[var(--saos)]/10 px-2 py-px text-[9px] font-bold tracking-[0.2em] text-[var(--saos)] sm:inline">
                SOVEREIGN IDENTITY NETWORK
              </span>
            </div>
            <p className="text-[9px] uppercase tracking-[0.28em] text-[var(--text-tertiary)]">
              our chain · public anchors · metered identity api
            </p>
          </div>
        </div>

        {/* anchored rails LED strip */}
        <nav aria-label="Anchored chains status strip" className="hidden items-center gap-2 lg:flex">
          <span className="num text-[8px] font-bold tracking-[0.24em] text-[var(--text-tertiary)]">ANCHORED&nbsp;RAILS</span>
          {chains.map((c) => (
            <span
              key={c.id}
              title={`${c.name} — ${c.status}${c.headHeight ? ` · #${c.headHeight.toLocaleString("en-US")}` : ""}`}
              className="flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-white/[0.03] px-2 py-1 transition-colors hover:border-[var(--border-strong)]"
            >
              <StatusDot status={c.status} className="h-1.5 w-1.5" />
              <span className="num text-[10px] font-bold tracking-[0.12em] text-foreground/85">{c.name}</span>
            </span>
          ))}
          {chains.length === 0 ? (
            <span className="num text-[10px] text-[var(--text-tertiary)]">probing rails…</span>
          ) : null}
        </nav>

        {/* SAOS-NET vitals + clock */}
        <div className="ml-auto flex items-center gap-4">
          <div className="text-right leading-tight">
            <p className="num text-[11px] font-semibold text-foreground/90">
              {height !== null ? height.toLocaleString("en-US") : "—"}
            </p>
            <p className="text-[9px] font-normal uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
              saos-net height
            </p>
          </div>
          <div className="hidden text-right leading-tight md:block">
            <p className="num text-[11px] font-semibold text-foreground/90">
              {core ? core.verifiedCount.toLocaleString("en-US") : "—"}
            </p>
            <p className="text-[9px] font-normal uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
              anchor txs verified
            </p>
          </div>
          <div className="hidden text-right sm:block">
            <p className="num text-[11px] font-semibold text-foreground/90">
              {online > 0 ? `${online}/${chains.length || 7}` : "—"}
            </p>
            <p className="text-[9px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">RAILS UP</p>
          </div>
          <div className="hidden text-right leading-tight sm:block">
            <p className="num text-[11px] font-semibold text-foreground/90">
              {clock ? `UTC ${clock}` : "UTC —:—:—"}
            </p>
            <p className="text-[9px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
              {core?.checkpointCount !== undefined && core !== null
                ? `${core.checkpointCount.toLocaleString("en-US")} checkpoints`
                : "checkpoints —"}
            </p>
          </div>
          <LiveBadge active={saosLive} />
        </div>
      </div>
    </header>
  );
}
