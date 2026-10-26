# packages/hsm-runtime — the production HSM signing runtime (owner directive §3)

**STATUS (2026-10-26, wave G77-d): DEPLOYED + MEASURED.** The runtime runs as the
mini-service `mini-services/hsm-runtime` (fixed port **3057**), deny-by-default,
zero plaintext key exposure. The wallet's public status label moves from
*"design-complete, runtime never deployed"* to **deployed signing runtime** — see
the repo README header for the measured evidence.

## What it is

The signing heart of Saosmartwallet: keys live sealed at rest, are unsealed ONLY
inside the sign call, and every signing event lands in a tamper-evident
SHA-256 hash-chain. The HTTP plane refuses everything that is not explicitly
allowed.

## Custody (outside the tree — NEVER in git)

| Secret | Location | Perms | Role |
|---|---|---|---|
| vault master key file | `/home/z/coord-work/vaults/saosmartwallet/master.key` | 0600 (dir 0700) | scrypt(N=2^14,r=8,p=1) → `SAOS_VAULT_MASTER_KEY` for the W49 vault store |
| runtime token | `/home/z/coord-work/vaults/saosmartwallet/runtime.env` (`HSM_RUNTIME_TOKEN=`) | 0600 | Bearer token for /status, /sign, /keys |

Missing / loose-perm / malformed custody files ⇒ **fail-closed boot refusal**
(no default master, no fallback, no degraded mode).

## Keyring (first-boot generation, sealed immediately)

- `hsm/secp256k1/primary` — 32-byte scalar (node:crypto entropy, range-checked
  against the SEC2 order), RFC6979 deterministic ECDSA over sha256(payload)
  via the in-tree `@noble/curves` primitive (same engine as `packages/crypto`).
- `hsm/ed25519/primary` — 32-byte seed, one-shot `crypto.sign` semantics via
  `packages/vault` (RFC 8410 PKCS#8).

At rest each key is an AES-256-GCM envelope (`ciphertext + iv + authTag + salt`)
in `state/keys.enc` — the **W49 vault package is reused verbatim** (verify block,
merge-on-disk-change, 0600 atomic writes, withKey zero-fill). Boot-time integrity:
every envelope is unsealed+zeroed once at boot; any tamper refuses the boot.

## HTTP API (deny-by-default)

| Route | Auth | Behavior |
|---|---|---|
| `GET /health` | none | `{"ok":true}` — bare liveness, zero operational data |
| `GET /status` | Bearer | counts only: version, bootedAt, keyCount, denyCount, audit-chain verdict |
| `POST /sign` | Bearer | `{keyId, payload}` → `{signature (hex), keyId, algorithm, fingerprint, payloadSha256, signedAt}` — **signature + fingerprints ONLY** |
| `GET /keys` | Bearer | fingerprints + PUBLIC keys only — never secrets, never envelopes |
| anything else | — | bare 404; wrong methods → 405 |

Auth law: **no token ⇒ 503 (fail-closed)** · wrong token ⇒ 401 (constant-time
comparison — sha256-normalized `timingSafeEqual`) · bad shape ⇒ 400 · unknown
key ⇒ 404. Auth denials are counted in memory (denyCount) and deliberately NOT
written to disk — an unauthenticated flood cannot fill the audit store.

## Audit (hash-chained JSONL)

`state/audit.jsonl` — `hash = sha256(prevHash + "|" + JSON.stringify(body))`,
genesis prevHash = sha256("saos/hsm-runtime/audit/v1"). Entries carry
fingerprints + payload DIGESTS only. `audit.verify()` detects ANY mutation
(rewrite-history attacks turn into a loud fail-closed verdict in /status).

## Deterministic HTLC verdicts (pure, tested)

`htlcVerdict()` — pure claim/refund/reject decision composing the W49 HTLC
primitives (constant-time `verifySecret`): terminal-state refusal
(double-claim/double-refund), `expired-terminal` past the refund deadline,
preimage verification inside the claim window, and the precedence law
**timeout > claim** (a late valid preimage cannot claim once the window closed).

## Tests

`bun test packages/hsm-runtime` — 38 tests / 147 expects, deterministic, zero
network, zero wall-clock (injected clocks everywhere). The no-secret-leak canary
sweeps responses, the audit trail, and error paths for material shapes.

## Run

```bash
cd mini-services/hsm-runtime && bun --hot index.ts   # fixed port 3057, 127.0.0.1
```

Boot commands + measured receipts: repo README header ("Deployed runtime" block).
