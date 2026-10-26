# packages/fixedfloat — the FixedFloat cross-chain swap rail (wave G76-b)

Production integration of the **official FixedFloat API v2** (`https://ff.io/api/v2/`,
spec pinned from `https://fixedfloat.com/api` — archived by wave G76-b) as a
**custodial cross-chain swap rail**, with the owner's API credentials under
AES-256-GCM-adjacent file custody and **honest REFUSED verdicts wherever the
rail cannot honor the trustless atomic-swap laws**.

## Layout

| File | Role |
| --- | --- |
| `src/errors.ts` | Fail-honest error taxonomy — every failure is a typed `FF_E_*` `FixedFloatError` |
| `src/sign.ts` | Official v2 request signing: `X-API-SIGN = HMAC-SHA256(apiSecret, exactBodyString)`, lowercase hex; canonical JSON (sorted keys, no whitespace); empty-string signature for parameter-less requests |
| `src/vault-loader.ts` | Custody key loading, fail-closed (below) |
| `src/client.ts` | Wire client: sign-the-sent-string, `{code,msg,data}` envelope, timeout, retry-with-jitter **for read-only methods only**, side-effectful methods attempted **exactly once** |
| `src/rail.ts` | Order lifecycle ↔ swap-session mapping, settle evidence, refund paths, **HTLC honesty verdicts** |
| `bin/probe-live.ts` | The ONLY network path outside tests — hard-gated live probe (read-only) |

## Custody (owner directive §3+§4)

- Keys live ONLY in a vault file resolved as: explicit `path` → env
  `FIXEDFLOAT_VAULT` → `packages/fixedfloat/state/keys.json` (gitignored default).
- Plain vault: `{ "format": "fixedfloat/keys/1", "apiKey", "apiSecret" }` —
  **mode 0600 exactly required**; looser perms are a custody breach (fail-closed).
- Sealed vault: `{ "format": "fixedfloat/keys/enc/1", v: 1, salt, iv, authTag, ciphertext }`
  — AES-256-GCM under `SAOS_VAULT_MASTER_KEY` (HKDF-SHA256, info
  `saos/fixedfloat/v1/key`), reusing `packages/vault` envelope primitives.
- No material ever appears in errors, logs, or this repo. Production custody
  path: `/home/z/coord-work/vaults/fixedfloat/keys.json` (0600, dir 0700).

## HTLC honesty (the core verdict)

`htlcSupport()` returns **REFUSED** for both trustless laws, with causes:

- **hashlock — REFUSED**: FixedFloat v2 exposes no hashlock parameter; the
  session preimage cannot be bound to an order, so trustless
  claim-by-reveal / counter-claim-on-public-reveal is impossible here.
- **timelock — REFUSED**: no user timelock parameter; `data.time.expiration`
  is service-controlled data, not an HTLC lock we can set or enforce.

The rail is **custodial** (`RAIL_CUSTODY_DISCLOSURE`). Settle evidence for a
`DONE` order is `{ txid: "ff:<orderId>", chainProof: false, kind: "fixedfloat-order" }`
— the order id is the only honest evidence id; it is never presented as an
on-chain txid. `packages/swap` sessions accept it as the commit evidence id
with the custody disclosure attached.

Status vocabulary (official): `NEW → PENDING → EXCHANGE → WITHDRAW → DONE`,
plus `EXPIRED` (service-side refund policy → verdict `REFUNDED-TIMEOUT`) and
`EMERGENCY` (explicit `EXCHANGE`/`REFUND` choice; `emergencyRefund` requires a
non-empty refund address, fail-closed before the wire). Unknown statuses throw
`FF_E_STATE` — funds verdicts are never guessed.

## Transport honesty

- Retries (read-only `ccies`/`price`/`order`/`qr` only): exponential backoff
  `base·2^n + jitter` with injectable rng/sleep ⇒ deterministic in tests.
- `create`, `emergency`, `setEmail`: exactly one attempt, ever.
- Abort ⇒ `FF_E_TIMEOUT`; HTTP/transport failures ⇒ `FF_E_TRANSPORT`;
  `code≠0` ⇒ `FF_E_API` (never retried); non-envelope ⇒ `FF_E_MALFORMED`.

## Tests

`bun test packages/fixedfloat/` — 103 deterministic tests, zero network:
pinned HMAC vectors, custody fail-closed matrix (missing/perms/corrupt/envelope),
wire-truth captures through an injected transport, the full status table,
honest REFUSED verdicts, bounded deterministic polling, and the session-glue
acceptance of `ff:<orderId>` evidence.

Live probe (read-only, hard-gated):

```bash
FIXEDFLOAT_LIVE_PROBE=1 FIXEDFLOAT_VAULT=/path/to/keys.json bun run packages/fixedfloat/bin/probe-live.ts
```
