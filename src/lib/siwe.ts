/**
 * siwe.ts — מחסן-האתגרים (challenge store) לזרימת-ההתחברות.
 * FIX(Roast-63 · H8): peekChallenge/consumeChallenge היו-מיוצאים-מקובץ-route —
 * הפרה-של-חוזה-ה-Route-Exports-של-Next (נחסם-ב-next-build; הוסתר-ע"י-ignoreBuildErrors).
 * המחסן-עתה-בספרייה; ה-route רק-מנהל-HTTP.
 * FIX(Roast-63 · H7): כנות-פרוטוקול — זו-אינה-חתימה-קריפטוגרפית של-ההודעה:
 * ההוכחה-היא הוכחת-החזקה (proof-of-possession) של מפתח-הרשת, המאומת-מול-
 * הסמכויות-על-השרשרת ב-login. ה-nonce מגן-על-replay של-זרימת-ההתחברות עצמה.
 */
export interface PendingCh {
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

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** בדיקה (בלי-צריכה) של אתגר — אימות-מוקדם; הצריכה רק אחרי-הצלחה מלאה. */
export function peekChallenge(nonce: string, account: string, chain: string): boolean {
  const ch = store().get(nonce);
  if (!ch || ch.exp < Date.now()) return false;
  return ch.account === account && ch.chain === chain;
}

/** בדיקה+צריכה (חד-פעמי) של אתגר — anti-replay קשיח. */
export function consumeChallenge(nonce: string, account: string, chain: string): boolean {
  const s = store();
  const ch = s.get(nonce);
  if (!ch) return false;
  s.delete(nonce); // חד-פעמי — גם-אם-שדות-לא-תואמים
  if (ch.exp < Date.now()) return false;
  return ch.account === account && ch.chain === chain;
}

/** יצירת-אתגר-חדש (ה-route קורא-לכאן). */
export function issueChallenge(account: string, chain: string, nonce: string, nowIso: string): PendingCh {
  const ch: PendingCh = {
    account, chain, nonce, message: buildMessage(account, chain, nonce, nowIso), exp: Date.now() + CHALLENGE_TTL_MS,
  };
  store().set(nonce, ch);
  return ch;
}

function buildMessage(account: string, chain: string, nonce: string, at: string): string {
  return [
    'SAOS-Dex · הרשת הריבונית',
    `התחברות-אל-${account} — הוכחת-החזקה של מפתח-הרשת`,
    '',
    `רשת: ${chain}`,
    `חשבון: ${account}`,
    `נונס: ${nonce}`,
    `זמן: ${at}`,
    'אין-כאן-חתימה-קריפטוגרפית של ההודעה — האימות מתבצע מול הסמכויות על השרשרת בעת-ההתחברות. אין-מעבר-שליטה-ואין-עמלות.',
  ].join('\n');
}

/** ניקוי-אתגרים-שפג-תוקפם. */
export function sweepExpired(): void {
  const s = store();
  for (const [k, v] of s) if (v.exp < Date.now()) s.delete(k);
}
