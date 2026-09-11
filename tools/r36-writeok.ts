/** r36 — live SQLite write proof right after the clean restart (the SQLITE halacha check). */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const r = await db.$queryRawUnsafe<Array<{ k: string }>>(`UPDATE GateState SET value = value, updatedAt = updatedAt WHERE key = 'heart' RETURNING key AS k`);
console.log("WRITE-OK:", r.length === 1 ? "yes" : "no", JSON.stringify(r));
await db.$disconnect();
