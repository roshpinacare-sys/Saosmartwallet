/**
 * vault-inventory.ts — roast-75 · מלאי-כספת-מלא (תוויות-בלבד — אפס-סודות)
 * מדפיס: account · chain · role · pubKey/address (ציבורי) · verified · fingerprint-תווית
 * לעולם לא בוחר cipher / לא מדפיס חומר-מפתח.
 */
import { PrismaClient } from "@prisma/client";

async function main(): Promise<void> {
  const db = new PrismaClient();
  try {
    const rows = await db.vaultKey.findMany({
      select: {
        account: true, chain: true, role: true, pubKey: true,
        address: true, verified: true, fingerprint: true, source: true, note: true,
      },
      orderBy: [{ chain: "asc" }, { account: "asc" }, { role: "asc" }],
    });
    console.log(`TOTAL=${rows.length}`);
    const byChain = new Map<string, number>();
    for (const r of rows) byChain.set(r.chain, (byChain.get(r.chain) ?? 0) + 1);
    console.log(`BY_CHAIN=${[...byChain.entries()].map(([c, n]) => `${c}:${n}`).join(" · ")}`);
    console.log("---");
    for (const r of rows) {
      const pub = r.pubKey ? `pub=${r.pubKey.slice(0, 12)}…` : "";
      const addr = r.address ? `addr=${r.address.slice(0, 12)}…` : "";
      const fp = r.fingerprint ? `fp=${r.fingerprint.slice(0, 6)}…` : "";
      console.log(
        `${r.chain.padEnd(8)} ${r.account.padEnd(24)} ${r.role.padEnd(9)} ${pub}${addr}${fp} verified=${r.verified ? 1 : 0} src=${r.source}${r.note ? ` note=${r.note.slice(0, 40)}` : ""}`
      );
    }
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => { console.error(`[inventory] FAILED: ${String((e as Error).message ?? e).slice(0, 200)}`); process.exit(1); });
