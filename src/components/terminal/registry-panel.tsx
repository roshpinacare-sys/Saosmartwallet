"use client";

/**
 * RegistryPanel — the scan catalog: 8 repos, 10 services, 5 networks with
 * adapter status, and the honest gap list. Facts only (what exists where);
 * live numbers belong to the other tabs.
 */

import { motion } from "framer-motion";
import { AlertTriangle, Boxes, GitBranch, Landmark, Radar } from "lucide-react";

import { EcoChip, PanelHeader, StatCell } from "@/components/terminal/primitives";
import {
  ECO_GAPS,
  ECO_NETWORKS,
  ECO_REPOS,
  ECO_SERVICES,
  SCAN_META,
} from "@/lib/eco-registry";
import { cn } from "@/lib/utils";

const SEVERITY_TONE: Record<string, string> = {
  high: "border-[var(--down)]/30 bg-[var(--down)]/5",
  medium: "border-[var(--warning)]/30 bg-[var(--warning)]/5",
  low: "border-[var(--info)]/30 bg-[var(--info)]/5",
};
const SEVERITY_TEXT: Record<string, string> = {
  high: "text-[var(--down)]",
  medium: "text-[var(--warning)]",
  low: "text-[var(--info)]",
};

export function RegistryPanel() {
  return (
    <div className="flex flex-col gap-4 md:gap-6">
      {/* scan meta */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="glass flex flex-wrap items-center gap-x-8 gap-y-3 p-5"
        aria-label="Scan metadata"
      >
        <div className="flex items-center gap-2.5">
          <Radar className="h-4 w-4 text-[var(--info)]" aria-hidden />
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-foreground/90">
              Ecosystem Registry
            </p>
            <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
              scanned {SCAN_META.scannedAt} · {SCAN_META.method}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-6 sm:grid-cols-4">
          <StatCell label="repos" value={SCAN_META.reposScanned} />
          <StatCell label="networks" value={SCAN_META.networksFound} />
          <StatCell label="tokens" value={SCAN_META.tokensTracked} />
          <StatCell label="live sources" value={SCAN_META.liveSources.length} />
        </div>
      </motion.section>

      {/* repos */}
      <section className="glass overflow-hidden" aria-label="Repositories">
        <PanelHeader
          title="Repositories"
          subtitle={`${ECO_REPOS.length} repos · roshpinacare-sys`}
          icon={<GitBranch className="h-4 w-4" />}
          accent="info"
        />
        <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
          {ECO_REPOS.map((repo, i) => (
            <motion.article
              key={repo.name}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.3 }}
              className="glass glow-card flex flex-col gap-2.5 p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="num truncate text-[13px] font-bold text-foreground">{repo.name}</h3>
                <EcoChip status={repo.status} />
              </div>
              <p className="num text-[9px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
                {repo.size} · {repo.language}
              </p>
              <p className="text-[11.5px] leading-relaxed text-foreground/80">{repo.purpose}</p>
              {repo.highlights.length > 0 ? (
                <ul className="mt-auto flex flex-col gap-1 border-t border-[var(--border-subtle)] pt-2.5">
                  {repo.highlights.slice(0, 3).map((h) => (
                    <li key={h} className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-[var(--text-tertiary)]">
                      <span aria-hidden className="mt-px text-[var(--up)]">›</span>
                      {h}
                    </li>
                  ))}
                </ul>
              ) : null}
            </motion.article>
          ))}
        </div>
      </section>

      {/* networks + services */}
      <div className="grid grid-cols-1 gap-4 md:gap-6 xl:grid-cols-2">
        <section className="glass overflow-hidden" aria-label="Networks">
          <PanelHeader
            title="Networks"
            subtitle="adapter coverage — honest"
            icon={<Landmark className="h-4 w-4" />}
          />
          <div className="flex flex-col divide-y divide-[var(--border-subtle)]">
            {ECO_NETWORKS.map((n) => (
              <div key={n.id} className="flex flex-col gap-1 px-5 py-3.5 transition-colors hover:bg-white/[0.02]">
                <div className="flex items-center justify-between gap-2">
                  <span className="num text-[12px] font-bold text-foreground">{n.name}</span>
                  <span className="num text-[9px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                    {n.family} · {n.kind}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-foreground/75">{n.role}</p>
                <p className="num text-[10px] uppercase tracking-[0.12em] text-[var(--warning)]">{n.adapterStatus}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="glass overflow-hidden" aria-label="Services">
          <PanelHeader
            title="Services"
            subtitle={`${ECO_SERVICES.length} registered services`}
            icon={<Boxes className="h-4 w-4" />}
            accent="saos"
          />
          <div className="scroll-thin max-h-96 overflow-y-auto">
            <table className="w-full border-collapse text-[11.5px]">
              <thead className="sticky top-0 z-10 bg-[rgba(23,23,23,0.95)] backdrop-blur">
                <tr className="border-b border-[var(--border-subtle)] text-[9px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                  <th className="px-4 py-2 text-left font-medium">service</th>
                  <th className="px-4 py-2 text-left font-medium">what</th>
                  <th className="px-4 py-2 text-right font-medium">status</th>
                </tr>
              </thead>
              <tbody>
                {ECO_SERVICES.map((s) => (
                  <tr key={s.name} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-white/[0.02]">
                    <td className="num px-4 py-2.5 align-top font-semibold text-foreground/90">{s.name}</td>
                    <td className="px-4 py-2.5 align-top text-foreground/75">
                      {s.what}
                      <span className="num block text-[9px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">{s.where}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right align-top">
                      <EcoChip status={s.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* gaps — the honest list */}
      <section className="glass overflow-hidden" aria-label="Known gaps">
        <PanelHeader
          title="Honest Gaps"
          subtitle="what's missing — reported, never faked"
          icon={<AlertTriangle className="h-4 w-4" />}
          accent="warning"
        />
        <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
          {ECO_GAPS.map((gap, i) => (
            <motion.article
              key={gap.title}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.3 }}
              className={cn("rounded-lg border p-4", SEVERITY_TONE[gap.severity])}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[12px] font-bold text-foreground">{gap.title}</h3>
                <span className={cn("num text-[9px] font-bold uppercase tracking-[0.16em]", SEVERITY_TEXT[gap.severity])}>
                  {gap.severity}
                </span>
              </div>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-foreground/75">{gap.detail}</p>
            </motion.article>
          ))}
        </div>
      </section>
    </div>
  );
}
