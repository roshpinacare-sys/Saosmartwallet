// Audit feed — the owner's eye on everything that happens.
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireOwner } from '@/lib/auth';

export async function GET(req: NextRequest) {
  // READ is public (personal system); mutations stay owner-only and audited.
  const logs = await db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  return NextResponse.json({ ok: true, logs });
}
