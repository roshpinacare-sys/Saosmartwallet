// Key forensics for the owner's login crisis (roast-85 · login-r32 continuation).
// Reads the owner's uploaded key file, derives PUBLIC keys only, compares them
// against LIVE on-chain authorities for headcorner (STEEM + HIVE + BLURT).
// NEVER prints WIF material — only line numbers, derived public keys, and verdicts.
import fs from 'fs';
import path from 'path';
import { wifLooksValid, wifToPublic } from '../src/lib/keys';
import { getAccount, rolesForPub, type AccountAuths } from '../src/lib/chain';

const FILE = path.join(process.cwd(), 'upload', 'הדקור.txt');
const ACCOUNT = 'headcorner';
const CHAINS = ['steem', 'hive', 'blurt'] as const;

interface Candidate { line: number; wif: string; preview: string; }
const candidates: Candidate[] = [];

const raw = fs.readFileSync(FILE, 'utf8');
const lines = raw.split(/\r?\n/);
lines.forEach((ln, i) => {
  const tokens = ln.trim().split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    if (wifLooksValid(t)) candidates.push({ line: i + 1, wif: t, preview: `${t.slice(0, 3)}…${t.slice(-2)} (${t.length}ch)` });
  }
});
// Also treat every line as a whole token (some blocks may be spaced oddly)
lines.forEach((ln, i) => {
  const t = ln.trim();
  if (t && wifLooksValid(t) && !candidates.some(c => c.wif === t && c.line === i + 1)) {
    candidates.push({ line: i + 1, wif: t, preview: `${t.slice(0, 3)}…${t.slice(-2)} (${t.length}ch)` });
  }
});

console.log(`FILE: upload/הדקור.txt (${raw.length} bytes, ${lines.length} lines)`);
console.log(`WIF-FORMAT CANDIDATES FOUND: ${candidates.length}`);
for (const c of candidates) console.log(`  line ${c.line}: ${c.preview}`);

if (candidates.length === 0) {
  console.log('\nNo WIF-format tokens. Dumping line SHAPE only (lengths + charset classes):');
  lines.forEach((ln, i) => {
    const t = ln.trim();
    if (!t) return;
    const shape = t.replace(/[A-Za-z0-9]/g, 'x').slice(0, 40);
    console.log(`  line ${i + 1}: len=${t.length} shape=${shape}`);
  });
  process.exit(0);
}

// Live authorities per chain
const accounts: Partial<Record<typeof CHAINS[number], AccountAuths | null>> = {};
for (const ch of CHAINS) {
  accounts[ch] = await getAccount(ch, ACCOUNT);
  const a = accounts[ch];
  if (a) console.log(`\nLIVE ${ch.toUpperCase()} authorities for ${ACCOUNT}:`);
  else console.log(`\nLIVE ${ch.toUpperCase()}: UNREACHABLE`);
  if (a) {
    console.log(`  owner:   ${a.owner.join(', ') || '(none)'}`);
    console.log(`  active:  ${a.active.join(', ') || '(none)'}`);
    console.log(`  posting: ${a.posting.join(', ') || '(none)'}`);
    console.log(`  memo:    ${a.memo.join(', ') || '(none)'}`);
    console.log(`  balances: ${JSON.stringify(a.balances)}`);
  }
}

console.log('\n=== VERDICT PER CANDIDATE (public keys only) ===');
for (const c of candidates) {
  for (const ch of CHAINS) {
    const acct = accounts[ch];
    if (!acct) continue;
    let pub = '';
    try {
      pub = wifToPublic(c.wif, ch === 'blurt' ? 'BLT' : 'STM');
    } catch { continue; }
    const roles = rolesForPub(acct, pub);
    const mark = roles.length ? `✅ CONTROLS: ${roles.join('+')}` : '— not in authority';
    console.log(`  line ${c.line} · ${ch.toUpperCase()} · pub=${pub} → ${mark}`);
  }
}

// Also compare against vault rows (pubKey fields are public)
console.log('\n=== VAULT CROSS-CHECK ===');
try {
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  const rows = await db.vaultKey.findMany({ select: { account: true, chain: true, role: true, pubKey: true, verified: true } });
  const vaultPubs = new Map<string, { chain: string; role: string; verified: boolean }>();
  for (const r of rows) if (r.pubKey) vaultPubs.set(r.pubKey.replace(/^STM|^BLT/, ''), { chain: r.chain, role: r.role, verified: r.verified });
  for (const c of candidates) {
    for (const ch of CHAINS) {
      let pub = '';
      try { pub = wifToPublic(c.wif, ch === 'blurt' ? 'BLT' : 'STM'); } catch { continue; }
      const v = vaultPubs.get(pub.replace(/^STM|^BLT/, ''));
      if (v) console.log(`  line ${c.line} pub=${pub} → IN VAULT as ${v.chain}/${v.role} verified=${v.verified}`);
    }
  }
  await db.$disconnect();
} catch (e) {
  console.log(`  (vault cross-check skipped: ${String(e).slice(0, 80)})`);
}
