/**
 * Saosmartwallet — Steem operations registry
 * ==========================================
 * Wire-exact operation packing. M0 implements `transfer` end-to-end (the op a
 * wallet must never get wrong); M1 adds `limit_order_create` for the internal
 * DEX (STEEM/SBD market); the registry documents standard op ids so the
 * deserializer can fail loudly on everything else instead of corrupting bytes.
 *
 * Evidence (live-chain canonical hex via condenser_api.get_transaction_hex,
 * the node's own serializer — the same oracle methodology as M0, 2026-09-07):
 *
 *   transfer          { from, to, amount, memo }            — M0, bit-verified
 *                       against 10/10 real transactions (see serialize-test.ts).
 *   limit_order_create { owner, orderid, amount_to_sell,     — M1, oracle-verified
 *                       min_to_receive, fill_or_kill, expiration }
 *                       Oracle vector 1: orderid 77 / "10.000 SBD"→"101.000 STEEM"
 *                       / fok=false produced
 *                       …05 08"testacct" 4d000000 <asset SBD> <asset STEEM> 00 <u32 exp>.
 *                       Oracle vector 2: orderid 0xffffffff / fok=true / 0-amounts
 *                       confirmed bool 0x01 and u32 LE expiration encoding.
 *                       Field order: owner(varint-string), orderid(u32 LE),
 *                       amount_to_sell(asset 16B), min_to_receive(asset 16B),
 *                       fill_or_kill(u8 bool), expiration(u32 LE unix).
 *
 * Asset layout (16 bytes) and the tx envelope were validated in M0 — see
 * serializer.ts evidence notes.
 */

import { ByteReader, ByteWriter, SerializationError, type Asset, packAsset, unpackAsset } from "./serializer";
import bs58 from "bs58";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";

/**
 * Standard Steem operation ids — LEGACY GRAPHENE WIRE TAGS, oracle-proven.
 *
 * ⚠ LIVE-PROVEN against the node's own serializer (condenser_api.get_transaction_hex,
 * api.steemit.com, 2026-09-10): the tag numbering has a legacy quirk — there is
 * NO gap before transfer_to_savings (the deleted "pow" at 14 consumes its slot,
 * and the post-31 ops run CONTIGUOUSLY from 32). An earlier draft of this table
 * shifted 32..50 by +1 and was caught by the byte-oracle on the very first
 * claim_reward_balance vector (node 0x27, table 0x28). Oracle vectors:
 *   transfer_to_savings      → 32   (node byte 11, 53B tx)
 *   claim_reward_balance     → 39   (node byte 11, 73B tx)
 *   delegate_vesting_shares  → 40   (node byte 11, 45B tx)
 *   account_update2          → 43   (node byte 11, 57B tx)
 * (vote=0/comment=1/transfer=2/limit_order_create=5/limit_order_cancel=6/
 *  custom_json=18 were already bit-proven live in M0/M1/M3.)
 */
export const OP_IDS = {
  vote: 0,
  comment: 1,
  transfer: 2,
  transfer_to_vesting: 3,
  withdraw_vesting: 4,
  limit_order_create: 5,
  limit_order_cancel: 6,
  feed_publish: 7,
  convert: 8,
  account_create: 9,
  account_update: 10,
  witness_update: 11,
  account_witness_vote: 12,
  account_witness_proxy: 13,
  pow: 14,
  custom: 15,
  report_over_production: 16,
  delete_comment: 17,
  custom_json: 18,
  comment_options: 19,
  set_withdraw_vesting_route: 20,
  limit_order_create2: 21,
  claim_account: 22,
  create_claimed_account: 23,
  request_account_recovery: 24,
  recover_account: 25,
  change_recovery_account: 26,
  escrow_transfer: 27,
  escrow_dispute: 28,
  escrow_release: 29,
  pow2: 30,
  escrow_approve: 31,
  transfer_to_savings: 32,
  transfer_from_savings: 33,
  cancel_transfer_from_savings: 34,
  custom_binary: 35,
  decline_voting_rights: 36,
  reset_account: 37,
  set_reset_account: 38,
  claim_reward_balance: 39,
  delegate_vesting_shares: 40,
  account_create_with_delegation: 41,
  witness_set_properties: 42,
  account_update2: 43,
  create_proposal: 44,
  update_proposal_votes: 45,
  remove_proposal: 46,
  update_proposal: 47,
  collateralized_convert: 48,
  recurrent_transfer: 49,
} as const;

export type OperationId = (typeof OP_IDS)[keyof typeof OP_IDS];

export interface TransferOperation {
  from: string;
  to: string;
  amount: Asset;
  /** Plain string for M0. Encrypted memos ("#…") are a Memo Vault (M2) concern. */
  memo?: string;
}

/**
 * Internal-market limit order (M1 DEX). Sell `amount_to_sell`, receive at
 * least `min_to_receive`. Buying STEEM with SBD ⇒ amount_to_sell=SBD,
 * min_to_receive=STEEM (and vice versa). `expiration` is the ORDER lifetime
 * on the book (unix seconds), NOT the transaction expiration.
 */
export interface LimitOrderCreateOperation {
  owner: string;
  /** Caller-chosen order identifier (uint32); used later for cancel. */
  orderid: number;
  amount_to_sell: Asset;
  min_to_receive: Asset;
  fill_or_kill: boolean;
  /** Unix epoch seconds (uint32) — when the order dies if unfilled. */
  expiration: number;
}

/**
 * Claim pending rewards (SOVEREIGN-TREASURY). Pending author/curation rewards
 * accrue into reward_steem/reward_sbd/reward_vests and stay INVISIBLE to
 * spendable balances until a claim_reward_balance op moves them into
 * balance/sbd_balance/vesting_shares. Posting-authority op by the chain's own
 * design (steemd: get_required_posting_authorities) — the agents can harvest
 * what they earned without ever touching funds-moving authority.
 */
export interface ClaimRewardBalanceOperation {
  account: string;
  reward_steem: Asset; // "0.000 STEEM" (3dp)
  reward_sbd: Asset; // "0.000 SBD" (3dp)
  reward_vests: Asset; // "0.000000 VESTS" (6dp)
}

export type SteemOperationBody =
  | TransferOperation
  | LimitOrderCreateOperation
  | LimitOrderCancelOperation
  | VoteOperation
  | CommentOperation
  | CustomJsonOperation
  | ClaimRewardBalanceOperation
  | AccountUpdateOperation;
export type SteemOperationName =
  | "transfer"
  | "limit_order_create"
  | "limit_order_cancel"
  | "vote"
  | "comment"
  | "custom_json"
  | "claim_reward_balance"
  | "account_update";

/**
 * Graphene authority (steemd `authority` struct) — the SOVEREIGN-HAND rotation
 * plane's currency. Wire layout (fc::raw):
 *   weight_threshold : u32 LE
 *   account_auths    : varint count + [varint-string account + u16 weight]*
 *   key_auths        : varint count + [33-byte compressed pubkey + u16 weight]*
 * (public_key_type serializes as the RAW 33-byte compressed key — the 4-byte
 *  checksum exists only in the "STM…" string representation.)
 */
export interface SteemAuthority {
  weight_threshold: number;
  account_auths: Array<{ account: string; weight: number }>;
  key_auths: Array<{ pub: string; weight: number }>; // "STM…" string form
}

/**
 * account_update (op id 10) — the ONLY op that can move an account's keys.
 * SOVEREIGN-HAND contract: building this op is mechanical; the vault signs
 * and broadcasts ONLY on an explicit operator decision (never agent hands).
 * Wire layout (fc::raw, legacy optional = 1 flag byte then the value):
 *   account      : varint-string
 *   owner        : optional<authority>
 *   active       : optional<authority>
 *   posting      : optional<authority>
 *   memo_key     : public_key_type — ALWAYS 33 raw bytes, NO flag byte
 *                  (node-oracle-proven 2026-09-10: present → the raw key;
 *                   absent → 33 zero bytes; null → server-side assert error.
 *                   ⚠ broadcasting zeros would NULL the account's memo key —
 *                   the rotation plane must always set a real memo key.)
 *   json_metadata: varint-string
 * Oracle: bit-exact against the node's own serializer
 * (condenser_api.get_transaction_hex) — tools/r16-oracle-account-update.ts.
 */
export interface AccountUpdateOperation {
  account: string;
  owner?: SteemAuthority;
  active?: SteemAuthority;
  posting?: SteemAuthority;
  memo_key?: string; // "STM…" string form; omit → flag 0 (unchanged)
  json_metadata: string;
}

/** raw 33-byte compressed graphene key → canonical "STM…" string (bs58check with the 4-byte ripemd160(sha256(…)) trailer). */
export function grapheneRaw33ToString(raw33: Uint8Array): string {
  const chk = ripemd160(sha256(raw33)).slice(0, 4);
  return "STM" + bs58.encode(Buffer.concat([Buffer.from(raw33), Buffer.from(chk)]));
}

/** "STM…"/"HIVE…"/"BLT…" graphene pub string → raw 33-byte compressed key. */
export function graphenePubToRaw33(pub: string): Uint8Array {
  const m = /^(?:STM|HIVE|BLT|TST)([1-9A-HJ-NP-Za-km-z]+)$/.exec(pub);
  if (!m) throw new SerializationError(`not a graphene public key: ${pub.slice(0, 12)}…`);
  const raw = bs58.decode(m[1]);
  if (raw.length !== 37) throw new SerializationError(`graphene pub payload must be 37 bytes, got ${raw.length}`);
  return raw.slice(0, 33);
}

function packAuthority(w: ByteWriter, a: SteemAuthority): void {
  w.u32(a.weight_threshold);
  w.varint(a.account_auths.length);
  for (const p of a.account_auths) {
    w.string(p.account);
    w.u16(p.weight);
  }
  w.varint(a.key_auths.length);
  for (const k of a.key_auths) {
    w.bytes(graphenePubToRaw33(k.pub));
    w.u16(k.weight);
  }
}

function packOptionalAuthority(w: ByteWriter, a?: SteemAuthority): void {
  if (!a) {
    w.u8(0);
    return;
  }
  w.u8(1);
  packAuthority(w, a);
}

/**
 * Internal-market order cancel (M3+ DEX lifecycle closure). Cancels the
 * open order `orderid` of `owner`; the unfilled remainder returns to the
 * owner's balances. Wire format oracle-verified LIVE against the node's own
 * serializer (condenser_api.get_transaction_hex accepts an unsigned-shaped
 * tx with empty signatures, 2026-09-08):
 *
 *   tx {ref 1/2, exp 2026-09-08T20:00:00, ops:[["limit_order_cancel",
 *      {owner:"headcorner", orderid:77}]], sigs:[]}
 *   → 0100020000004069a06a 01 06 0a 68656164636f726e6572 4d000000 00 00
 *     (envelope + op-count 1 + op-id 6 + varint-string owner + u32 LE orderid
 *      + empty signatures + empty extensions)
 *
 * Field order: owner(varint-string), orderid(u32 LE). Nothing else.
 */
export interface LimitOrderCancelOperation {
  owner: string;
  /** The caller-chosen order id from the original limit_order_create. */
  orderid: number;
}

/**
 * Content vote (SOVEREIGN-VOICE). `weight` is a SIGNED int16 in [-10000,
 * 10000] (10000 = 100% upvote, -10000 = 100% flag); wire: two's-complement
 * u16 LE. zero-weight = clear-vote (removes an existing vote).
 */
export interface VoteOperation {
  voter: string;
  author: string;
  permlink: string;
  weight: number; // int16, -10000..10000
}

/**
 * Content publication (article/comment). A root post has parent_author ""
 * and parent_permlink = the post's category (first tag). The permlink must
 * be lowercase [a-z0-9-] (the chain lowercases and rejects otherwise).
 */
export interface CommentOperation {
  parent_author: string; // "" for a root post
  parent_permlink: string; // category for a root post, permlink for a reply
  author: string;
  permlink: string;
  title: string;
  body: string;
  json_metadata: string; // stringified JSON ({tags:[…], app:…})
}

/**
 * Generic JSON operation on the posting authority (follow / reblog /
 * witness-vote …). `id` is the plugin identifier ("follow", "reblog"),
 * `json` the stringified payload. Wire: two vector<string> + two strings.
 */
export interface CustomJsonOperation {
  required_auths: string[]; // active-authority signers (we always keep this empty)
  required_posting_auths: string[]; // posting-authority signers (the agent's hands)
  id: string; // ≤ 32 chars, [a-z0-9._-]
  json: string; // stringified JSON, ≤ 8192 bytes on the chain
}

export function packOperation(w: ByteWriter, name: SteemOperationName, body: SteemOperationBody): void {
  switch (name) {
    case "transfer": {
      const t = body as TransferOperation;
      w.varint(OP_IDS.transfer);
      w.string(t.from);
      w.string(t.to);
      packAsset(w, t.amount);
      w.string(t.memo ?? "");
      return;
    }
    case "limit_order_create": {
      const o = body as LimitOrderCreateOperation;
      w.varint(OP_IDS.limit_order_create);
      w.string(o.owner);
      w.u32(o.orderid); // uint32 LE — oracle-confirmed, 0xffffffff preserved
      packAsset(w, o.amount_to_sell);
      packAsset(w, o.min_to_receive);
      w.u8(o.fill_or_kill ? 1 : 0); // fc::raw bool — 0x00/0x01 only
      w.u32(o.expiration); // time_point_sec, u32 LE unix
      return;
    }
    case "limit_order_cancel": {
      const c = body as LimitOrderCancelOperation;
      w.varint(OP_IDS.limit_order_cancel);
      w.string(c.owner);
      w.u32(c.orderid); // uint32 LE — oracle-verified 2026-09-08 (see type doc)
      return;
    }
    case "vote": {
      const v = body as VoteOperation;
      w.varint(OP_IDS.vote);
      w.string(v.voter);
      w.string(v.author);
      w.string(v.permlink);
      // int16 LE in two's complement — fc::raw packs int16 as u16 bits.
      w.u16(v.weight < 0 ? v.weight + 0x10000 : v.weight);
      return;
    }
    case "comment": {
      const c = body as CommentOperation;
      w.varint(OP_IDS.comment);
      w.string(c.parent_author);
      w.string(c.parent_permlink);
      w.string(c.author);
      w.string(c.permlink);
      w.string(c.title);
      w.string(c.body);
      w.string(c.json_metadata);
      return;
    }
    case "custom_json": {
      const j = body as CustomJsonOperation;
      w.varint(OP_IDS.custom_json);
      w.varint(j.required_auths.length);
      for (const a of j.required_auths) w.string(a);
      w.varint(j.required_posting_auths.length);
      for (const a of j.required_posting_auths) w.string(a);
      w.string(j.id);
      w.string(j.json);
      return;
    }
    case "claim_reward_balance": {
      const c = body as ClaimRewardBalanceOperation;
      // steemd field order: account, reward_steem, reward_sbd, reward_vests
      w.varint(OP_IDS.claim_reward_balance);
      w.string(c.account);
      packAsset(w, c.reward_steem);
      packAsset(w, c.reward_sbd);
      packAsset(w, c.reward_vests);
      return;
    }
    case "account_update": {
      const a = body as AccountUpdateOperation;
      w.varint(OP_IDS.account_update);
      w.string(a.account);
      packOptionalAuthority(w, a.owner);
      packOptionalAuthority(w, a.active);
      packOptionalAuthority(w, a.posting);
      if (a.memo_key) {
        // node-oracle quirk: memo_key has NO optional flag — always 33 raw bytes
        w.bytes(graphenePubToRaw33(a.memo_key));
      } else {
        w.bytes(new Uint8Array(33)); // null key — ⚠ rotation always sets a real memo
      }
      w.string(a.json_metadata ?? "");
      return;
    }
    default: {
      // Exhaustiveness guard — TypeScript rejects unhandled names at compile time.
      const _never: never = name;
      throw new Error(`unreachable operation: ${String(_never)}`);
    }
  }
}

export interface UnpackedOperation {
  id: number;
  name?: SteemOperationName;
  body?: SteemOperationBody;
}

/** Unpacks one operation; unknown ids are returned structurally, never guessed. */
export function unpackOperation(r: ByteReader): UnpackedOperation {
  const id = r.varint();
  if (id === OP_IDS.transfer) {
    const from = r.string();
    const to = r.string();
    const amount = unpackAsset(r);
    const memo = r.string();
    return { id, name: "transfer", body: { from, to, amount, memo } };
  }
  if (id === OP_IDS.limit_order_create) {
    const owner = r.string();
    const orderid = r.u32();
    const amount_to_sell = unpackAsset(r);
    const min_to_receive = unpackAsset(r);
    const fokByte = r.u8();
    if (fokByte > 1) {
      throw new Error(`limit_order_create: fill_or_kill byte must be 0|1, got 0x${fokByte.toString(16)}`);
    }
    const fill_or_kill = fokByte === 1;
    const expiration = r.u32();
    return { id, name: "limit_order_create", body: { owner, orderid, amount_to_sell, min_to_receive, fill_or_kill, expiration } };
  }
  if (id === OP_IDS.limit_order_cancel) {
    const owner = r.string();
    const orderid = r.u32();
    return { id, name: "limit_order_cancel", body: { owner, orderid } };
  }
  if (id === OP_IDS.vote) {
    const voter = r.string();
    const author = r.string();
    const permlink = r.string();
    const raw = r.u16();
    const weight = raw >= 0x8000 ? raw - 0x10000 : raw; // two's complement back to int16
    return { id, name: "vote", body: { voter, author, permlink, weight } };
  }
  if (id === OP_IDS.comment) {
    const parent_author = r.string();
    const parent_permlink = r.string();
    const author = r.string();
    const permlink = r.string();
    const title = r.string();
    const body = r.string();
    const json_metadata = r.string();
    return { id, name: "comment", body: { parent_author, parent_permlink, author, permlink, title, body, json_metadata } };
  }
  if (id === OP_IDS.custom_json) {
    const nAuths = r.varint();
    const required_auths: string[] = [];
    for (let k = 0; k < nAuths; k++) required_auths.push(r.string());
    const nPosting = r.varint();
    const required_posting_auths: string[] = [];
    for (let k = 0; k < nPosting; k++) required_posting_auths.push(r.string());
    const jsonId = r.string();
    const json = r.string();
    return { id, name: "custom_json", body: { required_auths, required_posting_auths, id: jsonId, json } };
  }
  if (id === OP_IDS.claim_reward_balance) {
    const account = r.string();
    const reward_steem = unpackAsset(r);
    const reward_sbd = unpackAsset(r);
    const reward_vests = unpackAsset(r);
    return { id, name: "claim_reward_balance", body: { account, reward_steem, reward_sbd, reward_vests } };
  }
  if (id === OP_IDS.account_update) {
    const account = r.string();
    const readAuth = (): SteemAuthority => ({
      weight_threshold: r.u32(),
      account_auths: Array.from({ length: r.varint() }, () => ({ account: r.string(), weight: r.u16() })),
      key_auths: Array.from({ length: r.varint() }, () => ({
        pub: grapheneRaw33ToString(r.bytes(33)),
        weight: r.u16(),
      })),
    });
    const readOpt = (): SteemAuthority | undefined => (r.u8() === 1 ? readAuth() : undefined);
    const owner = readOpt();
    const active = readOpt();
    const posting = readOpt();
    const memoRaw = r.bytes(33);
    const memoKey = memoRaw.some((b) => b !== 0) ? grapheneRaw33ToString(memoRaw) : undefined;
    const json_metadata = r.string();
    return {
      id,
      name: "account_update",
      body: {
        account,
        owner,
        active,
        posting,
        memo_key: memoKey,
        json_metadata,
      },
    };
  }
  throw new Error(
    `unsupported operation id ${id} — deserializer implements "transfer" (2), "limit_order_create" (5), "limit_order_cancel" (6), "vote" (0), "comment" (1), "custom_json" (18), "claim_reward_balance" (40) and "account_update" (10); ` +
      `extend packOperation/unpackOperation before parsing other op types`,
  );
}
