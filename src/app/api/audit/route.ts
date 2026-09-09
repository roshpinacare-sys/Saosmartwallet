// Audit feed — the owner's eye on everything that happens.
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireOwner } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const owner = await requireOwner(req);
  if (!owner) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const logs = await db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  return NextResponse.json({ ok: true, logs });
}
