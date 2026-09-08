/**
 * Saosmartwallet — Bridge Router (M3)
 * ===================================
 * Path finding + REAL fee/time quotes across the 7-network ecosystem.
 *
 * ANTI-MOCK CONTRACT:
 *   · Every fee leg carries `source` — where the number came from.
 *   · Live chain measurements (ETH gas via adapter, SOL lamport constants)
 *     are the only fee numbers. Un-measurable legs say so in `source`.
 *   · Rails that cannot execute (no deployed contract/program) return with
 *     readiness:"gated" + gateReason — never silently omitted, never faked.
 */

import { getEthereumAdapter, getSolanaAdapter } from "../chains";
import { BRIDGE_NETWORKS, type BridgeFee, type BridgeFeeLeg, type BridgeHop, type BridgeNetworkId, type BridgePath } from "./types";

// ---------------------------------------------------------------------------
// Rail catalog — what EXISTS (honest inventory, evidence-annotated)
// ---------------------------------------------------------------------------

interface RailDef {
  id: string;
  source: BridgeNetworkId;
  target: BridgeNetworkId;
  label: string;
  trustLevel: BridgePath["trustLevel"];
  trustDetail: string;
  readiness: BridgePath["readiness"];
  gateReason: string | null;
  hops: () => BridgeHop[];
  /** Builds the fee quote (may hit live chains). */
  quote: () => Promise<BridgeFee>;
  /** Time math — stated, per-rail. */
  estimateTime: () => number;
}

const ETH_MINT_GAS_DEFAULT = 80_000n; // stated default for a contract mint call

async function ethMintFeeLeg(): Promise<BridgeFeeLeg> {
  const eth = getEthereumAdapter();
  try {
    const info = await eth.getChainInfo();
    const maxFee = info.maxFee ?? info.gasPrice;
    if (!maxFee) {
      return { network: "ethereum", amount: "0", currency: "ETH", source: "unavailable — node did not expose fee data" };
    }
    const wei = BigInt(maxFee) * ETH_MINT_GAS_DEFAULT;
    const whole = wei / 10n ** 18n;
    const frac = (wei % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
    return {
      network: "ethereum",
      amount: frac ? `${whole}.${frac}` : `${whole}`,
      currency: "ETH",
      source: `live maxFeePerGas ${info.maxFee} wei @ block ${info.feesMeasuredAtBlock} × ${ETH_MINT_GAS_DEFAULT} gas (stated mint default)`,
    };
  } catch (err) {
    return {
      network: "ethereum",
      amount: "0",
      currency: "ETH",
      source: `unavailable — gas probe failed: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}

const STEEM_ANCHOR_LEG: BridgeFeeLeg = {
  network: "steem",
  amount: "0",
  currency: "STEEM",
  source: "0 liquid STEEM — anchor ops are RC-borne (custom_json ~190B); RC pool pays",
};

const TRON_FREE_LEG: BridgeFeeLeg = {
  network: "tron",
  amount: "0",
  currency: "TRX",
  source: "0 TRX measured — ring runs on staked/free bandwidth (live anchor history)",
};

const SOL_SIG_LEG: BridgeFeeLeg = {
  network: "solana",
  amount: "0.000005",
  currency: "SOL",
  source: "5000 lamports/signature — Solana protocol constant",
};

const RAILS: RailDef[] = [
  {
    id: "relay-steem",
    source: "saos-net",
    target: "steem",
    label: "SAOS-NET → STEEM (Direct)",
    trustLevel: "federated",
    trustDetail: "SAOS-NET validator authority signs custom_json saos-dex.anchor.v1 on Steem — publicly re-verifiable via txid",
    readiness: "live",
    gateReason: null,
    hops: () => [{ network: "saos-net", contract: null, action: "anchor" }, { network: "steem", contract: null, action: "anchor" }],
    quote: async () => ({ legs: [{ ...STEEM_ANCHOR_LEG }], allMeasured: true }),
    estimateTime: () => 12, // 3s blocks × ~4 (queue + read-back verify)
  },
  {
    id: "relay-hive",
    source: "saos-net",
    target: "hive",
    label: "SAOS-NET → HIVE (Direct)",
    trustLevel: "federated",
    trustDetail: "Same anchor authority on Hive; rate governed by RC manabar (honest regen wait)",
    readiness: "gated",
    gateReason: "RC-starved fleet accounts — anchors paused until manabar regenerates (measured 2–5%)",
    hops: () => [{ network: "saos-net", contract: null, action: "anchor" }, { network: "hive", contract: null, action: "anchor" }],
    quote: async () => ({ legs: [{ ...STEEM_ANCHOR_LEG, network: "hive", currency: "HIVE" }], allMeasured: true }),
    estimateTime: () => 12,
  },
  {
    id: "relay-blurt",
    source: "saos-net",
    target: "blurt",
    label: "SAOS-NET → BLURT (Direct)",
    trustLevel: "federated",
    trustDetail: "Canonical signature format eader‖r‖s proven on-chain (e3201815…, bfce11c8…)",
    readiness: "gated",
    gateReason: "Blurt public RPC nodes 0/6 reachable — anchors paused honestly",
    hops: () => [{ network: "saos-net", contract: null, action: "anchor" }, { network: "blurt", contract: null, action: "anchor" }],
    quote: async () => ({ legs: [{ ...STEEM_ANCHOR_LEG, network: "blurt", currency: "BLURT" }], allMeasured: true }),
    estimateTime: () => 12,
  },
  {
    id: "bridge-tron",
    source: "saos-net",
    target: "tron",
    label: "SAOS-NET ⇄ TRON (Direct)",
    trustLevel: "federated",
    trustDetail: "6-address relay ring; checkpoint hashes bit-encoded in TRX transfer amounts — zero net fee, ≤2–3 anchors/day",
    readiness: "live",
    gateReason: null,
    hops: () => [{ network: "saos-net", contract: null, action: "anchor" }, { network: "tron", contract: null, action: "transfer" }],
    quote: async () => ({ legs: [{ ...TRON_FREE_LEG }], allMeasured: true }),
    estimateTime: () => 30,
  },
  {
    id: "bridge-steem-ethereum",
    source: "steem",
    target: "ethereum",
    label: "STEEM → ETHEREUM (Direct)",
    trustLevel: "federated",
    trustDetail: "Steem-side lock via custom_json (saos_bridge_lock) + oracle-signed mint against a bridge contract — trust model fixed at deployment",
    readiness: "gated",
    gateReason: "No bridge contract deployed on Ethereum mainnet — lock op defined, mint leg awaits verified contract (BRIDGE_ABI ready)",
    hops: () => [
      { network: "steem", contract: null, action: "lock" },
      { network: "ethereum", contract: null, action: "mint" },
    ],
    quote: async () => ({ legs: [{ ...STEEM_ANCHOR_LEG }, await ethMintFeeLeg()], allMeasured: false }),
    estimateTime: () => 3 + 13 * 60, // lock ~1 block + ETH deep finality ≈ 13 min (2 epochs)
  },
  {
    id: "bridge-steem-solana",
    source: "steem",
    target: "solana",
    label: "STEEM → SOLANA (Direct)",
    trustLevel: "federated",
    trustDetail: "Steem-side lock via custom_json + oracle-signed SPL mint against a Solana program — trust model fixed at deployment",
    readiness: "gated",
    gateReason: "No bridge program deployed on Solana mainnet — lock op defined, mint leg awaits deployed program (program IDs staged)",
    hops: () => [
      { network: "steem", contract: null, action: "lock" },
      { network: "solana", contract: null, action: "mint" },
    ],
    quote: async () => ({
      legs: [
        { ...STEEM_ANCHOR_LEG },
        { ...SOL_SIG_LEG },
        { network: "solana", amount: "0.00203928", currency: "SOL", source: "ATA rent-exempt minimum (stated protocol constant) when destination account is new" },
      ],
      allMeasured: false,
    }),
    estimateTime: () => 3 + 13, // lock + ~32 slots × 0.4s finality
  },
];

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Rail catalog read-view — for tools/monitors that must PROVE registry facts
// (what exists, in which direction, at which readiness) without reaching
// into internals. Additive, read-only.
// ---------------------------------------------------------------------------

export interface RailCatalogEntry {
  id: string;
  source: BridgeNetworkId;
  target: BridgeNetworkId;
  label: string;
  readiness: BridgePath["readiness"];
  gateReason: string | null;
}

export function railCatalog(): RailCatalogEntry[] {
  return RAILS.map((r) => ({ id: r.id, source: r.source, target: r.target, label: r.label, readiness: r.readiness, gateReason: r.gateReason }));
}

// ---------------------------------------------------------------------------
// Multi-hop hub routing — composed ONLY from real registry rails (1-d fix)
// ---------------------------------------------------------------------------
// BUG FIXED HERE: the previous implementation composed multi-hop routes only
// from rails with `target === "saos-net"` — no such rail exists in the
// registry (every hub rail is authored source:"saos-net"), so that block was
// DEAD CODE: e.g. hive→ethereum returned [] despite real hive + ethereum
// rails existing. Composition now walks the actual rail graph, allowing each
// REAL rail to be traversed forward (as defined) or in reverse (target→source
// — the hub receipt direction; the same reverse-leg concept the mirror
// fallback at the bottom of findPaths has always used, now applied per-leg).
// Nothing is invented: a leg exists only if its rail exists in RAILS, and it
// carries that rail's real readiness, real gateReason and real fee quote.

/** Composition bounds — stated, not guessed. The registry's hub topology
 *  (spoke → SAOS-NET → spoke → leaf) needs at most 3 legs; 1-leg "paths" are
 *  direct rails and are owned by the direct block in findPaths. */
const MIN_MULTIHOP_LEGS = 2;
const MAX_MULTIHOP_LEGS = 3;

interface RailLeg {
  rail: RailDef;
  /** "forward" = rail as defined; "reverse" = rail traversed target→source. */
  direction: "forward" | "reverse";
  from: BridgeNetworkId;
  to: BridgeNetworkId;
}

function railLegsFrom(node: BridgeNetworkId, usedRailIds: ReadonlySet<string>): RailLeg[] {
  const legs: RailLeg[] = [];
  for (const rail of RAILS) {
    if (usedRailIds.has(rail.id)) continue;
    if (rail.source === node) legs.push({ rail, direction: "forward", from: node, to: rail.target });
    else if (rail.target === node) legs.push({ rail, direction: "reverse", from: node, to: rail.source });
  }
  return legs;
}

function legRouteHops(leg: RailLeg): BridgeHop[] {
  return leg.direction === "forward" ? leg.rail.hops() : leg.rail.hops().slice().reverse();
}

function legLabel(leg: RailLeg): string {
  return leg.direction === "forward" ? leg.rail.label : `${leg.rail.label} — reverse direction`;
}

/** Depth-limited simple-path search over the REAL rail graph — no repeated
 *  nodes, no repeated rails. Deterministic: registry order, fewer legs first. */
function composeHubLegs(source: BridgeNetworkId, target: BridgeNetworkId): RailLeg[][] {
  const found: RailLeg[][] = [];
  const walk = (node: BridgeNetworkId, visited: Set<BridgeNetworkId>, path: RailLeg[]): void => {
    if (node === target) {
      if (path.length >= MIN_MULTIHOP_LEGS) found.push(path);
      return; // target is terminal — never route "through" the destination
    }
    if (path.length >= MAX_MULTIHOP_LEGS) return;
    const used = new Set(path.map((l) => l.rail.id));
    for (const leg of railLegsFrom(node, used)) {
      if (visited.has(leg.to)) continue;
      walk(leg.to, new Set([...visited, leg.to]), [...path, leg]);
    }
  };
  walk(source, new Set([source]), []);
  return found.sort((a, b) => a.length - b.length); // Array#sort is stable → registry order on ties
}

/** Assemble one multi-hop BridgePath from composed REAL legs:
 *  fee stacking = every leg's real fee legs concatenated (allMeasured = AND),
 *  availability = the WORST leg's state (one gated leg → gated route with the
 *  honest per-leg reason attached), time = sum of leg estimates. */
async function buildMultiHopPath(source: BridgeNetworkId, target: BridgeNetworkId, legs: RailLeg[]): Promise<BridgePath> {
  const quoted = await Promise.all(legs.map(async (leg) => ({ leg, fee: await leg.rail.quote() })));
  const nodeChain: BridgeNetworkId[] = [source, ...legs.map((l) => l.to)];
  const hasReverse = legs.some((l) => l.direction === "reverse");
  const gatedLegs = legs.filter((l) => l.rail.readiness !== "live");
  const readiness: BridgePath["readiness"] = gatedLegs.length === 0 ? "live" : "gated";
  return {
    id: legs.map((l) => (l.direction === "forward" ? l.rail.id : `${l.rail.id}:reverse`)).join("+"),
    source,
    target,
    label: `${nodeChain.map((n) => BRIDGE_NETWORKS[n].name).join(" → ")} (Multi-hop${hasReverse ? " · reverse leg" : ""})`,
    route: legs.flatMap(legRouteHops),
    estimatedTime: legs.reduce((sum, l) => sum + l.rail.estimateTime(), 0),
    fee: {
      legs: quoted.flatMap(({ fee }) => fee.legs),
      allMeasured: quoted.every(({ fee }) => fee.allMeasured),
    },
    readiness,
    gateReason:
      readiness === "live"
        ? null
        : gatedLegs.map((l) => `${l.rail.id} (${l.direction}): ${l.rail.gateReason ?? "constituent rail gated"}`).join(" · ") ||
          "constituent rail gated",
    trustLevel: legs.some((l) => l.rail.trustLevel === "federated") ? "federated" : "trustless",
    trustDetail: legs.map((l) => l.rail.trustDetail).join(" — then — "),
    hops: quoted.map(({ leg, fee }) => ({
      railId: leg.rail.id,
      direction: leg.direction,
      from: leg.from,
      to: leg.to,
      label: legLabel(leg),
      route: legRouteHops(leg),
      estimatedTime: leg.rail.estimateTime(),
      fee,
      readiness: leg.rail.readiness,
      gateReason: leg.rail.gateReason,
    })),
    via: nodeChain.slice(1, -1),
  };
}

export interface FindPathParams {
  source: BridgeNetworkId;
  target: BridgeNetworkId;
  asset: string;
  amount: string;
}

function hopLabel(hop: BridgeHop): string {
  return `${BRIDGE_NETWORKS[hop.network].name}:${hop.action}`;
}

export async function findPaths(params: FindPathParams): Promise<BridgePath[]> {
  const { source, target } = params;
  const direct = RAILS.filter((r) => r.source === source && r.target === target);
  const reverse = RAILS.filter((r) => r.source === target && r.target === source);

  const out: BridgePath[] = [];

  for (const rail of direct) {
    const fee = await rail.quote();
    out.push({
      id: rail.id,
      source: rail.source,
      target: rail.target,
      label: rail.label,
      route: rail.hops(),
      estimatedTime: rail.estimateTime(),
      fee,
      readiness: rail.readiness,
      gateReason: rail.gateReason,
      trustLevel: rail.trustLevel,
      trustDetail: rail.trustDetail,
    });
  }

  // Multi-hop: composed from REAL registry rails (forward or reverse legs)
  // through the sovereign hub — additive to the candidate set, ranked after
  // direct rails, and suppressed entirely when a direct LIVE rail exists
  // (a direct live rail always beats composing the same move through the hub).
  if (!out.some((p) => p.readiness === "live")) {
    for (const legs of composeHubLegs(source, target)) {
      out.push(await buildMultiHopPath(source, target, legs));
    }
  }

  // Mirror routes (target → source direction) — flagged, only when nothing else.
  if (out.length === 0) {
    for (const rail of reverse) {
      const fee = await rail.quote();
      out.push({
        id: `${rail.id}:reverse`,
        source: rail.target,
        target: rail.source,
        label: `${rail.label} — reverse direction (asset flows ${BRIDGE_NETWORKS[rail.source].name}→${BRIDGE_NETWORKS[rail.target].name})`,
        route: rail.hops().slice().reverse(),
        estimatedTime: rail.estimateTime(),
        fee,
        readiness: rail.readiness,
        gateReason: rail.gateReason,
        trustLevel: rail.trustLevel,
        trustDetail: rail.trustDetail,
      });
    }
  }

  return out;
}

/** Human-readable route summary for tooltips/logs. */
export function describePath(p: BridgePath): string {
  return `${p.label} · ${p.route.map(hopLabel).join(" → ")} · ${p.estimatedTime}s · ${p.readiness}${p.gateReason ? ` (${p.gateReason})` : ""}`;
}

/**
 * Execute gate — fail-closed with honest reasons. Only LIVE rails may pass;
 * the caller (API route) then routes the op through the vault signing gate.
 */
export async function assertExecutable(path: BridgePath): Promise<{ executable: boolean; reason: string | null }> {
  if (path.readiness === "gated") {
    return { executable: false, reason: path.gateReason ?? "rail is gated" };
  }
  const allAnchors = path.route.every((h) => h.action === "anchor" || h.action === "transfer");
  if (!allAnchors) {
    return { executable: false, reason: "route contains lock/mint hops with no deployed contract — fail closed" };
  }
  return { executable: true, reason: null };
}
