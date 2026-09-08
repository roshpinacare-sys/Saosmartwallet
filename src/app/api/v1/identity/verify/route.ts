import { NextResponse } from "next/server";

import {
  QUOTA_HEADERS,
  PRODUCT_ENDPOINT,
  FREE_DAILY_QUOTA,
  meterCall,
  quotaFor,
  resolveApiKey,
  type VerifyOutcome,
} from "@/lib/api-keys";
import { verifyIdentityAnchor, type AnchorVerifyResult } from "@/lib/anchor-verify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/v1/identity/verify   — THE METERED PRODUCT (Model 1, Week 1)
 * Authorization: Bearer saos_live_…      Body: { "username"?: "headcorner" }
 *
 * Runs the REAL identity-anchor verification (public Steem RPC → latest
 * saos.id.v1 custom_json → EIP-191 ecrecover → same-scalar proof) and meters
 * the call in the usage ledger. Zero mock: same code path as the PROOFS demo,
 * wrapped in key auth + daily quota + usage accounting.
 *
 *   200  { …AnchorVerifyResult, meta:{ keyPrefix, outcome, latencyMs, quota } }
 *   401  missing/invalid/revoked key
 *   429  daily quota exhausted (until next UTC midnight)
 *
 * Every EXECUTED call consumes quota (PROVEN, FAILED, ERROR) — the service
 * performs real chain work in each case; this is stated in the console too.
 */
async function handle(req: Request, username: string | undefined): Promise<NextResponse> {
  const auth = await resolveApiKey(req);
  if (!auth.ok) {
    const detail =
      auth.reason === "missing"
        ? "missing Authorization: Bearer <api key>"
        : auth.reason === "revoked"
          ? "api key revoked"
          : "invalid api key";
    return NextResponse.json(
      {
        ok: false,
        error: `unauthorized: ${detail}`,
        docs: PRODUCT_ENDPOINT,
      },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const quota = await quotaFor(auth.keyId);
  if (quota.remaining <= 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "daily quota exceeded — resets at next UTC midnight",
        quota,
      },
      { status: 429, headers: { "Cache-Control": "no-store", ...QUOTA_HEADERS(quota) } },
    );
  }

  const t0 = Date.now();
  let result: AnchorVerifyResult;
  try {
    result = await verifyIdentityAnchor(username);
  } catch (e) {
    const latencyMs = Date.now() - t0;
    const q = await meterCall(auth.keyId, "ERROR", null, latencyMs);
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "verification failed",
        meta: { endpoint: PRODUCT_ENDPOINT, keyPrefix: auth.prefix, outcome: "ERROR", latencyMs, quota: q },
      },
      { status: 500, headers: { "Cache-Control": "no-store", ...QUOTA_HEADERS(q) } },
    );
  }
  const latencyMs = Date.now() - t0;
  const outcome: VerifyOutcome = result.ok ? "PROVEN" : "FAILED";
  const q = await meterCall(auth.keyId, outcome, result.username, latencyMs);

  return NextResponse.json(
    {
      ...result,
      meta: {
        endpoint: PRODUCT_ENDPOINT,
        keyPrefix: auth.prefix,
        outcome,
        latencyMs,
        quota: q,
        plan: { tier: "free", dailyCalls: FREE_DAILY_QUOTA },
      },
    },
    { status: 200, headers: { "Cache-Control": "no-store", ...QUOTA_HEADERS(q) } },
  );
}

export async function POST(req: Request) {
  let username: string | undefined;
  try {
    const body = (await req.json()) as { username?: string };
    username = typeof body?.username === "string" ? body.username : undefined;
  } catch {
    // empty body — default username applies
  }
  return handle(req, username);
}

/** GET convenience, same metering: /api/v1/identity/verify?username=headcorner */
export async function GET(req: Request) {
  const url = new URL(req.url);
  return handle(req, url.searchParams.get("username") ?? undefined);
}
