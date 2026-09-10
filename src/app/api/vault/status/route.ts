// Vault status — TWO-TIER by auth (FIX Roast-65-b · M4):
//  · anonymous → minimal {ok, me:null, counts-only} — אפס מטריצת-מפתחות (byAccount),
//    אפס fingerprints, אפס יתרות-חיות, אפס רוסטר-סוכנים, אפס ספירת-סשנים.
//    היה: חבילת-recon שלמה לתוקף אנונימי (65-b MED-4).
//  · owner (requireOwner) → המטריצה-המלאה + יתרות-חיות (מפתחות-ציבוריים בלבד,
//    לעולם לא plaintext). ה-shape לא שונה עבור ה-UI המחובר — page.tsx שולח
//    authHeaders() ו-vault-view/ops-view/settings-view קוראים את התגובה המאומתת.
// כל MUTATION נשאר owner-session protected.
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sessionFrom, requireOwner } from '@/lib/auth';
import { getAccount } from '@/lib/chain';

const BAL_TTL_MS = 180_000; // refresh balances at most every 3 minutes

type BalMap = Record<string, Record<string, string>>; // `${account}@${chain}` → balances

// globalThis cache — survives dev hot-reload and keeps status snappy
const g = globalThis as unknown as { __svBal?: { at: number; data: BalMap } };

async function refreshBalances(accounts: string[]): Promise<void> {
  const pairs = await Promise.all(
    accounts.flatMap(a => (['steem', 'hive', 'blurt'] as const).map(async c => {
      const acc = await getAccount(c, a);
      return [`${a}@${c}`, acc?.balances ?? {}] as const;
    }))
  );
  g.__svBal = { at: Date.now(), data: Object.fromEntries(pairs) };
}

export async function GET(req: NextRequest) {
  const session = await sessionFrom(req);
  if (session && session.scope !== 'owner') return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  // FIX(Roast-65-b · M4): fail-closed — המטריצה-המלאה רק מאחורי requireOwner
  // (לא מספיק session.scope='owner' — requireOwner מאמת גם את זהות-המפעיל).
  const owner = await requireOwner(req);

  if (!owner) {
    // אנונימי/טוקן-פג: ספירות-בלבד + מכלים-ריקים. המכלים-הריקים נשמרים בשביל
    // תאימות-shape מלאה ל-UI (ops-view קורא status?.agents.filter, settings-view
    // קורא status?.guard.ownerLock) — אפס-מידע, בלי לשבור רינדור אנונימי.
    const keys = await db.vaultKey.findMany({ select: { account: true, verified: true } });
    return NextResponse.json({
      ok: true,
      me: null,
      totals: {
        keys: keys.length,
        verified: keys.filter(k => k.verified).length,
        accounts: new Set(keys.map(k => k.account)).size,
      },
      byAccount: {}, // ריק — אין מלאי-מפתחות לאנונימי
      balances: {}, // ריק — אין יתרות-חיות לאנונימי
      guard: { ownerLock: true, note: '', updatedAt: null }, // תצוגת-ברירת-מחדל fail-closed
      agents: [], // ריק — אין רוסטר-סוכנים לאנונימי
      sessions: null, // ספירת-סשנים = recon — לא נחשפת
      tasksOpen: null,
    });
  }

  const keys = await db.vaultKey.findMany({ orderBy: [{ account: 'asc' }, { chain: 'asc' }, { role: 'asc' }] });
  const guard = await db.guardState.findUnique({ where: { id: 'singleton' } });
  const agents = await db.agentNode.findMany({ orderBy: { createdAt: 'desc' } });
  // FIX(Roast-63 · H8): count() מחזיר-Number — לא-אובייקט-{count} (היה-undefined-בריצה)
  const [sessions, tasksOpen] = await Promise.all([
    db.session.count({ where: { revoked: false, expiresAt: { gt: new Date() }, scope: 'owner' } }),
    db.taskItem.count({ where: { status: { in: ['open', 'claimed'] } } }),
  ]);

  const byAccount: Record<string, Record<string, { role: string; verified: boolean; lastVerifiedAt: Date | null; pubKey: string | null; fingerprint: string; source: string; lastError: string | null }>> = {};
  for (const k of keys) {
    byAccount[k.account] ||= {};
    byAccount[k.account][`${k.chain}:${k.role}`] = {
      role: k.role, verified: k.verified, lastVerifiedAt: k.lastVerifiedAt,
      pubKey: k.pubKey, fingerprint: k.fingerprint, source: k.source, lastError: k.lastError,
    };
  }

  // Live balances: serve stale cache immediately; refresh in background when stale.
  const chainAccounts = [...new Set(keys.filter(k => ['steem', 'hive', 'blurt'].includes(k.chain)).map(k => k.account))];
  // FIX(Roast-63 · H8): היה-Property-'data'-on-'never' (היצרות-narrowing-חוצה-await)
  const cached = g.__svBal;
  let balances: BalMap = cached?.data ?? {};
  if (!cached) {
    await refreshBalances(chainAccounts); // first call in this process — fetch now
    balances = g.__svBal?.data ?? {};
  } else if (Date.now() - cached.at > BAL_TTL_MS) {
    void refreshBalances(chainAccounts).catch(() => { /* keep stale */ });
  }

  return NextResponse.json({
    ok: true,
    me: session ? session.label : null,
    totals: { keys: keys.length, verified: keys.filter(k => k.verified).length, accounts: Object.keys(byAccount).length },
    byAccount,
    balances,
    guard: guard ? { ownerLock: guard.ownerLock, note: guard.note, updatedAt: guard.updatedAt } : { ownerLock: true, note: '', updatedAt: null },
    agents: agents.map(a => ({ name: a.name, capabilities: a.capabilities, status: a.status, lastSeenAt: a.lastSeenAt })),
    sessions, tasksOpen,
  });
}
