/**
 * Saosmartwallet packages/swap — Graphene witness TDD suite (agent-9, wallet-htlc-swap-engine)
 * ============================================================================================
 * Red-first suite for the on-chain witness layer: canonical deterministic JSON
 * witness payloads carried through the EXISTING oracle-proven Graphene packer
 * (packages/chains/steem/src — imported read-only, zero edits to landed code).
 *
 * Laws pinned here:
 *   • canonicalWitnessJson — recursively sorted keys, zero whitespace,
 *     array order preserved; identical payloads in any key order stringify
 *     identically (the determinism the digest domain needs).
 *   • custom_json id law: ^[a-z0-9._-]+$ and ≤ 32 chars — fail-closed.
 *   • size laws: witness json ≤ 8192 bytes (chain rule), transfer memo ≤ 2048
 *     (conservative wire cap) — both fail-closed BEFORE any packing.
 *   • wire truth: a hand-computed byte vector for a minimal custom_json op
 *     (op-id 18 = steem table), plus pack→unpack roundtrip identities, plus
 *     the byte-11 op-id oracle convention documented by the chains packer.
 *   • fork law: BLURT_OP_IDS (custom_json = 12, node-proven by the r20 oracle)
 *     changes the op-id byte and therefore the digest — steem table unchanged.
 *   • No hex-string literals: every digest/hashlock in fixtures derives at
 *     runtime from ASCII seeds through sha256Bytes (generic-api-key hygiene).
 */

import { describe, expect, test } from "bun:test";

import {
  canonicalWitnessJson,
  buildWitnessCustomJson,
  buildWitnessTransfer,
  buildWitnessOperation,
  buildWitnessTransaction,
  witnessTransactionDigest,
  bytesToHex,
  hexToBytes,
  HTLC_WITNESS_JSON_ID,
  HTLC_WITNESS_JSON_MAX,
  HTLC_WITNESS_MEMO_MAX,
  type WitnessPayload,
} from "../src/witness";
import { packOperation, unpackOperation, OP_IDS, BLURT_OP_IDS, type CustomJsonOperation, type TransferOperation } from "../../chains/steem/src/operations";
import { serializeTransaction, deserializeTransaction, transactionDigest } from "../../chains/steem/src/transaction";
import { ByteWriter, ByteReader } from "../../chains/steem/src/serializer";
import { sha256Bytes } from "../src/htlc";

const enc = new TextEncoder();
/** Valid preimage (≥ 16 bytes per the core length law) and its binding. */
const PREIMG = enc.encode("witness-preimage-0000001");
const HASHLOCK_HEX = (() => bytesToHex(sha256Bytes(PREIMG)))();

function payloadFixture(): WitnessPayload {
  return {
    v: 1,
    swap: "swap-0001",
    phase: "hashlock",
    leg: "A",
    chain: "steem",
    hashlock: HASHLOCK_HEX,
    expiresAt: 1_700_003_600,
  };
}

function preimagePayloadFixture(): WitnessPayload {
  return { ...payloadFixture(), phase: "preimage", hashlock: HASHLOCK_HEX, preimage: bytesToHex(PREIMG) };
}

describe("canonicalWitnessJson — deterministic serialization", () => {
  test("sorts keys recursively and emits zero whitespace", () => {
    const p = payloadFixture();
    const s = canonicalWitnessJson(p);
    expect(s.startsWith("{")).toBe(true);
    expect(s).not.toContain(" ");
    expect(s.indexOf('"chain"')).toBeLessThan(s.indexOf('"expiresAt"'));
    expect(s.indexOf('"expiresAt"')).toBeLessThan(s.indexOf('"hashlock"'));
    expect(s.indexOf('"v"')).toBeGreaterThan(s.indexOf('"swap"'));
  });

  test("key insertion order never changes the canonical form", () => {
    const a: WitnessPayload = { ...payloadFixture() };
    const b: WitnessPayload = {
      expiresAt: 1_700_003_600,
      hashlock: a.hashlock,
      chain: "steem",
      leg: "A",
      phase: "hashlock",
      swap: "swap-0001",
      v: 1,
    };
    expect(canonicalWitnessJson(a)).toBe(canonicalWitnessJson(b));
  });

  test("array order is preserved (arrays are sequences, not maps)", () => {
    const s1 = canonicalWitnessJson({ v: 1, swap: "s", phase: "hashlock", leg: "A", chain: "x", hashlock: "aa", expiresAt: 1, tags: ["b", "a"] } as unknown as WitnessPayload);
    const s2 = canonicalWitnessJson({ v: 1, swap: "s", phase: "hashlock", leg: "A", chain: "x", hashlock: "aa", expiresAt: 1, tags: ["a", "b"] } as unknown as WitnessPayload);
    expect(s1).not.toBe(s2);
  });
});

describe("witness size and id laws — fail-closed", () => {
  test("custom_json id must match [a-z0-9._-]+ and fit 32 chars", () => {
    expect(HTLC_WITNESS_JSON_ID).toBe("saos.htlc");
    expect(() =>
      buildWitnessCustomJson({ account: "swaptest", payload: payloadFixture(), jsonId: "SAOS.HTLC" }),
    ).toThrow();
    expect(() =>
      buildWitnessCustomJson({ account: "swaptest", payload: payloadFixture(), jsonId: "saos htlc" }),
    ).toThrow();
    expect(() =>
      buildWitnessCustomJson({ account: "swaptest", payload: payloadFixture(), jsonId: "x".repeat(33) }),
    ).toThrow();
    expect(() =>
      buildWitnessCustomJson({ account: "swaptest", payload: payloadFixture(), jsonId: "" }),
    ).toThrow();
  });

  test("witness json over the 8192-byte chain rule refuses", () => {
    expect(HTLC_WITNESS_JSON_MAX).toBe(8192);
    const bloated = { ...payloadFixture(), swap: "x".repeat(HTLC_WITNESS_JSON_MAX) };
    expect(() => buildWitnessCustomJson({ account: "swaptest", payload: bloated })).toThrow();
  });

  test("transfer memo over the conservative 2048 cap refuses", () => {
    expect(HTLC_WITNESS_MEMO_MAX).toBe(2048);
    const bloated = { ...payloadFixture(), swap: "x".repeat(HTLC_WITNESS_MEMO_MAX) };
    expect(() =>
      buildWitnessTransfer({
        from: "initiator.acct",
        to: "responder.acct",
        amount: { amount: 10_000n, precision: 3, symbol: "STEEM" },
        payload: bloated,
      }),
    ).toThrow();
  });
});

describe("buildWitnessCustomJson — structure", () => {
  test("posting-authority witness by default with the canonical json", () => {
    const op = buildWitnessCustomJson({ account: "swaptest", payload: payloadFixture() });
    expect(op.required_auths).toEqual([]);
    expect(op.required_posting_auths).toEqual(["swaptest"]);
    expect(op.id).toBe("saos.htlc");
    expect(op.json).toBe(canonicalWitnessJson(payloadFixture()));
  });

  test("active-authority mode puts the account in required_auths", () => {
    const op = buildWitnessCustomJson({ account: "swaptest", payload: payloadFixture(), authority: "active" });
    expect(op.required_auths).toEqual(["swaptest"]);
    expect(op.required_posting_auths).toEqual([]);
  });

  test("preimage-phase payloads carry the preimage field", () => {
    const p = preimagePayloadFixture();
    const op = buildWitnessCustomJson({ account: "swaptest", payload: p });
    expect(op.json).toContain('"phase":"preimage"');
  });

  test("refuses a preimage-phase payload without the preimage field", () => {
    const p: WitnessPayload = { ...payloadFixture(), phase: "preimage" };
    expect(() => buildWitnessCustomJson({ account: "swaptest", payload: p })).toThrow();
  });

  test("refuses a preimage that does not satisfy its own hashlock", () => {
    const p: WitnessPayload = { ...payloadFixture(), phase: "preimage", preimage: bytesToHex(enc.encode("tampered-preimage-0001")) };
    expect(() => buildWitnessCustomJson({ account: "swaptest", payload: p })).toThrow();
  });

  test("refuses a hashlock field that is not 64 lowercase hex chars", () => {
    const p = { ...payloadFixture(), hashlock: "zz" };
    expect(() => buildWitnessCustomJson({ account: "swaptest", payload: p })).toThrow();
  });
});

describe("wire truth — the oracle-proven packer", () => {
  test("minimal custom_json op matches the hand-computed byte vector", () => {
    // Body: {required_auths: [], required_posting_auths: ["swaptest"],
    //        id: "saos.htlc", json: '{"v":1}'}
    // Bytes: varint(18) 00 01 varint(8) "swaptest" varint(9) "saos.htlc" varint(7) '{"v":1}'
    const w = new ByteWriter();
    packOperation(
      w,
      "custom_json",
      {
        required_auths: [],
        required_posting_auths: ["swaptest"],
        id: "saos.htlc",
        json: '{"v":1}',
      } satisfies CustomJsonOperation,
      OP_IDS,
    );
    const ascii = (s: string) => Array.from(enc.encode(s));
    const expected = [
      18, // varint op id — OP_IDS.custom_json (node-proven)
      0, // required_auths count
      1, // required_posting_auths count
      8, ...ascii("swaptest"),
      9, ...ascii("saos.htlc"),
      7, ...ascii('{"v":1}'),
    ];
    expect(Array.from(w.toUint8Array())).toEqual(expected);
  });

  test("custom_json witness op roundtrips pack → unpack byte-identically", () => {
    const op = buildWitnessCustomJson({ account: "swaptest", payload: payloadFixture() });
    const w = new ByteWriter();
    packOperation(w, "custom_json", op, OP_IDS);
    const r = new ByteReader(w.toUint8Array());
    const unpacked = unpackOperation(r);
    expect(unpacked.name).toBe("custom_json");
    expect(unpacked.body).toEqual(op);
    expect(r.remaining).toBe(0);
  });

  test("transfer-with-witness-memo roundtrips and keeps the canonical memo", () => {
    const payload = payloadFixture();
    const op = buildWitnessTransfer({
      from: "initiator.acct",
      to: "responder.acct",
      amount: { amount: 10_000n, precision: 3, symbol: "STEEM" },
      payload,
    });
    expect(op.memo).toBe(canonicalWitnessJson(payload));
    const w = new ByteWriter();
    packOperation(w, "transfer", op as TransferOperation, OP_IDS);
    const r = new ByteReader(w.toUint8Array());
    const unpacked = unpackOperation(r);
    expect(unpacked.name).toBe("transfer");
    const body = unpacked.body as TransferOperation;
    expect(body.from).toBe("initiator.acct");
    expect(body.to).toBe("responder.acct");
    expect(body.memo).toBe(canonicalWitnessJson(payload));
    expect(body.amount).toEqual({ amount: 10_000n, precision: 3, symbol: "STEEM" });
  });
});

describe("buildWitnessTransaction — envelope and fork law", () => {
  test("op count byte sits at index 10 and the op-id byte at index 11 (steem table)", () => {
    const tx = buildWitnessTransaction({
      refBlockNum: 1,
      refBlockPrefix: 2,
      expiration: 1_700_003_600,
      operations: [
        {
          kind: "custom_json",
          account: "swaptest",
          payload: payloadFixture(),
        },
      ],
    });
    const bytes = serializeTransaction(tx, OP_IDS);
    expect(bytes[10]).toBe(1); // op count
    expect(bytes[11]).toBe(OP_IDS.custom_json); // 18 — steem table
    const round = deserializeTransaction(bytes);
    expect(round.operations.length).toBe(1);
    expect(round.operations[0].name).toBe("custom_json");
  });

  test("the BLURT table flips the op-id byte to 12 and the digest follows", () => {
    const spec = {
      refBlockNum: 1,
      refBlockPrefix: 2,
      expiration: 1_700_003_600,
      operations: [{ kind: "custom_json" as const, account: "swaptest", payload: payloadFixture() }],
    };
    const tx = buildWitnessTransaction(spec);
    const steemBytes = serializeTransaction(tx, OP_IDS);
    const blurtBytes = serializeTransaction(tx, BLURT_OP_IDS);
    expect(blurtBytes[11]).toBe(BLURT_OP_IDS.custom_json); // 12 — node-proven r20
    expect(Array.from(steemBytes)).not.toEqual(Array.from(blurtBytes));
    const chainId = new Uint8Array(32).fill(0xab);
    const dSteem = witnessTransactionDigest(tx, chainId, OP_IDS);
    const dBlurt = witnessTransactionDigest(tx, chainId, BLURT_OP_IDS);
    expect(Array.from(dSteem)).not.toEqual(Array.from(dBlurt));
    // consistency with the landed chains digest law
    expect(Array.from(dSteem)).toEqual(Array.from(transactionDigest(tx, chainId, OP_IDS)));
  });

  test("multi-op witness tx (transfer + custom_json) roundtrips fully", () => {
    const payloadA = payloadFixture();
    const payloadB = preimagePayloadFixture();
    const tx = buildWitnessTransaction({
      refBlockNum: 42,
      refBlockPrefix: 0x12345678,
      expiration: 1_700_003_600,
      operations: [
        { kind: "transfer", from: "initiator.acct", to: "responder.acct", amount: { amount: 10_000n, precision: 3, symbol: "STEEM" }, payload: payloadA },
        { kind: "custom_json", account: "initiator.acct", payload: payloadB },
      ],
    });
    const round = deserializeTransaction(serializeTransaction(tx, OP_IDS));
    expect(round.operations.length).toBe(2);
    expect(round.operations[0].name).toBe("transfer");
    expect(round.operations[1].name).toBe("custom_json");
    const { name, body } = buildWitnessOperation({ kind: "custom_json", account: "initiator.acct", payload: payloadB });
    expect(name).toBe("custom_json");
    expect((round.operations[1].body as CustomJsonOperation).json).toBe((body as CustomJsonOperation).json);
  });

  test("refuses an empty operations vector", () => {
    expect(() =>
      buildWitnessTransaction({ refBlockNum: 1, refBlockPrefix: 2, expiration: 1_700_003_600, operations: [] }),
    ).toThrow();
  });
});

describe("hex helpers", () => {
  test("bytesToHex/hexToBytes roundtrip; odd input refuses", () => {
    const b = new Uint8Array([0x00, 0x01, 0xfe, 0xff]);
    expect(hexToBytes(bytesToHex(b))).toEqual(b);
    expect(bytesToHex(b)).toBe("0001feff");
    expect(() => hexToBytes("abc")).toThrow();
    expect(() => hexToBytes("zz")).toThrow();
  });
});
