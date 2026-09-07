# Vault — User Guide (Sovereign Key Vault, M2)

The **VAULT** tab (keyboard shortcut **7**) is the command center for the
keystore. The same status widget also appears at the top of the **WALLET** tab.

## First run — the 6-step wizard

Press **SETUP WIZARD** (or **INITIALIZE VAULT** in the status panel):

1. **Welcome** — what the vault protects.
2. **Master password** — live strength meter (12+ chars, upper/lower, numbers,
   special, not-common). This password derives the Argon2id master key — there
   is **no reset** without a backup or recovery shares.
3. **Recovery options** — pick at least one: encrypted backup file / recovery
   phrase info / social recovery / air-gapped QR. You generate the actual
   artifacts right after setup in **BACKUP & RECOVERY**.
4. **Network vaults** — STEEM / HIVE / TRON / BLURT (offline) / SAOS-NET with
   their roles, operations and daily ceilings.
5. **Soldiers** — the 13-soldier fleet; first 5 are traders; transfer disabled.
6. **Complete** — the server derives the master key (~1–2s, Argon2id) and the
   security score appears with honest recommendations.

## Daily operation

- **Unlock** — type the master password in the status widget. The session
  auto-locks after **300s** idle (live countdown while unlocked). **LOCK**
  kills it immediately.
- **Seal a key** — KEY MANAGER → network `steem` → mode *derive from master
  password* → account + the account's master password → roles (ACTIVE for
  trading) → **SEAL KEY**. The WIF is encrypted (AES-256-GCM) before it ever
  touches storage; only the STM public key is shown.
- **Sign on the DEX** — build an order in the trading terminal → **SIGN WITH
  VAULT** in the preview dialog → step-up password → **SIGN WITH PASSWORD**.
  The dialog walks the pipeline (policy → built → digest → signing →
  broadcast) and shows the policy verdict line-by-line. Leave *broadcast after
  signing* OFF to get a signed-only envelope you can relay yourself.
- **Simulation** — [SIMULATE] runs the operation without signing: balance
  legs, risks, RC estimate, policy decision.

## Policy engine

**POLICY ENGINE** shows the compiled-in rules (cannot be disabled) and the
live rule sets:

- *Dynamic* — amount thresholds (approve large transfers), operation denials,
  step-up requirements.
- *Contextual* — hourly rate limits, new-counterparty cooldown, time windows.
- *Composite* — combinations (any/all) of the above.

When a rule blocks a signature, the signing dialog shows a red **Policy
Violation** panel with the exact failed checks and the risk level — that event
lands in the audit chain as `policy_violation`.

## Backup & recovery

- **Backup** — password + optional Shamir sharding (e.g. 2-of-3). Download the
  `.vault` package. With sharding, each share is displayed for distribution —
  **any `threshold` shares restore the vault without the password**; without
  sharding, the password alone restores it.
- **Air-gapped QR** — render the package as `SAOSVAULT` QR frames; print them,
  never screenshot.
- **Social recovery** — register contacts + threshold; the recovery key that
  seals your state is split among them. Keep the downloaded `.recovery`
  package with your backup — recovery needs `threshold` shares **and** that
  package, then sets a NEW password on restore.
- **Dead-man switch** — inactivity window + beneficiaries; the heartbeat
  updates on every unlock/sign, and the vault flags itself overdue.

## Audit chain

Every operation — vault creation, unlocks, key seals, signing attempts
(including failures), broadcasts, policy violations, backups — is appended to
a **hash chain** (`eventHash = SHA-256(prev ‖ event)`).

- **VERIFY** walks the chain and reports integrity (first bad sequence if any).
- **JSON / CSV / PDF** export compliance reports bound to the chain head hash.

## REST surface (for scripts)

`GET /api/vault/status` · `POST /api/vault/init|unlock|lock` ·
`GET|POST|DELETE /api/vault/keys` · `POST /api/vault/networks|soldiers` ·
`GET|PUT /api/vault/policy` · `POST /api/vault/simulate|sign` ·
`POST|PUT /api/vault/backup` · `POST|PUT /api/vault/social-recovery` ·
`PUT /api/vault/deadman` · `GET /api/vault/audit[?verify=1|?report=pdf]`

Full request/response shapes: [`src/lib/vault-contracts.ts`](../src/lib/vault-contracts.ts).
Threat model: [`docs/security.md`](./security.md).
