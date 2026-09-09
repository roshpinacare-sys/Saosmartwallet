// Vault status — full control matrix (public keys only, never plaintext)
// + live on-chain balances for every chain account (cached, stale-while-revalidate).
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireOwner } from '@/lib/auth';
import { getAccount } from '@/lib/chain';

const BAL_TTL_MS = 180_000; // refresh balances at most every 3 minutes

type BalMap = Record<string, Record<string, string>>; // `${account}@${chain}` → balances

// globalThis cache — survives dev hot-reload and keeps status snappy
const g = globalThis as unknown as { __svBal?: { at: number; data: BalMap } };

async function refreshBalances(accounts: string[]): Promise<void> {
  const pairs = await Promise.all(
    accounts.flatMap(a => (['steem', 'hive'] as const).map(async c => {
      const acc = await getAccount(c, a);
      return [`${a}@${c}`, acc?.balances ?? {}] as const;
    }))
  );
  g.__svBal = { at: Date.now(), data: Object.fromEntries(pairs) };
}

export async function GET(req: NextRequest) {
  const owner = await requireOwner(req);
  if (!owner) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const keys = await db.vaultKey.findMany({ orderBy: [{ account: 'asc' }, { chain: 'asc' }, { role: 'asc' }] });
  const guard = await db.guardState.findUnique({ where: { id: 'singleton' } });
  const agents = await db.agentNode.findMany({ orderBy: { createdAt: 'desc' } });
  const [{ count: sessions }, { count: tasksOpen }] = await Promise.all([
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
  const chainAccounts = [...new Set(keys.filter(k => k.chain === 'steem' || k.chain === 'hive').map(k => k.account))];
  let balances: BalMap = g.__svBal?.data ?? {};
  if (!g.__svBal) {
    await refreshBalances(chainAccounts); // first call in this process — fetch now
    balances = g.__svBal?.data ?? {};
  } else if (Date.now() - g.__svBal.at > BAL_TTL_MS) {
    void refreshBalances(chainAccounts).catch(() => { /* keep stale */ });
  }

  return NextResponse.json({
    ok: true,
    me: owner.label,
    totals: { keys: keys.length, verified: keys.filter(k => k.verified).length, accounts: Object.keys(byAccount).length },
    byAccount,
    balances,
    guard: guard ? { ownerLock: guard.ownerLock, note: guard.note, updatedAt: guard.updatedAt } : { ownerLock: true, note: '', updatedAt: null },
    agents: agents.map(a => ({ name: a.name, capabilities: a.capabilities, status: a.status, lastSeenAt: a.lastSeenAt })),
    sessions, tasksOpen,
  });
}
