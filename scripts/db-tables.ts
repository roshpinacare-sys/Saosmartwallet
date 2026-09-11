import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
try {
  const tables = await db.$queryRawUnsafe<{ name: string; cnt: number }[]>(
    `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
  );
  console.log(`tables=${tables.map((t) => t.name).join(",")}`);
} catch (e) {
  console.error("ERR:", (e as Error).message.slice(0, 300));
} finally {
  await db.$disconnect();
}
