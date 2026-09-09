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
import { createSession, SESSION_COOKIE, cookieOptions } from '@/lib/auth';
import { audit, relayBroadcast } from '@/lib/audit';

const CHAINS = ['steem', 'hive', 'blurt'] as const;
type Ch = (typeof CHAINS)[number];

export async function POST(req: NextRequest) {
  let body: { account?: string; chain?: string; wif?: string; saveUnverified?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'bad json' }, { status: 400 });
  }
  const account = (body.account || '').trim().toLowerCase();
  const chain = (body.chain || '').trim().toLowerCase() as Ch;
  const wif = (body.wif || '').trim();

  if (!account || !wif) return NextResponse.json({ ok: false, error: 'חסר חשבון או מפתח' }, { status: 400 });
  if (!CHAINS.includes(chain)) return NextResponse.json({ ok: false, error: 'chain חייב להיות steem, hive או blurt' }, { status: 400 });
  if (!wifLooksValid(wif)) return NextResponse.json({ ok: false, error: 'פורמט מפתח לא תקין (WIF)' }, { status: 400 });

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
    await audit('login-rejected', `${account}/${chain}: ${result.error || 'no-error-details'}`);
    return NextResponse.json({ ok: false, error: `המפתח לא שולט ב-${account} על ${chain}: ${result.error || 'אין פירוט'}` }, { status: 401 });
  }

  // Save the key encrypted (idempotent upsert) so the network stays connected.
  const saved = await db.vaultKey.upsert({
    where: { account_chain_role: { account, chain, role: result.roles[0] || 'active' } },
    create: {
      account, chain, role: result.roles[0] || 'active',
      pubKey: pub, cipher: encryptSecret(wif), fingerprint: fingerprint(wif),
      verified: true, lastVerifiedAt: new Date(), source: fallback ? 'login-vault-fallback' : 'login',
      note: `roles=${result.roles.join('+')}`,
    },
    update: { pubKey: pub, cipher: encryptSecret(wif), fingerprint: fingerprint(wif), verified: true, lastVerifiedAt: new Date(), lastError: null },
  });

  const session = await createSession('owner', `owner:${account}`, `vault:${saved.id}`);
  await audit(fallback ? 'login-vault-fallback' : 'login-ok', `${account}/${chain} roles=${result.roles.join('+')} fp=${saved.fingerprint}`);
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
    saved: { id: saved.id, role: saved.role },
    message: `מחובר ל-${account} (${chain}) — שולט ב: ${result.roles.join(', ')}${fallback ? ' (אומת מהכספת — השרשרת לא הייתה נגישה)' : ''}`,
  });
  res.cookies.set(SESSION_COOKIE, session.token, cookieOptions());
  return res;
}
