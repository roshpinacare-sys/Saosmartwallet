// E2E login test (roast-85): challenge → login with the owner's HIVE owner key.
// Prints ONLY the response structure — never the WIF, never the session token.
import fs from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), 'upload', 'הדקור.txt');
const lines = fs.readFileSync(FILE, 'utf8').split(/\r?\n/);
// line 10 (index 9) = live-proven HIVE owner key — tokenize like forensics,
// strip invisible Unicode (RTL marks/BOM are common in Hebrew-edited files)
const stripInvisible = (s: string) => s.replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '');
const token = (lines[9] || '').split(/\s+/).map(stripInvisible).filter(t => t.length >= 51 && t.length <= 52)[0] || '';
const wif = token;
if (!wif || wif.length < 50) { console.log('FAIL: candidate at line 10 missing'); process.exit(1); }

const BASE = 'http://127.0.0.1:3000';

// 1) challenge
const ch = await fetch(`${BASE}/api/vault/challenge`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ account: 'headcorner', chain: 'hive' }),
});
const chj = await ch.json();
console.log(`challenge: status=${ch.status} ok=${chj.ok} hasNonce=${Boolean(chj.nonce)}`);
if (!chj.nonce) { console.log('challenge response keys:', Object.keys(chj)); process.exit(1); }

// 2) login
const lg = await fetch(`${BASE}/api/vault/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ account: 'headcorner', chain: 'hive', wif, nonce: chj.nonce }),
});
const lgj = await lg.json();
console.log(`login: status=${lg.status} ok=${lgj.ok}`);
if (lgj.roles) console.log(`roles: ${lgj.roles.join('+')}`);
if (lgj.balances) console.log(`balances: ${JSON.stringify(lgj.balances)}`);
if (lgj.saved) console.log(`vault row: role=${lgj.saved.role}`);
if (lgj.token) console.log(`token: (received, ${String(lgj.token).length} chars — not printed)`);
if (lgj.message) console.log(`message: ${lgj.message}`);
if (!lgj.ok) console.log(`error: ${lgj.error}`);
process.exit(lg.status === 200 && lgj.ok ? 0 : 1);
