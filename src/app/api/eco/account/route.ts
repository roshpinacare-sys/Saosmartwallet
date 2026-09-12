export const runtime = "nodejs";

/**
 * GET /api/eco/account — live account lookup for the M3 networks
 * =============================================================
 * ?network=ethereum|solana&address=0x…|base58
 *   · ethereum — native ETH balance (+ ERC-20 when ?token=0x… present)
 *   · solana   — native SOL balance (+ all SPL token accounts)
 *
 * Zero mock: every number comes from the chain adapter over public RPC.
 * A bad address is a 400 with the adapter's honest reason.
 */

import { NextResponse } from "next/server";

import { getEthereumAdapter, getSolanaAdapter } from "../../../../../packages/chains";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const network = url.searchParams.get("network") ?? "";
  const address = url.searchParams.get("address") ?? "";
  const token = url.searchParams.get("token");

  if (!address) {
    return NextResponse.json({ ok: false, error: "address is required" }, { status: 400 });
  }

  try {
    if (network === "ethereum") {
      const eth = getEthereumAdapter();
      const account = await eth.getAccountInfo(address);
      const tokenBalance = token ? await eth.getTokenBalance(account.address, token) : null;
      return NextResponse.json(
        {
          ok: true,
          network: "ethereum",
          account,
          native: { symbol: "ETH", decimals: 18, amount: account.balance },
          token: tokenBalance,
          probedAt: new Date().toISOString(),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (network === "solana") {
      const sol = getSolanaAdapter();
      const account = await sol.getAccountInfo(address);
      const tokens = await sol.getTokenBalances(address);
      return NextResponse.json(
        {
          ok: true,
          network: "solana",
          account,
          native: { symbol: "SOL", decimals: 9, amount: account.balance },
          tokens,
          probedAt: new Date().toISOString(),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      { ok: false, error: "network must be ethereum or solana" },
      { status: 400 },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "probe failed" },
      { status: 400 },
    );
  }
}
