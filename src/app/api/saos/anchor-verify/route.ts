export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { verifyIdentityAnchor } from "@/lib/anchor-verify";
import { clientIpOf, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/saos/anchor-verify  { username?: string }
 *
 * Demo 1 — Identity Anchor live proof. Reads the latest saos.id.v1
 * custom_json op straight from Steem mainnet, recovers the EVM address
 * from the EIP-191 signature with ecrecover, and proves the same
 * secp256k1 scalar is the live active authority on the Graphene chains.
 * Zero mock: everything is fetched from public chains at request time.
 *
 * SECURITY: this route proxies live external-RPC work per request —
 * per-IP rate limit (10/min) so a bursty client cannot use our server
 * as an amplifier against the public nodes. The optional username is
 * charset/length-capped before it reaches any upstream query.
 */
const USERNAME_RE = /^[a-z0-9.\-]{1,64}$/;

function verifyGate(req: Request): NextResponse | null {
  const rl = rateLimit(`anchor-verify:${clientIpOf(req)}`, 10, 60_000);
  if (rl.ok) return null;
  return NextResponse.json(
    {
      ok: false,
      error: `too many verifications — retry in ${rl.retryAfterSeconds}s`,
      code: "RATE_LIMITED",
    },
    { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(rl.retryAfterSeconds) } },
  );
}

function sanitizeUsername(raw: string | undefined): string | undefined {
  const u = raw?.trim().toLowerCase();
  if (!u) return undefined;
  return USERNAME_RE.test(u) ? u : undefined;
}

export async function POST(req: Request) {
  const denied = verifyGate(req);
  if (denied) return denied;
  let username: string | undefined;
  try {
    const body = (await req.json()) as { username?: string };
    username = typeof body?.username === "string" ? body.username : undefined;
  } catch {
    // empty body — default username applies
  }
  const result = await verifyIdentityAnchor(sanitizeUsername(username));
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}

/** GET convenience: /api/saos/anchor-verify?username=headcorner */
export async function GET(req: Request) {
  const denied = verifyGate(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const username = url.searchParams.get("username") ?? undefined;
  const result = await verifyIdentityAnchor(sanitizeUsername(username));
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
