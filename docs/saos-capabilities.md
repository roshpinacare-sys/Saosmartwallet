# SAOS Capabilities — Proven, Not Claimed

Generated: 2026-09-08 · every capability below carries a **live proof** (endpoint, on-chain probe, or measured artifact) performed on the stated date · nothing here is a roadmap item

Legend: proof = how it was verified · value = the real problem it solves · efficiency = the measured economics

---

## 1. Deterministic sovereign chain with checkpoint anchoring
- **Proof:** `/api/eco/saosnet` → height 54,983, 64 checkpoints, 1,507 verified txs, genesis + stateRoot hashes; daemon-pushed state age surfaced honestly (~5 min at probe time).
- **Value:** a chain whose every state transition is reproducible and whose state is continuously notarized to Steem (public, unownable).
- **Efficiency:** anchoring costs one custom_json per beat (~zero fees); no validator set to pay.

## 2. grid98 throughput — measured, not marketed
- **Proof:** grid98-state bench: 65,238 **real archive txs** replayed in 2,001 ms → **32,603 tx/s**, 2,816,899,200/day mechanism ceiling (measured 2026-09-07, still the state's live bench record).
- **Value:** the chain mechanism is provably not the bottleneck — the economy is.
- **Efficiency:** resident-state design (full replay once, then incremental sync) removed the per-tick O(blocks) replay.

## 3. Soldier arena economy with real PnL attribution
- **Proof:** `soldierPnlµ` per soldier (wog +163,295 µSAOS, 7 soldiers on the leaderboard); 5,606 trades / 132,940 txs total; 282 trades today.
- **Value:** autonomous agents literally trade each other for treasury profit — governance by measurable performance.
- **Efficiency:** budget rotation favors leaders; treasury PnL 9,935,250 µSAOS cumulative, 7,645,411 µ today.

## 4. Enforced profitability gate (anti-leak honesty engine)
- **Proof:** live counters — 383,836 would-be trades skipped for insufficient edge, 130,499 ops rejected, 109,919 µ edge leak measured and accounted.
- **Value:** an automated treasury that refuses unprofitable trades by construction — no trader psychology, no drift.
- **Efficiency:** every outgoing action passes edge ≥ fee + min-profit; the refuse-counters are themselves published (auditability).

## 5. Backed price-floor ladder
- **Proof:** 9 steps logged with timestamps and exact backing (floor 0.01688 → 0.017567 USD; latest step backed 123,244 µ; realized-since-step 9,917,335,581 µ).
- **Value:** the floor rises only when real profit backs it — an anti-dump mechanism with an audit trail instead of a promise.
- **Efficiency:** ≤0.5% per step; every step's backing amount is on-record.

## 6. Cross-paradigm identity anchor (Steem+Hive+Blurt ⇄ EVM, one signature)
- **Proof:** `agent/anchor.cjs` (Task 44): one EIP-191 `personal_sign` with the same secp256k1 scalar as the Graphene ACTIVE key → custom_json `saos.id.v1` on Steem + Hive + Blurt → any verifier runs `ecrecover(hash(EIP-191), sig)` and matches the EC point to the live active authority of @headcorner on all three chains + the EVM address.
- **Value:** identity continuity across Graphene and EVM paradigms without revealing the key — third parties verify independently.
- **Efficiency:** one move, three chains, zero disclosure; `anchor_last.json` records txids + verifier.

## 7. Zero-fee TRON bridge via bit-encoded checkpoints
- **Proof:** `tronbridge.cjs` + tron-bridge-state: cp#33612 → txid `1db5006b…` @ TRON block 86,019,974; vault `TAzZZkrwBXk59iRya7esnKVJeV1xLtqkGr` + relay `TRKStC5HbWzqdnrWDfc4vYNfgQgyZuQKP4`; **measured 6/6 ring addresses**; pulse at tronHeight 86,051,850.
- **Value:** cross-chain state attestation with literally zero net fee (transfer amounts encode checkpoint hashes).
- **Efficiency:** 6-address ring design spreads the encoding; energy/bandwidth costs net out to zero on measured runs.

## 8. Wrapped-everything economy, 1:1 measured locks
- **Proof:** 20 wrapped assets, `supply == locked` for every alive one: WSTEEM 632, WBLURT 64.227, WTRX 22.924, ENERGY 49.5/50, WSOL/WSOL/WBTC per Task 117; mint txs cited (e.g. WSTEEM `2ad481ac…`); TRC20 contract addresses verified live on Tron for 9 assets (holders + names measured).
- **Value:** every external asset in the sovereign economy is covered by a measurable lock — no fractional-reserve wrapping.
- **Efficiency:** mint-coverage ≤99% enforced in the engine; seeds/mints per pool recorded in grid98-state.

## 9. 14-pool AMM with honest reseeding
- **Proof:** pools table live in state (WSOL/WSTEEM LP 34.6M … WSBD/SAOS 0.042); dex-facts documents the honest reseed of dead skeleton pools (ENERGY/SAOS, WSBD/SAOS) with LP provenance from the archive — "no third-party holder harmed" is a verifiable claim with refs.
- **Value:** trading venues for every wrapped asset against SAOS.
- **Efficiency:** 30 bps fee → LP + treasury → harvest rail (the flywheel returns value to stakeholders — rail tx `1d148959…` on steemscan).

## 10. Hourly signed oracle feed
- **Proof:** 15 live quotes in state, each with src+ref+at (`o106:px:WSTEEM:2026090723`); oracle106.cjs skips honestly on network failure (no invented prices); WBLURT single-owner (blurt99) to avoid double-anchoring.
- **Value:** price feeds for DeFi-style logic on SAOS-NET with dedup'd signed references.
- **Efficiency:** zero gas (off-chain signed, on-chain state); one coingecko call per hour.

## 11. Autonomous soldier fleet (13 accounts live on Steem)
- **Proof:** `condenser_api.get_accounts` returned **13/13 live accounts** (2026-09-08): @headcorner (8.64 SP, 2018) + 11 trade soldiers + @powerspan; per-soldier RC/HP measured hourly (`fleet_rc.json`); fleet voice seq per soldier (`fleet_state.json`); VP/RC re-measured in the SAOS HUB endpoint.
- **Value:** 24/7 automated claims/curation/sweep/reporting with zero human intervention.
- **Efficiency:** RPC discipline — all loops share a 15s snapshot cache (5 loops = 1 RPC read per window); DRY_RUN default; keys never leave the machine (WIFs redacted in logs).

## 12. 23-loop autonomous operations census
- **Proof:** byte-size evidence fetched live for 8 agent/guardian loops + 15 node daemons (from agent.cjs 262.9 KB down to archive_heal.cjs 2.7 KB); pid files for 2 guardian loops; state files prove each daemon writes (grid98-state, tron-bridge-state, trondex-live.json, swap-mandate.json, theswap-state.json, harvest-cursor.json…).
- **Value:** the org runs itself — claims, curation, trading, bridging, healing, sweeping.
- **Efficiency:** all under one beat.lock (single-writer discipline, zero file races).

## 13. Self-healing operational stack
- **Proof:** `archive_heal.cjs` + `archive_gaps.json` (gap ledger → healed), `rc_heal.cjs` (fleet RC regen), poisoned-snapshot quarantine files (`*.poisoned-*.json`, `*.quarantine-*.json` — corruption isolated, never silently overwritten), RPC failover lists in anchor.cjs (3 Blurt endpoints discovered live, 3 Steem history nodes), M4-proven adapter failover in this repo.
- **Value:** the system repairs itself and keeps honest evidence of every repair.
- **Efficiency:** healing is ledgered; a failed heal is visible, not hidden.

## 14. Public-verifiable honesty feed (dex-facts)
- **Proof:** `sovereign/node/dex-facts.json` — every material claim carries a public ref (steemscan txids, checkpoint ids); e.g. "the market corrected my seed price" event with the free-flow arbitrage measured (209 swaps ate side-a 315,562 µ → 5,360 µ within minutes).
- **Value:** an operations log where every entry can be independently verified — the anti-marketing.
- **Efficiency:** refs are on-chain, verification is one click.

## 15. TRON-side DEX + deposits rails
- **Proof:** `trondex.cjs` (15.9 KB) + `trondex-live.json`; `deposits.cjs` (23.1 KB) + deposits-state/preflight — Task 117: real $1+ deposits mintable 1:1 for WETH/WSOL/WBTC (bookScale 1e9 nano).
- **Value:** the sovereign economy has ingress from outside value, not just internal minting.
- **Efficiency:** measured-locks-only minting (see capability 8).

## 16. The wallet layer that fronts it all (this repo)
- **Proof:** 7 live networks probed (7/7 ONLINE), 23/23 adapter checks on mainnet, Vault lifecycle init→unlock→sign→lock proven, live DEX on STEEM/SBD, bridge explorer with live-quoted fees, and the new **SAOS HUB** tab (chain core · grid98 · soldiers interactive · loop census · pools · wrapped · oracle · anchors · dex-facts — all from `/api/eco/saos-hub`).
- **Value:** one professional surface where the whole sovereign stack is visible and verifiable.
- **Efficiency:** zero-mock data policy end-to-end; keyboard 1–8; 390px-clean.

---

**Count: 16 proven capabilities.** Each one points at a live artifact; the honest gaps (no SAOS token schedule, ETH/SOL rail deployment, MEV, dust-scale soldier balances) live in `docs/saos-inventory.md` §9 and are deliberately not listed here.
