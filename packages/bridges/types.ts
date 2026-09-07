/**
 * Saosmartwallet — Bridge layer types (M3)
 * ========================================
 * The vocabulary for cross-network routing. Every field that could tempt a
 * mock (volume, success rate, fees) is documented with its REAL source —
 * the bridge layer refuses to invent numbers.
 */

/** Network ids participating in bridges (7 networks, M3 scope). */
export type BridgeNetworkId =
  | "steem"
  | "hive"
  | "blurt"
  | "tron"
  | "saos-net"
  | "ethereum"
  | "solana";

export interface BridgeNetworkMeta {
  id: BridgeNetworkId;
  name: string;
  color: string;
  /** Approximate block cadence — used ONLY for time estimates, stated per rail. */
  blockSeconds: number;
  explorer: (txid: string) => string;
}

export const BRIDGE_NETWORKS: Record<BridgeNetworkId, BridgeNetworkMeta> = {
  steem: { id: "steem", name: "STEEM", color: "#4BA2F2", blockSeconds: 3, explorer: (t) => `https://steemworld.org/tx/${t}` },
  hive: { id: "hive", name: "HIVE", color: "#E31337", blockSeconds: 3, explorer: (t) => `https://hiveblocks.com/tx/${t}` },
  blurt: { id: "blurt", name: "BLURT", color: "#00D4AA", blockSeconds: 3, explorer: (t) => `https://explorer.blurt.tools/tx/${t}` },
  tron: { id: "tron", name: "TRON", color: "#FF060A", blockSeconds: 3, explorer: (t) => `https://tronscan.org/#/transaction/${t}` },
  "saos-net": { id: "saos-net", name: "SAOS-NET", color: "#8B5CF6", blockSeconds: 3, explorer: () => "" },
  ethereum: { id: "ethereum", name: "ETHEREUM", color: "#627EEA", blockSeconds: 12, explorer: (t) => `https://etherscan.io/tx/${t}` },
  solana: { id: "solana", name: "SOLANA", color: "#14F195", blockSeconds: 0.4, explorer: (t) => `https://solscan.io/tx/${t}` },
};

// ---------------------------------------------------------------------------
// Routes & fees
// ---------------------------------------------------------------------------

export interface BridgeHop {
  network: BridgeNetworkId;
  /** Contract / program / authority that anchors this hop — null when undeployed. */
  contract: string | null;
  action: "lock" | "burn" | "transfer" | "anchor" | "mint";
}

export type BridgeTrustLevel = "trustless" | "federated" | "centralized";

export interface BridgeFeeLeg {
  network: BridgeNetworkId;
  /** Fee in the network's native units — exact decimal string. */
  amount: string;
  currency: string;
  /** Where the number came from — the anti-mock audit field. */
  source: string;
}

export interface BridgeFee {
  /** Sum expressed in the SOURCE asset when measurable; otherwise the legs speak. */
  legs: BridgeFeeLeg[];
  /** True when every leg is a measured/live number. */
  allMeasured: boolean;
}

export interface BridgePath {
  id: string;
  source: BridgeNetworkId;
  target: BridgeNetworkId;
  label: string;
  route: BridgeHop[];
  /** Estimated wall-clock seconds — derived from block cadences (stated math). */
  estimatedTime: number;
  fee: BridgeFee;
  /** Deployment readiness of THIS rail (honest gate, never hidden). */
  readiness: "live" | "gated";
  /** Why a gated rail is gated — required when readiness === "gated". */
  gateReason: string | null;
  trustLevel: BridgeTrustLevel;
  trustDetail: string;
}

// ---------------------------------------------------------------------------
// Rail status (monitor)
// ---------------------------------------------------------------------------

export interface RailStatus {
  id: string;
  rail: string;
  mechanism: string;
  status: "live" | "gated" | "offline";
  /** Measured evidence — txids, heights, counts. */
  evidence: string;
  explorer: string | null;
  lastActivityAt: string | null;
}

export interface BridgeAnalytics {
  /** REAL counters sourced from live anchor state — never fabricated. */
  anchoredTotal: number | null;
  checkpointsVerified: number | null;
  checkpointsTotal: number | null;
  lastAnchor: { at: string | null; txid: string | null; chain: string | null; cpHeight: number | null } | null;
  /** Wrapped assets locked on SAOS-NET as bridge collateral (supply/locked). */
  wrapped: Array<{ asset: string; supply: number; locked: number; holders: number }>;
  sourcedAt: string;
}
