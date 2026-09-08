# Model 1 — 429 Live Burn: the quota-exhaustion path, proven with real calls

**Task 1-b · 2026-09-08 · Zero-Mock evidence — every number below is from the recorded run**
(`tool-results/m1-429-burn-summary.json` / `tool-results/m1-429-burn-run.log`).

This closes the last untested product path of the metered Identity Verification API.
Previously proven live: PROVEN (200 + ok:true), FAILED (200 + ok:false, metered), 401 fail-closed.
Now proven live: **quota exhaustion → HTTP 429 + `X-RateLimit-Reset` header → SDK `SaosQuotaError.retryAt`.**

## Method

- Tool: `tools/m1-429-burn.ts` (bun). All calls went **through the official SDK's compiled dist**
  (`packages/saos-id-verify/dist/index.js` — exactly what an npm consumer gets), except **one** direct
  `fetch` right after the first 429, used solely to read the raw `X-RateLimit-*` headers.
- Dedicated key created for this run via `POST /api/developer/keys` → name `burn-429-20260908`,
  id `cmtt26kaj0001pwolfvc4hhwc`, prefix `saos_live_s2-k65` (plaintext shown once, never stored/logged).
  No pre-existing key was reused or touched. (A shape-probe key `burn-429-shape-probe` was created for
  0 calls to re-verify the create-response shape, then immediately soft-revoked.)
- Username `headcorner` (known-verifiable) on every call against `http://localhost:3000`.
- Controlled parallel batches: concurrency **25**, client timeout 58 s, 100 ms pause between batches,
  hard cap 60 batches. Stop rule: first `SaosQuotaError`, then a 5-call confirmation batch.

## Real numbers (run of 2026-09-08T19:24:42→19:25:34 UTC)

| Metric | Value |
|---|---|
| Total calls issued through the SDK dist | **1,031** (1 preflight + 1,025 burn + 5 confirm) |
| HTTP 200 `ok:true` (PROVEN) | **1,001** |
| HTTP 200 `ok:false` (FAILED) | **0** |
| HTTP 500 (ERROR) / network errors | **0 / 0** |
| HTTP 429 | **30** (25 in the boundary batch + 5 confirmations) |
| Wall-clock (burn phase, preflight→boundary) | **49,950 ms** (total incl. confirm 49,982 ms) |
| Concurrency | 25 (41 batches issued) |
| Server latency (the 1,001 PROVEN calls) | avg **888 ms** · p50 831 ms · p95 1,380 ms |
| Client wall latency (all 1,031 calls) | p50 955 ms · p95 1,477 ms |
| First-429 latency (wall) | **91 ms** (gate check only — no chain work; dev.log shows 429s served in 18–21 ms) |

## The 429 boundary — raw evidence

First `SaosQuotaError` at call **#1026**, thrown by the SDK dist:

```
message : "daily quota exceeded — resets at next UTC midnight"
retryAt : 1788912000
```

One direct (non-SDK) `fetch` immediately after, same key, reading raw headers:

```
HTTP/1.1 429
X-RateLimit-Limit:     1000
X-RateLimit-Remaining: 0
X-RateLimit-Reset:     1788912000

{"ok":false,"error":"daily quota exceeded — resets at next UTC midnight",
 "quota":{"used":1001,"limit":1000,"remaining":0,"resetAt":1788912000}}
```

- `retryAt` (1788912000) **== `X-RateLimit-Reset` header == body `quota.resetAt`** and equals the
  independently computed next UTC midnight **2026-09-09T00:00:00Z** (asserted within ±120 s; exact here).
- The SDK's `retryAt` is parsed from the `X-RateLimit-Reset` header of the 429 response — the header→SDK
  wiring is now proven end-to-end through the compiled artifact.

## Fail-closed assertion — no quota bypass

After exhaustion: the remaining 24 in-flight calls of the boundary batch, the 5 confirmation calls,
and the direct fetch — **all 30 returned 429** (`retryAt` identical on all). Zero 200/500 responses
observed after the first 429. 429 responses themselves consume no quota (ledger stayed at used=1001
through 30 further 429s) — matches the code: the gate runs before metering.

## Metering arithmetic (FAILED-calls-consume-quota question)

`X-RateLimit-Remaining: 0` and ledger `used=1001` vs **exactly 1,001 non-429 executed calls** (all PROVEN):

```
1,001 PROVEN + 0 FAILED + 0 ERROR  ==  used 1001   ✓ exact identity
```

- Only executed calls meter; 429s don't. No call was lost or double-counted.
- In this run zero FAILED verdicts occurred (the public Steem/Hive RPCs stayed healthy for all 1,001
  verifications). The FAILED-consumes-quota behavior was separately proven live in MODEL1-W2
  (quota 3→4 on a bogus account) and the code meters FAILED identically to PROVEN
  (`meterCall` after `verifyIdentityAnchor`, outcome PROVEN|FAILED|ERROR). Honest note: this burn
  did not re-measure a FAILED call itself.

## Honest caveats

1. **Off-by-one overshoot (measured, by design of a check-then-act gate):** ledger `used=1001` vs limit
   1,000 — exactly **1** call over. The quota gate (`remaining > 0`) is checked before execution and the
   usage row is written after the real work; under 25-way concurrency one in-flight call passed the gate
   in the same window exhaustion landed. Observed magnitude: 1 (bounded in principle by the concurrency
   of in-flight calls). Fail-closed behavior after exhaustion is unaffected — once `remaining` hits 0,
   every call 429s. Not fixed (would need a transactional counter / reservation semantics — an owner
   decision, recorded here as a measured property, not a silent bug).
2. **Quota is per-key per-UTC-day** by ledger count (`UsageRecord.createdAt >= UTC midnight`),
   limit 1,000 (free tier, `FREE_DAILY_QUOTA` in `src/lib/api-keys.ts`), reset at next UTC midnight —
   verified live: limit/remaining/reset headers, body quota, and `retryAt` all agree.
3. The burn key `burn-429-20260908` is left **active** as evidence (console shows callsToday=1001);
   it resets at the next UTC midnight. Owner may revoke `id=cmtt26kaj0001pwolfvc4hhwc` at will.

## Verdict

All 13 scripted assertions passed (`verdict: "ALL ASSERTIONS PASSED — 429 PATH PROVEN LIVE"`):

```
sdk_dist_build_used ✓  at_least_one_429 ✓  sdk_threw_SaosQuotaError ✓  retryAt_present ✓
retryAt_is_next_utc_midnight ✓  direct_fetch_429 ✓  direct_headers_limit_1000 ✓
direct_headers_remaining_0 ✓  direct_reset_equals_retryAt ✓  confirmation_5_of_5_429 ✓
fail_closed_no_quota_bypass ✓  ledger_arithmetic ✓  limit_reached ✓
```

The metered Identity Verification API now has **every documented product path live-proven**:
PROVEN · FAILED (metered) · 401 · **429 + X-RateLimit-Reset + SDK `SaosQuotaError.retryAt`**.

## Reproduce

```
bun tools/m1-429-burn.ts            # creates its own dedicated key; ~50 s; prints honest JSON
```

## Post-fix note (2026-09-08, third round)

The off-by-one measured above (used=1001) is now CLOSED: the gate is a single
atomic conditional upsert on `QuotaCounter`
(`INSERT .. ON CONFLICT .. DO UPDATE .. WHERE used < limit RETURNING used`).
A dedicated race tool re-proved the exact arithmetic live:
`bun tools/quota-race-test.ts` → 1,050 concurrent reservations against a
synthetic key: exactly 1,000 granted, 50 denied, final counter used=1000,
**overshootAboveLimit=0**, granted `used` values complete 2..1000 with zero
double-spend — verdict `ATOMIC-PROVEN`.

A full 1,031-call burn re-run was attempted and fail-closed at preflight: at
21:17:33 UTC (block 109,410,651) a live `account_update_operation` rotated the
account's active authority, so the newest identity anchor no longer proves the
CURRENT key — the API now (correctly) returns FAILED with an explicit
`AUTHORITY DRIFT` summary instead of PROVEN. The burn tool aborts unless the
preflight is PROVEN — exactly as designed. The atomicity claim rests on the
race tool (the same `reserveQuota` the HTTP route calls) plus live per-call
arithmetic through the API (`used:1 remaining:999` on a fresh probe key).
Re-run the burn after the fleet publishes a fresh anchor signed by the new
active key (owner/fleet action, outside this repo).
