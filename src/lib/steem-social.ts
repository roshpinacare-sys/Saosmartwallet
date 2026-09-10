/**
 * SOVEREIGN-VOICE builders — Steem content/social transactions, key-free.
 *
 * The agent's VOICE on the real network: posts (comment op), votes, follows
 * and reblogs — all built with the wire-exact packer and NO keys. Signing
 * happens only in the gate harness with the vault POSTING key (the authority
 * that by design can NEVER move funds — Steem's own sovereignty boundary).
 *
 * Wire evidence (oracle, 2026-09-09): vote+comment+custom_json packed here
 * through SteemAdapter.buildOperations produced bytes IDENTICAL to the
 * node's own serializer (condenser_api.get_transaction_hex) — envelope,
 * operation ids (0/1/18), int16 vote weight two's-complement, vector<string>
 * auths — digest bit-exact as well.
 */
import {
  serializeTransaction,
  transactionDigest,
  transactionId,
  STEEM_CHAIN_ID,
  type SteemTransaction,
} from "../../packages/chains/steem/src/transaction";
import type { CommentOperation, CustomJsonOperation, VoteOperation } from "../../packages/chains/steem/src/operations";
import { SerializationError } from "../../packages/chains/steem/src/serializer";
import type { UnsignedTx } from "../../packages/chains/chain-adapter";
import { steemAdapter } from "./steem-server";

const PERMLINK_RE = /^[a-z0-9-]+$/;

export interface SocialBuild {
  unsigned: UnsignedTx;
  serializedHex: string;
  digestHex: string;
  txId: string;
  byteLength: number;
}

function assertPermlink(permlink: string, field: string): string {
  if (typeof permlink !== "string" || permlink.length === 0 || permlink.length > 512 || !PERMLINK_RE.test(permlink)) {
    throw new SerializationError(`${field} must match [a-z0-9-]{1,512} (got: ${String(permlink).slice(0, 40)})`);
  }
  return permlink;
}

/** Steem-style permlink from a title: lowercase [a-z0-9-], ≤ 128, never empty. */
export function permlinkFromTitle(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  const suffix = Date.now().toString(36); // uniqueness on the chain (permlinks are unique per author)
  const permlink = base ? `${base}-${suffix}` : `post-${suffix}`;
  return assertPermlink(permlink.slice(0, 128), "derived permlink");
}

function finalize(adapter: ReturnType<typeof steemAdapter>, unsigned: UnsignedTx, ops: SteemTransaction["operations"]): SocialBuild {
  void adapter;
  const steemTx: SteemTransaction = { refBlockNum: 0, refBlockPrefix: 0, expiration: 0, operations: ops };
  // Rebuild the real envelope fields from the adapter's metadata (fresh ref-block each call).
  const meta = unsigned.metadata as { refBlockNum: number; refBlockPrefix: number; expiration: number };
  steemTx.refBlockNum = meta.refBlockNum;
  steemTx.refBlockPrefix = meta.refBlockPrefix;
  steemTx.expiration = meta.expiration;
  const serializedHex = Buffer.from(serializeTransaction(steemTx)).toString("hex");
  const digestHex = Buffer.from(transactionDigest(steemTx, STEEM_CHAIN_ID)).toString("hex");
  return { unsigned, serializedHex, digestHex, txId: transactionId(steemTx), byteLength: serializedHex.length / 2 };
}

export interface SteemPostSpec {
  author: string;
  title: string;
  body: string;
  tags: string[]; // 1..5; tags[0] is the category (root parent_permlink)
  permlink?: string; // derived from title when omitted
  replyTo?: { author: string; permlink: string }; // comment instead of a root post
}

/** Root post or reply (comment op) — built key-free, fresh ref-block, real txId. */
export async function buildSteemPostTx(spec: SteemPostSpec): Promise<SocialBuild & { permlink: string; category: string }> {
  const author = spec.author.trim().toLowerCase();
  if (!/^[a-z0-9.\-]{3,16}$/.test(author)) throw new SerializationError("author is not a valid account name");
  const title = String(spec.title || "").trim();
  if (!title || title.length > 256) throw new SerializationError("title required (1..256 chars)");
  const body = String(spec.body || "");
  if (body.trim().length === 0 || body.length > 20000) throw new SerializationError("body required (1..20000 chars)");
  const tags = (spec.tags || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 5);
  if (tags.length === 0) throw new SerializationError("at least one tag required");
  for (const t of tags) {
    if (!/^[a-z0-9-]{1,24}$/.test(t)) throw new SerializationError(`tag "${t.slice(0, 24)}" must match [a-z0-9-]{1,24}`);
  }

  let parentAuthor: string;
  let parentPermlink: string;
  let permlink: string;
  if (spec.replyTo) {
    const pa = spec.replyTo.author.trim().toLowerCase();
    if (!/^[a-z0-9.\-]{3,16}$/.test(pa)) throw new SerializationError("replyTo.author is not a valid account name");
    parentAuthor = pa;
    parentPermlink = assertPermlink(spec.replyTo.permlink, "replyTo.permlink");
    permlink = assertPermlink(`re-${pa.replace(/[^a-z0-9-]/g, "")}-${Date.now().toString(36)}`.slice(0, 128), "reply permlink");
  } else {
    parentAuthor = "";
    parentPermlink = assertPermlink(tags[0].replace(/[^a-z0-9-]/g, "") || "saos", "category");
    permlink = assertPermlink(spec.permlink || permlinkFromTitle(title), "permlink");
  }

  const jsonMetadata = JSON.stringify({ tags, app: "saos-gate/v1", format: "markdown" });
  const payload: CommentOperation = {
    parent_author: parentAuthor,
    parent_permlink: parentPermlink,
    author,
    permlink,
    title,
    body,
    json_metadata: jsonMetadata,
  };
  const adapter = steemAdapter();
  const unsigned = await adapter.buildOperations([{ type: "comment", payload: payload as unknown as Record<string, unknown> }]);
  const ops: SteemTransaction["operations"] = [{ name: "comment", body: payload }];
  return { ...finalize(adapter, unsigned, ops), permlink, category: parentPermlink };
}

export interface SteemVoteSpec {
  voter: string;
  author: string;
  permlink: string;
  weight: number; // -10000..10000 (int16)
}

/** Vote/flag/clear-vote — the bounded interaction primitive. */
export async function buildSteemVoteTx(spec: SteemVoteSpec): Promise<SocialBuild> {
  const voter = spec.voter.trim().toLowerCase();
  const author = spec.author.trim().toLowerCase();
  if (!/^[a-z0-9.\-]{3,16}$/.test(voter)) throw new SerializationError("voter is not a valid account name");
  if (!/^[a-z0-9.\-]{3,16}$/.test(author)) throw new SerializationError("author is not a valid account name");
  const permlink = assertPermlink(spec.permlink, "permlink");
  const weight = Number(spec.weight);
  if (!Number.isInteger(weight) || weight < -10000 || weight > 10000) {
    throw new SerializationError("weight must be an integer in [-10000, 10000]");
  }
  const payload: VoteOperation = { voter, author, permlink, weight };
  const adapter = steemAdapter();
  const unsigned = await adapter.buildOperations([{ type: "vote", payload: payload as unknown as Record<string, unknown> }]);
  const ops: SteemTransaction["operations"] = [{ name: "vote", body: payload }];
  return finalize(adapter, unsigned, ops);
}

export interface SteemCustomJsonSpec {
  account: string; // the posting authority signer
  id: string; // "follow" | "reblog" | …
  json: unknown; // object/array — stringified exactly once here
}

/** Generic custom_json on the posting authority (follow / reblog / …). */
export async function buildSteemCustomJsonTx(spec: SteemCustomJsonSpec): Promise<SocialBuild> {
  const account = spec.account.trim().toLowerCase();
  if (!/^[a-z0-9.\-]{3,16}$/.test(account)) throw new SerializationError("account is not a valid account name");
  const id = String(spec.id || "");
  if (!/^[a-z0-9._-]{1,32}$/.test(id)) throw new SerializationError('custom_json id must match [a-z0-9._-]{1,32}');
  const json = JSON.stringify(spec.json);
  if (json.length > 8192) throw new SerializationError("custom_json payload exceeds 8192 bytes");
  const payload: CustomJsonOperation = { required_auths: [], required_posting_auths: [account], id, json };
  const adapter = steemAdapter();
  const unsigned = await adapter.buildOperations([{ type: "custom_json", payload: payload as unknown as Record<string, unknown> }]);
  const ops: SteemTransaction["operations"] = [{ name: "custom_json", body: payload }];
  return finalize(adapter, unsigned, ops);
}

/** Follow (what: ["blog"]) / unfollow (what: []) via the follow plugin. */
export async function buildSteemFollowTx(spec: { follower: string; following: string; unfollow?: boolean }): Promise<SocialBuild> {
  const follower = spec.follower.trim().toLowerCase();
  const following = spec.following.trim().toLowerCase();
  if (!/^[a-z0-9.\-]{3,16}$/.test(following)) throw new SerializationError("following is not a valid account name");
  return buildSteemCustomJsonTx({
    account: follower,
    id: "follow",
    json: ["follow", { follower, following, what: spec.unfollow ? [] : ["blog"] }],
  });
}

/** Reblog (resteem) via the follow plugin. */
export async function buildSteemReblogTx(spec: { account: string; author: string; permlink: string }): Promise<SocialBuild> {
  const account = spec.account.trim().toLowerCase();
  const author = spec.author.trim().toLowerCase();
  const permlink = assertPermlink(spec.permlink, "permlink");
  return buildSteemCustomJsonTx({ account, id: "reblog", json: ["reblog", { account, author, permlink }] });
}
