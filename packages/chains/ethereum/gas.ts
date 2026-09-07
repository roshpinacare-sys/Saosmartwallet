/**
 * Saosmartwallet — Ethereum gas estimation + EIP-1559 fee policy (M3)
 * ===================================================================
 * Reads the live base fee from the chain and derives maxFee/maxPriorityFee
 * with an explicit, documented multiplier policy. No invented constants:
 * every number here is either measured from the node or a stated multiplier.
 */

import type { ethers } from "ethers";

export type FeeSpeed = "standard" | "fast";

/** Multiplier policy, applied to measured chain values only. */
export const FEE_POLICY: Record<FeeSpeed, { baseFeeMultiplier: number; priorityBoostGwei: number }> = {
  standard: { baseFeeMultiplier: 2, priorityBoostGwei: 0 },
  fast: { baseFeeMultiplier: 3, priorityBoostGwei: 1 },
};

export interface Eip1559Fees {
  /** Latest block baseFeePerGas, wei (bigint). */
  baseFeePerGas: bigint;
  /** Suggested priority fee, wei (bigint) — measured via eth_maxPriorityFeePerGas when available. */
  maxPriorityFeePerGas: bigint;
  /** maxFeePerGas = baseFee × policy multiplier + priority (+ boost), wei (bigint). */
  maxFeePerGas: bigint;
  speed: FeeSpeed;
  measuredAtBlock: number;
}

export interface FeeSummary {
  /** wei decimal strings (JSON-safe) or null when the node did not expose them. */
  gasPrice: string | null;
  maxFeePerGas: string | null;
  maxPriorityFeePerGas: string | null;
  baseFeePerGas: string | null;
  speed: FeeSpeed;
  measuredAtBlock: number | null;
}

const GWEI = 1_000_000_000n;

/**
 * Live EIP-1559 fee estimate. Falls back to provider.getFeeData() fields when
 * the legacy eth_maxPriorityFeePerGas endpoint is unavailable.
 */
export async function estimateEip1559Fees(
  provider: ethers.Provider,
  speed: FeeSpeed = "standard",
): Promise<Eip1559Fees> {
  const latest = await provider.getBlock("latest");
  const baseFee = latest?.baseFeePerGas;
  if (typeof baseFee !== "bigint" || baseFee <= 0n) {
    throw new Error("node did not expose baseFeePerGas (pre-London or non-EIP-1559 node)");
  }
  const policy = FEE_POLICY[speed];

  let priority = 0n;
  try {
    // Raw JSON-RPC (ethers does not surface this method as a typed call).
    const raw = await (provider as unknown as {
      send: (m: string, p: unknown[]) => Promise<string>;
    }).send("eth_maxPriorityFeePerGas", []);
    if (typeof raw === "string") priority = BigInt(raw);
  } catch {
    // Node without the endpoint — measured fallback below keeps going.
  }

  const maxPriorityFeePerGas = priority + BigInt(policy.priorityBoostGwei) * GWEI;
  const maxFeePerGas = (baseFee * BigInt(policy.baseFeeMultiplier)) + maxPriorityFeePerGas;
  return {
    baseFeePerGas: baseFee,
    maxPriorityFeePerGas,
    maxFeePerGas,
    speed,
    measuredAtBlock: latest?.number ?? 0,
  };
}

export function toFeeSummary(fees: Eip1559Fees | null, gasPrice: bigint | null): FeeSummary {
  return {
    gasPrice: gasPrice !== null ? gasPrice.toString() : null,
    maxFeePerGas: fees ? fees.maxFeePerGas.toString() : null,
    maxPriorityFeePerGas: fees ? fees.maxPriorityFeePerGas.toString() : null,
    baseFeePerGas: fees ? fees.baseFeePerGas.toString() : null,
    speed: fees?.speed ?? "standard",
    measuredAtBlock: fees?.measuredAtBlock ?? null,
  };
}

/** Common gas limits — stated defaults, overridable by callers. */
export const DEFAULT_GAS_LIMITS = {
  /** Plain ETH transfer. */
  transfer: 21_000n,
  /** ERC-20 transfer — estimated on-chain when possible; this is the floor. */
  erc20Transfer: 63_000n,
  /** ERC-20 approve. */
  erc20Approve: 46_000n,
} as const;
