# Security — Sovereign Key Vault Threat Model (M2)

## Assets under protection

1. **Private key material** (Steem owner/active/posting/memo WIFs) — sealed as
   `EncryptedKey` envelopes inside the vault state document.
2. **The master password** — exists only in flight (request body) and in the
   KDF; what persists is an Argon2id verifier, never the secret.
3. **The vault state document** — hierarchy, policies, sealed envelopes,
   backup metadata. Secret-free by construction; the danger is tampering, not
   disclosure.
4. **The audit chain** — its value is integrity; a forged history must be
   detectable.

## Adversaries and controls

| Threat | Vector | Control | Where |
|--------|--------|---------|-------|
| DB theft / state exfiltration | direct SQLite access | keys sealed AES-256-GCM / ChaCha20-Poly1305 under an Argon2id-derived key (64 MiB, t=3 — ~1s per guess); no plaintext secrets in the doc | crypto/cipher.ts, crypto/kdf.ts |
| Brute-force the password | offline guessing of the verifier | Argon2id memory-hard KDF; ~1s/attempt at pinned params | crypto/kdf.ts |
| Memory scraping while unlocked | process dump | derived key held in a single volatile field, zero-filled on `lock()` and on auto-lock (default 300s idle); wiped before any error path touches it | vault/vault.ts |
| Signing with the wrong authority | posting key on a transfer | compiled-in static rules (`no-transfer-with-posting-key`, `memo-key-cannot-sign`) + the adapter's own funds-op role check — two independent gates | policy/defaults.ts, chains/steem/adapter.ts |
| Runaway / malicious spend | anomalous operations | daily ceilings per symbol, approval requirements, rate limits, new-counterparty cooldown, anomaly scoring (frequency/amount/counterparty/hour/rapid-fire/failed-history) | policy/engine.ts |
| Unauthorized broadcast | direct adapter misuse | the broadcast-capable `SteemAdapter` exists ONLY inside the vault runtime; broadcast fires exclusively after the policy gate + explicit user intent (`broadcast: true` + step-up password) | lib/vault-runtime.ts, signing/orchestrator.ts |
| History forgery | tampered audit rows | hash chain: `eventHash = SHA-256(prevHash ‖ canonicalEvent)`; `verifyIntegrity()` reports the first corrupted seq; mismatches are never repaired | audit/audit.ts |
| Forged backup package | malicious .vault file | HMAC-SHA256 over the canonical package + inner checksum, timing-safe compares; restore refuses non-fresh targets | backup/backup.ts |
| Password loss | forgotten master password | Shamir-sharded backup (shards alone restore the state — no password) and social recovery (recovery key split among contacts) | backup/backup.ts |
| Owner incapacitation | dead-man scenario | dead-man switch: heartbeat on unlock/sign; beneficiaries + inactivity window persisted and surfaced overdue in the UI | backup/backup.ts |
| Proof phishing | "prove you know the password" replay | ZK Schnorr proofs anchored to the enrollment commitment; transcripts are context-bound; wrong password/context/tampered z all fail | crypto/zk.ts |

## Residual risks (honest)

- **Hot-server key custody.** While unlocked, key material lives in server
  memory of the sandbox. Hardware-backed or air-gapped signing is the next
  hardening step (tracked in the REGISTRY gaps).
- **Local gateway trust.** Passwords travel in request bodies over the local
  gateway; transport hardening beyond the sandbox boundary is out of scope
  here.
- **No 2FA/biometrics yet.** The step-up is a password re-entry (Argon2id
  verified) — the policy engine's `step_up_auth` requirement is wired but the
  biometric factor is a future layer.

## Incident playbook

1. `GET /api/vault/audit?verify=1` — is the chain intact? `firstBadSeq` localizes tampering.
2. `POST /api/vault/lock` — kill the session immediately.
3. If key compromise is suspected: revoke (`DELETE /api/vault/keys`) the affected keys, rotate authorities on-chain, restore from a clean sharded backup into fresh storage.
4. Generate a compliance report (`?report=json|csv|pdf`) for forensics — it binds the chain head hash at generation time.
