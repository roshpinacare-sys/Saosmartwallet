/**
 * E2E test of the Sovereign Control Center API — uses a vault key (decrypted
 * server-side in this script) so NO key material appears in command lines.
 * Flow: login → status → agent register → agent chat/task → verify-all → guard.
 */
import { db } from '../src/lib/db';
import { decryptSecret } from '../src/lib/vault';

const BASE = 'http://127.0.0.1:3000';
let cookie = '';

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

(async () => {
  console.log('=== 1) unauthorized access is blocked ===');
  console.log('  status w/o session:', (await call('/api/vault/status')).status, '(expect 401)');

  console.log('=== 2) smart login with headcorner STEEM memo key (from encrypted vault) ===');
  const memo = await db.vaultKey.findUnique({ where: { account_chain_role: { account: 'headcorner', chain: 'steem', role: 'memo' } } });
  if (!memo) throw new Error('vault missing headcorner steem memo');
  const wif = decryptSecret(memo.cipher);
  const login = await call('/api/vault/login', { method: 'POST', body: JSON.stringify({ account: 'headcorner', chain: 'steem', wif }) });
  console.log('  login:', login.status, login.body.ok ? `roles=${login.body.roles.join(',')}` : login.body.error, '(expect 200 + memo)');

  console.log('=== 3) wrong key rejected ===');
  const bad = await call('/api/vault/login', { method: 'POST', body: JSON.stringify({ account: 'headcorner', chain: 'steem', wif: '5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3' }) });
  console.log('  bad key:', bad.status, '(expect 401)');

  console.log('=== 4) status with session ===');
  const st = await call('/api/vault/status', {}, 'owner');
  console.log('  status:', st.status, `keys=${st.body?.totals?.keys} verified=${st.body?.totals?.verified} accounts=${st.body?.totals?.accounts} ownerLock=${st.body?.guard?.ownerLock}`);

  console.log('=== 5) register agent + agent chat + task flow ===');
  const reg = await call('/api/agent/register', { method: 'POST', body: JSON.stringify({ name: 'e2e-test-agent', capabilities: 'chat,task' }) }, 'owner');
  console.log('  register:', reg.status, 'token-received=', !!reg.body?.token);
  const token = reg.body?.token as string;
  const msg = await call('/api/agent/message', { method: 'POST', body: JSON.stringify({ content: 'E2E: סוכן בדיקה מדווח — חיבור תקין' }) }, 'agent', token);
  console.log('  agent message:', msg.status, msg.body?.ok);
  const tCreate = await call('/api/task', { method: 'POST', body: JSON.stringify({ title: 'E2E בדיקת משימה', assignedTo: 'e2e-test-agent' }) }, 'owner');
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
  console.log('  verify:', v.status, `checked=${v.body?.checked} dead=${v.body?.dead} (expect dead=4: archive only)`);

  console.log('=== 8) guard requires explicit confirmation to disable ===');
  const g1 = await call('/api/guard', { method: 'POST', body: JSON.stringify({ enable: false, confirm: 'wrong' }) }, 'owner');
  console.log('  disable w/o confirm:', g1.status, '(expect 403)');
  const g2 = await call('/api/guard', {}, 'owner');
  console.log('  guard state:', g2.status, 'ownerLock=', g2.body?.ownerLock, '(expect true)');

  console.log('=== E2E DONE ===');
  await db.$disconnect();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
