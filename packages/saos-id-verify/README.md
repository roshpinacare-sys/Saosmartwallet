# saos-id-verify

Official TypeScript client for the **SAOS metered Identity Verification API**.

One secp256k1 scalar → **Steem + Hive (+Blurt per the on-chain claim) + EVM**, proven
against the live on-chain anchor (`saos.id.v1` custom_json, EIP-191 recovery) — the same
math as the public PROOFS demo, wrapped in key auth + quota. **Zero dependencies** —
plain `fetch` (Node ≥18, Bun, Deno, browsers, edge runtimes).

## Install

```bash
npm i saos-id-verify
```

## Use — 3 lines

```ts
import { verifyIdentity } from "saos-id-verify";

const r = await verifyIdentity({ baseUrl: "https://<your-saos-gateway>", apiKey: process.env.SAOS_API_KEY!, username: "headcorner" });
if (r.ok) console.log(r.meta.outcome, r.verify.sameScalarProof, r.anchor.block, r.anchor.explorer);
```

`baseUrl` is **required** — the client refuses to invent an endpoint for you.
API keys (`saos_live_…`) are created in the SAOS DEVELOPER console; the plaintext is
shown exactly once (only its SHA-256 is stored server-side).

## Outcomes

| Result | Meaning | Quota |
|---|---|---|
| `r.ok === true` (`outcome: "PROVEN"`) | Full proof chain: on-chain anchor → EIP-191 recovery → live active-authority match per chain | metered |
| `r.ok === false` (`outcome: "FAILED"`) | **Real work happened and honestly failed** (no anchor / no active key). Not an error. | metered |
| `SaosAuthError` (401) | Key missing / malformed / revoked — fail-closed | not metered |
| `SaosQuotaError` (429) | UTC-day quota exhausted; `e.retryAt` = epoch seconds of next UTC midnight | n/a |

Every 200 response also carries:

- `r.meta.quota` — `{ used, limit, remaining, resetAt }` from the metering ledger
- `r.rateLimit` — parsed `X-RateLimit-Limit / Remaining / Reset` headers
- `r.meta.latencyMs` — server-measured end-to-end latency

## Client form

```ts
import { SaosIdentity } from "saos-id-verify";

const client = new SaosIdentity({ baseUrl: "https://<your-saos-gateway>", apiKey: process.env.SAOS_API_KEY! });
const r = await client.verify("headcorner");
if (r.ok) {
  r.chains.forEach((c) => console.log(c.chain, c.sameKeyAsSteem));
} else {
  console.error("not proven:", r.error, r.meta?.outcome);
}
```

Options: `timeoutMs` (default 30 000), `fetch` (injectable — custom agents, edge runtimes).

## Proof provenance (no mock)

- The types mirror the live API byte-for-byte as captured 2026-09-08
  (PROVEN @block 109,389,994; FAILED for an unanchored account; 401 fail-closed).
- This package is live-dogfooded by `tools/m1-w2-sdk-dogfood.ts` against the running
  metered API — PROVEN path, FAILED path (honest metering), and the 401 path all
  executed through the SDK itself.
- Honest gap: the 429 branch is coded per spec but was **not** live-burned
  (it would consume 1,000 real calls); see `docs/what-we-can-do-now.md`.

## Publish status

Publish-ready: `npm run build` compiles cleanly (strict TS, declarations to `dist/`),
`files` ships only `dist/` + this README. The actual `npm publish` is an owner action
(requires npm registry credentials).
