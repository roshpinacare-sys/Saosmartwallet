import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'crypto';
import { issueChallenge, sweepExpired, CHALLENGE_TTL_MS } from '@/lib/siwe';

export const dynamic = 'force-dynamic';

/* ══ Sign-In Challenge — הוכחת-החזקה (proof-of-possession) ════════════════
 * FIX(Roast-63 · H7/H8): ההערה-הקודמת-קראה-לזה-"SIWE"-והציגה-digest-שמעולם-לא
 * חתמו-עליו — תיאטרון. כנות: המשתמש-מוכיח-החזקת-מפתח-רשת (WIF → פאב → סמכויות
 * על-השרשרת ב-login), וה-nonce הוא-anti-replay לזרימה-עצמה. המחסן-ב-@/lib/siwe
 * (route-מייצא-רק-handlers — חוזה-Next). fail-closed: בלי-נונס-תקף — אין-התחברות. */

export async function POST(req: NextRequest) {
  let body: { account?: string; chain?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'bad json' }, { status: 400 });
  }
  const account = (body.account || '').trim().toLowerCase();
  const chain = (body.chain || '').trim().toLowerCase();
  if (!account || !['steem', 'hive', 'blurt'].includes(chain)) {
    return NextResponse.json({ ok: false, error: 'חסר חשבון או רשת לא נתמכת (steem/hive/blurt)' }, { status: 400 });
  }
  sweepExpired();
  const nonce = randomBytes(16).toString('hex');
  const at = new Date().toISOString();
  const ch = issueChallenge(account, chain, nonce, at);
  const digest = createHash('sha256').update(ch.message).digest('hex');
  return NextResponse.json({ ok: true, nonce, message: ch.message, digest, expiresAt: Date.now() + CHALLENGE_TTL_MS });
}
