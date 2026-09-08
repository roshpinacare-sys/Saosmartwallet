"use client";

/**
 * ProofLab — three LIVE demos that prove the breakthroughs (PROOFS tab).
 *
 * Demo 1 · Identity Anchor — paste a Steem username; the lab reads the
 *   latest saos.id.v1 custom_json from mainnet, runs ecrecover on the
 *   EIP-191 signature, and proves the same secp256k1 scalar is the live
 *   active authority on Steem+Hive and the owner of the EVM address.
 * Demo 2 · Grid98 Benchmark — spawns the REAL production engine
 *   (sovereign/node/grid98.cjs --bench) which replays real archive
 *   transactions through kernel.applyTx and reports measured TPS plus
 *   the honesty-gate counters. Nothing simulated.
 * Demo 3 · Soldier Fleet — 13 soldiers measured live (SP/VP/RC from
 *   steemd formulas + newest on-chain ops), auto-refreshing every 10s.
 *
 * Anti-mock: every number arrives from /api/saos/* routes; failures are
 * rendered as honest error states, never invented.
 */

import { useState } from "react";

import { motion } from "framer-motion";
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  Cpu,
  ExternalLink,
  Fingerprint,
  Gauge,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Users,
  XCircle,
} from "lucide-react";

import { PanelHeader, StatCell } from "@/components/terminal/primitives";
import { useEcoSaosNet } from "@/hooks/use-eco";
import {
  useSaosAnchorVerify,
  useSaosFleetStatus,
  useSaosGrid98Bench,
  useSaosGrid98BenchRerun,
  type FleetSoldier,
  type Grid98BenchResponse,
} from "@/hooks/use-proofs";
import { cn } from "@/lib/utils";

const ROLE_LABEL: Record<string, string> = {
  commander: "COMMANDER",
  trade: "SOLDIER",
  reserve: "RESERVE",
  ring: "TRON RING",
};

function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("num font-mono text-[11px] break-all", className)}>{children}</span>;
}

function Verdict({ ok, label }: { ok: boolean | null; label: string }) {
  if (ok === null) {
    return (
      <span className="num inline-flex items-center gap-1 rounded border border-[var(--border-default)] px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-[var(--text-tertiary)]">
        N/A
      </span>
    );
  }
  return (
    <span
      className={cn(
        "num inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-bold tracking-wider",
        ok
          ? "border-[var(--up)]/40 bg-[var(--up)]/10 text-[var(--up)]"
          : "border-[var(--down)]/40 bg-[var(--down)]/10 text-[var(--down)]",
      )}
    >
      {ok ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : <XCircle className="h-3 w-3" aria-hidden />}
      {label}
    </span>
  );
}

/* ─────────────────────────── Demo 1: Identity Anchor ─────────────────────────── */

function IdentityAnchorPanel() {
  const [username, setUsername] = useState("headcorner");
  const verify = useSaosAnchorVerify();
  const r = verify.data;

  return (
    <section className="glass flex flex-col overflow-hidden" aria-labelledby="proof-anchor-title">
      <PanelHeader
        title="IDENTITY ANCHOR · CROSS-PARADIGM PROOF"
        subtitle="One signature binds Steem + Hive + EVM — verified with pure math, right now"
        icon={<Fingerprint className="h-4 w-4 text-[var(--saos)]" aria-hidden />}
        right={r ? <Verdict ok={r.ok} label={r.ok ? "PROVEN" : "NOT PROVEN"} /> : undefined}
        accent="saos"
      />
      <div className="flex flex-col gap-4 p-4">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            verify.mutate(username);
          }}
        >
          <label className="sr-only" htmlFor="anchor-username">
            Steem username
          </label>
          <input
            id="anchor-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="steem username (default headcorner)"
            className="num min-h-11 flex-1 rounded-md border border-[var(--border-default)] bg-black/30 px-3 py-2 font-mono text-xs outline-none focus:border-[var(--saos)]"
          />
          <button
            type="submit"
            disabled={verify.isPending}
            className="num inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[var(--saos)]/50 bg-[var(--saos)]/15 px-4 py-2 text-[11px] font-bold tracking-[0.14em] text-[var(--saos)] transition hover:bg-[var(--saos)]/25 disabled:opacity-50"
          >
            {verify.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <KeyRound className="h-3.5 w-3.5" aria-hidden />}
            VERIFY IDENTITY ANCHOR
          </button>
        </form>

        {verify.isError && (
          <p className="rounded-md border border-[var(--down)]/40 bg-[var(--down)]/10 px-3 py-2 text-xs text-[var(--down)]">
            {verify.error.message}
          </p>
        )}

        {r && r.error && (
          <p className="rounded-md border border-[var(--down)]/40 bg-[var(--down)]/10 px-3 py-2 text-xs text-[var(--down)]">
            {r.error}
          </p>
        )}

        {r && !r.error && r.anchor && r.verify && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCell label="ON-CHAIN ANCHOR" value={<Mono>#{r.anchor.block}</Mono>} sub={`custom_json saos.id.v1 · ${r.anchor.timestamp.slice(0, 10)}`} />
              <StatCell label="HISTORY SCANNED" value={r.verify.scanned} sub="entries, newest-first, live" />
              <StatCell label="EIP-191 RECOVERY" value={<Verdict ok={r.verify.claimedMatchesRecovered} label="sig == claim" />} sub="ecrecover(digest, sig) == payload.evm" />
              <StatCell label="SAME SCALAR" value={<Verdict ok={r.verify.sameScalarProof} label="KEY == EVM" />} sub="active-key point derives the EVM address" />
            </div>

            <div className="flex flex-col gap-2 rounded-md border border-[var(--border-subtle)] bg-black/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="num text-[9px] font-bold tracking-[0.2em] text-[var(--text-tertiary)]">EVM ADDRESS (EIP-55)</span>
                <Mono className="text-[var(--up)]">{r.verify.recoveredEvm}</Mono>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="num text-[9px] font-bold tracking-[0.2em] text-[var(--text-tertiary)]">STEEM ACTIVE AUTHORITY</span>
                <Mono>{r.verify.activeKeyPub}</Mono>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="num text-[9px] font-bold tracking-[0.2em] text-[var(--text-tertiary)]">ANCHOR TX</span>
                <a
                  href={r.anchor.explorer}
                  target="_blank"
                  rel="noreferrer"
                  className="num inline-flex items-center gap-1 font-mono text-[11px] text-[var(--saos)] underline-offset-2 hover:underline"
                >
                  {r.anchor.trxId.slice(0, 18)}…
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {r.chains?.map((c) => (
                <div key={c.chain} className="flex flex-col gap-1.5 rounded-md border border-[var(--border-subtle)] p-3">
                  <div className="flex items-center justify-between">
                    <span className="num text-[10px] font-bold tracking-[0.2em] uppercase">{c.chain}</span>
                    <Verdict ok={c.sameKeyAsSteem} label={c.sameKeyAsSteem === null ? "N/A" : c.sameKeyAsSteem ? "SAME KEY" : "DIFFERENT"} />
                  </div>
                  <Mono className="text-[10px] text-[var(--text-secondary)]">{c.activePub ?? c.note ?? "—"}</Mono>
                </div>
              ))}
            </div>

            <p className="rounded-md border border-[var(--up)]/25 bg-[var(--up)]/5 px-3 py-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
              {r.summary}
            </p>
          </motion.div>
        )}
      </div>
    </section>
  );
}

/* ─────────────────────────── Demo 2: Grid98 Bench ─────────────────────────── */

function Grid98BenchPanel() {
  const bench = useSaosGrid98Bench();
  const rerun = useSaosGrid98BenchRerun();
  // The daemon-pushed engine ledger (already loaded by the page's eco feed)
  // provides the recorded bench — the honest baseline for the FIRST re-run,
  // before any in-session result exists. Clearly labeled "recorded ledger".
  const saosnet = useEcoSaosNet();
  const recordedBench = saosnet.data?.engine.bench ?? null;
  const [duration, setDuration] = useState(15_000);
  // Re-run history: the pre-run result is kept so the NEW measurement renders
  // NEXT TO the PREVIOUS one (delta visible). First render falls back to the
  // engine's recorded ledger bench; the first re-run then compares against it.
  const [previous, setPrevious] = useState<Grid98BenchResponse | null>(null);

  // Current display prefers the latest SUCCESSFUL re-run, then the last RUN.
  // An ok:false re-run never replaces the displayed numbers — it renders as
  // the honest error it is (zero-mock: no fake zeros clobbering real data).
  const rerunResult = rerun.data ?? null;
  const rerunOk = rerunResult?.ok === true && rerunResult.run !== null;
  const r = rerunOk ? rerunResult : bench.data;
  const tps = r?.run?.txsPerSec ?? null;
  const engineBusy = bench.isPending || rerun.isPending;

  const reRunBench = () => {
    const snapshot = (rerunOk ? rerunResult : bench.data) ?? null; // pre-run result
    rerun.mutate(10_000, {
      onSuccess: (data) => {
        // Only promote the old result to "previous" when the re-run actually
        // produced a fresh measurement — a failed run keeps the display intact.
        if (data.ok && data.run) setPrevious(snapshot);
      },
    });
  };

  const prevTps = previous?.run?.txsPerSec ?? recordedBench?.txsPerSec ?? null;
  const curTps = r?.run?.txsPerSec ?? null;
  const tpsDeltaPct =
    curTps !== null && prevTps !== null && prevTps !== 0 ? ((curTps - prevTps) / prevTps) * 100 : null;
  const prevTxs = previous?.run?.txs ?? null;
  const curTxs = r?.run?.txs ?? null;
  const txsDeltaPct =
    curTxs !== null && prevTxs !== null && prevTxs !== 0 ? ((curTxs - prevTxs) / prevTxs) * 100 : null;
  // A delta against the ledger baseline is honest ONLY when the ledger number
  // is a real measured bench (txsPerSec + timestamp present).
  const prevIsLedger = previous?.run?.txsPerSec == null && recordedBench?.txsPerSec != null && recordedBench?.at != null;
  const prevAt = previous?.run?.at ?? recordedBench?.at ?? null;

  const bars = [
    { name: "Ethereum L1", tps: 15, src: "public reference" },
    { name: "Solana", tps: 2000, src: "public reference" },
    { name: "Grid98 (measured now)", tps: tps ?? 0, src: "this run" },
  ];
  const maxBar = Math.max(...bars.map((b) => b.tps), 1);

  return (
    <section className="glass flex flex-col overflow-hidden" aria-labelledby="proof-bench-title">
      <PanelHeader
        title="GRID98 · LIVE ENGINE BENCHMARK"
        subtitle="The production kernel replays real archive transactions — measured now, in this sandbox"
        icon={<Gauge className="h-4 w-4 text-[var(--saos)]" aria-hidden />}
        right={tps !== null ? <Verdict ok={true} label={`${tps.toLocaleString()} TPS`} /> : undefined}
        accent="saos"
      />
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex items-center gap-1" role="group" aria-label="benchmark duration">
            {[15_000, 30_000, 60_000].map((ms) => (
              <button
                key={ms}
                type="button"
                onClick={() => setDuration(ms)}
                aria-pressed={duration === ms}
                className={cn(
                  "num min-h-11 rounded-md border px-3 py-2 text-[11px] font-bold tracking-wider transition",
                  duration === ms
                    ? "border-[var(--saos)]/60 bg-[var(--saos)]/15 text-[var(--saos)]"
                    : "border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]",
                )}
              >
                {ms / 1000}s
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={engineBusy}
            onClick={() =>
              bench.mutate(duration, {
                // A fresh full RUN supersedes the re-run comparison — clear the
                // re-run payload so the display reflects the newest measurement.
                onSuccess: () => rerun.reset(),
              })
            }
            className="num inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border border-[var(--saos)]/50 bg-[var(--saos)]/15 px-4 py-2 text-[11px] font-bold tracking-[0.14em] text-[var(--saos)] transition hover:bg-[var(--saos)]/25 disabled:opacity-50"
          >
            {bench.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ENGINE RUNNING…
              </>
            ) : (
              <>
                <Cpu className="h-3.5 w-3.5" aria-hidden />
                RUN LIVE BENCHMARK
              </>
            )}
          </button>
        </div>

        {/* Re-run control (network-audit hardening): fixed 10s bench through the
            documented GET surface, previous result kept for a visible delta. */}
        <div className="flex flex-col gap-2 rounded-md border border-[var(--border-subtle)] bg-black/20 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="num text-[10px] font-bold tracking-[0.18em] text-foreground/90">RE-RUN BENCH · 10s</p>
            <p className="mt-0.5 text-[10px] leading-snug text-[var(--text-tertiary)]">
              Spawns the same real engine via GET /api/saos/grid98-bench?benchMs=10000 and keeps the previous
              measurement so the delta is visible.
            </p>
          </div>
          <button
            type="button"
            disabled={engineBusy}
            onClick={reRunBench}
            aria-label="re-run the grid98 benchmark for 10 seconds against the previous result"
            className="num inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md border border-[var(--saos)]/50 bg-[var(--saos)]/15 px-4 py-2 text-[11px] font-bold tracking-[0.14em] text-[var(--saos)] transition hover:bg-[var(--saos)]/25 disabled:opacity-50"
          >
            {rerun.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                RE-RUNNING…
              </>
            ) : (
              <>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                RE-RUN BENCH (10s)
              </>
            )}
          </button>
        </div>

        {bench.isPending && (
          <p className="text-xs text-[var(--text-tertiary)]">
            Booting the real kernel from the 39.7MB archive, then replaying real transactions through
            applyTx for {duration / 1000}s. This takes roughly {duration / 1000 + 15} seconds — no fake numbers.
          </p>
        )}

        {rerun.isPending && (
          <p className="flex items-center gap-2 text-xs text-[var(--saos)]" role="status" aria-live="polite">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Replaying real archive txs — this takes ~10s. The kernel boot replays the full archive first, so the
            wall clock is longer — real work, no fake numbers.
          </p>
        )}

        {bench.isError && (
          <p className="rounded-md border border-[var(--down)]/40 bg-[var(--down)]/10 px-3 py-2 text-xs text-[var(--down)]">
            {bench.error.message}
          </p>
        )}

        {rerun.isError && (
          <p className="rounded-md border border-[var(--down)]/40 bg-[var(--down)]/10 px-3 py-2 text-xs text-[var(--down)]">
            re-run failed: {rerun.error.message}
          </p>
        )}

        {/* ok:false re-run — the honest failure path. The previously measured
            numbers stay on screen untouched; only the error is added. */}
        {rerunResult && !rerunOk && (
          <p className="rounded-md border border-[var(--down)]/40 bg-[var(--down)]/10 px-3 py-2 text-xs text-[var(--down)]">
            re-run reported ok:false — {rerunResult.error ?? "no fresh bench in the engine ledger"}. The result
            below is the last successful measurement, untouched.
          </p>
        )}

        {r && r.error && !r.run && (
          <p className="rounded-md border border-[var(--down)]/40 bg-[var(--down)]/10 px-3 py-2 text-xs text-[var(--down)]">{r.error}</p>
        )}

        {r && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-4">
            {r.run && (
              <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <StatCell
                    label="MEASURED THROUGHPUT"
                    value={<span className="num text-xl font-bold text-[var(--up)]">{(r.run.txsPerSec ?? 0).toLocaleString()}</span>}
                    sub="tx/sec — real txs, real kernel"
                  />
                  <StatCell label="TXS REPLAYED" value={(r.run.txs ?? 0).toLocaleString()} sub={`in ${((r.run.ms ?? 0) / 1000).toFixed(1)}s`} />
                  <StatCell
                    label="CEILING / DAY"
                    value={(r.run.capabilityPerDay ?? 0).toLocaleString()}
                    sub="chain mechanism capability"
                  />
                  <StatCell label="RUN AT" value={<Mono>{r.run.at?.slice(11, 19) ?? "—"}</Mono>} sub="UTC" />
                </div>

                <div className="flex flex-col gap-2">
                  {bars.map((b) => (
                    <div key={b.name} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <span className="num text-[10px] font-bold tracking-[0.14em]">{b.name}</span>
                        <span className="num text-[10px] text-[var(--text-tertiary)]">
                          {b.tps.toLocaleString()} TPS · {b.src}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded bg-white/5">
                        <div
                          className={cn("h-full rounded", b.name.startsWith("Grid98") ? "bg-[var(--up)]" : "bg-[var(--text-tertiary)]/40")}
                          style={{ width: `${Math.max(1.5, (b.tps / maxBar) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {/* NEW vs PREVIOUS — rendered once a re-run produced a fresh
                    measurement and a real baseline exists (in-session previous
                    run, or the engine's recorded ledger bench, labeled as
                    such). Honest measured ÷ measured arithmetic only. */}
                {rerunOk && (previous?.run || prevIsLedger) && (
                  <div className="flex flex-col gap-2 rounded-md border border-[var(--border-subtle)] bg-black/25 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="num text-[9px] font-bold tracking-[0.2em] text-[var(--text-tertiary)]">
                        RE-RUN vs PREVIOUS
                      </span>
                      <span className="num text-[9px] text-[var(--text-tertiary)]">both numbers are real engine measurements</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <StatCell
                        label="NEW (this re-run)"
                        value={<span className="num text-[var(--saos)]">{(curTps ?? 0).toLocaleString()} tx/s</span>}
                        sub={`at ${rerunResult?.run?.at?.slice(11, 19) ?? "—"} UTC${curTxs !== null ? ` · ${curTxs.toLocaleString()} txs` : ""}`}
                      />
                      <StatCell
                        label={prevIsLedger ? "PREVIOUS (engine ledger)" : "PREVIOUS (kept)"}
                        value={<span className="num">{(prevTps ?? 0).toLocaleString()} tx/s</span>}
                        sub={
                          prevIsLedger
                            ? `daemon-recorded bench @ ${prevAt?.slice(11, 19) ?? "—"} UTC — not this session`
                            : `at ${prevAt?.slice(11, 19) ?? "—"} UTC${prevTxs !== null ? ` · ${prevTxs.toLocaleString()} txs` : ""}`
                        }
                      />
                    </div>
                    <p className="num text-[10px] text-[var(--text-tertiary)]">
                      Δ throughput{" "}
                      {tpsDeltaPct !== null ? (
                        <span style={{ color: tpsDeltaPct >= 0 ? "var(--up)" : "var(--down)" }}>
                          {tpsDeltaPct >= 0 ? "+" : ""}
                          {tpsDeltaPct.toFixed(2)}%
                        </span>
                      ) : (
                        "—"
                      )}
                      {prevTxs !== null && curTxs !== null && (
                        <>
                          {" "}· Δ txs replayed{" "}
                          <span style={{ color: (txsDeltaPct ?? 0) >= 0 ? "var(--up)" : "var(--down)" }}>
                            {(txsDeltaPct ?? 0) >= 0 ? "+" : ""}
                            {(txsDeltaPct ?? 0).toFixed(2)}%
                          </span>
                        </>
                      )}
                      {" "}(measured ÷ measured — no reference numbers involved)
                    </p>
                  </div>
                )}
              </>
            )}

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCell label="SKIPPED · EDGE GATE" value={(r.gates.skippedForEdge ?? 0).toLocaleString()} sub="refused: edge below fee+min" />
              <StatCell label="REJECTED" value={(r.gates.rejected ?? 0).toLocaleString()} sub="engine discipline counters" />
              <StatCell label="EDGE LEAK µ" value={(r.gates.edgeLeak ?? 0).toLocaleString()} sub="measured leak, reported" />
              <StatCell label="FLOOR LADDER" value={`${r.gates.floorSteps.length} steps`} sub="value steps with backing" />
            </div>

            <p className="rounded-md border border-[var(--up)]/25 bg-[var(--up)]/5 px-3 py-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
              {r.run?.note ??
                "No fresh run in the engine ledger — press RUN LIVE BENCHMARK to measure now. Numbers shown without a run are the engine's own lifetime honesty counters, not this run's throughput."}
              {r.provenance.archiveBytes !== null && (
                <>
                  {" "}
                  Provenance: {r.provenance.engineFile} over {r.provenance.archiveFile} ({(r.provenance.archiveBytes / 1e6).toFixed(1)}MB),{" "}
                  {r.provenance.benchMode}.
                </>
              )}
            </p>
          </motion.div>
        )}
      </div>
    </section>
  );
}

/* ─────────────────────────── Demo 3: Soldier Fleet ─────────────────────────── */

function SoldierCard({ s, onClick, active }: { s: FleetSoldier; onClick: () => void; active: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      className={cn(
        "flex min-h-11 flex-col gap-1.5 rounded-md border p-2.5 text-left transition",
        active
          ? "border-[var(--saos)]/60 bg-[var(--saos)]/10"
          : "border-[var(--border-subtle)] bg-black/20 hover:border-[var(--border-strong)]",
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="num truncate font-mono text-[11px] font-bold">@{s.name}</span>
        <span
          className={cn("inline-block h-1.5 w-1.5 rounded-full", s.isOnline === true ? "led-live bg-[var(--up)]" : "bg-[var(--down)]")}
          aria-label={s.isOnline === true ? "online" : "offline"}
        />
      </div>
      <div className="num flex items-center justify-between font-mono text-[9px] text-[var(--text-tertiary)]">
        <span>{ROLE_LABEL[s.role] ?? s.role}</span>
        <span>{s.sp !== null ? `${s.sp < 1 ? s.sp.toFixed(3) : s.sp.toFixed(2)} SP` : "sp —"}</span>
      </div>
      <div className="num flex items-center justify-between font-mono text-[9px]">
        <span className="text-[var(--text-tertiary)]">VP {s.vpPct !== null ? `${s.vpPct.toFixed(1)}%` : "—"}</span>
        <span className={cn(s.rcPct !== null && s.rcPct > 10 ? "text-[var(--up)]" : "text-[var(--down)]")}>
          RC {s.rcPct !== null ? `${s.rcPct.toFixed(1)}%` : "—"}
        </span>
      </div>
      <div className="num truncate font-mono text-[9px] text-[var(--text-tertiary)]">
        {s.lastActivity ? `${s.lastActivity.ageMinutes}m ago · ${s.lastActivity.type}` : "no recent ops"}
      </div>
    </button>
  );
}

function FleetPanel() {
  const fleet = useSaosFleetStatus();
  const [selected, setSelected] = useState<string | null>(null);
  const r = fleet.data;
  const soldier = r?.soldiers.find((s) => s.name === selected) ?? null;

  return (
    <section className="glass flex flex-col overflow-hidden" aria-labelledby="proof-fleet-title">
      <PanelHeader
        title="SOLDIER FLEET · LIVE ON MAINNET"
        subtitle="13 Steem accounts measured now — SP/VP/RC + their newest on-chain operations"
        icon={<Users className="h-4 w-4 text-[var(--saos)]" aria-hidden />}
        right={
          <span className="num inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] px-2 py-0.5 text-[9px] font-bold tracking-[0.14em]">
            <Activity className="h-3 w-3 text-[var(--up)]" aria-hidden />
            {r ? r.statusLine : "MEASURING…"}
          </span>
        }
        accent="saos"
      />
      <div className="flex flex-col gap-4 p-4">
        {fleet.isError && (
          <p className="rounded-md border border-[var(--down)]/40 bg-[var(--down)]/10 px-3 py-2 text-xs text-[var(--down)]">
            {fleet.error.message}
          </p>
        )}
        {r?.error && (
          <p className="rounded-md border border-[var(--down)]/40 bg-[var(--down)]/10 px-3 py-2 text-xs text-[var(--down)]">{r.error}</p>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7">
          {(r?.soldiers ?? Array.from({ length: 13 }).map((_, i) => null)).map((s, i) =>
            s ? (
              <SoldierCard key={s.name} s={s} onClick={() => setSelected(selected === s.name ? null : s.name)} active={selected === s.name} />
            ) : (
              <div key={i} className="h-[92px] animate-pulse rounded-md border border-[var(--border-subtle)] bg-black/20" aria-label="measuring" />
            ),
          )}
        </div>

        {soldier && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-3 rounded-md border border-[var(--border-subtle)] bg-black/25 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="num flex items-center gap-2 font-mono text-xs font-bold">
                <ShieldCheck className="h-3.5 w-3.5 text-[var(--saos)]" aria-hidden />@{soldier.name}
                <span className="rounded border border-[var(--border-default)] px-1.5 py-0.5 text-[9px] text-[var(--text-tertiary)]">
                  {ROLE_LABEL[soldier.role] ?? soldier.role}
                </span>
                {soldier.created && <span className="text-[9px] text-[var(--text-tertiary)]">since {soldier.created}</span>}
              </span>
              <ChevronDown className="h-3.5 w-3.5 rotate-180 text-[var(--text-tertiary)]" aria-hidden />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCell label="SP" value={soldier.sp !== null ? soldier.sp.toFixed(4) : "—"} sub="vesting shares ÷ 1e6" />
              <StatCell label="VOTING POWER" value={soldier.vpPct !== null ? `${soldier.vpPct}%` : "—"} sub="5-day regen formula" />
              <StatCell label="RC" value={soldier.rcPct !== null ? `${soldier.rcPct}%` : "—"} sub="resource credits" />
              <StatCell
                label="LAST ACTIVITY"
                value={soldier.lastActivity ? `${soldier.lastActivity.ageMinutes}m ago` : "—"}
                sub={soldier.lastActivity ? soldier.lastActivity.type : "no recent ops"}
              />
            </div>
            <div className="max-h-64 overflow-y-auto rounded border border-[var(--border-subtle)]">
              <table className="w-full text-left">
                <caption className="sr-only">Recent on-chain operations of @{soldier.name}</caption>
                <thead className="sticky top-0 bg-black/60">
                  <tr className="num text-[9px] tracking-[0.14em] text-[var(--text-tertiary)]">
                    <th className="px-2 py-1.5 font-bold">AGE</th>
                    <th className="px-2 py-1.5 font-bold">OP</th>
                    <th className="px-2 py-1.5 font-bold">DETAIL</th>
                    <th className="px-2 py-1.5 font-bold">TX</th>
                  </tr>
                </thead>
                <tbody>
                  {soldier.recentOps.map((op, i) => (
                    <tr key={`${op.trxId}-${i}`} className="border-t border-[var(--border-subtle)]">
                      <td className="num px-2 py-1.5 font-mono text-[10px] text-[var(--text-tertiary)]">{op.ageMinutes}m</td>
                      <td className="num px-2 py-1.5 font-mono text-[10px] font-bold">{op.type}</td>
                      <td className="max-w-0 truncate px-2 py-1.5 font-mono text-[10px] text-[var(--text-secondary)]">{op.summary}</td>
                      <td className="px-2 py-1.5">
                        <a
                          href={`https://steemworld.org/tx/${op.trxId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="num inline-flex items-center gap-1 font-mono text-[10px] text-[var(--saos)] hover:underline"
                        >
                          {op.trxId.slice(0, 8)}
                          <ExternalLink className="h-2.5 w-2.5" aria-hidden />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
        <p className="text-[10px] leading-relaxed text-[var(--text-tertiary)]">
          Auto-refreshes every 10s. Click a soldier for its newest on-chain operations — each row links to the public
          transaction. Online = RC above the 10% discipline floor the fleet&apos;s RC-heal loop enforces.
        </p>
      </div>
    </section>
  );
}

export function ProofLab() {
  return (
    <div className="flex flex-col gap-4 md:gap-5">
      <IdentityAnchorPanel />
      <Grid98BenchPanel />
      <FleetPanel />
    </div>
  );
}
