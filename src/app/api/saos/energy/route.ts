import { NextResponse } from "next/server";
import {
  planEnergize,
  minStakeForSettlements,
  ENERGY_PER_TRX_PER_DAY,
  BURN_SUN_PER_ENERGY,
  USDT_TRANSFER_ENERGY
} from "@/lib/saos/tron-energize";
import { hiveRcRecoveryPlan, HIVE_RC_REGEN_PCT_PER_DAY } from "@/lib/saos/anchor-gates";

export const dynamic = "force-dynamic";

// FIX(Roast-64-a · F6): GET ציבורי-זה כתב EvidenceReceipt בכל-קריאה — עבירה על
// עיקרון-הפלטפורמה "אין GET עם side-effects" + fork-race על prevDigest + catch
// שמחזיר ok:true עם digest שמעולם לא נשמר. עכשיו: קריאה-בלבד; receipt=null + הסבר.

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const net = (url.searchParams.get("net") ?? "tron").toLowerCase();

    if (net === "hive") {
      const rcPct = Number(url.searchParams.get("rc") ?? 0.6);
      const plan = hiveRcRecoveryPlan(rcPct);

      return NextResponse.json({
        ok: true,
        network: "HIVE",
        params: { regenPctPerDay: HIVE_RC_REGEN_PCT_PER_DAY, lightFloor: 8, heavyFloor: 12 },
        plan,
        receipt: null,
        note: "read-only: GET לא כותב קבלות-עדות (אין GET עם side-effects) — קבלה נרשמת רק בפעימת-עגינה מאומתת"
      });
    }

    // TRON energize (default)
    const trx = Math.max(0, Number(url.searchParams.get("trx") ?? 6500));
    const txs = Math.max(1, Number(url.searchParams.get("txs") ?? 4));
    const price = url.searchParams.get("price");
    const plan = planEnergize({
      trxStaked: trx,
      txsPerDayWanted: txs,
      trxPriceUsd: price !== null && Number.isFinite(Number(price)) ? Number(price) : null
    });

    return NextResponse.json({
      ok: true,
      network: "TRON",
      params: {
        sunPerTrx: 1_000_000,
        burnSunPerEnergy: BURN_SUN_PER_ENERGY,
        usdtTransferEnergy: USDT_TRANSFER_ENERGY,
        energyPerTrxPerDay: ENERGY_PER_TRX_PER_DAY
      },
      minStakeForSettlements: minStakeForSettlements(txs),
      plan,
      receipt: null,
      note: "read-only: GET לא כותב קבלות-עדות (אין GET עם side-effects) — קבלה נרשמת רק בפעימת-עגינה מאומתת"
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "energy failed" },
      { status: 200 }
    );
  }
}
