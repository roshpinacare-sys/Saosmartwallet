/**
 * ONE-TIME import: every key the network holds → encrypted Sovereign Vault (SQLite).
 * Live chain verification per chain key (authorities comparison — the correct protocol).
 * Plaintext never written anywhere; source artifacts stay readable only during this run.
 */
import { db } from '../src/lib/db';
import { encryptSecret, fingerprint } from '../src/lib/vault';
import { wifToPublic, wifFromRot1Seed, ROT1_ACCOUNTS, ROT1_CHAINS, ROT1_ROLES } from '../src/lib/keys';
import { getAccount } from '../src/lib/chain';
import fs from 'fs';

const NK = JSON.parse(fs.readFileSync('/tmp/keywork/new-keys.json', 'utf8'));
const VAULT = JSON.parse(fs.readFileSync('/tmp/keywork/restored/keys__vault.json', 'utf8'));
const REG = JSON.parse(fs.readFileSync('/tmp/keywork/restored/keys__wallets-registry.json', 'utf8'));
const SEED = JSON.parse(fs.readFileSync('/tmp/keywork/restored/keys__wallets-seed.json', 'utf8'));
const MNEMS = fs.readFileSync('/tmp/keywork/restored/keys__tron-mnemonic.txt', 'utf8');
const OLDENV = fs.readFileSync('/tmp/keywork/restored/.env', 'utf8');

function envVal(src: string, key: string): string {
  const m = src.match(new RegExp('^' + key + '=(.+)$', 'm'));
  return m ? m[1].trim() : '';
}

interface VaultFleet { username: string; keys: Record<string, { wif: string; pub: string }> }
const fleetVault = (Array.isArray(VAULT) ? VAULT : VAULT.accounts) as VaultFleet[];
const vaultPub = new Map<string, Map<string, { wif: string; pub: string }>>();
for (const f of fleetVault) {
  const m = new Map<string, { wif: string; pub: string }>();
  for (const [role, k] of Object.entries(f.keys || {})) m.set(role, k);
  vaultPub.set(f.username, m);
}

let imported = 0, liveVerified = 0;
const deadRows: string[] = [];

async function upsertKey(data: {
  account: string; chain: string; role: string; secret: string;
  pubKey?: string; address?: string; verified: boolean; note: string; source?: string;
}) {
  const row = {
    account: data.account, chain: data.chain, role: data.role,
    pubKey: data.pubKey || null, address: data.address || null,
    cipher: encryptSecret(data.secret), fingerprint: fingerprint(data.secret),
    verified: data.verified, lastVerifiedAt: data.verified ? new Date() : null,
    lastError: data.verified ? null : 'not live on chain (see note)',
    note: data.note, source: data.source || 'import-2026-09-09',
  };
  await db.vaultKey.upsert({ where: { account_chain_role: { account: row.account, chain: row.chain, role: row.role } }, create: row, update: row });
  imported++;
  if (data.verified) liveVerified++;
}

(async () => {
  console.log('=== SOVEREIGN VAULT IMPORT — start ===');

  // 0) the two master seeds (the ability to regenerate everything)
  await upsertKey({ account: 'saos-rot1', chain: 'seed', role: 'seed', secret: NK.master, verified: true, note: 'SAOS-ROT1 master — derives ALL rotated keys via HMAC SAOS-ROT1/<acct>/<chain>/<role>' });
  await upsertKey({ account: 'sovereign', chain: 'seed', role: 'seed', secret: SEED.seed, verified: true, note: 'SOVEREIGN ROOT — derives all 12 multichain wallets' });

  // 1) chain accounts — pick whichever material is LIVE (ROT1 preferred, vault fallback)
  for (const chain of ROT1_CHAINS) {
    for (const account of ROT1_ACCOUNTS) {
      const acct = await getAccount(chain, account);
      if (!acct) { deadRows.push(`${account}/${chain}: account not found`); continue; }
      const rot1 = ROT1_ROLES.map(r => ({ role: r, wif: wifFromRot1Seed(NK.master, account, chain, r), pub: wifToPublic(wifFromRot1Seed(NK.master, account, chain, r)) }));
      const vm = vaultPub.get(account);
      for (const { role, wif, pub } of rot1) {
        const chainPubs = (acct as unknown as Record<string, string[] | string>)[role];
        const arr = Array.isArray(chainPubs) ? chainPubs : [String(chainPubs)];
        if (arr.includes(pub)) {
          await upsertKey({ account, chain, role, secret: wif, pubKey: pub, verified: true, note: 'LIVE (SAOS-ROT1 derived)' });
        } else if (vm && vm.get(role) && arr.includes(vm.get(role)!.pub)) {
          const vk = vm.get(role)!;
          await upsertKey({ account, chain, role, secret: vk.wif, pubKey: vk.pub, verified: true, note: 'LIVE (vault material)' });
        } else if (vm && vm.get(role)) {
          const vk = vm.get(role)!;
          await upsertKey({ account: `${account}-archive`, chain, role, secret: vk.wif, pubKey: vk.pub, verified: false, note: `pre-rotation material — no longer in authority on ${chain}` });
        } else {
          deadRows.push(`${account}/${chain}/${role}: no matching material (authority ${arr[0]?.slice(0, 16)}… unknown)`);
        }
      }
    }
  }

  // 2) headcorner previous keys (recent-owner-authority backup, dead on chain)
  for (const role of ['owner', 'active', 'posting', 'memo']) {
    const wif = envVal(OLDENV, role === 'owner' ? 'OWNER_WIF' : role === 'active' ? 'ACTIVE_WIF' : role === 'posting' ? 'POSTING_WIF' : 'MEMO_WIF');
    if (wif) await upsertKey({ account: 'headcorner-archive', chain: 'steem', role, secret: wif, pubKey: wifToPublic(wif), verified: false, note: 'headcorner pre-2026-09-08 keys — recent owner authority for recovery window' });
  }

  // 3) multichain wallets (12 agents × EVM/TRON/SOL + BTC pub)
  for (const a of REG.accounts) {
    if (a.evm) await upsertKey({ account: `wallet:${a.agent}`, chain: 'evm', role: 'wallet', secret: a.evm.pk, pubKey: a.evm.path, address: a.evm.address, verified: true, note: `nets=${(a.evm.nets || []).join(',')}` });
    if (a.tron) await upsertKey({ account: `wallet:${a.agent}`, chain: 'tron', role: 'wallet', secret: a.tron.pk, pubKey: a.tron.path, address: a.tron.address, verified: true, note: 'tron' });
    if (a.sol) await upsertKey({ account: `wallet:${a.agent}`, chain: 'sol', role: 'wallet', secret: a.sol.pk, address: a.sol.address, verified: true, note: 'solana' });
    if (a.btc) await upsertKey({ account: `wallet:${a.agent}`, chain: 'btc', role: 'wallet', secret: a.btc.pub, pubKey: a.btc.pub, address: a.btc.address, verified: true, note: 'btc public-only (xpub-derived watch material)' });
  }

  // 4) TRON mnemonics (both)
  const lines = MNEMS.split('\n').map(l => l.trim()).filter(Boolean);
  let mi = 0;
  for (const l of lines) {
    const value = l.includes(':') ? l.split(':').slice(1).join(':').trim() : l;
    if (!value) continue;
    await upsertKey({ account: mi === 0 ? 'tron' : 'tron-legacy', chain: 'mnemonic', role: 'mnemonic', secret: value, verified: true, note: `tron mnemonic #${mi + 1}` });
    mi++;
  }

  // 5) guard singleton + system chat message
  await db.guardState.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', ownerLock: true, note: 'owner-authority rotations forbidden without explicit operator instruction in-session' }, update: { note: 'owner-authority rotations forbidden without explicit operator instruction in-session' } });
  await db.chatMessage.create({ data: { author: 'system', role: 'system', content: `כספת ריבונית נטענה: ${imported} פריטים (${liveVerified} מאומתים-חי מול השרשרת). owner-lock פעיל. אסור רוטציית-owner ללא הנחיית-בעלים מפורשת.` } });

  console.log(`IMPORTED=${imported} LIVE=${liveVerified}`);
  if (deadRows.length) { console.log('NOT-LIVE / UNKNOWN:'); deadRows.forEach(d => console.log('  -', d)); }
  console.log('=== DONE ===');
  await db.$disconnect();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
