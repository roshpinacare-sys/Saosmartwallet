/**
 * GET /api/steem/wallet?name=account — public wallet dashboard data.
 * Balances (STEEM/SBD/VESTS→SP), RC manabar, and open DEX orders.
 * READ-ONLY: public chain data only — no keys are ever involved here.
 */

import { NextResponse } from "next/server";

import { STEEM_ENDPOINT, steemAdapter, steemMarket } from "@/lib/steem-server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const name = (url.searchParams.get("name") ?? "").trim().toLowerCase();
  if (!/^[a-z0-9.\-]{3,16}$/.test(name)) {
    return NextResponse.json({ ok: false, error: "invalid account name" }, { status: 400 });
  }
  const adapter = steemAdapter();
  const market = steemMarket();
  try {
    const [account, rc, chainStatus, openOrders] = await Promise.all([
      adapter.getAccount(name),
      adapter.getRcManabar(name).catch(() => null),
      market.chainStatus(),
      market.openOrders(name).catch(() => []),
    ]);
    if (!account) {
      return NextResponse.json({ ok: false, error: `account not found: ${name}` }, { status: 404 });
    }
    // VESTS → STEEM conversion, integer math: SP = vests × fund / shares.
    let spSatoshis = 0;
    const vestsMatch = /^(\d+)(?:\.(\d+))?\s+VESTS$/.exec(account.balances.vestingShares ?? "");
    if (vestsMatch && chainStatus.totalVestingSharesSatoshis > 0) {
      const scale = 10 ** (vestsMatch[2]?.length ?? 0);
      const vestsSat = Number(vestsMatch[1]) * scale + Number(vestsMatch[2] ?? "0");
      spSatoshis = Math.floor(
        (vestsSat * chainStatus.totalVestingFundSatoshis) / chainStatus.totalVestingSharesSatoshis,
      );
    }
    return NextResponse.json(
      {
        ok: true,
        endpoint: STEEM_ENDPOINT,
        account: {
          name: account.name,
          created: account.created,
          balances: account.balances,
          spSatoshis,
        },
        rc,
        openOrders,
        chainStatus: { headBlock: chainStatus.headBlock, time: chainStatus.time },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "wallet lookup failed" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
