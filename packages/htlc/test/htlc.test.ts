/**
 * packages/htlc — selftest (TDD, swarm task 4-c, cycle 31)
 * ========================================================
 * Master directive §3 (atomic swaps & HTLC routing) pinned BY TEST:
 *
 *   1.  secrets — 32-byte generation, sha256 known-answer vectors,
 *       constant-time verification path (timingSafeEqual), fail-closed on
 *       malformed input, secret material NEVER echoed in error text
 *   2.  timelocks — genesis invariant initiatorRefundAt - redeemerClaimAt >=
 *       MIN_SAFETY_MARGIN_MS fails closed; phase() math with an injected
 *       clock across all four phases (pre-funding / claim-window /
 *       refund-window / expired)
 *   3.  state machine — Initiated → Locked → (Redeemed | Refunded) with the
 *       full refusal matrix: wrong secret, wrong party, wrong phase,
 *       claim-before-lock, double-claim/refund/lock after terminal — every
 *       refusal is a typed HtlcError, state never silently changes
 *   4.  canonical codec — SAOS-HTLC/1 Offer/Lock/Claim/Refund messages,
 *       sorted-key deterministic JSON (key-order independent input →
 *       identical bytes), strict schema decode (fail-closed), sha256-chained
 *       receipt records with the fleet hash-chain law (prev→hash) and
 *       tamper detection
 *   5.  session — both sides' views advance on validated messages, receipts()
 *       chain verifies, vault integration: sealSessionReceipt /
 *       openSessionReceipt roundtrip via packages/vault (AES-256-GCM
 *       opaque secret) + Ed25519 signability of the receipt chain hash
 *   6.  simulated chain adapter — deterministic in-memory lock/claim/refund
 *       bookkeeping, double-lock / claim-before-lock / wrong-secret /
 *       wrong-phase refusals, honest `simulated: true` marker
 *
 * ALL key material in this file is deterministic PUBLIC test-vector data
 * ("aa"*32 / RFC 8032 TEST 1) — never real funds. The vault master key here
 * is a deterministic TEST key, never a real one. Zero network. Zero
 * third-party dependencies (node:crypto only).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  GENESIS_PREV,
  HtlcError,
  MIN_SAFETY_MARGIN_MS,
  SECRET_BYTES,
  SimulatedChainAdapter,
  SwapMachine,
  SwapSession,
  appendRecord,
  canonicalBytes,
  canonicalize,
  createTimelocks,
  decodeMessage,
  encodeMessage,
  generateSecret,
  hashSecret,
  makeClaim,
  makeLock,
  makeOffer,
  makeRefund,
  openSessionReceipt,
  phase,
  sealSessionReceipt,
  verifyChain,
  verifySecret,
  type Asset,
  type HtlcErrorCode,
  type ReceiptRecord,
  type Timelocks,
} from "../src/index";

import { ed25519Verify, openVault, VaultError } from "../../vault/src/index";

// ---------------------------------------------------------------------------
// Deterministic fixtures (PUBLIC test vectors — never real funds)
// ---------------------------------------------------------------------------

const T0 = 1_700_000_000_000; // Tue Nov 14 2023 22:13:20 UTC — fixed epoch base
const FUNDED_AT = T0;
const CLAIM_AT = T0 + 60_000; // redeemer claim deadline
const REFUND_AT = T0 + 300_000; // initiator refund deadline (margin 240s ≥ 60s)

const SECRET_HEX = "aa".repeat(32);
const SECRET = Buffer.from(SECRET_HEX, "hex");
/** sha256("aa" × 32) — pinned known-answer vector. */
const SECRET_HASH = "e0e77a507412b120f6ede61f62295b1a7b2ff19d3dcc8f7253e51663470c888e";
const WRONG_SECRET_HEX = "bb".repeat(32);
const WRONG_SECRET_HASH = "4ca14526b2751b640d549ce7caf8ac39438592211a0ec370064d57666a682ad6";

const ASSET_ETH: Asset = { chain: "ethereum", symbol: "ETH" };
const ASSET_STEEM: Asset = { chain: "steem", symbol: "STEEM" };

const VAULT_TEST_MASTER_KEY = "7a".repeat(32); // deterministic TEST key — never real
const ED_SEED1_HEX = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"; // RFC 8032 §7.1 TEST 1
const ED_PK1_HEX = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";

/** Mutable-clock factory: tests drive time explicitly, never sleep. */
function mutableClock(start: number): { clock: () => number; set: (n: number) => void } {
  let now = start;
  return { clock: () => now, set: (n: number) => (now = n) };
}

function baseTimelocks(): Timelocks {
  return createTimelocks(REFUND_AT, CLAIM_AT, FUNDED_AT);
}

function baseOffer(overrides: Partial<Parameters<typeof makeOffer>[0]> = {}) {
  return makeOffer({
    swapId: "swap-0001",
    initiator: "initiator.alice",
    redeemer: "redeemer.bob",
    assetGive: ASSET_ETH,
    assetWant: ASSET_STEEM,
    amountGive: "100",
    hashSecret: SECRET_HASH,
    timelocks: baseTimelocks(),
    ...overrides,
  });
}

/** Captures a rejection; fails loudly if the call resolves (fail-open). */
function errorOf(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected the call to throw, but it resolved (fail-open)");
}

async function errorOfAsync(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected the promise to reject, but it resolved (fail-open)");
}

function expectHtlcError(err: Error, code: HtlcErrorCode): void {
  expect(err).toBeInstanceOf(HtlcError);
  expect((err as HtlcError).code).toBe(code);
}

// ---------------------------------------------------------------------------
// 1. secrets
// ---------------------------------------------------------------------------

describe("secret — generation, sha256 known-answer, constant-time verify", () => {
  it("generateSecret returns 32 fresh bytes (SECRET_BYTES = 32)", () => {
    expect(SECRET_BYTES).toBe(32);
    const a = generateSecret();
    const b = generateSecret();
    expect(a).toBeInstanceOf(Uint8Array);
    expect(a.length).toBe(32);
    expect(b.length).toBe(32);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBeFalse(); // fresh randomness
  });

  it("hashSecret — sha256 known-answer vector for 'aa'×32", () => {
    expect(hashSecret(SECRET)).toBe(SECRET_HASH);
    expect(hashSecret(SECRET_HEX)).toBe(SECRET_HASH); // hex-string form accepted
  });

  it("hashSecret — 'bb'×32 known-answer vector (wrong-secret fixture)", () => {
    expect(hashSecret(Buffer.from(WRONG_SECRET_HEX, "hex"))).toBe(WRONG_SECRET_HASH);
  });

  it("verifySecret — correct secret true, wrong secret false, malformed hash false", () => {
    expect(verifySecret(SECRET, SECRET_HASH)).toBeTrue();
    expect(verifySecret(SECRET_HEX, SECRET_HASH)).toBeTrue();
    expect(verifySecret(Buffer.from(WRONG_SECRET_HEX, "hex"), SECRET_HASH)).toBeFalse();
    expect(verifySecret(SECRET, WRONG_SECRET_HASH)).toBeFalse();
    // malformed hashes: never throw, always false (constant-time decode path)
    expect(verifySecret(SECRET, "")).toBeFalse();
    expect(verifySecret(SECRET, "zz")).toBeFalse();
    expect(verifySecret(SECRET, SECRET_HASH.slice(0, 63))).toBeFalse();
    expect(verifySecret(SECRET, SECRET_HASH.toUpperCase())).toBeTrue(); // case-insensitive hex
  });

  it("fail-closed on non-32-byte secrets; error text never echoes material", () => {
    const short = Buffer.alloc(31, 0xaa);
    const err1 = errorOf(() => hashSecret(short));
    expectHtlcError(err1, "HTLC_E_BAD_INPUT");
    const err2 = errorOf(() => verifySecret(short, SECRET_HASH));
    expectHtlcError(err2, "HTLC_E_BAD_INPUT");
    const text = `${err1.name}: ${err1.message}`;
    expect(text).not.toContain("aaaa"); // no material fragments in errors
  });
});

// ---------------------------------------------------------------------------
// 2. timelocks + phase math
// ---------------------------------------------------------------------------

describe("timelocks — genesis margin invariant + phase math (injected clock)", () => {
  it("accepts a margin exactly MIN_SAFETY_MARGIN_MS (>= invariant)", () => {
    const t = createTimelocks(CLAIM_AT + MIN_SAFETY_MARGIN_MS, CLAIM_AT);
    expect(t.initiatorRefundAt - t.redeemerClaimAt).toBe(MIN_SAFETY_MARGIN_MS);
  });

  it("fails closed when the margin is violated at genesis", () => {
    const err1 = errorOf(() => createTimelocks(CLAIM_AT + MIN_SAFETY_MARGIN_MS - 1, CLAIM_AT));
    expectHtlcError(err1, "HTLC_E_TIMELOCK_MARGIN");
    // inverted order ⇒ negative margin ⇒ refused
    const err2 = errorOf(() => createTimelocks(CLAIM_AT - 1, CLAIM_AT));
    expectHtlcError(err2, "HTLC_E_TIMELOCK_MARGIN");
  });

  it("fails closed on non-integer / non-positive timestamps", () => {
    expectHtlcError(errorOf(() => createTimelocks(1.5, CLAIM_AT)), "HTLC_E_BAD_INPUT");
    expectHtlcError(errorOf(() => createTimelocks(0, CLAIM_AT)), "HTLC_E_BAD_INPUT");
    expectHtlcError(errorOf(() => createTimelocks(Number.NaN, CLAIM_AT)), "HTLC_E_BAD_INPUT");
  });

  it("fails closed when fundedAt is not strictly before the claim deadline", () => {
    expectHtlcError(errorOf(() => createTimelocks(REFUND_AT, CLAIM_AT, CLAIM_AT)), "HTLC_E_BAD_INPUT");
    expectHtlcError(errorOf(() => createTimelocks(REFUND_AT, CLAIM_AT, CLAIM_AT + 1)), "HTLC_E_BAD_INPUT");
  });

  it("phase math — all four phases with an injected clock", () => {
    const t = baseTimelocks();
    expect(phase(FUNDED_AT - 1, t)).toBe("pre-funding"); // before the funding instant
    expect(phase(FUNDED_AT, t)).toBe("claim-window");
    expect(phase(CLAIM_AT - 1, t)).toBe("claim-window");
    expect(phase(CLAIM_AT, t)).toBe("refund-window"); // claim deadline is exclusive
    expect(phase(REFUND_AT - 1, t)).toBe("refund-window");
    expect(phase(REFUND_AT, t)).toBe("expired"); // refund deadline is exclusive
    expect(phase(REFUND_AT + 86_400_000, t)).toBe("expired");
  });

  it("phase math — without fundedAt the swap is funded at genesis (no pre-funding)", () => {
    const t = createTimelocks(REFUND_AT, CLAIM_AT);
    expect(phase(T0 - 1, t)).toBe("claim-window");
    expect(phase(T0, t)).toBe("claim-window");
    expect(phase(CLAIM_AT, t)).toBe("refund-window");
    expect(phase(REFUND_AT, t)).toBe("expired");
  });
});

// ---------------------------------------------------------------------------
// 3. state machine — Initiated → Locked → (Redeemed | Refunded)
// ---------------------------------------------------------------------------

describe("state machine — happy paths", () => {
  it("lock → claim inside the claim window with the correct secret → Redeemed", () => {
    const { clock, set } = mutableClock(FUNDED_AT);
    const m = new SwapMachine(baseOffer(), clock);
    expect(m.state).toBe("Initiated");
    expect(m.phase).toBe("claim-window");

    const lockEvent = m.lock("initiator");
    expect(m.state).toBe("Locked");
    expect(lockEvent.at).toBe(FUNDED_AT);

    set(CLAIM_AT - 1);
    const claimEvent = m.claim("redeemer", SECRET_HEX);
    expect(m.state).toBe("Redeemed");
    expect(claimEvent.at).toBe(CLAIM_AT - 1);
    expect(m.events.map((e) => e.kind)).toEqual(["lock", "claim"]);
  });

  it("claim accepts the secret as raw bytes as well as hex", () => {
    const { clock, set } = mutableClock(FUNDED_AT);
    const m = new SwapMachine(baseOffer(), clock);
    m.lock("initiator");
    set(CLAIM_AT - 1);
    m.claim("redeemer", SECRET); // Uint8Array form
    expect(m.state).toBe("Redeemed");
  });

  it("lock → refund by the initiator inside the refund window → Refunded", () => {
    const { clock, set } = mutableClock(FUNDED_AT);
    const m = new SwapMachine(baseOffer(), clock);
    m.lock("initiator");
    set(CLAIM_AT);
    expect(m.phase).toBe("refund-window");
    m.refund("initiator");
    expect(m.state).toBe("Refunded");
  });
});

describe("state machine — typed refusal matrix (state never silently changes)", () => {
  it("wrong secret → HTLC_E_BAD_SECRET, state unchanged", () => {
    const { clock, set } = mutableClock(FUNDED_AT);
    const m = new SwapMachine(baseOffer(), clock);
    m.lock("initiator");
    set(CLAIM_AT - 1);
    const err = errorOf(() => m.claim("redeemer", WRONG_SECRET_HEX));
    expectHtlcError(err, "HTLC_E_BAD_SECRET");
    expect(m.state).toBe("Locked"); // unchanged
    expect(err.message).not.toContain(WRONG_SECRET_HEX); // secret never echoed
    // the correct secret still lands afterwards — the refusal left no scar
    m.claim("redeemer", SECRET_HEX);
    expect(m.state).toBe("Redeemed");
  });

  it("claim by the initiator → HTLC_E_BAD_PARTY", () => {
    const { clock } = mutableClock(FUNDED_AT);
    const m = new SwapMachine(baseOffer(), clock);
    m.lock("initiator");
    expectHtlcError(errorOf(() => m.claim("initiator", SECRET_HEX)), "HTLC_E_BAD_PARTY");
    expect(m.state).toBe("Locked");
  });

  it("claim before lock → HTLC_E_INVALID_TRANSITION", () => {
    const { clock } = mutableClock(FUNDED_AT);
    const m = new SwapMachine(baseOffer(), clock);
    expect(m.state).toBe("Initiated");
    expectHtlcError(errorOf(() => m.claim("redeemer", SECRET_HEX)), "HTLC_E_INVALID_TRANSITION");
    expect(m.state).toBe("Initiated");
  });

  it("claim in the refund window → HTLC_E_WRONG_PHASE (window boundary is exclusive)", () => {
    const { clock, set } = mutableClock(FUNDED_AT);
    const m = new SwapMachine(baseOffer(), clock);
    m.lock("initiator");
    set(CLAIM_AT); // first ms of the refund window
    expectHtlcError(errorOf(() => m.claim("redeemer", SECRET_HEX)), "HTLC_E_WRONG_PHASE");
    expect(m.state).toBe("Locked");
    set(REFUND_AT); // fully expired
    expectHtlcError(errorOf(() => m.claim("redeemer", SECRET_HEX)), "HTLC_E_WRONG_PHASE");
    expect(m.state).toBe("Locked");
  });

  it("refund by the redeemer → HTLC_E_BAD_PARTY", () => {
    const { clock, set } = mutableClock(FUNDED_AT);
    const m = new SwapMachine(baseOffer(), clock);
    m.lock("initiator");
    set(CLAIM_AT);
    expectHtlcError(errorOf(() => m.refund("redeemer")), "HTLC_E_BAD_PARTY");
    expect(m.state).toBe("Locked");
  });

  it("refund by the initiator inside the claim window → HTLC_E_WRONG_PHASE", () => {
    const { clock } = mutableClock(FUNDED_AT);
    const m = new SwapMachine(baseOffer(), clock);
    m.lock("initiator");
    expectHtlcError(errorOf(() => m.refund("initiator")), "HTLC_E_WRONG_PHASE");
    expect(m.state).toBe("Locked");
  });

  it("refund after expiry → HTLC_E_WRONG_PHASE (expired is terminal-no-move)", () => {
    const { clock, set } = mutableClock(FUNDED_AT);
    const m = new SwapMachine(baseOffer(), clock);
    m.lock("initiator");
    set(REFUND_AT);
    expect(m.phase).toBe("expired");
    expectHtlcError(errorOf(() => m.refund("initiator")), "HTLC_E_WRONG_PHASE");
    expect(m.state).toBe("Locked");
  });

  it("double-claim after Redeemed → HTLC_E_INVALID_TRANSITION", () => {
    const { clock, set } = mutableClock(FUNDED_AT);
    const m = new SwapMachine(baseOffer(), clock);
    m.lock("initiator");
    set(CLAIM_AT - 1);
    m.claim("redeemer", SECRET_HEX);
    expectHtlcError(errorOf(() => m.claim("redeemer", SECRET_HEX)), "HTLC_E_INVALID_TRANSITION");
    expectHtlcError(errorOf(() => m.refund("initiator")), "HTLC_E_INVALID_TRANSITION");
    expect(m.state).toBe("Redeemed");
  });

  it("double-refund after Refunded → HTLC_E_INVALID_TRANSITION", () => {
    const { clock, set } = mutableClock(FUNDED_AT);
    const m = new SwapMachine(baseOffer(), clock);
    m.lock("initiator");
    set(CLAIM_AT);
    m.refund("initiator");
    expectHtlcError(errorOf(() => m.refund("initiator")), "HTLC_E_INVALID_TRANSITION");
    expectHtlcError(errorOf(() => m.claim("redeemer", SECRET_HEX)), "HTLC_E_INVALID_TRANSITION");
    expect(m.state).toBe("Refunded");
  });

  it("double-lock and lock-by-redeemer refused; lock in pre-funding refused", () => {
    const { clock, set } = mutableClock(FUNDED_AT - 1);
    const m = new SwapMachine(baseOffer(), clock);
    expect(m.phase).toBe("pre-funding");
    expectHtlcError(errorOf(() => m.lock("initiator")), "HTLC_E_WRONG_PHASE");
    set(FUNDED_AT);
    m.lock("initiator");
    expectHtlcError(errorOf(() => m.lock("initiator")), "HTLC_E_INVALID_TRANSITION");
    expectHtlcError(errorOf(() => m.lock("redeemer")), "HTLC_E_BAD_PARTY");
    expect(m.state).toBe("Locked");
  });

  it("constructor validates the offer — a tampered protocol fails closed", () => {
    const bad = { ...baseOffer(), protocol: "SAOS-HTLC/2" };
    expectHtlcError(errorOf(() => new SwapMachine(bad as never, () => T0)), "HTLC_E_BAD_MESSAGE");
  });
});

// ---------------------------------------------------------------------------
// 4. canonical codec + receipt hash-chain
// ---------------------------------------------------------------------------

describe("canonical JSON — deterministic bytes", () => {
  it("key order is irrelevant: different insertion orders → identical bytes", () => {
    const a = canonicalize({ swapId: "s1", amountGive: "100", protocol: "SAOS-HTLC/1" });
    const b = canonicalize({ protocol: "SAOS-HTLC/1", swapId: "s1", amountGive: "100" });
    const c = canonicalize({ amountGive: "100", protocol: "SAOS-HTLC/1", swapId: "s1" });
    expect(a).toBe(b);
    expect(b).toBe(c);
    // nested objects are sorted recursively; arrays keep their order
    const n1 = canonicalize({ outer: { z: 1, a: 2 }, list: [{ y: 1, x: 2 }, 3] });
    const n2 = canonicalize({ list: [{ x: 2, y: 1 }, 3], outer: { a: 2, z: 1 } });
    expect(n1).toBe(n2);
  });

  it("pinned golden canonical form + sha256", () => {
    const canon = canonicalize({ protocol: "SAOS-HTLC/1", swapId: "swap-1", amountGive: "100" });
    expect(canon).toBe('{"amountGive":"100","protocol":"SAOS-HTLC/1","swapId":"swap-1"}');
    expect(canonicalBytes({ protocol: "SAOS-HTLC/1", swapId: "swap-1", amountGive: "100" })).toEqual(
      Buffer.from(canon, "utf8"),
    );
    expect(createHash("sha256").update(canon, "utf8").digest("hex")).toBe(
      "41001ecbab90d14964b5a50f43fba64187cbb3ca402a0d238f72921a576a0fd6",
    );
  });

  it("refuses non-deterministic JSON values (NaN, Infinity, undefined, functions)", () => {
    expectHtlcError(errorOf(() => canonicalize({ x: Number.NaN })), "HTLC_E_BAD_INPUT");
    expectHtlcError(errorOf(() => canonicalize({ x: Number.POSITIVE_INFINITY })), "HTLC_E_BAD_INPUT");
    expectHtlcError(errorOf(() => canonicalize({ x: undefined })), "HTLC_E_BAD_INPUT");
    expectHtlcError(errorOf(() => canonicalize({ x: () => 1 })), "HTLC_E_BAD_INPUT");
  });

  it("encodeMessage is stable under decode→re-encode (roundtrip identity)", () => {
    const wire = encodeMessage(baseOffer());
    const back = decodeMessage(wire);
    expect(encodeMessage(back)).toBe(wire);
  });
});

describe("message codec — strict schema (fail-closed)", () => {
  it("decodes Offer / Lock / Claim / Refund with exact shapes", () => {
    const offer = decodeMessage(encodeMessage(baseOffer()));
    expect(offer.kind).toBe("offer");
    if (offer.kind === "offer") {
      expect(offer.protocol).toBe("SAOS-HTLC/1");
      expect(offer.hashSecret).toBe(SECRET_HASH);
      expect(offer.timelocks.redeemerClaimAt).toBe(CLAIM_AT);
    }
    const lock = decodeMessage(encodeMessage(makeLock("swap-0001")));
    expect(lock).toEqual({ kind: "lock", swapId: "swap-0001" });
    const claim = decodeMessage(encodeMessage(makeClaim("swap-0001", SECRET_HEX)));
    expect(claim).toEqual({ kind: "claim", swapId: "swap-0001", secret: SECRET_HEX });
    const refund = decodeMessage(encodeMessage(makeRefund("swap-0001")));
    expect(refund).toEqual({ kind: "refund", swapId: "swap-0001" });
  });

  it("refuses: wrong protocol, unknown kind, missing fields, unknown extra fields", () => {
    const good = JSON.parse(encodeMessage(baseOffer())) as Record<string, unknown>;
    const bad1 = { ...good, protocol: "OTHER/1" };
    expectHtlcError(errorOf(() => decodeMessage(JSON.stringify(bad1))), "HTLC_E_BAD_MESSAGE");
    const bad2 = { ...good, kind: "settle" };
    expectHtlcError(errorOf(() => decodeMessage(JSON.stringify(bad2))), "HTLC_E_BAD_MESSAGE");
    const bad3 = { ...good };
    delete bad3.amountGive;
    expectHtlcError(errorOf(() => decodeMessage(JSON.stringify(bad3))), "HTLC_E_BAD_MESSAGE");
    const bad4 = { ...good, extra: true };
    expectHtlcError(errorOf(() => decodeMessage(JSON.stringify(bad4))), "HTLC_E_BAD_MESSAGE");
    const bad5 = { ...good, hashSecret: "nothex" };
    expectHtlcError(errorOf(() => decodeMessage(JSON.stringify(bad5))), "HTLC_E_BAD_MESSAGE");
    expectHtlcError(errorOf(() => decodeMessage("{not json")), "HTLC_E_BAD_MESSAGE");
  });

  it("a claim whose secret is not 64-hex fails closed", () => {
    const bad = { kind: "claim", swapId: "swap-0001", secret: "abc123" };
    expectHtlcError(errorOf(() => decodeMessage(JSON.stringify(bad))), "HTLC_E_BAD_MESSAGE");
  });

  it("an offer violating the timelock margin fails closed at decode (genesis law)", () => {
    const raw = JSON.parse(encodeMessage(baseOffer())) as Record<string, unknown>;
    const timelocks = raw.timelocks as Record<string, number>;
    timelocks.initiatorRefundAt = CLAIM_AT + MIN_SAFETY_MARGIN_MS - 1; // margin violation
    expectHtlcError(errorOf(() => decodeMessage(JSON.stringify(raw))), "HTLC_E_TIMELOCK_MARGIN");
  });
});

describe("receipt hash-chain — sha256 prev→hash (fleet chain law)", () => {
  it("genesis record points at GENESIS_PREV; children chain to the parent hash", () => {
    expect(GENESIS_PREV).toBe("0".repeat(64));
    const r0 = appendRecord([], { kind: "offer", at: T0, swapId: "swap-0001", payload: baseOffer(), result: "Initiated" });
    expect(r0.seq).toBe(0);
    expect(r0.prev).toBe(GENESIS_PREV);
    const r1 = appendRecord([r0], { kind: "lock", at: T0 + 1, swapId: "swap-0001", payload: makeLock("swap-0001"), result: "Locked" });
    expect(r1.seq).toBe(1);
    expect(r1.prev).toBe(r0.hash);
    expect(verifyChain([r0, r1])).toBeTrue();
  });

  it("appendRecord refuses a non-contiguous / mismatched prev chain", () => {
    const r0 = appendRecord([], { kind: "offer", at: T0, swapId: "swap-0001", payload: baseOffer(), result: "Initiated" });
    const r1 = appendRecord([r0], { kind: "lock", at: T0 + 1, swapId: "swap-0001", payload: makeLock("swap-0001"), result: "Locked" });
    expectHtlcError(
      errorOf(() =>
        appendRecord([r1], {
          kind: "claim",
          at: T0 + 2,
          swapId: "swap-0001",
          payload: makeClaim("swap-0001", SECRET_HEX),
          result: "Redeemed",
        }),
      ),
      "HTLC_E_BAD_INPUT",
    );
  });

  it("tampering ANY record (payload, seq, prev, hash) breaks verification", () => {
    const r0 = appendRecord([], { kind: "offer", at: T0, swapId: "swap-0001", payload: baseOffer(), result: "Initiated" });
    const r1 = appendRecord([r0], { kind: "lock", at: T0 + 1, swapId: "swap-0001", payload: makeLock("swap-0001"), result: "Locked" });
    const r2 = appendRecord([r0, r1], {
      kind: "claim",
      at: T0 + 2,
      swapId: "swap-0001",
      payload: makeClaim("swap-0001", SECRET_HEX),
      result: "Redeemed",
    });
    const chain = [r0, r1, r2];
    expect(verifyChain(chain)).toBeTrue();

    // payload tamper (a forged record pointing at another swap)
    const forged = { ...chain[1], payload: { ...(chain[1].payload as object), swapId: "swap-0002" } };
    expect(verifyChain([chain[0], forged, chain[2]])).toBeFalse();

    // hash-field tamper
    expect(verifyChain([chain[0], { ...chain[1], hash: "f".repeat(64) }, chain[2]])).toBeFalse();

    // seq renumber
    expect(verifyChain([chain[0], { ...chain[1], seq: 7 }, chain[2]])).toBeFalse();

    // prev-link tamper
    expect(verifyChain([chain[0], { ...chain[1], prev: "1".repeat(64) }, chain[2]])).toBeFalse();

    // structural garbage never throws — it is just not a valid chain
    expect(verifyChain([{ ...chain[0], hash: undefined } as unknown as ReceiptRecord])).toBeFalse();
    expect(verifyChain([])).toBeTrue(); // vacuously valid
  });
});

// ---------------------------------------------------------------------------
// 5. session — dual-view orchestration + vault integration
// ---------------------------------------------------------------------------

describe("session — both sides advance on validated messages", () => {
  it("full lifecycle → Redeemed on BOTH views, receipts chain verifies", () => {
    const { clock, set } = mutableClock(FUNDED_AT);
    const session = new SwapSession(baseOffer(), clock);
    expect(session.state).toBe("Initiated");

    session.submit(makeLock("swap-0001"));
    expect(session.state).toBe("Locked");
    set(CLAIM_AT - 1);
    session.submit(makeClaim("swap-0001", SECRET_HEX));
    expect(session.state).toBe("Redeemed");

    const receipts = session.receipts();
    expect(receipts.map((r) => r.kind)).toEqual(["offer", "lock", "claim"]);
    expect(verifyChain(receipts)).toBeTrue();
    expect(session.verify()).toBeTrue();
    expect(session.chainHash()).toBe(receipts[receipts.length - 1].hash);
  });

  it("reverse direction (roles swapped) completes identically", () => {
    const { clock, set } = mutableClock(FUNDED_AT);
    const reverse = baseOffer({
      swapId: "swap-0002",
      initiator: "redeemer.bob",
      redeemer: "initiator.alice",
      assetGive: ASSET_STEEM,
      assetWant: ASSET_ETH,
      amountGive: "950",
    });
    const session = new SwapSession(reverse, clock);
    session.submit(makeLock("swap-0002"));
    set(CLAIM_AT - 1);
    session.submit(makeClaim("swap-0002", SECRET_HEX));
    expect(session.state).toBe("Redeemed");
    expect(verifyChain(session.receipts())).toBeTrue();
  });

  it("refund path through the session: lock, wait, refund → Refunded", () => {
    const { clock, set } = mutableClock(FUNDED_AT);
    const session = new SwapSession(baseOffer(), clock);
    session.submit(makeLock("swap-0001"));
    set(CLAIM_AT);
    session.submit(makeRefund("swap-0001"));
    expect(session.state).toBe("Refunded");
    expect(verifyChain(session.receipts())).toBeTrue();
  });

  it("messages for another swap are refused (HTLC_E_SWAP_MISMATCH), receipts untouched", () => {
    const { clock } = mutableClock(FUNDED_AT);
    const session = new SwapSession(baseOffer(), clock);
    const count = session.receipts().length;
    expectHtlcError(errorOf(() => session.submit(makeLock("swap-other"))), "HTLC_E_SWAP_MISMATCH");
    expect(session.receipts().length).toBe(count);
    expect(session.state).toBe("Initiated");
  });

  it("wrong-secret claim through the session → typed refusal, receipts unchanged", () => {
    const { clock, set } = mutableClock(FUNDED_AT);
    const session = new SwapSession(baseOffer(), clock);
    session.submit(makeLock("swap-0001"));
    set(CLAIM_AT - 1);
    const before = session.receipts().length;
    const beforeHash = session.chainHash();
    expectHtlcError(errorOf(() => session.submit(makeClaim("swap-0001", WRONG_SECRET_HEX))), "HTLC_E_BAD_SECRET");
    expect(session.receipts().length).toBe(before);
    expect(session.chainHash()).toBe(beforeHash);
    expect(session.state).toBe("Locked");
    // the honest secret still completes the swap afterwards
    session.submit(makeClaim("swap-0001", SECRET_HEX));
    expect(session.state).toBe("Redeemed");
  });

  it("double-claim through the session → HTLC_E_INVALID_TRANSITION", () => {
    const { clock, set } = mutableClock(FUNDED_AT);
    const session = new SwapSession(baseOffer(), clock);
    session.submit(makeLock("swap-0001"));
    set(CLAIM_AT - 1);
    session.submit(makeClaim("swap-0001", SECRET_HEX));
    expectHtlcError(errorOf(() => session.submit(makeClaim("swap-0001", SECRET_HEX))), "HTLC_E_INVALID_TRANSITION");
    expect(session.state).toBe("Redeemed");
  });
});

describe("vault integration — seal/open the session receipt chain hash", () => {
  const OLD_ENV = process.env.SAOS_VAULT_MASTER_KEY;
  let dir: string;

  beforeAll(() => {
    process.env.SAOS_VAULT_MASTER_KEY = VAULT_TEST_MASTER_KEY; // deterministic TEST key
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "htlc-vault-"));
  });

  afterAll(() => {
    if (OLD_ENV === undefined) delete process.env.SAOS_VAULT_MASTER_KEY;
    else process.env.SAOS_VAULT_MASTER_KEY = OLD_ENV;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("sealSessionReceipt → openSessionReceipt roundtrip returns the same chain hash", async () => {
    const { clock, set } = mutableClock(FUNDED_AT);
    const session = new SwapSession(baseOffer(), clock);
    session.submit(makeLock("swap-0001"));
    set(CLAIM_AT - 1);
    session.submit(makeClaim("swap-0001", SECRET_HEX));
    expect(session.state).toBe("Redeemed");

    const vault = await openVault({ dir });
    const id = "htlc/receipt/swap-0001";
    const sealed = await sealSessionReceipt(vault, id, session);
    expect(sealed.chainHash).toBe(session.chainHash());

    const opened = await openSessionReceipt(vault, id);
    expect(opened.chainHash).toBe(session.chainHash());
    expect(opened.swapId).toBe("swap-0001");

    // A second seal under the same id must fail closed (no silent overwrite).
    const err = await errorOfAsync(() => sealSessionReceipt(vault, id, session));
    expect(err).toBeInstanceOf(VaultError);
  });

  it("a later state change yields a different chain hash — sealed receipt exposes tamper", async () => {
    const { clock, set } = mutableClock(FUNDED_AT);
    const session = new SwapSession(baseOffer(), clock);
    session.submit(makeLock("swap-0001"));
    const vault = await openVault({ dir });
    const id = "htlc/receipt/tamper-probe";
    await sealSessionReceipt(vault, id, session);
    const sealedHash = (await openSessionReceipt(vault, id)).chainHash;

    set(CLAIM_AT);
    session.submit(makeRefund("swap-0001"));
    expect(session.chainHash()).not.toBe(sealedHash);
    expect((await openSessionReceipt(vault, id)).chainHash).toBe(sealedHash); // old, sealed truth
  });

  it("the receipt chain hash is Ed25519-signable through the vault (RFC 8032 TEST 1)", async () => {
    const { clock, set } = mutableClock(FUNDED_AT);
    const session = new SwapSession(baseOffer(), clock);
    session.submit(makeLock("swap-0001"));
    set(CLAIM_AT - 1);
    session.submit(makeClaim("swap-0001", SECRET_HEX));

    const vault = await openVault({ dir });
    await vault.sealKey({ id: "htlc/signer/test", type: "ed25519", material: ED_SEED1_HEX });
    const message = canonicalBytes(session.chainHash());
    // The seed never leaves the vault — signing happens inside via signEd25519.
    const signature = await vault.signEd25519("htlc/signer/test", message);
    expect(signature.length).toBe(64);
    expect(ed25519Verify(Buffer.from(ED_PK1_HEX, "hex"), message, signature)).toBeTrue();
    // a different chain hash must NOT verify under the same signature
    expect(ed25519Verify(Buffer.from(ED_PK1_HEX, "hex"), canonicalBytes("f".repeat(64)), signature)).toBeFalse();
  });

  it("openSessionReceipt fails closed on a sealed value that is not a chain hash", async () => {
    const vault = await openVault({ dir });
    await vault.sealKey({ id: "htlc/receipt/garbage", type: "opaque", material: "not-a-hash" });
    const err = await errorOfAsync(() => openSessionReceipt(vault, "htlc/receipt/garbage"));
    expectHtlcError(err, "HTLC_E_BAD_INPUT");
  });
});

// ---------------------------------------------------------------------------
// 6. simulated chain adapter — deterministic in-memory bookkeeping
// ---------------------------------------------------------------------------

describe("SimulatedChainAdapter — honest, deterministic, fail-closed", () => {
  it("marks itself simulated and validates its asset set", async () => {
    const adapter = new SimulatedChainAdapter({ id: "sim-ethereum", assets: [ASSET_ETH], clock: () => T0 });
    expect(adapter.id).toBe("sim-ethereum");
    expect(adapter.simulated).toBeTrue();
    await adapter.validateAsset(ASSET_ETH); // resolves
    const err = await errorOfAsync(() => adapter.validateAsset(ASSET_STEEM));
    expectHtlcError(err, "HTLC_E_ADAPTER_ASSET");
  });

  it("lock/claim/refund bookkeeping with deterministic tx ids", async () => {
    const { clock, set } = mutableClock(FUNDED_AT);
    const adapter = new SimulatedChainAdapter({ id: "sim-ethereum", assets: [ASSET_ETH], clock });

    const lockReceipt = await adapter.lock(baseOffer());
    expect(lockReceipt.op).toBe("lock");
    expect(lockReceipt.swapId).toBe("swap-0001");
    expect(lockReceipt.simulated).toBeTrue();
    expect(lockReceipt.at).toBe(FUNDED_AT);

    set(CLAIM_AT - 1);
    const claimReceipt = await adapter.claim(makeClaim("swap-0001", SECRET_HEX));
    expect(claimReceipt.op).toBe("claim");

    const books = adapter.books();
    expect(books.map((e) => e.op)).toEqual(["lock", "claim"]);
    expect(books.every((e) => /^[0-9a-f]{64}$/.test(e.txId))).toBeTrue();

    // Determinism: an identical replay on a fresh adapter yields identical tx ids.
    const fresh = new SimulatedChainAdapter({ id: "sim-ethereum", assets: [ASSET_ETH], clock: () => FUNDED_AT });
    const replay = await fresh.lock(baseOffer());
    expect(replay.txId).toBe(lockReceipt.txId);
  });

  it("refund bookkeeping lands inside the refund window", async () => {
    const { clock, set } = mutableClock(FUNDED_AT);
    const adapter = new SimulatedChainAdapter({ id: "sim-ethereum", assets: [ASSET_ETH], clock });
    await adapter.lock(baseOffer());
    set(CLAIM_AT);
    const refundReceipt = await adapter.refund(makeRefund("swap-0001"));
    expect(refundReceipt.op).toBe("refund");
    expect(adapter.books().map((e) => e.op)).toEqual(["lock", "refund"]);
  });

  it("refuses double-lock, claim-before-lock, wrong secret, wrong phase, post-terminal ops", async () => {
    const { clock, set } = mutableClock(FUNDED_AT);
    const adapter = new SimulatedChainAdapter({ id: "sim-ethereum", assets: [ASSET_ETH], clock });

    // claim before lock
    const errClaimEarly = await errorOfAsync(() => adapter.claim(makeClaim("swap-0001", SECRET_HEX)));
    expectHtlcError(errClaimEarly, "HTLC_E_ADAPTER_STATE");

    await adapter.lock(baseOffer());
    // double lock
    const errDoubleLock = await errorOfAsync(() => adapter.lock(baseOffer()));
    expectHtlcError(errDoubleLock, "HTLC_E_ADAPTER_STATE");

    // wrong secret at the adapter layer
    set(CLAIM_AT - 1);
    const errWrongSecret = await errorOfAsync(() => adapter.claim(makeClaim("swap-0001", WRONG_SECRET_HEX)));
    expectHtlcError(errWrongSecret, "HTLC_E_BAD_SECRET");

    // wrong phase (refund window open, claim window closed)
    set(CLAIM_AT);
    const errPhase = await errorOfAsync(() => adapter.claim(makeClaim("swap-0001", SECRET_HEX)));
    expectHtlcError(errPhase, "HTLC_E_WRONG_PHASE");

    // refund, then post-terminal operations are dead
    await adapter.refund(makeRefund("swap-0001"));
    const errPostClaim = await errorOfAsync(() => adapter.claim(makeClaim("swap-0001", SECRET_HEX)));
    expectHtlcError(errPostClaim, "HTLC_E_ADAPTER_STATE");
    const errPostRefund = await errorOfAsync(() => adapter.refund(makeRefund("swap-0001")));
    expectHtlcError(errPostRefund, "HTLC_E_ADAPTER_STATE");
    expect(adapter.books().map((e) => e.op)).toEqual(["lock", "refund"]);
  });

  it("lock refuses offers for assets it does not support", async () => {
    const adapter = new SimulatedChainAdapter({ id: "sim-ethereum", assets: [ASSET_ETH], clock: () => FUNDED_AT });
    const err = await errorOfAsync(() => adapter.lock(baseOffer({ assetGive: ASSET_STEEM })));
    expectHtlcError(err, "HTLC_E_ADAPTER_ASSET");
  });
});
