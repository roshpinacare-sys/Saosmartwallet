export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { bootstrapAdminCredential } from "@/lib/admin-auth";
import { clientIpOf, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/developer/admin/bootstrap — create the admin credential ONCE.
 *
 *   201 { ok, created: true,  token, warning }  — the ONLY time the plaintext
 *                                                 token is ever returned
 *   200 { ok, created: false, exists: true }    — already bootstrapped; the
 *                                                 existing token must be used
 *                                                 (or set SAOS_ADMIN_TOKEN)
 *   429                                          — rate-limited (5/min/IP)
 *   503 { ok: false, error: "bootstrap-locked" } — §1 deny-by-default (directive
 *                                                  1a173c6ac120ccb1): the first-caller-wins
 *                                                  ceremony is LOCKED unless the operator
 *                                                  explicitly arms it (ALLOW_ADMIN_BOOTSTRAP=1
 *                                                  in the env) or a credential already exists
 *                                                  (SAOS_ADMIN_TOKEN or a prior bootstrap row).
 *                                                  Rationale: on any public deploy the first
 *                                                  anonymous POST used to own the admin API.
 *                                                  Locking the ceremony is strictly safer: an
 *                                                  unbootstrapped deployment now fails closed,
 *                                                  and a bootstrapped one is unaffected.
 */
export async function POST(req: Request) {
  const rl = rateLimit(`admin-bootstrap:${clientIpOf(req)}`, 5, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "too many bootstrap attempts — retry later" },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }
  const result = await bootstrapAdminCredential();
  if (result.source === "env") {
    return NextResponse.json(
      { ok: true, created: false, exists: true, source: "env", note: "SAOS_ADMIN_TOKEN governs admin auth — nothing to bootstrap" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!result.created) {
    return NextResponse.json(
      { ok: true, created: false, exists: true, source: "db", note: "admin credential already exists — authenticate with its token" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  // §1 deny-by-default: a FRESH credential mint is now a supervised ceremony.
  if (process.env.ALLOW_ADMIN_BOOTSTRAP !== "1") {
    return NextResponse.json(
      {
        ok: false,
        error: "bootstrap-locked",
        note: "no admin credential exists and the bootstrap ceremony is locked (deny-by-default). Set ALLOW_ADMIN_BOOTSTRAP=1 in the operator env for ONE supervised first-boot, or set SAOS_ADMIN_TOKEN",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    {
      ok: true,
      created: true,
      token: result.token,
      warning: "Copy it now — this exact value is never shown again (only its SHA-256 is stored).",
    },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
