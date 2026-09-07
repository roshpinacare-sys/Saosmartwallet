"use client";

/**
 * SAOSMART TERMINAL — Phase M1
 * ============================
 * Live DEX surface for the Steem internal market (STEEM/SBD):
 *   · DexHeader      — quote strip + chain vitals
 *   · OrderBook      — live depth ladder (click a level → terminal prefill)
 *   · TradeTerminal  — limit_order_create builder on the M0 binary engine
 *   · TradeHistory   — the tape (recent fills)
 *   · WalletPanel    — balances, Steem Power, RC manabar, open orders
 *   · StatusFooter   — sticky terminal status bar
 *
 * Every number on this page is chain-sourced (api.steemit.com via the M1
 * client) — zero mock data. Signing/broadcast remain gated by design (M2).
 */

import { DexHeader } from "@/components/dex/dex-header";
import { OrderBook } from "@/components/dex/order-book";
import { StatusFooter } from "@/components/dex/status-footer";
import { TradeHistory } from "@/components/dex/trade-history";
import { TradeTerminal } from "@/components/dex/trade-terminal";
import { WalletPanel } from "@/components/dex/wallet-panel";
import { Providers } from "@/components/providers";
import { useDexStore } from "@/lib/dex-store";

export default function Home() {
  return (
    <Providers>
      <div className="flex min-h-screen flex-col">
        <DexHeader />
        <TerminalBody />
        <StatusFooter />
      </div>
    </Providers>
  );
}

function TerminalBody() {
  const clickBookPrice = useDexStore((s) => s.clickBookPrice);

  return (
    <main className="relative mx-auto w-full max-w-[1600px] flex-1 px-3 py-4 sm:px-6">
      {/* blueprint grid backdrop */}
      <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 -z-10" />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* order book — left rail on desktop, first panel on mobile */}
        <div className="xl:col-span-3">
          <OrderBook onPickPrice={clickBookPrice} />
        </div>

        {/* terminal — center stage */}
        <div className="xl:col-span-5">
          <TradeTerminal />
        </div>

        {/* tape — right rail */}
        <div className="xl:col-span-4">
          <TradeHistory />
        </div>
      </div>

      {/* wallet dashboard — full width strip */}
      <div className="mt-4">
        <WalletPanel />
      </div>
    </main>
  );
}
