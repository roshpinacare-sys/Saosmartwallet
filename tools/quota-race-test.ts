/**
 * tools/quota-race-test.ts — prove the atomic quota reservation gate
 * ================================================================================
 * The Model 1 gate was historically check-then-act on the usage ledger; a live
 * 25-way burn measured EXACTLY one call over the 1,000/day limit
 * (docs/m1-429-liveburn.md, overshootAboveLimit=1). The gate is now a single
 * conditional upsert on QuotaCounter (INSERT .. ON CONFLICT .. DO UPDATE ..
 * WHERE used < limit) — SQLite serializes writes, so `used` can never exceed
 * the limit under ANY concurrency.
 *
 * This tool hammers reserveQuota() directly with 1,050 concurrent reservations
 * against a synthetic key (no chain work, no real key touched) and asserts the
 * exact arithmetic:
 *
 *   ok == 1000, denied == 50, final used == 1000, remaining == 0
 *
 * Exit 0 iff every assertion passes. Cleanup: the synthetic counter rows are
 * deleted afterwards (ledger untouched — no UsageRecord rows involved).
 *
 *   bun tools/quota-race-test.ts
 */
import { reserveQuota, FREE_DAILY_QUOTA } from "../src/lib/api-keys";
import { db } from "../src/lib/db";

const KEY_ID = `qcrace-${Math.random().toString(36).slice(2, 10)}`;
const ATTEMPTS = FREE_DAILY_QUOTA + 50; // 1,050 — 50 must be denied

async function main(): Promise<void> {
  console.log(`[quota-race] synthetic key=${KEY_ID} attempts=${ATTEMPTS} limit=${FREE_DAILY_QUOTA}`);

  // 0. baseline: no counter rows for the synthetic key
  const pre = await db.quotaCounter.count({ where: { keyId: KEY_ID } });
  if (pre !== 0) throw new Error(`precondition failed: ${pre} pre-existing counter rows`);

  // 1. sanity — a single reservation reserves 1
  const first = await reserveQuota(KEY_ID);
  if (!first.ok || first.used !== 1 || first.remaining !== FREE_DAILY_QUOTA - 1) {
    throw new Error(`sanity failed: ${JSON.stringify(first)}`);
  }
  console.log(`[quota-race] sanity ok: used=${first.used} remaining=${first.remaining} resetAt=${first.resetAt}`);

  // 2. the race — ATTEMPTS-1 concurrent reservations
  const results = await Promise.all(
    Array.from({ length: ATTEMPTS - 1 }, () => reserveQuota(KEY_ID)),
  );
  const granted = results.filter((r) => r.ok).length;
  const denied = results.filter((r) => !r.ok).length;
  const grantedUsed = results.filter((r) => r.ok).map((r) => r.used);
  const overLimitGrant = results.filter((r) => r.ok && r.used > FREE_DAILY_QUOTA).length;

  // 3. final state — read the counter exactly as the gate sees it
  const finalRow = await db.quotaCounter.findFirst({ where: { keyId: KEY_ID } });
  const finalUsed = finalRow?.used ?? -1;

  // 4. assertions — the sanity reservation already holds used=1, so the race
  //    must grant exactly limit-1 more and deny the rest.
  const checks: Array<[string, boolean]> = [
    [`race granted == ${FREE_DAILY_QUOTA - 1} (limit minus sanity, not one more)`, granted === FREE_DAILY_QUOTA - 1],
    [`denied == ${ATTEMPTS - FREE_DAILY_QUOTA} (fail-closed)`, denied === ATTEMPTS - FREE_DAILY_QUOTA],
    ["no granted call reports used > limit", overLimitGrant === 0],
    ["granted `used` values complete 2..1000 with no double-spend",
      grantedUsed.length === FREE_DAILY_QUOTA - 1 &&
      new Set(grantedUsed).size === FREE_DAILY_QUOTA - 1 &&
      Math.min(...grantedUsed) === 2 &&
      Math.max(...grantedUsed) === FREE_DAILY_QUOTA],
    [`final counter used == ${FREE_DAILY_QUOTA}`, finalUsed === FREE_DAILY_QUOTA],
    ["all denied report remaining == 0", results.filter((r) => !r.ok).every((r) => r.remaining === 0)],
    ["denied used never exceeds limit", results.filter((r) => !r.ok).every((r) => r.used <= FREE_DAILY_QUOTA)],
  ];

  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) failed++;
  }

  console.log(
    JSON.stringify(
      {
        tool: "quota-race-test",
        keyId: KEY_ID,
        attempts: ATTEMPTS,
        granted,
        denied,
        finalUsed,
        overshootAboveLimit: Math.max(0, finalUsed - FREE_DAILY_QUOTA),
        failedChecks: failed,
        verdict: failed === 0 ? "ATOMIC-PROVEN" : "BROKEN",
      },
      null,
      2,
    ),
  );

  // 5. cleanup — synthetic rows only
  const del = await db.quotaCounter.deleteMany({ where: { keyId: KEY_ID } });
  console.log(`[quota-race] cleanup: ${del.count} counter rows deleted (ledger untouched)`);

  if (failed > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[quota-race] FATAL:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
