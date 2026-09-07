"use client";

/**
 * RegistryPanel — the scan result, rendered: 8 repos, services, the token
 * catalog, and the honest gap list. This panel shows FACTS ABOUT CODE
 * (what exists where); live numbers live in the other panels.
 */

import { ExternalLink, FolderGit2, Puzzle, TriangleAlert } from "lucide-react";

import { PanelHeader } from "@/components/dex/terminal-furniture";
import { EcoStatusChip } from "@/components/grid/eco-bits";
import { ECO_GAPS, ECO_REPOS, ECO_SERVICES, SCAN_META } from "@/lib/eco-registry";
import { cn } from "@/lib/utils";

export function RegistryPanel() {
  return (
    <div className="flex flex-col gap-4">
      {/* repos */}
      <section className="glass rounded-lg" aria-label="Repository registry">
        <PanelHeader
          title="Repository Registry"
          subtitle={`${SCAN_META.reposScanned} repos scanned · ${SCAN_META.method}`}
          icon={<FolderGit2 className="h-4 w-4" />}
          right={
            <a
              href="https://github.com/orgs/roshpinacare-sys/repositories"
              target="_blank"
              rel="noopener noreferrer"
              className="num inline-flex items-center gap-1 rounded-sm border border-border/60 bg-secondary/50 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:border-[var(--up)]/50 hover:text-[var(--up)]"
            >
              GitHub <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          }
        />
        <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2">
          {ECO_REPOS.map((r) => (
            <article key={r.name} className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card/40 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="num truncate text-[12px] font-bold text-foreground">{r.name}</p>
                <EcoStatusChip status={r.status} />
              </div>
              <p className="text-[11px] leading-snug text-foreground/80">{r.purpose}</p>
              <p className="num text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                {r.language} · {r.size}
              </p>
              {r.highlights.length > 0 ? (
                <ul className="mt-1 space-y-1 border-t border-border/40 pt-2">
                  {r.highlights.map((h) => (
                    <li key={h} className="flex items-start gap-1.5 text-[10px] leading-snug text-muted-foreground">
                      <span aria-hidden className="mt-px text-[var(--up)]">▸</span>
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* services */}
        <section className="glass rounded-lg" aria-label="Service registry">
          <PanelHeader title="Service Registry" subtitle="the machinery of the ecosystem" icon={<Puzzle className="h-4 w-4" />} />
          <div className="scroll-thin max-h-[360px] overflow-y-auto">
            <ul className="divide-y divide-border/40">
              {ECO_SERVICES.map((s) => (
                <li key={s.name} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold text-foreground/90">{s.name}</p>
                    <p className="truncate text-[10px] text-muted-foreground" title={s.what}>{s.what}</p>
                    <p className="num text-[9px] uppercase tracking-[0.14em] text-muted-foreground/70">{s.where}</p>
                  </div>
                  <EcoStatusChip status={s.status} />
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* gaps */}
        <section className="glass rounded-lg" aria-label="Honest gaps">
          <PanelHeader
            title="Honest Gaps"
            subtitle="what is missing — displayed, not hidden"
            icon={<TriangleAlert className="h-4 w-4" />}
            accent="down"
          />
          <ul className="divide-y divide-border/40">
            {ECO_GAPS.map((g) => (
              <li key={g.title} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[12px] font-semibold text-foreground/90">{g.title}</p>
                  <span
                    className={cn(
                      "num rounded-sm border px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.14em]",
                      g.severity === "high" && "border-[var(--down)]/35 bg-[var(--down)]/10 text-[var(--down)]",
                      g.severity === "medium" && "border-[var(--amberterminal)]/35 bg-[var(--amberterminal)]/10 text-[var(--amberterminal)]",
                      g.severity === "low" && "border-border/70 bg-secondary/40 text-muted-foreground",
                    )}
                  >
                    {g.severity}
                  </span>
                </div>
                <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{g.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* scan meta */}
      <section className="glass rounded-lg p-4" aria-label="Scan metadata">
        <p className="num text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
          scan {SCAN_META.scannedAt} · {SCAN_META.networksFound} networks · ~{SCAN_META.tokensTracked} tokens · live sources: {SCAN_META.liveSources.join(" · ")}
        </p>
      </section>
    </div>
  );
}
