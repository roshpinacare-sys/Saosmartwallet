/** r16 forensics: steem vault entries — public fields only (no decryption). */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const steem = await db.vaultEntry.findMany({
    where: { chain: "steem" },
    orderBy: [{ account: "asc" }, { role: "asc" }],
  });
  console.log(`=== VAULT chain=steem: ${steem.length} entries ===`);
  const byAcct = new Map<string, typeof steem>();
  for (const e of steem) {
    const arr = byAcct.get(e.account || "?") || [];
    arr.push(e); byAcct.set(e.account || "?", arr);
  }
  for (const [acct, arr] of [...byAcct.entries()].sort()) {
    console.log(`\n-- ${acct} (${arr.length})`);
    for (const e of arr) {
      console.log(`   ${e.role} | status=${e.status} | pub=${(e.pub || "∅").slice(0, 12)}… | source=${e.source || "-"} | note=${(e.verifyNote || "").slice(0, 90)} | verifiedAt=${e.verifiedAt?.toISOString() || "-"}`);
    }
  }
  // memory entries about rotation (field is body, not content)
  const mem = await db.gateMemory.findMany({ where: { OR: [{ body: { contains: "rotat" } }, { body: { contains: "סיבוב" } }] } });
  console.log(`\n=== GateMemory rotation mentions: ${mem.length}`);
  for (const m of mem.slice(0, 20)) console.log(`   [${m.key}] ${(m.body || "").slice(0, 160)}`);
  await db.$disconnect();
}
main();

export {};
