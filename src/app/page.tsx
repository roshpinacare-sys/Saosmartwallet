"use client";

/**
 * SAOS — Sovereign Identity Network · Command Surface
 * ====================================================
 * Unambiguous hierarchy: OUR network first, external rails second.
 *
 *   SAOS       — the landing: what SAOS is + live sovereign vitals
 *                (height, checkpoints, bench, treasury, wrapped, pools)
 *                + real checkpoint anchors with verifiable txids
 *                + the anchored-rails grid (SAOS-NET sorted first)
 *   SAOS HUB   — the sovereign stack center-stage: chain core, grid98 engine
 *                (bench + floor ladder + honesty gates), soldier fleet with
 *                live Steem measurements, loop census, pools, wrapped economy,
 *                signed oracle, anchor rails with public txids, honest dex-facts
 *   PROOFS     — three live demos: identity anchor (ecrecover), real grid98
 *                benchmark, live soldier fleet
 *   SAOS-NET   — deep view: engine output, sovereign book depth, oracle, pools
 *   MARKETS    — trading surfaces: STEEM/SBD internal market (depth · ladder ·
 *                terminal · tape) + full pairs matrix (demoted here on purpose:
 *                an external pair is a market, not the brand)
 *   BRIDGES    — M3 explorer (route finder, live-quoted fees) + anchor rails
 *                with real txids + TRON pulse
 *   WALLET     — balances, Steem Power, RC manabar, open orders + M3 ETH/SOL
 *                lookups, vault status
 *   VAULT      — Sovereign Key Vault: wizard, policy engine, backup, audit
 *   DEVELOPER  — Model 1 metered Identity API: keys, try-it, usage ledger,
 *                official SDK + repo registry & honest gaps
 *
 * Every market number is chain-sourced — zero mock data. Keyboard: 1–9
 * switches every section. Signing flows through the M2 keystore + policy engine.
 */

import { useEffect, useState } from "react";

import { motion } from "framer-motion";
import { Boxes, FlaskConical, GitBranch, Landmark, Server, ShieldCheck, Table2, Wallet2, Waypoints } from "lucide-react";

import { BridgeExplorer } from "@/components/terminal/bridge-explorer";
import { BridgeMonitor } from "@/components/terminal/bridge-monitor";
import { DeveloperConsole } from "@/components/developer/developer-console";
import { TerminalHeader } from "@/components/terminal/eco-header";
import { NetworkGrid } from "@/components/terminal/network-grid";
import { PairsMatrix } from "@/components/terminal/pairs-matrix";
import { ProofLab } from "@/components/terminal/proof-lab";
import { SaosHub } from "@/components/terminal/saos-hub";
import { SaosHero } from "@/components/terminal/saos-hero";
import { SaosNetPanel } from "@/components/terminal/saosnet-panel";
import { StatusFooter } from "@/components/terminal/status-footer";
import { WalletPanel } from "@/components/terminal/wallet-panel";
import { MultiChainWallet } from "@/components/terminal/multichain-wallet";
import { MarketStrip } from "@/components/terminal/market-strip";
import { VaultConsole } from "@/components/vault/vault-console";
import { VaultStatusWidget } from "@/components/vault/vault-status-widget";
import { DexView } from "@/components/trading/dex-view";
import { Providers } from "@/components/providers";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type SectionId =
  | "saos"
  | "saoshub"
  | "proofs"
  | "saosnet"
  | "markets"
  | "bridges"
  | "wallet"
  | "vault"
  | "developer";

const SECTIONS: Array<{ id: SectionId; label: string; icon: React.ReactNode }> = [
  { id: "saos", label: "SAOS", icon: <Landmark className="h-3.5 w-3.5" aria-hidden /> },
  { id: "saoshub", label: "SAOS HUB", icon: <Boxes className="h-3.5 w-3.5" aria-hidden /> },
  { id: "proofs", label: "PROOFS", icon: <FlaskConical className="h-3.5 w-3.5" aria-hidden /> },
  { id: "saosnet", label: "SAOS-NET", icon: <Server className="h-3.5 w-3.5" aria-hidden /> },
  { id: "markets", label: "MARKETS", icon: <Table2 className="h-3.5 w-3.5" aria-hidden /> },
  { id: "bridges", label: "BRIDGES", icon: <GitBranch className="h-3.5 w-3.5" aria-hidden /> },
  { id: "wallet", label: "WALLET", icon: <Wallet2 className="h-3.5 w-3.5" aria-hidden /> },
  { id: "vault", label: "VAULT", icon: <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> },
  { id: "developer", label: "DEVELOPER", icon: <Waypoints className="h-3.5 w-3.5" aria-hidden /> },
];

export default function Home() {
  const [section, setSection] = useState<SectionId>("saos");

  // power-user keyboard shortcuts: 1..9 (all sections reachable)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const idx = Number.parseInt(e.key, 10);
      if (idx >= 1 && idx <= SECTIONS.length) setSection(SECTIONS[idx - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Providers>
      <div className="flex min-h-screen flex-col">
        <TerminalHeader />
        <main
          className="relative mx-auto w-full max-w-[1600px] flex-1 px-3 py-5 sm:px-6"
          aria-label="SAOS sovereign network dashboard"
        >
          {/* blueprint grid backdrop */}
          <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 -z-10" />

          <Tabs value={section} onValueChange={(v) => setSection(v as SectionId)} className="gap-5">
            <TabsList
              aria-label="Dashboard sections"
              className="glass h-auto w-full justify-start gap-1 overflow-x-auto rounded-lg p-1"
            >
              {SECTIONS.map((s, i) => (
                <TabsTrigger
                  key={s.id}
                  value={s.id}
                  aria-label={`${s.label} section (keyboard ${i + 1})`}
                  className="num gap-1.5 rounded-md px-3 py-1.5 text-[10px] font-bold tracking-[0.18em] data-[state=active]:bg-[var(--saos)]/15 data-[state=active]:text-[var(--saos)]"
                >
                  {s.icon}
                  <span className="hidden sm:inline">{s.label}</span>
                  <span className="hidden text-[8px] text-[var(--text-tertiary)] lg:inline">{i + 1}</span>
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="saos" className="mt-0 flex flex-col gap-5 outline-none">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="flex flex-col gap-5"
              >
                <SaosHero onJump={(t) => setSection(t)} />
                <NetworkGrid />
              </motion.div>
            </TabsContent>

            <TabsContent value="saoshub" className="mt-0 outline-none">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                <SaosHub />
              </motion.div>
            </TabsContent>

            <TabsContent value="proofs" className="mt-0 outline-none">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                <ProofLab />
              </motion.div>
            </TabsContent>

            <TabsContent value="saosnet" className="mt-0 outline-none">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                <SaosNetPanel />
              </motion.div>
            </TabsContent>

            <TabsContent value="markets" className="mt-0 flex flex-col gap-5 outline-none">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="flex flex-col gap-5"
              >
                <MarketStrip />
                <PairsMatrix onJump={(t) => setSection(t)} />
                <DexView />
              </motion.div>
            </TabsContent>

            <TabsContent value="bridges" className="mt-0 outline-none">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="flex flex-col gap-4 md:gap-6"
              >
                <BridgeExplorer />
                <BridgeMonitor />
              </motion.div>
            </TabsContent>

            <TabsContent value="wallet" className="mt-0 outline-none">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="flex flex-col gap-5"
              >
                <VaultStatusWidget compact />
                <WalletPanel />
                <MultiChainWallet />
              </motion.div>
            </TabsContent>

            <TabsContent value="vault" className="mt-0 outline-none">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                <VaultConsole />
              </motion.div>
            </TabsContent>

            <TabsContent value="developer" className="mt-0 outline-none">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                <DeveloperConsole />
              </motion.div>
            </TabsContent>
          </Tabs>
        </main>
        <StatusFooter />
      </div>
    </Providers>
  );
}
