"use client";

/**
 * Terminal-wide client state (zustand). Kept minimal: the tracked account is
 * shared between the wallet dashboard and the trade terminal; order-book row
 * clicks prefill the terminal price. Persisted locally (localStorage) — this
 * is public, non-sensitive data only. NO keys ever enter client state.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface PricePrefill {
  price: string;
  /** Which side of the book was clicked — hint for the terminal tabs. */
  sideHint: "bid" | "ask";
  /** Increments on every click so identical prices still retrigger effects. */
  seq: number;
}

interface DexState {
  account: string;
  pricePrefill: PricePrefill | null;
  setAccount: (account: string) => void;
  clickBookPrice: (price: string, sideHint: "bid" | "ask") => void;
}

export const useDexStore = create<DexState>()(
  persist(
    (set) => ({
      account: "",
      pricePrefill: null,
      setAccount: (account) => set({ account: account.trim().toLowerCase() }),
      clickBookPrice: (price, sideHint) =>
        set((s) => ({ pricePrefill: { price, sideHint, seq: (s.pricePrefill?.seq ?? 0) + 1 } })),
    }),
    {
      name: "saosmart-dex",
      partialize: (s) => ({ account: s.account }),
    },
  ),
);
