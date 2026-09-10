/**
 * PUBLISH-DESK — multi-rail read layer (steem | hive | blurt).
 *
 * All three are graphene-family chains speaking condenser_api JSON-RPC, so
 * ONE transport serves all rails. What differs per rail:
 *   · endpoint pool (only LIVE-VERIFIED endpoints are ever hardcoded —
 *     the repo rule: "never hardcode unverified endpoints")
 *   · chain id (signing digest domain): steem mainnet = 32 zero bytes;
 *     hive mainnet = 32 zero bytes too (dhive's hardcoded default — the
 *     id every mainstream hive client signs with; empirically re-proven on
 *     every broadcast we make). blurt: no verified endpoint from this
 *     infra yet → read rail reports honestly, broadcast rail stays
 *     fail-closed until an endpoint AND a vault key both exist.
 *   · asset naming (STEEM/SBD vs HIVE/HBD)
 *
 * Key sovereignty: verifyPostingKeyOnChain() proves a vault WIF controls an
 * account by comparing the DERIVED public key against the account's own
 * on-chain posting authority — pure crypto + a public read, no broadcast,
 * no assumption. This is the fail-closed gate before every hive broadcast.
 */
import { SteemAdapter } from "../../../packages/chains/steem/src/adapter";
import { PrivateKey, steemPublicKeyDecode, steemPublicKeyEncode } from "../../../packages/crypto/src/index";

export type Rail = "steem" | "hive" | "blurt";

/** Steem mainnet signs over 32 zero bytes (live-proven: every broadcast + oracle on real txs). */
export const STEEM_CHAIN_ID = new Uint8Array(32);

/**
 * Hive mainnet signing domain — LIVE-ORACLE-PROVEN 2026-09-10, not assumed:
 * rebuilding real on-chain hive txs with our wire-exact packer (byte-identical
 * to condenser_api.get_transaction_hex), the on-chain signatures recover to
 * the signers' authority keys ONLY under beeab0de… — matches dhive's own
 * DEFAULT_CHAIN_ID. A zeros-domain signature is rejected by hive nodes with
 * “Missing Posting Authority” (live-observed, the bug this constant fixed).
 */
export const HIVE_CHAIN_ID = new Uint8Array(
  Buffer.from("beeab0de00000000000000000000000000000000000000000000000000000000", "hex"),
);

/** Endpoint pools — every entry live-verified before it entered this file. */
export const RAIL_ENDPOINTS: Record<Rail, string[]> = {
  // verified live 2026-09-08..09 (see src/lib/steem-server.ts notes)
  steem: ["https://api.steemit.com", "https://api.justyy.com", "https://api.steemitdev.com"],
  // verified live 2026-09-10: all three answered condenser_api.get_dynamic_global_properties
  hive: ["https://api.hive.blog", "https://api.deathwing.me", "https://api.openhive.network"],
  // probed live 2026-09-10: rpc.blurt.world / blurt-rpc.saladjon.com / rpc.blurt.buzz /
  // blurt.lexai.host — ALL unreachable from this infra. No endpoint is trusted →
  // the blurt rail stays honest-disabled until an operator supplies a verified one.
  blurt: [],
};

export const RAIL_ASSETS: Record<Rail, { liquid: string; debt: string }> = {
  steem: { liquid: "STEEM", debt: "SBD" },
  hive: { liquid: "HIVE", debt: "HBD" },
  blurt: { liquid: "BLURT", debt: "BBD" },
};

const lastErrors: Partial<Record<Rail, string>> = {};
export function railLastError(rail: Rail): string | null {
  return lastErrors[rail] ?? null;
}

/** JSON-RPC with endpoint failover; records the honest last error per rail. */
export async function railRpc<T>(rail: Rail, method: string, params: unknown, timeoutMs = 10_000): Promise<T> {
  const endpoints = RAIL_ENDPOINTS[rail];
  if (!endpoints.length) throw new Error(`rail ${rail}: אין endpoint מאומת (בדוק חי מחדש לפני שימוש)`);
  let lastErr: unknown = null;
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { result?: T; error?: { message?: string } };
      if (j.error) throw new Error(j.error.message || "rpc error");
      lastErrors[rail] = undefined;
      return j.result as T;
    } catch (e) {
      lastErr = e;
      lastErrors[rail] = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`rail ${rail} probe failed on all endpoints: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

export interface RailHealth {
  rail: Rail;
  reachable: boolean;
  headBlock?: number;
  headBlockId?: string;
  time?: string;
  asset?: string;
  error?: string;
}

export async function railHealth(rail: Rail): Promise<RailHealth> {
  if (!RAIL_ENDPOINTS[rail].length) {
    return { rail, reachable: false, error: "no verified public endpoint (blurt: all candidates unreachable 2026-09-10)" };
  }
  try {
    const dgp = await railRpc<{ head_block_number: number; head_block_id: string; time: string }>(
      rail, "condenser_api.get_dynamic_global_properties", [],
    );
    return { rail, reachable: true, headBlock: dgp.head_block_number, headBlockId: dgp.head_block_id, time: dgp.time, asset: RAIL_ASSETS[rail].liquid };
  } catch (e) {
    return { rail, reachable: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface RailAccountRaw {
  name: string;
  created?: string;
  balance?: string;
  hbd_balance?: string;
  sbd_balance?: string;
  vesting_shares?: string;
  post_count?: number;
  posting?: { key_auths?: Array<[string, number]> };
  memo_key?: string;
  json_metadata?: string;
  posting_json_metadata?: string;
}

export async function railAccounts(rail: Rail, names: string[]): Promise<RailAccountRaw[]> {
  if (!names.length) return [];
  const rows = await railRpc<RailAccountRaw[]>(rail, "condenser_api.get_accounts", [names.map((n) => n.toLowerCase())]);
  return Array.isArray(rows) ? rows : [];
}

export interface RailPost {
  author: string;
  permlink: string;
  category: string; // the root post's parent_permlink — an EDIT must preserve it
  title: string;
  created: string;
  lastUpdate: string; // STEEM_MIN_COMMENT_EDIT_INTERVAL pacing reads this
  payout: string; // pending or claimed — whichever the chain reports
  bodyPreview: string; // bounded preview for UI lists
  body: string; // FULL body — the doctrine audit scans the WHOLE post, not its first 400 chars
  tags: string[];
  jsonMetadata: string;
}

function parseTags(jsonMetadata: string | undefined): string[] {
  try {
    const j = JSON.parse(jsonMetadata || "{}") as { tags?: unknown };
    return Array.isArray(j.tags) ? j.tags.map((t) => String(t)).slice(0, 5) : [];
  } catch {
    return [];
  }
}

/** The account's own blog feed — the "who publishes what and how" ground truth. */
export async function railBlogPosts(rail: Rail, account: string, limit = 10): Promise<RailPost[]> {
  const rows = await railRpc<Array<Record<string, string>>>(
    rail, "condenser_api.get_discussions_by_blog", [{ tag: account.toLowerCase(), limit: Math.min(Math.max(limit, 1), 20) }],
    12_000,
  );
  return (rows || []).map((p) => {
    const tags = parseTags(p.json_metadata);
    return {
      author: String(p.author || ""),
      permlink: String(p.permlink || ""),
      category: String(p.category || tags[0] || ""),
      title: String(p.title || ""),
      created: String(p.created || ""),
      lastUpdate: String(p.last_update || p.created || ""),
      payout: String(p.pending_payout_value || p.total_payout_value || "0"),
      bodyPreview: String(p.body || "").slice(0, 400),
      body: String(p.body || ""),
      tags,
      jsonMetadata: String(p.json_metadata || "{}"),
    };
  });
}

export async function railGetContent(rail: Rail, author: string, permlink: string): Promise<RailPost | null> {
  const p = await railRpc<Record<string, string> | Record<string, never>>(
    rail, "condenser_api.get_content", [author.toLowerCase(), permlink],
  );
  if (!p || !("author" in p) || !p.author) return null;
  const tags = parseTags(p.json_metadata);
  return {
    author: String(p.author),
    permlink: String(p.permlink || permlink),
    category: String((p as Record<string, string>).category || tags[0] || ""),
    title: String(p.title || ""),
    created: String(p.created || ""),
    lastUpdate: String((p as Record<string, string>).last_update || p.created || ""),
    payout: String(p.pending_payout_value || p.total_payout_value || "0"),
    bodyPreview: String(p.body || "").slice(0, 400),
    body: String(p.body || ""),
    tags,
    jsonMetadata: String(p.json_metadata || "{}"),
  };
}

// ---------------------------------------------------------------------------
// Key verification — the fail-closed gate before any broadcast on a rail
// ---------------------------------------------------------------------------

export interface RailKeyProof {
  rail: Rail;
  account: string;
  hasChainAccount: boolean;
  hasPostingAuthority: boolean;
  chainPub: string | null;
  derivedPub: string | null;
  match: boolean;
  reason?: string;
}

/**
 * Proves (or disproves) that a key is the CURRENT posting authority of an
 * account on a rail — by deriving its public key and comparing raw 33 bytes
 * against the account's on-chain posting key_auths. Zero broadcast, zero
 * stored assumptions: the chain itself is the oracle.
 *
 * `key` accepts EITHER a canonical WIF string OR pre-derived 33-byte public
 * material ({ pub33 }) — the gate vault stores headcorner keys in a
 * non-canonical wire quirk that PrivateKey.fromWif rejects, so callers
 * derive pub33 through the SAME tolerant path they sign with (toSigningKey)
 * and pass it here. Accepting pre-derived bytes is caller-trust: only
 * server-side, post-unlock code may use it.
 */
export async function verifyPostingKeyOnChain(
  rail: Rail,
  account: string,
  key: string | { pub33: Uint8Array },
): Promise<RailKeyProof> {
  const base: RailKeyProof = { rail, account, hasChainAccount: false, hasPostingAuthority: false, chainPub: null, derivedPub: null, match: false };
  let derived33: Uint8Array;
  try {
    derived33 = typeof key === "string" ? PrivateKey.fromWif(key.trim()).publicKey.bytes : key.pub33;
  } catch {
    return { ...base, reason: "WIF פגום — לא נפתח" };
  }
  base.derivedPub = steemPublicKeyEncode(derived33, "STM");
  let rows: RailAccountRaw[];
  try {
    rows = await railAccounts(rail, [account]);
  } catch (e) {
    return { ...base, reason: `קריאת החשבון נכשלה: ${e instanceof Error ? e.message : String(e)}` };
  }
  const raw = rows?.[0];
  if (!raw) return { ...base, reason: `אין חשבון ${account} על ${rail} בכלל` };
  const auths = raw.posting?.key_auths ?? [];
  if (!auths.length) return { ...base, hasChainAccount: true, reason: "לחשבון אין authority-posting בכלל" };
  base.hasChainAccount = true;
  base.hasPostingAuthority = true;
  // roast r3 (truth-gap found live): only key_auths[0] was compared — an account
  // with SEVERAL posting keys whose vault key sits in auths[1..] was falsely
  // reported as a mismatch, fail-closing a perfectly valid key. Compare ALL.
  const derived = Buffer.from(derived33);
  for (const [pub] of auths) {
    base.chainPub = String(pub);
    let chain33: Uint8Array;
    try {
      chain33 = steemPublicKeyDecode(base.chainPub, ["STM", "TST", "HIVE", "BLURT"]);
    } catch {
      continue; // undecodable chain entry — try the next authority key
    }
    if (chain33.length === 33 && Buffer.compare(Buffer.from(chain33), derived) === 0) {
      return { ...base, match: true };
    }
  }
  return { ...base, match: false };
}

// ---------------------------------------------------------------------------
// Hive write path — the SAME wire-exact engine, the hive chain domain
// ---------------------------------------------------------------------------

let hiveReadSingleton: SteemAdapter | null = null;
let hiveBroadcastSingleton: SteemAdapter | null = null;

function hiveAdapterOpts() {
  return {
    rpcUrl: RAIL_ENDPOINTS.hive[0],
    rpcUrls: RAIL_ENDPOINTS.hive.slice(1), // roast r3: hive write/read path failover, same lesson as steem
    chainId: HIVE_CHAIN_ID,
    addressPrefix: "STM", // hive nodes keep the legacy STM key prefix
    requestTimeoutMs: 15_000,
  } as const;
}

/** Hive read adapter — broadcast-disabled, fail-closed by construction. */
export function hiveAdapter(): SteemAdapter {
  if (!hiveReadSingleton) hiveReadSingleton = new SteemAdapter({ ...hiveAdapterOpts() });
  return hiveReadSingleton;
}

/**
 * Hive write path — explicit broadcast opt-in, used ONLY by the gate's
 * sovereign-voice signing pipeline after verifyPostingKeyOnChain passed.
 */
export function hiveBroadcastAdapter(): SteemAdapter {
  if (!hiveBroadcastSingleton) hiveBroadcastSingleton = new SteemAdapter({ ...hiveAdapterOpts(), allowBroadcast: true });
  return hiveBroadcastSingleton;
}
