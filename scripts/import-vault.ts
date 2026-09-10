/**
 * ONE-TIME import: every key the network holds → encrypted Sovereign Vault (SQLite).
 * Live chain verification per chain key (authorities comparison — the correct protocol).
 * Plaintext never written anywhere; source artifacts stay readable only during this run.
 *
 * FIX(Roast-65-b · H3/M1/M2/L1) — סקריפט-ההתאוששות כבר-לא-נשק-נגד-הכספת:
 *  · H3  fingerprint-guard: שורה-קיימת עם fingerprint שונה → נדחה (אלא אם --force).
 *        update-עם fingerprint זהה מרענן שדות-תיאור בלבד — verified/lastVerifiedAt
 *        מעולם לא נדרסים מהסקריפט (מצב-האימות-החי של הכספת קדוש; היה: upsert דורס
 *        הכל ומהפך רוטציות בשקת). --force דורס חומר אך מאפס-כנות ל-verified:false.
 *  · M1  preflight לפני-כל-כתיבה: /tmp/keywork קיים (חסר → יציאה-נקייה-וכנה,
 *        אפס-כתיבות חלקיות), הרשאות-תיקיות נבדקות (fail על group/world-writable),
 *        JSON.parse מאומת-מבנה-פר-קובץ.
 *  · M2  verified:true רק לשורות-שאומתו-חי מול השרשרת בריצה-הזו; seeds/mnemonics/
 *        wallets נכנסים verified:false כנה. כל-הכתיבות בתוך db.$transaction אחת
 *        (היה: 50+ כתיבות-עצמאיות = ייבוא-חלקי בקריסה), והודעת-המערכת מדודה
 *        לפי-מקור (היה: כפולה-בכל-הרצה).
 *  · L1  חומר-ציבורי (מפתח-ציבורי/נתיב-גזירה) מסומן-כנות ב-note — שכלי-ייצוא/
 *        תצוגה לא יתייחסו אליו כחומר-פרטי.
 */
import fs from 'fs';
import { db } from '../src/lib/db';
import { encryptSecret, fingerprint } from '../src/lib/vault';
import { wifToPublic, wifFromRot1Seed, ROT1_ACCOUNTS, ROT1_CHAINS, ROT1_ROLES } from '../src/lib/keys';
import { getAccount } from '../src/lib/chain';

const SRC = '/tmp/keywork';
const SOURCE = 'import-2026-09-09';
const FORCE = process.argv.includes('--force');

// ── M1: preflight — אף-כתיבה לפני שהמקור הוכח-קיים/תקין/בעל-הרשאות-נאות ──────
function fail(msg: string, code = 1): never {
  console.error(`[import] ${msg}`);
  process.exit(code);
}

function preflight(): void {
  if (!fs.existsSync(SRC)) {
    // יציאה-נקייה-וכנה: אין-מקור, אין-עבודה, אפס-כתיבות (לא FATAL-מטעה)
    console.log(`[import] ${SRC} does not exist — nothing to import. Exiting cleanly, zero writes to the vault.`);
    process.exit(0);
  }
  for (const dir of [SRC, `${SRC}/restored`]) {
    let st: fs.Stats;
    try {
      st = fs.statSync(dir);
    } catch {
      fail(`required source dir missing/unreadable: ${dir} — aborting (no partial writes)`);
    }
    if (!st.isDirectory()) fail(`not a directory: ${dir} — aborting`);
    // FIX(Roast-65-b · M1): group/world-writable על תיקיית-חומר-מפתח = דלת-פתוחה —
    // נכשלים בקול; group/world-readable = אזהרה (הכתיבה-היא-המפגע-הפעיל).
    if (st.mode & 0o022) fail(`${dir} is group/world-WRITABLE (mode ${(st.mode & 0o777).toString(8)}) — refusing to read key material from it. chmod go-w and re-run.`);
    if (st.mode & 0o044) console.warn(`[import] WARNING: ${dir} is group/world-READABLE (mode ${(st.mode & 0o777).toString(8)}) — key material inside is exposed; tighten perms.`);
  }
}

function readText(p: string): string {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    fail(`cannot read ${p}: ${e instanceof Error ? e.message : String(e)} — aborting (no partial writes)`);
  }
}

function readJson<T>(p: string, validate: (v: unknown) => v is T): T {
  const raw = readText(p);
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    fail(`invalid JSON in ${p} — aborting (no partial writes)`);
  }
  if (!validate(v)) fail(`unexpected shape in ${p} — aborting (no partial writes)`);
  return v;
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

interface VaultFleet { username: string; keys: Record<string, { wif: string; pub: string }> }
interface WalletEntry { agent: string; evm?: { pk: string; path: string; address: string; nets?: string[] }; tron?: { pk: string; address: string }; sol?: { pk: string; address: string }; btc?: { pub: string; address: string } }

// ── FIX(Roast-65-b · M1): validators — JSON.parse לבדו לא ערובה (מבנה-פר-קובץ) ─
const isNK = (v: unknown): v is { master: string } => isObj(v) && isStr(v.master);
const isSeed = (v: unknown): v is { seed: string } => isObj(v) && isStr(v.seed);
const isVault = (v: unknown): v is VaultFleet[] | { accounts: VaultFleet[] } => {
  const arr = Array.isArray(v) ? v : isObj(v) && Array.isArray((v as { accounts?: unknown }).accounts) ? (v as { accounts: unknown[] }).accounts : null;
  return !!arr && arr.every(f => isObj(f as unknown) && isStr((f as VaultFleet).username) && isObj((f as VaultFleet).keys));
};
const isReg = (v: unknown): v is { accounts: WalletEntry[] } =>
  isObj(v) && Array.isArray(v.accounts) && v.accounts.every(a => isObj(a) && isStr((a as WalletEntry).agent));

preflight();
console.log('=== SOVEREIGN VAULT IMPORT — start (guarded re-run safe) ===');

const NK = readJson<{ master: string }>(`${SRC}/new-keys.json`, isNK);
const VAULT = readJson<VaultFleet[] | { accounts: VaultFleet[] }>(`${SRC}/restored/keys__vault.json`, isVault);
const REG = readJson<{ accounts: WalletEntry[] }>(`${SRC}/restored/keys__wallets-registry.json`, isReg);
const SEED = readJson<{ seed: string }>(`${SRC}/restored/keys__wallets-seed.json`, isSeed);
const MNEMS = readText(`${SRC}/restored/keys__tron-mnemonic.txt`);
const OLDENV = readText(`${SRC}/restored/.env`);

function envVal(src: string, key: string): string {
  const m = src.match(new RegExp('^' + key + '=(.+)$', 'm'));
  return m ? m[1].trim() : '';
}

const fleetVault = (Array.isArray(VAULT) ? VAULT : VAULT.accounts) as VaultFleet[];
const vaultPub = new Map<string, Map<string, { wif: string; pub: string }>>();
for (const f of fleetVault) {
  const m = new Map<string, { wif: string; pub: string }>();
  for (const [role, k] of Object.entries(f.keys || {})) m.set(role, k);
  vaultPub.set(f.username, m);
}

// ── תכנון-מלא תחילה (רשת-וקריאה בלבד), כתיבה-אחת-אטומית בסוף (FIX · M2) ─────
interface PlanRow {
  account: string; chain: string; role: string; secret: string;
  pubKey?: string; address?: string; verified: boolean; note: string; source?: string;
}
const plan: PlanRow[] = [];
let liveVerified = 0;
const deadRows: string[] = [];

function planKey(r: PlanRow): void {
  if (r.verified) liveVerified++;
  plan.push(r);
}

// כל-התכנון (כולל קריאות-רשת) בתוך try — כישלון-כאן = יציאה-לפני-אף-כתיבה
async function planAll(): Promise<void> {
  try {
// 0) the two master seeds (the ability to regenerate everything)
// FIX(Roast-65-b · M2): seed אינו-ניתן-לאימות-שרשרת — verified:false כנה (היה: true)
planKey({ account: 'saos-rot1', chain: 'seed', role: 'seed', secret: NK.master, verified: false, note: 'SAOS-ROT1 master — derives ALL rotated keys via HMAC SAOS-ROT1/<acct>/<chain>/<role>. unverified-by-import: derivation root, no on-chain check possible (derived keys are verified live instead).' });
planKey({ account: 'sovereign', chain: 'seed', role: 'seed', secret: SEED.seed, verified: false, note: 'SOVEREIGN ROOT — derives all 12 multichain wallets. unverified-by-import: derivation root, no on-chain check possible.' });

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
        planKey({ account, chain, role, secret: wif, pubKey: pub, verified: true, note: 'LIVE (SAOS-ROT1 derived) — authority match verified on-chain this run' });
      } else if (vm && vm.get(role) && arr.includes(vm.get(role)!.pub)) {
        const vk = vm.get(role)!;
        planKey({ account, chain, role, secret: vk.wif, pubKey: vk.pub, verified: true, note: 'LIVE (vault material) — authority match verified on-chain this run' });
      } else if (vm && vm.get(role)) {
        const vk = vm.get(role)!;
        planKey({ account: `${account}-archive`, chain, role, secret: vk.wif, pubKey: vk.pub, verified: false, note: `pre-rotation material — no longer in authority on ${chain}` });
      } else {
        deadRows.push(`${account}/${chain}/${role}: no matching material (authority ${arr[0]?.slice(0, 16)}… unknown)`);
      }
    }
  }
}

// 2) headcorner previous keys (recent-owner-authority backup, dead on chain)
for (const role of ['owner', 'active', 'posting', 'memo']) {
  const wif = envVal(OLDENV, role === 'owner' ? 'OWNER_WIF' : role === 'active' ? 'ACTIVE_WIF' : role === 'posting' ? 'POSTING_WIF' : 'MEMO_WIF');
  if (wif) planKey({ account: 'headcorner-archive', chain: 'steem', role, secret: wif, pubKey: wifToPublic(wif), verified: false, note: 'headcorner pre-2026-09-08 keys — recent owner authority for recovery window' });
}

// 3) multichain wallets (12 agents × EVM/TRON/SOL + BTC pub)
// FIX(Roast-65-b · M2/L1): wallets לא-אומתו-חי בריצה-הזו → verified:false;
// חומר-ציבורי (BTC pub) ונתיב-גזירה מסומנים-כנות ב-note (L1).
for (const a of REG.accounts) {
  if (a.evm) planKey({ account: `wallet:${a.agent}`, chain: 'evm', role: 'wallet', secret: a.evm.pk, pubKey: a.evm.path, address: a.evm.address, verified: false, note: `nets=${(a.evm.nets || []).join(',')}; unverified-by-import (no on-chain check this run). kind: pubKey field = derivation-path (not a public key) — L1 honesty mark.` });
  if (a.tron) planKey({ account: `wallet:${a.agent}`, chain: 'tron', role: 'wallet', secret: a.tron.pk, address: a.tron.address, verified: false, note: 'tron; unverified-by-import (no on-chain check this run)' });
  if (a.sol) planKey({ account: `wallet:${a.agent}`, chain: 'sol', role: 'wallet', secret: a.sol.pk, address: a.sol.address, verified: false, note: 'solana; unverified-by-import (no on-chain check this run)' });
  if (a.btc) planKey({ account: `wallet:${a.agent}`, chain: 'btc', role: 'wallet', secret: a.btc.pub, pubKey: a.btc.pub, address: a.btc.address, verified: false, note: 'kind: PUBLIC key stored here (xpub-derived watch material — NOT a private key; L1 honesty mark); unverified-by-import' });
}

// 4) TRON mnemonics (both) — FIX(· M2): לא-אומת מול שרשרת → false
const lines = MNEMS.split('\n').map(l => l.trim()).filter(Boolean);
let mi = 0;
for (const l of lines) {
  const value = l.includes(':') ? l.split(':').slice(1).join(':').trim() : l;
  if (!value) continue;
  planKey({ account: mi === 0 ? 'tron' : 'tron-legacy', chain: 'mnemonic', role: 'mnemonic', secret: value, verified: false, note: `tron mnemonic #${mi + 1}; unverified-by-import (no on-chain check possible for a mnemonic itself)` });
  mi++;
}
  } catch (e) {
    fail(`planning failed before any write — vault untouched: ${e instanceof Error ? e.message : String(e)}`);
  }
}
await planAll();

console.log(`[import] plan ready: ${plan.length} rows (${liveVerified} live-verified on-chain this run), ${deadRows.length} dead/unknown${FORCE ? ' — --force: fingerprint conflicts will be OVERWRITTEN and reset to unverified' : ''}`);

// ── כתיבה-אטומית אחת (FIX · M2/H3) ──────────────────────────────────────────
let created = 0, refreshed = 0, conflicts = 0, forcedResets = 0;
const conflictRows: string[] = [];

async function writeAll(): Promise<void> {
  await db.$transaction(async (tx) => {
    for (const r of plan) {
      const fp = fingerprint(r.secret);
      const where = { account_chain_role: { account: r.account, chain: r.chain, role: r.role } };
      const existing = await tx.vaultKey.findUnique({ where });
      if (!existing) {
        await tx.vaultKey.create({
          data: {
            account: r.account, chain: r.chain, role: r.role,
            pubKey: r.pubKey || null, address: r.address || null,
            cipher: encryptSecret(r.secret), fingerprint: fp,
            verified: r.verified, lastVerifiedAt: r.verified ? new Date() : null,
            lastError: r.verified ? null : 'unverified by import (see note)',
            note: r.note, source: r.source || SOURCE,
          },
        });
        created++;
        continue;
      }
      // FIX(Roast-65-b · H3): fingerprint-שונה = חומר-אחר ממה-שבכספת — דריסה
      // עיוורת כאן הפכה-רוטציות-חיות לחומר-מת. נדחה, אלא אם --force.
      if (existing.fingerprint !== fp) {
        if (!FORCE) {
          conflicts++;
          conflictRows.push(`${r.account}/${r.chain}/${r.role} — existing vault material differs from import source; refused (re-run with --force to replace, verification resets to unverified)`);
          continue;
        }
        await tx.vaultKey.update({
          where,
          data: {
            cipher: encryptSecret(r.secret), fingerprint: fp,
            pubKey: r.pubKey || null, address: r.address || null,
            // --force = חומר-חדש: מצב-האימות של הישן אינו-תקף — איפוס-כנה, לא ירושה
            verified: false, lastVerifiedAt: null,
            lastError: 're-imported with --force — requires live re-verification',
            note: r.note, source: r.source || SOURCE,
          },
        });
        forcedResets++;
        continue;
      }
      // FIX(Roast-65-b · H3): fingerprint זהה = אותו-חומר → רענון-תיאור בלבד.
      // verified/lastVerifiedAt/cipher מהכספת לעולם לא נדרסים מהסקריפט.
      await tx.vaultKey.update({
        where,
        data: {
          pubKey: r.pubKey || undefined, address: r.address || undefined,
          note: r.note, source: r.source || SOURCE,
        },
      });
      refreshed++;
    }

    // 5) guard singleton
    await tx.guardState.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ownerLock: true, note: 'owner-authority rotations forbidden without explicit operator instruction in-session' },
      update: { note: 'owner-authority rotations forbidden without explicit operator instruction in-session' },
    });

    // FIX(Roast-65-b · M2): dedupe הודעת-המערכת לפי-מקור (היה: כפולה-בכל-הרצה)
    const dup = await tx.chatMessage.findFirst({ where: { author: 'system', content: { contains: SOURCE } } });
    if (!dup) {
      const processed = created + refreshed + forcedResets;
      await tx.chatMessage.create({
        data: {
          author: 'system', role: 'system',
          content: `כספת ריבונית נטענה: ${processed} פריטים (${liveVerified} מאומתים-חי מול השרשרת). owner-lock פעיל. אסור רוטציית-owner ללא הנחיית-בעלים מפורשת. (מקור: ${SOURCE})`,
        },
      });
    }
  }, { timeout: 60_000, maxWait: 10_000 });
}

try {
  await writeAll();
} catch (e) {
  console.error('FATAL', e);
  console.error('[import] transaction aborted — vault state unchanged (atomic)');
  process.exit(1);
}

console.log(`IMPORTED: created=${created} refreshed=${refreshed}${forcedResets ? ` force-reset=${forcedResets}` : ''} LIVE=${liveVerified}`);
if (conflicts) {
  console.log(`CONFLICTS refused (${conflicts}) — existing vault material kept:`);
  conflictRows.forEach(c => console.log('  -', c));
  console.log('  (re-run with --force to replace conflicting rows; they will be reset to verified=false)');
}
if (deadRows.length) { console.log('NOT-LIVE / UNKNOWN:'); deadRows.forEach(d => console.log('  -', d)); }
console.log(`[import] reminder: ${SRC} holds plaintext artifacts — remove it when this run is confirmed`);
console.log('=== DONE ===');
await db.$disconnect();
