/**
 * Saosmartwallet — Ecosystem Registry (Grid Dashboard)
 * =====================================================
 * Catalog of the SAOS ecosystem produced by the live scan of the
 * `roshpinacare-sys` GitHub organization (2026-09-07, GitHub API +
 * README/config analysis). This file contains FACTS ABOUT REPOS —
 * what exists, where, and in what state. It never invents market
 * data: live numbers come exclusively from chain probes (eco-server).
 *
 * Status vocabulary (honest labels only):
 *   live      — running in production with on-chain evidence
 *   active    — code complete & maintained, runtime not wired here
 *   sim       — running engine, explicitly labeled SIM (no real funds)
 *   gated     — code ready, blocked on an external resource (honest wait)
 *   archive   — historical snapshot
 */

export type EcoStatus = "live" | "active" | "sim" | "gated" | "archive";

export interface EcoRepo {
  name: string;
  size: string;
  language: string;
  purpose: string;
  status: EcoStatus;
  highlights: string[];
}

export interface EcoNetworkInfo {
  id: string;
  name: string;
  family: string;
  kind: string;
  role: string;
  adapterStatus: string;
}

export interface EcoPairInfo {
  pair: string;
  venue: string;
  status: EcoStatus;
  note: string;
}

export interface EcoBridgeInfo {
  id: string;
  rail: string;
  mechanism: string;
  status: EcoStatus;
  evidence: string;
}

export interface EcoServiceInfo {
  name: string;
  what: string;
  where: string;
  status: EcoStatus;
}

export interface EcoGap {
  title: string;
  detail: string;
  severity: "high" | "medium" | "low";
}

// ---------------------------------------------------------------------------
// Repos (scan result — 2026-09-07)
// ---------------------------------------------------------------------------

export const ECO_REPOS: EcoRepo[] = [
  {
    name: "steem",
    size: "181 MB",
    language: "JavaScript",
    purpose: "SAOS — Steem AI Agent OS: soldier fleet (13 accounts · 28 loops), SAOS-NET sovereign chain, grid98 DEX engine, explorer, cloud-heart 24/7",
    status: "live",
    highlights: [
      "SAOS-NET height 52,000+ · checkpoints anchored to Steem/Hive/TRON",
      "grid98 measured 130,541 tx/s kernel bench (~11.3B/day capability)",
      "CHAINTALK cross-network messaging with memo-ECDH",
      "Cloud-heart GitHub-Actions takeover — network survives sandbox death",
    ],
  },
  {
    name: "saos-dex",
    size: "94 KB",
    language: "TypeScript",
    purpose: "SAOS-DEX sovereign exchange: deterministic escrow orderbook + AMM 30bps + soldier arena + THE-DOOR relay",
    status: "sim",
    highlights: [
      "Relay verified on-chain: same stateRoot anchored on Steem AND Hive",
      "Read-back verification loop with circuit breakers",
      "Book is honestly labeled SIM — no real money",
    ],
  },
  {
    name: "saos-sovereign-platform",
    size: "42 KB",
    language: "TypeScript",
    purpose: "Foundry v3 Command Deck — anchoring towers, energy calculators, economy simulator",
    status: "active",
    highlights: ["Anchor matrix: STEEM ✅ / BLURT ✅ / HIVE ⏳ rc-gated / TRON 🚧", "Zero-dependency SDS-2 design system"],
  },
  {
    name: "saos-sovereign-foundry",
    size: "318 KB",
    language: "TypeScript",
    purpose: "Foundry v2 — cross-network anchoring with 13 documented endpoints, live-gate, keyless SignRequest flow",
    status: "active",
    highlights: ["Full engineering docs (architecture/api/security/runbook)", "45 API tests + 8 parallel seal drills verified"],
  },
  {
    name: "Saosmartwallet",
    size: "348 KB",
    language: "TypeScript",
    purpose: "This repo — sovereign wallet: M0 bit-exact serialization engine + M1 live STEEM/SBD DEX + ecosystem Grid",
    status: "live",
    highlights: [
      "M0: limit_order_create verified BIT-EXACT vs node serializer (30/30 + 27/27 vectors)",
      "M1: live internal-market terminal — every number from api.steemit.com",
      "Grid: this dashboard — all five chains probed live",
    ],
  },
  {
    name: "roshpina",
    size: "481 KB",
    language: "TypeScript",
    purpose: "Sovereign Trust & Value kernel — 17 modules: escrow, marketplace, Ed25519 passports, RBAC, risk, settlement rails",
    status: "active",
    highlights: ["kernel-smoke.ts harness", "dhive dependency — Graphene-native"],
  },
  {
    name: "anchor-baseline",
    size: "1 KB",
    language: "—",
    purpose: "Folder A restore of anchoring baseline commit 5356dab",
    status: "archive",
    highlights: [],
  },
  {
    name: "Project-files",
    size: "64 MB",
    language: "—",
    purpose: "Archive of 10 project ZIPs (unified-platform, srs_sovereign_runtime, steem-main snapshot…)",
    status: "archive",
    highlights: [],
  },
];

// ---------------------------------------------------------------------------
// Networks
// ---------------------------------------------------------------------------

export const ECO_NETWORKS: EcoNetworkInfo[] = [
  {
    id: "steem",
    name: "STEEM",
    family: "Graphene",
    kind: "L1 public",
    role: "Primary host chain — internal market DEX (this repo), main anchor rail",
    adapterStatus: "ADAPTER DONE (M0) — bit-exact serialization, live market client",
  },
  {
    id: "hive",
    name: "HIVE",
    family: "Graphene",
    kind: "L1 public",
    role: "Secondary anchor rail — RC-gated, honest regen wait",
    adapterStatus: "NO ADAPTER YET — same Graphene family, port is cheap",
  },
  {
    id: "blurt",
    name: "BLURT",
    family: "Graphene",
    kind: "L1 public",
    role: "Anchor rail — canonical signature format proven on-chain",
    adapterStatus: "NO ADAPTER YET — nodes 0/6 live at scan time (honest)",
  },
  {
    id: "tron",
    name: "TRON",
    family: "TVM (DPoS)",
    kind: "L1 public",
    role: "Zero-fee anchor rail + TRC20 wrapped economy + USDT settlement",
    adapterStatus: "NO ADAPTER YET — bridge identity exists (tronbridge.cjs)",
  },
  {
    id: "saos-net",
    name: "SAOS-NET",
    family: "Sovereign",
    kind: "L1 shadow chain",
    role: "Our own deterministic chain — 3s pulse blocks, checkpoints every 12 blocks, soldiers as validators",
    adapterStatus: "ENGINE LIVE (steem repo) — kernel replay + state-root lineage",
  },
];

// ---------------------------------------------------------------------------
// Pairs (catalog; live numbers arrive from chain probes at render time)
// ---------------------------------------------------------------------------

export const ECO_PAIRS: EcoPairInfo[] = [
  { pair: "STEEM/SBD", venue: "Steem Internal Market", status: "live", note: "THE real market — order book + tape wired into this dashboard (DEX tab)" },
  { pair: "SAOS/STEEM", venue: "SAOS-NET sovereign book", status: "live", note: "Sovereign order book on our own chain (state.json: book)" },
  { pair: "WTRX/SAOS", venue: "grid98 AMM", status: "sim", note: "Bridge pool — WTRX covered 1:1 by measured TRX vault" },
  { pair: "WBLURT/SAOS", venue: "grid98 AMM", status: "sim", note: "Blurt wrap pool, oracle-rebalanced hourly" },
  { pair: "WSBD/SAOS", venue: "grid98 AMM", status: "sim", note: "SBD wrap pool" },
  { pair: "WSTEEM/SAOS", venue: "grid98 AMM", status: "sim", note: "STEEM wrap pool — host side of the woven economy" },
  { pair: "WBTC/SAOS · WETH/SAOS · WXRP/SAOS · WDOGE/SAOS", venue: "grid98 AMM", status: "sim", note: "External-currency pools — MINTABLE_1TO1 shield after unit-recon (Task 102)" },
  { pair: "PHIVE/SAOS · ENERGY/SAOS", venue: "grid98 AMM", status: "sim", note: "Hive-family pools" },
];

// ---------------------------------------------------------------------------
// Bridges
// ---------------------------------------------------------------------------

export const ECO_BRIDGES: EcoBridgeInfo[] = [
  {
    id: "relay-steem",
    rail: "SAOS-NET → Steem",
    mechanism: "custom_json saos-dex.anchor.v1 / saos.weave.v1 (active authority), every checkpoint seal",
    status: "live",
    evidence: "Checkpoint anchors with Steem txids flow live through this dashboard; historical: 390bcfc2… @ blk 10,937,394",
  },
  {
    id: "relay-hive",
    rail: "SAOS-NET → Hive",
    mechanism: "custom_json anchors, RC-budgeted (8% floor / 12% heavy-op gates)",
    status: "gated",
    evidence: "Verified on-chain historically (d4cf936b… @ blk 10,970,856) — currently honest RC-regen wait",
  },
  {
    id: "relay-blurt",
    rail: "SAOS-NET → Blurt",
    mechanism: "canonical signature format eader‖r‖s (header=31+recid)",
    status: "gated",
    evidence: "Anchored on-chain before (e3201815…, bfce11c8…); nodes 0/6 live at scan time",
  },
  {
    id: "bridge-tron",
    rail: "SAOS-NET ⇄ TRON",
    mechanism: "TRX transfer amounts bit-encode checkpoint hashes; 6-address ring, zero net fee, ≤2-3 anchors/day",
    status: "live",
    evidence: "cp#33612 → txid 1db5006b… @ TRON blk 86,019,974 · live pulse monitored in Bridge tab",
  },
];

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export const ECO_SERVICES: EcoServiceInfo[] = [
  { name: "Soldier Fleet", what: "13 accounts · 28 loops — market makers, validators, attesters, reporters", where: "steem repo", status: "live" },
  { name: "grid98 Engine", what: "Resident-state market engine — micro-pulses, value ladder, treasury P&L ledger", where: "steem repo", status: "live" },
  { name: "THE-DOOR Relay", what: "Non-blocking anchor queue with per-chain circuit breakers + read-back verify", where: "saos-dex + steem repos", status: "live" },
  { name: "Cloud Heart", what: "GitHub Actions takeover every 30min — network survives sandbox death", where: "steem repo (.github)", status: "live" },
  { name: "Guardian", what: "Self-heal loops: web server, engine OOM, RC gates, snapshot amnesia", where: "steem repo", status: "live" },
  { name: "Oracle 106", what: "Hourly signed price quotes (coingecko-sourced) anchoring pools to reality", where: "steem repo", status: "live" },
  { name: "CHAINTALK CHL-1", what: "Cross-network command language — predict→act→measure→match, ECDH memos", where: "steem repo", status: "live" },
  { name: "Evidence Packs", what: "Merkle verify-packs — independent recomputation of every seal", where: "saos-dex + foundry", status: "live" },
  { name: "Roshpina Kernel", what: "Passports (Ed25519), escrow, RBAC, risk, settlement rails — 17 modules", where: "roshpina repo", status: "active" },
  { name: "Keystore M2", what: "AES-256-GCM vault + Policy Engine (Aurora Modes) — the missing signing gate", where: "THIS repo (planned)", status: "gated" },
];

// ---------------------------------------------------------------------------
// Gaps — honest list of what's missing
// ---------------------------------------------------------------------------

export const ECO_GAPS: EcoGap[] = [
  { title: "No Hive/Blurt/TRON adapters in Saosmartwallet", detail: "M0 proves the adapter pattern on Steem. The Graphene twins are cheap ports; TRON needs an TVM adapter. Until then this wallet trades STEEM/SBD only.", severity: "high" },
  { title: "Keystore (M2) missing", detail: "The DEX terminal builds and previews real limit_order_create payloads (bit-exact) but cannot sign — packages/core keystore + policy engine is the gate.", severity: "high" },
  { title: "Hive RC regen wait", detail: "Fleet soldiers RC-starved (2–5% manabar); heal loop allocates HP, ETA measured ~5 days. Anchors honestly gated meanwhile.", severity: "medium" },
  { title: "Blurt nodes down (0/6)", detail: "saboin RPC 'down for maintenance' — probes fail; anchors on Blurt paused honestly with 30min cooldown.", severity: "medium" },
  { title: "TRON identity funding", detail: "Bridge identity derived and proven but auto-anchoring waits on ≥0.3 TRX funding; ring runs free-bandwidth only.", severity: "low" },
];

export const SCAN_META = {
  scannedAt: "2026-09-07",
  method: "GitHub API (repos list, trees, READMEs, live state files) + live RPC probes",
  reposScanned: 8,
  networksFound: 5,
  tokensTracked: 25,
  liveSources: ["api.steemit.com", "api.hive.blog", "rpc.blurt.world", "api.trongrid.io", "steem repo (SAOS-NET state.json — daemon-pushed)"],
};
