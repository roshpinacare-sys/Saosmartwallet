// Logout — real revocation, both carriers. The session is revoked in the DB
// (so the Bearer token dies too, not just the cookie) and the httpOnly cookie
// is expired on the response. Always audited; idempotent when already logged out.
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sessionFrom, SESSION_COOKIE, cookieOptions } from '@/lib/auth';
import { audit, relayBroadcast } from '@/lib/audit';

export async function POST(req: NextRequest) {
  const session = await sessionFrom(req);
  if (session) {
    await db.session.update({ where: { id: session.id }, data: { revoked: true } });
    await audit('logout', `by=${session.label} scope=${session.scope}`);
  }
  const res = NextResponse.json({ ok: true, revoked: !!session });
  // Expire the cookie in every carrier case — even when the session was
  // already revoked/expired, the stale cookie must not linger in the browser.
  res.cookies.set(SESSION_COOKIE, '', cookieOptions(0));
  if (session) relayBroadcast('vault', { logout: session.label });
  return res;
}
