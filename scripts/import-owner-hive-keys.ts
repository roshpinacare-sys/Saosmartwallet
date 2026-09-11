// Recovery import (roast-85 · login crisis): import the owner's LIVE HIVE keys
// from their own uploaded file into the vault, encrypted under the NEW secret.
// Only keys that PROVE authority on the live chain are imported — nothing else.
// Prints public keys and verdicts only. NEVER prints WIF material.
import fs from 'fs';
import path from 'path';
import { wifLooksValid, wifToPublic } from '../src/lib/keys';
import { verifyWif } from '../src/lib/chain';
import { encryptSecret, fingerprint } from '../src/lib/vault';
import { db } from '../src/lib/db';
import { audit } from '../src/lib/audit';

const FILE = path.join(process.cwd(), 'upload', 'הדקור.txt');
const ACCOUNT = 'headcorner';
const CHAIN = 'hive' as const;

const raw = fs.readFileSync(FILE, 'utf8');
const lines = raw.split(/\r?\n/);
const candidates: Array<{ line: number; wif: string }> = [];
lines.forEach((ln, i) => {
  for (const t of ln.trim().split(/\s+/)) {
    if (wifLooksValid(t)) candidates.push({ line: i + 1, wif: t });
  }
});

console.log(`candidates in owner file: ${candidates.length}`);
let imported = 0;
for (const c of candidates) {
  const { pub, result } = await verifyWif(c.wif, ACCOUNT, CHAIN);
  if (!result.ok || result.roles.length === 0) continue;
  const role = result.roles[0];
  const row = await db.vaultKey.upsert({
    where: { account_chain_role: { account: ACCOUNT, chain: CHAIN, role } },
    create: {
      account: ACCOUNT, chain: CHAIN, role,
      pubKey: pub, cipher: encryptSecret(c.wif), fingerprint: fingerprint(c.wif),
      verified: true, lastVerifiedAt: new Date(), source: 'owner-file-recovery',
      note: `roles=${result.roles.join('+')}; line ${c.line} of owner file; live-proven 2026-09-11 (roast-85 login recovery)`,
    },
    update: {
      pubKey: pub, cipher: encryptSecret(c.wif), fingerprint: fingerprint(c.wif),
      verified: true, lastVerifiedAt: new Date(), lastError: null,
      source: 'owner-file-recovery',
      note: `roles=${result.roles.join('+')}; line ${c.line} of owner file; live-proven 2026-09-11 (roast-85 login recovery)`,
    },
  });
  imported++;
  console.log(`✅ line ${c.line} → ${CHAIN}/${role} pub=${pub} roles=${result.roles.join('+')} row=${row.id}`);
}

await audit('owner-key-recovery-import', `${ACCOUNT}/${CHAIN}: ${imported} live keys imported from owner file (new vault secret, AES-256-GCM)`);
console.log(`\nimported: ${imported} live HIVE keys — vault re-armed`);
await db.$disconnect();
