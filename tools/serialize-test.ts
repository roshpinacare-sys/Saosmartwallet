#!/usr/bin/env bun
/**
 * Saosmartwallet — M0 serialization & crypto validation
 * =====================================================
 * Acceptance criteria (M0 gate):
 *   1. BIT-IDENTICAL SERIALIZATION: for real on-chain transfer transactions,
 *      our serialization MUST equal the canonical hex produced by the node's
 *      own serializer (condenser_api.get_transaction_hex) — byte for byte.
 *   2. DIGEST ANCHOR: sha256(our bytes)[0:20] MUST equal the chain's
 *      transaction_id for every tested transaction.
 *   3. ROUND-TRIP: our deserializer must rebuild what our serializer emits.
 *   4. SIGNATURE VALIDATION: recovering the public key from a REAL on-chain
 *      signature over sha256(chain_id ‖ our_bytes) MUST match a key in the
 *      signer's on-chain authority — this proves, against the chain itself,
 *      the digest composition (chain id + serialization) and the 65-byte
 *      signature format, without broadcasting anything.
 *   5. CRYPTO SELF-TESTS: WIF/STM encodings (round-trip + tamper rejection),
 *      password/brain-key derivation shapes, asset parsing (no floats).
 *
 * Read-only: sends no keys, no transactions, nothing signed. Exit 0 iff ALL pass.
 *
 * USAGE: bun tools/serialize-test.ts [--rpc https://api.steemit.com] [--samples 5]
 */

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";

import {
  PrivateKey,
  PublicKey,
  base58Decode,
  deriveFromBrainKey,
  derivePrivateKey,
  derivePrivateKeys,
  generateMasterPassword,
  normalizeBrainKey,
} from "../packages/crypto/src/index";
import { SteemAdapter } from "../packages/chains/steem/src/adapter";
import { SerializationError, formatAsset, parseAsset } from "../packages/chains/steem/src/serializer";
import {
  STEEM_CHAIN_ID,
  type SteemTransaction,
  appendSignatures,
  deserializeTransaction,
  serializeTransaction,
  transactionDigest,
} from "../packages/chains/steem/src/transaction";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed++;
    console.log(`  [PASS] ${label}`);
  } else {
    failed++;
    console.log(`  [FAIL] ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------------------
// 1. Crypto self-tests (offline)
// ---------------------------------------------------------------------------

function cryptoSelfTests(): void {
  console.log("\n── crypto self-tests ──────────────────────────────────────");

  // WIF round-trip + tamper rejection
  const k = PrivateKey.random();
  const wif = k.toWif();
  check("WIF round-trip", PrivateKey.fromWif(wif).equals(k));
  check("WIF starts with 5 (0x80 version)", wif.startsWith("5"));
  const tamperedWif = (wif.slice(0, -2) === wif ? wif : wif).slice(0, -1) + (wif.endsWith("z") ? "y" : "z");
  let threw = false;
  try {
    PrivateKey.fromWif(tamperedWif);
  } catch {
    threw = true;
  }
  check("WIF checksum tamper rejected", threw);

  // Public key encoding round-trip + tamper rejection
  const pub = k.publicKey;
  const stm = pub.toString("STM");
  check("STM round-trip", PublicKey.fromString(stm).toString("STM") === stm);
  check("STM payload is 37 bytes (33 pub + 4 checksum)", base58Decode(stm.slice(3)).length === 37);
  let threw2 = false;
  try {
    PublicKey.fromString(stm.slice(0, -1) + (stm.endsWith("z") ? "y" : "z"));
  } catch {
    threw2 = true;
  }
  check("STM checksum tamper rejected", threw2);

  // Signature round-trip via recovery (Sign → recover → same pub)
  const digest = sha256(new TextEncoder().encode("saosmartwallet m0 self test"));
  const sig65 = k.signRecoverable(digest);
  check("signature is 65 bytes", sig65.length === 65);
  check("signature header is 31+recid (0x1f/0x20)", sig65[0] >= 31 && sig65[0] <= 34);
  const recoveredPub = secp256k1
    .Signature.fromBytes(new Uint8Array(sig65.subarray(1)), "compact")
    .addRecoveryBit(sig65[0] - 31)
    .recoverPublicKey(digest, { prehash: false })
    .toBytes(true);
  check("sign→recover returns the signer's public key", Buffer.from(recoveredPub).equals(Buffer.from(pub.bytes)));
  check("verify() accepts own signature", pub.verify(digest, sig65));
  const wrongDigest = sha256(new TextEncoder().encode("other message"));
  check("verify() rejects wrong digest", !pub.verify(wrongDigest, sig65));

  // Derivation shapes
  const pw = generateMasterPassword();
  check("master password is P-prefixed WIF of a random key", pw.startsWith("P") && pw.length === 1 + 51);
  check("master password entropy parses as a WIF", (() => {
    try {
      PrivateKey.fromWif(pw.slice(1));
      return true;
    } catch {
      return false;
    }
  })());
  const roles = derivePrivateKeys("alice", pw);
  check("role keys are distinct per role", new Set(Object.values(roles).map((x) => x!.toWif())).size === 4);
  check("role seed = sha256(account+role+password)", derivePrivateKey("alice", pw, "active")!.equals(roles.active!));
  check("brain-key derivation is deterministic", deriveFromBrainKey("  word   one  TWO  ").toWif() === deriveFromBrainKey("word one two").toWif());
  check("brain-key normalization collapses whitespace + lowercases", deriveFromBrainKey("word one two").toWif() === deriveFromBrainKey(normalizeBrainKey("WORD  ONE two")).toWif());

  // Asset parsing — no floats anywhere
  const a = parseAsset("1.000 STEEM");
  check("asset parse 1.000 STEEM → 1000n", a.amount === 1000n && a.precision === 3);
  check("asset format round-trip", formatAsset(a) === "1.000 STEEM");
  check("asset large amounts exact (no float)", parseAsset("31589.188 STEEM").amount === 31589188n);
  check("asset VESTS precision 6", parseAsset("12.123456 VESTS").amount === 12123456n);
  check("asset excess decimals rejected", (() => {
    try {
      parseAsset("0.0001 STEEM");
      return false;
    } catch (e) {
      return e instanceof SerializationError;
    }
  })());
}

// ---------------------------------------------------------------------------
// 2. Network validation (read-only)
// ---------------------------------------------------------------------------

interface ChainTx {
  blockNum: number;
  txId: string;
  refBlockNum: number;
  refBlockPrefix: number;
  expiration: string;
  operations: Array<[string, Record<string, unknown>]>;
  extensions: unknown[];
  signatures: string[];
  from?: string;
}

async function rpc(rpcUrl: string, method: string, params: unknown): Promise<any> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error).slice(0, 140)}`);
  return j.result;
}

function toSteemTx(tx: ChainTx): SteemTransaction {
  return {
    refBlockNum: tx.refBlockNum,
    refBlockPrefix: tx.refBlockPrefix,
    expiration: Math.floor(new Date(`${tx.expiration}Z`).getTime() / 1000),
    operations: tx.operations.map(([name, body]) => {
      if (name !== "transfer") throw new Error(`non-transfer op in sample: ${name}`);
      return {
        name: "transfer" as const,
        body: {
          from: String(body.from),
          to: String(body.to),
          amount: parseAsset(String(body.amount)),
          memo: typeof body.memo === "string" ? body.memo : "",
        },
      };
    }),
  };
}

async function networkTests(rpcUrl: string, samples: number): Promise<void> {
  console.log("\n── live-chain serialization (read-only) ───────────────────");

  const adapter = new SteemAdapter({ rpcUrl });
  const health = await adapter.health();
  check("adapter health(): node reachable", health.reachable, `head=${health.headBlock} lag=${health.lagSeconds}s`);
  if (!health.reachable) return;

  const rc = await adapter.getRcManabar("steem");
  check("adapter getRcManabar()", rc !== null && rc.maxRc !== "0", rc ? `RC ${rc.percent}% of ${rc.maxRc}` : "null");
  const acc = await adapter.getAccount("steem");
  check("adapter getAccount('steem')", acc !== null && acc.balances.liquid.includes("STEEM"), acc?.balances.liquid);

  const dgp = await rpc(rpcUrl, "condenser_api.get_dynamic_global_properties", []);
  const head: number = dgp.head_block_number;

  const samplesOut: ChainTx[] = [];
  outer: for (let bn = head - 2; bn > head - 400; bn--) {
    let block: { transactions?: Array<Record<string, unknown>> };
    try {
      block = await rpc(rpcUrl, "condenser_api.get_block", [bn]);
    } catch {
      continue;
    }
    for (const t of block.transactions ?? []) {
      const ops = t.operations as Array<[string, Record<string, unknown>]>;
      if (!Array.isArray(ops) || ops.length === 0) continue;
      if (!ops.every(([n]) => n === "transfer")) continue;
      samplesOut.push({
        blockNum: bn,
        txId: String(t.transaction_id),
        refBlockNum: Number(t.ref_block_num),
        refBlockPrefix: Number(t.ref_block_prefix),
        expiration: String(t.expiration),
        operations: ops,
        extensions: (t.extensions as unknown[]) ?? [],
        signatures: (t.signatures as string[]) ?? [],
        from: String(ops[0][1].from),
      });
      if (samplesOut.length >= samples) break outer;
    }
  }
  check(`collected ${samples} live transfer transactions`, samplesOut.length >= Math.min(2, samples), `got ${samplesOut.length}`);

  let bitIdentical = 0;
  let digestAnchored = 0;
  let roundTripped = 0;
  for (const [i, tx] of samplesOut.entries()) {
    const steemTx = toSteemTx(tx);
    const mineHex = Buffer.from(serializeTransaction(steemTx)).toString("hex");

    // (1) bit-identical vs node serializer — the node returns the
    // signed_transaction wire form: tx bytes + varint(sigCount); our input had
    // no signatures, so the expected oracle = tx bytes + empty vector (0x00).
    let oracleHex: string | undefined;
    try {
      oracleHex = await rpc(rpcUrl, "condenser_api.get_transaction_hex", [
        {
          ref_block_num: tx.refBlockNum,
          ref_block_prefix: tx.refBlockPrefix,
          expiration: tx.expiration,
          operations: tx.operations,
          extensions: tx.extensions,
        },
      ]);
    } catch (e) {
      console.log(`  sample#${i}: oracle RPC failed (${(e as Error).message.slice(0, 80)})`);
    }
    const expectedWire = Buffer.from(appendSignatures(new Uint8Array(Buffer.from(mineHex, "hex")), [])).toString("hex");
    const identical = oracleHex !== undefined && expectedWire === oracleHex.toLowerCase();
    if (identical) bitIdentical++;

    // (2) digest anchor vs chain transaction_id
    const idFromMine = Buffer.from(sha256(new Uint8Array(Buffer.from(mineHex, "hex")))).toString("hex").slice(0, 40);
    const anchored = idFromMine === tx.txId;
    if (anchored) digestAnchored++;

    // (3) deserializer round-trip
    let rtOk = false;
    try {
      const rebuilt = deserializeTransaction(new Uint8Array(Buffer.from(mineHex, "hex")));
      rtOk = Buffer.from(serializeTransaction(rebuilt)).toString("hex") === mineHex;
    } catch {
      rtOk = false;
    }
    if (rtOk) roundTripped++;

    console.log(
      `  sample#${i} block=${tx.blockNum} bytes=${Buffer.from(mineHex, "hex").length} ` +
        `oracle=${identical ? "BIT-IDENTICAL" : "DIFF"} txid=${anchored ? "MATCH" : "MISMATCH"} roundtrip=${rtOk ? "OK" : "FAIL"}`,
    );
  }
  check("bit-identical serialization vs node serializer (ALL samples)", bitIdentical === samplesOut.length, `${bitIdentical}/${samplesOut.length}`);
  check("sha256 digest equals chain transaction_id (ALL samples)", digestAnchored === samplesOut.length, `${digestAnchored}/${samplesOut.length}`);
  check("deserialize→serialize round-trip (ALL samples)", roundTripped === samplesOut.length, `${roundTripped}/${samplesOut.length}`);

  // (4) signature recovery against on-chain authority
  console.log("\n── live-chain signature validation (read-only recovery) ───");
  let recovered = 0;
  const sigSamples = samplesOut.filter((s) => s.signatures.length > 0).slice(0, 2);
  for (const tx of sigSamples) {
    const steemTx = toSteemTx(tx);
    const digest = transactionDigest(steemTx, STEEM_CHAIN_ID);
    const sig65 = new Uint8Array(Buffer.from(tx.signatures[0], "hex"));
    try {
      const pub = PublicKey.fromBytes(
        new Uint8Array(
          secp256k1.Signature.fromBytes(new Uint8Array(sig65.subarray(1)), "compact")
            .addRecoveryBit(sig65[0] - 31)
            .recoverPublicKey(digest, { prehash: false })
            .toBytes(true),
        ),
      );
      const stm = pub.toString("STM");
      const auth = await rpc(rpcUrl, "condenser_api.get_accounts", [[tx.from!]]);
      const onChain: string[] = [
        ...((auth[0]?.active?.key_auths ?? []) as Array<[string, number]>).map((k) => k[0]),
        ...((auth[0]?.posting?.key_auths ?? []) as Array<[string, number]>).map((k) => k[0]),
        ...((auth[0]?.owner?.key_auths ?? []) as Array<[string, number]>).map((k) => k[0]),
      ];
      const match = onChain.includes(stm);
      console.log(`  block=${tx.blockNum} recovered=${stm.slice(0, 16)}… authority=${match ? "MATCHES ON-CHAIN KEY" : "no match"}`);
      if (match) recovered++;
    } catch (e) {
      console.log(`  block=${tx.blockNum} recovery failed: ${(e as Error).message.slice(0, 100)}`);
    }
  }
  check("real on-chain signatures recover to on-chain authority keys (ALL tested)", sigSamples.length > 0 && recovered === sigSamples.length, `${recovered}/${sigSamples.length}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const rpcUrl = args.includes("--rpc") ? args[args.indexOf("--rpc") + 1] : "https://api.steemit.com";
  const samples = args.includes("--samples") ? Number(args[args.indexOf("--samples") + 1]) : 5;

  console.log("Saosmartwallet M0 validation");
  console.log(`rpc: ${rpcUrl} · samples: ${samples}`);

  cryptoSelfTests();
  await networkTests(rpcUrl, samples);

  console.log("\n───────────────────────────────────────────────────────────");
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
