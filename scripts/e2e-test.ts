/**
 * E2E test of the Sovereign Control Center API — uses a vault key (decrypted
 * server-side in this script) so NO key material appears in command lines.
 * Flow: challenge/login → status (anon+owner) → agent register → chat/task → verify-all → guard.
 *
 * FIX(Roast-65-b · M3/L3) — הבדיקה לא מזהמת עוד את המערכת-החיה:
 *  · M3  נדחה מול NODE_ENV=production אלא אם --allow-live מועבר מפורשות.
 *        כל-הישויות מתויגות (agent + task + הודעות) ונמחקות ב-finally; כל-הסשנים
 *        שנוצרו בזרימה מתנתקים ב-server (logout אמת — לא סשנים-יתומים-ל-30-יום).
 *  · L3  ה-WIF-הדוגמה-המפורסם (5KQwrPb… — מוכר-לכל-סריקות-הסודות בעולם)
 *        הוחלף ב-sentinel גלוי-שקרי שאינו-דמוי-WIF כלל.
 */
import { db } from '../src/lib/db';
import { decryptSecret } from '../src/lib/vault';

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3000';

// FIX(Roast-65-b · M3): production = אסור כברירת-מחדל (רישום-סוכן/סשנים/משימות
// חיים בפרודקשן). --allow-live = הצהרה-מפורשת של המפעיל.
if (process.env.NODE_ENV === 'production' && !process.argv.includes('--allow-live')) {
  console.error('[e2e] refusing: NODE_ENV=production (live mutations) — pass --allow-live to run anyway');
  process.exit(1);
}

const E2E_AGENT = 'e2e-test-agent'; // התג — כל-הישויות-שלנו ניתנות-לזיהוי ונמחקות לפיו
const E2E_TASK_TAG = 'e2e:'; // תג-משימות (מחיקה לפי-קידומת)
const INVALID_WIF_SENTINEL = 'e2e-INVALID-WIF-sentinel-not-a-real-key'; // FIX(· L3)

let cookie = '';
// FIX(Roast-65-b · M3): כל-סשן-שנוצר-כאן נרשם — ומתנתק ב-server ב-finally
type Carrier = { kind: 'cookie' | 'bearer'; value: string };
const sessions: Carrier[] = [];

async function call(path: string, opts: RequestInit = {}, auth?: 'owner' | 'agent', agentToken?: string): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth === 'owner' && cookie) headers['Cookie'] = cookie;
  if (auth === 'agent' && agentToken) headers['Authorization'] = `Bearer ${agentToken}`;
  const r = await fetch(BASE + path, { ...opts, headers });
  const setC = r.headers.get('set-cookie');
  if (setC) cookie = setC.split(';')[0];
  let body: any = null;
  try { body = await r.json(); } catch { /* */ }
  return { status: r.status, body };
}

// SIWE (Task 54): התחברות-חוקית = אתגר → נונס → login. מנהל-נשאים ורישום-סשן.
async function login(account: string, chain: string, wif: string): Promise<{ status: number; body: any }> {
  const ch = await fetch(BASE + '/api/vault/challenge', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, chain }),
  });
  const cj = await ch.json().catch(() => ({}));
  if (!cj.ok || !cj.nonce) throw new Error('challenge failed: ' + (cj.error || 'unknown'));
  const r = await fetch(BASE + '/api/vault/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, chain, wif, nonce: cj.nonce }),
  });
  const body = await r.json().catch(() => null);
  const setC = r.headers.get('set-cookie');
  if (setC) cookie = setC.split(';')[0];
  // FIX(· M3): רישום-הסשן-החדש לניתוק-מאוחר (bearer עדיף — מת-ב-server גם בלי-jar)
  if (body?.token) sessions.push({ kind: 'bearer', value: body.token });
  else if (setC) sessions.push({ kind: 'cookie', value: setC.split(';')[0] });
  return { status: r.status, body };
}

// FIX(Roast-65-b · M3): ניתוק-אמת של כל-הסשנים-שנוצרו (cookie-carrier + Bearer-carrier)
async function logoutAll(): Promise<void> {
  for (const s of sessions) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (s.kind === 'bearer') headers['Authorization'] = `Bearer ${s.value}`;
      else headers['Cookie'] = s.value;
      await fetch(BASE + '/api/vault/logout', { method: 'POST', headers });
    } catch { /* best-effort */ }
  }
}

// FIX(Roast-65-b · M3): מחיקת-כל-הישויות-המתויגות (best-effort, רץ-תמיד)
async function cleanup(): Promise<void> {
  await logoutAll();
  try {
    const tasks = await db.taskItem.deleteMany({ where: { OR: [{ title: { startsWith: E2E_TASK_TAG } }, { assignedTo: E2E_AGENT }] } });
    const msgs = await db.chatMessage.deleteMany({ where: { author: E2E_AGENT } });
    const agents = await db.agentNode.deleteMany({ where: { name: E2E_AGENT } });
    console.log(`[e2e] cleanup: tasks=${tasks.count} messages=${msgs.count} agents=${agents.count} sessions-logged-out=${sessions.length}`);
  } catch (e) {
    console.error('[e2e] cleanup error:', e);
  }
}

let token = '';
let wif = '';

(async () => {
  try {
    console.log('=== 1) anonymous status = minimal shape (no key inventory — Roast-65-b · M4) ===');
    const anon = await call('/api/vault/status');
    console.log('  status w/o session:', anon.status,
      `me=${anon.body?.me} accounts=${anon.body?.totals?.accounts}`,
      'byAccount-empty=', anon.body && Object.keys(anon.body.byAccount || { x: 1 }).length === 0,
      'agents-empty=', Array.isArray(anon.body?.agents) && anon.body.agents.length === 0,
      'balances-empty=', anon.body && Object.keys(anon.body.balances || { x: 1 }).length === 0,
      '(expect 200 + me=null + empty containers — counts only)');

    console.log('=== 2) smart login with headcorner STEEM memo key (from encrypted vault) ===');
    const memo = await db.vaultKey.findUnique({ where: { account_chain_role: { account: 'headcorner', chain: 'steem', role: 'memo' } } });
    if (!memo) throw new Error('vault missing headcorner steem memo');
    wif = decryptSecret(memo.cipher); // stays in memory only — never printed
    const lg = await login('headcorner', 'steem', wif);
    console.log('  login:', lg.status, lg.body?.ok ? `roles=${lg.body.roles.join(',')}` : lg.body?.error, '(expect 200 + memo)');

    console.log('=== 3) wrong key rejected (invalid sentinel — no famous example WIF in git) ===');
    const bad = await call('/api/vault/login', { method: 'POST', body: JSON.stringify({ account: 'headcorner', chain: 'steem', wif: INVALID_WIF_SENTINEL }) });
    console.log('  bad key:', bad.status, '(expect 400 — malformed WIF / 401)');

    console.log('=== 4) status with session = full matrix (owner view unchanged) ===');
    const st = await call('/api/vault/status', {}, 'owner');
    console.log('  status:', st.status, `keys=${st.body?.totals?.keys} verified=${st.body?.totals?.verified} accounts=${st.body?.totals?.accounts} ownerLock=${st.body?.guard?.ownerLock} byAccount-accounts=${Object.keys(st.body?.byAccount || {}).length} agents=${st.body?.agents?.length}`);

    console.log('=== 5) register agent + agent chat + task flow (tagged for cleanup) ===');
    const reg = await call('/api/agent/register', { method: 'POST', body: JSON.stringify({ name: E2E_AGENT, capabilities: 'chat,task' }) }, 'owner');
    console.log('  register:', reg.status, 'token-received=', !!reg.body?.token);
    token = reg.body?.token as string;
    const msg = await call('/api/agent/message', { method: 'POST', body: JSON.stringify({ content: `E2E: סוכן בדיקה ${E2E_AGENT} מדווח — חיבור תקין` }) }, 'agent', token);
    console.log('  agent message:', msg.status, msg.body?.ok);
    const tCreate = await call('/api/task', { method: 'POST', body: JSON.stringify({ title: `${E2E_TASK_TAG}משימת בדיקה`, assignedTo: E2E_AGENT }) }, 'owner');
    console.log('  task created:', tCreate.status, tCreate.body?.id);
    const tList = await call('/api/agent/task', {}, 'agent', token);
    console.log('  agent sees tasks:', tList.status, 'count=', tList.body?.tasks?.length);
    const tClaim = await call('/api/agent/task', { method: 'POST', body: JSON.stringify({ action: 'claim', taskId: tCreate.body?.id }) }, 'agent', token);
    console.log('  agent claim:', tClaim.status, tClaim.body?.ok);
    const tDone = await call('/api/agent/task', { method: 'POST', body: JSON.stringify({ action: 'result', taskId: tCreate.body?.id, status: 'done', result: 'E2E completed' }) }, 'agent', token);
    console.log('  agent result:', tDone.status, tDone.body?.ok);

    console.log('=== 6) chat read (owner) ===');
    const chat = await call('/api/chat', {}, 'owner');
    console.log('  chat:', chat.status, 'messages=', chat.body?.messages?.length);

    console.log('=== 7) verify-all (live chain re-check) ===');
    const v = await call('/api/vault/verify', { method: 'POST' }, 'owner');
    console.log('  verify:', v.status, `checked=${v.body?.checked} dead=${v.body?.dead}`);

    console.log('=== 8) guard requires explicit confirmation to disable ===');
    const g1 = await call('/api/guard', { method: 'POST', body: JSON.stringify({ enable: false, confirm: 'wrong' }) }, 'owner');
    console.log('  disable w/o confirm:', g1.status, '(expect 403)');
    const g2 = await call('/api/guard', {}, 'owner');
    console.log('  guard state:', g2.status, 'ownerLock=', g2.body?.ownerLock, '(expect true)');

    console.log('=== 9) Bearer-carrier session (iframe-proof, cookie-less) ===');
    // Exact regression for "הכל נעלם": preview iframes block cookies — the session
    // must survive on the Authorization header alone, with NO cookie ever sent.
    const noCookie = async (path: string, bearer?: string, method = 'GET'): Promise<{ status: number; body: any }> => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
      const r = await fetch(BASE + path, { method, headers });
      let body: any = null;
      try { body = await r.json(); } catch { /* */ }
      return { status: r.status, body };
    };
    // (reuses the same memo WIF already decrypted above — login with NO cookie jar)
    const ch2 = await fetch(BASE + '/api/vault/challenge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account: 'headcorner', chain: 'steem' }) });
    const cj2 = await ch2.json();
    if (!cj2.ok || !cj2.nonce) throw new Error('challenge-2 failed');
    const l2 = await fetch(BASE + '/api/vault/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account: 'headcorner', chain: 'steem', wif, nonce: cj2.nonce }) });
    const l2body = await l2.json();
    if (l2body?.token) sessions.push({ kind: 'bearer', value: l2body.token }); // FIX(· M3): נרשם לניתוק
    console.log('  login (no cookie jar):', l2.status, 'token-in-body=', !!l2body.token, '(expect true)');
    const sBearer = await noCookie('/api/vault/status', l2body.token);
    console.log('  status via Bearer only:', sBearer.status, 'me=', sBearer.body?.me, 'byAccount-accounts=', Object.keys(sBearer.body?.byAccount || {}).length, '(expect 200 owner:headcorner + full matrix)');
    const cBearer = await noCookie('/api/chat', l2body.token);
    console.log('  chat via Bearer only:', cBearer.status, 'messages=', cBearer.body?.messages?.length, '(expect 200)');
    const sBad = await noCookie('/api/vault/status', 'forged-token-123');
    console.log('  forged Bearer:', sBad.status, 'me=', sBad.body?.me, 'byAccount-empty=', sBad.body && Object.keys(sBad.body.byAccount || { x: 1 }).length === 0, '(expect 200 minimal anonymous shape — fail-closed, no matrix)');
    // restore owner cookie session for any later sections
    cookie = '';
    const l3 = await login('headcorner', 'steem', wif);
    console.log('  cookie login restored:', l3.status);

    console.log('=== 10) public reads (no session) + BLURT ===');
    const pub1 = await noCookie('/api/vault/status');
    console.log('  anonymous status:', pub1.status, 'me=', pub1.body?.me, 'accounts=', pub1.body?.totals?.accounts, 'byAccount-empty=', pub1.body && Object.keys(pub1.body.byAccount || { x: 1 }).length === 0, '(expect 200 + me=null + minimal shape — no entrance blocker, no recon bundle)');
    const pub2 = await noCookie('/api/chat');
    console.log('  anonymous chat read:', pub2.status, '(expect 200)');
    const pub3 = await noCookie('/api/task', undefined, 'POST');
    console.log('  anonymous task POST:', pub3.status, '(expect 401 — mutations stay protected)');
    const blurtKey = await db.vaultKey.findUnique({ where: { account_chain_role: { account: 'headcorner', chain: 'blurt', role: 'owner' } } });
    if (blurtKey) {
      const bwif = decryptSecret(blurtKey.cipher);
      const bl = await login('headcorner', 'blurt', bwif);
      console.log('  BLURT login:', bl.status, bl.body?.ok ? `roles=${bl.body.roles.join(',')}` : bl.body?.error, '(expect 200 + owner)');
    } else {
      console.log('  BLURT login: SKIPPED (no blurt key in vault)');
    }

    console.log('=== E2E DONE (cleanup runs in finally) ===');
  } catch (e) {
    console.error('FATAL', e);
    process.exitCode = 1;
  } finally {
    // FIX(Roast-65-b · M3): תמיד — הצלחה, כישלון או אמצע-ריצה
    await cleanup();
    await db.$disconnect();
  }
})();
