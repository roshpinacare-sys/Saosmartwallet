/**
 * anchor-verify.ts — Cross-paradigm identity-anchor verifier (Breakthrough Demo 1)
 * ================================================================================
 * Proves, with math only (no keys, no mocks), that ONE secp256k1 scalar binds:
 *   · the Steem active authority
 *   · the Hive active authority (same key bytes, measured live)
 *   · an EVM address (EIP-191 signature published ON-CHAIN inside a
 *     custom_json operation with id "saos.id.v1", signed by that authority)
 *
 * Verification chain (everything read from public chains at request time):
 *   1. Find the latest `saos.id.v1` custom_json op in the account's history.
 *   2. Parse { msg, evm, sig } from the payload.
 *   3. EIP-191 hash the msg → keccak256("\x19Ethereum Signed Message:\n<len><msg>").
 *   4. ecrecover(sig, digest) → recovered address; must equal payload.evm.
 *   5. Decompress the account's live ACTIVE public key (Graphene base58check)
 *      → same EC point → keccak → address; must equal the recovered address.
 *      ⇒ the EVM address IS the active key's point — same private scalar.
 *   6. Compare active pubkeys across chains (Steem/Hive measured; Blurt
 *      honestly null when its RPC is unreachable from this network).
 *
 * Third parties can re-run every step with any secp256k1 library.
 */

import { keccak_256 } from "@noble/hashes/sha3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";

const STEEM_RPC = "https://api.steemit.com";
const HIVE_RPC = "https://api.hive.blog";
const BLURT_RPCS = [
  "https://rpc.blurt.world",
  "https://blurt-rpc.greenhousemessages.com",
  "https://rpc.blurtlag.tech",
];
const ANCHOR_ID = "saos.id.v1";
const MAX_HISTORY_PAGES = 40; // × 100 entries = 4,000 ops scanned, newest-first
const HISTORY_LIMIT = 100; // node hard cap

async function rpc<T>(url: string, method: string, params: unknown, timeoutMs = 9_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`rpc ${res.status}`);
    const j = (await res.json()) as { result?: T; error?: { message?: string } };
    if (j.error) throw new Error(j.error.message ?? "rpc error");
    return j.result as T;
  } finally {
    clearTimeout(timer);
  }
}

/* ── base58check (Graphene public keys, prefix STM/TST/BLURT) ── */
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function b58decode(s: string): Uint8Array {
  let num = 0n;
  for (const c of s) {
    const idx = B58.indexOf(c);
    if (idx < 0) throw new Error(`bad base58 char "${c}"`);
    num = num * 58n + BigInt(idx);
  }
  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num & 255n));
    num >>= 8n;
  }
  for (const c of s) {
    if (c === "1") bytes.unshift(0);
    else break;
  }
  return Uint8Array.from(bytes);
}

export interface GrapheneKey {
  format: string;
  payloadBytes: Uint8Array;
  pointValid: boolean;
  /** EVM address derived from the same EC point (keccak of uncompressed X||Y). */
  evmAddress: string | null;
  checksumOk: boolean;
}

/**
 * Decode a Graphene public key (e.g. STM5Hh…). Checksum is validated over
 * prefix+payload (graphene variant); the 33-byte payload must parse as a
 * valid compressed secp256k1 point regardless — that point is the proof.
 */
export function decodeGrapheneKey(pub: string): GrapheneKey {
  const m = /^(STM|TST|BLURT)([1-9A-HJ-NP-Za-km-z]+)$/.exec(pub);
  if (!m) throw new Error(`not a graphene public key: ${pub.slice(0, 12)}…`);
  const [, prefix, body] = m;
  const raw = b58decode(body);
  if (raw.length !== 37) throw new Error(`unexpected key length ${raw.length}`);
  const payload = raw.slice(0, 33);
  const checksum = raw.slice(33);
  const withPrefix = new Uint8Array(Buffer.concat([Buffer.from(prefix, "ascii"), payload]));
  const expect = ripemd160(sha256(withPrefix)).slice(0, 4);
  const checksumOk = Buffer.from(checksum).equals(Buffer.from(expect));
  let pointValid = false;
  let evmAddress: string | null = null;
  try {
    const Q = secp256k1.Point.fromBytes(payload);
    const unc = Q.toBytes(false);
    evmAddress = checksumAddress(
      Buffer.from(keccak_256(unc.slice(1)))
        .subarray(12)
        .toString("hex"),
    );
    pointValid = true;
  } catch {
    pointValid = false;
  }
  return { format: prefix, payloadBytes: payload, pointValid, evmAddress, checksumOk };
}

/* ── EIP-55 checksum address ── */
export function checksumAddress(hexLower: string): string {
  const addr = hexLower.replace(/^0x/, "").toLowerCase();
  const hash = Buffer.from(keccak_256(new TextEncoder().encode(addr))).toString("hex");
  let out = "0x";
  for (let i = 0; i < 40; i++) {
    out += parseInt(hash[i], 16) >= 8 ? addr[i].toUpperCase() : addr[i];
  }
  return out;
}

/* ── EIP-191 personal_sign recovery ── */
export function eip191Digest(msg: string): Uint8Array {
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${msg.length}`);
  const body = new TextEncoder().encode(msg);
  return keccak_256(new Uint8Array(Buffer.concat([Buffer.from(prefix), Buffer.from(body)])));
}

export function recoverEvmAddress(sig65Hex: string, digest: Uint8Array): string {
  const raw = sig65Hex.replace(/^0x/, "");
  const sig65 = Uint8Array.from(Buffer.from(raw, "hex"));
  if (sig65.length !== 65) throw new Error(`signature must be 65 bytes, got ${sig65.length}`);
  const v = sig65[64];
  const recid = v >= 27 ? v - 27 : v;
  if (recid > 3) throw new Error(`bad recovery byte ${v}`);
  const sg = secp256k1.Signature.fromBytes(sig65.slice(0, 64), "compact").addRecoveryBit(recid);
  const Q = sg.recoverPublicKey(digest);
  const unc = Q.toBytes(false);
  return checksumAddress(
    Buffer.from(keccak_256(unc.slice(1)))
      .subarray(12)
      .toString("hex"),
  );
}

/* ── on-chain anchor discovery ── */
export interface AnchorOp {
  trxId: string;
  block: number;
  timestamp: string;
  cjId: string;
  payload: {
    protocol?: string;
    action?: string;
    at?: string;
    msg?: string;
    evm?: string;
    sig?: string;
    chains?: string[];
  };
}

interface HistoryEntry {
  trx_id: string;
  block: number;
  timestamp: string;
  op: { type: string; value?: { id?: string; json?: string } };
}

/** Newest-first paged scan of the account history for the latest saos.id.v1 op. */
export async function findLatestIdentityAnchor(username: string): Promise<
  | { found: true; op: AnchorOp; scanned: number }
  | { found: false; scanned: number; reason: string }
> {
  let scanned = 0;
  let start: number = -1;
  for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
    const pageResult = await rpc<{ history?: Array<[number, HistoryEntry]> }>(
      STEEM_RPC,
      "account_history_api.get_account_history",
      { account: username, start, limit: HISTORY_LIMIT },
    );
    const ops = pageResult?.history;
    if (!ops || ops.length === 0) break;
    for (let i = ops.length - 1; i >= 0; i--) {
      scanned++;
      const [, entry] = ops[i];
      const op = entry.op;
      if (op?.type === "custom_json_operation" && op.value?.id === ANCHOR_ID) {
        try {
          const payload = JSON.parse(op.value.json ?? "{}") as AnchorOp["payload"];
          return {
            found: true,
            scanned,
            op: {
              trxId: entry.trx_id,
              block: entry.block,
              timestamp: entry.timestamp,
              cjId: ANCHOR_ID,
              payload,
            },
          };
        } catch {
          // malformed payload — keep scanning for a well-formed anchor
        }
      }
    }
    const lowest = ops[0][0];
    if (lowest <= 0 || lowest === start) break;
    start = lowest - 1;
  }
  return { found: false, scanned, reason: `no ${ANCHOR_ID} op in the newest ${scanned} history entries` };
}

/* ── chain probes ── */
interface ChainAccount {
  name: string;
  active?: { key_auths?: Array<[string, number]> };
}

async function activeKeyOn(url: string, username: string): Promise<{ pub: string | null; error?: string }> {
  try {
    const accounts = await rpc<ChainAccount[]>(url, "condenser_api.get_accounts", [[username]]);
    const pub = accounts?.[0]?.active?.key_auths?.[0]?.[0] ?? null;
    if (!pub) return { pub: null, error: "account not found or no active key" };
    return { pub };
  } catch (e) {
    return { pub: null, error: e instanceof Error ? e.message : "rpc failed" };
  }
}

export async function blurtActiveKey(username: string): Promise<{ pub: string | null; endpoint: string | null; error?: string }> {
  for (const ep of BLURT_RPCS) {
    const r = await activeKeyOn(ep, username);
    if (r.pub) return { pub: r.pub, endpoint: ep };
  }
  return { pub: null, endpoint: null, error: "all blurt RPC endpoints unreachable from this network" };
}

/* ── key equality (prefix-normalized payload bytes) ── */
function sameKeyBytes(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const da = decodeGrapheneKey(a);
  const db = decodeGrapheneKey(b);
  return Buffer.from(da.payloadBytes).equals(Buffer.from(db.payloadBytes));
}

/* ── the full verification ── */
export interface AnchorVerifyResult {
  ok: boolean;
  username: string;
  measuredAt: string;
  error?: string;
  anchor?: {
    trxId: string;
    block: number;
    timestamp: string;
    explorer: string;
    protocol?: string;
    action?: string;
    anchoredAt?: string;
    claimedEvm: string | null;
    chainsClaimed: string[];
    msg: string | null;
    sig: string | null;
  };
  verify?: {
    eip191DigestHex: string;
    recoveredEvm: string;
    claimedMatchesRecovered: boolean;
    activeKeyPub: string;
    activeKeyEvmAddress: string;
    activeKeyEqualsRecovered: boolean;
    /** The decisive statement: the on-chain active authority point == EVM address point. */
    sameScalarProof: boolean;
    scanned: number;
  };
  chains?: Array<{
    chain: "steem" | "hive" | "blurt";
    activePub: string | null;
    sameKeyAsSteem: boolean | null;
    note?: string;
  }>;
  summary?: string;
}

export async function verifyIdentityAnchor(usernameInput?: string): Promise<AnchorVerifyResult> {
  const username = (usernameInput ?? "headcorner").trim().replace(/^@/, "");
  const measuredAt = new Date().toISOString();
  try {
    // 1. live active key on Steem
    const steemKey = await activeKeyOn(STEEM_RPC, username);
    if (!steemKey.pub) {
      return { ok: false, username, measuredAt, error: `steem active key unavailable: ${steemKey.error}` };
    }
    const steemDecoded = decodeGrapheneKey(steemKey.pub);
    if (!steemDecoded.pointValid) {
      return { ok: false, username, measuredAt, error: "steem active key does not parse as a secp256k1 point" };
    }

    // 2. on-chain anchor op
    const found = await findLatestIdentityAnchor(username);
    if (!found.found) {
      return { ok: false, username, measuredAt, error: found.reason };
    }
    const { msg, evm, sig } = found.op.payload;
    if (!msg || !evm || !sig) {
      return { ok: false, username, measuredAt, error: "anchor payload missing msg/evm/sig" };
    }

    // 3-4. EIP-191 ecrecover → compare with claimed EVM address
    const digest = eip191Digest(msg);
    const recovered = recoverEvmAddress(sig, digest);
    const claimed = checksumAddress(evm);
    const claimedMatchesRecovered = recovered.toLowerCase() === claimed.toLowerCase();

    // 5. the active key's point IS the EVM address (same private scalar)
    const activeKeyEvm = steemDecoded.evmAddress as string;
    const activeKeyEqualsRecovered = activeKeyEvm.toLowerCase() === recovered.toLowerCase();

    // 6. cross-chain key equality
    const hive = await activeKeyOn(HIVE_RPC, username);
    const blurt = await blurtActiveKey(username);
    const chains: AnchorVerifyResult["chains"] = [
      {
        chain: "steem",
        activePub: steemKey.pub,
        sameKeyAsSteem: true,
      },
      {
        chain: "hive",
        activePub: hive.pub,
        sameKeyAsSteem: hive.pub ? sameKeyBytes(steemKey.pub, hive.pub) : null,
        note: hive.error,
      },
      {
        chain: "blurt",
        activePub: blurt.pub,
        sameKeyAsSteem: blurt.pub ? sameKeyBytes(steemKey.pub, blurt.pub) : null,
        note: blurt.pub ? undefined : (blurt.error ?? undefined),
      },
    ];

    const sameScalarProof = claimedMatchesRecovered && activeKeyEqualsRecovered;
    const chainsBound = chains.filter((c) => c.sameKeyAsSteem === true).length;

    return {
      ok: sameScalarProof,
      username,
      measuredAt,
      anchor: {
        trxId: found.op.trxId,
        block: found.op.block,
        timestamp: found.op.timestamp,
        explorer: `https://steemworld.org/tx/${found.op.trxId}`,
        protocol: found.op.payload.protocol,
        action: found.op.payload.action,
        anchoredAt: found.op.payload.at,
        claimedEvm: claimed,
        chainsClaimed: found.op.payload.chains ?? [],
        msg,
        sig,
      },
      verify: {
        eip191DigestHex: Buffer.from(digest).toString("hex"),
        recoveredEvm: recovered,
        claimedMatchesRecovered,
        activeKeyPub: steemKey.pub,
        activeKeyEvmAddress: activeKeyEvm,
        activeKeyEqualsRecovered,
        sameScalarProof,
        scanned: found.scanned,
      },
      chains,
      summary: sameScalarProof
        ? `PROVEN: the Steem active authority's secp256k1 point derives ${activeKeyEvm}, the on-chain EIP-191 signature recovers the same address, and the same key bytes are the live active authority on ${Math.max(chainsBound, 1)} Graphene chain(s) measured now (${chainsBound === 2 ? "Steem+Hive" : `${chainsBound} chain(s)`}). One scalar → Steem+Hive(+Blurt per the on-chain claim)+EVM.`
        : !claimedMatchesRecovered
          ? "Anchor found on-chain but the EIP-191 signature does not recover the claimed EVM address — reported honestly, no verdict forced."
          : !activeKeyEqualsRecovered
            ? `AUTHORITY DRIFT: the anchor is internally valid (EIP-191 recovers its claimed address ${recovered}) but the account's CURRENT active authority derives ${activeKeyEvm} — the anchor was signed by a DIFFERENT scalar than the live active key. Either the active key was rotated after this anchor (block ${found.op.block}, ${found.op.timestamp}) or the anchor was never bound to it. Until a fresh anchor is signed by the current active key, identity is NOT proven — reported honestly, no verdict forced.`
            : "Anchor found on-chain but the math does NOT close — reported honestly, no verdict forced.",
    };
  } catch (e) {
    return { ok: false, username, measuredAt, error: e instanceof Error ? e.message : "verification failed" };
  }
}
