import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // r45 efficiency: per-query logging removed — the heart + sessions write
    // constantly and every query line went through the dev console pipe.
    // Errors still surface through thrown exceptions; nothing is silenced.
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db