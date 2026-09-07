/**
 * Saosmartwallet — Steem transaction envelope
 * ===========================================
 * signed_transaction wire layout (fc::raw):
 *
 *   ref_block_num   : uint16 LE
 *   ref_block_prefix: uint32 LE
 *   expiration      : uint32 LE (unix seconds)
 *   operations      : varint count + [varint op_id + body]*
 *   extensions      : varint count + items (M0: only the empty form, 0x00)
 *
 * The SIGNING DIGEST is sha256(chain_id ‖ bytes-above) — signatures are NOT
 * part of the digest. The wire form of a signed transaction appends
 * varint(sigCount) + 65-byte signatures AFTER the digest bytes.
 *
 * chain_id: Steem mainnet uses 32 zero bytes (hardcoded the same way in
 * steem-js and dhive). Forks MUST pass their own chain id.
 */

import { sha256 } from "@noble/hashes/sha2.js";

import { ByteReader, ByteWriter, SerializationError } from "./serializer";
import { type SteemOperationBody, type SteemOperationName, packOperation, unpackOperation } from "./operations";

/** Steem mainnet chain id — 32 zero bytes (reference: steem-js/dhive hardcoded default). */
export const STEEM_CHAIN_ID = new Uint8Array(32);

export interface SteemTransaction {
  refBlockNum: number;
  refBlockPrefix: number;
  /** Unix epoch seconds (uint32). */
  expiration: number;
  operations: Array<{ name: SteemOperationName; body: SteemOperationBody }>;
  /** M0 supports the empty extensions vector only (the overwhelmingly common case). */
  extensions?: never[];
}

/** Serializes the digest portion of a transaction (no signatures). */
export function serializeTransaction(tx: SteemTransaction): Uint8Array {
  const w = new ByteWriter();
  w.u16(tx.refBlockNum);
  w.u32(tx.refBlockPrefix);
  w.u32(tx.expiration);
  w.varint(tx.operations.length);
  for (const op of tx.operations) packOperation(w, op.name, op.body);
  const extCount = tx.extensions?.length ?? 0;
  if (extCount !== 0) {
    throw new SerializationError("non-empty extensions are not supported in M0");
  }
  w.varint(0);
  return w.toUint8Array();
}

/** Rebuilds a transaction from digest bytes; throws on unknown ops or truncation. */
export function deserializeTransaction(bytes: Uint8Array): SteemTransaction {
  const r = new ByteReader(bytes);
  const refBlockNum = r.u16();
  const refBlockPrefix = r.u32();
  const expiration = r.u32();
  const opCount = r.varint();
  const operations: SteemTransaction["operations"] = [];
  for (let i = 0; i < opCount; i++) {
    const op = unpackOperation(r);
    if (op.name === undefined || op.body === undefined) {
      throw new SerializationError(`operation ${i}: unsupported id ${op.id}`);
    }
    operations.push({ name: op.name, body: op.body });
  }
  const extCount = r.varint();
  if (extCount !== 0) throw new SerializationError("non-empty extensions are not supported in M0");
  if (r.remaining !== 0) {
    throw new SerializationError(`${r.remaining} trailing bytes after transaction`);
  }
  return { refBlockNum, refBlockPrefix, expiration, operations };
}

/** The bytes that signatures commit to: sha256(chain_id ‖ serialized_tx). */
export function transactionDigest(tx: SteemTransaction, chainId: Uint8Array = STEEM_CHAIN_ID): Uint8Array {
  if (chainId.length !== 32) throw new SerializationError("chain id must be exactly 32 bytes");
  const serialized = serializeTransaction(tx);
  const preimage = new Uint8Array(32 + serialized.length);
  preimage.set(chainId, 0);
  preimage.set(serialized, 32);
  return sha256(preimage);
}

/** Chain transaction id: first 20 bytes of sha256(serialized_tx), hex — no chain id. */
export function transactionId(tx: SteemTransaction): string {
  return Buffer.from(sha256(serializeTransaction(tx))).toString("hex").slice(0, 40);
}

// ---------------------------------------------------------------------------
// Signatures (wire helpers)
// ---------------------------------------------------------------------------

export const SIGNATURE_SIZE = 65;

/**
 * Appends the signature vector to digest bytes, producing the full wire form
 * of a signed transaction: digest bytes ‖ varint(count) ‖ sig(65)*.
 */
export function appendSignatures(digestBytes: Uint8Array, signaturesHex: string[]): Uint8Array {
  const w = new ByteWriter();
  w.bytes(digestBytes);
  w.varint(signaturesHex.length);
  for (const hex of signaturesHex) {
    const raw = Buffer.from(hex, "hex");
    if (raw.length !== SIGNATURE_SIZE) {
      throw new SerializationError(`signature must be ${SIGNATURE_SIZE} bytes, got ${raw.length}`);
    }
    w.bytes(new Uint8Array(raw));
  }
  return w.toUint8Array();
}
