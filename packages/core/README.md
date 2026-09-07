# packages/core — Keystore, Policy Engine, Wallet State

**STATUS: SCAFFOLD — BLOCKED BY M0 GATE.** No implementation lives here yet, by design.

## Scope (what will be built once D1/D2 are confirmed)

1. **Local keystore — AES-256-GCM**
   - Envelope: `ciphertext ‖ iv ‖ authTag`, key from a password-derived KDF
     (Argon2id preferred; final choice documented with parameters at M0)
   - The keystore file format is versioned (`v: 1`) with an explicit upgrade path —
     a wallet that cannot migrate its own storage strands its users
   - Decrypted keys live in memory only for the lifetime of an operation
2. **Policy Engine — the enforcement point for Aurora Modes**
   - Implements the hierarchical permission model from
     [`wallet-design/breakthrough-ideas.md`](../wallet-design/breakthrough-ideas.md)
     (Aurora Modes, scored 25/25 — top-ranked core feature)
   - Every signing request passes through policy: role required, per-operation
     limits, quorum rules for high-value operations. **Fail closed.**
   - Policy decisions are auditable events (append-only, local)
3. **Wallet state**
   - Account list, active mode, transaction history cache
   - Emits no state to the network; the adapter (injected, never imported) is
     the only network boundary

## Hard quality rules (non-negotiable)

- **Keys never leave the client.** This package must remain usable with zero
  network access; a CI check enforces that `packages/core` imports nothing from
  `packages/chains`.
- **Fail closed** in every policy branch; denials carry a machine-readable reason.
- **No secret ever reaches logs, errors, or telemetry** — same CI grep gate as crypto.

## Entry criteria (M0 gate — all must be true)

- [ ] D2 confirmed (policy vocabulary references real operation types)
- [ ] Keystore file format spec written and reviewed **before** first implementation
- [ ] Threat model section of `wallet-design/wallet-architecture.md` re-checked
      against the final format

## ASSUMPTION marker

References to Aurora Modes and Steem-family operation types are an
**ASSUMPTION** inherited from the wallet-design documents, marked until D2 confirms.
