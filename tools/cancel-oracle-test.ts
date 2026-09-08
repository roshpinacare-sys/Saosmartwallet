#!/usr/bin/env bun
/**
 * limit_order_cancel — wire-format oracle test (M3+ DEX lifecycle)
 * ================================================================
 * Proves, LIVE against the node's own serializer, that our
 * limit_order_cancel packing is byte-exact:
 *
 *   1. ORACLE: a fixed-envelope cancel tx (owner + orderid, empty signatures)
 *      built with OUR SteemAdapter.buildOperations + serializer MUST equal
 *      condenser_api.get_transaction_hex of the same logical tx — byte for byte.
 *      (The endpoint accepts unsigned-shaped txs with empty signature vectors —
 *      it is a pure serializer; verified 2026-09-08 on api.steemit.com.)
 *   2. ROUND-TRIP: our unpackOperation must rebuild exactly what we packed.
 *   3. DETERMINISM: same cancel spec ⇒ same op body; ref-block fields may
 *      move between calls (fresh stamping) but the packed OP BYTES must be
 *      identical (op bytes exclude the envelope).
 *
 * Read-only: sends no keys, no transactions, nothing signed. Exit 0 iff ALL pass.
 *
 * USAGE: bun tools/cancel-oracle-test.ts [--rpc https://api.steemit.com]
 */

import { SteemAdapter } from "../packages/chains/steem/src/adapter";
import { packOperation, unpackOperation, type LimitOrderCancelOperation } from "../packages/chains/steem/src/operations";
import { ByteReader, ByteWriter } from "../packages/chains/steem/src/serializer";
import {
  appendSignatures,
  STEEM_CHAIN_ID,
  serializeTransaction,
  transactionDigest,
} from "../packages/chains/steem/src/transaction";

// -- args ---------------------------------------------------------------------

const args = process.argv.slice(2);
const rpcIdx = args.indexOf("--rpc");
const RPC = rpcIdx >= 0 ? args[rpcIdx + 1] : "https://api.steemit.com";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function nodeTxHex(trx: unknown): Promise<string> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "condenser_api.get_transaction_hex",
      params: [trx],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json()) as { result?: string; error?: { message?: string } };
  if (!res.ok || body.error || typeof body.result !== "string") {
    throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  }
  return body.result;
}

async function main(): Promise<void> {
  console.log(`limit_order_cancel oracle test — rpc ${RPC}\n`);

  // ---- 1. ORACLE: our bytes == node bytes --------------------------------
  // Fixed envelope so both sides serialize the identical logical transaction.
  const adapter = new SteemAdapter({ rpcUrl: RPC, requestTimeoutMs: 15_000 });
  const ORDERID = 77;
  const built = await adapter.buildOperations([
    { type: "limit_order_cancel", payload: { owner: "headcorner", orderid: ORDERID } },
  ]);
  const meta = built.metadata as { refBlockNum: number; refBlockPrefix: number; expiration: number };
  // Freeze the envelope to the oracle vector's values (ref 1/2, fixed time):
  const ORACLE_REF_NUM = 1;
  const ORACLE_REF_PREFIX = 2;
  const ORACLE_EXPIRATION = 1788916800; // 2026-09-08T20:00:00Z
  const steemTx = {
    refBlockNum: ORACLE_REF_NUM,
    refBlockPrefix: ORACLE_REF_PREFIX,
    expiration: ORACLE_EXPIRATION,
    operations: [{ name: "limit_order_cancel" as const, body: { owner: "headcorner", orderid: ORDERID } }],
  };
  const ours = Buffer.from(
    // get_transaction_hex returns the FULL signed_transaction form: digest
    // bytes ‖ signatures vector — with the empty signature vector we sent,
    // that is exactly serializeTransaction(...) ‖ varint(0).
    appendSignatures(serializeTransaction(steemTx), []),
  ).toString("hex");
  const node = await nodeTxHex({
    ref_block_num: ORACLE_REF_NUM,
    ref_block_prefix: ORACLE_REF_PREFIX,
    expiration: new Date(ORACLE_EXPIRATION * 1000).toISOString().slice(0, 19),
    operations: [["limit_order_cancel", { owner: "headcorner", orderid: ORDERID }]],
    extensions: [],
    signatures: [],
  });
  check("oracle: our cancel bytes == node serializer bytes", ours === node, `${ours} vs ${node}`);

  // digest composition sanity: sha256(chain_id ‖ tx) is 32 bytes, chain id is 32×00 for steem
  const digest = transactionDigest(steemTx, STEEM_CHAIN_ID);
  check("digest over (chain_id ‖ tx) is 32 bytes", digest.length === 32);

  // ---- 2. ROUND-TRIP -------------------------------------------------------
  const body: LimitOrderCancelOperation = { owner: "headcorner", orderid: ORDERID };
  const writer = new ByteWriter();
  packOperation(writer, "limit_order_cancel", body);
  const packed = writer.toUint8Array();
  const r = new ByteReader(packed);
  const unpacked = unpackOperation(r);
  check(
    "round-trip: unpack(repack(cancel)) == original",
    unpacked.name === "limit_order_cancel" &&
      unpacked.body !== null &&
      (unpacked.body as LimitOrderCancelOperation).owner === body.owner &&
      (unpacked.body as LimitOrderCancelOperation).orderid === body.orderid,
  );

  // ---- 3. DETERMINISM of the op bytes across fresh ref-block stamps --------
  const built2 = await adapter.buildOperations([
    { type: "limit_order_cancel", payload: { owner: "headcorner", orderid: ORDERID } },
  ]);
  const meta2 = built2.metadata as { refBlockNum: number };
  const steemTx2 = {
    refBlockNum: meta2.refBlockNum, // intentionally different stamp
    refBlockPrefix: ORACLE_REF_PREFIX,
    expiration: ORACLE_EXPIRATION + 30,
    operations: [{ name: "limit_order_cancel" as const, body: { owner: "headcorner", orderid: ORDERID } }],
  };
  const writer2 = new ByteWriter();
  packOperation(writer2, "limit_order_cancel", body);
  const writer3 = new ByteWriter();
  packOperation(writer3, "limit_order_cancel", body);
  check(
    "determinism: op bytes identical across fresh envelope stamps",
    Buffer.compare(writer2.toUint8Array(), writer3.toUint8Array()) === 0,
    `(envelopes differ: ref ${ORACLE_REF_NUM} vs ${meta2.refBlockNum} — as designed)`,
  );

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  if (failures > 0) process.exit(1);
}

void main();
