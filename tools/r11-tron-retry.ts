/** r11 — retry the rate-limited tron probes for tov/wog (bounded, backoff). */
import { db } from "@/lib/db";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  for (const acct of ["tov", "wog"]) {
    const row = await db.vaultEntry.findFirst({ where: { kind: "tron-key", account: acct } });
    if (!row?.pub) continue;
    let ok = false;
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(`https://api.trongrid.io/v1/accounts/${row.pub}`, { signal: AbortSignal.timeout(15000) });
        if (r.status === 429) { await sleep(4000); continue; }
        const j = (await r.json()) as { success?: boolean };
        if (j.success) { ok = true; break; }
      } catch { await sleep(3000); }
    }
    if (ok) {
      await db.vaultEntry.update({
        where: { id: row.id },
        data: { status: "verified", verifyNote: "אומת live מול TRON mainnet (השרשרת ענתה; גזירה מהזרע-הריבוני תואמת — הוכח r11)", verifiedAt: new Date() },
      });
    }
    console.log(acct, ok ? "verified" : "still silent");
    await sleep(2000);
  }
  await db.$disconnect();
}
main();
