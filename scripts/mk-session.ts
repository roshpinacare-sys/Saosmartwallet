/**
 * Ops utility — mint an owner session token via the live login API.
 * Decrypts a vault key IN MEMORY (never printed) and exchanges it for a session
 * token, so CLI/agent tooling can talk to the API without a browser cookie jar.
 * Usage: bun scripts/mk-session.ts [account] [chain]  → prints the token only.
 */
process.env.NODE_ENV ||= 'development';
import { db } from '../src/lib/db';
import { decryptSecret } from '../src/lib/vault';

const account = process.argv[2] || 'headcorner';
const chain = (process.argv[3] || 'steem') as 'steem' | 'hive';

(async () => {
  const key = await db.vaultKey.findFirst({
    where: { account, chain, verified: true },
    orderBy: [{ role: 'asc' }],
  });
  if (!key) throw new Error(`no verified vault key for ${account}/${chain}`);
  const wif = decryptSecret(key.cipher);
  const r = await fetch('http://127.0.0.1:3000/api/vault/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, chain, wif }),
  });
  const j = await r.json();
  if (!j.ok || !j.token) throw new Error('login failed: ' + (j.error || 'unknown'));
  console.log(j.token);
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
