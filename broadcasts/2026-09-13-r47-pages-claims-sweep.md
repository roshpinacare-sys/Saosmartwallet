# r47 — Pages + claims sweep: the anchor demo was silently broken (fixed), the fleet brain survives gateway 401 bursts, and a published claim was corrected per the disclosure policy

**Date:** 2026-09-13 · **Scope:** live API sweep, anchor-verify, agent brains, fact-sheet claims · **Secrets:** zero

## The sweep (pages + APIs)

All 55 safe API routes probed live: **zero 5xx** (params→400, auth→401, method→405 — the r32 contract holds). Browser: console renders live data (secrets 248 · agents 9 · msgs 736), section navigation works, zero page errors.

One efficiency outlier surfaced: `/api/saos/anchor-verify` at **9.7s**. Investigating it exposed something worse than slowness.

## The anchor demo was silently broken

The live proof reported `no saos.id.v1 op in the newest 4040 history entries`. The anchor **exists** — at index 51989 of ~56k account ops. The unfiltered scan simply never reached it (the account's automation floods its history).

Fix (three layers, `src/lib/anchor-verify.ts`):
1. **`operation_filter=custom_json`** — skips ~92% of history noise (43 filtered pages instead of 500+ unfiltered).
2. **Parallel backward paging** in batches of 8 (wall-clock bounded by the slowest page, not the sum).
3. **Cache discipline**: the anchor op is an immutable historical fact (1h cache); the verify result itself gets a 60s single-flight cache; the Steem/Hive/Blurt probes moved from sequential to `Promise.all`, and Blurt's 3 sequential fallbacks to `Promise.any`.

Measured: **9.7s → 0.012s warm · 0.72s keys-only re-probe · 5.4s full scan that actually finds the anchor.**

The verifier now reports what the chain actually says: **AUTHORITY DRIFT** — the 2026-09-09 anchor is internally valid (EIP-191 recovers its claimed address), while the current live Steem authority derives a different EVM address, and Hive ≠ Steem. Reported honestly, no verdict forced. That is the design working.

## The fleet brain: 8 of 10 daily failures had one root cause

24h record: 21 runs, 7 done, 4 blocked, **10 failed**. Eight failures shared one signature: brain `zai:default` → `401 {"error":"missing X-Token header"}`. 7-day rates: **zai 42% failed vs nvidia 9.3%**. The idle self-employment runs rode zai because the vault was sealed (no NIM key reachable).

Root cause: the SDK omits the `X-Token` header whenever its freshly-loaded config lacks `token`, and the config re-reads on **every** `ZAI.create()`. Failure bursts (6 consecutive runs in 20 minutes) then recovery — consistent with token-less config windows.

Fix (three layers, `src/lib/gate/harness/brain.ts`):
1. **Memory-only token snapshot** (never logged, never persisted — the SDK already holds it in memory).
2. **On 401/X-Token: one direct retry** with `config.token || snapshot`, exact SDK request shape — **live-verified: HTTP 200 against the real gateway**.
3. **Failover to the nvidia brain** (open vault or env key); if nvidia is also unreachable, the original zai error is rethrown — the run fails honestly on the record, never masked.

Pending: a natural fleet run through layer 3 (the heart was idle post-restart); layers 1+2 are live-verified.

## Claims: a published claim was corrected (disclosure policy in action)

The fact-sheet (private ads repo) claimed the anchor account's authority is "verified against live RPC on Steem, Hive and Blurt **(same key)**". Today's measurement falsifies the blanket claim. Per the policy ("correction of a technical claim we ourselves published" is mandatory), commit `ff855add` on `roshpinacare-sys/adsmarket`:
- **Section 12 corrected**: live authorities are measured per chain on every run; equality or drift is reported, never assumed.
- **Honest-limits line added**: one measured drift open until a fresh anchor is signed by the current active authority (a signing-gate action by design).
- **New section 10.59** (the r35-deferred item): `fleet_pass_sweep` as a permanent capability with public receipts — 120 credentials sealed, signing capability 3 → 33 signers, 31 live fleet votes (STEEM 10/10 · HIVE 9/9 · BLURT 10/11). **Capability level only — zero event story**, zero em-dashes (language contract kept).

## Files

- `src/lib/anchor-verify.ts` — filtered parallel scan + cache tiers + concurrent probes
- `src/lib/gate/harness/brain.ts` — 401 resilience: snapshot, direct retry, nvidia failover
- `worklog.md` + this broadcast · adsmarket `ff855add`

**Next:** natural-fleet validation of the failover layer; re-sign a fresh identity anchor (operator-gated signing action) to close the measured drift.
