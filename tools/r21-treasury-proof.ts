/**
 * r21 — TREASURY-TRUTH live proof over HTTP:
 * mint a session → measure the fleet's money on all three rails
 * (GET /api/gate/treasury?force=1) → sanity-check the sovereign-hand queue
 * → REVOKE the session (hygiene: a proof session never outlives its proof).
 */
const BASE = "http://localhost:3000";

interface RailRow { rail: string; ok: boolean; liquidSymbol: string; debtSymbol: string; accounts: Array<{ account: string; liquid: string; debt: string; liquidNum: number; debtNum: number }>; totals: { liquid: number; debt: number }; error?: string }

async function main() {
  const s = await fetch(`${BASE}/api/gate/session`, { method: "POST" });
  const sj = (await s.json()) as { ok: boolean; token?: string };
  if (!sj.ok || !sj.token) throw new Error(`session mint failed: ${JSON.stringify(sj)}`);
  const H = { Authorization: `Bearer ${sj.token}` };
  try {
    const t = await fetch(`${BASE}/api/gate/treasury?force=1`, { headers: H });
    const tj = (await t.json()) as { ok: boolean; measuredAt?: string; rails?: RailRow[]; fleet?: Record<string, number> };
    if (!tj.ok || !tj.rails) throw new Error(`treasury failed: ${JSON.stringify(tj).slice(0, 300)}`);
    console.log(`TREASURY measuredAt=${tj.measuredAt}`);
    for (const r of tj.rails) {
      if (!r.ok) {
        console.log(`  ${r.rail.toUpperCase()}: ERROR — ${r.error}`);
        continue;
      }
      console.log(`  ${r.rail.toUpperCase()}: ${r.totals.liquid} ${r.liquidSymbol} · ${r.totals.debt} ${r.debtSymbol} (${r.accounts.length} accounts)`);
      for (const a of r.accounts) {
        if (a.liquidNum > 0 || a.debtNum > 0) console.log(`      ${a.account.padEnd(14)} ${a.liquid.padEnd(18)} ${a.debt}`);
      }
    }
    const o = await fetch(`${BASE}/api/gate/orders`, { headers: H });
    const oj = (await o.json()) as { ok: boolean; vaultOpen?: boolean; signedToday?: number; orders?: unknown[] };
    console.log(`SOVEREIGN-HAND: vaultOpen=${oj.vaultOpen} signedToday=${oj.signedToday} queue=${oj.orders?.length ?? 0}`);
  } finally {
    const l = await fetch(`${BASE}/api/gate/lock`, { method: "POST", headers: H });
    console.log(`session revoked: ${l.status}`);
    const after = await fetch(`${BASE}/api/gate/treasury`, { headers: H });
    console.log(`treasury after revoke: ${after.status} (401 expected — fail closed)`);
  }
}
main().catch((e) => { console.error("proof crashed:", e); process.exit(1); });
