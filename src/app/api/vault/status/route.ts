// Vault status — full control matrix (public keys only, never plaintext).
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireOwner } from '@/lib/auth';

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

  return NextResponse.json({
    ok: true,
    totals: { keys: keys.length, verified: keys.filter(k => k.verified).length, accounts: Object.keys(byAccount).length },
    byAccount,
    guard: guard ? { ownerLock: guard.ownerLock, note: guard.note, updatedAt: guard.updatedAt } : { ownerLock: true, note: '', updatedAt: null },
    agents: agents.map(a => ({ name: a.name, capabilities: a.capabilities, status: a.status, lastSeenAt: a.lastSeenAt })),
    sessions, tasksOpen,
  });
}
