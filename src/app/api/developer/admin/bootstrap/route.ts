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
 *
 * First-caller-wins is the documented trust model of this sandbox (the same
 * trust level the console had BEFORE gating existed); from the second call on
 * the gate is real. Rate-limited to blunt that race window.
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
