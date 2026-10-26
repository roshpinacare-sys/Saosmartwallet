# packages/fixedfloat — the FixedFloat exchange rail (agent-9, wave 20.01)

Production connector for the **FixedFloat API v1** — the wallet's cross-chain
routing leg for **ETH / SOL** (ULTIMATE SWARM DIRECTIVE §4, trace
`1a1788373a64c3ed`). HIVE/STEEM legs ride the internal-market rail, not this
package. Sits beside `packages/htlc` + `packages/swap` (the atomic-swap
layer) and `packages/bridges` (the path router).

## Layering

| module      | law                                                                       |
| ----------- | ------------------------------------------------------------------------- |
| `sign.ts`   | `signature = HMAC_SHA256(secret, CONCAT(param values in wire order))` — pinned to **RFC 4231 TC2**; monotonic decimal nonce from the **injected clock** (zero wall-clock) |
| `config.ts` | fail-closed custody: refuse missing/empty/whitespace credentials — no placeholder, no degraded mode; sha256 fingerprint reveals nothing; `redact()` strips full values **and** ≥8-char suffix leaks |
| `errors.ts` | five kinds (`CONFIG`/`VALIDATE`/`NETWORK`/`PARSE`/`API`); redaction enforced **at construction** — no credential can ride an error path |
| `orders.ts` | honest status model (documented 0..4 / −1 / −2; **unmeasured codes stay `unknown` with the raw code carried** — no invented semantics); emergency guard (REFUND⇒address required, EXCHANGE⇒forbidden); fleet hash-chain rail receipts (canonical JSON, tamper-evident, fleet-economy anchorable) |
| `client.ts` | injected transport (tests are **zero-network** by law); POST form-encoded, insertion order; `{code:0}`→data, `{code≠0}`→API, non-JSON→PARSE, non-2xx→NETWORK; **fail-closed local validation costs zero wire calls**; `callRaw()` is the raw-envelope escape hatch |

## Custody (the owner's live keypair — NEVER in the tree)

```
/home/z/.secrets/fixedfloat.env     # FIXEDFLOAT_API_KEY / FIXEDFLOAT_API_SECRET (0600)
```

Runtime loading: `loadFixedFloatConfig(process.env)` after sourcing the
custody file. The fingerprint (sha256 prefix of the key) is the only
printable identity the config exposes.

## Measured boundary (honest, 2026-10-26)

Egress from the build sandbox to `ff.io` is **Cloudflare-blocked at the IP
level** (measured `403` on `POST /api/v1/getCurrencies`; the challenge page
precedes any API authentication). Therefore:

- the signing law is proven against **RFC 4231** (an external standard), and
  the full wire/envelope/redaction surface is proven over an **injected
  transport** — 42 tests, 99 assertions, zero network;
- **no live e2e receipt is claimed from this sandbox** — the live call path
  (`makeDefaultTransport()` + custody env) runs from the daemon host
  (`sovereign-runner-kit` device), whose egress class is not IP-blocked;
- response field shapes are the **documented** v1 contract with optional
  fields; `callRaw()` returns the raw envelope for live inspection on the
  daemon host before any typed field is promoted to required.

## Usage

```ts
import { FixedFloatClient, makeDefaultTransport, statusPhase, isTerminalStatus } from "../fixedfloat/src";

const client = new FixedFloatClient(process.env, { transport: makeDefaultTransport(), now: () => Date.now() });

const order = await client.createOrder({
  from: "ETH", to: "SOL", amount: "0.25", direction: "from", type: "fixed",
  addrTo: "<sol-destination>", addrRefund: "<eth-refund>",
});
const cur = await client.getOrder(order.id!);          // status?: number
const phase = statusPhase(cur.status ?? -99);          // honest mapping
if (!isTerminalStatus(cur.status ?? -99)) { /* keep polling */ }
```

## Verification

```
bun test packages/fixedfloat/test/   → 42 pass, 0 fail (99 assertions)
bunx tsc -p packages/fixedfloat/tsconfig.json → 0 errors
bunx eslint packages/fixedfloat/     → 0 findings
```
