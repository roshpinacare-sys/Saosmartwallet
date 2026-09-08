"use client";

/**
 * SaosHero — the SAOS-first opening band of the landing tab.
 * ==========================================================
 * One glance must answer "what is this network and is it alive?":
 *   · Mission line — SAOS-NET is OUR sovereign chain, plainly stated
 *   · Live sovereign stats — height, checkpoints+verified txs, kernel bench,
 *     treasury, wrapped economy, pools, anchored rails (all chain-sourced)
 *   · Identity anchors strip — real checkpoint seals on public chains with
 *     verifiable explorer txids (/api/eco/anchors)
 *   · CTAs into the two product surfaces: PROOFS (identity demo) and
 *     DEVELOPER (metered Identity API + SDK)
 * Anti-mock: unavailable data renders as "—" with the reason, never guessed.
 */

import { motion } from "framer-motion";
import { ArrowRight, Boxes, ExternalLink, Fingerprint, KeyRound, ShieldHalf } from "lucide-react";

import { Sparkline } from "@/components/terminal/charts";
import { AnimatedNumber, useRollingHistory } from "@/components/terminal/motion-bits";
import { Skeleton } from "@/components/terminal/primitives";
import { fmtCompact, fmtMicroSaos, useEcoAnchors, useEcoNetworks, useEcoSaosNet } from "@/hooks/use-eco";
import { cn } from "@/lib/utils";

export type SaosJumpTarget = "proofs" | "developer" | "saosnet";

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
const item = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.4, 0, 0.2, 1] as const } },
};

const ANCHOR_KIND_LABEL: Record<string, string> = {
  "checkpoint-anchor": "CHECKPOINT",
  "tron-anchor": "TRON SEAL",
  "soldier-attest": "ATTEST",
};

function chainTint(chain: string): string {
  switch (chain) {
    case "steem":
      return "var(--up)";
    case "hive":
      return "var(--warning)";
    case "tron":
      return "var(--down)";
    default:
      return "var(--saos)";
  }
}

export function SaosHero({ onJump }: { onJump: (t: SaosJumpTarget) => void }) {
  const { data: saos, isLoading: saosLoading } = useEcoSaosNet();
  const { data: net } = useEcoNetworks();
  const { data: anchorsRes } = useEcoAnchors();

  const core = saos?.core ?? null;
  const engine = saos?.engine ?? null;

  const height = core?.height ?? null;
  const heightHist = useRollingHistory("hero:saosnet-height", height, 64);

  const chains = net?.chains ?? [];
  const online = chains.filter((c) => c.status === "online").length;

  const wrappedCount = saos?.wrapped?.length ?? null;
  const poolCount = saos?.pools?.length ?? null;
  const anchors = anchorsRes?.anchors ?? [];

  return (
    <motion.section
      variants={container}
      initial="hidden"
      animate="show"
      aria-label="SAOS sovereign network overview"
      className="glass glow-card p-5 sm:p-7"
    >
      <div className="grid gap-7 lg:grid-cols-12">
        {/* mission */}
        <motion.div variants={item} className="lg:col-span-7">
          <p className="num inline-flex items-center gap-2 rounded-full border border-[var(--saos)]/40 bg-[var(--saos)]/10 px-3 py-1 text-[9px] font-bold tracking-[0.24em] text-[var(--saos)]">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--saos)] opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--saos)]" />
            </span>
            THE NETWORK&apos;S OWN CHAIN — LIVE
          </p>
          <h1 className="mt-4 text-2xl font-black leading-tight tracking-tight text-foreground sm:text-[34px]">
            SAOS is our sovereign network —
            <span className="text-[var(--saos)]"> every claim anchored in public.</span>
          </h1>
          <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-[var(--text-secondary)] sm:text-sm">
            SAOS-NET runs as a deterministic chain with sealed checkpoints written to public
            chains (verifiable txids below), identity proven by the same key across Steem, Hive
            and EVM, and a kernel measured — not claimed — on real archive replays. Every number
            on this screen is chain-sourced; nothing is mocked.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => onJump("proofs")}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-[11px] font-bold tracking-[0.14em] text-white transition-transform hover:scale-[1.02]"
              style={{ background: "var(--gradient-saos)" }}
            >
              <Fingerprint className="h-4 w-4" aria-hidden />
              RUN A LIVE IDENTITY PROOF
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => onJump("developer")}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-white/[0.03] px-4 py-2.5 text-[11px] font-bold tracking-[0.14em] text-foreground/90 transition-colors hover:border-[var(--saos)]/50 hover:text-[var(--saos)]"
            >
              <KeyRound className="h-4 w-4" aria-hidden />
              GET A METERED API KEY
            </button>
            <button
              type="button"
              onClick={() => onJump("saosnet")}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2.5 text-[11px] font-bold tracking-[0.14em] text-[var(--text-secondary)] transition-colors hover:text-foreground"
            >
              <ShieldHalf className="h-4 w-4" aria-hidden />
              DEEP DIVE: SAOS-NET
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </motion.div>

        {/* height hero */}
        <motion.div
          variants={item}
          className="flex flex-col justify-between rounded-xl border border-[var(--saos)]/30 bg-[var(--saos)]/[0.06] p-5 lg:col-span-5"
        >
          <div className="flex items-center justify-between">
            <p className="text-[9px] uppercase tracking-[0.24em] text-[var(--text-tertiary)]">
              saos-net height · block
            </p>
            <span className="num text-[9px] uppercase tracking-[0.18em] text-[var(--saos)]">sovereign</span>
          </div>
          {saosLoading && height === null ? (
            <Skeleton className="mt-2 h-10 w-40" />
          ) : (
            <p className="num mt-1 text-4xl font-black leading-none text-foreground sm:text-5xl">
              {height !== null ? <AnimatedNumber value={height} /> : <span className="text-[var(--down)]">—</span>}
            </p>
          )}
          <Sparkline points={heightHist} color="#8b5cf6" height={40} id="hero-height" className="mt-3" />
          <p className="num mt-2 text-[10px] tracking-[0.08em] text-[var(--text-tertiary)]">
            {core
              ? `${core.checkpointCount.toLocaleString("en-US")} checkpoints · ${core.verifiedCount.toLocaleString("en-US")} txs verified · ${core.netVersion ?? "net ?"}`
              : "state unavailable — daemon push pending (honest —, never invented)"}
          </p>
        </motion.div>
      </div>

      {/* sovereign stat band */}
      <div className="mt-6 grid grid-cols-2 gap-3 border-t border-[var(--border-subtle)] pt-5 sm:grid-cols-3 xl:grid-cols-5">
        <HeroStat
          label="kernel bench"
          value={engine?.bench?.txsPerSec ?? null}
          format={fmtCompact}
          sub="tx/s · measured on real archive replay"
        />
        <HeroStat
          label="treasury p&l"
          value={engine?.treasuryPnlSAOS ?? null}
          format={fmtMicroSaos}
          sub={
            engine?.treasuryPnlTodaySAOS !== null && engine?.treasuryPnlTodaySAOS !== undefined
              ? `today ${fmtMicroSaos(engine.treasuryPnlTodaySAOS)}`
              : "today —"
          }
          tone={(engine?.treasuryPnlSAOS ?? 0) >= 0 ? "var(--up)" : "var(--down)"}
        />
        <HeroStat
          label="wrapped assets"
          value={wrappedCount}
          format={(n) => n.toLocaleString("en-US")}
          sub="supply == locked · enforced"
        />
        <HeroStat
          label="sovereign pools"
          value={poolCount}
          format={(n) => n.toLocaleString("en-US")}
          sub="AMM pairs seeded on-chain"
        />
        <HeroStat
          label="anchored rails up"
          value={chains.length > 0 ? online : null}
          format={(n) => `${n}/${chains.length}`}
          sub="public chains probed live"
        />
      </div>

      {/* identity anchors strip */}
      <div className="mt-6 border-t border-[var(--border-subtle)] pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="num flex items-center gap-2 text-[10px] font-bold tracking-[0.2em] text-foreground/85">
            <Boxes className="h-3.5 w-3.5 text-[var(--saos)]" aria-hidden />
            CHECKPOINT ANCHORS — SEALED ON PUBLIC CHAINS
          </p>
          <p className="num text-[9px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
            {anchors.length > 0 ? `${anchors.length} recent seals · click a txid to verify` : "no anchors published yet — honest empty state"}
          </p>
        </div>
        {anchors.length > 0 ? (
          <div className="mt-3 flex gap-2.5 overflow-x-auto pb-1.5">
            {anchors.slice(0, 6).map((a) => (
              <a
                key={a.id}
                href={a.explorer ?? "#"}
                target="_blank"
                rel="noreferrer"
                aria-label={`checkpoint ${a.cpHeight} anchored on ${a.chain} — open explorer transaction`}
                className={cn(
                  "group flex shrink-0 items-center gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] px-3 py-2 transition-colors",
                  a.explorer && "hover:border-[var(--saos)]/50 hover:bg-[var(--saos)]/[0.06]",
                )}
              >
                <span
                  className="num rounded-md px-1.5 py-0.5 text-[9px] font-bold tracking-[0.14em]"
                  style={{ color: chainTint(a.chain), background: "rgba(255,255,255,0.04)" }}
                >
                  {ANCHOR_KIND_LABEL[a.kind] ?? a.kind.toUpperCase()}
                </span>
                <span className="num text-[11px] font-bold text-foreground/90">cp#{a.cpHeight.toLocaleString("en-US")}</span>
                <span className="num text-[10px] text-[var(--text-tertiary)] group-hover:text-[var(--saos)]">
                  {a.txid ? `${a.txid.slice(0, 14)}…` : "no txid"}
                </span>
                {a.explorer ? <ExternalLink className="h-3 w-3 text-[var(--text-tertiary)] group-hover:text-[var(--saos)]" aria-hidden /> : null}
              </a>
            ))}
          </div>
        ) : (
          <div className="mt-3 flex gap-2.5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-9 w-44" />
            ))}
          </div>
        )}
      </div>
    </motion.section>
  );
}

function HeroStat({
  label,
  value,
  format,
  sub,
  tone,
}: {
  label: string;
  value: number | null;
  format: (n: number) => string;
  sub: string;
  tone?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">{label}</p>
      {value === null ? (
        <Skeleton className="h-7 w-20" />
      ) : (
        <p className="num text-xl font-bold leading-none" style={{ color: tone ?? "var(--foreground)" }}>
          <AnimatedNumber value={value} format={format} />
        </p>
      )}
      <p className="text-[9.5px] leading-snug text-[var(--text-tertiary)]">{sub}</p>
    </div>
  );
}
