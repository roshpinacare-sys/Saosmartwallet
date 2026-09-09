// Live chain verification against STEEM + HIVE public RPCs.
// The single source of truth for "is this key still in control?"
import type { Chain, Role } from './keys';

const NODES: Record<Chain, string[]> = {
  steem: ['https://api.steemit.com', 'https://api.steemitdev.com'],
  hive: ['https://api.hive.blog', 'https://anyx.io', 'https://api.openhive.network'],
};

export interface AccountAuths {
  account: string;
  chain: Chain;
  owner: string[];
  active: string[];
  posting: string[];
  memo: string[];
  balances: Record<string, string>;
}

async function rpc(url: string, method: string, params: unknown[]): Promise<{ result?: unknown; error?: unknown }> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
    signal: AbortSignal.timeout(15000),
  });
  return r.json();
}

export async function getAccount(chain: Chain, name: string): Promise<AccountAuths | null> {
  for (const url of NODES[chain]) {
    try {
      const j = await rpc(url, 'condenser_api.get_accounts', [[name]]);
      const acc = (j as { result?: Array<Record<string, unknown>> }).result?.[0];
      if (!acc) return null;
      const keyOf = (x: unknown): string[] => {
        const o = x as { key_auths?: Array<[string, number]> };
        return (o.key_auths || []).map(k => k[0]);
      };
      return {
        account: name,
        chain,
        owner: keyOf(acc.owner),
        active: keyOf(acc.active),
        posting: keyOf(acc.posting),
        memo: [String(acc.memo_key || '')],
        balances: {
          liquid: String(acc.balance ?? acc.hive ?? ''),
          debt: String(acc.sbd_balance ?? acc.hbd_balance ?? ''),
          vests: String(acc.vesting_shares ?? ''),
          savings: String(acc.savings_balance ?? acc.savings_hive ?? ''),
        },
      };
    } catch {
      continue; // try next node
    }
  }
  return null;
}

// Which roles does this public key currently control on this account?
export function rolesForPub(acct: AccountAuths, pub: string): Role[] {
  const roles: Role[] = [];
  if (acct.owner.includes(pub)) roles.push('owner');
  if (acct.active.includes(pub)) roles.push('active');
  if (acct.posting.includes(pub)) roles.push('posting');
  if (acct.memo.includes(pub)) roles.push('memo');
  return roles;
}

export interface VerifyResult {
  ok: boolean;
  account: string;
  chain: Chain;
  roles: Role[];
  balances?: Record<string, string>;
  error?: string;
}

// Full live check: WIF → pub → on-chain authorities.
export async function verifyWif(wif: string, account: string, chain: Chain, pubOverride?: string): Promise<{ pub: string; result: VerifyResult }> {
  const { wifToPublic } = await import('./keys');
  let pub = '';
  try {
    pub = pubOverride || wifToPublic(wif);
  } catch (e) {
    return { pub: '', result: { ok: false, account, chain, roles: [], error: 'invalid WIF: ' + String(e).slice(0, 80) } };
  }
  const acct = await getAccount(chain, account);
  if (!acct) return { pub, result: { ok: false, account, chain, roles: [], error: `account ${account} not found on ${chain}` } };
  const roles = rolesForPub(acct, pub);
  return { pub, result: { ok: roles.length > 0, account, chain, roles, balances: acct.balances } };
}
