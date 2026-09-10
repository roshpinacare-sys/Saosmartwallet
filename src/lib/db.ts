import { PrismaClient } from '@prisma/client'

// FIX(Roast-68 · db-scope-guard-אם): ראי-תאום למגן של saos-dex — הפלטפורמה-האם
// רשאית לגעת רק ב-custom.db שלה (האסון-החי: מנוע-שירש-URL-שגוי שידד את טבלאות-הכספת).
const RAW_URL = process.env.DATABASE_URL ?? ''
const isMotherOwnDb = /custom\.db(\?|$)/.test(RAW_URL) && !/dex\.db/.test(RAW_URL)
if (!isMotherOwnDb) {
  throw new Error(
    `[platform] DATABASE_URL נדחה (fail-closed): האם רשאית לגעת רק ב-custom.db שלה — ` +
      `קיבלה: ${RAW_URL || '(חסר — הגדר DATABASE_URL ב-.env)'}`
  )
}

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