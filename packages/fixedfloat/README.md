# packages/fixedfloat — the FixedFloat exchange rail (agent-9, wave 20.01)

Production connector for the **FixedFloat API v2** (measured contract) — the
wallet's cross-chain routing leg for **ETH / SOL** (ULTIMATE SWARM DIRECTIVE
§4, trace `1a1788373a64c3ed`). HIVE/STEEM legs ride the internal-market rail,
not this package. Sits beside `packages/htlc` + `packages/swap` (the
atomic-swap layer) and `packages/bridges` (the path router).

## Measured wire contract (reconciled 2026-10-26)

Two independent measurements converged and this package follows the live one:

- **fx-fixedfloat bridge head** (giant mini-service :3055, trace
  `1a178850450f2e55`) probed ff.io **live** with the owner key: contract =
  `https://ff.io/api/v2/{method}`, JSON body, headers `X-Api-Key` +
  `X-Signature = HMAC-SHA1(sorted-canonical body)`; methods
  `{price, ccies, create, order, emergency, qr}`; the key's signature was
  **accepted** but every method answered **code 501 "Not have permission"**
  → **the key awaits account-side API enablement (OWNER ACTION)**.
- This sandbox's own probe was **Cloudflare-blocked** (403, datacenter IP
  class) before reaching the API — both facts are recorded; no live e2e
  receipt is claimed from the sandbox. The live call path runs from the
  daemon host.

## Layering

| module      | law                                                                       |
| ----------- | ------------------------------------------------------------------------- |
| `sign.ts`   | `X-Signature = HMAC_SHA1(secret, canonical(body))` — primitive pinned to **RFC 2202 TC3**; canonical = keys sorted, nested objects deep-sorted compact JSON, no separator (signature is invariant to param insertion order) |
| `config.ts` | fail-closed custody: refuse missing/empty/whitespace credentials — no placeholder, no degraded mode; sha256 fingerprint reveals nothing; `redact()` strips full values **and** ≥8-char suffix leaks (pass-ordered: full strips before suffix work) |
| `errors.ts` | five kinds (`CONFIG`/`VALIDATE`/`NETWORK`/`PARSE`/`API`); redaction enforced **at construction** — no credential can ride an error path |
| `orders.ts` | honest status model (documented codes map to phases; **unmeasured codes stay `unknown` with the raw code carried** — no invented semantics); emergency guard (REFUND⇒address required, EXCHANGE⇒forbidden); fleet hash-chain rail receipts (canonical JSON, tamper-evident, fleet-economy anchorable) |
| `client.ts` | injected transport (tests are **zero-network** by law); JSON body deep-sorted to deterministic bytes; method whitelist = the measured v2 set (unknown ⇒ local refusal, zero wire); envelope law: `data` present (+ code absent/0/200) → data, refusing code → API (the measured **501** class), non-JSON → PARSE, non-2xx → NETWORK; **fail-closed local validation costs zero wire calls**; `callRaw()` is the raw-envelope escape hatch |

## Custody (the owner's live keypair — NEVER in the tree)

```
/home/z/.secrets/fixedfloat.env     # FIXEDFLOAT_API_KEY / FIXEDFLOAT_API_SECRET (0600)
```

Runtime loading: `loadFixedFloatConfig(process.env)` after sourcing the
custody file. The fingerprint (sha256 prefix of the key) is the only
printable identity the config exposes.

## Usage

```ts
import { FixedFloatClient, makeDefaultTransport, statusPhase, isTerminalStatus } from "../fixedfloat/src";

const client = new FixedFloatClient(process.env, { transport: makeDefaultTransport() });

const order = await client.createOrder({
  from: "eth", to: "sol", amount: "0.25", type: "fixed",
  addrTo: "<sol-destination>", addrRefund: "<eth-refund>",
});
const cur = await client.getOrder(order.id!);          // status?: number
const phase = statusPhase(cur.status ?? -99);          // honest mapping
if (!isTerminalStatus(cur.status ?? -99)) { /* keep polling */ }
```

## Verification

```
bun test packages/fixedfloat/test/   → 46 pass, 0 fail (106 assertions)
bunx tsc -p packages/fixedfloat/tsconfig.json → 0 errors
bunx eslint packages/fixedfloat/     → 0 findings
```
