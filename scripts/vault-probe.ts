import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
try {
  const n = await db.vaultKey.count();
  console.log(`count=${n}`);
  const rows = await db.vaultKey.findMany({
    where: { pubKey: { not: null } },
    select: { chain: true, account: true, role: true, pubKey: true },
    take: 15,
  });
  for (const r of rows) console.log(`${r.chain}/${r.account}/${r.role}: ${(r.pubKey ?? "").slice(0, 8)}…`);
} catch (e) {
  console.error("ERR:", (e as Error).message.slice(0, 600));
} finally {
  await db.$disconnect();
}
