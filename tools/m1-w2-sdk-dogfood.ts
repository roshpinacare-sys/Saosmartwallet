/**
 * MODEL1-W2 dogfood — runs the shipped saos-id-verify SDK against the live
 * metered API on this box. Proves THROUGH THE SDK (not curl):
 *   1. PROVEN path — ok:true + sameScalarProof + anchor evidence + quota meta + headers
 *   2. FAILED path — honest metering (ok:false, outcome FAILED, quota consumed)
 *   3. 401 path    — fail-closed SaosAuthError for an unknown key
 *
 * Usage: bun tools/m1-w2-sdk-dogfood.ts <apiKey> [baseUrl]
 */
import { SaosAuthError, SaosIdentity } from "../packages/saos-id-verify/src/index";

const apiKey = process.argv[2];
const baseUrl = process.argv[3] ?? "http://localhost:3000";
if (!apiKey) {
  console.error("usage: bun tools/m1-w2-sdk-dogfood.ts <apiKey> [baseUrl]");
  process.exit(1);
}

const client = new SaosIdentity({ apiKey, baseUrl });
let failed = false;

/* 1) PROVEN path */
const t0 = Date.now();
const proven = await client.verify("headcorner");
const wallMs = Date.now() - t0;
if (!proven.ok) {
  console.error("FAIL: PROVEN path returned ok:false —", proven.error);
  failed = true;
} else {
  console.log(
    `[1] PROVEN  ok=true  sameScalarProof=${proven.verify.sameScalarProof}  block=${proven.anchor.block}  serverLatency=${proven.meta.latencyMs}ms  wall=${wallMs}ms`
  );
  console.log(
    `    quota=${proven.meta.quota.used}/${proven.meta.quota.limit}  remaining=${proven.meta.quota.remaining}  resetAt=${proven.meta.quota.resetAt}`
  );
  console.log(
    `    headers: x-ratelimit-limit=${proven.rateLimit.limit}  remaining=${proven.rateLimit.remaining}  reset=${proven.rateLimit.resetAt}`
  );
  const chains = proven.chains.map((c) => `${c.chain}:${c.sameKeyAsSteem === true ? "SAME" : c.sameKeyAsSteem === false ? "diff" : "n/a"}`).join("  ");
  console.log(`    chains: ${chains}`);
  if (!proven.verify.sameScalarProof) failed = true;
  if (proven.rateLimit.limit !== 1000) failed = true;
}

/* 2) FAILED path — honest metering of a real measurement */
const failedRes = await client.verify("__no_such_account_sdk_w2__");
if (failedRes.ok) {
  console.error("FAIL: expected ok:false for an unanchored account");
  failed = true;
} else {
  const usedAfterFailed = failedRes.meta?.quota.used;
  const usedAfterProven = proven.ok ? proven.meta.quota.used : undefined;
  console.log(
    `[2] FAILED  ok=false  outcome=${failedRes.meta?.outcome}  error="${failedRes.error}"  latency=${failedRes.meta?.latencyMs}ms`
  );
  console.log(
    `    quota consumed by the FAILED call: ${usedAfterProven} → ${usedAfterFailed} (real work is metered)`
  );
  if (failedRes.meta?.outcome !== "FAILED") failed = true;
  if (typeof usedAfterFailed !== "number" || typeof usedAfterProven !== "number" || usedAfterFailed !== usedAfterProven + 1) {
    failed = true;
  }
}

/* 3) 401 path — fail-closed */
const bad = new SaosIdentity({ apiKey: `saos_live_${"x".repeat(43)}`, baseUrl });
try {
  const res = await bad.verify("headcorner");
  console.error("FAIL: expected SaosAuthError, got:", res.ok ? "ok:true" : "ok:false");
  failed = true;
} catch (err) {
  if (err instanceof SaosAuthError) {
    console.log(`[3] 401     fail-closed ok — SaosAuthError(status=${err.status}): "${err.message}"`);
  } else {
    console.error("FAIL: wrong error class:", err);
    failed = true;
  }
}

console.log(failed ? "SDK DOGFOOD: FAILURES PRESENT" : "SDK DOGFOOD: ALL 3 PATHS PROVEN THROUGH THE SDK");
process.exit(failed ? 1 : 0);
