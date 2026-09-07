"use client";

/**
 * MultiChainWallet — M3 address lookups for the two new networks.
 * ==============================================================
 * Ethereum (native + ERC-20 via token contract input) and Solana (native +
 * all SPL token accounts) balances read live from the chain adapters via
 * /api/eco/account. Address state persists locally (zustand). No keys, no
 * secrets — read-only lookups; an untracked address renders honestly as
 * "no address tracked".
 */

import { motion } from "framer-motion";
import { Coins, Landmark, Wallet2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { AnimatedNumber } from "@/components/terminal/motion-bits";
import { ChainGlyph, ErrorNote, PanelHeader, PanelSkeleton, StatCell } from "@/components/terminal/primitives";
import { type EcoAccountResponse, useEcoAccount } from "@/hooks/use-eco";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Persisted address store
// ---------------------------------------------------------------------------

interface McWalletState {
  ethAddress: string;
  solAddress: string;
  ethToken: string;
  setEth: (a: string) => void;
  setSol: (a: string) => void;
  setEthToken: (a: string) => void;
}

const useMcWalletStore = create<McWalletState>()(
  persist(
    (set) => ({
      ethAddress: "",
      solAddress: "",
      ethToken: "",
      setEth: (a) => set({ ethAddress: a.trim() }),
      setSol: (a) => set({ solAddress: a.trim() }),
      setEthToken: (a) => set({ ethToken: a.trim() }),
    }),
    { name: "saos-mc-wallet" },
  ),
);

const ETH_RE = /^0x[0-9a-fA-F]{40}$/;
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function MultiChainWallet() {
  const { ethAddress, solAddress, ethToken, setEth, setSol, setEthToken } = useMcWalletStore();
  const [ethDraft, setEthDraft] = useState(ethAddress);
  const [solDraft, setSolDraft] = useState(solAddress);
  const [ethTokenDraft, setEthTokenDraft] = useState(ethToken);

  const eth = useEcoAccount(ethAddress ? "ethereum" : null, ethAddress);
  const sol = useEcoAccount(solAddress ? "solana" : null, solAddress);

  const trackEth = () => {
    const a = ethDraft.trim();
    if (!ETH_RE.test(a)) {
      toast.error("invalid ethereum address", { description: "expected 0x + 40 hex chars" });
      return;
    }
    setEth(a);
    toast(`tracking ethereum ${a.slice(0, 10)}…`);
  };
  const trackSol = () => {
    const a = solDraft.trim();
    if (!SOL_RE.test(a)) {
      toast.error("invalid solana address", { description: "expected base58 pubkey (32–44 chars)" });
      return;
    }
    setSol(a);
    toast(`tracking solana ${a.slice(0, 8)}…`);
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:gap-6 xl:grid-cols-2">
      <NetworkAccountCard
        network="ethereum"
        title="Ethereum"
        subtitle="native + ERC-20 · eip155:1"
        placeholder="0x…"
        draft={ethDraft}
        onDraft={setEthDraft}
        onTrack={trackEth}
        tracked={ethAddress}
        token={ethToken}
        tokenDraft={ethTokenDraft}
        onTokenDraft={setEthTokenDraft}
        onTokenTrack={(t) => {
          setEthToken(t);
          if (t && !ETH_RE.test(t)) toast.error("invalid token contract");
        }}
        query={eth}
        emptyHint="paste any address — balances read straight from the chain"
      />
      <NetworkAccountCard
        network="solana"
        title="Solana"
        subtitle="native + SPL accounts · mainnet-beta"
        placeholder="base58 pubkey…"
        draft={solDraft}
        onDraft={setSolDraft}
        onTrack={trackSol}
        tracked={solAddress}
        query={sol}
        emptyHint="paste any pubkey — balances read straight from the chain"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function NetworkAccountCard({
  network,
  title,
  subtitle,
  placeholder,
  draft,
  onDraft,
  onTrack,
  tracked,
  token,
  tokenDraft,
  onTokenDraft,
  onTokenTrack,
  query,
  emptyHint,
}: {
  network: "ethereum" | "solana";
  title: string;
  subtitle: string;
  placeholder: string;
  draft: string;
  onDraft: (v: string) => void;
  onTrack: () => void;
  tracked: string;
  token?: string;
  tokenDraft?: string;
  onTokenDraft?: (v: string) => void;
  onTokenTrack?: (v: string) => void;
  query: ReturnType<typeof useEcoAccount>;
  emptyHint: string;
}) {
  return (
    <section className="glass overflow-hidden" aria-label={`${title} wallet`}>
      <PanelHeader
        title={title}
        subtitle={subtitle}
        icon={<ChainGlyph id={network} name={title} size={22} />}
        right={
          <span className="num text-[10px] text-[var(--text-tertiary)]">
            {query.isFetching ? "probing…" : tracked ? "tracked" : "no address"}
          </span>
        }
      />
      <div className="flex flex-col gap-3 p-5">
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onTrack()}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            aria-label={`${title} address`}
            className="num h-9 flex-1 border-[var(--border-subtle)] bg-white/[0.03] font-mono text-[12px]"
          />
          <Button
            onClick={onTrack}
            size="sm"
            className="num h-9 gap-1.5 px-4 text-[10px] font-bold uppercase tracking-[0.14em]"
            aria-label={`Track ${title} address`}
          >
            <Wallet2 className="h-3.5 w-3.5" aria-hidden /> Track
          </Button>
        </div>

        {network === "ethereum" ? (
          <div className="flex gap-2">
            <Input
              value={tokenDraft ?? ""}
              onChange={(e) => onTokenDraft?.(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onTokenTrack?.(tokenDraft ?? "")}
              placeholder="optional ERC-20 contract…"
              autoComplete="off"
              spellCheck={false}
              aria-label="ERC-20 token contract"
              className="num h-8 flex-1 border-[var(--border-subtle)] bg-white/[0.02] font-mono text-[11px]"
            />
          </div>
        ) : null}

        {tracked ? (
          query.isLoading ? (
            <PanelSkeleton rows={3} className="border-0" />
          ) : query.isError ? (
            <ErrorNote message={`lookup failed — ${query.error instanceof Error ? query.error.message : "unknown"}`} />
          ) : query.data ? (
            <AccountBody network={network} data={query.data} />
          ) : null
        ) : (
          <p className="px-1 py-4 text-center text-[11px] text-[var(--text-tertiary)]">{emptyHint}</p>
        )}
      </div>
    </section>
  );
}

function AccountBody({ network, data }: { network: "ethereum" | "solana"; data: EcoAccountResponse }) {
  // Native balance — exact base-unit → display conversion, no float drift.
  const native = (() => {
    try {
      const v = BigInt(data.native.amount);
      const d = BigInt(data.native.decimals);
      const whole = v / 10n ** d;
      const frac = (v % 10n ** d).toString().padStart(Number(data.native.decimals), "0").replace(/0+$/, "");
      return { str: frac ? `${whole}.${frac}` : `${whole}`, num: Number(`${whole}.${frac || "0"}`) };
    } catch {
      return { str: "—", num: null };
    }
  })();
  const tone = network === "ethereum" ? "var(--eth)" : "var(--sol)";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="flex flex-col gap-4"
    >
      <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] px-4 py-3">
        <div className="min-w-0">
          <p className="text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">address</p>
          <p className="num truncate font-mono text-[11px] text-foreground/85" title={data.account.address}>
            {data.account.address}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">balance</p>
          <p className="num text-xl font-bold leading-none" style={{ color: tone }}>
            {native.num !== null && Number.isFinite(native.num) ? (
              <AnimatedNumber
                value={native.num}
                format={(v) => `${v.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${data.native.symbol}`}
              />
            ) : (
              `${native.str} ${data.native.symbol}`
            )}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCell
          label={network === "ethereum" ? "account type" : "owner program"}
          value={
            network === "ethereum"
              ? data.account.codeKind === "contract"
                ? "contract"
                : data.account.codeKind === "eip7702"
                  ? "delegated (EIP-7702)"
                  : "EOA"
              : data.account.ownerProgram
                ? `${data.account.ownerProgram.slice(0, 10)}…`
                : "unfunded"
          }
        />
        <StatCell
          label={network === "ethereum" ? "nonce" : "executable"}
          value={
            network === "ethereum"
              ? (data.account.nonce ?? "—")
              : data.account.ownerProgram && data.account.ownerProgram !== "11111111111111111111111111111111"
                ? "program-owned"
                : "system"
          }
        />
        <StatCell label="probed" value={new Date(data.probedAt).toLocaleTimeString("en-GB")} />
      </div>

      {/* tokens */}
      {network === "solana" ? (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            <Coins className="h-3 w-3" aria-hidden /> SPL token accounts ({data.tokens?.length ?? 0})
          </p>
          {data.tokens && data.tokens.length > 0 ? (
            <div className="scroll-thin max-h-48 overflow-y-auto rounded-lg border border-[var(--border-subtle)]">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-[var(--bg-secondary)]">
                  <tr className="text-[9px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
                    <th scope="col" className="px-3 py-1.5 font-semibold">mint</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-semibold">balance</th>
                    <th scope="col" className="hidden px-3 py-1.5 text-right font-semibold sm:table-cell">dec</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tokens.slice(0, 25).map((t) => (
                    <tr key={t.mint + t.tokenProgram} className="border-t border-[var(--border-subtle)]">
                      <td className="num px-3 py-1.5 font-mono text-[10.5px] text-foreground/80" title={t.mint}>
                        {t.mint.slice(0, 12)}…
                      </td>
                      <td className="num px-3 py-1.5 text-right text-[10.5px] font-semibold text-foreground/90">
                        {t.formatted ?? t.amount}
                      </td>
                      <td className="num hidden px-3 py-1.5 text-right text-[10.5px] text-[var(--text-tertiary)] sm:table-cell">
                        {t.decimals ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rounded-lg border border-[var(--border-subtle)] px-3 py-3 text-center text-[10.5px] text-[var(--text-tertiary)]">
              no SPL token accounts for this address
            </p>
          )}
        </div>
      ) : data.token ? (
        <div className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] px-4 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
              <Landmark className="h-3 w-3" aria-hidden /> erc-20 token
            </p>
            <p className="num truncate font-mono text-[11px] text-foreground/85">{data.token.symbol ?? data.token.token}</p>
          </div>
          <p className={cn("num text-[13px] font-bold text-foreground/90")}>
            {data.token.formatted ?? data.token.amount}
          </p>
        </div>
      ) : null}
    </motion.div>
  );
}
