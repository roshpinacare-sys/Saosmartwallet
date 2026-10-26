# packages/hsm-runtime — Production HSM Signing Runtime

**STATUS: G77-d (wave 20.1) — ACTIVE PRODUCTION SIGNING RUNTIME. TDD 46/46
green, deployed on sovereign-runner-kit (boot proof: see
`/home/z/runner-kit/receipts/hsm-runtime/`). SIGN-ONLY by design — there is no
broadcast path, structurally.**

This is the component the owner measured as "רכיב הארנק והחתימות המרובה עדיין
מוגדר כ-פרוטוטיפ — טרם-נפרס" (still labeled prototype — not deployed). It is a
prototype no longer: the runtime runs as a service, serves a token-gated
signing API, and produces verifiable signed-transaction receipts.

## What it is

A runner-kit-compatible service that signs with keys it can never expose:

- **Keys live ONLY in the packages/vault AES-256-GCM store** (`state/keys.enc`,
  0600, envelope-encrypted, master key from `SAOS_VAULT_MASTER_KEY` env).
  Every signature flows through the vault's scoped-unseal (`withKey` → use →
  zero-fill). This module never receives a seed, a WIF, or the master key.
- **Deny-by-default token gate**: every gated route requires
  `Authorization: Bearer <HSM_SIGNING_TOKEN>` (constant-time compare). With no
  token configured the API answers `503 HSM_E_TOKEN_UNSET` on EVERY gated
  route — the service never arms itself implicitly.
- **Steem-family signing** (STEEM + BLURT) on the M0/M1 oracle-proven wire:
  digest = sha256(chain_id ‖ serialized_tx), signature = 65-byte secp256k1
  compact `[31+recid, r, s]`, wire = digest ‖ varint(count) ‖ sigs. Steem's
  chain id is the chain-proven 32-zero constant; blurt's id is an EXPLICIT
  64-hex env (`HSM_BLURT_CHAIN_ID`) — never guessed.
- **Role policy, fail-closed** (mirrors `packages/chains` authority doctrine):
  funds-class ops (`transfer`, `limit_order_*`, `convert`) require an
  **active/owner** key; `account_update` (key rotation) requires **owner**;
  posting-class ops (`vote`, `comment`, `custom_json`,
  `claim_reward_balance`) accept posting/active/owner. A key without role
  metadata signs NOTHING.
- **Verifiability gate**: every steem signature must recover
  (`recoverFromCompact`) to the signing key's own public key before a receipt
  is emitted — a receipt can never carry a signature its key didn't produce.
- **Receipts with wire digests**: `receiptId` = sha256(canonical JSON body);
  fields include `digest` (the exact signed 32 bytes), `wireSha256` (sha256 of
  the full signed wire), `txId` (chain transaction id), `wireSignatures` /
  `signatureHex`, and the posture `mode: "SIGN-ONLY"`, `broadcast: "DISABLED"`.
- **Honest health**: `measureHealth` reports per-capability verdicts —
  `vault: OPEN|SEALED`, `signing: READY|NO-KEYS|BLOCKED-AUTH|BLOCKED-VAULT`,
  `broadcast: DISABLED` — and never fakes readiness. Bare `/health` carries
  liveness only (fleet law); the full verdicts live behind the token gate.

## HTTP surface (port 3155 by default)

| Route | Auth | Response |
|---|---|---|
| `GET /health` | none (bare liveness) | 200 `{ok, service, mode, broadcast, time, uptimeSeconds}` |
| `GET /status` | Bearer | 200 full measured verdicts + key census (counts/types only) |
| `POST /keys` | Bearer | 200 vault metadata listing (ids/types/meta — never envelopes) |
| `POST /sign/steem` | Bearer | 200 steem-family receipt (`{chain, tx, keyId}` body) |
| `POST /sign/bytes` | Bearer | 200 ed25519 receipt (`{keyId, messageHex}` body) |

Errors are stable JSON `{error:{code,message}}`: 400 bad input · 401 missing
credential · 403 wrong token / role-policy refusal · 404 unknown route (a
`POST /broadcast` is a 404 — that IS the side-effect law) · 405 method · 413
oversized body · 422 unknown key / key type / chain-id refusal · 503 token
unset or vault sealed. Nothing ever answers 500.

## CLI

```bash
bun packages/hsm-runtime/bin/hsm-runtime.ts --once   # CI provability
bun packages/hsm-runtime/bin/hsm-runtime.ts --serve  # run the API
```

`--once` boots against the configured vault, prints the measured health JSON,
produces one deterministic SIGN-ONLY proof receipt when signing is READY, and
exits honestly: `0` READY (receipt produced) · `2` SEALED · `3` NO-KEYS ·
`4` BLOCKED-AUTH · `5` PROOF-BLOCKED · `1` config error.

## Configuration (env — paths and verdicts, never keys)

| Variable | Meaning |
|---|---|
| `HSM_VAULT_DIR` | vault store directory (path only; unset ⇒ SEALED honestly) |
| `HSM_SIGNING_TOKEN` | gated-API Bearer token (unset ⇒ deny-by-default) |
| `HSM_PORT` | listen port (default 3155) |
| `HSM_BLURT_CHAIN_ID` | 64-hex blurt mainnet id (required for blurt signing) |
| `SAOS_VAULT_MASTER_KEY` | vault master key — read by packages/vault itself |

## Key provisioning (owner custody flow — never agent hands)

Keys are sealed into the vault by the owner's custody flow using
`packages/vault` primitives directly (`vault.sealKey`), with `meta.role` set
(`posting` / `active` / `owner`) and `meta.account`. Example (owner machine):

```ts
const vault = await openVault({ dir: process.env.HSM_VAULT_DIR });
await vault.sealKey({
  id: "soldier.example/posting",
  type: "secp256k1-wif",
  material: "<WIF — never committed, never printed>",
  meta: { account: "soldier.example", role: "posting" },
});
```

**No real key is hardcoded anywhere in this package** — tests use
self-generated deterministic fixture keys, and the runtime reads key material
exclusively from the vault path given in `HSM_VAULT_DIR`.

## Honest limits

- This is a **software vault**, not silicon HSM hardware — the threat model
  (and its honest limits) is documented in `packages/vault/README.md`.
- The runtime **signs; it never broadcasts**. Handing a signed wire form to a
  chain is a separate, explicitly-gated decision outside this service.
- `--once` proof receipts are deterministic ONLY under a fixed clock; wall-
  clock runs produce a fresh receipt each time (each carries its own
  `receiptId`).

## Selftests

```bash
bun test packages/hsm-runtime   # 46 tests — deterministic, zero network
```
