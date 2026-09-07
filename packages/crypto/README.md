# packages/crypto — Key Management & Signatures

**STATUS: SCAFFOLD — BLOCKED BY M0 GATE.** No implementation lives here yet, by design.

## Scope (what will be built once D1/D2 are confirmed)

1. **Seed & derivation**
   - BIP-39 mnemonic generation/validation (official test vectors mandatory)
   - Derivation paths: BIP-32/44 standard path **and** Steem-family
     master-password-style derivation as an alternative entry path — the exact
     set is a D2 decision (forks sometimes keep legacy derivation for account-key
     compatibility)
2. **Key encoding & roles**
   - Private-key WIF encoding/decoding
   - The four key roles (owner / active / posting / memo) with
     least-privilege defaults wired to the Policy Engine (`packages/core`)
3. **Signatures**
   - secp256k1 ECDSA signing and verification
   - Canonical serialization of transactions per the D2 chain's rules
     (serialization mismatches are the #1 source of "signature invalid" bugs —
     it gets byte-level golden tests before anything else ships)

## Hard quality rules (non-negotiable)

- **No hand-rolled cryptography.** Primitives come from audited libraries;
  this package composes and serializes, it does not invent math.
- **Test vectors first.** Every primitive ships with official test vectors
  (BIP-39, secp256k1, and the target chain's own fixtures) before any feature
  uses it. A primitive without vectors is treated as broken.
- **Zero secret logging.** CI greps for secret-shaped output; failures block merge.
- **Fail closed.** Any parse/derive error aborts the flow; nothing "best-effort".

## Entry criteria (M0 gate — all must be true)

- [ ] D2 confirmed: chain name, token symbol, chain id, key-derivation scheme
- [ ] D1 confirmed: endpoint(s) for integration tests
- [ ] `tools/chain-health-check.ts` reports `healthy` against the D1 endpoint
- [ ] Target chain's serialization spec (source code or canonical docs) in hand —
      assumptions alone do not unblock this package

## ASSUMPTION marker

Steem-family semantics above (roles, WIF, secp256k1) are an **ASSUMPTION**
inherited from `wallet-design/network-analysis.md`, marked until D2 confirms them.
