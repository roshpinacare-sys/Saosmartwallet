// Smart login — connect with ANY key (owner/active/posting/memo × steem/hive/blurt).
// Verifies LIVE against the chain before a session is ever granted (fail-closed).
// Fallback: if the chain is unreachable but the WIF derives a pub that matches a
// vault key live-verified within the last 7 days, access is still granted —
// possession of the WIF is cryptographic proof of a key already proven on-chain.
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyWif } from '@/lib/chain';
import { wifLooksValid, wifToPublic } from '@/lib/keys';
import { encryptSecret, fingerprint } from '@/lib/vault';
import { createSession, SESSION_COOKIE, cookieOptions, OPERATOR_ACCOUNT } from '@/lib/auth';
import { audit, relayBroadcast } from '@/lib/audit';
import { consumeChallenge, peekChallenge } from '@/lib/siwe'; // FIX(Roast-63 · H8): לא-מקובץ-route
import { isMasterKey, masterLabel, masterFingerprint } from '@/lib/master-key'; // הסכם-מפתח-האב (Task 69)

const CHAINS = ['steem', 'hive', 'blurt'] as const;
type Ch = (typeof CHAINS)[number];

export async function POST(req: NextRequest) {
  let body: { account?: string; chain?: string; wif?: string; saveUnverified?: boolean; nonce?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'bad json' }, { status: 400 });
  }

  // ══ הסכם-מפתח-האב (Task 69) ═══════════════════════════════════════════════
  // המפתח-שבהסכם פותח סשן-בעלים מיידית — בלי תלות בשרשרת-חוץ, באתגר-SIWE או
  // בסמכויות-רוטציה. החזקת-המפתח = הזהות (כמו סיסמת-רוט). התווית נקשרת תמיד
  // לתווית-ההסכם — כדי ש-requireOwner יכיר בה בדיוק. כל שאר המפתחות ממשיכים
  // למסלול אימות-השרשרת המלא מתחת — שום-שכבת-אימות לא נחלשה.
  {
    const rawWif = (body.wif || '').trim();
    if (rawWif && isMasterKey(rawWif)) {
      const label = masterLabel() || OPERATOR_ACCOUNT;
      const session = await createSession('owner', `owner:${label}`, 'master-agreement');
      await audit('login-master', `master-key agreement: owner:${label} fp=${masterFingerprint() ?? 'none'} — כניסה-אחידה לכל-האפליקציות`);
      try { await relayBroadcast('vault', { type: 'login', account: label, chain: 'master-agreement', roles: ['owner'] }); } catch { /* best-effort */ }
      const res = NextResponse.json({
        ok: true,
        token: session.token,
        session: { label: `owner:${label}`, expiresAt: session.expiresAt },
        roles: ['owner', 'active', 'posting', 'memo'],
        balances: null,
        fallback: false,
        saved: null,
        master: true,
        message: `מחובר עם מפתח-האב (${label}) — הסכם-המפתח האחיד: אותו מפתח פותח את כל האפליקציות בריפו`,
      });
      res.cookies.set(SESSION_COOKIE, session.token, cookieOptions());
      return res;
    }
  }

  const account = (body.account || '').trim().toLowerCase();
  const chain = (body.chain || '').trim().toLowerCase() as Ch;
  const wif = (body.wif || '').trim();

  if (!account || !wif) return NextResponse.json({ ok: false, error: 'חסר חשבון או מפתח' }, { status: 400 });
  if (!CHAINS.includes(chain)) return NextResponse.json({ ok: false, error: 'chain חייב להיות steem, hive או blurt' }, { status: 400 });
  if (!wifLooksValid(wif)) return NextResponse.json({ ok: false, error: 'פורמט מפתח לא תקין (WIF)' }, { status: 400 });

  // Task 54 · אימות-סטייל-איתריום: כל-התחברות חייבת-נונס-אתגר-חי שהונפק עכשיו
  // (SIWE-שלנו). האימות-המוקדם = peek (לא-שורף); הצריכה-החד-פעמית רק אחרי
  // אימות-המפתח-החי — כישלון-אימות/שרת לא מכריח reconnect.
  const nonce = (body.nonce || '').trim();
  if (!nonce) {
    return NextResponse.json({ ok: false, error: 'נדרש אתגר-חתימה — לחץ "חבר ארנק" שוב (אימות SIWE חובה)' }, { status: 400 });
  }
  if (!peekChallenge(nonce, account, chain)) {
    return NextResponse.json({ ok: false, error: 'האתגר פג תוקף — בצע חיבור מחדש' }, { status: 401 });
  }

  const { pub, result } = await verifyWif(wif, account, chain);

  // Vault fallback — the chain is unreachable / flaky, but this exact key was
  // live-verified against this account+chain recently. Cryptographically sound.
  let fallback = false;
  if (!result.ok) {
    try {
      const pubBody = pub.replace(/^STM|^BLT/, '');
      const candidates = await db.vaultKey.findMany({
        where: { account, chain, verified: true, lastVerifiedAt: { gt: new Date(Date.now() - 7 * 24 * 3600 * 1000) } },
      });
      const match = candidates.find(k => (k.pubKey || '').replace(/^STM|^BLT/, '') === pubBody);
      if (match) {
        fallback = true;
        result.ok = true;
        result.roles = [match.role as typeof result.roles[number]];
        result.error = undefined;
      }
    } catch { /* db issue — stay fail-closed */ }
  }

  if (!result.ok) {
    // Roast-85 · ריפוי-r32-משוחזר (אבד באיפוס-הסנדבוקס): זיהוי-מפתח-מוחלף —
    // אם ה-pub הנגזר תואם שורת-כספת של החשבון, המפתח הזה היה פעם מפתח-החשבון
    // והוצא מה-authority ברוטציה. במקום מבוי-סתום — תשובה-כנה ומכוונת.
    try {
      const pubBody = pub.replace(/^STM|^BLT/, '');
      const prior = await db.vaultKey.findMany({ where: { account }, select: { chain: true, role: true, pubKey: true } });
      const hit = prior.find(k => (k.pubKey || '').replace(/^STM|^BLT/, '') === pubBody);
      if (hit) {
        await audit('login-rotated-out', `${account}/${chain}: pub matches vault ${hit.chain}/${hit.role} — key was removed from authority by rotation (r16/r17)`);
        return NextResponse.json({
          ok: false,
          error: `המפתח הזה אכן היה מפתח-${account} (${hit.chain}·${hit.role}) — הוצא מה-authority ברוטציית-המפתחות של הצי (r16/r17). זה לא מפתח שגוי — הוא היסטורי. דרכים להיכנס: (1) בחר ${hit.chain.toUpperCase()} ברשת והדבק את המפתח-החי של אותה רשת · (2) מפתח-האב מההסכם (headcorner.txt) נכנס בכל רשת ובכל שדה-חשבון, בלי תלות ב-authorities.`,
        }, { status: 401 });
      }
    } catch { /* stay fail-closed */ }
    await audit('login-rejected', `${account}/${chain}: ${result.error || 'no-error-details'}`);
    return NextResponse.json({ ok: false, error: `המפתח לא שולט ב-${account} על ${chain}: ${result.error || 'אין פירוט'} · דרך-בטוחה להיכנס: מפתח-האב מההסכם (headcorner.txt) — הוא נכנס בכל רשת ובכל שדה-חשבון, בלי תלות ב-authorities.` }, { status: 401 });
  }

  // האתגר נצרך-רק-עכשיו — אחרי-אימות-חי-מוצלח (anti-replay בלי-ענישת-משתמש)
  if (!consumeChallenge(nonce, account, chain)) {
    return NextResponse.json({ ok: false, error: 'האתגר נוצל במקביל — בצע חיבור מחדש' }, { status: 401 });
  }

  // Save the key encrypted (idempotent upsert) so the network stays connected.
  // Roast-85: best-effort — הכניסה נשענת על הוכחת-השרשרת-החיה, לא על הכספת.
  // כשל-כספת (סוד-חסר/קצר) לא נועל עוד את המפעיל בחוץ — הוא מדווח-כנה.
  let saved: { id: string; fingerprint: string; role: string } | null = null;
  let vaultSkip = '';
  try {
    const s = await db.vaultKey.upsert({
      where: { account_chain_role: { account, chain, role: result.roles[0] || 'active' } },
      create: {
        account, chain, role: result.roles[0] || 'active',
        pubKey: pub, cipher: encryptSecret(wif), fingerprint: fingerprint(wif),
        verified: true, lastVerifiedAt: new Date(), source: fallback ? 'login-vault-fallback' : 'login',
        note: `roles=${result.roles.join('+')}`,
      },
      update: { pubKey: pub, cipher: encryptSecret(wif), fingerprint: fingerprint(wif), verified: true, lastVerifiedAt: new Date(), lastError: null },
    });
    saved = { id: s.id, fingerprint: s.fingerprint, role: s.role };
  } catch (e) {
    vaultSkip = String(e).slice(0, 120);
    await audit('login-vault-save-failed', `${account}/${chain}: session granted on live chain proof; vault-save skipped — ${vaultSkip}`);
  }

  const session = await createSession('owner', `owner:${account}`, saved ? `vault:${saved.id}` : 'no-vault-row');
  await audit(fallback ? 'login-vault-fallback' : 'login-ok', `${account}/${chain} roles=${result.roles.join('+')}${saved ? ` fp=${saved.fingerprint}` : ' vault-save-skipped'}${vaultSkip ? ' vault-crypto-unavailable' : ''}`);
  await relayBroadcast('vault', { type: 'login', account, chain, roles: result.roles });

  const res = NextResponse.json({
    ok: true,
    // Token returned in the body too — the client persists it in localStorage so
    // the session survives cross-origin iframe previews where cookies are blocked.
    token: session.token,
    session: { label: `owner:${account}`, expiresAt: session.expiresAt },
    roles: result.roles,
    balances: result.balances,
    fallback,
    saved: saved ? { id: saved.id, role: saved.role } : null,
    message: `מחובר ל-${account} (${chain}) — שולט ב: ${result.roles.join(', ')}${fallback ? ' (אומת מהכספת — השרשרת לא הייתה נגישה)' : ''}${vaultSkip ? ' · שמירה-לכספת דולגה (מצב-כספת כנה בדוח)' : ''}`,
  });
  res.cookies.set(SESSION_COOKIE, session.token, cookieOptions());
  return res;
}
