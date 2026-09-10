// Audit feed — the owner's eye on everything that happens.
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireOwner } from '@/lib/auth';

export async function GET(req: NextRequest) {
  // FIX(Roast-64-a · F11): היה-GET ציבורי-לגמרי (requireOwner מיובא-ומת — dead code)
  // ומטיף-grandUsd של-האחוזה + טביעות-אצבע של מפתחות מה-detail (login-ok/estate-scan).
  // עכשיו: owner-בלבד — ה-UI שולח authHeaders וממשיך להציג לבעלים; אנונימי = 403.
  const owner = await requireOwner(req);
  if (!owner) {
    return NextResponse.json(
      { ok: false, error: 'owner-only (יומן-האודיט מכיל פרטי-אחוזה וטביעות-מפתח)' },
      { status: 403 }
    );
  }
  const logs = await db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  return NextResponse.json({ ok: true, logs });
}
