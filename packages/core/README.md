# packages/core — Sovereign Key Vault (M2 — SHIPPED)

**STATUS: LIVE.** Six security layers, verified end-to-end: crypto engine, vault
hierarchy, policy engine, signing orchestrator, backup/recovery, hash-chained audit.
The DEX terminal signs through this package — the M1 "SIGNING LOCKED" gate is gone.

## The six layers

| # | Layer | Files | What it guarantees |
|---|-------|-------|--------------------|
| 1 | **Vault Hierarchy** | `vault/` | master (ed25519, 3-of-5 guardians) + 5 network vaults + 13 soldier vaults + 4 purpose vaults; state machine `locked ↔ unlocked` with volatile-key auto-lock |
| 2 | **Crypto Engine** | `crypto/` | Argon2id (64 MiB / t=3 / p=1), AES-256-GCM + ChaCha20-Poly1305 envelopes, Shamir SSS over GF(256), Fiat–Shamir Schnorr ZK proofs |
| 3 | **Policy Engine** | `policy/` | 6 compiled-in static rules + dynamic/contextual/composite rule sets + 6 anomaly detectors — every signature passes, **fail closed** |
| 4 | **Signing Orchestrator** | `signing/` | `sign` / `multiSign` / `batchSign` / `crossChainSign` / `simulate` — reveal-once key handling, capability-checked broadcast |
| 5 | **Backup & Recovery** | `backup/` | password-sealed packages, Shamir-sharded (shards alone restore), social recovery, dead-man switch, air-gapped QR frames |
| 6 | **Audit & Compliance** | `audit/` | hash-chained events (`eventHash = SHA-256(prev ‖ event)`), tamper detection with `firstBadSeq`, json/csv/pdf reports |

## Security invariants (enforced by construction)

1. **Plaintext keys never persist.** `EncryptedKey.payload` only; the derived
   master key lives in volatile memory, is zero-filled on `lock()`, and never
   appears in errors, logs or responses.
2. **Every signature is policy-gated.** `SigningOrchestrator.sign` runs the full
   pipeline — session gate → policy evaluate → key reveal → adapter sign →
   capability-checked broadcast — and records a `signing_attempt` audit event
   whatever the outcome (including failures).
3. **Fail closed everywhere.** Missing adapter, missing key, offline network,
   unsatisfied step-up, tampered package, wrong credential class — all throw
   typed `VaultError`s; nothing degrades into "allow".
4. **The audit chain is append-only and tamper-evident.** Each event binds its
   predecessor's hash; `verifyIntegrity()` walks the chain and reports the first
   corrupted sequence.
5. **Zero knowledge where it matters.** Password knowledge can be proven
   (`zk.ts`) against a stored curve commitment without exposing anything
   brute-forceable; verification is anchored to the enrollment commitment.
6. **Honest amounts.** Satoshi decimal strings end-to-end; `simulate()` reports
   `"0"` fees for Steem (which has none) rather than inventing numbers.

## Persistence seam

`storage/types.ts` defines `VaultStorage` + `AuditStore`. The app layer
(`src/lib/vault-stores.ts`) binds them to Prisma/SQLite (the state document is
secret-free by construction — sealed key envelopes only); `storage/memory-store.ts`
serves tools and chaos tests. The package itself never imports the app.

## Verified (this repo, this milestone)

- Cipher roundtrips both algorithms + tamper detection
- Shamir subsets (t-of-n, non-prefix) reconstruct exactly
- Argon2id verifier accept/reject (timing-safe)
- ZK accept + three reject paths (wrong password / wrong context / tampered z)
- Vault lifecycle: init → 5N/13S/4P hierarchy → unlock → lock → persistence
- Backup: password-only restore, shards-only restore (2-of-3 subset), tampered
  signature + wrong credential class rejected, social recovery full flow
- Signing: signature over the real tx digest recovers the sealed key's public
  key (`recoverFromCompact` check) — proven live through the HTTP API
- Audit: chain of events verifies; UI + API both expose integrity status
