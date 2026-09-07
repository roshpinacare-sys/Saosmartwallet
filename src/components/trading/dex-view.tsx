"use client";

/**
 * DexView — the STEEM/SBD trading surface composition:
 * order book (depth chart + ladder) · trade terminal · live tape.
 * Book-row clicks flow through the shared dex-store to prefill the terminal.
 */

import { motion } from "framer-motion";

import { OrderBook } from "@/components/trading/order-book";
import { TradeHistory } from "@/components/trading/trade-history";
import { TradeTerminal } from "@/components/trading/trade-terminal";
import { useDexStore } from "@/lib/dex-store";

export function DexView() {
  const clickBookPrice = useDexStore((s) => s.clickBookPrice);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="grid grid-cols-1 gap-4 md:gap-6 xl:grid-cols-12"
    >
      <div className="xl:col-span-3">
        <OrderBook onPickPrice={clickBookPrice} />
      </div>
      <div className="xl:col-span-5">
        <TradeTerminal />
      </div>
      <div className="xl:col-span-4">
        <TradeHistory />
      </div>
    </motion.div>
  );
}
