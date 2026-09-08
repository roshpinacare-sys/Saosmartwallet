/**
 * m1-429-burn.ts — CONTROLLED LIVE BURN of the metered Identity Verification
 * API to prove the last untested product path (Task 1-b):
 *
 *   quota exhaustion → HTTP 429 + X-RateLimit-Reset header
 *                    → SDK `SaosQuotaError` with `.retryAt` (from dist build)
 *
 * Method (zero-mock — every number below comes from this real run):
 *   1. Create a DEDICATED key via POST /api/developer/keys (name: burn-429-<date>).
 *      Response shape re-verified by curl beforehand: top-level `key` is the
 *      plaintext STRING (shown once), `created.id` is the key id.
 *   2. Preflight: 1 SDK call (dist build) for "headcorner" — must be ok:true.
 *   3. Burn: parallel batches of CONC calls THROUGH THE SDK DIST against
 *      http://localhost:3000 until the first SaosQuotaError (HTTP 429).
 *   4. Boundary evidence: ONE direct fetch (not SDK) with the same key right
 *      after the first 429 to read the raw X-RateLimit-* headers + body.
 *   5. Confirmation: 5 more SDK calls + the direct fetch — ALL must be 429
 *      (fail-closed: no quota bypass after exhaustion).
 *   6. Honest JSON summary. Abort cap: MAX_BATCHES (no infinite loop).
 *
 * Usage: bun tools/m1-429-burn.ts
 */

import { writeFileSync } from "node:fs";

import {
  SaosApiError,
  SaosIdentity,
  SaosNetworkError,
  SaosQuotaError,
  type RateLimit,
  type QuotaSnapshot,
} from "../packages/saos-id-verify/dist/index.js";

/* ── config ──────────────────────────────────────────────────────────── */
const BASE = "http://localhost:3000";
const USERNAME = "headcorner";
const CONC = 25; // parallel calls per batch
const BATCH_PAUSE_MS = 100;
const MAX_BATCHES = 60; // hard cap: 60 × 25 = 1,500 calls max
const TIMEOUT_MS = 58_000; // client timeout > server worst path (RPC 9s × pages)
const KEY_NAME = `burn-429-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;

/* ── helpers ─────────────────────────────────────────────────────────── */
function nextUtcMidnightEpoch(now = new Date()): number {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return (start + 24 * 3600 * 1000) / 1000;
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

/* ── 1. create the dedicated key (admin-gated since the W1-gap closure) ─ */
// Admin resolution: env SAOS_ADMIN_TOKEN first; otherwise bootstrap-once
// (first caller wins and receives the plaintext — printed ONCE here so the
// owner can save it). If a credential already exists and no env token is
// set, we fail with instructions instead of guessing.
console.log(`[admin] resolving admin credential …`);
let adminToken: string | null = process.env.SAOS_ADMIN_TOKEN?.trim() ?? null;
if (!adminToken) {
  const boot = await fetch(`${BASE}/api/developer/admin/bootstrap`, { method: "POST" });
  const bootBody = (await boot.json()) as { created?: boolean; token?: string; exists?: boolean; note?: string };
  if (boot.status === 201 && bootBody.created && typeof bootBody.token === "string") {
    adminToken = bootBody.token;
    console.log(`[admin] BOOTSTRAPPED a new admin credential — save this token NOW (shown once):`);
    console.log(`[admin]   ${adminToken}`);
  } else {
    console.error(
      "FATAL: no admin credential available — key creation is admin-gated. " +
        "Set SAOS_ADMIN_TOKEN or authenticate the console once (POST /api/developer/admin/bootstrap).",
    );
    process.exit(1);
  }
} else {
  console.log("[admin] using SAOS_ADMIN_TOKEN from env");
}
console.log(`[key] creating dedicated key "${KEY_NAME}" …`);
const keyRes = await fetch(`${BASE}/api/developer/keys`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
  body: JSON.stringify({ name: KEY_NAME }),
});
if (keyRes.status === 401) {
  console.error("FATAL: admin token rejected (401) — the configured token does not match the credential");
  process.exit(1);
}
if (keyRes.status !== 201) {
  console.error(`FATAL: key creation returned HTTP ${keyRes.status} (expected 201)`);
  process.exit(1);
}
const keyBody = (await keyRes.json()) as {
  ok?: boolean;
  key?: unknown;
  created?: { id?: string; prefix?: string };
};
if (keyBody.ok !== true || typeof keyBody.key !== "string" || !keyBody.key.startsWith("saos_live_")) {
  console.error("FATAL: unexpected key-creation shape — top-level `key` must be the plaintext string");
  process.exit(1);
}
const apiKey: string = keyBody.key;
const keyId: string = keyBody.created?.id ?? "unknown";
const keyPrefix: string = keyBody.created?.prefix ?? apiKey.slice(0, 16);
console.log(`[key] ok — id=${keyId} prefix=${keyPrefix} (plaintext NOT logged)`);

/* ── 2. SDK client from the COMPILED DIST (what an npm consumer gets) ── */
const client = new SaosIdentity({ apiKey, baseUrl: BASE, timeoutMs: TIMEOUT_MS });

/* ── counters ────────────────────────────────────────────────────────── */
type Outcome =
  | { kind: "proven"; wallMs: number; serverMs: number; quota: QuotaSnapshot; rateLimit: RateLimit }
  | { kind: "failed"; wallMs: number; serverMs: number; quota?: QuotaSnapshot; rateLimit?: RateLimit; error: string }
  | { kind: "error500"; wallMs: number; status: number; message: string }
  | { kind: "network"; wallMs: number; message: string }
  | { kind: "quota429"; wallMs: number; retryAt: number | null; message: string };

const counts = { proven: 0, failed: 0, error500: 0, network: 0, quota429: 0 };
const serverLatencies: number[] = [];
const wallLatencies: number[] = [];
let lastPre429Snapshot: { quota?: QuotaSnapshot; rateLimit?: RateLimit } | null = null;
let callsAfterBoundary200 = 0; // 200s observed after first 429 (in-flight overshoot)
let callCounter = 0;
let boundaryHit = false;

/* holder for closure-mutated boundary state (TS CFA on bare `let` narrows to
 * null at use sites; a property holder keeps the declared type visible) */
const burnState = { first429: null as null | { wallMs: number; retryAt: number | null; message: string; callIndex: number } };

async function oneCall(): Promise<Outcome> {
  const t0 = Date.now();
  ++callCounter;
  try {
    const r = await client.verify(USERNAME);
    const wallMs = Date.now() - t0;
    if (r.ok) {
      return { kind: "proven", wallMs, serverMs: r.meta.latencyMs, quota: r.meta.quota, rateLimit: r.rateLimit };
    }
    return { kind: "failed", wallMs, serverMs: r.meta?.latencyMs ?? -1, quota: r.meta?.quota, rateLimit: r.rateLimit, error: r.error };
  } catch (e) {
    const wallMs = Date.now() - t0;
    if (e instanceof SaosQuotaError) {
      return { kind: "quota429", wallMs, retryAt: e.retryAt, message: e.message };
    }
    if (e instanceof SaosApiError) {
      return { kind: "error500", wallMs, status: e.status ?? 0, message: e.message };
    }
    if (e instanceof SaosNetworkError) {
      return { kind: "network", wallMs, message: e.message };
    }
    return { kind: "network", wallMs, message: `unexpected: ${String(e)}` };
  }
}

function account(o: Outcome): void {
  switch (o.kind) {
    case "proven":
      counts.proven++;
      serverLatencies.push(o.serverMs);
      wallLatencies.push(o.wallMs);
      lastPre429Snapshot = { quota: o.quota, rateLimit: o.rateLimit };
      if (boundaryHit) callsAfterBoundary200++;
      break;
    case "failed":
      counts.failed++;
      if (o.serverMs >= 0) serverLatencies.push(o.serverMs);
      wallLatencies.push(o.wallMs);
      lastPre429Snapshot = { quota: o.quota, rateLimit: o.rateLimit };
      if (boundaryHit) callsAfterBoundary200++;
      break;
    case "error500":
      counts.error500++;
      wallLatencies.push(o.wallMs);
      if (boundaryHit) callsAfterBoundary200++; // 500s also pass the gate — overshoot class
      break;
    case "network":
      counts.network++;
      wallLatencies.push(o.wallMs);
      break;
    case "quota429":
      counts.quota429++;
      wallLatencies.push(o.wallMs);
      if (!burnState.first429) {
        boundaryHit = true;
        burnState.first429 = { wallMs: o.wallMs, retryAt: o.retryAt, message: o.message, callIndex: callCounter };
        console.log(`[429] FIRST SaosQuotaError at call #${burnState.first429.callIndex} — wall=${o.wallMs}ms retryAt=${o.retryAt}`);
        console.log(`      message: "${o.message}"`);
      }
      break;
  }
}

/* ── 3. preflight (1 metered call) ───────────────────────────────────── */
console.log("[preflight] 1 SDK (dist) call …");
const pre = await oneCall();
account(pre);
if (pre.kind !== "proven") {
  console.error(`FATAL: preflight did not PROVEN (got ${pre.kind}) — aborting before burn`);
  process.exit(1);
}
console.log(
  `[preflight] ok:true server=${pre.serverMs}ms wall=${pre.wallMs}ms quota=${pre.quota.used}/${pre.quota.limit} remaining=${pre.quota.remaining}`,
);

/* ── 4. the burn ─────────────────────────────────────────────────────── */
const tBurn0 = Date.now();
let batch = 0;
while (!boundaryHit && batch < MAX_BATCHES) {
  batch++;
  const tB = Date.now();
  const results = await Promise.all(Array.from({ length: CONC }, () => oneCall()));
  results.forEach(account);
  const b429 = results.filter((r) => r.kind === "quota429").length;
  console.log(
    `[batch ${String(batch).padStart(2, "0")}] ${Date.now() - tB}ms — proven=${counts.proven} failed=${counts.failed} err500=${counts.error500} net=${counts.network} 429=${b429} (total429=${counts.quota429})`,
  );
  if (!boundaryHit) await new Promise((res) => setTimeout(res, BATCH_PAUSE_MS));
}
const burnMs = Date.now() - tBurn0;
if (!burnState.first429) {
  console.error(`HONEST FAILURE: no 429 after ${callCounter} calls (${batch} batches) — reporting nulls`);
}

/* ── 5. boundary evidence: ONE direct fetch (raw headers, not SDK) ───── */
let direct: {
  status: number;
  limit: string | null;
  remaining: string | null;
  reset: string | null;
  body: unknown;
} | null = null;
if (burnState.first429) {
  const tD = Date.now();
  const dRes = await fetch(`${BASE}/api/v1/identity/verify`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME }),
    cache: "no-store",
  });
  direct = {
    status: dRes.status,
    limit: dRes.headers.get("x-ratelimit-limit"),
    remaining: dRes.headers.get("x-ratelimit-remaining"),
    reset: dRes.headers.get("x-ratelimit-reset"),
    body: await dRes.json().catch(() => undefined),
  };
  console.log(`[direct] HTTP ${direct.status} in ${Date.now() - tD}ms — X-RateLimit-Limit=${direct.limit} Remaining=${direct.remaining} Reset=${direct.reset}`);
  console.log(`[direct] body: ${JSON.stringify(direct.body)}`);
}

/* ── 6. confirmation batch: 5 more SDK calls, all must 429 ───────────── */
let confirm5: Array<{ retryAt: number | null; wallMs: number; is429: boolean }> = [];
if (burnState.first429) {
  confirm5 = await Promise.all(
    Array.from({ length: 5 }, async () => {
      const o = await oneCall();
      account(o);
      return { retryAt: o.kind === "quota429" ? o.retryAt : null, wallMs: o.wallMs, is429: o.kind === "quota429" };
    }),
  );
  console.log(`[confirm] 5/5 429 = ${confirm5.filter((c) => c.is429).length}/5 — retryAt set: ${confirm5.map((c) => c.retryAt).join(",")}`);
}
const totalWallMs = Date.now() - tBurn0;

/* ── 7. assertions ───────────────────────────────────────────────────── */
const expectedReset = nextUtcMidnightEpoch();
const retryAt = burnState.first429?.retryAt ?? null;
const sLat = [...serverLatencies].sort((a, b) => a - b);
const wLat = [...wallLatencies].sort((a, b) => a - b);
const meteredCalls = counts.proven + counts.failed + counts.error500; // each consumed exactly 1
const directBody = (direct?.body ?? {}) as { quota?: QuotaSnapshot; error?: string };

const assertions = {
  sdk_dist_build_used: true, // import path is ../packages/saos-id-verify/dist/index.js
  at_least_one_429: counts.quota429 >= 1,
  sdk_threw_SaosQuotaError: burnState.first429 !== null,
  retryAt_present: retryAt !== null,
  retryAt_is_next_utc_midnight: retryAt !== null && Math.abs(retryAt - expectedReset) <= 120,
  direct_fetch_429: direct?.status === 429,
  direct_headers_limit_1000: direct?.limit === "1000",
  direct_headers_remaining_0: direct?.remaining === "0",
  direct_reset_equals_retryAt: direct?.reset !== null && retryAt !== null && Number(direct?.reset) === retryAt,
  confirmation_5_of_5_429: confirm5.length === 5 && confirm5.every((c) => c.is429),
  fail_closed_no_quota_bypass:
    burnState.first429 !== null &&
    (() => {
      // every SDK call observed AFTER the first 429 must NOT be a 200 (proven/failed)
      return callsAfterBoundary200 === 0 && confirm5.every((c) => c.is429) && direct?.status === 429;
    })(),
  ledger_arithmetic:
    directBody.quota !== undefined &&
    directBody.quota.used === meteredCalls + counts.network && // note below
    directBody.quota.remaining === 0,
  limit_reached: (directBody.quota?.used ?? 0) >= 1000,
};

/* ledger note: network-errored calls are ambiguous client-side (the request
 * may still have been metered server-side); with net=0 the identity is exact. */
const ledgerNote: string | null =
  counts.network > 0
    ? `AMBIGUOUS: ${counts.network} network-errored call(s) — ledger identity not fully provable from the client`
    : null;

const overshoot = (directBody.quota?.used ?? 0) - 1000;

const summary = {
  task: "1-b 429 live-burn proof",
  dateUtc: new Date().toISOString(),
  baseUrl: BASE,
  username: USERNAME,
  sdk: "packages/saos-id-verify/dist/index.js (compiled dist)",
  key: { id: keyId, prefix: keyPrefix, name: KEY_NAME, plaintext: "not-logged" },
  config: { concurrency: CONC, batchesIssued: batch, clientTimeoutMs: TIMEOUT_MS, maxBatchesCap: MAX_BATCHES },
  calls: {
    totalIssuedThroughSdk: callCounter,
    proven: counts.proven,
    failed: counts.failed,
    error500: counts.error500,
    networkErr: counts.network,
    http429: counts.quota429,
    meteredCalls_expected: meteredCalls + counts.network,
    ledgerUsed_directBody: directBody.quota?.used ?? null,
    overshootAboveLimit: directBody.quota?.used != null ? overshoot : null,
    overshootExplanation: "check-then-act gate: one in-flight batch (≤ CONC) can pass `remaining>0` before exhaustion lands",
  },
  timing: {
    burnWallMs: burnMs,
    totalWallMsInclPreflightAndConfirm: totalWallMs,
    first429WallMs: burnState.first429?.wallMs ?? null,
    serverLatencyMs: { n: sLat.length, avg: sLat.length ? Math.round(sLat.reduce((a, b) => a + b, 0) / sLat.length) : null, p50: pct(sLat, 50), p95: pct(sLat, 95) },
    clientWallLatencyMs: { n: wLat.length, p50: pct(wLat, 50), p95: pct(wLat, 95) },
  },
  boundary: {
    first429: burnState.first429
      ? { callIndex: burnState.first429.callIndex, wallMs: burnState.first429.wallMs, message: burnState.first429.message, retryAt: burnState.first429.retryAt }
      : null,
    lastPre429SdkSnapshot: lastPre429Snapshot,
    directFetch: direct,
    expectedResetEpoch: expectedReset,
    expectedResetIso: new Date(expectedReset * 1000).toISOString(),
  },
  confirm5,
  ledgerNote,
  assertions,
  verdict: Object.values(assertions).every((v) => v === true) ? "ALL ASSERTIONS PASSED — 429 PATH PROVEN LIVE" : "ASSERTIONS FAILED — SEE ABOVE",
};

console.log("\n════════ SUMMARY (honest JSON — every number from this run) ════════");
console.log(JSON.stringify(summary, null, 2));

/* persist for the doc writer */
writeFileSync(
  "tool-results/m1-429-burn-summary.json",
  JSON.stringify({ summary, confirm5 }, null, 2),
);
console.log("\nsummary saved → tool-results/m1-429-burn-summary.json");

process.exit(Object.values(assertions).every((v) => v === true) ? 0 : 1);
