/**
 * Ops utility — mint an owner session token via the live login API.
 * Decrypts a vault key IN MEMORY (never printed) and exchanges it for a session
 * token, so CLI/agent tooling can talk to the API without a browser cookie jar.
 *
 * FIX(Roast-65-b · L4):
 *  · הטוקן אינו-מודפס-עוד ל-stdout (נשאר-ב-history/יומנים-של-טרמינל) — נכתב
 *    לקובץ-יעד (ארגומנט-נתיב) עם הרשאות 0600 בלבד.
 *  · זכות-מינימום: השליפה מעדיפה posting/memo — אין-סיבה לשלוף owner/active
 *    לסשן-API כשהם-לא-נדרשים (היה: first-verified לקסיקוגרפית).
 * Usage: bun scripts/mk-session.ts [account] [chain] <outfile>
 */
process.env.NODE_ENV ||= 'development';
import fs from 'fs';
import { db } from '../src/lib/db';
import { decryptSecret } from '../src/lib/vault';

const account = process.argv[2] || 'headcorner';
const chain = (process.argv[3] || 'steem') as 'steem' | 'hive' | 'blurt';
const out = process.argv[4] || '';

if (!out) {
  console.error('usage: bun scripts/mk-session.ts [account] [chain] <outfile>');
  console.error('  the session token is written to <outfile> with mode 0600 — never printed to stdout');
  process.exit(1);
}

(async () => {
  // FIX(Roast-65-b · L4): posting/memo קודמים — זכות-מינימום לסשן-API
  const key = (await db.vaultKey.findFirst({
    where: { account, chain, verified: true, role: { in: ['posting', 'memo'] } },
    orderBy: [{ role: 'asc' }],
  }))
    ?? await db.vaultKey.findFirst({
      where: { account, chain, verified: true },
      orderBy: [{ role: 'asc' }],
    });
  if (!key) throw new Error(`no verified vault key for ${account}/${chain}`);
  const wif = decryptSecret(key.cipher); // in memory only — never printed
  // Task 54 SIWE: קבלת-אתגר-חתימה חד-פעמי → התחברות עם הנונס (החזקת-ה-WIF היא החתימה)
  const ch = await fetch('http://127.0.0.1:3000/api/vault/challenge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, chain }),
  });
  const cj = await ch.json();
  if (!cj.ok || !cj.nonce) throw new Error('challenge failed: ' + (cj.error || 'unknown'));
  const r = await fetch('http://127.0.0.1:3000/api/vault/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, chain, wif, nonce: cj.nonce }),
  });
  const j = await r.json();
  if (!j.ok || !j.token) throw new Error('login failed: ' + (j.error || 'unknown'));
  // FIX(Roast-65-b · L4): קובץ-0600 (mode + chmod נגד-umask) — לא stdout
  fs.writeFileSync(out, j.token + '\n', { mode: 0o600 });
  fs.chmodSync(out, 0o600);
  console.log(`session token → ${out} (0600) · key=${key.role} · expires=${j.session?.expiresAt ?? 'n/a'}`);
  await db.$disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
