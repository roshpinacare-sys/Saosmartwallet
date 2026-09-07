"use client";

/**
 * WalletPanel — tracked-account dashboard: balances, Steem Power, RC manabar
 * (animated), and open orders. Data: /api/steem/wallet via useWallet (15s).
 * The tracked account lives in the shared dex-store (persisted locally);
 * no keys ever enter client state.
 */

import { motion } from "framer-motion";
import { BatteryCharging, Coins, Gem, ListOrdered, Wallet2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AnimatedNumber } from "@/components/terminal/motion-bits";
import { PanelHeader, PanelSkeleton, StatCell } from "@/components/terminal/primitives";
import { fmtInt, fmtSat, timeAgo, useWallet } from "@/hooks/use-steem-market";
import { useDexStore } from "@/lib/dex-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const ACCOUNT_RE = /^[a-z0-9.\-]{3,16}$/;

export function WalletPanel() {
  const { account, setAccount } = useDexStore();
  const [draft, setDraft] = useState(account);
  const { data, isLoading, isError, error } = useWallet(account);

  const balances = useMemo(() => {
    if (!data) return null;
    const liquid = /^([\d.]+)\s+STEEM$/.exec(data.account.balances.liquid);
    const debt = /^([\d.]+)\s+SBD$/.exec(data.account.balances.debt);
    const vesting = /^([\d.]+)\s+VESTS$/.exec(data.account.balances.vestingShares);
    return {
      liquid: liquid ? Number(liquid[1]) : null,
      sbd: debt ? Number(debt[1]) : null,
      vesting: vesting ? Number(vesting[1]) : null,
    };
  }, [data]);

  const track = () => {
    const name = draft.trim().toLowerCase();
    if (!ACCOUNT_RE.test(name)) {
      toast.error("invalid account name", { description: "3–16 chars: a-z 0-9 . -" });
      return;
    }
    setAccount(name);
    toast(`tracking @${name}`);
  };

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      {/* account input */}
      <section className="glass flex flex-col gap-3 p-5 sm:flex-row sm:items-end" aria-label="Track account">
        <div className="min-w-0 flex-1 space-y-1.5">
          <label htmlFor="wallet-account" className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
            Steem account
          </label>
          <Input
            id="wallet-account"
            value={draft}
            onChange={(e) => setDraft(e.target.value.toLowerCase())}
            onKeyDown={(e) => e.key === "Enter" && track()}
            placeholder="steem-account"
            autoComplete="off"
            spellCheck={false}
            className="num h-10 border-[var(--border-subtle)] bg-white/[0.03] font-mono text-[13px]"
          />
        </div>
        <Button onClick={track} className="h-10 gap-2 px-5 text-[11px] font-bold uppercase tracking-[0.16em]">
          <Wallet2 className="h-4 w-4" aria-hidden /> Track
        </Button>
        <p className="num text-[10px] text-[var(--text-tertiary)] sm:ml-2 sm:self-center">
          {account ? `tracking @${account}` : "no account tracked"}
        </p>
      </section>

      {isLoading && account ? (
        <PanelSkeleton rows={6} />
      ) : isError ? (
        <div role="alert" className="glass p-6 text-center text-sm text-[var(--down)]">
          wallet probe failed — {error instanceof Error ? error.message : "unknown error"}
        </div>
      ) : data && balances ? (
        <>
          {/* balance cards */}
          <div className="grid grid-cols-2 gap-4 md:gap-6 xl:grid-cols-4">
            <BalanceCard
              label="Liquid STEEM"
              icon={<Coins className="h-4 w-4" />}
              tone="var(--up)"
              value={balances.liquid}
              decimals={3}
              index={0}
            />
            <BalanceCard
              label="SBD"
              icon={<Gem className="h-4 w-4" />}
              tone="var(--info)"
              value={balances.sbd}
              decimals={3}
              index={1}
            />
            <BalanceCard
              label="Steem Power"
              icon={<Gem className="h-4 w-4" />}
              tone="var(--saos)"
              value={data.account.spSatoshis / 1e6}
              decimals={3}
              index={2}
              sub={balances.vesting !== null ? `${fmtCompactVests(balances.vesting)} VESTS` : undefined}
            />
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18, duration: 0.3 }}
              className="glass glow-card flex flex-col gap-3 p-5"
            >
              <p className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
                <BatteryCharging className="h-3.5 w-3.5 text-[var(--warning)]" aria-hidden /> rc manabar
              </p>
              {data.rc ? (
                <>
                  <p
                    className="num text-2xl font-bold leading-none"
                    style={{ color: rcColor(data.rc.percent) }}
                  >
                    {data.rc.percent.toFixed(1)}%
                  </p>
                  <div className="h-2 overflow-hidden rounded-full bg-white/[0.05]" role="progressbar" aria-valuenow={Math.round(data.rc.percent)} aria-valuemin={0} aria-valuemax={100} aria-label="Resource credits">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(2, Math.min(100, data.rc.percent))}%` }}
                      transition={{ duration: 0.8, ease: [0.4, 0, 0.2, 1] }}
                      className="h-full rounded-full"
                      style={{ background: rcGradient(data.rc.percent) }}
                    />
                  </div>
                  <p className="num text-[10px] text-[var(--text-tertiary)]">
                    {fmtSatWrap(data.rc.currentMana, 6)} / {fmtSatWrap(data.rc.maxRc, 6)} mana
                  </p>
                </>
              ) : (
                <p className="num text-sm text-[var(--text-tertiary)]">rc unavailable</p>
              )}
            </motion.div>
          </div>

          {/* account meta */}
          <section className="glass overflow-hidden" aria-label="Account details">
            <PanelHeader
              title={`@${data.account.name}`}
              subtitle={data.account.created ? `since ${data.account.created.slice(0, 10)}` : "account details"}
              icon={<Wallet2 className="h-4 w-4" />}
              right={<span className="num text-[10px] text-[var(--text-tertiary)]">head #{fmtInt(data.chainStatus.headBlock)}</span>}
            />
            <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
              <StatCell label="vesting shares" value={balances.vesting !== null ? fmtCompactVests(balances.vesting) : "—"} />
              <StatCell label="steem power" value={`${fmtSat(Math.round(data.account.spSatoshis), 3)} SP`} />
              <StatCell label="open orders" value={data.openOrders.length} />
              <StatCell label="last sync" value={`${timeAgo(data.chainStatus.time)} ago`} />
            </div>
          </section>

          {/* open orders */}
          <section className="glass overflow-hidden" aria-label="Open orders">
            <PanelHeader
              title="Open Orders"
              subtitle="live internal-market positions"
              icon={<ListOrdered className="h-4 w-4" />}
              right={
                <span className="num text-[10px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
                  {data.openOrders.length} open
                </span>
              }
            />
            {data.openOrders.length === 0 ? (
              <p className="px-5 py-8 text-center text-[11px] text-[var(--text-tertiary)]">
                no open orders for this account
              </p>
            ) : (
              <div className="scroll-thin overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-[12px]">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] text-[9px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                      <th className="px-4 py-2 text-left font-medium">orderid</th>
                      <th className="px-4 py-2 text-left font-medium">selling</th>
                      <th className="px-4 py-2 text-right font-medium">receiving</th>
                      <th className="px-4 py-2 text-right font-medium">price</th>
                      <th className="px-4 py-2 text-right font-medium">created</th>
                      <th className="px-4 py-2 text-right font-medium">expires</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.openOrders.map((o) => (
                      <tr key={o.orderid} className="border-b border-[var(--border-subtle)] transition-colors last:border-0 hover:bg-white/[0.02]">
                        <td className="num px-4 py-2.5 text-[var(--text-tertiary)]">#{o.orderid}</td>
                        <td className="num px-4 py-2.5 font-semibold" style={{ color: o.sellingSymbol === "STEEM" ? "var(--down)" : "var(--up)" }}>
                          {o.sellingAmount} {o.sellingSymbol}
                        </td>
                        <td className="num px-4 py-2.5 text-right text-foreground/85">{o.receivingAmount} {o.receivingSymbol}</td>
                        <td className="num px-4 py-2.5 text-right text-foreground/85">{o.price.toFixed(6)}</td>
                        <td className="num px-4 py-2.5 text-right text-[var(--text-tertiary)]">{timeAgo(o.created)} ago</td>
                        <td className="num px-4 py-2.5 text-right text-[var(--text-tertiary)]">{timeAgo(o.expiration)} left</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : (
        <div className="glass p-10 text-center">
          <p className="text-[12px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            enter an account above to pull live balances
          </p>
          <p className="num mt-2 text-[10px] text-[var(--text-tertiary)]">
            try @steem — the full public picture, straight from the chain
          </p>
        </div>
      )}
    </div>
  );
}

function BalanceCard({
  label,
  icon,
  tone,
  value,
  decimals,
  sub,
  index,
}: {
  label: string;
  icon: React.ReactNode;
  tone: string;
  value: number | null;
  decimals: number;
  sub?: string;
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.3 }}
      className="glass glow-card flex flex-col gap-2 p-5"
    >
      <p className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
        <span style={{ color: tone }}>{icon}</span> {label}
      </p>
      <p className="num text-2xl font-bold leading-none text-foreground">
        {value !== null ? <AnimatedNumber value={value} format={(v) => v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} /> : "—"}
      </p>
      {sub ? <p className="num text-[10px] text-[var(--text-tertiary)]">{sub}</p> : null}
    </motion.div>
  );
}

function rcColor(pct: number): string {
  if (pct < 10) return "var(--down)";
  if (pct < 30) return "var(--warning)";
  return "var(--up)";
}

function rcGradient(pct: number): string {
  if (pct < 10) return "var(--gradient-danger)";
  if (pct < 30) return "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)";
  return "var(--gradient-success)";
}

function fmtCompactVests(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

/** Mana strings arrive as decimal strings — convert safely to number for display. */
function fmtSatWrap(mana: string, precision: 3 | 6): string {
  try {
    return fmtSat(Number(BigInt(mana)), precision);
  } catch {
    return "—";
  }
}
