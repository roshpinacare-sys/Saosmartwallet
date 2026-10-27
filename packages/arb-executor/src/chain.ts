/**
 * packages/arb-executor — live chain reads (read-only, injected rpc)
 * ===================================================================
 * Everything the decision plane needs from the chain, all READ-ONLY:
 *
 *   • refBlock (graphene tapos): head_block_number → refBlockNum =
 *     head & 0xFFFF; refBlockPrefix = block-id bytes 4..8 read as LE u32 —
 *     the derivation steem-js/dhive use, applied to the measured
 *     condenser_api.get_dynamic_global_properties shape;
 *   • balances (condenser_api.get_accounts): spendable STEEM + SBD;
 *   • RC (rc_api.find_rc_accounts): current_mana / max_rc → percent;
 *   • ACTIVE-authority verification: the custody file's derived active pubkey
 *     MUST be present in the account's live active key_auths — accounts whose
 *     keys drifted off-vault (the measured custody-wound class) are reported
 *     AUTHORITY-MISMATCH and the rail refuses them (fail-honest).
 *
 * Transport is injected (zero-network tests); live runs use public nodes.
 */

export type JsonRpcLike = (endpoint: string, method: string, params: unknown) => Promise<unknown>;

export interface ChainReaderOptions {
  endpoint: string;
  rpc: JsonRpcLike;
  timeoutMs?: number;
}

export interface RefBlock {
  refBlockNum: number;
  refBlockPrefix: number;
  headBlock: number;
  headBlockId: string;
  headTime: string;
}

export interface AccountState {
  account: string;
  steemSatoshis: number;
  sbdSatoshis: number;
  activePubkeys: string[];
  rcPercent: number | null;
}

export type AuthorityVerdict =
  | { account: string; ok: true; matchedKeys: number }
  | { account: string; ok: false; reason: string; matchedKeys: number };

export class ChainReader {
  constructor(private readonly options: ChainReaderOptions) {}

  async refBlock(): Promise<RefBlock> {
    const d = (await this.options.rpc(this.options.endpoint, "condenser_api.get_dynamic_global_properties", [])) as {
      head_block_number?: number;
      head_block_id?: string;
      time?: string;
    };
    const head = d.head_block_number;
    const headId = d.head_block_id ?? "";
    if (typeof head !== "number" || head <= 0 || headId.length < 16) {
      throw new Error(`CHAIN_E_REF_BLOCK — node did not expose a usable head (${JSON.stringify({ head, headId: headId.slice(0, 8) })})`);
    }
    // graphene tapos: refBlockNum = head & 0xFFFF; prefix = bytes 4..8 LE.
    const raw = Buffer.from(headId, "hex");
    const refBlockPrefix = raw.length >= 8 ? raw.readUInt32LE(4) : 0;
    return {
      refBlockNum: head & 0xffff,
      refBlockPrefix,
      headBlock: head,
      headBlockId: headId,
      headTime: d.time ?? "",
    };
  }

  async accountState(account: string): Promise<AccountState> {
    const raw = (await this.options.rpc(this.options.endpoint, "condenser_api.get_accounts", [[account]])) as Array<{
      name?: string;
      balance?: string;
      sbd_balance?: string;
      active?: { key_auths?: Array<[string, number]> };
    }>;
    const a = raw?.[0];
    if (!a || a.name !== account) {
      throw new Error(`CHAIN_E_ACCOUNT — node returned no state for ${account}`);
    }
    const parse = (s: string | undefined): number => {
      const m = /^(-?\d+(?:\.\d+)?)\s+(STEEM|SBD|HIVE|HBD)$/.exec(s ?? "");
      return m ? Math.round(Number(m[1]) * 1000) : 0;
    };
    let rcPercent: number | null = null;
    try {
      const rc = (await this.options.rpc(this.options.endpoint, "rc_api.find_rc_accounts", { accounts: [account] })) as {
        rc_accounts?: Array<{ max_rc?: string; rc_manabar?: { current_mana?: string } }>;
      };
      const r = rc.rc_accounts?.[0];
      const max = BigInt(r?.max_rc ?? "0");
      if (max > 0n) {
        const cur = BigInt(r?.rc_manabar?.current_mana ?? "0");
        rcPercent = Number((cur * 10_000n) / max) / 100;
      }
    } catch {
      rcPercent = null; // honest null — RC unreadable, planner treats as unknown
    }
    return {
      account,
      steemSatoshis: parse(a.balance),
      sbdSatoshis: parse(a.sbd_balance),
      activePubkeys: (a.active?.key_auths ?? []).map(([k]) => k),
      rcPercent,
    };
  }

  /** The custody-vs-chain authority proof (read-only, public keys only). */
  async verifyActiveAuthority(account: string, custodyPub: string): Promise<AuthorityVerdict> {
    let live: AccountState;
    try {
      live = await this.accountState(account);
    } catch (e) {
      return { account, ok: false, reason: `state-unreadable: ${(e as Error).message.slice(0, 120)}`, matchedKeys: 0 };
    }
    const matched = live.activePubkeys.filter((k) => k === custodyPub).length;
    if (matched > 0) return { account, ok: true, matchedKeys: matched };
    return {
      account,
      ok: false,
      reason: "custody active pubkey is NOT in the live active authority (chain drifted off-vault — the measured custody-wound class)",
      matchedKeys: 0,
    };
  }
}
