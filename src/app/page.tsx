"use client";

/**
 * SAOS GRID — Enterprise Ecosystem Command Center
 * ===============================================
 * The whole ecosystem on one professional surface:
 *
 *   GRID      — KPI strip · Network Grid (5 live-probed chains) · Pairs Matrix
 *   DEX       — live STEEM/SBD internal market (depth chart · ladder · terminal · tape)
 *   SAOS-NET  — our sovereign chain: engine, sovereign book depth, oracle, pools
 *   BRIDGES   — anchor rails + live anchor feed with real txids + TRON pulse
 *   REGISTRY  — the repo/scan catalog + honest gaps
 *   WALLET    — balances, Steem Power, RC manabar, open orders
 *
 * Every market number is chain-sourced — zero mock data. Keyboard: 1–6
 * switch sections. Signing/broadcast remain gated by design (M2).
 */

import { useEffect, useState } from "react";

import { motion } from "framer-motion";
import { GitBranch, Grid3x3, Landmark, Server, Table2, Wallet2 } from "lucide-react";

import { BridgeMonitor } from "@/components/terminal/bridge-monitor";
import { TerminalHeader } from "@/components/terminal/eco-header";
import { KpiStrip } from "@/components/terminal/kpi-strip";
import { NetworkGrid } from "@/components/terminal/network-grid";
import { PairsMatrix } from "@/components/terminal/pairs-matrix";
import { RegistryPanel } from "@/components/terminal/registry-panel";
import { SaosNetPanel } from "@/components/terminal/saosnet-panel";
import { StatusFooter } from "@/components/terminal/status-footer";
import { WalletPanel } from "@/components/terminal/wallet-panel";
import { DexView } from "@/components/trading/dex-view";
import { Providers } from "@/components/providers";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type SectionId = "grid" | "dex" | "saosnet" | "bridges" | "registry" | "wallet";

const SECTIONS: Array<{ id: SectionId; label: string; icon: React.ReactNode }> = [
  { id: "grid", label: "GRID", icon: <Grid3x3 className="h-3.5 w-3.5" aria-hidden /> },
  { id: "dex", label: "DEX", icon: <Table2 className="h-3.5 w-3.5" aria-hidden /> },
  { id: "saosnet", label: "SAOS-NET", icon: <Server className="h-3.5 w-3.5" aria-hidden /> },
  { id: "bridges", label: "BRIDGES", icon: <GitBranch className="h-3.5 w-3.5" aria-hidden /> },
  { id: "registry", label: "REGISTRY", icon: <Landmark className="h-3.5 w-3.5" aria-hidden /> },
  { id: "wallet", label: "WALLET", icon: <Wallet2 className="h-3.5 w-3.5" aria-hidden /> },
];

export default function Home() {
  const [section, setSection] = useState<SectionId>("grid");

  // power-user keyboard shortcuts: 1..6
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
          aria-label="Ecosystem dashboard"
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
                  className="num gap-1.5 rounded-md px-3 py-1.5 text-[10px] font-bold tracking-[0.18em] data-[state=active]:bg-[var(--up)]/15 data-[state=active]:text-[var(--up)]"
                >
                  {s.icon}
                  <span className="hidden sm:inline">{s.label}</span>
                  <span className="hidden text-[8px] text-[var(--text-tertiary)] lg:inline">{i + 1}</span>
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="grid" className="mt-0 flex flex-col gap-5 outline-none">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="flex flex-col gap-5"
              >
                <KpiStrip />
                <NetworkGrid />
                <PairsMatrix onJump={(t) => setSection(t)} />
              </motion.div>
            </TabsContent>

            <TabsContent value="dex" className="mt-0 outline-none">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                <DexView />
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

            <TabsContent value="bridges" className="mt-0 outline-none">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                <BridgeMonitor />
              </motion.div>
            </TabsContent>

            <TabsContent value="registry" className="mt-0 outline-none">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                <RegistryPanel />
              </motion.div>
            </TabsContent>

            <TabsContent value="wallet" className="mt-0 outline-none">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                <WalletPanel />
              </motion.div>
            </TabsContent>
          </Tabs>
        </main>
        <StatusFooter />
      </div>
    </Providers>
  );
}
