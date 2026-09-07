/**
 * Saosmartwallet — M1 DEX serialization acceptance suite
 * ======================================================
 * Extends the M0 evidence chain (tools/serialize-test.ts) with
 * limit_order_create — the DEX operation. Acceptance is identical in spirit:
 *
 *   1. BIT-EXACT vs the node's own serializer (condenser_api.get_transaction_hex
 *      — the canonical oracle). Synthetic transactions are fed to the node and
 *      the returned canonical hex must equal our engine's output byte-for-byte.
 *      (Node hex = digest bytes ‖ varint(0 sigs).)
 *   2. ROUND-TRIP: oracle hex → deserialize → serialize → identical bytes.
 *   3. TX-ID anchor: sha256(serialized)[0:40] computes deterministically.
 *   4. Engine self-consistency: parseAsset/formatAsset integer round-trips for
 *      every amount used in the vectors (no float involvement anywhere).
 *
 * READ-ONLY tool: never signs, never broadcasts, touches no keys.
 *
 * Run: bun tools/m1-op-test.ts
 */

import { deserializeTransaction, serializeTransaction, transactionId } from "../packages/chains/steem/src/transaction";
import { formatAsset, parseAsset } from "../packages/chains/steem/src/serializer";
import type { SteemTransaction } from "../packages/chains/steem/src/transaction";

const RPC = "https://api.steemit.com";

interface OracleTx {
  ref_block_num: number;
  ref_block_prefix: number;
  expiration: string;
  operations: Array<[string, Record<string, unknown>]>;
  extensions: never[];
  signatures: never[];
}

async function oracleHex(tx: OracleTx): Promise<string> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "condenser_api.get_transaction_hex",
      params: [tx],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const body = (await res.json()) as { result?: string; error?: { message?: string } };
  if (body.error) throw new Error(`RPC error: ${body.error.message}`);
  if (!body.result) throw new Error("empty oracle result");
  return body.result;
}

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function toSteemTx(tx: OracleTx): SteemTransaction {
  const ops = tx.operations.map(([name, payload]) => {
    if (name !== "limit_order_create") throw new Error(`tool only builds LOC, got ${name}`);
    const p = payload as {
      owner: string;
      orderid: number;
      amount_to_sell: string;
      min_to_receive: string;
      fill_or_kill: boolean;
      expiration: string;
    };
    return {
      name: "limit_order_create" as const,
      body: {
        owner: p.owner,
        orderid: p.orderid,
        amount_to_sell: parseAsset(p.amount_to_sell),
        min_to_receive: parseAsset(p.min_to_receive),
        fill_or_kill: p.fill_or_kill,
        expiration: Math.floor(Date.parse(`${p.expiration}Z`) / 1000),
      },
    };
  });
  return {
    refBlockNum: tx.ref_block_num,
    refBlockPrefix: tx.ref_block_prefix,
    expiration: Math.floor(Date.parse(`${tx.expiration}Z`) / 1000),
    operations: ops,
  };
}

async function oracleVector(label: string, tx: OracleTx): Promise<void> {
  console.log(`\n[vector] ${label}`);
  const canonical = await oracleHex(tx);
  console.log(`  oracle : ${canonical}`);

  const mine = Buffer.from(serializeTransaction(toSteemTx(tx))).toString("hex");
  // Node hex = digest bytes ‖ varint(0 signatures). Our serializer ends with
  // the extensions varint(0); the empty signature vector adds one more 0x00.
  const expected = `${mine}00`;
  check("bit-exact vs node serializer", mine.length + 2 === canonical.length && expected === canonical, `ours=${mine}`);

  // Round-trip from the ORACLE's bytes. Node returns the signed-tx wire form:
  // digest bytes ‖ varint(0 signatures). Strip the empty signature vector,
  // parse, re-serialize, compare with our digest bytes.
  const raw = Buffer.from(canonical, "hex");
  if (raw.length < 1 || raw[raw.length - 1] !== 0) {
    throw new Error(`oracle tail is not an empty signature vector: ...${canonical.slice(-8)}`);
  }
  const reparsed = deserializeTransaction(raw.subarray(0, raw.length - 1));
  const reserialized = Buffer.from(serializeTransaction(reparsed)).toString("hex");
  check("round-trip serialize(deserialize(oracle))", reserialized === mine, `got=${reserialized}`);

  const op = reparsed.operations[0];
  if (op?.name === "limit_order_create" && "owner" in op.body) {
    const b = op.body;
    const p = tx.operations[0][1] as {
      owner: string;
      orderid: number;
      amount_to_sell: string;
      min_to_receive: string;
      fill_or_kill: boolean;
      expiration: string;
    };
    check("owner/orderid/fok survive round-trip", b.owner === p.owner && b.orderid === p.orderid && b.fill_or_kill === p.fill_or_kill);
    check("amount_to_sell round-trips as canonical asset", formatAsset(b.amount_to_sell) === p.amount_to_sell, formatAsset(b.amount_to_sell));
    check("min_to_receive round-trips as canonical asset", formatAsset(b.min_to_receive) === p.min_to_receive, formatAsset(b.min_to_receive));
    check(
      "op expiration matches vector",
      b.expiration === Math.floor(Date.parse(`${p.expiration}Z`) / 1000),
    );
  }
  const txid = transactionId(reparsed);
  check("tx-id anchor computed (sha256[0:40])", /^[0-9a-f]{40}$/.test(txid), txid);
}

async function main(): Promise<void> {
  console.log("=== M1 DEX serialization acceptance (limit_order_create vs live node oracle) ===");
  console.log(`node: ${RPC}`);

  // Vector 1 — the reference vector captured during evidence gathering.
  await oracleVector("market buy 101 STEEM @ ~0.099 SBD (orderid 77)", {
    ref_block_num: 12345,
    ref_block_prefix: 305419896,
    expiration: "2026-09-07T16:00:00",
    operations: [
      [
        "limit_order_create",
        {
          owner: "testacct",
          orderid: 77,
          amount_to_sell: "10.000 SBD",
          min_to_receive: "101.000 STEEM",
          fill_or_kill: false,
          expiration: "2026-09-08T16:00:00",
        },
      ],
    ],
    extensions: [],
    signatures: [],
  });

  // Vector 2 — boundary values: max uint32 orderid, fok=true, zero-amount assets.
  await oracleVector("boundary: orderid 0xffffffff, fok=true, 0-amounts", {
    ref_block_num: 1,
    ref_block_prefix: 1,
    expiration: "2026-09-07T17:00:00",
    operations: [
      [
        "limit_order_create",
        {
          owner: "alice",
          orderid: 4294967295,
          amount_to_sell: "0.001 STEEM",
          min_to_receive: "0.000 SBD",
          fill_or_kill: true,
          expiration: "2026-09-07T18:00:00",
        },
      ],
    ],
    extensions: [],
    signatures: [],
  });

  // Vector 3 — sell side (STEEM→SBD) with a large odd amount, multibyte orderid.
  await oracleVector("market sell 12345.678 STEEM @ ~0.1 SBD (orderid 65535)", {
    ref_block_num: 65535,
    ref_block_prefix: 4294967295,
    expiration: "2026-09-09T00:00:00",
    operations: [
      [
        "limit_order_create",
        {
          owner: "market.maker",
          orderid: 65535,
          amount_to_sell: "12345.678 STEEM",
          min_to_receive: "1234.567 SBD",
          fill_or_kill: false,
          expiration: "2026-09-16T00:00:00",
        },
      ],
    ],
    extensions: [],
    signatures: [],
  });

  // Engine self-tests — integer asset round-trips used by the terminal.
  console.log("\n[self-tests]");
  for (const s of ["0.001 STEEM", "12345.678 STEEM", "10.000 SBD", "0.000 SBD", "1234.567 SBD"]) {
    const a = parseAsset(s);
    check(`asset integer round-trip ${s}`, formatAsset(a) === s);
  }
  try {
    parseAsset("0.1234 STEEM"); // precision overflow must fail closed
    check("precision overflow rejected", false, "parseAsset accepted 4 decimals on STEEM");
  } catch {
    check("precision overflow rejected", true);
  }

  console.log(`\n=== RESULT: ${pass} PASS, ${fail} FAIL ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error("fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
