// Guard — the "never again" switch. ownerLock=true forbids owner-authority
// mutations through this platform. Toggling requires an owner session + explicit
// confirmation text, and is always audited.
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireOwner } from '@/lib/auth';
import { audit, relayBroadcast } from '@/lib/audit';

export async function GET(req: NextRequest) {
  const g = await db.guardState.findUnique({ where: { id: 'singleton' } });
  return NextResponse.json({ ok: true, ownerLock: g ? g.ownerLock : true, note: g?.note || '', updatedAt: g?.updatedAt || null });
}

export async function POST(req: NextRequest) {
  const owner = await requireOwner(req);
  if (!owner) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const enable = body.enable;
  const confirm = String(body.confirm || '');

  if (typeof enable !== 'boolean') return NextResponse.json({ ok: false, error: 'enable must be boolean' }, { status: 400 });
  if (!enable && confirm !== 'אני הבעלים ואני מאשר ביטול נעילת-owner') {
    return NextResponse.json({ ok: false, error: 'נדרש אישור מפורש: אני הבעלים ואני מאשר ביטול נעילת-owner' }, { status: 403 });
  }

  const g = await db.guardState.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', ownerLock: enable },
    update: { ownerLock: enable },
  });
  await audit(enable ? 'guard-ownerlock-ON' : 'guard-ownerlock-OFF', `by=${owner.label}`);
  await relayBroadcast('guard', { ownerLock: g.ownerLock });
  return NextResponse.json({ ok: true, ownerLock: g.ownerLock });
}
