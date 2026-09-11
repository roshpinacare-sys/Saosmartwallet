/**
 * Saosmartwallet — Steem chain adapter (M0)
 * =========================================
 * Implements the frozen ChainAdapter seam (packages/chains/chain-adapter.ts)
 * for the Steem protocol. Read paths talk JSON-RPC 2.0 (appbase/condenser);
 * write paths sign locally with packages/crypto and serialize with the
 * evidence-validated binary engine.
 *
 * SAFETY: broadcast() is hard-gated — the constructor defaults to
 * allowBroadcast:false and the method fails closed without it. An M0 wallet
 * must be physically unable to move funds by accident.
 */

import {
  type AdapterCapability,
  type AccountSnapshot,
  type ChainAdapter,
  type ChainFlavor,
  type ChainHealthReport,
  type KeyRole,
  type RcManabar,
  type SignedTx,
  type SigningKeys,
  type TokenBalances,
  type UnsignedTx,
  type BroadcastResult,
} from "../../chain-adapter";
import { createHash } from "crypto";
import { PrivateKey, STEEM_ROLES, type SteemRole, base58Decode } from "../../../crypto/src/index";
import { SerializationError, parseAsset } from "./serializer";
import type { AccountUpdateOperation, ClaimRewardBalanceOperation, CommentOperation, CustomJsonOperation, LimitOrderCancelOperation, LimitOrderCreateOperation, SteemAuthority, SteemOperationName, VoteOperation, OpIdTable } from "./operations";
import { OP_IDS, graphenePubToRaw33 } from "./operations";
import {
  STEEM_CHAIN_ID,
  SIGNATURE_SIZE,
  type SteemTransaction,
  appendSignatures,
  serializeTransaction,
  transactionDigest,
} from "./transaction";

// ---------------------------------------------------------------------------
// Account naming (observed chain rules; the chain remains the final arbiter)
// ---------------------------------------------------------------------------

const ACCOUNT_NAME_RE = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/**
 * r19 — WIF canonicalization at the signing boundary (fail-closed).
 * Accepts canonical uncompressed WIFs (5…) and COMPRESSED WIFs (K/L…, 38-byte
 * payload with the 0x01 flag). r17 chain-proved this fleet's ROT1/הדקור
 * material: the signing stack (steem-js + toSigningKey) interprets the whole
 * 33-BYTE BODY (32-byte value ‖ 0x01) as the private scalar mod N — the
 * standard "0x01 = compression flag" reading produces a DIFFERENT key
 * (re-proven live r19: stored==live, standard-derivation≠live). The 4-byte
 * checksum is verified before any scalar is reduced — corrupt vault rows
 * refuse to sign instead of signing garbage.
 */
function privateKeyFromWifCanonical(wif: string): PrivateKey {
  const trimmed = wif.trim();
  let raw: Uint8Array;
  try { raw = base58Decode(trimmed); } catch { throw new SerializationError("invalid WIF base58"); }
  if (raw.length === 38 && raw[0] === 0x80 && raw[33] === 0x01) {
    const body = raw.subarray(0, 34); // 0x80 + 33B scalar-body
    const calc = createHash("sha256").update(createHash("sha256").update(body).digest()).digest().subarray(0, 4);
    for (let i = 0; i < 4; i++) if (calc[i] !== raw[34 + i]) throw new SerializationError("bad WIF checksum");
    // canonical (r17-proven) semantics: the 33-byte body IS the scalar, mod N
    const d = BigInt("0x" + Buffer.from(raw.subarray(1, 34)).toString("hex")) % SECP256K1_N;
    return PrivateKey.fromBytes(Buffer.from(d.toString(16).padStart(64, "0"), "hex"));
  }
  return PrivateKey.fromWif(trimmed); // canonical path — package verifies and fails closed
}

export function validateAccountName(name: string): string {
  if (name.length < 3 || name.length > 16) {
    throw new SerializationError(`account name length must be 3..16: "${name}"`);
  }
  // steemd is_valid_account_name: total length 3..16; each dot-segment must be
  // ≥ 3 chars, start [a-z], middle [a-z0-9-], end [a-z0-9]. There is NO
  // per-segment maximum beyond the 16-char total — verified against mainnet:
  // "steem-venezuela" (15-char single segment) is a live account since 2020-08-08.
  for (const segment of name.split(".")) {
    if (segment.length < 3) throw new SerializationError(`account segment too short: "${segment}"`);
    if (!/^[a-z][a-z0-9-]*$/.test(segment) || !/[a-z0-9]$/.test(segment)) {
      throw new SerializationError(`invalid account name: "${name}"`);
    }
  }
  if (!ACCOUNT_NAME_RE.test(name)) throw new SerializationError(`invalid account name: "${name}"`);
  return name;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export interface SteemAdapterOptions {
  /** JSON-RPC endpoint, e.g. https://api.steemit.com (D1 dev endpoint). */
  rpcUrl: string;
  /**
   * Ordered failover endpoints (roast-2026-09-10 round 3): the WRITE path was
   * a single point of failure — one dead primary node killed every broadcast
   * while the read rails had failover. Each rpc() call tries rpcUrl first,
   * then every rpcUrls entry in order. Chain REJECTS (RPC error bodies) still
   * propagate — failover is for transport failures, never for the chain's
   * own verdict on a transaction.
   */
  rpcUrls?: string[];
  /** 32-byte chain id. Default: Steem mainnet (32 zero bytes). Forks MUST override. */
  chainId?: Uint8Array;
  /** Public key prefix. Default "STM" (mainnet); testnet forks use "TST". */
  addressPrefix?: string;
  /** r20 — fork op-numbering table (blurt custom_json=12). Default: steem OP_IDS. */
  opIds?: OpIdTable;
  /** Explicit broadcast opt-in — never enabled implicitly. */
  allowBroadcast?: boolean;
  requestTimeoutMs?: number;
}

interface RpcAccountRaw {
  name: string;
  created?: string;
  balance?: string;
  sbd_balance?: string;
  vesting_shares?: string;
  savings_balance?: string;
  savings_sbd_balance?: string;
  active?: { key_auths?: Array<[string, number]> };
  posting?: { key_auths?: Array<[string, number]> };
  owner?: { key_auths?: Array<[string, number]> };
  memo_key?: string;
}

export class SteemAdapter implements ChainAdapter {
  readonly chainId: string;
  readonly flavor: ChainFlavor = "steem-family";
  readonly capabilities: ReadonlySet<AdapterCapability> = new Set<AdapterCapability>([
    "query-balances",
    "query-rc",
    "sign-active",
    "sign-posting",
    // "broadcast" is added ONLY when allowBroadcast is passed — fail closed.
  ]);
  private readonly broadcastAllowed: boolean;
  private readonly chainIdBytes: Uint8Array;
  private readonly addressPrefix: string;
  private readonly opIds: OpIdTable;
  private readonly timeoutMs: number;

  constructor(private readonly opts: SteemAdapterOptions) {
    this.chainIdBytes = opts.chainId ?? STEEM_CHAIN_ID;
    if (this.chainIdBytes.length !== 32) throw new SerializationError("chainId must be 32 bytes");
    this.chainId = Buffer.from(this.chainIdBytes).toString("hex");
    this.addressPrefix = opts.addressPrefix ?? "STM";
    this.opIds = opts.opIds ?? OP_IDS;
    this.broadcastAllowed = opts.allowBroadcast === true;
    this.timeoutMs = opts.requestTimeoutMs ?? 10_000;
    if (this.broadcastAllowed) {
      (this.capabilities as Set<AdapterCapability>).add("broadcast");
    }
  }

  // -- transport -----------------------------------------------------------

  /** Endpoints tried in order per call (primary first). Duplicates deduped. */
  private get endpoints(): string[] {
    return [...new Set([this.opts.rpcUrl, ...(this.opts.rpcUrls ?? [])])];
  }

  private async rpc<T>(method: string, params: unknown): Promise<T> {
    let lastErr: unknown = null;
    for (const url of this.endpoints) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!res.ok) throw new Error(`RPC HTTP ${res.status} ${res.statusText}`);
        const body = (await res.json()) as { result?: T; error?: { message?: string } };
        if (body.error) throw new Error(`RPC error: ${body.error.message ?? "unknown"}`);
        return body.result as T;
      } catch (e) {
        lastErr = e;
      }
    }
    throw new Error(
      `all ${this.endpoints.length} endpoints failed for ${method}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    );
  }

  // -- ChainAdapter: read paths ---------------------------------------------

  async health(): Promise<ChainHealthReport> {
    const checkedAt = new Date().toISOString();
    try {
      const dgp = await this.rpc<{ head_block_number: number; time?: string }>(
        "condenser_api.get_dynamic_global_properties",
        [],
      );
      const headMs = dgp.time ? Date.parse(dgp.time.endsWith("Z") ? dgp.time : `${dgp.time}Z`) : NaN;
      return {
        reachable: true,
        chainId: this.chainId,
        headBlock: dgp.head_block_number,
        lagSeconds: Number.isFinite(headMs) ? Math.round((Date.now() - headMs) / 1000) : undefined,
        checkedAt,
      };
    } catch (err) {
      return {
        reachable: false,
        chainId: this.chainId,
        checkedAt,
      };
    }
  }

  async getAccount(name: string): Promise<AccountSnapshot | null> {
    validateAccountName(name);
    const list = await this.rpc<RpcAccountRaw[]>("condenser_api.get_accounts", [[name]]);
    const raw = list?.[0];
    if (!raw) return null;
    return {
      name: raw.name,
      created: raw.created,
      balances: this.mapBalances(raw),
    };
  }

  async getBalances(name: string): Promise<TokenBalances> {
    validateAccountName(name);
    const list = await this.rpc<RpcAccountRaw[]>("condenser_api.get_accounts", [[name]]);
    const raw = list?.[0];
    if (!raw) throw new Error(`account not found: ${name}`);
    return this.mapBalances(raw);
  }

  private mapBalances(raw: RpcAccountRaw): TokenBalances {
    // Raw chain strings are passed through untouched — no float math on chain assets.
    return {
      liquid: raw.balance ?? "0.000 STEEM",
      vestingShares: raw.vesting_shares ?? "0.000000 VESTS",
      debt: raw.sbd_balance ?? "0.000 SBD",
    };
  }

  async getRcManabar(name: string): Promise<RcManabar | null> {
    validateAccountName(name);
    // Wire shape (verified live 2026-09-07): max_rc sits on the ACCOUNT level,
    // current_mana inside rc_manabar. (M0 read max_rc from rc_manabar — a
    // latent bug surfaced by the M1 dashboard: percent always computed 0.)
    const res = await this.rpc<{
      rc_accounts: Array<{ rc_manabar?: { current_mana: string }; max_rc?: string }>;
    }>("rc_api.find_rc_accounts", { accounts: [name] });
    const acc = res.rc_accounts?.[0];
    const mana = acc?.rc_manabar;
    if (!mana) return null;
    const cur = Number(mana.current_mana);
    const max = Number(acc?.max_rc ?? "0");
    return {
      currentMana: mana.current_mana,
      maxRc: acc?.max_rc ?? "0",
      percent: max > 0 && Number.isFinite(cur) ? Math.round((cur / max) * 1000) / 10 : 0,
    };
  }

  // -- ChainAdapter: write paths --------------------------------------------

  /** Ops that move/commit funds or mutate open orders — always require an ACTIVE (or owner) signature. A cancel refunds the caller, but it still mutates order state, so the chain demands active/owner authority and we mirror that. */
  private static readonly FUNDS_OPS: ReadonlySet<string> = new Set(["transfer", "limit_order_create", "limit_order_cancel"]);

  /**
   * Validates and stamps a limit_order_create payload (M1 DEX). Asset strings
   * are parsed fail-closed; only STEEM/SBD are accepted for internal-market
   * orders, and the two sides must be opposite symbols.
   */
  private validateLimitOrderPayload(p: Record<string, unknown>): void {
    if (typeof p.owner !== "string") throw new SerializationError("limit_order_create requires string owner");
    validateAccountName(p.owner);
    if (!Number.isInteger(p.orderid) || (p.orderid as number) < 0 || (p.orderid as number) > 0xffffffff) {
      throw new SerializationError("limit_order_create orderid must be an integer in [0, 4294967295]");
    }
    if (typeof p.amount_to_sell !== "string" || typeof p.min_to_receive !== "string") {
      throw new SerializationError('limit_order_create requires asset strings like "1.000 STEEM"');
    }
    const sell = parseAsset(p.amount_to_sell);
    const receive = parseAsset(p.min_to_receive);
    if (sell.amount <= 0n) throw new SerializationError("amount_to_sell must be positive");
    if (receive.amount < 0n) throw new SerializationError("min_to_receive must be non-negative");
    const bookSymbols = new Set(["STEEM", "SBD"]);
    if (!bookSymbols.has(sell.symbol) || !bookSymbols.has(receive.symbol)) {
      throw new SerializationError(`internal-market orders trade STEEM/SBD only (got ${sell.symbol}/${receive.symbol})`);
    }
    if (sell.symbol === receive.symbol) {
      throw new SerializationError("amount_to_sell and min_to_receive must be opposite symbols");
    }
    if (typeof p.fill_or_kill !== "boolean") {
      throw new SerializationError("limit_order_create fill_or_kill must be boolean");
    }
    if (!Number.isInteger(p.expiration)) {
      throw new SerializationError("limit_order_create expiration must be unix seconds (integer)");
    }
    const exp = p.expiration as number;
    const now = Math.floor(Date.now() / 1000);
    // Client-side sanity guard (the chain remains the final arbiter): an order
    // must outlive the signing window but not linger absurdly.
    if (exp <= now + 60) throw new SerializationError("order expiration must be at least 60s in the future");
    if (exp > now + 7 * 86400) throw new SerializationError("order expiration capped at 7 days (client guard)");
  }

  /**
   * Validates a limit_order_cancel payload (M3 DEX lifecycle). Owner must be a
   * syntactically-valid account; orderid the uint32 from the original create.
   */
  private validateLimitOrderCancelPayload(p: Record<string, unknown>): void {
    if (typeof p.owner !== "string") throw new SerializationError("limit_order_cancel requires string owner");
    validateAccountName(p.owner);
    if (!Number.isInteger(p.orderid) || (p.orderid as number) < 0 || (p.orderid as number) > 0xffffffff) {
      throw new SerializationError("limit_order_cancel orderid must be an integer in [0, 4294967295]");
    }
  }

  /**
   * Validates a claim_reward_balance payload (SOVEREIGN-TREASURY). Symbols and
   * precisions are chain-exact (STEEM/SBD 3dp, VESTS 6dp) and the total must
   * be non-zero — steemd itself refuses "Cannot claim a total of 0".
   * NOT a FUNDS_OP by the chain's own authority model: posting authority is
   * the legal signer (the claim only harvests what the account already earned).
   */
  private validateClaimRewardPayload(p: Record<string, unknown>): void {
    if (typeof p.account !== "string") throw new SerializationError("claim_reward_balance requires string account");
    validateAccountName(p.account);
    if (typeof p.reward_steem !== "string" || typeof p.reward_sbd !== "string" || typeof p.reward_vests !== "string") {
      throw new SerializationError('claim_reward_balance requires asset strings like "0.156 STEEM", "0.000 SBD", "1401.361689 VESTS"');
    }
    const steem = parseAsset(p.reward_steem);
    const sbd = parseAsset(p.reward_sbd);
    const vests = parseAsset(p.reward_vests);
    if (steem.symbol !== "STEEM" || steem.precision !== 3) throw new SerializationError(`reward_steem must be a 3dp STEEM asset (got ${steem.symbol}/${steem.precision}dp)`);
    if (sbd.symbol !== "SBD" || sbd.precision !== 3) throw new SerializationError(`reward_sbd must be a 3dp SBD asset (got ${sbd.symbol}/${sbd.precision}dp)`);
    if (vests.symbol !== "VESTS" || vests.precision !== 6) throw new SerializationError(`reward_vests must be a 6dp VESTS asset (got ${vests.symbol}/${vests.precision}dp)`);
    if (steem.amount < 0n || sbd.amount < 0n || vests.amount < 0n) throw new SerializationError("reward amounts must be non-negative");
    if (steem.amount + sbd.amount + vests.amount <= 0n) throw new SerializationError("cannot claim a total of 0 (chain refuses) — read the live pending rewards first");
  }

  /**
   * account_update validation — the SOVEREIGN-HAND gate for the one op that
   * moves keys. Structural truth only (no authority logic here): the operator
   * plane (src/lib/gate/rotation.ts) owns the WHO-and-WHY; the adapter owns
   * the IS-THIS-A-VALID-OP.
   */
  private validateAccountUpdatePayload(p: Record<string, unknown>): void {
    if (typeof p.account !== "string") throw new SerializationError("account_update requires string account");
    validateAccountName(p.account);
    const auth = (label: string, a: unknown): SteemAuthority | undefined => {
      if (a === undefined || a === null) return undefined;
      const x = a as SteemAuthority;
      if (typeof x.weight_threshold !== "number" || !Number.isInteger(x.weight_threshold) || x.weight_threshold < 0) {
        throw new SerializationError(`account_update ${label}: weight_threshold must be a non-negative integer`);
      }
      if (!Array.isArray(x.account_auths) || !Array.isArray(x.key_auths)) {
        throw new SerializationError(`account_update ${label}: account_auths/key_auths arrays required`);
      }
      for (const pair of x.account_auths) {
        if (!Array.isArray(pair) && typeof pair !== "object") throw new SerializationError(`account_update ${label}: bad account_auths entry`);
        const acct = Array.isArray(pair) ? pair[0] : (pair as { account: string }).account;
        const w = Array.isArray(pair) ? pair[1] : (pair as { weight: number }).weight;
        if (typeof acct !== "string") throw new SerializationError(`account_update ${label}: account_auths needs an account name`);
        validateAccountName(acct);
        if (typeof w !== "number" || !Number.isInteger(w) || w <= 0 || w > 0xffff) throw new SerializationError(`account_update ${label}: weight must be 1..65535`);
      }
      for (const pair of x.key_auths) {
        const pub = Array.isArray(pair) ? pair[0] : (pair as { pub: string }).pub;
        const w = Array.isArray(pair) ? pair[1] : (pair as { weight: number }).weight;
        if (typeof pub !== "string") throw new SerializationError(`account_update ${label}: key_auths needs a public key string`);
        try { graphenePubToRaw33(pub); } catch { throw new SerializationError(`account_update ${label}: malformed public key`); }
        if (typeof w !== "number" || !Number.isInteger(w) || w <= 0 || w > 0xffff) throw new SerializationError(`account_update ${label}: weight must be 1..65535`);
      }
      if (x.account_auths.length + x.key_auths.length === 0) {
        throw new SerializationError(`account_update ${label}: an authority must hold at least one auth (refusing to brick the account)`);
      }
      return {
        weight_threshold: x.weight_threshold,
        account_auths: x.account_auths.map((pair) => Array.isArray(pair)
          ? { account: String(pair[0]), weight: Number(pair[1]) }
          : { account: String((pair as { account: string }).account), weight: Number((pair as { weight: number }).weight) }),
        key_auths: x.key_auths.map((pair) => Array.isArray(pair)
          ? { pub: String(pair[0]), weight: Number(pair[1]) }
          : { pub: String((pair as { pub: string }).pub), weight: Number((pair as { weight: number }).weight) }),
      };
    };
    const owner = auth("owner", p.owner);
    const active = auth("active", p.active);
    const posting = auth("posting", p.posting);
    if (!owner && !active && !posting && p.memo_key === undefined) {
      throw new SerializationError("account_update must change at least one authority or the memo key");
    }
    if (p.memo_key !== undefined && p.memo_key !== null) {
      if (typeof p.memo_key !== "string") throw new SerializationError("account_update: memo_key must be a public key string");
      try { graphenePubToRaw33(p.memo_key); } catch { throw new SerializationError("account_update: malformed memo_key public key"); }
    }
    if (p.json_metadata !== undefined && typeof p.json_metadata !== "string") {
      throw new SerializationError("account_update: json_metadata must be a string");
    }
  }

  /** Permlink rules: lowercase [a-z0-9-], 1..512 — the chain rejects anything else. */
  private static validatePermlink(permlink: unknown, field: string): string {
    if (typeof permlink !== "string" || permlink.length === 0 || permlink.length > 512) {
      throw new SerializationError(`${field} must be a non-empty string ≤ 512 chars`);
    }
    if (!/^[a-z0-9-]+$/.test(permlink)) throw new SerializationError(`${field} must be lowercase [a-z0-9-]`);
    return permlink;
  }

  private validateVotePayload(p: Record<string, unknown>): void {
    if (typeof p.voter !== "string") throw new SerializationError("vote requires string voter");
    validateAccountName(p.voter);
    if (typeof p.author !== "string") throw new SerializationError("vote requires string author");
    validateAccountName(p.author);
    SteemAdapter.validatePermlink(p.permlink, "vote permlink");
    if (!Number.isInteger(p.weight) || (p.weight as number) < -10000 || (p.weight as number) > 10000) {
      throw new SerializationError("vote weight must be an integer in [-10000, 10000]");
    }
  }

  private validateCommentPayload(p: Record<string, unknown>): void {
    // parent_author "" = root post; otherwise a real account.
    if (typeof p.parent_author !== "string") throw new SerializationError("comment requires string parent_author (empty for a root post)");
    if (p.parent_author !== "") validateAccountName(p.parent_author);
    if (typeof p.parent_permlink !== "string" || p.parent_permlink.length === 0 || p.parent_permlink.length > 512) {
      throw new SerializationError("comment requires parent_permlink (1..512 chars)");
    }
    if (typeof p.author !== "string") throw new SerializationError("comment requires string author");
    validateAccountName(p.author);
    SteemAdapter.validatePermlink(p.permlink, "comment permlink");
    if (typeof p.title !== "string" || p.title.length > 256) throw new SerializationError("comment title must be a string ≤ 256 chars");
    if (typeof p.body !== "string" || p.body.length === 0 || p.body.length > 60000) {
      throw new SerializationError("comment body must be a non-empty string ≤ 60000 chars");
    }
    if (typeof p.json_metadata !== "string" || p.json_metadata.length > 2000) {
      throw new SerializationError("comment json_metadata must be a string ≤ 2000 chars");
    }
    if (p.json_metadata.length > 0) {
      try {
        const parsed = JSON.parse(p.json_metadata) as unknown;
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new SerializationError("comment json_metadata must stringify to a JSON object");
        }
      } catch (e) {
        if (e instanceof SerializationError) throw e;
        throw new SerializationError("comment json_metadata is not valid JSON");
      }
    }
  }

  private validateCustomJsonPayload(p: Record<string, unknown>): void {
    if (!Array.isArray(p.required_auths) || (p.required_auths as unknown[]).some((a) => typeof a !== "string")) {
      throw new SerializationError("custom_json requires required_auths as string[] (keep it empty for posting-only)");
    }
    if (!Array.isArray(p.required_posting_auths) || (p.required_posting_auths as unknown[]).some((a) => typeof a !== "string")) {
      throw new SerializationError("custom_json requires required_posting_auths as string[]");
    }
    for (const a of p.required_posting_auths as string[]) validateAccountName(a);
    if (typeof p.id !== "string" || p.id.length === 0 || p.id.length > 32 || !/^[a-z0-9._-]+$/.test(p.id)) {
      throw new SerializationError('custom_json id must match [a-z0-9._-]{1,32} (e.g. "follow")');
    }
    if (typeof p.json !== "string" || p.json.length === 0 || p.json.length > 8192) {
      throw new SerializationError("custom_json json must be a non-empty string ≤ 8192 chars");
    }
    try {
      JSON.parse(p.json);
    } catch {
      throw new SerializationError("custom_json json is not valid JSON");
    }
  }

  /**
   * Builds an unsigned transaction with fresh ref-block fields and expiration.
   * M0: transfer. M1: + limit_order_create (the DEX op). M3+: limit_order_cancel
   * (DEX lifecycle closure). Anything else fails closed.
   */
  async buildOperations(ops: Array<{ type: string; payload: Record<string, unknown> }>): Promise<UnsignedTx> {
    for (const op of ops) {
      if (op.type === "transfer") {
        const p = op.payload as { from?: unknown; to?: unknown; amount?: unknown; memo?: unknown };
        if (typeof p.from !== "string" || typeof p.to !== "string") {
          throw new SerializationError("transfer requires string from/to");
        }
        validateAccountName(p.from);
        validateAccountName(p.to);
        if (typeof p.amount !== "string") throw new SerializationError('transfer amount must be an asset string like "1.000 STEEM"');
        parseAsset(p.amount); // validates symbol/precision/decimals — fail closed
        if (p.memo !== undefined && typeof p.memo !== "string") {
          throw new SerializationError("memo must be a string (encryption arrives with Memo Vault)");
        }
      } else if (op.type === "limit_order_create") {
        this.validateLimitOrderPayload(op.payload);
      } else if (op.type === "limit_order_cancel") {
        this.validateLimitOrderCancelPayload(op.payload);
      } else if (op.type === "vote") {
        this.validateVotePayload(op.payload);
      } else if (op.type === "comment") {
        this.validateCommentPayload(op.payload);
      } else if (op.type === "custom_json") {
        this.validateCustomJsonPayload(op.payload);
      } else if (op.type === "claim_reward_balance") {
        this.validateClaimRewardPayload(op.payload);
      } else if (op.type === "account_update") {
        this.validateAccountUpdatePayload(op.payload);
      } else {
        throw new SerializationError(
          `operation "${op.type}" is not supported (transfer, limit_order_create, limit_order_cancel, vote, comment, custom_json, claim_reward_balance, account_update)`,
        );
      }
    }
    const dgp = await this.rpc<{ head_block_number: number; head_block_id: string }>(
      "condenser_api.get_dynamic_global_properties",
      [],
    );
    // Graphene convention: ref_block_num = head & 0xFFFF; prefix = LE u32 of head_block_id bytes [4:8].
    const refBlockNum = dgp.head_block_number & 0xffff;
    const idBytes = Buffer.from(dgp.head_block_id, "hex");
    if (idBytes.length < 8) throw new SerializationError("head_block_id shorter than 8 bytes");
    const refBlockPrefix = idBytes.readUInt32LE(4);
    const expiration = Math.floor(Date.now() / 1000) + 60; // 60s window; well under the 1h chain max
    return {
      chainId: this.chainId,
      operations: ops.map((o) => ({ type: o.type, payload: o.payload })),
      metadata: { refBlockNum, refBlockPrefix, expiration },
    };
  }

  /**
   * Maps an adapter-level operation payload to its wire-exact body.
   * Asset strings are re-parsed here — the payload crosses the API boundary
   * as strings and must never be trusted.
   */
  private toWireOperation(op: { type: string; payload: Record<string, unknown> }): {
    name: SteemOperationName;
    body: SteemTransaction["operations"][number]["body"];
  } {
    if (op.type === "transfer") {
      const p = op.payload as { from: unknown; to: unknown; amount: unknown; memo?: unknown };
      return {
        name: "transfer",
        body: {
          from: String(p.from),
          to: String(p.to),
          amount: parseAsset(String(p.amount)),
          memo: p.memo as string | undefined,
        },
      };
    }
    if (op.type === "limit_order_create") {
      this.validateLimitOrderPayload(op.payload); // re-validate — payload is untrusted input
      const p = op.payload as {
        owner: string;
        orderid: number;
        amount_to_sell: string;
        min_to_receive: string;
        fill_or_kill: boolean;
        expiration: number;
      };
      const body: LimitOrderCreateOperation = {
        owner: p.owner,
        orderid: p.orderid,
        amount_to_sell: parseAsset(p.amount_to_sell),
        min_to_receive: parseAsset(p.min_to_receive),
        fill_or_kill: p.fill_or_kill,
        expiration: p.expiration,
      };
      return { name: "limit_order_create", body };
    }
    if (op.type === "limit_order_cancel") {
      this.validateLimitOrderCancelPayload(op.payload); // re-validate — payload is untrusted input
      const p = op.payload as { owner: string; orderid: number };
      const body: LimitOrderCancelOperation = { owner: p.owner, orderid: p.orderid };
      return { name: "limit_order_cancel", body };
    }
    if (op.type === "vote") {
      this.validateVotePayload(op.payload); // re-validate — payload is untrusted input
      const p = op.payload as { voter: string; author: string; permlink: string; weight: number };
      const body: VoteOperation = { voter: p.voter, author: p.author, permlink: p.permlink, weight: p.weight };
      return { name: "vote", body };
    }
    if (op.type === "comment") {
      this.validateCommentPayload(op.payload); // re-validate — payload is untrusted input
      const p = op.payload as {
        parent_author: string;
        parent_permlink: string;
        author: string;
        permlink: string;
        title: string;
        body: string;
        json_metadata: string;
      };
      const body: CommentOperation = {
        parent_author: p.parent_author,
        parent_permlink: p.parent_permlink,
        author: p.author,
        permlink: p.permlink,
        title: p.title,
        body: p.body,
        json_metadata: p.json_metadata,
      };
      return { name: "comment", body };
    }
    if (op.type === "custom_json") {
      this.validateCustomJsonPayload(op.payload); // re-validate — payload is untrusted input
      const p = op.payload as { required_auths: string[]; required_posting_auths: string[]; id: string; json: string };
      const body: CustomJsonOperation = {
        required_auths: p.required_auths,
        required_posting_auths: p.required_posting_auths,
        id: p.id,
        json: p.json,
      };
      return { name: "custom_json", body };
    }
    if (op.type === "claim_reward_balance") {
      this.validateClaimRewardPayload(op.payload); // re-validate — payload is untrusted input
      const p = op.payload as { account: string; reward_steem: string; reward_sbd: string; reward_vests: string };
      const body: ClaimRewardBalanceOperation = {
        account: p.account,
        reward_steem: parseAsset(p.reward_steem),
        reward_sbd: parseAsset(p.reward_sbd),
        reward_vests: parseAsset(p.reward_vests),
      };
      return { name: "claim_reward_balance", body };
    }
    if (op.type === "account_update") {
      this.validateAccountUpdatePayload(op.payload); // re-validate — payload is untrusted input
      const p = op.payload as {
        account: string;
        owner?: SteemAuthority;
        active?: SteemAuthority;
        posting?: SteemAuthority;
        memo_key?: string;
        json_metadata?: string;
      };
      const auth = (label: string, a: unknown): SteemAuthority | undefined => {
        if (a === undefined || a === null) return undefined;
        const x = a as SteemAuthority;
        return {
          weight_threshold: Number(x.weight_threshold),
          account_auths: x.account_auths.map((pair) => Array.isArray(pair)
            ? { account: String(pair[0]), weight: Number(pair[1]) }
            : { account: String((pair as { account: string }).account), weight: Number((pair as { weight: number }).weight) }),
          key_auths: x.key_auths.map((pair) => Array.isArray(pair)
            ? { pub: String(pair[0]), weight: Number(pair[1]) }
            : { pub: String((pair as { pub: string }).pub), weight: Number((pair as { weight: number }).weight) }),
        };
      };
      const body: AccountUpdateOperation = {
        account: p.account,
        owner: auth("owner", p.owner),
        active: auth("active", p.active),
        posting: auth("posting", p.posting),
        memo_key: p.memo_key ?? undefined,
        json_metadata: p.json_metadata ?? "",
      };
      return { name: "account_update", body };
    }
    throw new SerializationError(`operation "${op.type}" cannot be signed (unsupported)`);
  }

  /**
   * Signs the transaction digest locally. Key material never leaves this call.
   * Role policy (fail closed): funds-moving ops (transfer, limit_order_create)
   * require an ACTIVE role signature; posting keys are accepted only for
   * posting-family ops (none in M0/M1).
   */
  async sign(tx: UnsignedTx, keys: SigningKeys, roles: KeyRole[]): Promise<SignedTx> {
    if (!Array.isArray(roles) || roles.length === 0) throw new SerializationError("at least one signing role required");
    for (const role of roles) {
      if (!STEEM_ROLES.includes(role as SteemRole)) throw new SerializationError(`unknown role: ${role}`);
    }
    const touchesFunds = tx.operations.some((o) => SteemAdapter.FUNDS_OPS.has(o.type));
    if (roles.includes("posting") && !roles.includes("active") && touchesFunds) {
      // Explicit policy: a posting key must never authorize a funds-moving op.
      throw new SerializationError("policy violation: funds operations cannot be signed with a posting key");
    }
    const { refBlockNum, refBlockPrefix, expiration } = (tx.metadata ?? {}) as {
      refBlockNum?: number;
      refBlockPrefix?: number;
      expiration?: number;
    };
    if (typeof refBlockNum !== "number" || typeof refBlockPrefix !== "number" || typeof expiration !== "number") {
      throw new SerializationError("UnsignedTx.metadata must carry refBlockNum/refBlockPrefix/expiration (use buildOperations)");
    }
    const steemTx: SteemTransaction = {
      refBlockNum,
      refBlockPrefix,
      expiration,
      operations: tx.operations.map((o) => this.toWireOperation(o)),
    };

    const digest = transactionDigest(steemTx, this.chainIdBytes, this.opIds);
    const signatures: string[] = [];
    for (const role of roles) {
      const key = keys.byRole[role];
      if (key === undefined) throw new SerializationError(`no key provided for role "${role}"`);
      // r19: the vault's ROT1 / הדקור material is COMPRESSED WIF (K/L…, 38-byte
      // payload) — the package's fromWif only accepts canonical 37-byte WIFs.
      // Canonicalize here (checksum-verified, scalar mod N): the compression
      // flag describes the pubkey ENCODING, not the scalar, so the signature
      // is identical and still recovers to the compressed chain pubkey.
      const priv = key instanceof PrivateKey ? key : privateKeyFromWifCanonical(String(key));
      // Digest only — signatures cover sha256(chainId ‖ tx) and nothing else.
      const sig = priv.signRecoverable(digest);
      if (sig.length !== SIGNATURE_SIZE) throw new SerializationError("internal: bad signature length");
      signatures.push(Buffer.from(sig).toString("hex"));
    }
    return {
      ...tx,
      signatures,
      rolesUsed: [...roles],
      metadata: { ...tx.metadata, digestHex: Buffer.from(digest).toString("hex"), serializedHex: Buffer.from(serializeTransaction(steemTx, this.opIds)).toString("hex") },
    };
  }

  async broadcast(tx: SignedTx): Promise<BroadcastResult> {
    if (!this.broadcastAllowed) {
      // Fail closed — M0 wallets never move funds; flip via constructor only.
      throw new SerializationError(
        "broadcast disabled: construct SteemAdapter with allowBroadcast:true to enable (M0 gate)",
      );
    }
    const digestHex = (tx.metadata as { digestHex?: string } | undefined)?.digestHex;
    const serializedHex = (tx.metadata as { serializedHex?: string } | undefined)?.serializedHex;
    if (typeof serializedHex !== "string") {
      throw new SerializationError("broadcast requires sign() metadata (serializedHex)");
    }
    void digestHex;
    const signedWire = appendSignatures(new Uint8Array(Buffer.from(serializedHex, "hex")), tx.signatures);
    // Graphene's JSON deserializer parses time_point_sec with boost's
    // COMPACT ISO parser ("20260909T225349") — dashed ISO and epoch integers
    // die in from_iso_string with a boost "Day of month" error. Verified live
    // 2026-09-09 against api.steemit.com + api.justyy.com: compact ISO parses
    // through to authority checks; every other format fails pre-signature.
    // (The BINARY path is unaffected — serializedHex/digestHex above stay
    // integer-exact; only this JSON echo of the fields needs the other form.)
    const toCompactIso = (t: number) =>
      new Date(t * 1000).toISOString().replace(/[-:]/g, "").slice(0, 15);
    const txJson = {
      ref_block_num: (tx.metadata as { refBlockNum: number }).refBlockNum,
      ref_block_prefix: (tx.metadata as { refBlockPrefix: number }).refBlockPrefix,
      expiration: toCompactIso((tx.metadata as { expiration: number }).expiration),
      operations: tx.operations.map((o) => {
        const payload = o.payload as Record<string, unknown>;
        const body =
          payload && typeof payload.expiration === "number"
            ? { ...payload, expiration: toCompactIso(payload.expiration) }
            : payload;
        return [o.type, body] as const;
      }),
      extensions: [],
      signatures: tx.signatures,
    };
    const res = await this.rpc<{ id?: string }>("condenser_api.broadcast_transaction", [txJson]);
    return { txId: res?.id ?? "", raw: { wireBytes: signedWire.length } };
  }
}
