"use client";

/**
 * SaosHub — SAOS at the center of the stage (Breakthrough Proof tab).
 *
 * One live view of the sovereign stack, everything measured:
 *   · Chain core (deterministic kernel: height / checkpoints / verified)
 *   · grid98 engine: bench throughput, floor ladder with per-step backing,
 *     enforced profitability gates (skipped-for-edge / rejected / edge-leak)
 *   · Soldiers roster — click a soldier to see what it is doing now:
 *     live Steem SP/VP/RC, fleet pings, arena PnL, delegation scopes, age
 *   · Loop census: agent loops + node daemons with byte-size evidence
 *   · Pools + wrapped economy (supply == locked, per-asset chain notes)
 *   · Signed oracle quotes + live checkpoint anchors (public txids) + TRON pulse
 *   · dex-facts: honest events with public verifiable refs
 *
 * Anti-mock: every number comes from /api/eco/saos-hub (daemon-pushed chain
 * state + live Steem RPC + GitHub file evidence). Unavailable = null with a
 * stated reason. Zero fabrication.
 */

import { useMemo, useState } from "react";

import { motion } from "framer-motion";
import {
  Activity,
  Anchor,
  Boxes,
  Coins,
  Cpu,
  Crown,
  Dna,
  Droplets,
  ExternalLink,
  Radar,
  ShieldHalf,
} from "lucide-react";

import { AnimatedNumber } from "@/components/terminal/motion-bits";
import { EcoChip, LiveBadge, PanelHeader, PanelSkeleton, StatCell } from "@/components/terminal/primitives";
import { fmtAge, fmtMicroSaos, fmtUsd, useEcoSaosHub } from "@/hooks/use-eco";
import { cn } from "@/lib/utils";

function secondsSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
}

const ROLE_META: Record<string, { label: string; tone: string; icon: React.ReactNode }> = {
  commander: { label: "COMMANDER", tone: "var(--saos)", icon: <Crown className="h-3 w-3" aria-hidden /> },
  trade: { label: "SOLDIER", tone: "var(--up)", icon: <ShieldHalf className="h-3 w-3" aria-hidden /> },
  ring: { label: "TRON RING", tone: "var(--warning)", icon: <Anchor className="h-3 w-3" aria-hidden /> },
  reserve: { label: "RESERVE", tone: "var(--text-secondary)", icon: <Boxes className="h-3 w-3" aria-hidden /> },
};

export function SaosHub() {
  const { data, isLoading, isError, error } = useEcoSaosHub();
  const [selected, setSelected] = useState<string | null>(null);

  const maxStepBacking = useMemo(
    () => Math.max(1, ...(data?.floorSteps.map((s) => s.backedByMicro) ?? [1])),
    [data],
  );
  const maxPnl = useMemo(
    () => Math.max(1, ...(data?.soldiers.map((s) => Math.abs(s.pnlMicro ?? 0)) ?? [1])),
    [data],
  );

  if (isLoading) return <PanelSkeleton rows={8} />;
  if (isError || !data || !data.ok) {
    return (
      <div role="alert" className="glass p-6 text-center text-sm text-[var(--down)]">
        SAOS HUB unavailable — {error instanceof Error ? error.message : "state unavailable"}
      </div>
    );
  }

  const core = data.core;
  const engine = data.engine;
  const selectedSoldier = data.soldiers.find((s) => s.name === (selected ?? data.soldiers[0]?.name)) ?? null;
  const agentLoops = data.loops.agent.length;
  const nodeLoops = data.loops.node.length;
  const liveWrapped = data.wrapped.filter((w) => w.supply > 0).length;

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      {/* ── Chain core + grid98 ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 md:gap-6 xl:grid-cols-3">
        <section className="glass overflow-hidden" aria-label="SAOS-NET chain core">
          <PanelHeader
            title="Chain Core"
            subtitle="deterministic kernel · daemon-pushed state"
            icon={<Cpu className="h-4 w-4" />}
            accent="saos"
            right={<EcoChip status={core ? "live" : "gated"} />}
          />
          <div className="grid grid-cols-2 gap-4 p-5">
            <StatCell
              label="height"
              value={core?.height != null ? <AnimatedNumber value={core.height} className="text-[15px] text-[var(--saos)]" /> : "—"}
              sub={core?.updatedAt ? `${fmtAge(secondsSince(core.updatedAt))} since block` : undefined}
            />
            <StatCell label="checkpoints" value={core?.checkpointCount.toLocaleString("en-US") ?? "—"} sub={`${core?.verifiedCount.toLocaleString("en-US") ?? "—"} verified txs`} />
            <StatCell label="net version" value={core?.netVersion ?? "—"} />
            <StatCell label="genesis" value={core?.genesisHash ? `${core.genesisHash.slice(0, 10)}…` : "—"} />
          </div>
          <div className="border-t border-[var(--border-subtle)] px-5 py-2.5">
            <p className="num truncate text-[10px] text-[var(--text-tertiary)]">
              state root <span className="text-foreground/80">{core?.stateRoot ? `${core.stateRoot.slice(0, 26)}…` : "—"}</span>
            </p>
          </div>
        </section>

        <section className="glass overflow-hidden" aria-label="grid98 engine breakthrough">
          <PanelHeader
            title="grid98 Engine"
            subtitle="micro-tick market engine · measured throughput"
            icon={<Activity className="h-4 w-4" />}
            accent="saos"
            right={<LiveBadge active={(engine?.ticks ?? 0) > 0} />}
          />
          <div className="grid grid-cols-3 gap-4 p-5">
            <StatCell
              label="bench"
              value={engine?.bench.txsPerSec != null ? <span className="text-[var(--saos)]">{engine.bench.txsPerSec.toLocaleString("en-US")} tx/s</span> : "—"}
              sub={engine?.bench.capabilityPerDay != null ? `${(engine.bench.capabilityPerDay / 1e9).toFixed(2)}B/day ceiling` : undefined}
            />
            <StatCell label="rounds" value={engine?.rounds?.toLocaleString("en-US") ?? "—"} sub={`${engine?.ticks?.toLocaleString("en-US") ?? "—"} ticks`} />
            <StatCell label="txs total" value={engine?.txsTotal?.toLocaleString("en-US") ?? "—"} sub={`${engine?.tradesTotal?.toLocaleString("en-US") ?? "—"} trades`} />
            <StatCell
              label="treasury p&l"
              value={
                engine?.treasuryPnlSAOS != null ? (
                  <span style={{ color: engine.treasuryPnlSAOS >= 0 ? "var(--up)" : "var(--down)" }}>{fmtMicroSaos(engine.treasuryPnlSAOS)}</span>
                ) : (
                  "—"
                )
              }
              sub="cumulative · measured"
            />
            <StatCell label="floor" value={engine?.floor != null ? fmtUsd(engine.floor) : "—"} sub={`${data.floorSteps.length} backed steps`} />
            <StatCell label="trades today" value={engine?.tradesToday?.toLocaleString("en-US") ?? "—"} sub={`${engine?.txsToday?.toLocaleString("en-US") ?? "—"} txs`} />
          </div>
          <div className="border-t border-[var(--border-subtle)] px-5 py-2.5">
            <p className="text-[10px] leading-relaxed text-[var(--text-tertiary)]">{engine?.bench.note ?? "bench note unavailable"}</p>
          </div>
        </section>

        {/* profitability gates — the honesty engine */}
        <section className="glass overflow-hidden" aria-label="profitability gates and floor ladder">
          <PanelHeader
            title="Honesty Gates"
            subtitle="edge-gated spending · backed floor ladder"
            icon={<Radar className="h-4 w-4" />}
            accent="success"
          />
          <div className="grid grid-cols-3 gap-4 p-5">
            <StatCell label="skipped < edge" value={data.gates.skippedForEdge?.toLocaleString("en-US") ?? "—"} sub="would-be trades refused" />
            <StatCell label="rejected" value={data.gates.rejected?.toLocaleString("en-US") ?? "—"} sub="ops rejected by gate" />
            <StatCell label="edge leak µ" value={data.gates.edgeLeak?.toLocaleString("en-US") ?? "—"} sub="measured, accounted" />
          </div>
          <div className="flex items-end gap-1.5 px-5 pb-4 pt-1" aria-label="floor ladder steps, each backed by measured PnL">
            {data.floorSteps.map((s) => (
              <div key={s.at} className="group relative flex-1" title={`${new Date(s.at).toLocaleString()} · floor ${s.floor} · backed ${fmtMicroSaos(s.backedByMicro)}`}>
                <div
                  className="w-full rounded-t bg-[var(--saos)]/70 transition-all group-hover:bg-[var(--saos)]"
                  style={{ height: `${Math.max(6, (s.backedByMicro / maxStepBacking) * 64)}px` }}
                />
              </div>
            ))}
            {data.floorSteps.length === 0 && <p className="text-[10px] text-[var(--text-tertiary)]">no floor steps recorded yet</p>}
          </div>
          <div className="border-t border-[var(--border-subtle)] px-5 py-2.5">
            <p className="num text-[10px] text-[var(--text-tertiary)]">
              floor {engine?.floor != null ? fmtUsd(engine.floor) : "—"} · latest step backed {data.floorSteps.at(-1) ? fmtMicroSaos(data.floorSteps.at(-1).backedByMicro) : "—"}
            </p>
          </div>
        </section>
      </div>

      {/* ── Soldiers roster (interactive) ───────────────────────────────── */}
      <section className="glass overflow-hidden" aria-label="soldier fleet roster">
        <PanelHeader
          title="Soldier Fleet"
          subtitle={`${data.steemAccountsLive} accounts measured live on Steem · click a soldier`}
          icon={<ShieldHalf className="h-4 w-4" />}
          accent="saos"
          right={
            data.armyLiveError ? (
              <EcoChip status="gated" />
            ) : (
              <LiveBadge active={data.steemAccountsLive >= 13} label={`${data.steemAccountsLive}/13`} />
            )
          }
        />
        <div className="grid grid-cols-1 gap-0 md:grid-cols-[1fr_340px]">
          <div className="max-h-[420px] overflow-y-auto p-3 thin-scrollbar">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {data.soldiers.map((s) => {
                const meta = ROLE_META[s.role];
                const isActive = selectedSoldier?.name === s.name;
                return (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => setSelected(s.name)}
                    aria-pressed={isActive}
                    aria-label={`soldier ${s.name} — show live status`}
                    className={cn(
                      "group relative rounded-lg border p-3 text-left transition-all hover:-translate-y-0.5",
                      isActive
                        ? "border-[var(--saos)] bg-[var(--saos)]/10"
                        : "border-[var(--border-subtle)] bg-[var(--bg-raise)] hover:border-[var(--border-strong)]",
                    )}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="num text-[12px] font-bold text-foreground">{s.name}</span>
                      <span style={{ color: meta.tone }}>{meta.icon}</span>
                    </div>
                    <div className="mt-1.5 flex items-baseline justify-between gap-1">
                      <span className="num text-[11px] text-[var(--text-secondary)]">
                        {s.live ? `${s.live.sp.toFixed(2)} SP` : <span className="text-[var(--text-tertiary)]">{s.role === "ring" ? "TRON side" : "—"}</span>}
                      </span>
                      {s.pnlMicro !== null && (
                        <span className="num text-[10px]" style={{ color: s.pnlMicro >= 0 ? "var(--up)" : "var(--down)" }}>
                          {s.pnlMicro >= 0 ? "+" : ""}
                          {fmtMicroSaos(s.pnlMicro)}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 h-1 w-full overflow-hidden rounded bg-[var(--bg-deep)]">
                      <div
                        className="h-full rounded"
                        style={{
                          width: `${Math.max(2, (Math.abs(s.pnlMicro ?? 0) / maxPnl) * 100)}%`,
                          background: (s.pnlMicro ?? 0) >= 0 ? "var(--up)" : "var(--down)",
                        }}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="num text-[9px] tracking-wider text-[var(--text-tertiary)]">{meta.label}</span>
                      {s.seq !== null && <span className="num text-[9px] text-[var(--text-tertiary)]">seq {s.seq}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* soldier detail — what is it doing NOW */}
          <div className="border-t border-[var(--border-subtle)] p-5 md:border-l md:border-t-0">
            {selectedSoldier ? (
              <motion.div key={selectedSoldier.name} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
                <div className="flex items-center gap-2">
                  <span className="num text-[15px] font-bold text-foreground">@{selectedSoldier.name}</span>
                  <span className="rounded px-1.5 py-0.5 text-[9px] font-bold tracking-widest" style={{ color: ROLE_META[selectedSoldier.role].tone, background: "var(--bg-raise)" }}>
                    {ROLE_META[selectedSoldier.role].label}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <StatCell label="SP (live)" value={selectedSoldier.live ? selectedSoldier.live.sp.toFixed(2) : "—"} sub={selectedSoldier.live ? "measured now" : (selectedSoldier.liveError ?? "unmeasured")} />
                  <StatCell label="voting power" value={selectedSoldier.live?.vpPct != null ? `${selectedSoldier.live.vpPct.toFixed(1)}%` : "—"} sub="regen-corrected" />
                  <StatCell label="RC" value={selectedSoldier.live?.rcPct != null ? `${selectedSoldier.live.rcPct.toFixed(2)}%` : "—"} sub="resource credits" />
                  <StatCell label="fleet seq" value={selectedSoldier.seq !== null ? String(selectedSoldier.seq) : "—"} sub="voice pings" />
                  <StatCell label="arena p&l" value={selectedSoldier.pnlMicro !== null ? fmtMicroSaos(selectedSoldier.pnlMicro) : "—"} sub="grid98 arena" />
                  <StatCell label="on steem since" value={selectedSoldier.live?.created || "—"} />
                </div>
                <div className="mt-3">
                  <p className="text-[9px] font-bold tracking-[0.2em] text-[var(--text-tertiary)]">DELEGATION SCOPES</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {selectedSoldier.scopes.map((sc) => (
                      <span key={sc} className="num rounded border border-[var(--border-subtle)] bg-[var(--bg-raise)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
                        {sc}
                      </span>
                    ))}
                  </div>
                </div>
                <p className="mt-3 text-[10px] leading-relaxed text-[var(--text-tertiary)]">
                  {selectedSoldier.role === "commander" &&
                    "Issues the sovereign state, commands the fleet, seals anchor checkpoints to host chains (scopes: issue · anchor · command)."}
                  {selectedSoldier.role === "trade" &&
                    "Trades in the grid98 arena (maker + rotating taker), attests chain state, reports to the fleet (scopes: trade · attest · report). Keys held locally per the SAOS iron rule — never sent to any server."}
                  {selectedSoldier.role === "ring" &&
                    "TRON ring relay: checkpoint hashes bit-encoded into TRX transfers across the 6-address ring — zero net fee, measured 6/6 addresses."}
                </p>
              </motion.div>
            ) : (
              <p className="text-[11px] text-[var(--text-tertiary)]">select a soldier</p>
            )}
          </div>
        </div>
      </section>

      {/* ── Loop census + anchors ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 md:gap-6 xl:grid-cols-2">
        <section className="glass overflow-hidden" aria-label="loop census">
          <PanelHeader
            title="Loop Census"
            subtitle={`${agentLoops} agent/guardian loops · ${nodeLoops} node daemons · byte-size evidence`}
            icon={<Dna className="h-4 w-4" />}
            accent="saos"
            right={<EcoChip status={data.loops.agent.some((l) => l.bytes !== null) ? "live" : "gated"} />}
          />
          <div className="max-h-[380px] overflow-y-auto px-5 py-3 thin-scrollbar">
            <p className="text-[9px] font-bold tracking-[0.2em] text-[var(--text-tertiary)]">AGENT + GUARDIAN LOOPS</p>
            <ul className="mt-2 flex flex-col gap-2">
              {data.loops.agent.map((l) => (
                <li key={l.name} className="flex items-start justify-between gap-3 rounded border border-[var(--border-subtle)] bg-[var(--bg-raise)] p-2.5">
                  <div className="min-w-0">
                    <p className="num text-[11px] font-bold text-foreground">{l.name}</p>
                    <p className="mt-0.5 text-[10px] leading-snug text-[var(--text-tertiary)]">{l.purpose}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="num text-[10px] text-[var(--saos)]">{l.cadence}</span>
                    <p className="num text-[9px] text-[var(--text-tertiary)]">{l.bytes != null ? `${(l.bytes / 1024).toFixed(1)} KB` : "—"}</p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[9px] font-bold tracking-[0.2em] text-[var(--text-tertiary)]">SOVEREIGN NODE DAEMONS</p>
            <ul className="mt-2 flex flex-col gap-2">
              {data.loops.node.map((l) => (
                <li key={l.name} className="flex items-start justify-between gap-3 rounded border border-[var(--border-subtle)] bg-[var(--bg-raise)] p-2.5">
                  <div className="min-w-0">
                    <p className="num text-[11px] font-bold text-foreground">{l.name}</p>
                    <p className="mt-0.5 text-[10px] leading-snug text-[var(--text-tertiary)]">{l.purpose}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="num text-[10px] text-[var(--saos)]">{l.cadence}</span>
                    <p className="num text-[9px] text-[var(--text-tertiary)]">{l.bytes != null ? `${(l.bytes / 1024).toFixed(1)} KB` : "—"}</p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[10px] leading-relaxed text-[var(--text-tertiary)]">{data.loops.censusNote}</p>
          </div>
        </section>

        <div className="flex flex-col gap-4 md:gap-6">
          {/* anchors strip */}
          <section className="glass overflow-hidden" aria-label="checkpoint anchors">
            <PanelHeader
              title="Anchor Rails"
              subtitle="checkpoint seals with public txids"
              icon={<Anchor className="h-4 w-4" />}
              accent="warning"
              right={<LiveBadge active={data.anchors.length > 0} label={`${data.anchors.length} recent`} />}
            />
            <div className="max-h-[220px] overflow-y-auto px-5 py-3 thin-scrollbar">
              <ul className="flex flex-col gap-1.5">
                {data.anchors.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 rounded border border-[var(--border-subtle)] bg-[var(--bg-raise)] px-2.5 py-2">
                    <div className="min-w-0">
                      <p className="num text-[11px] text-foreground">
                        {a.chain.toUpperCase()} cp#{a.cpHeight ?? "—"}
                      </p>
                      <p className="num truncate text-[9px] text-[var(--text-tertiary)]">{a.detail}</p>
                    </div>
                    {a.explorer && (
                      <a
                        href={a.explorer}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`open explorer transaction for checkpoint ${a.cpHeight}`}
                        className="num shrink-0 rounded border border-[var(--border-subtle)] px-1.5 py-1 text-[9px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-foreground"
                      >
                        {a.txid.slice(0, 6)}… <ExternalLink className="inline h-3 w-3" aria-hidden />
                      </a>
                    )}
                  </li>
                ))}
                {data.anchors.length === 0 && <li className="text-[10px] text-[var(--text-tertiary)]">no anchors in feed — honest empty</li>}
              </ul>
            </div>
            {data.tronBridge && (
              <div className="grid grid-cols-3 gap-3 border-t border-[var(--border-subtle)] px-5 py-3">
                <StatCell label="tron anchors" value={data.tronBridge.anchors !== null ? String(data.tronBridge.anchors) : "—"} sub={data.tronBridge.measuredAddresses ?? undefined} />
                <StatCell label="last cp" value={data.tronBridge.lastAnchor?.cpHeight != null ? `#${data.tronBridge.lastAnchor.cpHeight}` : "—"} sub={data.tronBridge.lastAnchor?.tronBlock != null ? `tron blk ${data.tronBridge.lastAnchor.tronBlock.toLocaleString("en-US")}` : undefined} />
                <StatCell label="tron pulse" value={data.tronBridge.pulse?.tronHeight?.toLocaleString("en-US") ?? "—"} sub={data.tronBridge.pulse?.at ? `${fmtAge(secondsSince(data.tronBridge.pulse.at))} ago` : undefined} />
              </div>
            )}
          </section>

          {/* dex-facts */}
          <section className="glass overflow-hidden" aria-label="honest dex facts">
            <PanelHeader
              title="Honest Events"
              subtitle="dex-facts — every claim carries a public ref"
              icon={<Coins className="h-4 w-4" />}
              accent="success"
            />
            <ul className="max-h-[240px] flex flex-col gap-2 overflow-y-auto px-5 py-3 thin-scrollbar">
              {data.facts.map((f) => (
                <li key={`${f.at}-${f.kind}`} className="rounded border border-[var(--border-subtle)] bg-[var(--bg-raise)] p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="num text-[9px] font-bold tracking-widest text-[var(--warning)]">{f.kind.toUpperCase()}</span>
                    <span className="num text-[9px] text-[var(--text-tertiary)]">{new Date(f.at).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-secondary)]">{f.text}</p>
                  {f.url && (
                    <a href={f.url} target="_blank" rel="noreferrer" className="num mt-1 inline-flex items-center gap-1 text-[9px] text-[var(--saos)] hover:underline">
                      verify: {f.ref} <ExternalLink className="h-2.5 w-2.5" aria-hidden />
                    </a>
                  )}
                </li>
              ))}
              {data.facts.length === 0 && <li className="text-[10px] text-[var(--text-tertiary)]">no facts loaded — honest empty</li>}
            </ul>
          </section>
        </div>
      </div>

      {/* ── Pools + wrapped + oracle ────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 md:gap-6 xl:grid-cols-3">
        <section className="glass overflow-hidden" aria-label="grid98 pools">
          <PanelHeader
            title="DEX-98 Pools"
            subtitle={`${data.pools.length} pairs · LP tokens on-chain`}
            icon={<Droplets className="h-4 w-4" />}
            accent="saos"
          />
          <div className="max-h-[300px] overflow-y-auto px-5 py-3 thin-scrollbar">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[9px] tracking-[0.15em] text-[var(--text-tertiary)]">
                  <th className="pb-2 font-bold">PAIR</th>
                  <th className="pb-2 text-right font-bold">PX</th>
                  <th className="pb-2 text-right font-bold">LP</th>
                </tr>
              </thead>
              <tbody>
                {[...data.pools].sort((a, b) => b.lp - a.lp).map((p) => (
                  <tr key={p.pair} className="border-t border-[var(--border-subtle)]">
                    <td className="num py-1.5 text-[11px] text-foreground">{p.pair}</td>
                    <td className="num py-1.5 text-right text-[11px] text-[var(--text-secondary)]">{p.px > 0 ? p.px.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—"}</td>
                    <td className="num py-1.5 text-right text-[11px] text-[var(--text-secondary)]">{p.lp.toLocaleString("en-US", { maximumFractionDigits: 0 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="glass overflow-hidden" aria-label="wrapped economy">
          <PanelHeader
            title="Wrapped Economy"
            subtitle={`${liveWrapped}/${data.wrapped.length} assets alive · supply == locked 1:1`}
            icon={<Boxes className="h-4 w-4" />}
            accent="saos"
          />
          <div className="max-h-[300px] overflow-y-auto px-5 py-3 thin-scrollbar">
            <ul className="flex flex-col gap-1.5">
              {data.wrapped.filter((w) => w.supply > 0).map((w) => (
                <li key={w.asset} className="flex items-center justify-between gap-2 rounded border border-[var(--border-subtle)] bg-[var(--bg-raise)] px-2.5 py-1.5">
                  <span className="num text-[11px] font-bold text-foreground">{w.asset}</span>
                  <span className="num text-[10px] text-[var(--text-secondary)]">
                    supply {w.supply.toLocaleString("en-US", { maximumFractionDigits: 6 })} · locked {w.locked.toLocaleString("en-US", { maximumFractionDigits: 6 })}
                  </span>
                  <span className="num text-[9px] text-[var(--text-tertiary)]">{w.holders}h</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="glass overflow-hidden" aria-label="signed oracle quotes">
          <PanelHeader
            title="Signed Oracle"
            subtitle={`${data.oracle.length} hourly quotes · coingecko-sourced · signed refs`}
            icon={<Activity className="h-4 w-4" />}
            accent="warning"
          />
          <div className="max-h-[300px] overflow-y-auto px-5 py-3 thin-scrollbar">
            <ul className="flex flex-col gap-1.5">
              {data.oracle.map((q) => (
                <li key={q.asset} className="flex items-center justify-between gap-2 rounded border border-[var(--border-subtle)] bg-[var(--bg-raise)] px-2.5 py-1.5">
                  <span className="num text-[11px] font-bold text-foreground">{q.asset}</span>
                  <span className="num text-[10px] text-[var(--text-secondary)]">{fmtUsd(q.pxUsd)}</span>
                  <span className="num truncate text-[9px] text-[var(--text-tertiary)]" title={`${q.ref} · ${q.at}`}>{q.ref}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
