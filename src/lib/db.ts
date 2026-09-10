import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // FIX(Roast-63 · M7): שאילתות-SQL-מלאות-ללוג-רק-בפיתוח (היה-שופך-chat/sessions-ל-dev.log-בכל-ריצה)
    log: process.env.NODE_ENV === 'development' ? ['query'] : [],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db