"use client";

/**
 * WalletPanel — public wallet dashboard: three-token balances (STEEM / SBD /
 * Steem Power with integer VESTS→STEEM conversion), RC manabar gauge ("fuel")
 * and open DEX orders. Read-only public chain data; tracking an account never
 * involves keys.
 */

import { motion } from "framer-motion";
import {
  BatteryCharging,
  Coins,
  ListOrdered,
  Loader2,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";

import { LiveBadge, PanelHeader } from "@/components/dex/terminal-furniture";
import { fmtInt, fmtPrice, timeAgo, useWallet } from "@/hooks/use-steem-market";
import { useDexStore } from "@/lib/dex-store";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

const ACCOUNT_RE = /^[a-z0-9.\-]{3,16}$/;

export function WalletPanel() {
  const { account, setAccount } = useDexStore();
  const [draft, setDraft] = useState(account);
  const { data, isFetching, isError, error, isLoading } = useWallet(account);

  // zustand persist rehydrates after mount — keep the draft in sync with the
  // tracked account using the adjust-during-render pattern (no effects).
  const [lastAccount, setLastAccount] = useState(account);
  if (account !== lastAccount) {
    setLastAccount(account);
    setDraft(account);
  }

  const submit = () => {
    const name = draft.trim().toLowerCase();
    if (!ACCOUNT_RE.test(name)) return;
    setAccount(name);
  };

  return (
    <section className="glass overflow-hidden rounded-xl" aria-label="Wallet dashboard">
      <PanelHeader
        title="Wallet Dashboard"
        subtitle={account ? `@${account} · public chain data` : "track any steem account"}
        icon={<Coins className="h-4 w-4" />}
        accent="amber"
        right={
          <div className="flex items-center gap-2">
            {isFetching && account ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-hidden /> : null}
            {data ? <LiveBadge active label="SYNC" /> : null}
          </div>
        }
      />

      <div className="flex flex-col gap-5 p-4">
        {/* account search */}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value.toLowerCase())}
            placeholder="enter account name — e.g. steem"
            className="num h-10 font-mono text-[13px]"
            autoComplete="off"
            spellCheck={false}
            aria-label="Steem account name"
          />
          <Button type="submit" size="sm" className="h-10 gap-1.5 px-4 text-[11px] uppercase tracking-wider" disabled={!ACCOUNT_RE.test(draft.trim().toLowerCase())}>
            <Search className="h-3.5 w-3.5" /> Track
          </Button>
        </form>

        {!account ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <ShieldCheck className="h-7 w-7 text-muted-foreground/50" aria-hidden />
            <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
              Track any Steem account to see live balances, Steem Power and Resource Credits.
              Public chain data only — the terminal never asks for keys.
            </p>
            <Button variant="outline" size="sm" className="gap-1.5 text-[11px]" onClick={() => { setDraft("steem"); setAccount("steem"); }}>
              try @steem
            </Button>
          </div>
        ) : isLoading && !data ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-lg bg-secondary/60" />
            ))}
          </div>
        ) : isError ? (
          <div className="rounded-lg border border-[var(--down)]/30 bg-[var(--down)]/8 p-4 text-center">
            <p className="text-xs text-[var(--down)]">
              {error instanceof Error ? error.message : "wallet lookup failed"}
            </p>
          </div>
        ) : data ? (
          <>
            {/* balances */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Liquid STEEM"
                value={data.account.balances.liquid.replace(" STEEM", "")}
                unit="STEEM"
                accent="up"
                hint="spendable · market + transfers"
              />
              <StatCard
                label="SBD (debt)"
                value={data.account.balances.debt.replace(" SBD", "")}
                unit="SBD"
                accent="amber"
                hint="internal-market quote asset"
              />
              <StatCard
                label="Steem Power"
                value={(data.account.spSatoshis / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 })}
                unit="SP"
                accent="up"
                hint={`${data.account.balances.vestingShares.replace(" VESTS", "")} VESTS`}
              />
              <RcCard
                percent={data.rc?.percent ?? null}
                current={data.rc?.currentMana}
                max={data.rc?.maxRc}
              />
            </div>

            {/* open orders */}
            <div className="rounded-lg border border-border/60">
              <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  <ListOrdered className="h-3.5 w-3.5" /> Open DEX Orders
                </p>
                <Badge variant="outline" className="num text-[10px]">
                  {data.openOrders.length}
                </Badge>
              </div>
              {data.openOrders.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  no open limit orders on the internal market
                </p>
              ) : (
                <ScrollArea className="scroll-thin max-h-52">
                  <table className="num w-full text-[11px]">
                    <thead>
                      <tr className="text-left text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                        <th className="px-3 py-1.5 font-medium">ID</th>
                        <th className="px-3 py-1.5 font-medium">Selling</th>
                        <th className="px-3 py-1.5 text-right font-medium">Min receive</th>
                        <th className="px-3 py-1.5 text-right font-medium">Price</th>
                        <th className="px-3 py-1.5 text-right font-medium">Age</th>
                        <th className="px-3 py-1.5 text-right font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.openOrders.map((o) => {
                        const expired = o.expiration ? Date.parse(`${o.expiration}Z`) < Date.now() : false;
                        return (
                          <tr key={o.orderid} className="border-t border-border/40">
                            <td className="px-3 py-1.5 text-muted-foreground">{o.orderid}</td>
                            <td className="px-3 py-1.5">
                              {o.sellingAmount} {o.sellingSymbol}
                            </td>
                            <td className="px-3 py-1.5 text-right text-foreground/85">
                              {o.receivingAmount} {o.receivingSymbol}
                            </td>
                            <td className="px-3 py-1.5 text-right text-foreground/85">{fmtPrice(o.price)}</td>
                            <td className="px-3 py-1.5 text-right text-muted-foreground">{timeAgo(o.created)}</td>
                            <td className="px-3 py-1.5 text-right">
                              <span className={cn(expired ? "text-[var(--amberterminal)]" : "text-[var(--up)]")}>
                                {expired ? "EXPIRED*" : "ACTIVE"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </ScrollArea>
              )}
              {data.openOrders.some((o) => o.expiration && Date.parse(`${o.expiration}Z`) < Date.now()) ? (
                <p className="border-t border-border/40 px-3 py-1.5 text-[9px] text-muted-foreground">
                  * past node-reported expiration; the chain retires them at the next maintenance window
                </p>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

function StatCard({
  label,
  value,
  unit,
  hint,
  accent,
}: {
  label: string;
  value: string;
  unit: string;
  hint?: string;
  accent: "up" | "amber";
}) {
  const color = accent === "up" ? "var(--up)" : "var(--amberterminal)";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="relative overflow-hidden rounded-lg border border-border/60 bg-secondary/30 p-3"
    >
      <p className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className="num mt-1.5 flex items-baseline gap-1.5">
        <span className="text-xl font-bold" style={{ color }}>
          {value}
        </span>
        <span className="text-[10px] font-semibold text-muted-foreground">{unit}</span>
      </p>
      {hint ? <p className="num mt-1 truncate text-[9px] text-muted-foreground/70">{hint}</p> : null}
      <span aria-hidden className="absolute -right-4 -top-4 h-14 w-14 rounded-full opacity-[0.07]" style={{ background: color }} />
    </motion.div>
  );
}

function RcCard({
  percent,
  current,
  max,
}: {
  percent: number | null;
  current?: string;
  max?: string;
}) {
  const pct = percent ?? 0;
  const level = pct > 60 ? "var(--up)" : pct > 20 ? "var(--amberterminal)" : "var(--down)";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="relative overflow-hidden rounded-lg border border-border/60 bg-secondary/30 p-3"
    >
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1 text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
          <BatteryCharging className="h-3 w-3" /> Resource Credits
        </p>
        <span className="num text-sm font-bold" style={{ color: level }}>
          {percent === null ? "—" : `${pct.toFixed(1)}%`}
        </span>
      </div>
      <div className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-background/70" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="RC manabar">
        <motion.div
          className="h-full rounded-full"
          style={{ background: `linear-gradient(90deg, color-mix(in oklab, ${level} 65%, transparent), ${level})` }}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(100, pct)}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </div>
      <p className="num mt-2 text-[9px] leading-relaxed text-muted-foreground/80">
        {current && max ? `${fmtInt(Number(current))} / ${fmtInt(Number(max))} mana` : "manabar unavailable on this node"}
      </p>
    </motion.div>
  );
}
