/**
 * steem-ops.ts — פעולות-חוץ אמת על STEEM/HIVE/BLURT מכספת-המפעיל (Task 71-flow · 71-e).
 * ═════════════════════════════════════════════════════════════════════════════
 * קריאות = fetch ישיר מול condenser RPC ציבורי · שידורים = ספריית steem (0.7.x)
 * עם מפתח-owner מהכספת (AES-256-GCM) — המפתח לעולם לא נדפס/לא יוצא מהשרת.
 *
 * 71-e (עמוק): שידור-מודע-שרשרת — chain_id נכון לכל-שרשרת. הספרייה חותמת
 * על chain_id-הקונפיג (ברירת-מחדל: אפסים = STEEM בלבד!). עד-היום כל-השידורים
 * היו STEEM — אבל hive_savings_sweep היה-חותם-STEEM על-הצעת-HIVE והיה-נופל
 * בביצוע (באג-סמוי שנתפס בביקורת). chain_id-מקור-רשמי: config.json של
 * steem-js (אפסים — הוכח-חי ב-3 שידורים) · hive-js@2.0.9 (beeab0de…)
 * · blurtjs@1.0.0 (cd8d90f2…). נעילה-סריאלית: הקונפיג סינגלטון גלובלי —
 * שני-שידורים-מקבילים לשרשראות-שונות היו מתחרים עליו; כעת כל-שידור בתור.
 *
 * הרשאות: מפתח-owner מכסה posting+active (היררכיית-graphene) — כל-הפעולות
 * (vote / transfer_to_savings / claim_reward_balance) נחתמות ב-owner.
 * fail-כנה: כל-כישלון חוזר כשגיאה-מפורשת — אף-פעם לא ok:false-מחופש להצלחה.
 */
import { db } from '@/lib/db';
import { decryptSecret } from '@/lib/vault';

type SteemLib = {
  config: { set(k: string, v: string): void };
  api: { setOptions(o: { url: string }): void };
  broadcast: {
    // steem 0.7.x — generic multi-op send: send(tx={extensions,operations}, privKeys, cb)
    send(ops: unknown, wif: Record<string, string>, cb: (e: Error | null, r?: unknown) => void): void;
  };
};
let steemSingleton: SteemLib | null = null;

async function steemLib(): Promise<SteemLib> {
  if (!steemSingleton) {
    const mod = (await import('steem')) as unknown as { default?: SteemLib } & SteemLib;
    steemSingleton = (mod.default ?? mod) as SteemLib;
  }
  return steemSingleton;
}

export const OPERATOR = 'headcorner';
export type Chain3 = 'steem' | 'hive' | 'blurt';

const RPC: Record<Chain3, string> = {
  steem: 'https://api.steemit.com',
  hive: 'https://api.hive.blog',
  blurt: 'https://blurt-rpc.saboin.com',
};

// צמתי-BLURT מוכחים (נבדקו-חי בביקורת 71-c — rpc.blurt.world/blurtworld.com מתים)
export const BLURT_NODES = [
  'https://blurt-rpc.saboin.com',
  'https://rpc.beblurt.com',
  'https://rpc.blurt.blog',
  'https://blurtrpc.dagobert.uk',
  'https://rpc.drakernoise.com',
];

// צמתי-HIVE (71-e: api.hive.blog מנתק-לפעמים — נראה-חי במהלך-הביקורת; fallback-מוכח)
export const HIVE_NODES = [
  'https://api.hive.blog',
  'https://api.openhive.network',
];

/** condenser על-HIVE עם-גלגול-צמתים — כנה: כל-הצמתים-נפלו → שגיאה-מפורשת (לא-null-מחופש) */
async function hiveCondenser(method: string, params: unknown): Promise<any> {
  let last = 'unknown';
  for (const url of HIVE_NODES) {
    try { return await condenser(url, method, params); } catch (e) { last = String(e).slice(0, 120); }
  }
  throw new Error(`hive: כל-הצמתים-לא-נגישים (אחרון: ${last})`);
}

// chain_id לכל-שרשרת — מקור: config.json של הספריות-הרשמיות (נמדד-מ-tarball רשמי,
// לא-מזיכרון): STEEM=אפסים (הוכח-חי: 3 שידורים-מוצלחים 71/71-b) · HIVE=beeab0de…
// (hive-js@2.0.9) · BLURT=cd8d90f2… (blurtjs@1.0.0)
const CHAIN_ID: Record<Chain3, string> = {
  steem: '0000000000000000000000000000000000000000000000000000000000000000',
  hive: 'beeab0de00000000000000000000000000000000000000000000000000000000',
  blurt: 'cd8d90f29ae273abec3eaa7731e25934c63eb654d55080caff2ebb7f5df6381f',
};

async function vaultOwnerWif(chain: Chain3): Promise<string> {
  return vaultWif(chain, 'owner');
}

async function vaultWif(chain: Chain3, role: 'owner' | 'posting'): Promise<string> {
  const row = await db.vaultKey.findFirst({
    where: { account: OPERATOR, chain, role, verified: true },
    orderBy: { updatedAt: 'desc' },
  });
  if (!row) throw new Error(`vault: אין מפתח-${role} חי ל-${chain} (fail-closed)`);
  return decryptSecret(row.cipher);
}

/** condenser read (fetch) — כנה-תמיד */
export async function condenser(url: string, method: string, params: unknown): Promise<any> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  const j = (await r.json()) as { result?: any; error?: { message: string } };
  if (j.error) throw new Error(j.error.message ?? 'rpc-error');
  return j.result;
}

export async function getAccount(chain: Chain3, name = OPERATOR): Promise<any | null> {
  if (chain === 'blurt') return getBlurtAccount(name);
  if (chain === 'hive') {
    const rows = await hiveCondenser('condenser_api.get_accounts', [[name]]);
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  }
  const rows = await condenser(RPC[chain], 'condenser_api.get_accounts', [[name]]);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

export async function getGlobalProps(chain: Chain3): Promise<any> {
  if (chain === 'blurt') return getBlurtProps();
  if (chain === 'hive') return hiveCondenser('condenser_api.get_dynamic_global_properties', []);
  return condenser(RPC[chain], 'condenser_api.get_dynamic_global_properties', []);
}

export async function getBlurtAccount(name = OPERATOR): Promise<any | null> {
  for (const url of BLURT_NODES) {
    try {
      const rows = await condenser(url, 'condenser_api.get_accounts', [[name]]);
      if (Array.isArray(rows) && rows[0]) return rows[0];
    } catch { /* צומת-הבא */ }
  }
  return null;
}

export async function getBlurtProps(): Promise<any | null> {
  for (const url of BLURT_NODES) {
    try { return await condenser(url, 'condenser_api.get_dynamic_global_properties', []); } catch { /* צומת-הבא */ }
  }
  return null;
}

/** SP/HP/BLP מתוך VESTS (המרה קנונית מהשרשרת) */
export function vestsToChainVests(vests: number, g: { total_vesting_fund_steem: string; total_vesting_shares: string }): number {
  const fund = parseFloat(g.total_vesting_fund_steem);
  const shares = parseFloat(g.total_vesting_shares);
  return shares > 0 ? (vests * fund) / shares : 0;
}

/* ── שידור-מודע-שרשרת: נעילה-סריאלית (קונפיג-סינגלטון גלובלי) ── */
let broadcastLock: Promise<unknown> = Promise.resolve();

function sendOps(chain: Chain3, ops: [string, Record<string, unknown>][], wif: string): Promise<{ ok: true; result?: unknown }> {
  const run = broadcastLock.then(
    () =>
      new Promise<{ ok: true; result?: unknown }>((resolve, reject) => {
        steemLib()
          .then((lib) => {
            lib.config.set('chain_id', CHAIN_ID[chain]); // חתימה על chain_id-הנכון — לא על ברירת-המחדל של STEEM
            lib.api.setOptions({ url: RPC[chain] });
            lib.broadcast.send(
              { extensions: [], operations: ops.map(([name, data]) => [name, data]) },
              { owner: wif },
              (err, res) => {
                if (err) reject(new Error(String((err as Error).message ?? err).slice(0, 300)));
                else resolve({ ok: true, result: res });
              },
            );
          })
          .catch(reject);
      }),
  );
  broadcastLock = run.catch(() => {}); // השרשרת-חיה-גם-אחרי-כישלון — אף-שידור-לא-נתקע
  return run;
}

export interface VoteResult { ok: true; voter: string; author: string; permlink: string; weight: number; chain: Chain3 }
export async function chainVote(chain: Chain3, opts: { author: string; permlink: string; weightPct: number }): Promise<VoteResult> {
  const { author, permlink, weightPct } = opts;
  if (!author || !permlink) throw new Error('vote: author/permlink נדרשים');
  if (!Number.isFinite(weightPct) || weightPct < 0.1 || weightPct > 100) throw new Error('vote: weightPct 0.1–100 בלבד');
  // הצבעה = פעולת-posting. מפתח-posting קודם (HIVE-דורש-זאת-מפורשות — הוכח-חי 71-e);
  // owner-כגיבוי (STEEM/BLURT-הוכחו-חי-עם-owner);
  let wif: string;
  try { wif = await vaultWif(chain, 'posting'); } catch { wif = await vaultWif(chain, 'owner'); }
  const weight = Math.round(weightPct * 100);
  await sendOps(chain, [['vote', { voter: OPERATOR, author, permlink, weight }]], wif);
  return { ok: true, voter: OPERATOR, author, permlink, weight, chain };
}

/** תביעת-פרסים — STEEM/HIVE (BLURT: אין-פרסים-כרגע; צורת-op-לא-אומתה — לא-מומש עד-ראיה) */
export async function claimRewards(chain: 'steem' | 'hive'): Promise<{ ok: true; claimed: string }> {
  const acc = await getAccount(chain);
  if (!acc) throw new Error(`${chain}: חשבון לא נמצא`);
  const coin = chain === 'hive' ? acc.reward_hive_balance : acc.reward_steem_balance;
  const debt = chain === 'hive' ? acc.reward_hbd_balance : acc.reward_sbd_balance;
  const parts = [coin, debt, acc.reward_vesting_balance].map(String);
  if (parts.every((p) => parseFloat(p) === 0)) throw new Error('claim: אין-פרסים-ממתינים (כנות)');
  const wif = await vaultOwnerWif(chain);
  await sendOps(chain, [[
    'claim_reward_balance',
    { account: OPERATOR, reward_steem: parts[0], reward_sbd: parts[1], reward_vests: parts[2] },
  ]], wif);
  return { ok: true, claimed: parts.filter((p) => parseFloat(p) > 0).join(' + ') };
}

export async function hiveSavingsSweep(): Promise<{ ok: true; amount: string; apr: string }> {
  const acc = await getAccount('hive');
  if (!acc) throw new Error('hive: חשבון לא נמצא');
  const hbd = parseFloat(String(acc.hbd_balance ?? '0'));
  const FLOOR = 1;
  if (!(hbd >= FLOOR)) throw new Error(`savings: יתרת HBD ${hbd.toFixed(3)} מתחת לרצפה ${FLOOR} HBD — כלום להפקיד (כנות)`);
  const wif = await vaultOwnerWif('hive');
  const amount = `${hbd.toFixed(3)} HBD`;
  await sendOps('hive', [['transfer_to_savings', { from: OPERATOR, to: OPERATOR, amount, memo: 'flow-engine: HBD savings 15% APR' }]], wif);
  return { ok: true, amount, apr: '15%' };
}

/** מועמד-אוטו-קיוריישן: פוסט-חי מהטרנדינג (צעיר-מ-18h, תמיכה-חיובית, לא שלנו) — כל-שרשרת
 * 71-h: שדה-voted (הצבענו-כבר?) — דה-דופ לאוטופיילוט + ל-UI (אמת מ-active_votes) */
export async function curationCandidates(chain: Chain3, tag = ''): Promise<Array<{ author: string; permlink: string; created: string; ageH: number; title: string; votes: number; voted: boolean }>> {
  const q: Record<string, unknown> = { limit: 20 };
  if (tag) q.tag = tag;
  const rows = chain === 'hive'
    ? await hiveCondenser('condenser_api.get_discussions_by_trending', [q])
    : await condenser(RPC[chain], 'condenser_api.get_discussions_by_trending', [q]);
  const now = Date.now();
  return (Array.isArray(rows) ? rows : [])
    .map((d: any) => ({
      author: String(d.author ?? ''),
      permlink: String(d.permlink ?? ''),
      created: String(d.created ?? ''),
      ageH: (now - new Date(d.created).getTime()) / 3600_000,
      title: String(d.title ?? '').slice(0, 60),
      // BLURT מוריד את net_votes — ספירה מ-active_votes (אמת-שדה, נבדק-חי 71-e)
      votes: Number.isFinite(Number(d.net_votes)) ? Number(d.net_votes) : (Array.isArray(d.active_votes) ? d.active_votes.length : 0),
      voted: Array.isArray(d.active_votes) ? (d.active_votes as Array<{ voter: string }>).some((v) => v.voter === OPERATOR) : false,
    }))
    .filter((c: { author: string; ageH: number }) => c.author && c.author !== OPERATOR && c.ageH > 1 && c.ageH < 18);
}

/** פרסום-פוסט-שורש (מנוע-התוכן · 71-h) — op-comment חותם posting-קודם/owner-גיבוי (אותו-דפוס-הצבעה) */
export async function steemPublish(opts: { title: string; body: string; tags: string[]; permlink: string }): Promise<{ ok: true; permlink: string; author: string }> {
  if (!opts.title.trim() || !opts.body.trim()) throw new Error('publish: title/body נדרשים (fail-honest)');
  if (!/^[\w-]{3,96}$/.test(opts.permlink)) throw new Error('publish: permlink לא-תקין (a-z0-9-)');
  const tags = opts.tags.filter((t) => /^[\w-]{2,24}$/.test(t)).slice(0, 5);
  let wif: string;
  try { wif = await vaultWif('steem', 'posting'); } catch { wif = await vaultOwnerWif('steem'); }
  await sendOps('steem', [['comment', {
    parent_author: '',
    parent_permlink: tags[0] || 'saos',
    author: OPERATOR,
    permlink: opts.permlink,
    title: opts.title.slice(0, 200),
    body: opts.body.slice(0, 60000),
    json_metadata: JSON.stringify({ tags, app: 'saos-flow/71h', format: 'markdown' }),
  }]], wif);
  return { ok: true, permlink: opts.permlink, author: OPERATOR };
}

/** פוסטים-שורש-אחרונים שלנו (publish-desk) — מקור-אמת ללולאת-הפרסום (71-f) */
export async function ownBlogPosts(chain: Chain3, limit = 3): Promise<Array<{ permlink: string; created: string; title: string; pendingSbd: number; votes: number; hasSelfVote: boolean }>> {
  const rows = chain === 'hive'
    ? await hiveCondenser('condenser_api.get_discussions_by_blog', [{ tag: OPERATOR, limit }])
    : await condenser(RPC[chain], 'condenser_api.get_discussions_by_blog', [{ tag: OPERATOR, limit }]);
  return (Array.isArray(rows) ? rows : [])
    .filter((d: any) => d.author === OPERATOR && !d.parent_author)
    .map((d: any) => ({
      permlink: String(d.permlink ?? ''),
      created: String(d.created ?? ''),
      title: String(d.title ?? '').slice(0, 80),
      pendingSbd: parseFloat(String(d.pending_payout_value ?? '0')) || 0,
      votes: Array.isArray(d.active_votes) ? d.active_votes.length : Number(d.net_votes ?? 0),
      hasSelfVote: Array.isArray(d.active_votes) ? (d.active_votes as Array<{ voter: string }>).some((v) => v.voter === OPERATOR) : false,
    }));
}

/** RC-מנאבר (STEEM) — יכולת-תפעול של ההצבעות (71-f: טלמטריה-חיה) */
export async function steemRcMana(): Promise<{ pct: number }> {
  const r = await condenser(RPC.steem, 'rc_api.find_rc_accounts', { accounts: [OPERATOR] });
  const a = r?.rc_accounts?.[0];
  if (!a) throw new Error('rc: no account');
  const cur = BigInt(a.rc_manabar?.current_mana ?? '0');
  const max = BigInt(a.max_rc ?? '1');
  return { pct: Number((cur * 10000n) / max) / 100 };
}

export async function postInfo(chain: Chain3, author: string, permlink: string): Promise<any | null> {
  const r = chain === 'hive'
    ? await hiveCondenser('condenser_api.get_content', [author, permlink])
    : await condenser(RPC[chain], 'condenser_api.get_content', [author, permlink]);
  return r && r.author ? r : null;
}
