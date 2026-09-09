# R-56 — DEX Game-Changer Features Research (research-only, no code)
> 8 search batches (~30 queries) via z-ai-web-dev-sdk web_search. Raw results: batch1..8.txt.
> Sources consulted: Uniswap docs/blog, Osmosis docs (ProtoRev, superfluid), Balancer V3/V1 docs (LBP), pump.fun docs, Raydium docs (LaunchLab/bonding curves), Jupiter docs (DCA), GMX docs, CoW Protocol docs, UniswapX/1inch Fusion deep-dives, CoinGecko methodology (MAD + Trust Score), dYdX v4 architecture, Hyperliquid (HyperCore/HyperEVM/builder codes), Bunni am-AMM (arXiv 2403.03367), TWAP-manipulation literature (eprint.iacr.org 2022), Beefy, ICHI, Maverick, Pendle, KyberSwap, Camelot, Trader Joe Liquidity Book.

## Context absorbed from worklog (Tasks 54-55)
Already live: AMM x*y=k, LP, multi-leg router + split-routing, limit orders (autonomous arena), EWMA dynamic fees 4–1500bps, veSAOS+gauges+epoch flips, revenue router 40/40/20, bonds (3% disc, 12w lock), ALE (POL seeding every 100 blocks from real revenue), STEEM/HIVE consensus anchoring with real txids, live reserve quotes, /api/dex/compare.

## TOP 8 RANKED FEATURES

### #1 — Kernel TWAP Oracle (geometric-mean accumulator) — originated: Uniswap V3
- How: each pool keeps a monotonic accumulator of (price-derived tick × blocks-elapsed) and a ring of observations; TWAP between two heights = (accP₂−accP₁)/Δh. Manipulation requires paying fees+spread across many consecutive blocks — cost grows with attack duration (eprint 2022: resistance scales with observation window).
- Why our kernel: pure function of height and of already-deterministic fills; zero external oracle; each observation is merkle-sealable → provable, replayable price history. It becomes the canonical price input for bonds, ALE, triggers, DCA and the Price-Seal (#3).
- Sketch: `pool.twap = { accP: bigint(fixed-µ), lastH, obsRing[4096] }`; internal `_twapTouch(pool)` after every fill in `buildBlock`; public op/GET `twap_read(poolId, fromH, toH)`; wire into bond pricing + ALE targets + PRO chart reference line.
- Impact: **price-credibility HIGH** — the foundation everything else consumes.

### #2 — ProtoRev: in-kernel arbitrage recapture — originated: Osmosis
- How: at end of each block a module scans cyclic routes across pools; if any cycle is profitable ≥ fee floor it executes it, keeping the spread for the protocol instead of external MEV bots; revenue feeds the ecosystem (Osmosis burns/funds; we route into the existing 40/40/20 router + ALE).
- Why our kernel: on Ethereum this needs competitive searcher bots; in our block builder it is just a deterministic end-of-block graph walk (we already own `walkRoutes` from the router) — nobody can front-run inside our own kernel. Structural zero-MEV becomes literal.
- Sketch: `state.protorev = { executed, profitIn, lastH, log[] }`; `_protorevTick()` appended in `buildBlock` after user fills; per-block profit cap; profits tagged on the tape and injected into the existing revenueCycle.
- Impact: **price-parity HIGH, liquidity HIGH** (new real revenue → burn/ve/ALE flywheel).

### #3 — Price-Credibility Seal (MAD cross-venue verification) — originated: CoinGecko methodology (MAD + Trust Score) × our STEEM/HIVE anchoring
- How: every epoch, compare our canonical TWAP price vs external public API prices (CoinGecko/CMC) and vs anchor-chain-implied prices; reject outliers via Median Absolute Deviation; publish deviation-bps + 1% book depth (from reserves) as a sealed on-chain record with a VERIFIED/DIVERGENT verdict and a UI badge.
- Why our kernel: MAD is pure math → fully replayable; external feeds enter exactly like the existing `readSteemHead` real-data pattern (fail-honest); each epoch's verdict is merkle-sealed, so *anyone* can verify our price is real without trusting us. No other DEX combines deterministic sealing + real STEEM/HIVE txid anchors — this is the "our price is REAL" proof surface.
- Sketch: `state.priceSeal = { epoch, twapPx, extPx, madBps, devBps, depth1pct, verdict }`; `_priceSealTick()` on epoch flip (1200 blocks); `/api/dex/price-seal` GET; badge in swap/pro/economy views; history table for audits.
- Impact: **credibility HIGH** — the single most differentiating feature; it answers "how do we know SAOS price is real?" with a proof, not a promise.

### #4 — Bonding-Curve Launchpad with auto-graduation — originated: pump.fun / Raydium LaunchLab
- How: new tokens launch on a closed-form curve (price = f(supply) over virtual reserves, no pre-seeded pool); buying pushes reserves up the curve; at a liquidity threshold the token "graduates" automatically into a real AMM pool (LP seeded, curve closed/burned) with no manual migration step.
- Why our kernel: the curve is deterministic pricing at its purest; graduation is a height/threshold op in `buildBlock`; virtual reserves are plain state; our arena bots can supply honest flow during the curve phase.
- Sketch: `state.launches = { id, curve{virtualIn,virtualOut,slope}, resIn, resOut, graduated }`; ops `launch_create/launch_buy/launch_sell`; in `buildBlock`: `resIn ≥ GRAD_TARGET → _migrateToPool()` (existing pool_open + LP to treasury/ALE, curve sealed).
- Impact: **liquidity HIGH** (bootstraps whole new markets with zero user-side seeding); credibility MED (depends on #1 after graduation).

### #5 — Keeperless Trigger Orders: Stop-Loss / Take-Profit / Bracket — pattern: GMX TP/SL, learned from CoW/Definitive
- How: user attaches a trigger price (+ optional limit) to an order; the kernel evaluates the trigger every block against the canonical price; on trigger it becomes a marketable limit in the arena. GMX needs off-chain keepers listening to oracles — we don't.
- Why our kernel: the block builder IS the keeper; trigger evaluation is a pure per-height comparison, deterministic on replay, keeper-fee = 0, keeper-trust = ∅. CEX-grade order types no AMM chain can match without trusting third parties.
- Sketch: extend orders: `{ trigger: 'stop'|'take'|'stopLimit', triggerPx, limitPx, expiresH }`; in `buildBlock` after `_twapTouch`, deterministic scan (by id) of crossed triggers → route into existing fill path with minOut guard; keep partial-arena semantics.
- Impact: **trust/liquidity MED-HIGH** — retail risk management parity with CEXs, provably keeperless.

### #6 — DCA & TWAP-Execution Programs — originated: Jupiter (DCA), Brink (intent DCA)
- How: deposit the full input once; the program slices it into N suborders executed every K blocks through the router (DCA = disciplined accumulation; TWAP-exec = large orders that don't move the market). Programmatic steady flow also stabilizes our own price.
- Why our kernel: `height % K == 0` is the canonical trigger; suborders reuse `walkRoutes` + slippage guard; no cron, no keeper, perfect replay. Our arena bots + fees make program execution free of MEV.
- Sketch: `state.dca = { id, owner, inTok, outTok, remaining, sliceIn, everyK, executed, minOutBps }`; ops `dca_create/dca_cancel`; `_dcaTick()` in `buildBlock`; UI panel in PRO ("הזמנות-עקביות").
- Impact: **flow MED-HIGH**, price-stability MED.

### #7 — Per-Block Batch Auctions with Uniform Clearing Price — originated: CoW Protocol (+ UniswapX Dutch auctions as fallback)
- How: collect all taker intents in one block into a batch; first net opposite sides against each other (coincidence-of-wants at zero pool impact), fill the remainder against pools at ONE uniform clearing price per pair; every participant in the batch gets the same price → sandwiching structurally impossible.
- Why our kernel: batch boundary = block boundary by definition; the clearing price is a deterministic solve; the batch root seals into the block header. External DEXes need off-chain solvers and trust assumptions — our kernel does it natively, and our arena provides the standing counterparty.
- Sketch: `state.batch = { h, intents[], clearingPx[], cowMatches[] }`; `_clearBatch()` at block start (feature-flag per pool, gradual rollout); seal `batchRoot`; keep current continuous fill path as fallback.
- Impact: **fairness/MEV HIGH**, credibility MED-HIGH; engine rework MED (biggest lift on the list).

### #8 — LBP Dynamic-Weight Launch Pool — originated: Balancer/Gnosis LBP (popularized by Fjord Foundry)
- How: pool opens 96/4 weighted; weights decay linearly to e.g. 40/60 over H blocks, exerting constant downward price pressure (a continuous Dutch auction) that only genuine demand counters — fair price discovery with tiny starting capital and no snipers.
- Why our kernel: weight is a pure function of height, `w(h) = w0 + (w1−w0)(h−h0)/(h1−h0)`; every block re-derives the price deterministically; zero oracles; completion → auto-migrate to a normal 50/50 pool. Perfect complement to #4 (curve for memecoins, LBP for serious launches).
- Sketch: pool `type:'lbp' { w0, w1, h0, h1 }`; `_lbpReweight(pool, h)` in `buildBlock`; weighted quote `x^w·y^(1−w)=k` (small extension of the AMM math); auto-migration at `h1`.
- Impact: **liquidity MED** (per new-pool launch), open-price fairness MED.

## Honorable mentions (not in TOP 8)
- **Superfluid veLP** (Osmosis): LP positions simultaneously earn gauge yield + count toward ve voting power — cheap retention boost, kernel is pure bookkeeping. Strong candidate for the iteration after.
- **Auto-compounding + one-click zap** (Beefy/Zapper): interval harvest-and-re-add LP op; zap = swap-half→add-LP atomically. UX-level, easy, kernel-friendly.
- **am-AMM rent auction** (Bunni/arXiv): per-epoch on-chain auction; winner becomes pool manager, sets fees, pays guaranteed rent to LPs. Bleeding-edge; our arena bots are natural bidders; high differentiation, higher complexity.
- **Builder codes** (Hyperliquid): fee-share tags for frontend builders — growth primitive, trivial fee-routing op.
- **Pendle PT/YT**: splitting WSTEEM/ve yield into principal+yield tokens — powerful but heavy; revisit after #1–#3.

## Deliberately NOT picked
Perps (GMX/dYdX/Hyperliquid full), options (Thales/Lyra) — need external risk/vol oracles, anti-kernel; dYdX-style orderbook migration — our arena already covers it; V4 hooks as a "feature" — our kernel ops are already the hook surface; Kyber/Camelot/Trader Joe specifics — incremental over what we run.

## Suggested sequencing (if orchestrator proceeds)
Phase A (credibility): #1 TWAP → #3 Price-Seal → #2 ProtoRev.
Phase B (autonomy/flow): #5 triggers → #6 DCA → #4 launchpad.
Phase C (market design): #8 LBP → #7 batch auctions.
