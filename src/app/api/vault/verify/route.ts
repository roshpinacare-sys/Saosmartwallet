// Re-verify every chain key in the vault against the live chains (watchdog).
// This is the heartbeat that makes sure "it never happens to us again" — any key
// that silently dies on-chain is flagged within minutes.
//
// FIX(Roast-65 · verify-all-budget): הראוט היה לולאה-סריאלית-ללא-תקציב — 148 מפתחות
// × (RPC עד-15ש׳ + כתיבת-DB) = עד-~37-דקות-בבקשה-אחת, בעוד-ה-UI מפעיל-אותו-כל-5-דקות
// → ריצות-חופפות, סערת-RPC, ו-refresh-שלא-רואה-נתונים. עכשיו:
//   1. הגנת-חפיפה — ריצה-פעילה מחזירה inFlight:true-כנה (לא-משקרת-שנבדק)
//   2. תקציב-זמן (VAULT_VERIFY_BUDGET_MS, ברירת-מחדל 50ש׳) — מה-שהספיק נבדק,
//      השאר skipped-כנה (ולא "failed" — שום-עדכון-DB שלילי על-מה-שלא-נבדק)
//   3. מטמון-getAccount-פר-(chain,account) — מפתחות-על-אותו-חשבון חולקים-שליפה-אחת
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireOwner } from '@/lib/auth';
import { verifyWif, getAccount, type AccountAuths } from '@/lib/chain';
import { decryptSecret } from '@/lib/vault';
import { audit, relayBroadcast } from '@/lib/audit';
import type { Chain } from '@/lib/keys';

// FIX(Roast-65 · overlap-guard): מונה-ריצות-פעילות ברמת-המודול — אפס-חפיפה.
let inFlight = 0;

const BUDGET_MS = Math.max(10_000, Number(process.env.VAULT_VERIFY_BUDGET_MS ?? 50_000));

export async function POST(req: NextRequest) {
  const owner = await requireOwner(req);
  if (!owner) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  // FIX(Roast-65 · overlap-guard): כנות-לפני-הכל — ריצה-כפולה לא מתחזה לבדיקה.
  if (inFlight > 0) {
    return NextResponse.json({
      ok: true, inFlight: true, checked: 0, dead: 0, skipped: 0, results: [],
      note: 'אימות-קודם עדיין רץ — הבקשה הזו לא בוצעה (אפס-חפיפה)',
    });
  }
  inFlight++;
  const started = Date.now();
  const acctCache = new Map<string, Promise<AccountAuths | null>>(); // FIX(Roast-65): שליפה-משותפת-פר-חשבון
  const cachedGet = (chain: Chain, account: string): Promise<AccountAuths | null> => {
    const k = `${chain}:${account}`;
    let p = acctCache.get(k);
    if (!p) { p = getAccount(chain, account); acctCache.set(k, p); }
    return p;
  };

  try {
    const keys = await db.vaultKey.findMany({ where: { chain: { in: ['steem', 'hive', 'blurt'] } } });
    const results: Array<{ account: string; chain: string; role: string; ok: boolean; roles: string[]; error?: string; skipped?: boolean }> = [];
    let skipped = 0;

    for (const k of keys) {
      // FIX(Roast-65 · budget): מה-שלא-נכנס-לתקציב — skipped-כנה, ללא-כתיבת-DB
      // שלילית (המפתח-לא-נבדק ≠ המפתח-מת). ה-UI-ממשיך-לתזמן-ריצות — ייתפס-בהמשך.
      if (Date.now() - started >= BUDGET_MS) { skipped++; continue; }
      let wif = '';
      try {
        wif = decryptSecret(k.cipher);
      } catch {
        await db.vaultKey.update({ where: { id: k.id }, data: { verified: false, lastError: 'decrypt failed', lastVerifiedAt: new Date() } });
        results.push({ account: k.account, chain: k.chain, role: k.role, ok: false, roles: [], error: 'decrypt failed' });
        continue;
      }
      const acct = await cachedGet(k.chain as Chain, k.account);
      const { result } = await verifyWif(wif, k.account, k.chain as Chain, k.pubKey || undefined, acct);
      await db.vaultKey.update({
        where: { id: k.id },
        data: { verified: result.ok, lastVerifiedAt: new Date(), lastError: result.ok ? null : (result.error || 'no roles on chain') },
      });
      results.push({ account: k.account, chain: k.chain, role: k.role, ok: result.ok, roles: result.roles, error: result.error });
    }

    const dead = results.filter(r => !r.ok);
    await audit('verify-all', `${results.length} checked, ${dead.length} dead, ${skipped} skipped (budget ${BUDGET_MS}ms)`);
    await relayBroadcast('vault', { type: 'verify', checked: results.length, dead: dead.length, skipped });
    return NextResponse.json({ ok: true, checked: results.length, dead: dead.length, skipped, results });
  } finally {
    inFlight--;
  }
}
