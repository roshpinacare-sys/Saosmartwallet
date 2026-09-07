"use client";

/**
 * StatusFooter — sticky terminal footer: build tag, data provenance, the
 * zero-mock pledge, and keyboard hints. Sticks to the viewport bottom on
 * short pages, pushes down naturally on long ones (mt-auto), and respects
 * the iOS safe-area inset.
 */

import { Keyboard, ShieldCheck, Waypoints } from "lucide-react";

import { useEcoNetworks } from "@/hooks/use-eco";

export function StatusFooter() {
  const { data } = useEcoNetworks();
  const online = (data?.chains ?? []).filter((c) => c.status === "online").length;
  const total = data?.chains.length ?? 5;

  return (
    <footer
      className="mt-auto border-t border-[var(--border-default)] bg-[rgba(10,10,10,0.85)] backdrop-blur-xl"
      style={{ paddingBottom: "max(0px, env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <p className="num flex items-center gap-2 text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          <ShieldCheck className="h-3.5 w-3.5 text-[var(--up)]" aria-hidden />
          zero mock — every number on this screen comes from the chain
        </p>

        <p className="num hidden items-center gap-2 text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)] md:flex">
          <Waypoints className="h-3.5 w-3.5" aria-hidden />
          sources: api.steemit.com · api.hive.blog · rpc.blurt.world · api.trongrid.io · saos-net state
        </p>

        <p className="num hidden items-center gap-2 text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)] lg:flex">
          <Keyboard className="h-3.5 w-3.5" aria-hidden />
          keys 1–6 switch sections
        </p>

        <p className="num ml-auto text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
          chains <span className="text-[var(--up)]">{online}</span>/{total} · build{" "}
          <span className="text-foreground/70">GRID·ENTERPRISE·M3</span>
        </p>
      </div>
    </footer>
  );
}
