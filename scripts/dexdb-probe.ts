import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
try {
  const tables = await db.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`);
  console.log(`tables=${tables.map(t=>t.name).join(",")}`);
  const h = await db.$queryRawUnsafe<{ mh: string }[]>(`SELECT CAST(MAX(height) AS TEXT) as mh FROM BlockHeader`);
  console.log(`maxHeight=${h[0]?.mh}`);
  const snap = await db.$queryRawUnsafe<{ c: string }[]>(`SELECT CAST(COUNT(*) AS TEXT) as c FROM ChainSnapshot`);
  console.log(`snapshots=${snap[0]?.c}`);
} catch (e) { console.error("ERR:", (e as Error).message.slice(0, 300)); }
finally { await db.$disconnect(); }
