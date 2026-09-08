# SAOS Inventory — Where Everything Actually Lives

Generated: 2026-09-08 · evidence gathered live (GitHub API over the org's repos + on-chain probes + daemon-pushed state) · companion scan artifact: `docs/saos-scan.json`

**Reading guide:** every row names the exact file(s), the measured status, and how it was verified. "live" = measured working at scan time; "gated" = built but awaiting an owner decision/deployment; "missing" = does not exist anywhere in the org.

---

## 1. SAOS-NET — the sovereign chain

| Component | Location (`roshpinacare-sys/steem`) | Status | Evidence |
|---|---|---|---|
| Chain kernel | `sovereign/node/saosnet.cjs` (142 KB) | **live** | state.json pushed by daemon; height 54,983; netVersion `saos-net/0` |
| Chain state | `sovereign/node/state.json` (178 KB), `state-root.json`, `state-snapshot.json` | **live** | `/api/eco/saosnet` → genesisHash, stateRoot, lastBlockHash |
| Tx archive | `sovereign/node/chain-archive.jsonl` (**39.6 MB** real txs) | **live** | replayed for the grid98 bench (65,238 real txs in 2,001 ms) |
| Snapshots + poison-quarantine | `state-snapshot.*.poisoned-*.json`, `*.quarantine-*.json` | **live (self-healing)** | corrupted snapshots are quarantined, never silently overwritten |
| Checkpoints | 64 checkpoints · 1,507 verified txs | **live** | `core.checkpointCount/verifiedCount` from pushed state |
| Consensus model | deterministic kernel + checkpoint anchoring to Steem/Hive/TRON (shadow-L1) | **live** | every beat seals a checkpoint via custom_json `saos-dex.anchor.v1` on Steem |
| Public API | `/api/eco/saosnet`, `/api/eco/anchors`, `/api/eco/saos-hub` (this repo) | **live** | 200s, force-dynamic, zero-mock fields |
| Tokenomics | no inflation/supply schedule exists — SAOS is an internal µ-denominated unit; value enters via 1:1 locked reserves + harvest rail | **partial / honest gap** | wrapped table below is the only supply that exists |

## 2. grid98 — the high-flow engine

| Component | Location | Status | Evidence |
|---|---|---|---|
| Engine | `sovereign/node/grid98.cjs` (63 KB, Task 98) | **live** | ticks 8,324 · rounds 48,850 · txs total 132,940 · trades 5,606 |
| Engine state | `sovereign/node/grid98-state.json` (7.5 KB) | **live** | pools, anchors, seeds, mints, steps, journal reference |
| Throughput bench | `grid98.cjs --bench` | **live-measured** | **32,603 tx/s** (65,238 archive txs / 2,001 ms) = 2.82B/day mechanism ceiling — measured on real archive replay, not a claim. (Any other number circulating, e.g. "130K", is NOT what the live state measures today.) |
| Profitability gate | per-op edge ≥ fee + min-profit | **live and enforced** | `skippedForEdge: 383,836` · `rejected: 130,499` · `edgeLeak: 109,919 µ` — counters grow in production |
| Floor ladder | 9 steps, each backed by measured PnL | **live** | 0.01688 → 0.017567 USD; steps list with `backedByµ` |
| Soldier arena | maker + rotating-taker PnL per soldier | **live** | `soldierPnlµ` (leader: wog +163,295 µSAOS) |
| DEX-98 pools | 14 pairs incl. WBTC/WETH/WXRP/WDOGE/WSBD/PHIVE/ENERGY vs SAOS | **live** | pools + LP values in state; `dexsweep112.cjs` deepens them |
| Per-trade journal | `grid-journal-2026-09-07.jsonl` | **live** | named in grid98-state `journal` field |
| Order GC | protocol-level order garbage collection | **live** | `order_gc` txs on-chain (state growth control) |

## 3. The 13 Soldiers (army) — verified live on Steem mainnet

Measured via `condenser_api.get_accounts` + `rc_api.find_rc_accounts` (13/13 returned):

| Account | Role | Live SP | Delegation scopes |
|---|---|---|---|
| @headcorner | **commander** (SP 8.64, created 2018-03-02) | 8.64 | issue · anchor · command |
| @cashmachine | soldier | 0.01 | trade · attest · report |
| @haran | soldier | 0.38 | trade · attest · report |
| @israelnews | soldier | 0.00 | trade · attest · report |
| @lsa | soldier | 0.01 | trade · attest · report |
| @macrame | soldier | 0.00 | trade · attest · report |
| @siq | soldier | 0.01 | trade · attest · report |
| @tov | soldier | 0.01 | trade · attest · report |
| @wic | soldier | 0.00 | trade · attest · report |
| @wog | soldier | 0.01 | trade · attest · report |
| @woq | soldier | 0.00 | trade · attest · report |
| @ynet | soldier | 0.00 | trade · attest · report |
| @powerspan | reserve (ENERGY/SP lock) | 0.00 | (fleet voice only) |

Plus the **TRON ring** (6 relay addresses, TRON-side): `tron-s0…tron-s5` — scopes anchor · ring · bridge.

**Where the army's code lives** (`roshpinacare-sys/steem`):
- `agent/agent.cjs` (**262 KB**, 4,943 lines) — the agent OS: 8 status loops (`claim`, `watcher` BOT-3, `transferWatch`, `curation`, `factory`, `armyClaim`, `armyCuration`, `armySweep`), DRY_RUN by default, keys stay local (iron rule), log redacts WIFs
- `agent/fleet_keys.enc` (170 KB **encrypted** fleet keys) + `fleet_keys.meta.json`
- `agent/fleet_state.json` (ping seq per soldier — measured), `agent/fleet_rc.json` (per-soldier RC+HP measured hourly), `agent/army_seen.json` (curation dedup feed)
- `agent/fleet_vault.cjs`, `agent/fleet_voice.cjs`, `agent/chaintalk.cjs` (inter-soldier bus)
- Soldier↔soldier communication: chaintalk pending queue (`chaintalk_pending.json`, 175 KB) + command files (`command_seen.json`, `commands_sent.json`)

## 4. Loop census (what the user calls "28 loops" — measured 2026-09-08)

**23 loop units measured live** (8 agent/guardian + 15 node daemons), each with byte-size evidence fetched from the repo this scan:

- **Agent + guardian (8):** agent.cjs (262.9 KB) · anchor.cjs (19.7 KB) · oracle106.cjs · fleet_voice.cjs · chaintalk.cjs · cloud_heartbeat.cjs · guardian-loop-1 · guardian-loop-2 (pid files present)
- **Sovereign node (15):** saosnet.cjs (142.6 KB) · grid98.cjs (63.2 KB) · relay.cjs (13.7 KB) · tronbridge.cjs (43.4 KB) · deposits.cjs (23.1 KB) · harvest.cjs (20 KB) · swap.cjs (18 KB) · theswap.cjs (17.4 KB) · trondex.cjs (15.9 KB) · dexsweep112.cjs (13 KB) · sibling.cjs (12.3 KB) · wallets.cjs (24.9 KB) · archive_heal.cjs (2.7 KB) · rc_heal.cjs (5.8 KB) · roshpina-bridge.cjs (9.2 KB)

## 5. Bridge infrastructure

| Rail | Code | State | Status |
|---|---|---|---|
| SAOS-NET → STEEM (relay) | `sovereign/node/relay.cjs` + `agent/anchor.cjs` (identity) | `agent/bridge_state.json` (anchoredTotal=100, cp txid 0418b5a1…), live anchors in pushed state | **live** — cp#54804 sealed, 15 anchors in feed, public txids (steemworld/steemscan verifiable) |
| SAOS-NET ⇄ TRON | `sovereign/node/tronbridge.cjs` (43.4 KB) | `sovereign/node/tron-bridge-state.json` (26 KB) | **live** — checkpoint hashes bit-encoded in TRX transfers; 6-address ring; zero net fee; vault `TAzZZkrwBXk59iRya7esnKVJeV1xLtqkGr`, relay `TRKStC5HbWzqdnrWDfc4vYNfgQgyZuQKP4`; measured 6/6 addresses; 4 anchors (last cp#33612 → tron blk 86,019,974) |
| SAOS-NET → HIVE | (same relay pattern) | verified historically d4cf936b… @ blk 10,970,856 | **gated** — RC-regen wait |
| SAOS-NET → BLURT | `agent/blurt99.cjs` + 3 live endpoints (Task 99 scan) | anchored on-chain before (e3201815…, bfce11c8…) | **gated** — fleet gate reopens anchors |
| STEEM → ETHEREUM | `packages/chains/ethereum/*` (this repo, M3) + `BRIDGE_ABI` | lock op defined | **gated** — no contract deployed (owner decision, real money) |
| STEEM → SOLANA | `packages/chains/solana/*` (this repo, M3) + staged program IDs | lock op defined | **gated** — no program deployed |
| Roshpina platform bridge | `sovereign/node/roshpina-bridge.cjs` | `roshpina-bridge-state.json` | live component in the node family |

## 6. SAOS token + wrapped economy

There is no naked "SAOS token" — **the sovereign asset design is wrapped 1:1 against measured locks**, and that is the honest tokenomics:

| Asset | Supply = Locked (1:1) | Holders | Backing evidence |
|---|---|---|---|
| WSTEEM | 632 | 12 | self-wrap tx `2ad481ac…` (steemscan) — 316,000 µ minted 1:1 |
| WBLURT | 64.227 | 12 | measured headcorner balance at Blurt head 63,403,093 |
| ENERGY (SP) | 49.5 | 12 | powerspan lock tx `6308fe2f…` |
| WTRX | 22.924 | 11 | locked in the live TRON bridge vault (6 addresses, measured 95) |
| WSBD | 0.26 | 1 | lock tx `2d6ed4c0…` |
| WSOL / WETH / WBTC | 0.0961 / 0.00401 / 3e-9 | 2/2/1 | Task 117 deposits: real $1+ deposits mintable 1:1 (bookScale 1e9 nano) |
| PHIVE | 0.002 | 1 | lock tx `13141ef3…` |
| WDOGE / WXRP | 0.004 / 0.001 | 0/0 | seeded pools (deployed via dexsweep112) |
| 10 TRC20 wrappers (WUSDT, WJST, WSUN, WBTT, WNFT, WHTX, WTUSD, WUSDD, WUSD1) | 0 (supply 0) | — | TRC20 contract addresses **verified live** on Tron (holders + names measured), ready for deposits |

**Liquidity pools:** 14 pairs (full table in the SAOS HUB tab): WSOL/WSTEEM LP 34.6M · WTRX/SAOS(pw) 13.98M · WETH/WSTEEM 1.45M · WSTEEM/SAOS 114K · WTRX/WSTEEM 37.1K · + 8 more; AMM fee 30bps → LP + treasury → harvest flywheel.

## 7. Oracle

- `agent/oracle106.cjs` — hourly **signed** asset_price quotes (src+ref+at), coingecko-sourced, honest skip on network failure (zero price invention), WBLURT owned solely by blurt99 (no double-anchoring)
- Live feed: **15 quotes** in the pushed state (ENERGY, PHIVE, WBLURT, WBTT, WHTX, WJST, WNFT, WSBD, WSTEEM, WSUN, WTRX, WDOGE, WBTC, WETH, WSOL), refs like `o106:px:WSTEEM:2026090723`

## 8. Companion repos (the wider SAOS stack)

| Repo | Role | SAOS-relevant content |
|---|---|---|
| `saos-dex` | the sovereign exchange (canonical) | deterministic order book + AMM 30bps (`src/lib/dex/amm.ts`) · soldier wallet routes (`api/dex/wallets`) · `state/anchors.json` |
| `saos-sovereign-platform` | standalone canonical platform (folder B) | EVM/SVM anchor routes (`anchor-evm.ts`, `api/saos/anchor/{evm,svm}`) · vault seal (`vault-seal.ts`) · fleet keys enc |
| `saos-sovereign-foundry` | anchoring foundry + evidence economy | anchor gates (`anchor-gates.ts`) · runbooks (`first-anchor-runbook.md`, `anchor-preflight.md`) |
| `roshpina` | sovereign trust & value platform | Ed25519 passports (`kernel/passport/*`) · delegation kernel · transparency-log receipt/federation anchors · bridge panel |
| `Project-files` | archive | `srs_sovereign_runtime_substrate_v8.2.0.zip` (sovereign runtime substrate source) |
| `Saosmartwallet` | this repo | 7-network wallet + vault + bridges + SAOS HUB UI |

## 9. Honest gaps (measured, not hidden)

1. **No SAOS mainnet token schedule** — no supply/inflation/reward economics document exists anywhere in the org; the only real supply is the wrapped 1:1 table.
2. **ETH/SOL bridge rails gated** — adapters + ABI + program IDs ready; deployment pending (owner decision with real funds).
3. **"130K tx/s" not reproducible today** — the live measured bench is 32,603 tx/s on the current kernel (2.82B/day ceiling). Report the measured number; the claim needs a re-measure or retraction.
4. **MEV protection absent org-wide** (as before).
5. **Soldier balances are dust-scale** (SP ≤ 8.64 total) — the army is functionally real but economically tiny today.
