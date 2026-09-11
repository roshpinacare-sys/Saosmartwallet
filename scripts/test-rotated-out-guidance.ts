// Verifies the rotated-out honest guidance: the OLD steem key (line 2) should
// now get a directed explanation, not a dead end. Prints no secrets.
import fs from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), 'upload', 'הדקור.txt');
const lines = fs.readFileSync(FILE, 'utf8').split(/\r?\n/);
const stripInvisible = (s: string) => s.replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '');
const token = (lines[1] || '').split(/\s+/).map(stripInvisible).filter(t => t.length >= 51 && t.length <= 52)[0] || '';

const BASE = 'http://127.0.0.1:3000';
const ch = await fetch(`${BASE}/api/vault/challenge`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ account: 'headcorner', chain: 'steem' }),
});
const chj = await ch.json();
const lg = await fetch(`${BASE}/api/vault/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ account: 'headcorner', chain: 'steem', wif: token, nonce: chj.nonce }),
});
const lgj = await lg.json();
console.log(`old-key login: status=${lg.status} ok=${lgj.ok}`);
console.log(`error (directed guidance): ${lgj.error?.slice(0, 160) || '(none)'}`);
process.exit(0);
