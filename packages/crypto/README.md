# packages/crypto — Key Management & Signatures

**STATUS: M0 IMPLEMENTED & CHAIN-VERIFIED** (2026-09-07).
`PrivateKey` / `PublicKey` / recoverable signatures, WIF + "STM" encodings,
password & brain-key derivations — all verified against live-chain evidence:
real on-chain signatures recover to their on-chain authority keys, and the
"STM" checksum convention was decoded directly from a live key string
(`ripemd160(pub33)[0:4]`, not the sha256-wrapped variant).

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

## Entry criteria (M0 gate) — ALL SATISFIED ✅

- [x] D2 confirmed: **Steem Protocol** (owner-approved 2026-09-07)
- [x] D1 confirmed for development: `https://api.steemit.com` (health-checked)
- [x] `tools/chain-health-check.ts` reports `healthy` against the D1 endpoint
- [x] Serialization format captured from live-chain canonical bytes
      (`condenser_api.get_transaction_hex`) — see `packages/chains/steem/README.md`
- [x] Validation: `bun tools/serialize-test.ts` → 30/30 PASS (bit-identical
      serialization, digest anchors, authority recovery, tamper rejection)

## ASSUMPTION marker — status

Steem-family semantics (roles, WIF, secp256k1) were **confirmed by live-chain
evidence** during M0 and are no longer assumptions. Two conventions worth
knowing: the public-key string checksum is plain `ripemd160(pub)[0:4]`, while
WIF uses double-SHA256 — both verified from chain data.
