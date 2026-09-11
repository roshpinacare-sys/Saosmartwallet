/**
 * r21 — TREASURY-TRUTH direct proof (no session needed):
 * the fleet roster comes from the vault DB (names+pubs are plaintext),
 * the balances come from the CHAINS — all public read data. The API route
 * stays operator-scoped; this tool proves the same snapshot the operator's
 * page will render, without touching any secret (nothing here decrypts).
 */
import { getTreasurySnapshot } from "../src/lib/gate/treasury";
import { fleetAccountsForRail, CONVERSION_RAILS, BLURT_EXCLUSION } from "../src/lib/gate/dex-rail";

async function main() {
  console.log("=== r21 TREASURY-TRUTH (direct chain reads) ===\n");
  const snap = await getTreasurySnapshot(true);
  for (const r of snap.rails) {
    if (!r.ok) {
      console.log(`${r.rail.toUpperCase()}: ERROR — ${r.error}`);
      continue;
    }
    console.log(`${r.rail.toUpperCase()} — ${r.accounts.length} accounts: ${r.totals.liquid} ${r.liquidSymbol} · ${r.totals.debt} ${r.debtSymbol}`);
    for (const a of r.accounts) {
      if (a.liquidNum > 0 || a.debtNum > 0) {
        console.log(`   ${a.account.padEnd(14)} liquid=${a.liquid.padEnd(20)} debt=${a.debt}`);
      }
    }
  }
  console.log("\n=== SIGNING ROSTERS (vault-verified active keys) ===");
  for (const rail of ["steem", "hive"] as const) {
    const roster = await fleetAccountsForRail(rail);
    console.log(`${rail}: ${roster.length} signable → ${roster.join(", ")}`);
    console.log(`   pair: wire=${JSON.stringify(CONVERSION_RAILS[rail].wire)} display=${JSON.stringify(CONVERSION_RAILS[rail].display)}`);
  }
  console.log(`\nblurt: EXCLUDED — ${BLURT_EXCLUSION}`);
}
main().catch((e) => { console.error("crashed:", e); process.exit(1); });
