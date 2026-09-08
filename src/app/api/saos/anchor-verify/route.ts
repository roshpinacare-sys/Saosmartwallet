import { NextResponse } from "next/server";

import { verifyIdentityAnchor } from "@/lib/anchor-verify";

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
 */
export async function POST(req: Request) {
  let username: string | undefined;
  try {
    const body = (await req.json()) as { username?: string };
    username = typeof body?.username === "string" ? body.username : undefined;
  } catch {
    // empty body — default username applies
  }
  const result = await verifyIdentityAnchor(username);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}

/** GET convenience: /api/saos/anchor-verify?username=headcorner */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const username = url.searchParams.get("username") ?? undefined;
  const result = await verifyIdentityAnchor(username);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
