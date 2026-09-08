# Strategy Roadmap — From Verified Technology to Monetizable Product

Generated: 2026-09-08 · grounded in live `/api/system/health` + `docs/system-status.json` (all claims re-verified the same day) · git `1ef5477`

**Principle: zero-mock applies to strategy too.** Every readiness claim below points at live evidence. What is not built is named as not built. Revenue figures from market research are labeled as market context, never as projections of this project.

---

## 1. Verified asset base (measured, not claimed)

| Layer | What exists | Live evidence |
|-------|-------------|---------------|
| M0 — Serialization engine | bit-exact Steem binary serialization, 30/30 oracle vectors | tools/m0 oracle suite (30/30 PASS) |
| M1 — Live DEX | order book + trade terminal on STEEM/SBD internal market | `/api/steem/orderbook` — 19 bids / 50 asks, spread 0.154%, head 109,386,112 |
| M2 — Sovereign Key Vault | 6 layers: hierarchy (7 networks / 13 soldiers / 4 purposes), crypto engine (Argon2id + AES-256-GCM + Shamir + Schnorr), fail-closed policy engine, signing orchestrator, backup/social-recovery/dead-man, tamper-evident audit chain | full lifecycle proven: init → unlock → sign (policy PASS, crypto-verified signature recovery) → lock → audit 8/8 intact; audit PDF serves valid %PDF |
| M3 — Multi-chain adapters | 7 adapters on the frozen ChainAdapter seam | `tools/m3-adapter-check.ts` → **23/23 PASS** against mainnet (re-run today: ETH head 25,929,209 · vitalk 6.71215 ETH · USDT 290.36 · SOL epoch 1030 · ed25519 verify · broadcast fail-closed ×2) |
| M3 — Bridge layer | router + monitor, 6 rails, anti-mock fee-source fields | 2 LIVE (relay-steem cp#54804 with txid evidence · bridge-tron zero-fee ring) + 4 GATED with explicit gate reasons |
| M4 — System Owner infra | unified health endpoint, proven RPC failover, autonomous repo scan | `/api/system/health` → 7/7 networks, 0 critical issues; failover live-proven (dead endpoint → REACHABLE via fallback) |
| Docs & honesty layer | threat model, vault guide, live system-status reports, repo scan | `docs/security.md`, `docs/vault.md`, `docs/system-status.{json,md}`, `docs/repo-scan.json` |

**Honest current-state summary:** verified working multi-chain technology with military-grade custody architecture, running in a dev sandbox, pre-audit, pre-users, pre-revenue. Hot-key custody inside the sandbox is a documented residual risk (`docs/security.md`), not a solved problem.

---

## 2. The 7 business models — readiness matrix

| # | Model | Verified foundation | Blocking gates (honest) | First-revenue path | Readiness today |
|---|-------|--------------------|--------------------------|--------------------|-----------------|
| 1 | Sovereign Wallet as a Service (B2B SaaS) | Vault 6 layers, 7 networks, policy engine, audit chain — all live | No onboarding flow, no tx history, no multi-tenancy, no hosting, no billing; sandbox ≠ production | Pilot with 1 crypto fund on hosted vault | **Architecture proven, product absent** — needs Phase-1 build |
| 2 | Bridge Fee Aggregator | Router/monitor live, 2 live rails, live quotes with fee sources | **ETH bridge contract not deployed, Solana program not deployed** (BRIDGE_ABI + program IDs staged); zero volume; 4 rails gated | Deploy contracts → open 2 gated rails → route volume | **Layer built, rails incomplete** — the single biggest unlock is contract deployment |
| 3 | Multi-Chain DEX Aggregator | Live DEX on 1 chain (STEEM/SBD) with real signing | No Uniswap/Raydium/router integrations; 1/7 chains tradeable | Add EVM DEX router adapters → aggregate 2 chains → grow | **1/7 chains** — deepest build of the seven |
| 4 | Validator Infrastructure (SAOS-NET) | SAOS-NET live (head 54,825, daemon-pushed, state-age surfaced honestly) | Validator node operation + staking module not built; SAOS-NET is a shadow chain — economics depend on the sovereign chain's own token economy | Run validator → staking-as-a-service | **Chain exists, operator role not built** |
| 5 | White-Label Licensing | Complete M0–M4 codebase + docs + 7 networks + vault | No packaging, no brand separation, no license terms, no support org | License the codebase as-is to 1 startup (source-available) | **Closest to monetizable now** — code and docs already exist |
| 6 | Security Auditing Service | 30/30 oracle-verified serializer, fail-closed patterns everywhere, published threat model, tamper-evident audit chain | No third-party credibility (our own code is unaudited); no engagement history | Publish the M0 oracle methodology + security docs → attract first paid review | **Demonstrable expertise, zero credibility yet** — audit-us-first is the honest path |
| 7 | Institutional Custody (highest ceiling) | Vault multi-sig (3-of-5 guardians), Shamir shards, policy engine, regulatory-friendly audit chain | SOC 2 / ISO certification absent, no insurance, no cold-storage production, no legal entity, no compliance officer | Design-partner pilot with 1 family office | **Furthest away, highest value** — gated on certification + trust, not code |

---

## 3. Reality corrections to the strategic analysis

The source analysis mixes verified fact with speculative valuation. For the record:

1. **"Total current value $10-30M" — not substantiated.** Honest framing: the asset today is verified working technology + documentation, **pre-revenue, pre-user, pre-audit**. Comparable-company valuations apply to products with traction; this is a strong technical foundation with zero commercial validation. Any valuation conversation starts after: external audit + first pilot customer.
2. **Revenue tables ($2-50M/yr)** are market-scale math for the categories, not projections for this project. They describe the ceiling if execution + distribution materialize — they are not forecasts.
3. **"23/23 adapter checks", "2 live rails", "7/7 networks" — verified true**, re-measured today (see §1). The analysis's technical claims are the accurate part; its financial claims are the speculative part.
4. **The vault is initialized=false in delivery state.** The lifecycle (init→unlock→sign→lock) is proven, but a customer-facing deployment needs the key-custody decision made (hot sandbox today vs. HSM/cold production).

---

## 4. Recommended path: Bootstrap + Open-Core (Option 1 with Option 3 elements)

Of the four options (build a company / sell IP / open source / self-use), the verified evidence favors a **bootstrap with open-core structure**:

- **Bootstrap** (no funding): every remaining Phase-1 item except bridge deployment is pure code — buildable now at $0.
- **Open-core**: open-source the adapter + serialization layer (`packages/chains`, M0 engine — the oracle-verified parts that build developer credibility), keep the Vault/custody core source-available commercial. Oracle-verified code is the best possible marketing for models 5 and 6 (licensing + audits).
- **Not IP-sale now**: pre-audit, pre-traction IP sells at the bottom of its range. Sell later or build — do not sell the foundation at its weakest negotiating point.

### Build order (each step unlocks the next)

| Step | What | Cost | Unlocks | Who decides |
|------|------|------|---------|-------------|
| 1. **M5: Wallet MVP** — onboarding (create/import), tx history, notifications, ETH/SOL tracking hardening | $0 (code only) | Model 1 demo-able, Model 5 demo material | System Owner (autonomous — no funds at risk) |
| 2. **Bridge contract deployment** (Ethereum contract + Solana program on mainnet) | ~$50-100K dev + real gas + deployed-key custody policy | Models 2 + 7 rails; converts 4 gated rails → live | **Owner decision — real money, real keys, explicit approval required** |
| 3. **External security audit** (Trail of Bits / OpenZeppelin tier on vault + serializer) | ~$100-300K | Model 6 credibility, Model 1/7 sales precondition | Owner decision (budget) |
| 4. **First pilot** (1 fund or family office on the vault, hosted) | sales effort | First revenue + testimonial for Models 1/7 | Owner decision |
| 5. Open-core release of chains layer + community build-out | $0-50K | Developer ecosystem → Models 5/6 pipeline | Owner decision (strategy) |

**Why this order:** steps that cost $0 and carry no key-custody risk proceed autonomously (Step 1). Steps that put real money or real keys on mainnet (Steps 2-4) are owner decisions — the system's own fail-closed philosophy applied to its business: capability exists, broadcast stays gated until explicitly authorized.

---

## 5. Decision points for the owner

1. **Company vs. project?** If yes → Step 1 immediately, Steps 2-4 sequenced with funding.
2. **When to open-source?** Recommended: after Step 1 (MVP demo exists) — release from strength.
3. **Bridge deployment appetite?** This is the one gate that requires real money + custody decisions. Everything else can bootstrap.
4. **SAOS-NET economics** (Model 4) depend on the sovereign chain's token economy — needs owner input on chain roadmap before any validator build.

---

*Every technical claim in this document is backed by a re-run live check the same day. Every gap is stated as a gap. Nothing here is fabricated, and nothing speculative is presented as fact.*
