"use client";

/**
 * BridgeExplorer — M3 cross-network route finder (BRIDGES tab).
 * ============================================================
 * From/To/Asset/Amount → Find Routes → route cards with REAL fee legs
 * (live ETH gas via adapter, Solana protocol constants, honest "0 TRX /
 * RC-borne" for anchor rails), block-cadence time estimates and the
 * deployment readiness gate. A gated route shows its gateReason — never
 * hidden, never skipped. Zero mock: fees without a source are not shown.
 */

import { motion } from "framer-motion";
import { ArrowRight, Clock, Info, Lock, Search, ShieldCheck, Waypoints } from "lucide-react";
import { useState } from "react";

import {
  type BridgePath,
  useBridgeRoutes,
  useBridgeStatus,
} from "@/hooks/use-eco";
import { AnimatedNumber } from "@/components/terminal/motion-bits";
import { EcoChip, ErrorNote, PanelHeader, StatCell, chainTone } from "@/components/terminal/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const NETWORK_OPTIONS = [
  { id: "steem", label: "STEEM" },
  { id: "hive", label: "HIVE" },
  { id: "blurt", label: "BLURT" },
  { id: "tron", label: "TRON" },
  { id: "saos-net", label: "SAOS-NET" },
  { id: "ethereum", label: "ETHEREUM" },
  { id: "solana", label: "SOLANA" },
] as const;

const ASSETS = ["STEEM", "SBD", "SAOS", "HIVE", "BLURT", "TRX", "ETH", "SOL", "WSTEEM"];

function fmtEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `~${Math.round(seconds)}s`;
  if (seconds < 3600) return `~${Math.round(seconds / 60)} min`;
  return `~${(seconds / 3600).toFixed(1)} h`;
}

export function BridgeExplorer() {
  const [from, setFrom] = useState("steem");
  const [to, setTo] = useState("ethereum");
  const [asset, setAsset] = useState("STEEM");
  const [amount, setAmount] = useState("100");
  const [search, setSearch] = useState<{ from: string; to: string; asset: string; amount: string } | null>(null);

  const routes = useBridgeRoutes({
    from: search?.from ?? "",
    to: search?.to ?? "",
    asset: search?.asset ?? "",
    amount: search?.amount ?? "",
    enabled: search !== null,
  });
  const status = useBridgeStatus();

  const onFind = () => {
    if (from === to) return;
    setSearch({ from, to, asset, amount: amount || "0" });
  };

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      {/* finder */}
      <section className="glass overflow-hidden" aria-label="Bridge explorer">
        <PanelHeader
          title="Bridge Explorer"
          subtitle="7-network route finder · live-quoted fees"
          icon={<Search className="h-4 w-4" />}
        />
        <div className="grid grid-cols-2 gap-3 p-5 lg:grid-cols-5">
          <label className="flex flex-col gap-1.5">
            <span className="text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">from</span>
            <Select value={from} onValueChange={setFrom}>
              <SelectTrigger aria-label="Source network" className="num h-9 text-[11px] font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NETWORK_OPTIONS.map((n) => (
                  <SelectItem key={n.id} value={n.id} className="num text-[11px]">
                    {n.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">to</span>
            <Select value={to} onValueChange={setTo}>
              <SelectTrigger aria-label="Target network" className="num h-9 text-[11px] font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NETWORK_OPTIONS.filter((n) => n.id !== from).map((n) => (
                  <SelectItem key={n.id} value={n.id} className="num text-[11px]">
                    {n.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">asset</span>
            <Select value={asset} onValueChange={setAsset}>
              <SelectTrigger aria-label="Asset" className="num h-9 text-[11px] font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSETS.map((a) => (
                  <SelectItem key={a} value={a} className="num text-[11px]">
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">amount</span>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              aria-label="Amount"
              className="num h-9 text-[11px] font-semibold"
              placeholder="0.00"
            />
          </label>

          <div className="col-span-2 flex items-end lg:col-span-1">
            <Button
              onClick={onFind}
              disabled={from === to}
              className="num h-9 w-full bg-[var(--saos)] text-[11px] font-bold tracking-[0.1em] text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              aria-label="Find bridge routes"
            >
              <Waypoints className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              FIND ROUTES
            </Button>
          </div>
        </div>

        {from === to ? (
          <ErrorNote message="source and target must differ — pick two networks" />
        ) : null}

        {/* routes */}
        {search ? (
          <div className="border-t border-[var(--border-subtle)] p-5 pt-4">
            {routes.isLoading ? (
              <div className="flex flex-col gap-3" aria-busy="true" aria-label="Quoting routes">
                {[0, 1].map((i) => (
                  <div key={i} className="skeleton-shimmer h-24 rounded-lg" />
                ))}
              </div>
            ) : routes.isError ? (
              <ErrorNote message={`route quote failed — ${routes.error instanceof Error ? routes.error.message : "unknown"}`} />
            ) : (routes.data?.paths.length ?? 0) === 0 ? (
              <p className="py-6 text-center text-[11.5px] text-[var(--text-tertiary)]">
                no route found between {search.from.toUpperCase()} and {search.to.toUpperCase()} — the router invents nothing
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {routes.data!.paths.map((p, i) => (
                  <RouteCard key={p.id} path={p} index={i} />
                ))}
              </div>
            )}
            {routes.data ? (
              <p className="num mt-3 text-[9.5px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                quoted {new Date(routes.data.quotedAt).toLocaleTimeString("en-GB")} · every fee leg carries its source
              </p>
            ) : null}
          </div>
        ) : (
          <div className="border-t border-[var(--border-subtle)] px-5 py-4">
            <p className="text-[11.5px] leading-relaxed text-[var(--text-tertiary)]">
              Pick source and target — the router returns live-quoted routes only. Gated rails
              (no deployed bridge contract/program) appear with their honest gate reason.
            </p>
          </div>
        )}
      </section>

      {/* analytics — real counters only */}
      <section className="glass overflow-hidden" aria-label="Bridge analytics">
        <PanelHeader
          title="Bridge Analytics"
          subtitle="measured from live anchor state · null when unmeasurable"
          icon={<ShieldCheck className="h-4 w-4" />}
          right={status.data ? <EcoChip status="live" /> : null}
        />
        <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
          <StatCell
            label="anchors total"
            value={status.data?.analytics.anchoredTotal != null ? <AnimatedNumber value={status.data.analytics.anchoredTotal} /> : "—"}
            sub="measured (bridge state)"
          />
          <StatCell
            label="checkpoints verified"
            value={
              status.data?.analytics.checkpointsVerified != null ? (
                <AnimatedNumber value={status.data.analytics.checkpointsVerified} />
              ) : (
                "—"
              )
            }
            sub={`of ${status.data?.analytics.checkpointsTotal ?? "—" } sealed`}
          />
          <StatCell
            label="last anchor"
            value={
              status.data?.analytics.lastAnchor?.txid
                ? `${status.data.analytics.lastAnchor.txid.slice(0, 10)}…`
                : "—"
            }
            sub={
              status.data?.analytics.lastAnchor?.cpHeight != null
                ? `cp#${status.data.analytics.lastAnchor.cpHeight} @ ${status.data.analytics.lastAnchor.chain?.toUpperCase() ?? "—"}`
                : null
            }
          />
          <StatCell
            label="wrapped collateral"
            value={status.data?.analytics.wrapped.length ? `${status.data.analytics.wrapped.length} assets` : "—"}
            sub="supply locked 1:1 on SAOS-NET"
          />
        </div>
        {status.data && status.data.analytics.wrapped.length > 0 ? (
          <div className="scroll-thin max-h-44 overflow-y-auto border-t border-[var(--border-subtle)]">
            <table className="w-full text-left">
              <caption className="sr-only">Wrapped bridge collateral on SAOS-NET</caption>
              <thead>
                <tr className="text-[9px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                  <th scope="col" className="px-5 py-2 font-semibold">asset</th>
                  <th scope="col" className="px-5 py-2 text-right font-semibold">locked</th>
                  <th scope="col" className="px-5 py-2 text-right font-semibold">supply</th>
                  <th scope="col" className="hidden px-5 py-2 text-right font-semibold sm:table-cell">holders</th>
                </tr>
              </thead>
              <tbody>
                {status.data.analytics.wrapped.slice(0, 10).map((w) => (
                  <tr key={w.asset} className="border-t border-[var(--border-subtle)] transition-colors hover:bg-white/[0.02]">
                    <td className="num px-5 py-2 text-[11px] font-semibold text-foreground/90">{w.asset}</td>
                    <td className="num px-5 py-2 text-right text-[11px] text-[var(--up)]">
                      {w.locked.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    </td>
                    <td className="num px-5 py-2 text-right text-[11px] text-foreground/70">
                      {w.supply.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    </td>
                    <td className="num hidden px-5 py-2 text-right text-[11px] text-[var(--text-tertiary)] sm:table-cell">
                      {w.holders.toLocaleString("en-US")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Route card
// ---------------------------------------------------------------------------

function RouteCard({ path, index }: { path: BridgePath; index: number }) {
  const live = path.readiness === "live";
  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07, duration: 0.3 }}
      className={cn(
        "rounded-xl border p-4 transition-all",
        live
          ? "border-[var(--up)]/25 bg-[var(--up)]/[0.04]"
          : "border-[var(--warning)]/25 bg-[var(--warning)]/[0.03]",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="num text-[12px] font-bold tracking-wide text-foreground">{path.label}</h3>
        <EcoChip status={live ? "live" : "gated"} />
      </div>

      {/* hop chips */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {path.route.map((hop, i) => (
          <span key={`${hop.network}-${hop.action}-${i}`} className="flex items-center gap-1.5">
            {i > 0 ? <ArrowRight className="h-3 w-3 text-[var(--text-tertiary)]" aria-hidden /> : null}
            <span
              className="num rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em]"
              style={{
                color: chainTone(hop.network),
                borderColor: `color-mix(in srgb, ${chainTone(hop.network)} 35%, transparent)`,
                background: `color-mix(in srgb, ${chainTone(hop.network)} 8%, transparent)`,
              }}
            >
              {hop.network}:{hop.action}
            </span>
          </span>
        ))}
      </div>

      {/* metrics */}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <p className="flex items-center gap-1 text-[9px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
            <Clock className="h-3 w-3" aria-hidden /> eta
          </p>
          <p className="num mt-0.5 text-[12px] font-semibold text-foreground/90">{fmtEta(path.estimatedTime)}</p>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">trust</p>
          <p className="num mt-0.5 text-[12px] font-semibold text-foreground/90">{path.trustLevel}</p>
        </div>
        <div className="col-span-2">
          <p className="text-[9px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">fees (live-quoted)</p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            {path.fee.legs.map((leg, i) => (
              <span key={i} className="num text-[11px] text-foreground/85" title={leg.source}>
                {leg.amount} {leg.currency}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* fee sources — anti-mock evidence */}
      <div className="mt-3 space-y-1 border-t border-[var(--border-subtle)] pt-2.5">
        {path.fee.legs.map((leg, i) => (
          <p key={i} className="flex items-start gap-1.5 text-[10px] leading-relaxed text-[var(--text-tertiary)]">
            <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            <span className="num">{leg.source}</span>
          </p>
        ))}
      </div>

      {path.gateReason ? (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-[var(--warning)]/25 bg-[var(--warning)]/[0.06] px-2.5 py-2 text-[10.5px] leading-relaxed text-[var(--warning)]">
          <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>{path.gateReason}</span>
        </p>
      ) : (
        <p className="mt-3 text-[10.5px] leading-relaxed text-[var(--text-tertiary)]">{path.trustDetail}</p>
      )}
    </motion.article>
  );
}
