// Re-verify every chain key in the vault against the live chains (watchdog).
// This is the heartbeat that makes sure "it never happens to us again" — any key
// that silently dies on-chain is flagged within minutes.
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireOwner } from '@/lib/auth';
import { verifyWif } from '@/lib/chain';
import { decryptSecret } from '@/lib/vault';
import { audit, relayBroadcast } from '@/lib/audit';
import type { Chain } from '@/lib/keys';

export async function POST(req: NextRequest) {
  const owner = await requireOwner(req);
  if (!owner) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const keys = await db.vaultKey.findMany({ where: { chain: { in: ['steem', 'hive', 'blurt'] } } });
  const results: Array<{ account: string; chain: string; role: string; ok: boolean; roles: string[]; error?: string }> = [];

  for (const k of keys) {
    let wif = '';
    try {
      wif = decryptSecret(k.cipher);
    } catch {
      await db.vaultKey.update({ where: { id: k.id }, data: { verified: false, lastError: 'decrypt failed', lastVerifiedAt: new Date() } });
      results.push({ account: k.account, chain: k.chain, role: k.role, ok: false, roles: [], error: 'decrypt failed' });
      continue;
    }
    const { result } = await verifyWif(wif, k.account, k.chain as Chain, k.pubKey || undefined);
    await db.vaultKey.update({
      where: { id: k.id },
      data: { verified: result.ok, lastVerifiedAt: new Date(), lastError: result.ok ? null : (result.error || 'no roles on chain') },
    });
    results.push({ account: k.account, chain: k.chain, role: k.role, ok: result.ok, roles: result.roles, error: result.error });
  }

  const dead = results.filter(r => !r.ok);
  await audit('verify-all', `${results.length} checked, ${dead.length} dead`);
  await relayBroadcast('vault', { type: 'verify', checked: results.length, dead: dead.length });
  return NextResponse.json({ ok: true, checked: results.length, dead: dead.length, results });
}
