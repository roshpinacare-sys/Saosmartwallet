import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

/* ══ Sign-In Challenge — אימות-סטייל-איתריום על הרשת הריבונית ════════════════
 * הפעיל ביקש: "חייב שיהיה אימות לטוקן כמו באיתריום... שאפשר להתחבר חכם לטוקן
 * שלנו היטב ולהישאר מחובר". זהו SIWE (Sign-In With Ethereum) בגרסת-הרשת-שלנו:
 *  1. הדפדפן מבקש אתגר (challenge) — טקסט-חתימה קנוני עם nonce אקראי + תוקף
 *     קצר (5 דק') + דומיין + מטרה.
 *  2. המשתמש מאשר/חותם עם המפתח (בזרימה שלנו: המפתח מאומת-חי-מול-השרשרת,
 *     והנונס מוכרח-להיות-בשימוש-חד-פעמי בבקשת-ההתחברות עצמה).
 *  3. אחרי-אימות → סשן-30-יום (דו-נשא: cookie httpOnly + Bearer) — "נשאר
 *     מחובר" מובטח מבנית.
 * fail-closed: בלי-נונס-תקף-שלא-נצרך — אין-התחברות. אפס-סודות כאן. */

interface PendingCh {
  account: string;
  chain: string;
  message: string;
  nonce: string;
  exp: number;
}
const g = globalThis as unknown as { __svChallenges?: Map<string, PendingCh> };
function store(): Map<string, PendingCh> {
  if (!g.__svChallenges) g.__svChallenges = new Map();
  return g.__svChallenges;
}

const TTL_MS = 5 * 60 * 1000;
const CHAINS = new Set(['steem', 'hive', 'blurt']);

/** בדיקה (בלי-צריכה) של אתגר — אימות-מוקדם; הצריכה רק אחרי-הצלחה מלאה. */
export function peekChallenge(nonce: string, account: string, chain: string): boolean {
  const ch = store().get(nonce);
  if (!ch || ch.exp < Date.now()) return false;
  return ch.account === account && ch.chain === chain;
}

/** בדיקה+צריכה (חד-פעמי) של אתגר — ה-login route מזמין את זה אחרי אימות-חי. */
export function consumeChallenge(nonce: string, account: string, chain: string): boolean {
  const s = store();
  const ch = s.get(nonce);
  if (!ch) return false;
  s.delete(nonce); // חד-פעמי — גם-אם-שדות-לא-תואמים (anti-replay קשיח)
  if (ch.exp < Date.now()) return false;
  return ch.account === account && ch.chain === chain;
}

export async function POST(req: NextRequest) {
  let body: { account?: string; chain?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'bad json' }, { status: 400 });
  }
  const account = (body.account || '').trim().toLowerCase();
  const chain = (body.chain || '').trim().toLowerCase();
  if (!account || !CHAINS.has(chain)) {
    return NextResponse.json({ ok: false, error: 'חסר חשבון או רשת לא נתמכת (steem/hive/blurt)' }, { status: 400 });
  }
  // ניקוי-אתגרים-שפג-תוקפם (מדוד — המפה קטנה)
  const s = store();
  for (const [k, v] of s) if (v.exp < Date.now()) s.delete(k);

  const nonce = randomBytes(16).toString('hex');
  const at = new Date().toISOString();
  const message = [
    'SAOS-Dex · הרשת הריבונית',
    `רוצה-שתחתום-כדי-להתחבר-אל-${account}`,
    '',
    `רשת: ${chain}`,
    `חשבון: ${account}`,
    `נונס: ${nonce}`,
    `זמן: ${at}`,
    'חתימה זו אינה מעבירה שליטה על כספים ואינה עולה עמלות.',
  ].join('\n');
  const digest = createHash('sha256').update(message).digest('hex');
  s.set(nonce, { account, chain, message, nonce, exp: Date.now() + TTL_MS });
  return NextResponse.json({ ok: true, nonce, message, digest, expiresAt: Date.now() + TTL_MS });
}
