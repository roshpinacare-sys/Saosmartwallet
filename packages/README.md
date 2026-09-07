# packages/ — Saosmartwallet Monorepo Core

**STATUS: SCAFFOLD ONLY — implementation is gated behind the M0 gate.**

The M0 gate is defined in [`wallet-design/final-proposal.md`](../wallet-design/final-proposal.md)
(Decision Points **D1–D5**). No signing, key-derivation, or broadcast code is written
until the project owner confirms at minimum:

| Decision | Question | Status |
|----------|----------|--------|
| **D1** | RPC endpoint(s) to develop and test against | **OPEN** |
| **D2** | Exact target chain (network name, token symbol, chain id) | **OPEN** |

## Layout

```
packages/
  crypto/          Key derivation, WIF, secp256k1 — BLOCKED by M0 gate (see README)
  core/            Keystore (AES-256-GCM), Policy Engine, wallet state — BLOCKED by M0 gate (see README)
  chains/          Network adapters. chain-adapter.ts = frozen interface seam (no implementation)
```

Dependency rule (from `wallet-design/wallet-architecture.md`):
`apps → core → crypto` and `apps → chains`. **`core` never imports `chains`** —
the adapter is injected, which is what keeps the core network-agnostic.

## What is already usable today (no D1/D2 needed)

The only runnable artifact is the read-only health-check tool:

```bash
bun tools/chain-health-check.ts --rpc https://api.steemit.com [--account <name>] [--json]
```

It probes reachability, API namespaces, chain id, head block, sync lag, and
Resource Credits. It sends **no keys and no secrets**. Its output is exactly the
evidence needed to close D1/D2 with facts instead of guesses.

## ASSUMPTION marker

Everything in this tree that references Steem-family mechanics (three-token
model, four key roles, RC) is marked as an **ASSUMPTION** inherited from the
network analysis (`wallet-design/network-analysis.md`). The assumption stays
marked until D2 confirms or replaces it.
