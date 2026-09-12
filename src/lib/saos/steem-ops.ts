/**
 * steem-ops.ts — פעולות-חוץ אמת על STEEM/HIVE מכספת-המפעיל (Task 71-flow).
 * ═════════════════════════════════════════════════════════════════════════════
 * קריאות = fetch ישיר מול condenser RPC ציבורי · שידורים = ספריית steem (0.7.x)
 * עם מפתח-owner מהכספת (AES-256-GCM) — המפתח לעולם לא נדפס/לא יוצא מהשרת.
 * הרשאות: מפתח-owner מכסה posting+active (היררכיית-graphene) — כל-הפעולות-כאן
 * (vote / transfer_to_savings / claim_reward_balance) נחתמות ב-owner.
 * fail-כנה: כל-כישלון חוזר כשגיאה-מפורשת — אף-פעם לא ok:false-מחופש להצלחה.
 */
import { db } from '@/lib/db';
import { decryptSecret } from '@/lib/vault';

type SteemLib = {
  api: { setOptions(o: { url: string }): void };
  broadcast: {
    // steem 0.7.x — generic multi-op send: send([[opName, opData], ...], wif, cb)
    send(ops: unknown[][], wif: string, cb: (e: Error | null, r?: unknown) => void): void;
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
const STEEM_RPC = 'https://api.steemit.com';
const HIVE_RPC = 'https://api.hive.blog';

async function vaultOwnerWif(chain: 'steem' | 'hive'): Promise<string> {
  const row = await db.vaultKey.findFirst({
    where: { account: OPERATOR, chain, role: 'owner', verified: true },
    orderBy: { updatedAt: 'desc' },
  });
  if (!row) throw new Error(`vault: אין מפתח-owner חי ל-${chain} (fail-closed)`);
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

export async function getAccount(chain: 'steem' | 'hive', name = OPERATOR): Promise<any | null> {
  const url = chain === 'steem' ? STEEM_RPC : HIVE_RPC;
  const rows = await condenser(url, 'condenser_api.get_accounts', [[name]]);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

export async function getGlobalProps(chain: 'steem' | 'hive'): Promise<any> {
  return condenser(chain === 'steem' ? STEEM_RPC : HIVE_RPC, 'condenser_api.get_dynamic_global_properties', []);
}

/** SP/HP מתוך VESTS (המרה קנונית מהשרשרת) */
export function vestsToChainVests(vests: number, g: { total_vesting_fund_steem: string; total_vesting_shares: string }): number {
  const fund = parseFloat(g.total_vesting_fund_steem);
  const shares = parseFloat(g.total_vesting_shares);
  return shares > 0 ? (vests * fund) / shares : 0;
}

function sendOps(url: string, ops: [string, Record<string, unknown>][], wif: string): Promise<{ ok: true; result?: unknown }> {
  return new Promise((resolve, reject) => {
    steemLib()
      .then((lib) => {
        lib.api.setOptions({ url });
        // steem 0.7.x: send(tx, privKeys, cb) — tx={extensions, operations}, privKeys={role: wif}
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
  });
}

export interface VoteResult { ok: true; voter: string; author: string; permlink: string; weight: number; block?: number }
export async function steemVote(opts: { author: string; permlink: string; weightPct: number }): Promise<VoteResult> {
  const { author, permlink, weightPct } = opts;
  if (!author || !permlink) throw new Error('vote: author/permlink נדרשים');
  if (!Number.isFinite(weightPct) || weightPct < 0.1 || weightPct > 100) throw new Error('vote: weightPct 0.1–100 בלבד');
  const wif = await vaultOwnerWif('steem');
  const weight = Math.round(weightPct * 100);
  await sendOps(STEEM_RPC, [['vote', { voter: OPERATOR, author, permlink, weight }]], wif);
  return { ok: true, voter: OPERATOR, author, permlink, weight };
}

export async function hiveSavingsSweep(): Promise<{ ok: true; amount: string; apr: string }> {
  const acc = await getAccount('hive');
  if (!acc) throw new Error('hive: חשבון לא נמצא');
  const hbd = parseFloat(String(acc.hbd_balance ?? '0'));
  const FLOOR = 1;
  if (!(hbd >= FLOOR)) throw new Error(`savings: יתרת HBD ${hbd.toFixed(3)} מתחת לרצפה ${FLOOR} HBD — כלום להפקיד (כנות)`);
  const wif = await vaultOwnerWif('hive');
  const amount = `${hbd.toFixed(3)} HBD`;
  await sendOps(HIVE_RPC, [['transfer_to_savings', { from: OPERATOR, to: OPERATOR, amount, memo: 'flow-engine: HBD savings 15% APR' }]], wif);
  return { ok: true, amount, apr: '15%' };
}

export async function steemClaimRewards(): Promise<{ ok: true; claimed: string }> {
  const acc = await getAccount('steem');
  if (!acc) throw new Error('steem: חשבון לא נמצא');
  const parts = [acc.reward_steem_balance, acc.reward_sbd_balance, acc.reward_vesting_balance].map(String);
  if (parts.every((p) => parseFloat(p) === 0)) throw new Error('claim: אין-פרסים-ממתינים (כנות)');
  const wif = await vaultOwnerWif('steem');
  await sendOps(STEEM_RPC, [[
    'claim_reward_balance',
    { account: OPERATOR, reward_steem: parts[0], reward_sbd: parts[1], reward_vests: parts[2] },
  ]], wif);
  return { ok: true, claimed: parts.filter((p) => parseFloat(p) > 0).join(' + ') };
}

/** מועמד-אוטו-קיוריישן: פוסט-חי מהטרנדינג (צעיר-מ-18h, תמיכה-חיובית, לא שלנו) */
export async function curationCandidates(tag = ''): Promise<Array<{ author: string; permlink: string; created: string; ageH: number; title: string; votes: number }>> {
  const q: Record<string, unknown> = { limit: 20 };
  if (tag) q.tag = tag;
  const rows = await condenser(STEEM_RPC, 'condenser_api.get_discussions_by_trending', [q]);
  const now = Date.now();
  return (Array.isArray(rows) ? rows : [])
    .map((d: any) => ({
      author: String(d.author ?? ''),
      permlink: String(d.permlink ?? ''),
      created: String(d.created ?? ''),
      ageH: (now - new Date(d.created).getTime()) / 3600_000,
      title: String(d.title ?? '').slice(0, 60),
      votes: Number(d.net_votes ?? 0),
    }))
    .filter((c: { author: string; ageH: number }) => c.author && c.author !== OPERATOR && c.ageH > 1 && c.ageH < 18);
}

export async function postInfo(author: string, permlink: string): Promise<any | null> {
  const r = await condenser(STEEM_RPC, 'condenser_api.get_content', [author, permlink]);
  return r && r.author ? r : null;
}
